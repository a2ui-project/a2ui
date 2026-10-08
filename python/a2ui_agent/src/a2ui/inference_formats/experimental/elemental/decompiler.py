# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Decompilation engine for A2UI Elemental.

Reconstructs A2UI message envelopes back into A2UI Elemental HTML5-like markup.
"""

from collections.abc import Sequence
import html
import json
import re
from typing import Any, Literal

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats._shared import (
    CatalogSchemaHelper,
    build_catalog_helpers,
    catalogs_defining,
    check_dsl_catalogs,
    coalesce_surface_messages,
)
from a2ui.inference_formats.experimental.express.constants import SurfaceOperation
from a2ui.schema.constants import A2UI_INFERENCE_CLOSE_TAG, A2UI_INFERENCE_OPEN_TAG

from .compiler import TAG_PREFIX, UPDATE_ATTR


def _is_component_reference_property(prop_schema: Any) -> bool:
    """Checks if a property schema defines a component reference (ComponentId or list of ComponentId)."""
    if not isinstance(prop_schema, dict):
        return False
    if "$ref" in prop_schema:
        ref = prop_schema["$ref"]
        if "ComponentId" in ref or "Child" in ref or "ChildList" in ref:
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
        if (
            "path" in val
            or "@path" in val
            or "event" in val
            or "functionCall" in val
            or "call" in val
            or "@call" in val
        ):
            return False
        return True
    if isinstance(val, list):
        return any(_is_complex(x) for x in val)
    return False


def _escape_attr(val: Any) -> str:
    """Escapes a value for a double-quoted HTML attribute.

    The compiler's HTML parser unescapes attribute values, so any string,
    including one with quotes, `&` or `<`, reads back unchanged. Single quotes
    are kept as they are, so expressions stay readable.
    """
    return html.escape(str(val), quote=False).replace('"', "&quot;")


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
    """Decompiles A2UI JSON payloads back into A2UI Elemental HTML.

    The output follows the compiler's catalog rules. With a single catalog, no
    catalog is ever written. With several catalogs, no `<link rel="catalog">`
    is written, and a component or function call gets a `catalog-id` attribute
    or `catalogId` argument only when looking its name up across the catalogs
    would not find its catalog. A component's or call's catalog is its own
    `catalogId`, else the `catalogId` of its surface's `createSurface`, else
    the one catalog that defines its name. An `updateComponents` or
    `updateDataModel` that updates an existing surface is rendered as a
    `<body update>` block.
    """

    def __init__(self, catalogs: Sequence[CatalogApi]):
        """Initializes the decompiler.

        Args:
            catalogs: The catalogs that the payload's catalog IDs refer to.
                Several catalogs need A2UI v1.0 or later.

        Raises:
            A2uiCatalogError: If no catalog is given, two catalogs share an ID,
                the catalogs target different protocol versions, or there are
                several catalogs before v1.0.
        """
        self._catalogs = check_dsl_catalogs(catalogs)
        self.helpers = build_catalog_helpers(self._catalogs)
        self._multi = len(self._catalogs) > 1
        # The catalog that a component or call without a `catalogId` comes
        # from in the message being decompiled: the surface's `createSurface`
        # catalog, or the single catalog. None when neither is known, so each
        # name is looked up across the catalogs.
        self._context_catalog_id: str | None = None
        self.id_to_component: dict[str, dict[str, Any]] = {}
        self.comp_ids: set[str] = set()

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs, in the order the decompiler received them."""
        return list(self._catalogs)

    def _resolve_helper(self, catalog_id: str) -> CatalogSchemaHelper:
        """Returns the helper for a catalog ID.

        Raises:
            ValueError: If `catalog_id` names no configured catalog.
        """
        if catalog_id in self.helpers:
            return self.helpers[catalog_id]
        raise ValueError(
            f"Unknown catalogId '{catalog_id}'. Available catalogs: "
            f"{list(self.helpers.keys())}"
        )

    def _set_context_catalog(self, catalog_id: str | None) -> None:
        """Sets the catalog of un-annotated components and calls in a message.

        Args:
            catalog_id: The surface's `createSurface` catalog, if known.

        Raises:
            ValueError: If `catalog_id` names no configured catalog.
        """
        if catalog_id:
            self._resolve_helper(catalog_id)
            self._context_catalog_id = catalog_id
        elif self._multi:
            self._context_catalog_id = None
        else:
            self._context_catalog_id = self._catalogs[0].catalog_id

    def _actual_catalog_id(
        self,
        kind: Literal["component", "function"],
        name: str,
        own_catalog_id: str | None,
    ) -> str:
        """Returns the catalog that a component or function call comes from.

        Raises:
            ValueError: If `own_catalog_id` names no configured catalog, or the
                catalog is not known and no catalog or several catalogs define
                `name`.
        """
        if own_catalog_id:
            self._resolve_helper(own_catalog_id)
            return own_catalog_id
        if self._context_catalog_id:
            return self._context_catalog_id
        matches = catalogs_defining(self.helpers, kind, name)
        if len(matches) == 1:
            return matches[0]
        found = (
            f"catalogs {matches} all define it" if matches else "no catalog defines it"
        )
        raise ValueError(
            f"Cannot tell which catalog the {kind} '{name}' comes from: it has no"
            f" catalogId, its surface names no catalog, and {found}."
        )

    def _catalog_annotation(
        self, kind: Literal["component", "function"], name: str, actual: str
    ) -> str | None:
        """Returns the catalog to write on an element or call, if any.

        A catalog is written only with several catalogs, and only when looking
        the name up across them would not find `actual`.
        """
        if not self._multi:
            return None
        if catalogs_defining(self.helpers, kind, name) == [actual]:
            return None
        return actual

    def _component_helper(self, comp: dict[str, Any]) -> CatalogSchemaHelper:
        return self.helpers[
            self._actual_catalog_id(
                "component", comp["component"], comp.get("catalogId")
            )
        ]

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        wrapped_blocks = [
            f"{A2UI_INFERENCE_OPEN_TAG}\n{b}\n{A2UI_INFERENCE_CLOSE_TAG}"
            for b in blocks
        ]
        full_html = "\n\n".join(wrapped_blocks)
        triple_backticks = chr(96) * 3
        return f"{triple_backticks}html\n{full_html}\n{triple_backticks}"

    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        """Decompiles structured A2UI payload messages into A2UI Elemental HTML.

        Raises:
            ValueError: If a message is not a known operation or names an
                unknown catalog.
        """
        return "\n\n".join(self.decompile_blocks(a2ui_payload))

    def decompile_blocks(
        self, a2ui_payload: Sequence[AgentToRendererMessage]
    ) -> list[str]:
        """Decompiles a payload into one Elemental block per coalesced message.

        The payload is coalesced as a whole, so an update keeps the catalog of
        the surface that an earlier message in the payload created.

        Raises:
            ValueError: If a message is not a known operation or names an
                unknown catalog.
        """
        return [
            self._decompile_message_dict(
                item.message,
                surface_catalog_id=item.surface_catalog_id,
                is_update=item.is_update,
            )
            for item in coalesce_surface_messages(a2ui_payload)
            if item.message
        ]

    def _decompile_message_dict(
        self,
        envelope_json: dict[str, Any],
        surface_catalog_id: str | None = None,
        is_update: bool = False,
    ) -> str:
        # 1. Handle deleteSurface
        if SurfaceOperation.DELETE in envelope_json:
            surf_op = envelope_json[SurfaceOperation.DELETE]
            surface_id = surf_op.get("surfaceId", "")
            return (
                f"<{TAG_PREFIX}delete-surface"
                f' surface-id="{_escape_attr(surface_id)}" />'
            )

        # 2. Handle callFunction / callRendererFunction
        if (
            "callRendererFunction" in envelope_json
            or SurfaceOperation.CALL_FUNC in envelope_json
        ):
            return self._decompile_call_function(envelope_json)

        # 3. Handle updateDataModel
        if SurfaceOperation.UPDATE_DATA in envelope_json:
            return self._decompile_update_data(
                envelope_json[SurfaceOperation.UPDATE_DATA]
            )

        # 4. Handle createSurface / updateComponents
        if SurfaceOperation.CREATE in envelope_json:
            body = envelope_json[SurfaceOperation.CREATE]
            self._set_context_catalog(body.get("catalogId") or surface_catalog_id)
        elif SurfaceOperation.UPDATE_COMPONENTS in envelope_json:
            body = envelope_json[SurfaceOperation.UPDATE_COMPONENTS]
            self._set_context_catalog(surface_catalog_id)
            is_update = True
        else:
            raise ValueError(
                "Invalid A2UI envelope: missing createSurface, deleteSurface, etc."
            )

        surface_id = body.get("surfaceId", "default_surface")
        data_model = body.get("dataModel", {})
        components = body.get("components", [])
        return self._render_surface(surface_id, components, data_model, is_update)

    def _decompile_call_function(self, envelope_json: dict[str, Any]) -> str:
        crf = envelope_json.get("callRendererFunction")
        if isinstance(crf, dict) and "callFunction" in crf:
            func_op = crf["callFunction"]
            fc_id = crf.get("functionCallId", "")
        else:
            func_op = envelope_json.get(SurfaceOperation.CALL_FUNC, {})
            fc_id = envelope_json.get("functionCallId", "")
        fn_name = func_op.get("@call") or func_op.get("call", "")
        fn_args = func_op.get("args", {})
        # A standalone call has no surface: the call and the calls nested in
        # its arguments come from the catalogs they name, or else from the one
        # catalog that defines them.
        self._set_context_catalog(None)
        fn_catalog_id = self._actual_catalog_id(
            "function", fn_name, func_op.get("catalogId")
        )
        annotation = self._catalog_annotation("function", fn_name, fn_catalog_id)

        attrs = []
        if fc_id:
            attrs.append(f'id="{_escape_attr(fc_id)}"')
        attrs.append(f'name="{_escape_attr(fn_name)}"')
        if annotation:
            attrs.append(f'catalog-id="{_escape_attr(annotation)}"')

        if isinstance(fn_args, dict):
            for k, v in fn_args.items():
                attrs.append(self._format_attribute(k, v, set()))

        attrs_str = " ".join(attrs)
        return f"<{TAG_PREFIX}call-function {attrs_str} />"

    def _decompile_update_data(self, val_op: dict[str, Any]) -> str:
        surface_id = val_op.get("surfaceId", "default_surface")
        path = val_op.get("path")
        data_val = val_op.get("value")

        json_str = json.dumps(data_val, indent=2)
        indented_json = "\n".join(f"    {line}" for line in json_str.splitlines())
        path_attr = "" if path in (None, "", "/") else f' path="{_escape_attr(path)}"'
        return "\n".join([
            f'<body id="{_escape_attr(surface_id)}" {UPDATE_ATTR}>',
            f'  <script type="application/json"{path_attr}>',
            indented_json,
            "  </script>",
            "</body>",
        ])

    def _render_surface(
        self,
        surface_id: str,
        components: list[dict[str, Any]],
        data_model: dict[str, Any],
        is_update: bool,
    ) -> str:
        self.id_to_component = {c["id"]: c for c in components}
        self.comp_ids = set(self.id_to_component.keys())

        # Find roots
        child_to_parent = {}
        for c in components:
            comp_name = c["component"]
            comp_helper = self._component_helper(c)
            properties = comp_helper.get_component_properties(comp_name)
            props_to_check = set(properties) | {"template"}
            for prop_name in props_to_check:
                if prop_name in c:
                    val = c[prop_name]
                    p_schema = comp_helper.get_property_schema(comp_name, prop_name)
                    if prop_name == "template" or _is_component_reference_property(
                        p_schema
                    ):
                        if isinstance(val, list):
                            for v in val:
                                if isinstance(v, str):
                                    child_to_parent[v] = c["id"]
                        elif isinstance(val, str):
                            child_to_parent[val] = c["id"]
                        elif isinstance(val, dict) and isinstance(
                            val.get("componentId"), str
                        ):
                            child_to_parent[val["componentId"]] = c["id"]

        roots = [c["id"] for c in components if c["id"] not in child_to_parent]

        update_attr = f" {UPDATE_ATTR}" if is_update else ""
        lines = [f'<body id="{_escape_attr(surface_id)}"{update_attr}>']

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
        self,
        comp_id: str,
        indent: int = 0,
        slot: str | None = None,
    ) -> str:
        C = self.id_to_component.get(comp_id)
        if not C:
            safe_id = str(comp_id).replace("--", "- -")
            return f'{"  " * indent}<!-- Missing component {safe_id} -->'

        comp_name = C["component"]
        comp_catalog_id = self._actual_catalog_id(
            "component", comp_name, C.get("catalogId")
        )
        comp_helper = self.helpers[comp_catalog_id]
        annotation = self._catalog_annotation("component", comp_name, comp_catalog_id)

        tag_name = f"{TAG_PREFIX}{re.sub(r'(?<!^)(?=[A-Z])', '-', comp_name).lower()}"

        properties = comp_helper.get_component_properties(comp_name)

        default_slot = None
        if "children" in properties:
            default_slot = "children"
        elif "child" in properties:
            default_slot = "child"

        attrs = [f'id="{_escape_attr(comp_id)}"']
        if annotation:
            attrs.append(f'catalog-id="{_escape_attr(annotation)}"')
        if slot:
            attrs.append(f'slot="{_escape_attr(slot)}"')

        child_elements = []

        # Collect all properties to process
        all_props = list(properties)
        for k in C.keys():
            if k not in ["id", "component", "catalogId"] and k not in all_props:
                all_props.append(k)

        text_content = ""

        for prop_name in all_props:
            if prop_name not in C:
                continue

            val = C[prop_name]

            if prop_name == "options" and _is_contractable_options(val):
                val = _contract_options(val)

            p_schema = comp_helper.get_property_schema(comp_name, prop_name)
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
                        isinstance(val, dict)
                        and ("path" in val or "@path" in val)
                        and "componentId" in val
                    ):
                        # Render template binding as parent 'path' attribute and nested <template>
                        path_val = {"path": val.get("@path") or val["path"]}
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
                        self._format_attribute(
                            prop_name,
                            val,
                            self.comp_ids,
                            comp_name,
                            helper=comp_helper,
                        )
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
        self,
        name: str,
        val: Any,
        comp_ids: set[str],
        comp_name: str | None = None,
        helper: CatalogSchemaHelper | None = None,
    ) -> str:
        """Formats one attribute.

        Args:
            name: The property or argument name.
            val: The value.
            comp_ids: The component IDs of the surface.
            comp_name: The component the attribute belongs to, if any.
            helper: The helper of the component's catalog, used with
                `comp_name` to name its action properties.
        """
        kebab_name = re.sub(r"(?<!^)(?=[A-Z])", "-", name).lower()

        if comp_name and helper:
            action_props = _get_action_properties(helper, comp_name)
            if name in action_props:
                if len(action_props) == 1:
                    kebab_name = "onclick"
                else:
                    if not kebab_name.startswith("on-"):
                        kebab_name = f"on-{kebab_name}"

        if isinstance(val, str):
            return f'{kebab_name}="{_escape_attr(val)}"'

        if isinstance(val, (dict, list)):
            decompiled = self._decompile_value_internal(val, comp_ids)
            return f'{kebab_name}="{{{_escape_attr(decompiled)}}}"'

        if isinstance(val, bool):
            bool_str = "true" if val else "false"
            return f'{kebab_name}="{{{bool_str}}}"'

        if val is None:
            return f'{kebab_name}="{{null}}"'

        return f'{kebab_name}="{{{val}}}"'

    def _format_checks(
        self,
        checks_val: list,
        C: dict,
        comp_ids: set[str],
    ) -> str | None:
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

            name = call_dict.get("@call") or call_dict.get("call")
            args = call_dict.get("args", {})
            fn_catalog_id = call_dict.get("catalogId")
            fn_helper = self.helpers[
                self._actual_catalog_id("function", name, fn_catalog_id)
            ]

            fn_props = fn_helper.get_function_properties(name)
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

            call_str = self._decompile_function_call(
                name,
                refined_args,
                comp_ids,
                catalog_id=fn_catalog_id,
            )
            checks_list.append(call_str)

        if not checks_list:
            return None

        calls_combined = ", ".join(checks_list)
        return f'checks="{{[{_escape_attr(calls_combined)}]}}"'

    def _decompile_value_internal(self, val: Any, comp_ids: set[str]) -> str:
        if isinstance(val, dict):
            if "path" in val or "@path" in val:
                path_str = str(val.get("@path") or val.get("path", ""))
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
                name_repr = _decompile_string_in_expr(str(name))
                if ctx_reprs:
                    return f"Event({name_repr}, {{{', '.join(ctx_reprs)}}})"
                return f"Event({name_repr})"

            if "functionCall" in val:
                fn = val["functionCall"]
                return self._decompile_function_call(
                    fn.get("@call") or fn["call"],
                    fn.get("args", {}),
                    comp_ids,
                    catalog_id=fn.get("catalogId"),
                )

            if "call" in val or "@call" in val:
                return self._decompile_function_call(
                    val.get("@call") or val["call"],
                    val.get("args", {}),
                    comp_ids,
                    catalog_id=val.get("catalogId"),
                )

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

    def _decompile_function_call(
        self,
        name: str,
        args: Any,
        comp_ids: set[str],
        catalog_id: str | None = None,
    ) -> str:
        """Renders a function call expression.

        Args:
            name: The function name.
            args: The call's arguments.
            comp_ids: The component IDs of the surface.
            catalog_id: The call's own `catalogId`, if it has one.

        The `catalogId` argument is written only when the compiler would not
        find the call's catalog by its name (see `_catalog_annotation`).
        """
        actual = self._actual_catalog_id("function", name, catalog_id)
        fn_helper = self.helpers[actual]
        fn_props = fn_helper.get_function_properties(name)
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

        annotation = self._catalog_annotation("function", name, actual)
        if annotation:
            args_list.append(f"catalogId: {_decompile_string_in_expr(annotation)}")

        return f"{name}({', '.join(args_list)})"
