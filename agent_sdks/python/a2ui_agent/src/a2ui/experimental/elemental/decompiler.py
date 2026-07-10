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

"""Decompilation engine for A2UI Elemental.

Reconstructs standard A2UI v1.0 JSON envelopes back into A2UI Elemental HTML5-like markup.
"""

import html
import json
import re
from typing import Any, Dict, List, Optional, Union
from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.experimental.express.schema_helper import CatalogSchemaHelper
from a2ui.experimental.express.constants import SurfaceOperation

TAG_PREFIX = "ui-"


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


def _is_contractable_options(val: Any) -> bool:
    """Returns True if val is a list of dicts, each having only 'label' and 'value' which are equal strings."""
    if not isinstance(val, list):
        return False
    if not val:
        return False
    for item in val:
        if not isinstance(item, dict):
            return False
        if set(item.keys()) != {"label", "value"}:
            return False
        if item["label"] != item["value"]:
            return False
        if not isinstance(item["label"], str):
            return False
    return True


def _contract_options(val: list[dict]) -> list[str]:
    """Contracts a list of option dicts into a list of strings."""
    return [item["label"] for item in val]


def _is_complex(val: Any) -> bool:
    """Returns True if the value is complex (dict or list of dicts) and not an expression."""
    if isinstance(val, dict):
        if "path" in val or "event" in val or "functionCall" in val or "call" in val:
            return False
        return True
    if isinstance(val, list):
        return any(_is_complex(x) for x in val)
    return False


def _decompile_string_in_expr(val: str) -> str:
    """Formats a string literal for use inside an expression (wrapped in single quotes)."""
    escaped = val.replace("\\", "\\\\").replace("'", "\\'")
    return f"'{escaped}'"


def _is_action_ref(s: Any) -> bool:
    if isinstance(s, dict):
        if "$ref" in s and "Action" in s["$ref"]:
            return True
        for k in ["oneOf", "anyOf", "allOf"]:
            if k in s and isinstance(s[k], list):
                if any(_is_action_ref(sub) for sub in s[k]):
                    return True
    return False


def _get_action_properties(helper: CatalogSchemaHelper, comp_name: str) -> list[str]:
    """Retrieves all property names of a component that represent Actions."""
    properties = helper.get_component_properties(comp_name)
    action_props = []
    for p in properties:
        schema = helper.get_property_schema(comp_name, p)
        if schema and _is_action_ref(schema):
            action_props.append(p)
    return action_props


class ElementalDecompiler:
    """Decompiles A2UI JSON payloads back into A2UI Elemental HTML."""

    def __init__(self, catalog: Union[Catalog[Any, Any], A2uiCatalog]):
        self.helper = CatalogSchemaHelper(catalog)

    def decompile(self, envelope_json: dict) -> str:
        """Decompiles standard A2UI wire JSON into A2UI Elemental HTML."""
        # 1. Handle deleteSurface
        if SurfaceOperation.DELETE in envelope_json:
            surf_op = envelope_json[SurfaceOperation.DELETE]
            surface_id = surf_op.get("surfaceId", "")
            return f'<{TAG_PREFIX}delete-surface surface-id="{surface_id}" />'

        # 2. Handle callFunction
        if SurfaceOperation.CALL_FUNC in envelope_json:
            func_op = envelope_json[SurfaceOperation.CALL_FUNC]
            fn_name = func_op.get("call", "")
            fn_args = func_op.get("args", {})
            fc_id = envelope_json.get("functionCallId", "")
            want_response = envelope_json.get("wantResponse", False)

            attrs = []
            if fc_id:
                attrs.append(f'id="{fc_id}"')
            attrs.append(f'name="{fn_name}"')

            if isinstance(fn_args, dict):
                for k, v in fn_args.items():
                    val_str = self._format_attribute(k, v, set())
                    attrs.append(val_str)

            if want_response:
                attrs.append('want-response="{true}"')

            attrs_str = " ".join(attrs)
            return f"<{TAG_PREFIX}call-function {attrs_str} />"

        # 3. Handle updateDataModel (standalone)
        if SurfaceOperation.UPDATE_DATA in envelope_json:
            val_op = envelope_json[SurfaceOperation.UPDATE_DATA]
            surface_id = val_op.get("surfaceId", "default_surface")
            data_val = val_op.get("value", {})

            lines = [f'<body id="{surface_id}">']
            if data_val:
                json_str = json.dumps(data_val, indent=2)
                indented_json = "\n".join(
                    f"    {line}" for line in json_str.splitlines()
                )
                lines.append('  <script type="application/json">')
                lines.append(indented_json)
                lines.append("  </script>")
            lines.append("</body>")
            return "\n".join(lines)

        # 4. Handle createSurface
        if SurfaceOperation.CREATE not in envelope_json:
            raise ValueError(
                "Invalid A2UI envelope: missing createSurface, deleteSurface, etc."
            )

        create_surface = envelope_json[SurfaceOperation.CREATE]
        surface_id = create_surface.get("surfaceId", "default_surface")
        catalog_id = create_surface.get("catalogId", "")
        data_model = create_surface.get("dataModel", {})
        components = create_surface.get("components", [])

        self.id_to_component = {c["id"]: c for c in components}
        self.comp_ids = set(self.id_to_component.keys())

        # Find roots
        child_to_parent = {}
        for c in components:
            comp_name = c["component"]
            properties = self.helper.get_component_properties(comp_name)
            props_to_check = set(properties) | {"template"}
            for prop_name in props_to_check:
                if prop_name in c:
                    val = c[prop_name]
                    p_schema = self.helper.get_property_schema(comp_name, prop_name)
                    if prop_name == "template" or _is_component_reference_property(
                        p_schema
                    ):
                        if isinstance(val, list):
                            for v in val:
                                if isinstance(v, str):
                                    child_to_parent[v] = c["id"]
                        elif isinstance(val, str):
                            child_to_parent[val] = c["id"]

        roots = [c["id"] for c in components if c["id"] not in child_to_parent]

        lines = [f'<body id="{surface_id}">']
        default_catalog_id = self.helper.catalog.get("catalogId", "")
        if catalog_id and catalog_id != default_catalog_id:
            lines.append(f'  <link rel="catalog" href="{catalog_id}">')

        if data_model:
            json_str = json.dumps(data_model, indent=2)
            indented_json = "\n".join(f"    {line}" for line in json_str.splitlines())
            lines.append('  <script type="application/json">')
            lines.append(indented_json)
            lines.append("  </script>")

        for root_id in roots:
            lines.append(self._render_component(root_id, indent=1))

        lines.append("</body>")
        return "\n".join(lines)

    def _render_component(
        self, comp_id: str, indent: int = 0, slot: Optional[str] = None
    ) -> str:
        C = self.id_to_component.get(comp_id)
        if not C:
            return f'{"  " * indent}<!-- Missing component {comp_id} -->'

        comp_name = C["component"]
        tag_name = f"{TAG_PREFIX}{re.sub(r'(?<!^)(?=[A-Z])', '-', comp_name).lower()}"

        properties = self.helper.get_component_properties(comp_name)

        default_slot = None
        if "children" in properties:
            default_slot = "children"
        elif "child" in properties:
            default_slot = "child"

        attrs = [f'id="{comp_id}"']
        if slot:
            attrs.append(f'slot="{slot}"')

        child_elements = []

        # Collect all properties to process
        all_props = list(properties)
        for k in C.keys():
            if k not in ["id", "component"] and k not in all_props:
                all_props.append(k)

        has_text_content = False
        text_content = ""

        for prop_name in all_props:
            if prop_name not in C:
                continue

            val = C[prop_name]

            if prop_name == "options" and _is_contractable_options(val):
                val = _contract_options(val)

            p_schema = self.helper.get_property_schema(comp_name, prop_name)
            is_ref = (
                _is_component_reference_property(p_schema) or prop_name == "template"
            )

            if is_ref:
                if prop_name == "template":
                    template_children = []
                    if isinstance(val, list):
                        for t_id in val:
                            template_children.append(
                                self._render_component(t_id, indent + 2)
                            )
                    elif isinstance(val, str):
                        template_children.append(
                            self._render_component(val, indent + 2)
                        )

                    if template_children:
                        template_str = "\n".join(template_children)
                        child_elements.append(
                            f'{"  " * (indent + 1)}<template>\n{template_str}\n{"  " * (indent + 1)}</template>'
                        )
                elif prop_name == default_slot:
                    if isinstance(val, list):
                        for c_id in val:
                            child_elements.append(
                                self._render_component(c_id, indent + 1)
                            )
                    elif isinstance(val, str):
                        child_elements.append(self._render_component(val, indent + 1))
                    elif (
                        isinstance(val, dict) and "path" in val and "componentId" in val
                    ):
                        # Render template binding as parent 'path' attribute and nested <template>
                        path_val = {"path": val["path"]}
                        attrs.append(
                            self._format_attribute("path", path_val, self.comp_ids)
                        )
                        template_child_html = self._render_component(
                            val["componentId"], indent + 2
                        )
                        child_elements.append(
                            f'{"  " * (indent + 1)}<template>\n{template_child_html}\n{"  " * (indent + 1)}</template>'
                        )
                else:
                    if isinstance(val, list):
                        for c_id in val:
                            child_elements.append(
                                self._render_component(c_id, indent + 1, slot=prop_name)
                            )
                    elif isinstance(val, str):
                        child_elements.append(
                            self._render_component(val, indent + 1, slot=prop_name)
                        )
            else:
                if prop_name == "checks":
                    attr_str = self._format_checks(val, C, self.comp_ids)
                    if attr_str:
                        attrs.append(attr_str)
                elif _is_complex(val):
                    json_str = json.dumps(val, indent=2)
                    indented_json = "\n".join(
                        f'{"  " * (indent + 2)}{line}' for line in json_str.splitlines()
                    )
                    child_elements.append(
                        f'{"  " * (indent + 1)}<script type="application/json"'
                        f' slot="{prop_name}">\n{indented_json}\n{"  " * (indent + 1)}</script>'
                    )
                else:
                    attrs.append(
                        self._format_attribute(prop_name, val, self.comp_ids, comp_name)
                    )

        attrs_str = " ".join(attrs)
        start_tag = f"<{tag_name} {attrs_str}" if attrs else f"<{tag_name}"

        if not child_elements and not text_content:
            return f'{"  " * indent}{start_tag} />'

        if text_content and not child_elements:
            return f'{"  " * indent}{start_tag}>{text_content}</{tag_name}>'

        result = [f'{"  " * indent}{start_tag}>']
        if text_content:
            result.append(f'{"  " * (indent + 1)}{text_content}')
        for child in child_elements:
            result.append(child)
        result.append(f'{"  " * indent}</{tag_name}>')
        return "\n".join(result)

    def _format_attribute(
        self, name: str, val: Any, comp_ids: set[str], comp_name: Optional[str] = None
    ) -> str:
        kebab_name = re.sub(r"(?<!^)(?=[A-Z])", "-", name).lower()

        if comp_name:
            action_props = _get_action_properties(self.helper, comp_name)
            if name in action_props:
                if len(action_props) == 1:
                    kebab_name = "onclick"
                else:
                    kebab_name = f"on-{kebab_name}"

        if isinstance(val, str):
            escaped = html.escape(val, quote=True)
            return f'{kebab_name}="{escaped}"'

        if isinstance(val, dict):
            if (
                "path" in val
                or "event" in val
                or "functionCall" in val
                or "call" in val
            ):
                decompiled = self._decompile_value_internal(val, comp_ids)
                return f'{kebab_name}="{{{decompiled}}}"'
            else:
                decompiled = self._decompile_value_internal(val, comp_ids)
                return f'{kebab_name}="{{{decompiled}}}"'

        if isinstance(val, list):
            decompiled = self._decompile_value_internal(val, comp_ids)
            return f'{kebab_name}="{{{decompiled}}}"'

        if isinstance(val, bool):
            bool_str = "true" if val else "false"
            return f'{kebab_name}="{{{bool_str}}}"'

        if val is None:
            return f'{kebab_name}="{{null}}"'

        return f'{kebab_name}="{{{val}}}"'

    def _format_checks(
        self, checks_val: list, C: dict, comp_ids: set[str]
    ) -> Optional[str]:
        if not checks_val:
            return None

        checks_list = []
        parent_value = C.get("value")

        for check in checks_val:
            if not isinstance(check, dict):
                continue
            if "condition" in check:
                call_dict = check["condition"]
            else:
                call_dict = check

            name = call_dict.get("call")
            args = call_dict.get("args", {})

            fn_props = self.helper.get_function_properties(name)
            if isinstance(args, dict):
                refined_args = dict(args)
            else:
                refined_args = {}
                for idx, v in enumerate(args):
                    if idx < len(fn_props):
                        refined_args[fn_props[idx]] = v
                    else:
                        refined_args[f"arg{idx}"] = v

            if (
                isinstance(check, dict)
                and "message" in check
                and check["message"] != "Invalid input"
            ):
                refined_args["message"] = check["message"]
            if fn_props and fn_props[0] == "value" and "value" in refined_args:
                if parent_value and refined_args["value"] == parent_value:
                    del refined_args["value"]

            call_str = self._decompile_function_call(name, refined_args, comp_ids)
            checks_list.append(call_str)

        if not checks_list:
            return None

        calls_combined = ", ".join(checks_list)
        return f'checks="{{[{calls_combined}]}}"'

    def _decompile_value_internal(self, val: Any, comp_ids: set[str]) -> str:
        if isinstance(val, dict):
            if "path" in val:
                path_str = val["path"]
                if path_str.startswith("/"):
                    return f"$/{path_str[1:]}"
                return f"${path_str}"

            if "event" in val:
                evt = val["event"]
                name = evt.get("name", "")
                ctx = evt.get("context", {})
                ctx_reprs = []
                for k, v in ctx.items():
                    k_repr = (
                        k
                        if re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", k)
                        else _decompile_string_in_expr(k)
                    )
                    ctx_reprs.append(
                        f"{k_repr}: {self._decompile_value_internal(v, comp_ids)}"
                    )
                if ctx_reprs:
                    return f"Event('{name}', {{{', '.join(ctx_reprs)}}})"
                return f"Event('{name}')"

            if "functionCall" in val:
                fn = val["functionCall"]
                name = fn["call"]
                args = fn.get("args", {})
                return self._decompile_function_call(name, args, comp_ids)

            if "call" in val:
                name = val["call"]
                args = val.get("args", {})
                return self._decompile_function_call(name, args, comp_ids)

            items_reprs = []
            for k, v in val.items():
                k_repr = (
                    k
                    if re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", k)
                    else _decompile_string_in_expr(k)
                )
                items_reprs.append(
                    f"{k_repr}: {self._decompile_value_internal(v, comp_ids)}"
                )
            return f"{{{', '.join(items_reprs)}}}"

        if isinstance(val, list):
            list_reprs = [
                self._decompile_value_internal(item, comp_ids) for item in val
            ]
            return f"[{', '.join(list_reprs)}]"

        if isinstance(val, str):
            return _decompile_string_in_expr(val)

        if isinstance(val, bool):
            return "true" if val else "false"

        if val is None:
            return "null"

        return str(val)

    def _decompile_function_call(self, name: str, args: Any, comp_ids: set[str]) -> str:
        fn_props = self.helper.get_function_properties(name)
        args_list = []

        if isinstance(args, dict):
            for p in fn_props:
                if p in args:
                    val_str = self._decompile_value_internal(args[p], comp_ids)
                    args_list.append(f"{p}: {val_str}")
            for p, v in args.items():
                if p not in fn_props:
                    val_str = self._decompile_value_internal(v, comp_ids)
                    args_list.append(f"{p}: {val_str}")
        elif isinstance(args, list):
            for idx, v in enumerate(args):
                val_str = self._decompile_value_internal(v, comp_ids)
                if idx < len(fn_props):
                    args_list.append(f"{fn_props[idx]}: {val_str}")
                else:
                    args_list.append(f"arg{idx}: {val_str}")

        return f"{name}({', '.join(args_list)})"
