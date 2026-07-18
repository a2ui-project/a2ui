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

"""Prompt compiler for A2UI Elemental.

Translates standard JSON catalog schemas into TypeScript/TSX interface
definitions and instruction blocks for on-device models.
"""

import json
import re
from typing import Any, Optional, TYPE_CHECKING, Union
from a2ui.schema.catalog import A2uiCatalog
from a2ui.inference_formats.experimental.express.schema_helper import (
    CatalogSchemaHelper,
)
from a2ui.prompt import PromptGenerator
from a2ui.core.schema.client_capabilities import V09Capabilities
from .parser import ElementalParser


if TYPE_CHECKING:
    from .format import ElementalFormat


ELEMENTAL_RULES = r"""# A2UI Elemental Output Contract

You must output the user interface using A2UI Elemental HTML5-like markup.
You MUST surround the entire block with the sentinel tags `<a2ui>` and `</a2ui>`.
Inside the sentinel tags, surround the UI layout with `<body>` and `</body>` tags, including a `<link rel="catalog" href="[CATALOG_ID]">` at the start.

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
    - Surface Deletion: `<ui-delete-surface surface-id="id" />`.
    - Standalone Function Call: `<ui-call-function id="id" name="func"><script type="application/json" slot="args">{"args"}</script></ui-call-function>`.
"""


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

    def __init__(self, format_inst: "ElementalFormat"):
        """Initializes the generator with the specified format instance.

        Args:
            format_inst: An ElementalFormat instance.
        """
        self._format = format_inst
        self.catalog: A2uiCatalog = format_inst.catalog
        self.helper: CatalogSchemaHelper = CatalogSchemaHelper(format_inst.catalog)
        self.catalog_id: str = format_inst.catalog.catalog_id
        self.parser: Optional[ElementalParser] = None

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

    def _to_comments(self, description: Optional[str], indent: str = "") -> list[str]:
        if not description:
            return []
        lines = []
        for line in description.strip().split("\n"):
            lines.append(f"{indent}// {line}")
        return lines

    def generate_component_declarations(self) -> str:
        """Compiles component definitions into TypeScript element interfaces.

        Returns:
            A string containing TypeScript interface declarations.
        """
        declarations = []
        for name in sorted(self.helper.component_properties.keys()):
            props = self.helper.get_component_properties(name)
            reqs = self.helper.get_component_required(name)

            # Find all action properties to handle renaming
            action_props = []
            for p in props:
                p_schema = self.helper.get_property_schema(name, p)
                if _is_action(p_schema):
                    action_props.append(p)

            comp_desc = self.helper.get_component_description(name)
            interface_lines = []
            interface_lines.extend(self._to_comments(comp_desc))
            interface_lines.extend([
                f"// Tag: <ui-{_to_kebab_case(name)}>",
                f"interface {name} {{",
                "  id?: string;",
            ])

            for p in props:
                p_schema = self.helper.get_property_schema(name, p)
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

    def generate_function_declarations(self) -> str:
        """Compiles function definitions into TypeScript function declarations.

        Returns:
            A string containing TypeScript function declarations.
        """
        declarations = []
        for name in sorted(self.helper.function_properties.keys()):
            props = self.helper.get_function_properties(name)
            reqs = self.helper.get_function_required(name)

            func_schema = self.helper.functions.get(name, {})
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

    def _replace_json_block(self, match: re.Match[str]) -> str:
        json_content = match.group(1).strip()
        try:
            parsed = json.loads(json_content)
            if isinstance(parsed, dict):
                messages = [parsed]
            elif isinstance(parsed, list):
                messages = parsed
            else:
                return str(match.group(0))

            blocks = []
            for msg in messages:
                if isinstance(msg, dict) and any(
                    k in msg
                    for k in [
                        "createSurface",
                        "updateDataModel",
                        "deleteSurface",
                        "callFunction",
                    ]
                ):
                    parser = self.parser or self._format.parser
                    if not parser:
                        self._format._ensure_catalog()
                        parser = self._format.parser
                        assert parser is not None
                    decompiled = parser.decompile(msg)
                    blocks.append(decompiled)
                else:
                    return str(match.group(0))

            parser = self.parser or self._format.parser
            if not parser:
                self._format._ensure_catalog()
                parser = self._format.parser
                assert parser is not None
            return parser.wrap_decompiled_blocks(blocks)

        except Exception:
            return str(match.group(0))

    def transform_examples(self, raw_examples_markdown: str) -> str:
        """Transforms JSON blocks in raw markdown into Elemental HTML syntax."""
        if not self.catalog:
            return raw_examples_markdown

        triple_backticks = chr(96) * 3
        pattern = rf"{triple_backticks}json\s*\n(.*?)\n{triple_backticks}"

        return re.sub(
            pattern,
            self._replace_json_block,
            raw_examples_markdown,
            flags=re.DOTALL,
        )

    def generate(
        self,
        role_description: str,
        workflow_description: str = "",
        ui_description: str = "",
        client_ui_capabilities: Optional[Union[dict[str, Any], V09Capabilities]] = None,
        allowed_components: Optional[list[str]] = None,
        allowed_messages: Optional[list[str]] = None,
        include_schema: bool = False,
        include_examples: bool = False,
        validate_examples: bool = False,
    ) -> str:
        """Assembles the complete system instruction block for the LLM.

        Args:
            role_description: Description of the agent's role.
            workflow_description: Optional description of the task workflow.
            ui_description: Optional UI context or rules.
            client_ui_capabilities: Optional client UI capability details.
            allowed_components: Optional list of component tags the LLM may use.
            allowed_messages: Optional list of A2UI message types allowed.
            include_schema: Whether to include component schemas in the prompt.
            include_examples: Whether to include few-shot examples.
            validate_examples: Whether to validate few-shot examples on generation.

        Returns:
            The complete system prompt string explaining A2UI Elemental and its catalog.
        """
        catalog = self.catalog
        if allowed_components or allowed_messages:
            catalog = catalog.with_pruning(allowed_components, allowed_messages)
            self.catalog = catalog
            self.helper = CatalogSchemaHelper(catalog)
            self.catalog_id = catalog.catalog_id
            self.parser = ElementalParser(catalog)

        prompt = self.catalog_description(include_schema=True)

        parts = [role_description]

        rules = ELEMENTAL_RULES.replace("[CATALOG_ID]", self.catalog_id)
        if workflow_description:
            rules += f"\n\n{workflow_description}"
        parts.append(f"## Workflow Description:\n{rules}")

        if ui_description:
            parts.append(f"## UI Description:\n{ui_description}")

        if include_schema and self.helper:
            parts.append(prompt)

        if include_examples and self._format.examples_path and catalog:
            raw_examples = catalog.load_examples(
                self._format.examples_path, validate=validate_examples
            )
            if raw_examples:
                formatted_examples = self.transform_examples(raw_examples)
                parts.append(f"### Examples:\n{formatted_examples}")

        return "\n\n".join(parts)

    def catalog_description(self, include_schema: bool = True) -> str:
        """Assembles the system prompt component catalog signatures block.

        Args:
            include_schema: Whether to include the schema description.

        Returns:
            The rendered LLM instructions string block containing TypeScript element declarations.
        """
        if not include_schema:
            return ""

        comp_decls = self.generate_component_declarations()
        func_decls = self.generate_function_declarations()

        catalog_instructions = (
            self.helper.catalog.get("instructions", "") if self.helper else ""
        )
        if catalog_instructions:
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
        # Decompile json blocks in catalog instructions to HTML
        catalog_instructions_block = ""
        if catalog_instructions:
            try:
                json_blocks = re.findall(
                    r"```json\s*(.*?)\s*```", catalog_instructions, re.DOTALL
                )
                for block in json_blocks:
                    try:
                        parsed_json = json.loads(block)
                        if isinstance(parsed_json, list):
                            html_parts = []
                            for item in parsed_json:
                                if isinstance(item, dict):
                                    parser = self.parser or self._format.parser
                                    if not parser:
                                        self._format._ensure_catalog()
                                        parser = self._format.parser
                                        assert parser is not None
                                    html_parts.append(parser.decompile(item))
                            html_block = "\n\n".join(html_parts)
                        elif isinstance(parsed_json, dict):
                            parser = self.parser or self._format.parser
                            if not parser:
                                self._format._ensure_catalog()
                                parser_inst = self._format.parser
                                assert parser_inst is not None
                                parser = parser_inst
                            html_block = parser.decompile(parsed_json)

                        else:
                            continue

                        target_block = f"```json\n{block}\n```"
                        catalog_id = self.catalog_id
                        html_block = html_block.replace(catalog_id, "[CATALOG_ID]")
                        replacement_block = f"```html\n{html_block}\n```"
                        catalog_instructions = catalog_instructions.replace(
                            target_block, replacement_block
                        )
                    except Exception:
                        pass
            except Exception:
                pass

            catalog_instructions_block = (
                f"\n\n## Catalog Instructions\n\n{catalog_instructions}"
            )

        common_types = """type DataBinding = string;
type A2UIElement = string; // ID of the referenced component
type Action = string; // An inline Event(...) call or catalog function call expression, e.g. "{Event('click', {arg: $/path})}" or "{openUrl(url: '...')}"
type FunctionCall = string; // A catalog function call expression, e.g. "{formatString('Title: ${/path}')}" or "{regex(pattern: '^[A-Z]')}" """

        desc_template = r"""## Component Interfaces

Your elements and attributes must match these TypeScript definitions (converting camelCase props to kebab-case attributes in HTML, e.g. `errorMessage` -> `error-message`).

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
            desc_template.replace("[COMMON_TYPES]", common_types)
            .replace("[COMPONENT_DECLARATIONS]", comp_decls)
            .replace("[FUNCTION_DECLARATIONS]", func_decls)
            .replace("[CATALOG_INSTRUCTIONS_BLOCK]", catalog_instructions_block)
        )
