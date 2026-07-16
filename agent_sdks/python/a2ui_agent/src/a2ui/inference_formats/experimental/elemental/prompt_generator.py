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
from typing import Any, Optional, TYPE_CHECKING
from a2ui.schema.catalog import A2uiCatalog
from a2ui.inference_formats.experimental.express.schema_helper import CatalogSchemaHelper
from a2ui.prompt import PromptGenerator
from a2ui.schema.capabilities import ClientUiCapabilities

if TYPE_CHECKING:
    from .format import ElementalFormat


ELEMENTAL_RULES = r"""# A2UI Elemental Output Contract

You must output the user interface using A2UI Elemental HTML5-like markup.
Surround the entire output with `<body>` and `</body>` tags, including a `<link rel="catalog" href="[CATALOG_ID]">` at the start.
**CRITICAL**: DO NOT output raw JSON or `<a2ui-json>`. Direct JSON outputs are strictly prohibited.

## HTML5 Markup Rules

1. **Component Tags**: Use elements prefixed with `ui-` in kebab-case (e.g. `<ui-card>`).
2. **Component IDs**: Provide a unique `id` attribute for every component. The single top-level element MUST have `id="root"`.
3. **Attributes**: Pass static string values as regular attributes (`variant="primary"`). Wrap numbers, booleans, and expressions in double-quoted curly braces: `elevation="{4}"`, `disabled="{true}"`.
4. **Data Binding**: Bind data using curly braces prefixed with `$`: `value="{$/user/name}"` (absolute) or `value="{$name}"` (relative in list templates). Use `{$/items/0}` for arrays, never brackets.
5. **Expressions**: Call catalog functions inside curly braces using named arguments: `text="{formatCurrency(value: $/price, currency: 'USD')}"`.
6. **Slots & Children**: Nest children inside parent elements. Use the `slot` attribute to specify child properties: `<ui-card slot="leading">`.
7. **Complex Properties**: For objects/arrays, use `<script type="application/json" slot="prop">`. For HTML/long text, use `<script type="text/html" slot="prop">`.
8. **Templates**: For dynamic lists, nest child elements inside a `<template>` tag, and specify the bound data array path via the `path` attribute on the list component itself (e.g. `<ui-list path="{$/items}"><template>...</template></ui-list>`).
9. **Actions**: Use `on-<property-name>` in kebab-case (e.g. `onclick="{Event('name', {args})}"`). If submitting or validating data, pass the data paths inside the event context dict (e.g. `onclick="{Event('login', {username: $/login/username})}"`).
10. **Standalone Directives**:
    - Data Initialization: `<script type="application/json">{"data"}</script>` at root of body.
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
                base_type = "A2UIElement | A2UIElement[]"
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
            "A2UIElement | A2UIElement[]",
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

            interface_lines = [
                f"// Tag: <ui-{_to_kebab_case(name)}>",
                f"interface {name} {{",
                "  id?: string;",
            ]

            for p in props:
                p_schema = self.helper.get_property_schema(name, p)
                is_req = p in reqs

                ts_prop_name = p
                if p in action_props:
                    if len(action_props) == 1:
                        ts_prop_name = "onclick"
                    else:
                        ts_prop_name = "on" + p[0].upper() + p[1:]

                ts_type = self._map_schema_to_ts_type(name, p, p_schema)
                opt_sign = "" if is_req else "?"
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

            decl = f"function {name}({', '.join(arg_decls)}): {return_type};"
            declarations.append(decl)

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
                    decompiled = self._format.decompiler.decompile(msg)
                    blocks.append(decompiled)
                else:
                    return str(match.group(0))

            return self._format.decompiler.wrap_decompiled_blocks(blocks)
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
        client_ui_capabilities: Optional[ClientUiCapabilities] = None,
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

        prompt = self._format.catalog_description(self, include_schema=True)

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
