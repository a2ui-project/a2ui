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

"""Catalog-agnostic prompt compiler for A2UI A2UI XML."""

from __future__ import annotations

from collections.abc import Sequence
import json
import re
from typing import Any, Literal

from a2ui.core import CatalogApi
from a2ui.core.common import is_at_least_version, to_protocol_version
from a2ui.core.schema import AgentToRendererMessage, ProtocolVersion
from a2ui.inference_formats._shared import (
    CatalogSchemaHelper,
    build_catalog_helpers,
    catalogs_defining,
    catalogs_protocol_version,
    check_mixed_catalogs,
    normalize_prompt_example_messages,
    surface_catalog_id,
    to_message_dicts,
)
from a2ui.prompt import PromptGenerator
from a2ui.utils import validate_payload

from .compiler import _get_effective_prop_kind, _schema_ref_kind
from .decompiler import A2uiXmlDecompiler
from .expressions import schema_allows_databinding

_EXAMPLE_MESSAGE_KEYS = (
    "createSurface",
    "updateComponents",
    "updateDataModel",
    "deleteSurface",
    "callFunction",
    "callRendererFunction",
)


def _describe_nested_schema(
    helper: CatalogSchemaHelper,
    schema: Any,
    *,
    depth: int,
    max_depth: int = 3,
) -> str:
    """Formats a nested `<Item>` or object field schema up to ``max_depth``."""
    if not isinstance(schema, dict):
        return "any"

    rk = _schema_ref_kind(schema)
    if rk is not None:
        return rk

    enum_vals = schema.get("enum") if isinstance(schema.get("enum"), list) else None
    if not enum_vals:
        for comb in ("oneOf", "anyOf", "allOf"):
            subs = schema.get(comb)
            if isinstance(subs, list):
                for sub in subs:
                    if isinstance(sub, dict) and isinstance(sub.get("enum"), list):
                        enum_vals = sub["enum"]
                        break
            if enum_vals:
                break
    if enum_vals:
        joined = "|".join(f'"{v}"' for v in enum_vals[:8])
        if len(enum_vals) > 8:
            joined += "|..."
        return joined

    ref = schema.get("$ref")
    if isinstance(ref, str):
        tail = ref.rsplit("/", 1)[-1]
        if tail in ("DynamicString",):
            return "string"
        if tail in ("DynamicNumber",):
            return "number"
        if tail in ("DynamicBoolean",):
            return "boolean"
        if tail == "DataBinding":
            return "$path"
        if tail == "FunctionCall":
            return "$fn"
        if tail == "DynamicValue":
            return "any"
        if tail == "DynamicStringList":
            return "string[]"

    props = schema.get("properties")
    if isinstance(props, dict) and "path" not in props:
        if depth >= max_depth or not props:
            return "object"
        reqs = set(schema.get("required") or [])
        fields: list[str] = []
        for k, v in props.items():
            mark = "" if k in reqs else "?"
            sub_t = _describe_nested_schema(
                helper, v, depth=depth + 1, max_depth=max_depth
            )
            fields.append(f"{k}{mark}: {sub_t}")
        return "{" + ", ".join(fields) + "}"

    s_type = schema.get("type")
    if s_type == "array":
        if depth >= max_depth:
            return "array"
        item_s = helper.resolve_item_schema(schema)
        if isinstance(item_s, dict):
            inner_t = _describe_nested_schema(
                helper, item_s, depth=depth + 1, max_depth=max_depth
            )
            return f"{inner_t}[]"
        return "array"

    if isinstance(s_type, str):
        if depth == 1 and s_type in ("string", "number", "integer", "boolean"):
            if not schema_allows_databinding(schema):
                return f"{s_type} (static)"
        return s_type

    for comb in ("oneOf", "anyOf", "allOf"):
        subs = schema.get(comb)
        if isinstance(subs, list):
            parts: list[str] = []
            for sub in subs:
                t = _describe_nested_schema(
                    helper, sub, depth=depth, max_depth=max_depth
                )
                if t and t not in ("any", "$path", "$fn") and t not in parts:
                    parts.append(t)
            if parts:
                return "|".join(parts)
    return "string"


def _describe_prop_type(
    helper: CatalogSchemaHelper,
    comp_name: str,
    prop_name: str,
    prop_schema: Any,
    *,
    is_top: bool = True,
    tuned: bool = False,
) -> str:
    """Formats a concise A2UI XML property type annotation from a JSON schema."""
    if prop_name == "checks":
        return "Check[]"
    if not isinstance(prop_schema, dict):
        return "any"

    enum_vals = (
        helper.get_property_enum(comp_name, prop_name)
        if is_top
        else (
            prop_schema.get("enum")
            if isinstance(prop_schema.get("enum"), list)
            else None
        )
    )
    if enum_vals:
        enum_str = " / ".join(f'"{v}"' for v in enum_vals[:12])
        if len(enum_vals) > 12:
            enum_str += f" / ... ({len(enum_vals)} values)"
        return (
            f"{enum_str}"
            if schema_allows_databinding(prop_schema)
            else f"{enum_str} (static)"
        )

    ref = prop_schema.get("$ref")
    if isinstance(ref, str):
        tail = ref.rsplit("/", 1)[-1]
        if tail in ("Child", "ComponentId"):
            return "Child"
        if tail == "ChildList":
            return "ChildList"
        if tail == "Action":
            return "Action"
        if tail == "DataBinding":
            return "$path"
        if tail == "FunctionCall":
            return "$fn"
        if tail == "DynamicValue":
            return "any / $path / $fn"
        if tail == "DynamicString":
            return "string / $path / $fn"
        if tail == "DynamicNumber":
            return "number / $path / $fn"
        if tail == "DynamicBoolean":
            return "boolean / $path / $fn"
        if tail == "DynamicStringList":
            return "string[] (fence) / $path"
        if tail == "Weight":
            return "number (static)"

    s_type = prop_schema.get("type")
    if s_type == "string":
        return (
            "string / $path"
            if schema_allows_databinding(prop_schema)
            else "string (static)"
        )
    if s_type in ("number", "integer"):
        base = str(s_type)
        return (
            f"{base} / $path"
            if schema_allows_databinding(prop_schema)
            else f"{base} (static)"
        )
    if s_type == "boolean":
        return (
            "boolean / $path"
            if schema_allows_databinding(prop_schema)
            else "boolean (static)"
        )
    if s_type == "array":
        item_schema = helper.resolve_item_schema(prop_schema)
        if isinstance(item_schema, dict) and isinstance(
            item_schema.get("properties"), dict
        ):
            sub_parts = []
            reqs = set(item_schema.get("required", []))
            for k, v in item_schema["properties"].items():
                mark = "" if k in reqs else "?"
                if tuned:
                    sub_desc = _describe_nested_schema(helper, v, depth=1, max_depth=3)
                    sub_parts.append(f"{k}{mark}: {sub_desc}")
                else:
                    rk = _schema_ref_kind(v)
                    sub_parts.append(f"{k}{mark}: {rk or v.get('type', 'string')}")
            return f"<Item {{{', '.join(sub_parts)}}}>"
        return "array (```json fence)"
    if s_type == "object":
        if tuned and isinstance(prop_schema.get("properties"), dict):
            shape = _describe_nested_schema(helper, prop_schema, depth=1, max_depth=3)
            return f"{shape} (```json fence)"
        return "object (```json fence)"

    for key in ("oneOf", "anyOf", "allOf"):
        subs = prop_schema.get(key)
        if isinstance(subs, list):
            parts = []
            for sub in subs:
                t = _describe_prop_type(
                    helper, comp_name, prop_name, sub, is_top=False, tuned=tuned
                )
                if t and t != "any" and t not in parts:
                    parts.append(t)
            if parts:
                return " / ".join(parts)
    return "any"


def _compact_description(desc: str | None) -> str:
    """Compresses multi-line schema descriptions for pipe-table cells."""
    if not desc:
        return ""
    one_line = " ".join(
        line.strip() for line in desc.strip().splitlines() if line.strip()
    )
    return one_line.replace("|", "\\|")


class A2uiXmlPromptGenerator(PromptGenerator):
    """Generates A2UI XML Six-Laws rules and compact catalog tables for A2UI."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
        allowed_messages: Sequence[str] | None = None,
        *,
        surface_id: str = "main",
        version: str | None = None,
        tuned: bool = False,
    ):
        checked = check_mixed_catalogs(catalogs)
        self._catalogs = list(checked)
        self._examples = (
            [list(turn) for turn in examples] if examples is not None else None
        )
        self._allowed_messages = (
            list(allowed_messages) if allowed_messages is not None else None
        )
        self._surface_id = surface_id
        self._tuned = tuned
        cat_ver = catalogs_protocol_version(self._catalogs)
        self._version = (
            to_protocol_version(version).value if version is not None else cat_ver
        )
        self._v1 = is_at_least_version(self._version, ProtocolVersion.V1_0)
        self.helpers: dict[str, CatalogSchemaHelper] = build_catalog_helpers(
            self._catalogs
        )
        self._decompiler = A2uiXmlDecompiler(
            self._catalogs, default_surface_id=surface_id
        )

    @property
    def catalogs(self) -> list[CatalogApi]:
        """Returns a copy of the configured catalogs."""
        return list(self._catalogs)

    @property
    def tuned(self) -> bool:
        """Returns whether tuned A2UI XML prompt enhancements are enabled."""
        return self._tuned

    def _build_tuned_micro_anchor(self) -> str:
        """Synthesizes a compact 4-line anti-JSX & `<Item>` checklist from active catalogs."""
        prim_snippet = 'count="2" enabled="true"'
        item_snippet = '<Item label="Option A" value="a" />'

        for helper in self.helpers.values():
            for comp in sorted(helper.components):
                props = helper.get_component_properties(comp)
                for p in props:
                    if p == "checks":
                        continue
                    ps = helper.get_property_schema(comp, p)
                    if not isinstance(ps, dict):
                        continue
                    t_desc = _describe_prop_type(helper, comp, p, ps, tuned=True)
                    if prim_snippet == 'count="2" enabled="true"' and (
                        "boolean" in t_desc or "number" in t_desc or "integer" in t_desc
                    ):
                        val_ex = "true" if "boolean" in t_desc else "2"
                        prim_snippet = f'<{comp} {p}="{val_ex}" ... />'
                    if (
                        item_snippet == '<Item label="Option A" value="a" />'
                        and t_desc.startswith("<Item {")
                    ):
                        item_s = helper.resolve_item_schema(ps)
                        if isinstance(item_s, dict) and isinstance(
                            item_s.get("properties"), dict
                        ):
                            ip = item_s["properties"]
                            sample_pairs = []
                            for ik, iv in list(ip.items())[:2]:
                                if _schema_ref_kind(iv) is None and not (
                                    isinstance(iv, dict)
                                    and isinstance(iv.get("properties"), dict)
                                ):
                                    sample_pairs.append(f'{ik}="..."')
                            if sample_pairs:
                                item_snippet = (
                                    f"<{comp}><Item {' '.join(sample_pairs)}"
                                    f" /></{comp}>"
                                )

        return "\n".join([
            (
                "- **Strict XML Quoting (No JSX Braces)**: Quote every primitive"
                f' attribute as `key="value"` (e.g. `{prim_snippet}`); NEVER write'
                ' `{true}`, `{2}`, or `{"text"}`.'
            ),
            (
                "- **Exact Catalog Names, Enums & `<Item>`**: Emit only listed"
                " `<Tag>` names and exact enum literals; populate `<Item {...}>`"
                f" slots with `<Item ...>` (`{item_snippet}`, never invented"
                " singular subtags), passing nested object fields inside `<Item>`"
                " via child ```` ```json fieldName ```` blocks."
            ),
            (
                "- **Top-Level State & Input Checks**: Place ```` ```json"
                " dataModel ```` at the top of `<a2ui>` before the root component;"
                ' nest `<Check call="required" message="..." />` directly inside'
                " `$/path`-bound checkable inputs."
            ),
            (
                "- **Direct Top-Down Layout**: Stream directly from root container"
                " to self-closing leaves (`<Tag ... />`) without `<Child>` wrapper"
                " tags."
            ),
        ])

    def _pick_sample_components(self) -> tuple[str, str, str]:
        """Dynamically picks ``(container_tag, leaf_tag, leaf_attr_snippet)`` from active catalogs."""
        container_tag = "ContainerComponent"
        leaf_tag = "LeafComponent"
        leaf_attr = 'label="Hello"'

        best_container: tuple[int, str] | None = None
        structural = {"component", "id", "catalogId", "checks"}
        for helper in self.helpers.values():
            for comp in helper.components:
                props = helper.get_component_properties(comp)
                if any(
                    _get_effective_prop_kind(helper, comp, p) == "ChildList"
                    for p in props
                ):
                    reqs = set(helper.get_component_required(comp)) - structural
                    list_p = next(
                        p
                        for p in props
                        if _get_effective_prop_kind(helper, comp, p) == "ChildList"
                    )
                    if not (reqs - {list_p}):
                        desc = (helper.get_component_description(comp) or "").lower()
                        score = (
                            2
                            if "vertical" in desc
                            else (1 if "horizontally" not in desc else 0)
                        )
                        if best_container is None or score > best_container[0]:
                            best_container = (score, comp)
        if best_container is not None:
            container_tag = best_container[1]

        for helper in self.helpers.values():
            for comp in helper.components:
                props = helper.get_component_properties(comp)
                if any(
                    _get_effective_prop_kind(helper, comp, p) is not None for p in props
                ):
                    continue
                req_list = [
                    p
                    for p in helper.get_component_required(comp)
                    if p not in structural
                ]
                str_props = [
                    p
                    for p in req_list or props
                    if p != "checks"
                    and not helper.get_property_enum(comp, p)
                    and isinstance(helper.get_property_schema(comp, p), dict)
                ]
                if len(req_list) <= 1 and str_props:
                    leaf_tag = comp
                    if req_list:
                        leaf_attr = " ".join(f'{rp}="Sample"' for rp in req_list)
                    else:
                        leaf_attr = f'{str_props[0]}="Sample"'
                    return container_tag, leaf_tag, leaf_attr

        return container_tag, leaf_tag, leaf_attr

    def generate_base_rules(self, allowed_messages: Sequence[str] | None = None) -> str:
        """Returns the Six Laws of A2UI XML and A2UI surface conventions."""
        effective_allowed = (
            allowed_messages if allowed_messages is not None else self._allowed_messages
        )
        allowed_set = set(effective_allowed) if effective_allowed is not None else None

        def allows(*names: str) -> bool:
            if allowed_set is None:
                return True
            return any(n in allowed_set for n in names)

        can_create = allows("createSurface", "CreateSurfaceMessage")
        can_update_comps = allows("updateComponents", "UpdateComponentsMessage")
        can_update_data = allows("updateDataModel", "UpdateDataModelMessage")
        can_delete = allows("deleteSurface", "DeleteSurfaceMessage")
        can_call_fn = self._v1 and allows(
            "callRendererFunction", "CallRendererFunctionMessage", "callFunction"
        )

        container_tag, leaf_tag, leaf_attr = self._pick_sample_components()

        lines = [
            "# A2UI A2UI XML Output Contract",
            "",
            (
                "Output every user interface inside `<a2ui>` and `</a2ui>` sentinel"
                " tags using A2UI XML (A2UI XML Inference Format). Keep"
                " conversational prose outside the `<a2ui>` block, and NEVER wrap"
                " `<a2ui>` inside an outer markdown code fence."
            ),
            "",
            "## The Six Laws of A2UI XML",
        ]

        rule_num = 1
        if can_create or can_update_comps:
            lines.append(
                f"{rule_num}. **Implicit Root (Law 1)**: Never write `<Root>`. A"
                ' single top-level `<Component>` automatically receives `id="root"`;'
                " multiple top-level components automatically stack inside a root"
                " container. Omit `id` unless needed for partial updates or shared"
                " references."
            )
            rule_num += 1
            lines.append(
                f"{rule_num}. **Verticality (Law 2)**: Place every `<Tag>` and `</Tag>`"
                " on its own line (`\\n`). Use self-closing `<Tag ... />` when a"
                " component has no nested children or fenced JSON"
                f" blocks:\n<a2ui>\n<{container_tag}>\n  <{leaf_tag} {leaf_attr}"
                f" />\n</{container_tag}>\n</a2ui>"
            )
            rule_num += 1
            lines.append(
                f"{rule_num}. **Component Hierarchy & Slots (Law 3)**: Use exact"
                " PascalCase catalog tag names. Nest child `<Tag>` elements directly"
                " inside parent tags instead of passing child ID arrays. When a"
                " component defines multiple named `Child` slots, set"
                ' `slot="slotName"` on the child tag. For structured object-array'
                " properties (annotated `<Item {...}>`), emit one `<Item ...>` child"
                " per entry, nesting any child component inside `<Item>`."
            )
            rule_num += 1

        lines.append(
            f"{rule_num}. **Fence Safety (Law 4)**: Never place JSON objects or"
            " arrays inside XML attributes. Pass object or array properties as an"
            " indented child ```` ```json propName ```` fenced block."
        )
        rule_num += 1

        lines.append(
            f"{rule_num}. **Double-Quoted Attributes & Expressions (Law 5)**: Write"
            ' every attribute as `key="value"` with double quotes (e.g.,'
            ' `max="100"`, `filterable="true"`). Never use single-quoted'
            " attributes, bare boolean flags, or `{...}` attribute wrappers.\n"
            "   - **Data bindings**: Prefix dynamic data-model paths with `$`"
            ' (`value="$/form/rep"` for absolute paths, `url="$url"` for relative'
            ' fields inside templates, `value="$"` for the current item). Never'
            " bind `$path` on properties marked `(static)`.\n"
            "   - **Dynamic templates**: To repeat a child component over a data"
            ' array, set `template="$/path/to/list"` on the list/container tag and'
            " nest its single template `<Tag>` child inside.\n"
            "   - **Function calls**: Prefix inline function calls with `$` and"
            " quote inner string literals with single quotes:"
            " `text=\"$formatString('Hello ${/user/name}')\"`.\n"
            "   - **Actions**: Required `Action` properties accept a bare event"
            ' name (`action="save_deal"`), an `Event(...)` call with optional'
            " context"
            + (
                " and `userMessage` (`action=\"Event('save_deal', {rep:"
                " $/form/rep}, userMessage='Saving...')\"`)"
                if self._v1
                else " (`action=\"Event('save_deal', {rep: $/form/rep})\"`)"
            )
            + ", a client function call (`action=\"$openUrl('https://...')\"`), or"
            ' a child `<Action name="save_deal" ... />` element.\n'
            "   - **Validation checks**: On checkable inputs, nest `<Check"
            ' call="required" message="Field is required" />` (the input\'s bound'
            ' `value` is passed automatically) or pass `checks="?required"`.'
        )
        rule_num += 1

        lines.append(
            f"{rule_num}. **Opaque Fences (Law 6)**: Content inside triple-backtick"
            " code fences (```` ``` ````) is raw literal text; tags inside fences"
            " are never parsed as A2UI XML markup."
        )
        rule_num += 1

        # Surface lifecycle directives filtered by `allowed_messages`
        directive_bullets: list[str] = []
        if can_create:
            directive_bullets.append(
                '- **Surface Targeting**: `<a2ui surface="surface-id">` targets a'
                " named surface (`CreateSurfaceMessage`)."
            )
        if can_create or can_update_data:
            directive_bullets.append(
                "- **Data Model (`UpdateDataModelMessage`)**: Initialize root state"
                " with a top-level ```` ```json dataModel ```` fenced block inside"
                " `<a2ui>`, or update a specific path via `<DataModel"
                ' path="/user/name">` wrapping a ```` ```json ```` block.'
            )
        if can_update_comps or can_update_data:
            directive_bullets.append(
                "- **Incremental Surface Updates (`UpdateComponentsMessage`)**: Use"
                ' `<a2ui surface="surface-id" update="true">` containing only the'
                ' modified `<Component id="..." />` or `<DataModel path="..." />`'
                " entries."
            )
        if can_delete:
            directive_bullets.append(
                "- **Delete Surface (`DeleteSurfaceMessage`)**: `<DeleteSurface"
                ' id="surface-id" />`.'
            )
        if can_call_fn:
            directive_bullets.append(
                "- **Standalone Renderer Function (`CallRendererFunctionMessage`)**:"
                ' `<CallFunction name="funcName" id="call_1" arg="val" />`.'
            )

        if directive_bullets:
            lines.append("")
            lines.append("## Surface & State Directives")
            lines.extend(directive_bullets)

        cat_rules = self._generate_catalog_rules()
        if cat_rules:
            lines.append("")
            lines.append(cat_rules)

        if self._tuned:
            lines.append("")
            lines.append("## Syntax Quick-Check")
            lines.append(self._build_tuned_micro_anchor())

        return "\n".join(lines)

    def _generate_catalog_rules(self) -> str:
        catalog_ids = list(self.helpers)
        if not catalog_ids:
            return ""
        if len(catalog_ids) == 1:
            return (
                "## Active Catalog\nAll components and functions belong to"
                f" `{catalog_ids[0]}`. Do not add `catalogId` attributes."
            )

        lines = [
            "## Active Catalogs",
            "Components and functions resolve by name across:",
            *(f"- `{cid}`" for cid in catalog_ids),
        ]
        shared_comps = self._shared_names("component")
        shared_fns = self._shared_names("function")
        if not shared_comps and not shared_fns:
            lines.append(
                "Every component and function name is unique across catalogs; do not"
                " add `catalogId` attributes."
            )
            return "\n".join(lines)
        if shared_comps:
            sample_c, sample_cats = shared_comps[0]
            tags = ", ".join(f"`<{c}>`" for c, _ in shared_comps)
            lines.append(
                f"- Disambiguate shared components ({tags}) with"
                f' `catalogId="{sample_cats[0]}"` on `<{sample_c}>`.'
            )
        if shared_fns:
            sample_f, sample_cats = shared_fns[0]
            fns = ", ".join(f"`{f}`" for f, _ in shared_fns)
            lines.append(
                f"- Disambiguate shared functions ({fns}) with"
                f" `catalogId='{sample_cats[0]}'` in `${sample_f}(...)` or"
                f' `catalogId="{sample_cats[0]}"` on `<Check>` / `<CallFunction>`.'
            )
        return "\n".join(lines)

    def _shared_names(
        self, kind: Literal["component", "function"]
    ) -> list[tuple[str, list[str]]]:
        names = {
            name
            for h in self.helpers.values()
            for name in (h.components if kind == "component" else h.functions)
        }
        out: list[tuple[str, list[str]]] = []
        for name in sorted(names):
            cats = catalogs_defining(self.helpers, kind, name)
            if len(cats) > 1:
                out.append((name, cats))
        return out

    def generate_catalog_instructions(
        self,
        include_schema: bool = True,
        catalog: Any | None = None,
    ) -> str:
        """Renders compact A2UI XML Markdown pipe-tables and function signatures."""
        if not include_schema:
            return ""
        if catalog is not None:
            helper = CatalogSchemaHelper(catalog)
            return self._render_single_catalog(catalog.catalog_id, helper)
        if len(self.helpers) == 1:
            cid, helper = next(iter(self.helpers.items()))
            return self._render_single_catalog(cid, helper, show_header=False)

        sections = []
        for cid, helper in self.helpers.items():
            sections.append(self._render_single_catalog(cid, helper, show_header=True))
        return "\n\n".join(s for s in sections if s)

    def _render_single_catalog(
        self,
        catalog_id: str,
        helper: CatalogSchemaHelper,
        *,
        show_header: bool = False,
    ) -> str:
        parts: list[str] = []
        if show_header:
            parts.append(f"## Catalog `{catalog_id}`")

        comp_table = self._build_component_table(helper)
        if comp_table:
            parts.append("### A2UI XML Component Tags\n\n" + comp_table)

        fn_block = self._build_function_list(helper)
        if fn_block:
            parts.append("### A2UI XML Catalog Functions\n\n" + fn_block)

        raw_inst = helper.catalog.get("instructions")
        if isinstance(raw_inst, str) and raw_inst.strip():
            transformed = self._transform_catalog_instructions(
                raw_inst.strip(), catalog_id
            )
            parts.append("### Catalog Guidelines\n\n" + transformed)

        return "\n\n".join(parts)

    def _build_component_table(self, helper: CatalogSchemaHelper) -> str:
        if not helper.components:
            return ""
        rows = [
            "| Tag | Attributes (`*` = required) | Child Slots | Checkable | Notes |",
            "| :--- | :--- | :--- | :--- | :--- |",
        ]
        for comp_name in sorted(helper.components):
            props = helper.get_component_properties(comp_name)
            reqs = set(helper.get_component_required(comp_name))
            checkable = helper.is_checkable(comp_name) or "checks" in props

            attr_entries: list[str] = []
            slot_entries: list[str] = []

            for p in props:
                if p == "checks":
                    continue
                is_req = p in reqs
                req_mark = "*" if is_req else ""
                kind = _get_effective_prop_kind(helper, comp_name, p)
                p_schema = helper.get_property_schema(comp_name, p)
                if kind == "ChildList":
                    slot_entries.append(f"`{p}{req_mark}` (`ChildList` / `template`)")
                elif kind == "Child":
                    slot_entries.append(f"`{p}{req_mark}` (`Child`)")
                else:
                    type_str = _describe_prop_type(
                        helper, comp_name, p, p_schema, tuned=self._tuned
                    )
                    if type_str.startswith("<Item"):
                        slot_entries.append(f"`{p}{req_mark}`: `{type_str}`")
                    else:
                        p_desc = _compact_description(
                            p_schema.get("description")
                            if isinstance(p_schema, dict)
                            else None
                        )
                        hint = ""
                        if p_desc and ("ISO 8601" in p_desc or "RFC 3339" in p_desc):
                            hint = " [ISO 8601]"
                        attr_entries.append(f"`{p}{req_mark}`: {type_str}{hint}")

            comp_desc = _compact_description(
                helper.get_component_description(comp_name)
            )
            rows.append(
                f"| `<{comp_name}>` | {'; '.join(attr_entries) or '—'} |"
                f" {'; '.join(slot_entries) or '—'} |"
                f" {'Yes' if checkable else 'No'} | {comp_desc or '—'} |"
            )
        return "\n".join(rows)

    def _build_function_list(self, helper: CatalogSchemaHelper) -> str:
        if not helper.functions:
            return ""
        lines: list[str] = []
        for fn_name in sorted(helper.functions):
            f_props = helper.get_function_properties(fn_name)
            f_reqs = set(helper.get_function_required(fn_name))
            fn_schema = helper.functions.get(fn_name, {})
            ret = "any"
            if isinstance(fn_schema, dict):
                if isinstance(fn_schema.get("returnType"), str):
                    ret = fn_schema["returnType"]
                elif isinstance(fn_schema.get("allOf"), list):
                    for sub in fn_schema["allOf"]:
                        if isinstance(sub, dict) and isinstance(
                            sub.get("returnType"), str
                        ):
                            ret = sub["returnType"]
                            break
            f_desc = _compact_description(helper.get_function_description(fn_name))
            arg_strs = []
            for p in f_props:
                mark = "" if p in f_reqs else "?"
                p_schema = helper.get_function_property_schema(fn_name, p)
                p_type = (
                    p_schema.get("type", "any")
                    if isinstance(p_schema, dict) and "type" in p_schema
                    else "DynamicValue"
                )
                arg_strs.append(f"{p}{mark}: {p_type}")
            sig = f"- `${fn_name}({', '.join(arg_strs)}) -> {ret}`"
            if f_desc:
                sig += f": {f_desc}"
            lines.append(sig)
        return "\n".join(lines)

    def _decompile_example_json(
        self, json_content: str, default_catalog_id: str | None = None
    ) -> str | None:
        try:
            parsed = json.loads(json_content)
            messages = [parsed] if isinstance(parsed, dict) else parsed
            if not isinstance(messages, list) or not messages:
                return None
            if not all(
                isinstance(m, dict) and any(k in m for k in _EXAMPLE_MESSAGE_KEYS)
                for m in messages
            ):
                return None
            normalized = normalize_prompt_example_messages(
                messages,
                version=self._version,
                default_catalog_id=(
                    default_catalog_id or surface_catalog_id(self._catalogs)
                ),
            )
            a2ui_xml_body = self._decompiler.decompile(normalized)
            return self._decompiler.wrap_decompiled_blocks([a2ui_xml_body])
        except Exception:  # pylint: disable=broad-exception-caught
            return None

    def _transform_catalog_instructions(
        self, instructions_md: str, catalog_id: str
    ) -> str:
        pattern = r"[^\S\r\n]*```json[^\S\r\n]*\r?\n(.*?)\r?\n[^\S\r\n]*```"

        def _repl(match: re.Match[str]) -> str:
            converted = self._decompile_example_json(
                match.group(1).strip(), default_catalog_id=catalog_id
            )
            if converted is None:
                return str(match.group(0))
            outer_fence = "````" if "```" in converted else "```"
            return f"{outer_fence}\n{converted}\n{outer_fence}"

        return re.sub(pattern, _repl, instructions_md, flags=re.DOTALL)

    def transform_examples(self, raw_examples_markdown: str) -> str:
        """Rewrites raw ```` ```json ```` A2UI message blocks in markdown into A2UI XML."""
        pattern = r"```json\s*\n(.*?)\n```"

        def _repl_fence(match: re.Match[str]) -> str:
            converted = self._decompile_example_json(match.group(1).strip())
            return converted if converted is not None else str(match.group(0))

        res = re.sub(pattern, _repl_fence, raw_examples_markdown, flags=re.DOTALL)
        begin_end = r"---BEGIN ([^\n]+)---\n(.*?)\n---END \1---"

        def _repl_begin_end(match: re.Match[str]) -> str:
            name = match.group(1)
            converted = self._decompile_example_json(match.group(2).strip())
            if converted is None:
                return str(match.group(0))
            return f"---BEGIN {name}---\n{converted}\n---END {name}---"

        return re.sub(begin_end, _repl_begin_end, res, flags=re.DOTALL)

    def generate_examples(
        self,
        catalog: CatalogApi | None = None,
        validate: bool = False,
    ) -> str:
        """Formats few-shot A2UI example turns into `<a2ui>...</a2ui>` A2UI XML blocks."""
        if not self._examples:
            return ""
        active_catalogs = list(self._catalogs)
        if catalog is not None:
            active_catalogs = [
                catalog,
                *(c for c in active_catalogs if c is not catalog),
            ]
        blocks: list[str] = []
        for turn in self._examples:
            if validate:
                validate_payload(active_catalogs, to_message_dicts(turn))
            decompiled = self._decompiler.decompile_blocks(turn)
            blocks.append(self._decompiler.wrap_decompiled_blocks(decompiled))
        return "\n\n".join(blocks)
