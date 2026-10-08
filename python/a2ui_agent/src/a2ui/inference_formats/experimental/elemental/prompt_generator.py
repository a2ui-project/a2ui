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
"""Prompt compiler for A2UI Elemental.

Translates standard JSON catalog schemas into TypeScript/TSX interface
definitions and instruction blocks for on-device models.
"""

from __future__ import annotations

from collections.abc import Sequence
import json
import re
from typing import Any, Literal

from a2ui.core import CatalogApi
from a2ui.core.common import is_at_least_version
from a2ui.inference_formats._shared import (
    CatalogSchemaHelper,
    build_catalog_helpers,
    catalogs_defining,
    catalogs_protocol_version,
    normalize_prompt_example_messages,
    surface_catalog_id,
)
from a2ui.prompt import PromptGenerator

from .compiler import UPDATE_ATTR
from .parser import ElementalParser

ELEMENTAL_RULES = r"""# A2UI Elemental Output Contract

You must output the user interface using A2UI Elemental HTML5-like markup.
You MUST surround the entire block with the sentinel tags `<a2ui>` and `</a2ui>`.
Inside the sentinel tags, surround the UI layout with `<body>` and `</body>` tags.

## HTML5 Markup Rules

1. Prefix component tags with `ui-` in kebab-case (e.g., `<ui-text-field />`).
2. Provide a unique `id` attribute for every component. The top-level root element must have `id="root"`.
3. Wrap numbers, booleans, and expressions in double-quoted curly braces (e.g., `value="{4}"`, `checked="{true}"`, `value="{$/path}"`). Pass static strings as regular attributes without curly braces.
4. Bind data paths using `{$/path}` (absolute) or `{$name}` (relative in list templates). Use `{$/items/0}` for arrays (never brackets).
5. For static options, schemas, or configurations, write literal JSON inside slot script tags instead of binding to a data path: `<script type="application/json" slot="options">[...]</script>`.
6. Call functions inside curly braces using named arguments: `text="{myFunction(arg1: $/myPath, arg2: 'literal')}"`. Do NOT mix positional and named arguments in any call (e.g., use either all positional arguments like `{Event('click', {arg: $/path})}` or all named arguments).
7. Nest child components directly inside parent tags. Do NOT pass layout properties (like `children` or `child`) as attributes. For named slots (properties expecting a single component, like a leading, trailing, or child element), add the slot attribute to the child: `<ui-icon slot="leading" />`.
8. For dynamic lists, specify the data array path on the `path` attribute and nest the repeated layout inside a `<template>` tag: `<ui-list path="{$/items}"><template>...</template></ui-list>`. Do NOT define or duplicate the template's child components anywhere else in the document.
9. Declare component actions using `on-<event>` attributes with inline expressions: `on-click="{Event('click_event')}"` or `on-click="{openUrl(url: '...')}"`. Do not use `action` properties.
10. Do not use values starting with `{` and ending with `}` (like JSON object literals) directly as attribute string values (e.g. `placeholder="{ 'key': 'val' }"`), as the compiler will treat it as an expression. Prefix or write without matching outer braces (e.g., `placeholder="JSON: { 'key': 'val' }"`).
11. Standalone directives:
    - Data Initialization: `<script type="application/json">{"data"}</script>` at the root of the body.
    - Surface Update: to change a surface that already exists, add the `[UPDATE_ATTR]` attribute to its body: `<body id="id" [UPDATE_ATTR]>`. It holds only the added or replaced components and data scripts. A data script with a `path` attribute sets the value at that path: `<script type="application/json" path="/user/name">"Ada"</script>`.
    - Surface Deletion: `<ui-delete-surface surface-id="id" />`.
    - Standalone Function Call: `<ui-call-function id="id" name="func"><script type="application/json" slot="args">{"args"}</script></ui-call-function>`.
""".replace("[UPDATE_ATTR]", UPDATE_ATTR)

_COMMON_TYPES = """type DataBinding = string;
type A2UIElement = string; // ID of the referenced component
type Action = string; // An inline Event(...) call or catalog function call expression, e.g. "{Event('click', {arg: $/path})}" or "{openUrl(url: '...')}"
type FunctionCall = string; // A catalog function call expression, e.g. "{formatString('Title: ${/path}')}" or "{regex(pattern: '^[A-Z]')}" """

_INTERFACES_INTRO = (
    "Your elements and attributes must match these TypeScript definitions"
    " (converting camelCase props to kebab-case attributes in HTML, e.g."
    " `errorMessage` -> `error-message`)."
)


def _schema_allows_databinding(prop_schema: Any) -> bool:
    """Helper to check if a JSON schema allows data binding."""
    if not isinstance(prop_schema, dict):
        return False
    if "$ref" in prop_schema:
        ref = prop_schema["$ref"]
        if "DataBinding" in ref or "Dynamic" in ref or "ChildList" in ref:
            return True
    if prop_schema.get("type") == "object" and "path" in prop_schema.get(
        "properties", {}
    ):
        return True
    if "oneOf" in prop_schema or "anyOf" in prop_schema or "allOf" in prop_schema:
        subs = (
            prop_schema.get("oneOf", [])
            + prop_schema.get("anyOf", [])
            + prop_schema.get("allOf", [])
        )
        for sub in subs:
            if _schema_allows_databinding(sub):
                return True
    return False


def _is_action(prop_schema: Any) -> bool:
    """Helper to check if a JSON schema represents an Action."""
    if not isinstance(prop_schema, dict):
        return False
    if "$ref" in prop_schema:
        return "Action" in prop_schema["$ref"]
    if "oneOf" in prop_schema or "anyOf" in prop_schema or "allOf" in prop_schema:
        subs = (
            prop_schema.get("oneOf", [])
            + prop_schema.get("anyOf", [])
            + prop_schema.get("allOf", [])
        )
        return any(_is_action(sub) for sub in subs)
    return False


def _to_kebab_case(name: str) -> str:
    """Converts a CamelCase string to kebab-case."""
    return re.sub(r"(?<!^)(?=[A-Z])", "-", name).lower()


class ElementalPromptGenerator(PromptGenerator):
    """Generates system prompt contracts guiding models to produce A2UI Elemental.

    Translates component catalog structures and logic helper catalogs into
    TypeScript/TSX interfaces and function declarations.
    """

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[Any]] | None = None,
        allowed_messages: Sequence[str] | None = None,
        *,
        surface_id: str = "main",
    ):
        from a2ui.inference_formats._shared import check_mixed_catalogs

        self._catalogs = list(check_mixed_catalogs(catalogs))
        self._examples = [list(t) for t in examples] if examples is not None else None
        self._allowed_messages = (
            list(allowed_messages) if allowed_messages is not None else None
        )
        self._surface_id = surface_id
        self.helpers: dict[str, CatalogSchemaHelper] = build_catalog_helpers(
            self._catalogs
        )
        self.catalog_id: str = self._catalogs[0].catalog_id
        self.parser: ElementalParser | None = None

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs configured on this prompt generator."""
        return list(self._catalogs)

    def _get_parser(self) -> ElementalParser:
        if self.parser is None:
            self.parser = ElementalParser(self.catalogs, self._surface_id)
        return self.parser

    def _at_least_v10(self) -> bool:
        catalogs = self.catalogs
        return is_at_least_version(catalogs[0].protocol_version, "1.0")

    def generate_base_rules(self) -> str:
        """Returns core syntax rules for A2UI Elemental, with the catalog rules.

        Standalone function calls (`callRendererFunction`) exist from protocol
        v1.0 on, so the rule for them is left out for earlier catalogs.
        """
        rules = ELEMENTAL_RULES
        if not self._at_least_v10():
            rules = "".join(
                line
                for line in rules.splitlines(keepends=True)
                if "Standalone Function Call:" not in line
            )
        return f"{rules}\n{self._generate_catalog_rules()}"

    def _generate_catalog_rules(self) -> str:
        """Returns the rules for choosing catalogs, derived from the catalog list.

        With several catalogs (A2UI v1.0 and later), the surface has no
        default catalog: the compiler finds each component and function by
        name, and only a name that several catalogs define needs its catalog.
        """
        catalog_ids = list(self.helpers)
        if not catalog_ids:
            return ""
        if len(catalog_ids) == 1:
            return (
                "## Catalog\n\nAll components and functions come from the catalog"
                f' `{catalog_ids[0]}`. Do not add `<link rel="catalog">` tags or'
                " `catalog-id` attributes.\n"
            )

        lines = [
            "## Catalogs",
            "",
            "Components and functions come from these catalogs:",
            "",
            *(f"- `{cat_id}`" for cat_id in catalog_ids),
            "",
            (
                "1. Components and functions are found by name across the catalogs."
                ' Do not add `<link rel="catalog">` tags.'
            ),
        ]
        shared_components = self._names_in_several_catalogs("component")
        shared_functions = self._names_in_several_catalogs("function")
        if not shared_components and not shared_functions:
            lines.append(
                "2. Every component and function name belongs to one catalog, so"
                " do not add `catalog-id` attributes or `catalogId` arguments."
            )
            return "\n".join(lines) + "\n"

        rule = 2
        if shared_components:
            comp, comp_catalogs = shared_components[0]
            tags = ", ".join(
                f"`<ui-{_to_kebab_case(c)}>`" for c, _ in shared_components
            )
            lines.append(
                f"{rule}. These components are defined in several catalogs: {tags}."
                " Give each of them a `catalog-id` attribute naming its catalog:"
                f' `<ui-{_to_kebab_case(comp)} id="x" catalog-id="{comp_catalogs[0]}"'
                " />`. Other components need no `catalog-id`."
            )
            rule += 1
        if shared_functions:
            fn, fn_catalogs = shared_functions[0]
            names = ", ".join(f"`{f}`" for f, _ in shared_functions)
            lines.append(
                f"{rule}. These functions are defined in several catalogs: {names}."
                " Give each call of them a `catalogId` named argument naming its"
                f" catalog: `{{{fn}(..., catalogId: '{fn_catalogs[0]}')}}`, and a"
                " standalone call a `catalog-id` attribute:"
                f' `<ui-call-function id="id" name="{fn}"'
                f' catalog-id="{fn_catalogs[0]}" />`. Other functions need no'
                " catalog."
            )
        return "\n".join(lines) + "\n"

    def _names_in_several_catalogs(
        self, kind: Literal["component", "function"]
    ) -> list[tuple[str, list[str]]]:
        """Returns the names that several catalogs define, with those catalogs.

        Returns:
            Sorted (name, catalog IDs) pairs.
        """
        names = {
            name
            for helper in self.helpers.values()
            for name in (helper.components if kind == "component" else helper.functions)
        }
        shared = []
        for name in sorted(names):
            defining = catalogs_defining(self.helpers, kind, name)
            if len(defining) > 1:
                shared.append((name, defining))
        return shared

    def generate_catalog_instructions(
        self,
        include_schema: bool = True,
        catalog: Any | None = None,
    ) -> str:
        """Assembles TypeScript interfaces and catalog instructions.

        With several catalogs, the shared type definitions are rendered once,
        followed by one section of declarations and instructions per catalog.
        """
        if not include_schema:
            return ""
        if catalog is not None:
            return self._catalog_description(include_schema=True, catalog=catalog)
        if len(self.helpers) <= 1:
            return self._catalog_description(include_schema=True)

        sections = [
            "## Component Interfaces",
            _INTERFACES_INTRO,
            f"```typescript\n{_COMMON_TYPES}\n```",
        ]
        for cat_id, helper in self.helpers.items():
            sections.append(f"## Catalog `{cat_id}`")
            comp_decls = self._generate_component_declarations(helper=helper)
            if comp_decls:
                sections.append(f"```typescript\n{comp_decls}\n```")
            func_decls = self._generate_function_declarations(helper=helper)
            if func_decls:
                sections.append(
                    "Helper functions of this catalog, called inside attribute"
                    " expressions `{...}` using named arguments:"
                )
                sections.append(f"```typescript\n{func_decls}\n```")
            instructions = self._catalog_instructions(helper)
            if instructions:
                sections.append(f"### Catalog Instructions\n\n{instructions}")
        return "\n\n".join(sections)

    def generate_examples(
        self,
        catalog: Any | None = None,
        validate: bool = False,
    ) -> str:
        """Formats few-shot Elemental examples."""
        if not self._examples:
            return ""
        active_catalogs = list(self.catalogs)
        if catalog is not None:
            active_catalogs = [
                catalog,
                *(c for c in active_catalogs if c is not catalog),
            ]
        from a2ui.inference_formats._shared import to_message_dicts
        from a2ui.utils import validate_payload

        parser = self._get_parser()
        blocks = []
        for turn in self._examples:
            if validate:
                validate_payload(active_catalogs, to_message_dicts(turn))
            decompiled = parser.decompile_blocks(turn)
            blocks.append(parser.wrap_decompiled_blocks(decompiled))
        return "\n\n".join(blocks)

    def _map_schema_to_ts_type(
        self, component_name: str, prop_name: str, prop_schema: Any
    ) -> str:
        """Maps a JSON schema definition to a TypeScript type string."""
        if prop_name == "checks":
            return "FunctionCall[]"

        if not isinstance(prop_schema, dict):
            return "any"

        allows_db = _schema_allows_databinding(prop_schema)
        base_type = "any"

        if "$ref" in prop_schema:
            ref = prop_schema["$ref"]
            if "ComponentId" in ref:
                base_type = "A2UIElement"
            elif "ChildList" in ref:
                base_type = "A2UIElement[]"
            elif "Action" in ref:
                base_type = "Action"
            else:
                ref_name = ref.split("/")[-1]
                if ref_name in ["DynamicString", "String"]:
                    base_type = "string"
                elif ref_name in ["DynamicNumber", "Number", "Integer"]:
                    base_type = "number"
                elif ref_name in ["DynamicBoolean", "Boolean"]:
                    base_type = "boolean"
                elif ref_name == "DynamicStringList":
                    base_type = "string[]"
                else:
                    base_type = "any"

        elif prop_schema.get("type") == "object" and "path" in prop_schema.get(
            "properties", {}
        ):
            # Direct mapping of DataBinding object to TS type
            base_type = "DataBinding"

        elif "oneOf" in prop_schema or "anyOf" in prop_schema:
            subs = prop_schema.get("oneOf", []) + prop_schema.get("anyOf", [])
            types = []
            for sub in subs:
                t = self._map_schema_to_ts_type(component_name, prop_name, sub)
                if t != "any":
                    types.append(t)
            if types:
                # Deduplicate
                types = list(dict.fromkeys(types))
                # If we have DataBinding and other types, we will handle it later.
                # But if we have both 'DataBinding' and some object representation of it,
                # we keep only 'DataBinding'.
                if "DataBinding" in types:
                    types = [t for t in types if not t.startswith("{")]
                base_type = " | ".join(types)
            else:
                base_type = "any"

        elif "enum" in prop_schema:
            base_type = " | ".join([f"'{v}'" for v in prop_schema["enum"]])

        elif "type" in prop_schema:
            t = prop_schema["type"]
            if t == "string":
                base_type = "string"
            elif t in ["number", "integer"]:
                base_type = "number"
            elif t == "boolean":
                base_type = "boolean"
            elif t == "array":
                if "items" in prop_schema:
                    items_schema = prop_schema["items"]
                    if (
                        isinstance(items_schema, dict)
                        and items_schema.get("type") == "object"
                        and "properties" in items_schema
                    ):
                        sub_props = []
                        for sub_k, sub_v in items_schema["properties"].items():
                            sub_t = self._map_schema_to_ts_type(
                                component_name, f"{prop_name}.{sub_k}", sub_v
                            )
                            is_sub_req = sub_k in items_schema.get("required", [])
                            sub_props.append(
                                f"{sub_k}{'' if is_sub_req else '?'}: {sub_t}"
                            )
                        base_type = f"Array<{{{'; '.join(sub_props)}}}>"
                    else:
                        item_t = self._map_schema_to_ts_type(
                            component_name, prop_name, items_schema
                        )
                        if "|" in item_t:
                            base_type = f"({item_t})[]"
                        else:
                            base_type = f"{item_t}[]"
                else:
                    base_type = "any[]"
            elif t == "object":
                if "properties" in prop_schema:
                    sub_props = []
                    for sub_k, sub_v in prop_schema["properties"].items():
                        sub_t = self._map_schema_to_ts_type(
                            component_name, f"{prop_name}.{sub_k}", sub_v
                        )
                        is_sub_req = sub_k in prop_schema.get("required", [])
                        sub_props.append(f"{sub_k}{'' if is_sub_req else '?'}: {sub_t}")
                    base_type = f"{{{'; '.join(sub_props)}}}"
                else:
                    base_type = "Record<string, any>"

        if allows_db and base_type not in [
            "A2UIElement",
            "A2UIElement[]",
            "Action",
            "any",
            "DataBinding",
        ]:
            if "DataBinding" not in base_type:
                if "|" in base_type:
                    base_type = f"({base_type}) | DataBinding"
                else:
                    base_type = f"{base_type} | DataBinding"

        return base_type

    def _to_comments(self, description: str | None, indent: str = "") -> list[str]:
        if not description:
            return []
        lines = []
        for line in description.strip().split("\n"):
            lines.append(f"{indent}// {line}")
        return lines

    def _generate_component_declarations(
        self, helper: CatalogSchemaHelper | None = None
    ) -> str:
        """Compiles component definitions into TypeScript element interfaces.

        Returns:
            A string containing TypeScript interface declarations.
        """
        h = helper or next(iter(self.helpers.values()), None)
        if not h:
            return ""
        declarations = []
        for name in sorted(h.component_properties.keys()):
            props = h.get_component_properties(name)
            reqs = h.get_component_required(name)

            # Find all action properties to handle renaming
            action_props = []
            for p in props:
                p_schema = h.get_property_schema(name, p)
                if _is_action(p_schema):
                    action_props.append(p)

            comp_desc = h.get_component_description(name)
            interface_lines = []
            interface_lines.extend(self._to_comments(comp_desc))
            interface_lines.extend([
                f"// Tag: <ui-{_to_kebab_case(name)}>",
                f"interface {name} {{",
                "  id?: string;",
            ])

            for p in props:
                p_schema = h.get_property_schema(name, p)
                is_req = p in reqs

                ts_prop_name = p
                if p in action_props:
                    if len(action_props) == 1:
                        ts_prop_name = "onClick"
                    else:
                        ts_prop_name = "on" + p[0].upper() + p[1:]

                ts_type = self._map_schema_to_ts_type(name, p, p_schema)
                opt_sign = "" if is_req else "?"

                p_desc = (
                    p_schema.get("description") if isinstance(p_schema, dict) else None
                )
                interface_lines.extend(self._to_comments(p_desc, indent="  "))
                interface_lines.append(f"  {ts_prop_name}{opt_sign}: {ts_type};")

            interface_lines.append("}")
            declarations.append("\n".join(interface_lines))

        return "\n\n".join(declarations)

    def _generate_function_declarations(
        self, helper: CatalogSchemaHelper | None = None
    ) -> str:
        """Compiles function definitions into TypeScript function declarations.

        Returns:
            A string containing TypeScript function declarations.
        """
        h = helper or next(iter(self.helpers.values()), None)
        if not h:
            return ""
        declarations = []
        for name in sorted(h.function_properties.keys()):
            props = h.get_function_properties(name)
            reqs = h.get_function_required(name)

            func_schema = h.functions.get(name, {})
            return_type = func_schema.get("returnType", "any")
            func_desc = func_schema.get("description")

            args_properties = (
                func_schema.get("properties", {}).get("args", {}).get("properties", {})
            )

            arg_decls = []
            for p in props:
                is_req = p in reqs
                p_schema = args_properties.get(p, {})
                p_type = self._map_schema_to_ts_type(name, p, p_schema)
                opt_sign = "" if is_req else "?"
                arg_decls.append(f"{p}{opt_sign}: {p_type}")

            decl_lines = []
            decl_lines.extend(self._to_comments(func_desc))
            decl_lines.append(
                f"function {name}({', '.join(arg_decls)}): {return_type};"
            )
            declarations.append("\n".join(decl_lines))

        return "\n".join(declarations)

    _MESSAGE_KEYS = (
        "createSurface",
        "updateComponents",
        "updateDataModel",
        "deleteSurface",
        "callFunction",
        "callRendererFunction",
    )

    def _decompile_json_messages(
        self, parsed: Any, default_catalog_id: str | None
    ) -> list[str]:
        """Decompiles example message JSON into Elemental blocks.

        Args:
            parsed: The example's JSON.
            default_catalog_id: The catalog of a surface or call that names
                none, or None to find each component and function by name.

        Raises:
            ValueError: If the JSON is not a message or list of messages.
        """
        items = [parsed] if isinstance(parsed, dict) else parsed
        if not isinstance(items, list) or not all(
            isinstance(m, dict) and any(k in m for k in self._MESSAGE_KEYS)
            for m in items
        ):
            raise ValueError("Not an A2UI message payload.")
        return self._get_parser().decompile_blocks(
            normalize_prompt_example_messages(
                items,
                version=catalogs_protocol_version(self.catalogs),
                default_catalog_id=default_catalog_id,
            )
        )

    def _decompile_example_json(self, json_content: str) -> str | None:
        try:
            blocks = self._decompile_json_messages(
                json.loads(json_content), surface_catalog_id(self.catalogs)
            )
            return self._get_parser().wrap_decompiled_blocks(blocks)
        except Exception:
            return None

    def _replace_json_block(self, match: re.Match[str]) -> str:
        res = self._decompile_example_json(match.group(1).strip())
        return res if res is not None else str(match.group(0))

    def _replace_begin_end_block(self, match: re.Match[str]) -> str:
        name = match.group(1)
        res = self._decompile_example_json(match.group(2).strip())
        if res is None:
            return str(match.group(0))
        return f"---BEGIN {name}---\n{res}\n---END {name}---"

    def transform_examples(self, raw_examples_markdown: str) -> str:
        """Transforms JSON blocks in raw markdown into Elemental HTML syntax."""
        triple_backticks = chr(96) * 3
        pattern = rf"{triple_backticks}json\s*\n(.*?)\n{triple_backticks}"
        result = re.sub(
            pattern,
            self._replace_json_block,
            raw_examples_markdown,
            flags=re.DOTALL,
        )
        begin_end_pattern = r"---BEGIN ([^\n]+)---\n(.*?)\n---END \1---"
        return re.sub(
            begin_end_pattern,
            self._replace_begin_end_block,
            result,
            flags=re.DOTALL,
        )

    def generate(self) -> str:
        """Assembles the prompt snippet explaining A2UI Elemental and its catalog."""
        parts: list[str] = []

        rules = self.generate_base_rules()
        parts.append(f"## Workflow Description:\n{rules}")

        if self.helpers:
            parts.append(self.generate_catalog_instructions(include_schema=True))

        formatted_examples = self.generate_examples()
        if formatted_examples:
            parts.append(f"### Examples:\n{formatted_examples}")

        return "\n\n".join(parts)

    def _catalog_instructions(self, helper: CatalogSchemaHelper) -> str:
        """Returns a catalog's instructions, with JSON examples as Elemental HTML.

        A catalog's examples use its components and functions, so a surface or
        call in them that names no catalog is read as coming from this catalog.
        """
        catalog_instructions = helper.catalog.get("instructions", "")
        if not catalog_instructions:
            return ""
        catalog_instructions = catalog_instructions.replace(
            "specify any custom error messages directly in the check's 'message'"
            " property. Do NOT create separate text-display components to display"
            " validation errors.",
            "specify any custom error messages directly as a named argument"
            " `message` inside the validation function call (e.g."
            " `checks=\"{[regex(pattern: '^[a-zA-Z0-9]{3,}$', message: 'Error"
            " message')]}\"`). Do NOT create separate text-display components to"
            " display validation errors.",
        )
        catalog_id = helper.catalog_model.catalog_id or self.catalog_id

        def _replace_json_block_in_instructions(match: re.Match[str]) -> str:
            try:
                blocks = self._decompile_json_messages(
                    json.loads(match.group(1).strip()), catalog_id
                )
            except Exception:
                return match.group(0)
            if not blocks:
                return match.group(0)
            html_block = "\n\n".join(blocks)
            return f"```html\n{html_block}\n```"

        pattern = r"[^\S\r\n]*```json[^\S\r\n]*\r?\n(.*?)\r?\n[^\S\r\n]*```"
        return re.sub(
            pattern,
            _replace_json_block_in_instructions,
            catalog_instructions,
            flags=re.DOTALL,
        )

    def _catalog_description(
        self, include_schema: bool = True, catalog: Any | None = None
    ) -> str:
        """Assembles the system prompt component catalog signatures block.

        Args:
            include_schema: Whether to include the schema description.
            catalog: Optional catalog override to render signatures for.

        Returns:
            The rendered LLM instructions string block containing TypeScript element declarations.
        """
        if not include_schema:
            return ""

        h = (
            self.helpers.get(getattr(catalog, "catalog_id", None))
            or CatalogSchemaHelper(catalog)
            if catalog
            else next(iter(self.helpers.values()), None)
        )
        comp_decls = self._generate_component_declarations(helper=h)
        func_decls = self._generate_function_declarations(helper=h)

        catalog_instructions = self._catalog_instructions(h) if h else ""
        catalog_instructions_block = (
            f"\n\n## Catalog Instructions\n\n{catalog_instructions}"
            if catalog_instructions
            else ""
        )

        desc_template = r"""## Component Interfaces

[INTERFACES_INTRO]

```typescript
[COMMON_TYPES]

[COMPONENT_DECLARATIONS]
```

## Helper Functions

You can call these functions inside attribute expressions `{...}` using named arguments.

```typescript
[FUNCTION_DECLARATIONS]
```[CATALOG_INSTRUCTIONS_BLOCK]"""

        return (
            desc_template.replace("[INTERFACES_INTRO]", _INTERFACES_INTRO)
            .replace("[COMMON_TYPES]", _COMMON_TYPES)
            .replace("[COMPONENT_DECLARATIONS]", comp_decls)
            .replace("[FUNCTION_DECLARATIONS]", func_decls)
            .replace("[CATALOG_INSTRUCTIONS_BLOCK]", catalog_instructions_block)
        )
