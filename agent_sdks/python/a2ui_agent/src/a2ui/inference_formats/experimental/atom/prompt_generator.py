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

"""Prompt compiler for A2UI Atom inference format."""

from typing import Any, Optional, TYPE_CHECKING
from a2ui.prompt import PromptGenerator
from a2ui.core.schema.client_capabilities import V09Capabilities
# CatalogSchemaHelper import handled lazily inside class

if TYPE_CHECKING:
    from .format import AtomFormat

ATOM_RULES = r"""Output the user interface using compact A2UI Atom S-Expression notation.
You MUST surround the entire A2UI Atom block with sentinel tags `<a2ui>` and `</a2ui>`. Do NOT output raw JSON messages.

## Grammar Rules

1. Every component node is a parenthesized expression starting with the ComponentName:
   (ComponentName :key1 val1 :key2 val2 child1 child2 ...)

2. Primitives:
   - Strings: Double-quoted, e.g., "Hello". Escapes: \n, \t, \\, \".
   - Numbers: Integers or decimals, e.g., 42 or 3.14.
   - Booleans: true or false.
   - Null: null.

3. Property Arguments:
   - Tagged attributes: Prefixed with a colon ':', e.g., :attr1 "val1" or :attr2 true. Tagged keys are order-independent.
   - Positional attributes: Can be passed sequentially matching catalog signature order.

4. Child Components & Strict Tree Nesting:
   - You MUST nest child components directly inside their parent container expressions, e.g., (ContainerComponent (ChildComponent (PrimitiveComponent "Hello"))).
   - Do NOT output flat adjacency lists, explicit `:id` attributes, or separate component variable IDs. Every UI component must be nested directly within a single root tree expression.

5. Data Bindings:
   - Absolute data model paths start with '$/', e.g., $/user/firstName.
   - Relative template item fields start with '$/item_var/field', e.g. $/item/name.

6. Data Model Population:
   - Initialize data model state using (data $/path1 "val1" $/path2 123) or (data $/map_path (:key1 "val1" :key2 "val2")).

7. Dynamic List Templates:
   - List templates use (template :item item (ChildComponent $/item/name)) or (ListComponent :children (template :item item (ChildComponent $/item/name))).

8. Action Events:
   - Actions use (Event "action_name" :param1 $/value). Interactive controls with action attributes MUST provide an action expression, e.g., (ActionComponent :child (ChildComponent "Text") :action (Event "click_action")).

9. Standalone Operations:
   - Delete surface: (deleteSurface "surface_id")
   - Call RPC function: (callFunction "function_name" :arg1 "value1")

10. Syntax Structure Examples (Abstract Grammar):
   Example 1 (Container with Child Nodes & Actions):
   <a2ui>
   (ContainerComponent
     (ChildComponent :title "Header")
     (InputComponent :label "Input" :value $/form/field)
     (ActionComponent :label "Submit" :action (Event "submit_action" :val $/form/field)))
   </a2ui>

   Example 2 (Root Data State & Dynamic Template):
   <a2ui>
   (ContainerComponent
     (data $/items [(:id 1 :name "Item 1")] $/title "List Title")
     (ListComponent :items $/items :template (template item (ChildComponent :title $/item/name))))
   </a2ui>

11. Strict Catalog Adherence & Conciseness:
   - You MUST ONLY use property names listed in the Component Catalog Signatures below.
   - Do NOT invent CSS or style attributes (e.g. style, padding, margin, backgroundColor, color, fontSize, size, minHeight, borderRadius, spacing, align, justify).
   - Output minimal properties required to satisfy the user request.
"""


def _get_schema_enum(prop_schema: Any) -> Optional[list[str]]:
    """Helper to recursively find enum definitions inside a JSON schema."""
    if not isinstance(prop_schema, dict):
        return None
    if "enum" in prop_schema:
        return prop_schema["enum"]
    if "oneOf" in prop_schema or "anyOf" in prop_schema:
        subs = prop_schema.get("oneOf", []) + prop_schema.get("anyOf", [])
        for sub in subs:
            enum_val = _get_schema_enum(sub)
            if enum_val:
                return enum_val
    return None


class AtomPromptGenerator(PromptGenerator):
    """Generates system prompts, grammar instructions, and component catalog signatures for Atom format.

    Attributes:
        format: The AtomFormat strategy instance.
        schema_helper: The catalog schema crawler helper.
    """

    def __init__(self, format_inst: "AtomFormat"):
        """Initializes an AtomPromptGenerator instance.

        Args:
            format_inst: The AtomFormat strategy instance.
        """
        self.format = format_inst
        try:
            from a2ui.schema.schema_helper import CatalogSchemaHelper
        except ImportError:
            from a2ui.inference_formats.experimental.express.schema_helper import (
                CatalogSchemaHelper,
            )

        try:
            self.schema_helper = CatalogSchemaHelper(format_inst.catalog)
        except Exception:
            self.schema_helper = None

    def generate(
        self,
        role_description: str = "",
        workflow_description: str = "",
        ui_description: str = "",
        client_ui_capabilities: Optional[Any] = None,
        allowed_components: Optional[list[str]] = None,
        allowed_messages: Optional[list[str]] = None,
        include_schema: bool = True,
        include_examples: bool = True,
        validate_examples: bool = False,
    ) -> str:
        """Generates a complete system prompt configured for Atom S-expression UI generation.

        Args:
            role_description: The system role description text.
            workflow_description: Additional workflow guidance text.
            ui_description: Target UI requirement details.
            client_ui_capabilities: Optional client UI capabilities specification.
            allowed_components: Optional list of allowed component names.
            allowed_messages: Optional list of allowed message types.
            include_schema: Whether to include component and function catalog signatures.
            include_examples: Whether to include prompt examples.
            validate_examples: Whether to validate prompt examples.

        Returns:
            The complete system prompt string.
        """
        parts = []
        if role_description:
            parts.append(role_description)

        rules = ATOM_RULES
        if workflow_description:
            rules += f"\n\n{workflow_description}"
        parts.append(f"## Instructions:\n{rules}")

        if include_schema and self.schema_helper:
            comp_sigs = self.generate_component_signatures()
            func_sigs = self.generate_function_signatures()
            if comp_sigs:
                parts.append(f"## Component Catalog Signatures:\n{comp_sigs}")
            if func_sigs:
                parts.append(f"## Function Signatures:\n{func_sigs}")

        return "\n\n".join(parts)

    def generate_component_signatures(self) -> str:
        """Compiles component definitions into S-expression signatures."""
        if not self.schema_helper:
            return ""
        signatures = []
        for name in sorted(self.schema_helper.component_properties.keys()):
            props = self.schema_helper.get_component_properties(name)
            reqs = self.schema_helper.get_component_required(name)
            comp_desc = self.schema_helper.get_component_description(name)

            ordered_args = []
            prop_details = []
            for p in props:
                if p in ("id", "component"):
                    continue
                is_req = p in reqs
                opt_suffix = "" if is_req else "?"
                p_schema = self.schema_helper.get_property_schema(name, p)

                arg_label = f":{p}{opt_suffix}"
                ordered_args.append(arg_label)

                p_desc = (
                    p_schema.get("description") if isinstance(p_schema, dict) else None
                )
                enum_vals = _get_schema_enum(p_schema)

                if p_desc or enum_vals:
                    p_line_parts = []
                    if p_desc:
                        p_line_parts.append(p_desc)
                    if enum_vals:
                        enum_vals_str = ", ".join([f"'{v}'" for v in enum_vals])
                        p_line_parts.append(f"Must be one of: {enum_vals_str}")
                    prop_details.append(f"  - :{p}: {' '.join(p_line_parts)}")

            sig = f"- ({name} {' '.join(ordered_args)})"
            if comp_desc:
                sig += f"\n  - {comp_desc}"
            if prop_details:
                sig += "\n" + "\n".join(prop_details)
            signatures.append(sig)
        return "\n".join(signatures)

    def generate_function_signatures(self) -> str:
        """Compiles function definitions into S-expression signatures."""
        if not self.schema_helper:
            return ""
        signatures = []
        for name in sorted(self.schema_helper.function_properties.keys()):
            props = self.schema_helper.get_function_properties(name)
            reqs = self.schema_helper.get_function_required(name)
            f_desc = self.schema_helper.get_function_description(name)

            ordered_args = []
            prop_details = []
            for p in props:
                is_req = p in reqs
                opt_suffix = "" if is_req else "?"
                p_schema = self.schema_helper.get_property_schema(name, p)

                arg_label = f":{p}{opt_suffix}"
                ordered_args.append(arg_label)

                p_desc = (
                    p_schema.get("description") if isinstance(p_schema, dict) else None
                )
                enum_vals = _get_schema_enum(p_schema)

                if p_desc or enum_vals:
                    p_line_parts = []
                    if p_desc:
                        p_line_parts.append(p_desc)
                    if enum_vals:
                        enum_vals_str = ", ".join([f"'{v}'" for v in enum_vals])
                        p_line_parts.append(f"Must be one of: {enum_vals_str}")
                    prop_details.append(f"  - :{p}: {' '.join(p_line_parts)}")

            sig = f"- ({name} {' '.join(ordered_args)})"
            if f_desc:
                sig += f"\n  - {f_desc}"
            if prop_details:
                sig += "\n" + "\n".join(prop_details)
            signatures.append(sig)
        return "\n".join(signatures)
