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

"""Prompt generator for the A2UI Vertical inference format.

Compiles component catalog schemas into concise, non-nested component signatures,
automatically ignoring components that require children.
"""

import json
import re
from typing import Any, List, Optional, TYPE_CHECKING, Union
from a2ui.prompt import PromptGenerator
from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.core.schema.client_capabilities import V09Capabilities
from a2ui.schema.schema_helper import CatalogSchemaHelper
from a2ui.schema.constants import (
    A2UI_INFERENCE_OPEN_TAG,
    A2UI_INFERENCE_CLOSE_TAG,
)

if TYPE_CHECKING:
    from .format import VerticalFormat

VERTICAL_RULES = f"""# A2UI Vertical Output Contract

You must output user interfaces using A2UI Vertical notation.
You MUST surround the UI block with sentinel tags `{A2UI_INFERENCE_OPEN_TAG}` and `{A2UI_INFERENCE_CLOSE_TAG}`.

## Grammar Rules

1. Instantiate one or more components directly:
   ComponentName(param1="value1", param2=42)

   If outputting multiple components, write each component on a new line. They will be displayed in a vertical list.

2. Syntax:
   - Use `param="value"` or `param: "value"` for named parameters.
   - Positional parameters matching catalog signatures are also supported (e.g. `Text("Hello")`).
   - Strings: Double or single quoted (e.g. "Hello" or 'Hello').
   - Numbers: Integers or decimals (e.g. 42, 3.14).
   - Booleans: true or false.
   - Null: null.
   - Lists: [item1, item2].
   - Maps: {{"key": "value"}} or {{key: "value"}}.

3. Actions & Events:
   - Server-side actions: `Event("action_name", param="val")` or `action="action_name"`.

4. Data Bindings:
   - Prefix data model paths with `$/` (e.g. `$/user/name`).

5. Do NOT specify surface IDs, component IDs, or container nesting. The runtime automatically handles layout and IDs.
"""


def _schema_allows_databinding(prop_schema: Any) -> bool:
    """Checks if a property schema allows dynamic data binding."""
    if not isinstance(prop_schema, dict):
        return False
    if "$ref" in prop_schema:
        ref = prop_schema["$ref"]
        if "DataBinding" in ref or "Dynamic" in ref:
            return True
    for key in ("oneOf", "anyOf", "allOf"):
        if key in prop_schema and isinstance(prop_schema[key], list):
            for sub in prop_schema[key]:
                if _schema_allows_databinding(sub):
                    return True
    return False


def _get_schema_enum(prop_schema: Any) -> Optional[List[str]]:
    """Recursively finds enum definitions in a JSON schema."""
    if not isinstance(prop_schema, dict):
        return None
    if "enum" in prop_schema and isinstance(prop_schema["enum"], list):
        return [str(x) for x in prop_schema["enum"]]
    for key in ("oneOf", "anyOf", "allOf"):
        if key in prop_schema and isinstance(prop_schema[key], list):
            for sub in prop_schema[key]:
                res = _get_schema_enum(sub)
                if res:
                    return res
    return None


class VerticalPromptGenerator(PromptGenerator):
    """Generates system prompts guiding models to produce A2UI Vertical format.

    Filters the catalog to only include components that do NOT require children,
    and formats concise parameter signatures.
    """

    def __init__(self, format_inst: "VerticalFormat"):
        """Initializes the prompt generator with a VerticalFormat instance."""
        self._format = format_inst
        self.catalog = format_inst.catalog
        if isinstance(self.catalog, CatalogSchemaHelper):
            self.helper = self.catalog
        elif isinstance(self.catalog, (Catalog, A2uiCatalog)):
            self.helper = CatalogSchemaHelper(self.catalog)
        elif hasattr(self.catalog, "get_components"):
            comps = self.catalog.get_components()
            fns = (
                self.catalog.get_functions()
                if hasattr(self.catalog, "get_functions")
                else {}
            )
            cid = getattr(
                self.catalog,
                "catalog_id",
                getattr(self.catalog, "id", "https://a2ui.org/mock"),
            )
            cat = Catalog.from_json(
                {"catalogId": cid, "components": comps, "functions": fns},
                spec_version="0.9.1",
            )
            self.helper = CatalogSchemaHelper(cat)
        else:
            self.helper = CatalogSchemaHelper(self.catalog)

    def component_requires_children(self, comp_name: str) -> bool:
        """Determines whether a component requires child components.

        In the Vertical format, components that require children cannot be specified
        and must be ignored.
        """
        reqs = self.helper.get_component_required(comp_name) or []
        props = self.helper.get_component_properties(comp_name) or []

        for p in props:
            if p in reqs:
                p_type = self.helper.get_property_type(comp_name, p)
                if p in ("child", "children") or p_type in ("Child", "ChildList"):
                    return True
                p_schema = self.helper.get_property_schema(comp_name, p)
                if isinstance(p_schema, dict) and "$ref" in p_schema:
                    ref = p_schema["$ref"]
                    if "ComponentId" in ref or "ChildList" in ref:
                        return True
        return False

    def generate_component_signatures(
        self, allowed_components: Optional[List[str]] = None
    ) -> str:
        """Compiles component definitions into clean function-like signatures.

        Ignores all components that require children.
        """
        signatures: List[str] = []

        for name in sorted(self.helper.component_properties.keys()):
            # Ignore components that require children
            if self.component_requires_children(name):
                continue

            # Respect allowed_components filter if provided
            if allowed_components is not None and name not in allowed_components:
                continue

            props = self.helper.get_component_properties(name) or []
            reqs = self.helper.get_component_required(name) or []
            comp_desc = self.helper.get_component_description(name)

            ordered_args: List[str] = []
            prop_details: List[str] = []

            for p in props:
                # Omit structural or child slots
                if p in ("component", "id", "child", "children"):
                    continue
                p_type = self.helper.get_property_type(name, p)
                if p_type in ("Child", "ChildList"):
                    continue

                is_req = p in reqs
                opt_suffix = "" if is_req else "?"
                p_schema = self.helper.get_property_schema(name, p)

                arg_label = f"{p}{opt_suffix}"
                if not _schema_allows_databinding(p_schema):
                    arg_label += " (static)"

                ordered_args.append(arg_label)

                p_desc = (
                    p_schema.get("description") if isinstance(p_schema, dict) else None
                )
                enum_vals = _get_schema_enum(p_schema)

                if p_desc or enum_vals:
                    parts = []
                    if p_desc:
                        parts.append(p_desc)
                    if enum_vals:
                        enum_str = ", ".join(f"'{v}'" for v in enum_vals)
                        parts.append(f"Must be one of: {enum_str}")
                    prop_details.append(f"  - {p}: {' '.join(parts)}")

            sig = f"• {name}({', '.join(ordered_args)})"
            if comp_desc:
                desc_indented = comp_desc.replace("\n", "\n    ")
                sig += f"\n  - Description: {desc_indented}"
            if prop_details:
                sig += "\n" + "\n".join(prop_details)
            signatures.append(sig)

        return "\n".join(signatures)

    def generate_function_signatures(self) -> str:
        """Compiles catalog function definitions into clean signatures."""
        signatures: List[str] = []
        for name in sorted(self.helper.function_properties.keys()):
            props = self.helper.get_function_properties(name) or []
            reqs = self.helper.get_function_required(name) or []
            f_desc = self.helper.get_function_description(name)

            ordered_args = []
            prop_details = []

            func_schema = self.helper.functions.get(name, {})
            args_properties = (
                func_schema.get("properties", {}).get("args", {}).get("properties", {})
                if isinstance(func_schema, dict)
                else {}
            )

            for p in props:
                is_req = p in reqs
                opt_suffix = "" if is_req else "?"
                ordered_args.append(f"{p}{opt_suffix}")

                p_schema = (
                    args_properties.get(p, {})
                    if isinstance(args_properties, dict)
                    else {}
                )
                p_desc = (
                    p_schema.get("description") if isinstance(p_schema, dict) else None
                )
                if p_desc:
                    prop_details.append(f"  - {p}: {p_desc}")

            sig = f"• {name}({', '.join(ordered_args)})"
            if f_desc:
                desc_indented = f_desc.replace("\n", "\n    ")
                sig += f"\n  - Description: {desc_indented}"
            if prop_details:
                sig += "\n" + "\n".join(prop_details)
            signatures.append(sig)

        return "\n".join(signatures)

    def catalog_description(
        self,
        include_schema: bool = True,
        allowed_components: Optional[List[str]] = None,
    ) -> str:
        """Returns the formatted catalog signatures block."""
        if not include_schema:
            return ""

        comp_sigs = self.generate_component_signatures(allowed_components)
        func_sigs = self.generate_function_signatures()

        catalog_instructions = (
            self.helper.catalog.get("instructions", "")
            if isinstance(self.helper.catalog, dict)
            else ""
        )
        catalog_instructions_block = ""
        if catalog_instructions:
            catalog_instructions_block = (
                f"\n\n## Catalog Instructions\n\n{catalog_instructions}"
            )

        parts = []
        if comp_sigs:
            parts.append(
                "## Component Signatures\n\n"
                "Instantiate these components directly. Children cannot be nested:\n"
                f"{comp_sigs}"
            )
        if func_sigs:
            parts.append(f"## Function Signatures\n\n{func_sigs}")
        if catalog_instructions_block:
            parts.append(catalog_instructions_block)

        return "\n\n".join(parts)

    def generate_base_rules(self) -> str:
        """Returns the core syntax contract and grammar rules for the Vertical format."""
        return VERTICAL_RULES.strip()

    def generate_catalog_instructions(
        self,
        include_schema: bool = True,
        catalog: Optional[Any] = None,
    ) -> str:
        """Returns component and function signatures for the catalog."""
        return self.catalog_description(include_schema=include_schema)

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
        """Generates the full system prompt contract."""
        prompt_parts: List[str] = []

        if role_description:
            prompt_parts.append(f"## Role\n\n{role_description}")

        if workflow_description:
            prompt_parts.append(f"## Instructions\n\n{workflow_description}")

        if ui_description:
            prompt_parts.append(f"## UI Guidance\n\n{ui_description}")

        prompt_parts.append(VERTICAL_RULES.strip())

        if include_schema:
            cat_desc = self.catalog_description(
                include_schema=True, allowed_components=allowed_components
            )
            if cat_desc:
                prompt_parts.append(cat_desc)

        return "\n\n".join(prompt_parts)

    def generate_system_prompt(
        self,
        role_description: str = "",
        workflow_description: str = "",
        ui_description: str = "",
        client_ui_capabilities: Optional[Union[dict[str, Any], V09Capabilities]] = None,
        allowed_components: Optional[list[str]] = None,
        allowed_messages: Optional[list[str]] = None,
        include_schema: bool = True,
        include_examples: bool = False,
        validate_examples: bool = False,
    ) -> str:
        """Convenience method to generate full system prompt with schema included."""
        return self.generate(
            role_description=role_description,
            workflow_description=workflow_description,
            ui_description=ui_description,
            client_ui_capabilities=client_ui_capabilities,
            allowed_components=allowed_components,
            allowed_messages=allowed_messages,
            include_schema=include_schema,
            include_examples=include_examples,
            validate_examples=validate_examples,
        )
