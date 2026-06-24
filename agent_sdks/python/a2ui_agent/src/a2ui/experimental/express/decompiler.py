# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Decompilation engine for A2UI Express.

Reconstructs standard A2UI v1.0 JSON envelopes back into A2UI Express DSL code,
tailored for prompt tokens compression.
"""

from typing import Any
from .schema_helper import CatalogSchemaHelper
from .constants import SurfaceOperation


def _flatten_data_model(data_dict: dict) -> list[tuple[str, Any]]:
  """Flattens a nested dictionary dataModel structure into JSON Pointer path segments."""
  results = []

  def recurse(current: Any, path: str):
    if isinstance(current, dict) and current:
      for k, v in current.items():
        recurse(v, f"{path}/{k}")
    else:
      results.append((path, current))

  recurse(data_dict, "")
  return results


def _is_component_reference_property(prop_schema: Any) -> bool:
  """Checks if a property schema defines a component reference (ComponentId or list of ComponentId)."""
  if not isinstance(prop_schema, dict):
    return False
  if "$ref" in prop_schema:
    ref = prop_schema["$ref"]
    if "ComponentId" in ref or "ChildList" in ref:
      return True
  if "oneOf" in prop_schema or "anyOf" in prop_schema or "allOf" in prop_schema:
    subs = (
        prop_schema.get("oneOf", [])
        + prop_schema.get("anyOf", [])
        + prop_schema.get("allOf", [])
    )
    for sub in subs:
      if _is_component_reference_property(sub):
        return True
  if prop_schema.get("type") == "array" and "items" in prop_schema:
    return _is_component_reference_property(prop_schema["items"])
  return False


def _decompile_string(val: str) -> str:
  """Formats a string literal using the cleanest/most readable representation."""
  has_newline = "\n" in val or "\r" in val
  has_tab = "\t" in val
  has_quote = '"' in val
  has_backslash = "\\" in val

  # 1. Use triple-quotes for multi-line or strings containing double quotes
  if (has_quote or has_newline) and not val.endswith('"'):
    if '"""' not in val:
      # Use raw triple quotes if there are backslashes but no tabs
      if has_backslash and not has_tab:
        return f'r"""{val}"""'
      # Otherwise standard triple quotes
      escaped = val.replace("\\", "\\\\").replace("\t", "\\t")
      return f'"""{escaped}"""'

  # 2. Use single-line raw string if it has backslashes but no quotes/tabs/newlines
  if has_backslash and not has_newline and not has_tab and not has_quote:
    return f'r"{val}"'

  # 3. Fall back to standard double-quoted string with escapes
  escaped = (
      val.replace("\\", "\\\\")
      .replace('"', '\\"')
      .replace("\n", "\\n")
      .replace("\r", "\\r")
      .replace("\t", "\\t")
  )
  return f'"{escaped}"'


class ExpressDecompiler:
  """Converts standard A2UI wire JSON trees back into A2UI Express syntax.

  Identifies component definitions, event trigger actions, validation logic rules,
  and dynamic child templates, maps them positional-wise, and outputs plain text.

  Attributes:
      helper: A CatalogSchemaHelper loaded with the target catalog schema.
  """

  def __init__(self, catalog_path: str):
    """Initializes the decompiler with the specified catalog.

    Args:
        catalog_path: The absolute filesystem path to the catalog JSON file.
    """
    self.helper = CatalogSchemaHelper(catalog_path)

  def decompile(self, envelope_json: dict) -> str:
    """Decompiles standard A2UI wire JSON into clean A2UI Express lines.

    Args:
        envelope_json: The standard A2UI v1.0 JSON envelope.

    Returns:
        The decompiled A2UI Express DSL string.
    """
    # Handle deleteSurface action
    if SurfaceOperation.DELETE in envelope_json:
      surf_op = envelope_json[SurfaceOperation.DELETE]
      surface_id = surf_op.get("surfaceId", "")
      return f'<a2ui>\ndeleteSurface("{surface_id}")\n</a2ui>'

    # Handle updateDataModel action
    if SurfaceOperation.UPDATE_DATA in envelope_json:
      val_op = envelope_json[SurfaceOperation.UPDATE_DATA]
      data_val = val_op.get("value", {})
      dsl_lines = []
      if data_val:
        for path, val in sorted(_flatten_data_model(data_val)):
          val_str = self._decompile_value(val, set(), False)
          dsl_lines.append(f"${path} = {val_str}")
      dsl_body = "\n".join(dsl_lines)
      return f"<a2ui>\n{dsl_body}\n</a2ui>"

    # Handle callFunction action
    if SurfaceOperation.CALL_FUNC in envelope_json:
      func_op = envelope_json[SurfaceOperation.CALL_FUNC]
      fn_name = func_op.get("call", "")
      fn_args = func_op.get("args", {})
      args_list = []
      if fn_name in self.helper.functions:
        fn_props = self.helper.get_function_properties(fn_name)
        for prop_name in fn_props:
          if prop_name in fn_args:
            val_str = self._decompile_value(fn_args[prop_name], set(), False)
            args_list.append(val_str)
          else:
            args_list.append("_")
      else:
        for k, v in fn_args.items():
          val_str = self._decompile_value(v, set(), False)
          args_list.append(val_str)
      while args_list and args_list[-1] == "_":
        args_list.pop()
      args_str = ", ".join(args_list)
      return f"<a2ui>\n{fn_name}({args_str})\n</a2ui>"

    create_surface = envelope_json.get(SurfaceOperation.CREATE, {})
    components = create_surface.get("components", [])
    data_model = create_surface.get("dataModel", {})

    dsl_lines = []
    # Index components by ID for hierarchy mapping
    comp_ids = {c["id"] for c in components}

    # Decompile dataModel paths first
    if data_model:
      for path, val in sorted(_flatten_data_model(data_model)):
        val_str = self._decompile_value(val, comp_ids)
        dsl_lines.append(f"${path} = {val_str}")

    for c in components:
      comp_id = c["id"]
      comp_name = c["component"]
      if comp_name not in self.helper.components:
        continue

      properties = self.helper.get_component_properties(comp_name)
      args_reprs = []

      for prop_name in properties:
        if prop_name == "checks":
          # Decompile checks
          checks_val = c.get("checks", [])
          if not checks_val:
            args_reprs.append("_")
            continue

          compiled_checks_list = []
          for rc in checks_val:
            condition = rc.get("condition", {})
            message = rc.get("message", "")

            check_name = condition.get("call")
            check_args = condition.get("args", {})

            check_props = self.helper.get_function_properties(check_name)
            explicit_args_reprs = []

            # If first property is value (implicitly bound), skip it
            start_idx = 0
            if check_props and check_props[0] == "value":
              start_idx = 1

            for idx in range(start_idx, len(check_props)):
              p = check_props[idx]
              if p in check_args:
                explicit_args_reprs.append(
                    self._decompile_value(check_args[p], comp_ids)
                )

            if (
                check_name
                and message
                and message != f"{check_name.capitalize()} check failed"
            ):
              explicit_args_reprs.append(_decompile_string(message))

            if explicit_args_reprs:
              compiled_checks_list.append(
                  f"?{check_name}({', '.join(explicit_args_reprs)})"
              )
            else:
              compiled_checks_list.append(f"?{check_name}")

          if len(compiled_checks_list) == 1:
            args_reprs.append(compiled_checks_list[0])
          else:
            args_reprs.append(f"[{', '.join(compiled_checks_list)}]")
          continue

        # Map other regular properties
        if prop_name in c:
          val = c[prop_name]
          p_schema = self.helper.get_property_schema(comp_name, prop_name)
          is_prop_ref = _is_component_reference_property(p_schema)
          args_reprs.append(self._decompile_value(val, comp_ids, is_prop_ref))
        else:
          # Only append "_" if there is a subsequent regular property that has a value
          idx = properties.index(prop_name)
          has_subsequent_val = False
          for p in properties[idx + 1 :]:
            if p != "checks" and p in c:
              has_subsequent_val = True
              break
          if has_subsequent_val:
            args_reprs.append("_")

      # Strip trailing optional skipped arguments for readability
      while args_reprs and args_reprs[-1] == "_":
        args_reprs.pop()

      dsl_lines.append(f"{comp_id} = {comp_name}({', '.join(args_reprs)})")

    dsl_body = "\n".join(dsl_lines)
    return f"<a2ui>\n{dsl_body}\n</a2ui>"

  def _decompile_value(self, val: Any, comp_ids: set[str], is_ref: bool = False) -> str:
    """Decompiles a single value node back to A2UI Express notation.

    Args:
        val: The JSON-serialized property value structure.
        comp_ids: A set of all component IDs registered in the surface context.
        is_ref: Whether this value is a component reference.

    Returns:
        A plain-text representation of the value.
    """
    if isinstance(val, dict):
      if "path" in val:
        if "componentId" in val:
          path_repr = self._decompile_value({"path": val["path"]}, comp_ids, False)
          comp_id_repr = val["componentId"]
          return f"_template({path_repr}, {comp_id_repr})"
        # Decompile path: prefixed by $
        path_str = val["path"]
        if path_str.startswith("/"):
          return f"$/{path_str[1:]}"
        return f"${path_str}"

      if "event" in val:
        # Decompile server event: Event("name", context)
        evt = val["event"]
        name = evt.get("name", "")
        ctx = evt.get("context", {})
        ctx_reprs = []
        for k, v in ctx.items():
          ctx_reprs.append(f"{k}: {self._decompile_value(v, comp_ids, False)}")
        if ctx_reprs:
          return f'Event("{name}", {{{", ".join(ctx_reprs)}}})'
        return f'Event("{name}")'

      if "functionCall" in val:
        # Decompile local function action: FunctionName(args)
        fn = val["functionCall"]
        name = fn["call"]
        args = fn.get("args", {})

        fn_props = self.helper.get_function_properties(name)
        args_reprs = []
        for p in fn_props:
          if p in args:
            args_reprs.append(self._decompile_value(args[p], comp_ids, False))
          else:
            args_reprs.append("_")

        while args_reprs and args_reprs[-1] == "_":
          args_reprs.pop()
        return f"{name}({', '.join(args_reprs)})"

      if "call" in val:
        # Decompile dynamic functional expression: FunctionName(args)
        name = val["call"]
        args = val.get("args", {})
        fn_props = self.helper.get_function_properties(name)
        args_reprs = []
        for p in fn_props:
          if p in args:
            args_reprs.append(self._decompile_value(args[p], comp_ids, False))
          else:
            args_reprs.append("_")

        while args_reprs and args_reprs[-1] == "_":
          args_reprs.pop()
        return f"{name}({', '.join(args_reprs)})"

      # General dict
      import re

      items_reprs = []
      for k, v in val.items():
        item_is_ref = is_ref or k in ("child", "componentId")
        k_repr = k if re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", k) else _decompile_string(k)
        items_reprs.append(
            f"{k_repr}: {self._decompile_value(v, comp_ids, item_is_ref)}"
        )
      return f'{{{", ".join(items_reprs)}}}'

    if isinstance(val, list):
      # Decompile array
      list_reprs = [self._decompile_value(item, comp_ids, is_ref) for item in val]
      return f"[{', '.join(list_reprs)}]"

    if isinstance(val, str):
      # If it matches a component ID reference, keep it as a variable identifier
      # (if it is a structural variable name)
      if is_ref and val in comp_ids:
        return val
      # Otherwise quote as string literal
      return _decompile_string(val)

    if isinstance(val, bool):
      return "true" if val else "false"

    if val is None:
      return "null"

    return str(val)
