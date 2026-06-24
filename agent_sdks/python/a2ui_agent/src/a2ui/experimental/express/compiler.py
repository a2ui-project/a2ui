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

"""Compilation engine for A2UI Express.

Tokenizes, lexes, and parses A2UI Express plain-text statements into a clean
AST, compiling it directly into standard A2UI v1.0 JSON messages.

The grammar for A2UI Express is defined in Express.g4.
"""

import re
from typing import Any, Optional
from antlr4 import InputStream, CommonTokenStream
from .generated.express_lexer import ExpressLexer
from .generated.express_parser import ExpressParser
from .visitor import ExpressAstVisitor, ExpressErrorListener
from .schema_helper import CatalogSchemaHelper
from .constants import SurfaceOperation


def _set_nested_path(d: dict, path_str: str, val: Any) -> None:
  """Populates a nested dictionary path from a JSON pointer-like string."""
  if path_str.startswith("$/"):
    clean_path = path_str[2:]
  elif path_str.startswith("$"):
    clean_path = path_str[1:]
  else:
    clean_path = path_str

  if not clean_path:
    return

  keys = clean_path.split("/")
  current = d
  for key in keys[:-1]:
    if key not in current or not isinstance(current[key], dict):
      current[key] = {}
    current = current[key]
  current[keys[-1]] = val


def _schema_allows_databinding(schema: Any) -> bool:
  """Recursively checks if a property's schema allows a dynamic DataBinding ref."""
  if not isinstance(schema, dict):
    return False
  if "$ref" in schema:
    ref = schema["$ref"]
    if isinstance(ref, str) and ("DataBinding" in ref or "Dynamic" in ref):
      return True
  if "properties" in schema and "path" in schema["properties"]:
    if "componentId" not in schema["properties"]:
      return True
  if "items" in schema:
    if _schema_allows_databinding(schema["items"]):
      return True
  for key in ["allOf", "oneOf", "anyOf"]:
    if key in schema and isinstance(schema[key], list):
      for sub in schema[key]:
        if _schema_allows_databinding(sub):
          return True
  return False


def _schema_expects_option_objects(schema: Any) -> bool:
  """Checks if a property's schema expects a list of objects with label/value properties."""
  if not isinstance(schema, dict):
    return False
  if "items" in schema:
    items_schema = schema["items"]

    def has_label_value(sub: Any) -> bool:
      if not isinstance(sub, dict):
        return False
      if (
          "properties" in sub
          and "label" in sub["properties"]
          and "value" in sub["properties"]
      ):
        return True
      for k in ["allOf", "oneOf", "anyOf"]:
        if k in sub and isinstance(sub[k], list):
          if any(has_label_value(s) for s in sub[k]):
            return True
      return False

    return has_label_value(items_schema)
  for key in ["allOf", "oneOf", "anyOf"]:
    if key in schema and isinstance(schema[key], list):
      if any(_schema_expects_option_objects(sub) for sub in schema[key]):
        return True
  return False


def _is_check_expression(val: Any) -> bool:
  """Checks if a parsed AST value represents a validation check expression."""
  if isinstance(val, dict) and "check" in val:
    return True
  if isinstance(val, list) and val:
    return all(_is_check_expression(item) for item in val)
  return False


# ANTLR-generated lexer, parser, and custom visitor are used for compilation.


class _CompileContext:
  """Holds mutable state for a single compiler execution thread."""

  def __init__(self):
    self.extra_components: list[dict] = []
    self.inline_counter: int = 0
    self.active_value_path: Optional[dict] = None


class ExpressCompiler:
  """Compilation pipeline for A2UI Express.

  Resolves positional parameters dynamically, flattens variable references into
  an adjacency list widget tree, and constructs valid A2UI v1.0 JSON payloads.

  Attributes:
      helper: A CatalogSchemaHelper loaded with the target catalog definition.
  """

  def __init__(self, catalog_path: str):
    """Initializes the compiler with the specified catalog schema.

    Args:
        catalog_path: The absolute filesystem path to the catalog JSON file.
    """
    self.helper = CatalogSchemaHelper(catalog_path)

  def compile(
      self,
      dsl_text: str,
      surface_id: str = "default_surface",
      catalog_id: str = "",
      is_final: bool = True,
  ) -> dict:
    """Compiles plain A2UI Express DSL into standard A2UI v1.0 wire JSON.

    Args:
        dsl_text: The source A2UI Express DSL text block.
        surface_id: The unique identifier for the compiled user interface surface.
        catalog_id: The URI/identifier of the schema catalog to reference.

    Returns:
        The standard A2UI v1.0 JSON envelope.

    Raises:
        ValueError: If the root component variable is missing.
    """
    ctx = _CompileContext()
    # Detect if sentinel tags exist in the input
    has_sentinels = "<a2ui>" in dsl_text
    lines = []
    inside_a2ui = not has_sentinels
    for line in dsl_text.splitlines():
      trimmed = line.strip()
      if "<a2ui>" in trimmed:
        inside_a2ui = True
        line = line.replace("<a2ui>", "")
        trimmed = line.strip()
      if "</a2ui>" in trimmed:
        inside_a2ui = False
        line = line.split("</a2ui>")[0]
        if line.strip():
          lines.append(line)
        continue
      if inside_a2ui:
        lines.append(line)

    dsl_body = "\n".join(lines)

    # Use ANTLR to parse and construct the AST
    input_stream = InputStream(dsl_body)
    lexer = ExpressLexer(input_stream)
    error_listener = ExpressErrorListener()
    lexer.removeErrorListeners()
    lexer.addErrorListener(error_listener)

    token_stream = CommonTokenStream(lexer)
    parser = ExpressParser(token_stream)
    parser.removeErrorListeners()
    parser.addErrorListener(error_listener)

    try:
      tree = parser.program()
      if is_final and error_listener.errors:
        line, col, msg, is_lexer = error_listener.errors[0]
        err = SyntaxError(f"Syntax error at line {line}:{col}: {msg}")
        err._is_lexer = is_lexer
        raise err

      visitor = ExpressAstVisitor(
          first_error_line=error_listener.errors[0][0]
          if error_listener.errors
          else None
      )
      statements = visitor.visit(tree)
    except Exception as e:
      if not is_final:
        statements = []
      else:
        if isinstance(e, SyntaxError) and getattr(e, "_is_lexer", False):
          raise e
        raise ValueError(f"Failed to parse expression: {e}") from e

    raw_symbols = {}
    data_path_assignments = {}
    target_delete_surface_id = None
    standalone_function_calls = []

    for stmt in statements:
      stmt_type, *stmt_args = stmt
      if stmt_type == "ASSIGN":
        var_name, parsed_val = stmt_args
        if var_name.startswith("$"):
          data_path_assignments[var_name] = parsed_val
        else:
          raw_symbols[var_name] = parsed_val
      elif stmt_type == "EXPR":
        parsed_val = stmt_args[0]
        if isinstance(parsed_val, dict) and parsed_val.get("call") == "deleteSurface":
          args = parsed_val.get("args", [])
          if args and isinstance(args[0], str):
            target_delete_surface_id = args[0]
        elif isinstance(parsed_val, dict) and "call" in parsed_val:
          standalone_function_calls.append(parsed_val)

    # Compile data model paths
    data_model = {}
    for path_name, ast_val in data_path_assignments.items():
      compiled_val = self._compile_value(ast_val, raw_symbols, ctx)
      _set_nested_path(data_model, path_name, compiled_val)

    if target_delete_surface_id is not None:
      return {
          "version": "v1.0",
          SurfaceOperation.DELETE: {"surfaceId": target_delete_surface_id},
      }

    if standalone_function_calls:
      first_call = standalone_function_calls[0]
      ctx.inline_counter += 1
      compiled_val = self._compile_value(first_call, raw_symbols, ctx, is_action=False)
      return {
          "version": "v1.0",
          "functionCallId": f"call_{ctx.inline_counter}",
          SurfaceOperation.CALL_FUNC: {
              "call": compiled_val.get("call"),
              "args": compiled_val.get("args", {}),
          },
      }

    compiled_components = []

    # Adjacency list flattening starting at root
    if "root" not in raw_symbols:
      if data_path_assignments:
        return {
            "version": "v1.0",
            SurfaceOperation.UPDATE_DATA: {
                "surfaceId": surface_id,
                "path": "/",
                "value": data_model,
            },
        }
      raise ValueError(
          "A2UI Express source must define a 'root' variable or have data model path"
          " assignments."
      )

    for var_name, ast in raw_symbols.items():
      comp_dict = self._compile_ast_node(var_name, ast, raw_symbols, ctx)
      if comp_dict:
        compiled_components.append(comp_dict)

    compiled_components.extend(ctx.extra_components)

    # Resolve catalog ID
    if not catalog_id:
      catalog_id = self.helper.catalog.get("catalogId", "https://a2ui.org/catalog.json")

    envelope = {
        "version": "v1.0",
        SurfaceOperation.CREATE: {
            "surfaceId": surface_id,
            "catalogId": catalog_id,
            "components": compiled_components,
        },
    }
    if data_model:
      envelope[SurfaceOperation.CREATE]["dataModel"] = data_model

    return envelope

  def _compile_ast_node(
      self, var_name: str, ast: Any, raw_symbols: dict, ctx: _CompileContext
  ) -> Optional[dict]:
    """Compiles a single variable's AST node into standard component format.

    Args:
        var_name: The variable identifier (which becomes the component ID).
        ast: The parsed expression AST node.
        raw_symbols: A dictionary containing all other parsed variables.
        ctx: The active compiler execution context.

    Returns:
        The compiled component JSON dictionary, or None if it is not a component.
    """
    if not isinstance(ast, dict) or "call" not in ast:
      return None

    comp_name = ast["call"]
    args = ast["args"]

    if comp_name not in self.helper.components:
      # Not a component, could be a standalone action/helper; skip writing as component
      return None

    properties = self.helper.get_component_properties(comp_name)
    comp_dict = {"id": var_name, "component": comp_name}

    # Sibling path tracking for check rules
    sibling_value_path = None

    non_check_properties = [p for p in properties if p != "checks"]
    raw_checks = []

    # Map positional arguments
    prop_idx = 0
    for arg in args:
      if _is_check_expression(arg):
        if isinstance(arg, list):
          raw_checks.extend(arg)
        else:
          raw_checks.append(arg)
        continue

      if prop_idx < len(non_check_properties):
        prop_name = non_check_properties[prop_idx]
        prop_idx += 1

        if isinstance(arg, dict) and arg.get("skipped"):
          comp_dict[prop_name] = None
          continue

        mapped_val = self._compile_value(
            arg, raw_symbols, ctx, is_action=(prop_name in ["action", "submitAction"])
        )
        prop_schema = self.helper.get_property_schema(comp_name, prop_name)
        if prop_schema and not _schema_allows_databinding(prop_schema):

          def has_databinding(v: Any) -> bool:
            if isinstance(v, dict):
              if "call" in v or "event" in v or "functionCall" in v:
                return False
              if "path" in v and "componentId" not in v:
                return True
              return any(has_databinding(x) for x in v.values())
            if isinstance(v, list):
              return any(has_databinding(x) for x in v)
            return False

          if has_databinding(mapped_val):
            raise ValueError(
                f"Property '{prop_name}' of component '{comp_name}' does not support"
                " dynamic data bindings (paths). You must provide a static value/array"
                " instead."
            )
          if isinstance(mapped_val, list) and _schema_expects_option_objects(
              prop_schema
          ):
            mapped_val = [
                {"label": opt, "value": opt} if isinstance(opt, str) else opt
                for opt in mapped_val
            ]
        enum_vals = self.helper.get_property_enum(comp_name, prop_name)
        if enum_vals and isinstance(mapped_val, str):
          if mapped_val not in enum_vals:
            raise ValueError(
                f"Value '{mapped_val}' is not a valid enum choice for property"
                f" '{prop_name}' of component '{comp_name}'. Allowed values are:"
                f" {enum_vals}"
            )
        comp_dict[prop_name] = mapped_val

        if (
            prop_name == "value"
            and isinstance(mapped_val, dict)
            and "path" in mapped_val
        ):
          sibling_value_path = mapped_val

    # Set active path for nested check compile resolution
    ctx.active_value_path = sibling_value_path

    # Second pass: compile checks with implicit path injection
    if raw_checks:
      compiled_checks = []
      for rc in raw_checks:
        if isinstance(rc, dict) and "check" in rc:
          check_name = rc["check"]
          check_args = rc["args"]
          compiled_args = {}

          check_props = self.helper.get_function_properties(check_name)
          message_val = f"{check_name.capitalize()} check failed"

          explicit_args = list(check_args)
          is_value_injected = False

          # Handle implicit target 'value' injection
          if check_props and check_props[0] == "value":
            if (
                explicit_args
                and isinstance(explicit_args[0], dict)
                and "path" in explicit_args[0]
            ):
              pass
            else:
              if sibling_value_path:
                compiled_args["value"] = sibling_value_path
                is_value_injected = True

          start_prop_idx = 1 if is_value_injected else 0

          for c_idx, c_arg in enumerate(explicit_args):
            prop_target_idx = c_idx + start_prop_idx
            if prop_target_idx < len(check_props):
              prop_name = check_props[prop_target_idx]
              prop_schema = self.helper.get_function_property_schema(
                  check_name, prop_name
              )
              is_message = False
              if isinstance(c_arg, str) and prop_schema:
                expected_type = prop_schema.get("type")
                if expected_type in ["integer", "number", "boolean"]:
                  is_message = True

              if is_message:
                message_val = c_arg
                break

              if isinstance(c_arg, dict) and c_arg.get("skipped"):
                compiled_args[prop_name] = None
                continue
              compiled_args[prop_name] = self._compile_value(c_arg, raw_symbols, ctx)
            else:
              if isinstance(c_arg, str):
                message_val = c_arg

          compiled_checks.append({
              "condition": {"call": check_name, "args": compiled_args},
              "message": message_val,
          })
      if compiled_checks:
        comp_dict["checks"] = compiled_checks

    ctx.active_value_path = None
    return {k: v for k, v in comp_dict.items() if v is not None}

  def _compile_value(
      self, val: Any, raw_symbols: dict, ctx: _CompileContext, is_action: bool = False
  ) -> Any:
    """Compiles an individual AST node value into valid A2UI equivalents.

    Args:
        val: The parsed AST node value.
        raw_symbols: The parsed global variable symbol table.
        ctx: The active compiler execution context.
        is_action: Whether this value lies inside a component Action field.

    Returns:
        The semantically correct A2UI JSON structure.
    """
    if isinstance(val, dict):
      if "path" in val:
        return val
      if "variable" in val:
        ref_name = val["variable"]
        if ref_name in raw_symbols:
          symbol_val = raw_symbols[ref_name]
          if (
              isinstance(symbol_val, dict)
              and symbol_val.get("call") in self.helper.components
          ):
            return ref_name
          return self._compile_value(symbol_val, raw_symbols, ctx, is_action)
        return ref_name
      if "check" in val:
        check_name = val["check"]
        check_args = val.get("args", [])

        compiled_args = {}
        check_props = self.helper.get_function_properties(check_name)

        explicit_args = list(check_args)
        is_value_injected = False

        if check_props:
          if check_props[0] == "value":
            if not (
                explicit_args
                and isinstance(explicit_args[0], dict)
                and "path" in explicit_args[0]
            ):
              if ctx.active_value_path:
                compiled_args["value"] = ctx.active_value_path
                is_value_injected = True

          start_prop_idx = 1 if is_value_injected else 0
          for c_idx, c_arg in enumerate(explicit_args):
            prop_target_idx = c_idx + start_prop_idx
            if prop_target_idx < len(check_props):
              prop_name = check_props[prop_target_idx]
              prop_schema = self.helper.get_function_property_schema(
                  check_name, prop_name
              )
              is_message = False
              if isinstance(c_arg, str) and prop_schema:
                expected_type = prop_schema.get("type")
                if expected_type in ["integer", "number", "boolean"]:
                  is_message = True

              if is_message:
                break

              if isinstance(c_arg, dict) and c_arg.get("skipped"):
                continue
              compiled_args[prop_name] = self._compile_value(
                  c_arg, raw_symbols, ctx, is_action
              )

        return {"call": check_name, "args": compiled_args}
      if "call" in val:
        # Nested function call (e.g. formatString or actions)
        fn_name = val["call"]
        fn_args = val["args"]

        # Is it an inline component constructor?
        if fn_name in self.helper.components:
          ctx.inline_counter += 1
          inline_id = f"_inline_{ctx.inline_counter}"
          compiled_inline = self._compile_ast_node(inline_id, val, raw_symbols, ctx)
          if compiled_inline:
            ctx.extra_components.append(compiled_inline)
          return inline_id

        # Is it a reserved Template signature?
        if fn_name == "_template":
          if len(fn_args) < 2:
            raise ValueError(
                "_template helper requires exactly 2 arguments: path and"
                " templateComponent."
            )
          path_val = self._compile_value(fn_args[0], raw_symbols, ctx, is_action)
          if not isinstance(path_val, dict) or "path" not in path_val:
            raise ValueError(
                "The first argument to _template must be a dynamic data binding path"
                f" (prefixed by $), got: {fn_args[0]}"
            )
          comp_id_val = self._compile_value(fn_args[1], raw_symbols, ctx, is_action)
          return {"path": path_val["path"], "componentId": comp_id_val}

        # Is it a reserved Event signature?
        if fn_name == "Event":
          compiled_event_name = (
              self._compile_value(fn_args[0], raw_symbols, ctx, is_action)
              if len(fn_args) > 0
              else ""
          )
          raw_context = (
              self._compile_value(fn_args[1], raw_symbols, ctx, is_action)
              if len(fn_args) > 1
              else {}
          )
          compiled_context = {}
          if isinstance(raw_context, dict):
            compiled_context.update(raw_context)
          elif isinstance(raw_context, list):
            for item in raw_context:
              if isinstance(item, dict):
                compiled_context.update(item)
          return {"event": {"name": compiled_event_name, "context": compiled_context}}

        # Is it a regular catalog function?
        if fn_name in self.helper.functions:
          fn_props = self.helper.get_function_properties(fn_name)
          compiled_args = {}
          for idx, arg in enumerate(fn_args):
            if idx < len(fn_props):
              if isinstance(arg, dict) and arg.get("skipped"):
                continue
              val_item = self._compile_value(arg, raw_symbols, ctx, is_action)
              if val_item is not None:
                compiled_args[fn_props[idx]] = val_item

          # Wrap in functionCall only if inside an action field
          if is_action:
            return {"functionCall": {"call": fn_name, "args": compiled_args}}

          # Otherwise, compile direct dynamic function call expression
          res_expr = {"call": fn_name, "args": compiled_args}
          return res_expr

        # Fallback
        return {
            "call": fn_name,
            "args": [
                self._compile_value(a, raw_symbols, ctx, is_action) for a in fn_args
            ],
        }

      return {
          k: self._compile_value(v, raw_symbols, ctx, is_action) for k, v in val.items()
      }

    if isinstance(val, list):
      # If this is a list of elements, compile each element
      compiled_list = []
      for item in val:
        comp_item = self._compile_value(item, raw_symbols, ctx, is_action)
        compiled_list.append(comp_item)
      return compiled_list

    return val
