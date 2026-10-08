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

"""Prompt generator for the A2UI Atom inference format."""

from collections.abc import Mapping, Sequence
import json
import re
from typing import Any, Literal, TYPE_CHECKING

from a2ui.core import A2uiValidationError, CatalogApi
from a2ui.core.schema.v0_9 import V09Capabilities
from a2ui.inference_formats._shared import (
    CatalogSchemaHelper,
    build_catalog_helpers,
    catalogs_defining,
    catalogs_protocol_version,
    normalize_prompt_example_messages,
    surface_catalog_id,
)
from a2ui.prompt import PromptGenerator
from a2ui.schema import load_examples

from .decompiler import AtomDecompiler

if TYPE_CHECKING:
    from .format import AtomFormat

# Top-level keys that mark a JSON object as an A2UI message.
_EXAMPLE_MESSAGE_KEYS = (
    "createSurface",
    "updateComponents",
    "updateDataModel",
    "deleteSurface",
    "callFunction",
    "callRendererFunction",
)

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
   - Lists: [item1 item2]. Objects: (:key1 val1 :key2 val2).

3. Property Arguments:
   - Tagged attributes: Prefixed with a colon ':', e.g., :attr1 "val1" or :attr2 true. Tagged keys are order-independent.
   - Positional attributes: Can be passed sequentially matching catalog signature order.

4. Child Components & Tree Nesting:
   - Nest child components directly inside their parent container expressions, e.g., (ContainerComponent (ChildComponent (PrimitiveComponent "Hello"))).
   - Prefer one nested root tree over flat adjacency lists. Component ids are generated for you; `:id "name"` is optional and only needed when a later update must refer to the component.

5. Data Bindings:
   - Absolute data model paths start with '$/', e.g., $/user/firstName.
   - Relative template item fields start with '$/item_var/field', e.g. $/item/name.

6. Data Model Population:
   - Initialize data model state using (data $/path1 "val1" $/path2 123) or (data $/map_path (:key1 "val1" :key2 "val2")).

7. Dynamic List Templates:
   - A template repeats one child per item of a data model list: (ListComponent :children (template :items $/items (ChildComponent $/item/name))).

8. Action Events:
   - Actions use (Event "action_name" :param1 $/value). Interactive controls with action attributes MUST provide an action expression, e.g., (ActionComponent :child (ChildComponent "Text") :action (Event "click_action")).

9. Surfaces & Standalone Operations:
   - A block normally creates the surface. To name it or set surface options, start with (surface "surface_id").
   - Update existing components: start with (updateComponents "surface_id"), then give each changed component with its `:id`.
   - Update data: (updateDataModel "surface_id" :path "/path" :value "new value"). Omit :path to replace the whole data model.
   - Delete surface: (deleteSurface "surface_id")
   - Call a client function: (callFunction "function_name" :arg1 "value1")

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
     (ListComponent :items $/items :template (template :item item (ChildComponent :title $/item/name))))
   </a2ui>

11. Strict Catalog Adherence & Conciseness:
   - You MUST ONLY use property names listed in the Component Catalog Signatures below.
   - Do NOT invent CSS or style attributes (e.g. style, padding, margin, backgroundColor, color, fontSize, size, minHeight, borderRadius, spacing, align, justify).
   - Output minimal properties required to satisfy the user request.
"""


def _get_schema_enum(prop_schema: Any) -> list[str] | None:
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
        schema_helpers: Mapping of catalog IDs to catalog schema helpers, in
            catalog order.
    """

    def __init__(self, format_inst: "AtomFormat"):
        """Initializes an AtomPromptGenerator instance.

        Args:
            format_inst: The AtomFormat strategy instance.

        Raises:
            A2uiCatalogError: If two catalogs share a catalog ID.
        """
        self._format = format_inst
        self.schema_helpers: dict[str, CatalogSchemaHelper] = {}
        self.refresh_catalogs()

    @property
    def format(self) -> "AtomFormat":
        """The AtomFormat strategy instance this generator belongs to."""
        return self._format

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs configured on this prompt generator's format."""
        return self._format.catalogs

    def refresh_catalogs(self) -> None:
        """Rebuilds the schema helpers from the format's current catalogs.

        Raises:
            A2uiCatalogError: If two catalogs share a catalog ID.
        """
        self.schema_helpers = build_catalog_helpers(self.catalogs)

    def _default_helper(self) -> CatalogSchemaHelper | None:
        return next(iter(self.schema_helpers.values()), None)

    def generate_base_rules(self) -> str:
        """Returns core syntax rules for A2UI Atom."""
        return ATOM_RULES + self._generate_multi_catalog_rules()

    def _generate_multi_catalog_rules(self) -> str:
        """Explains how components and functions find their catalog.

        Only used with several catalogs (A2UI v1.0 and later). A surface then
        has no default catalog: names are looked up across all catalogs, and
        `:catalogId` is needed only for a name that several catalogs define.
        Those names are listed, derived from the catalogs themselves.
        """
        if len(self.schema_helpers) <= 1:
            return ""
        lines = [
            "",
            "12. Multiple Catalogs:",
            (
                "   - Available catalogs:"
                f' {", ".join(f"`{cat_id}`" for cat_id in self.schema_helpers)}.'
                " A surface has no default catalog, so never name a catalog in a"
                " (surface ...) or (updateComponents ...) header."
            ),
            (
                "   - Components and functions are found by name across all"
                " catalogs. Only a component or function whose name several"
                ' catalogs define needs `:catalogId "catalog_id"` on that'
                ' expression, e.g. (ComponentName :catalogId "catalog_id" ...).'
            ),
        ]
        ambiguous = [
            *self._names_in_several_catalogs("component"),
            *self._names_in_several_catalogs("function"),
        ]
        if ambiguous:
            lines.append(
                "   - Names defined in several catalogs, which need `:catalogId`:"
            )
            lines.extend(f"     - {entry}" for entry in ambiguous)
        else:
            lines.append(
                "   - No name is defined in more than one catalog, so no"
                " expression needs `:catalogId`."
            )
        return "\n".join(lines) + "\n"

    def _names_in_several_catalogs(
        self, kind: Literal["component", "function"]
    ) -> list[str]:
        """Lists the component or function names that several catalogs define.

        Returns:
            One entry per name, sorted by name, such as
            "`Name` (component): `catalog_a`, `catalog_b`".
        """
        names = sorted({
            name
            for helper in self.schema_helpers.values()
            for name in (helper.components if kind == "component" else helper.functions)
        })
        entries = []
        for name in names:
            found = catalogs_defining(self.schema_helpers, kind, name)
            if len(found) > 1:
                cats = ", ".join(f"`{cat_id}`" for cat_id in found)
                entries.append(f"`{name}` ({kind}): {cats}")
        return entries

    def generate_catalog_instructions(
        self,
        include_schema: bool = True,
        catalog: CatalogApi | None = None,
    ) -> str:
        """Assembles Atom component and function signatures.

        Args:
            include_schema: Whether to include the signatures at all.
            catalog: An optional single catalog to describe instead of the
                configured catalogs.

        Returns:
            The signatures. With more than one configured catalog, each
            catalog gets its own section headed by its ID.
        """
        if not include_schema:
            return ""
        if catalog is not None:
            return self._catalog_body(CatalogSchemaHelper(catalog))
        if len(self.schema_helpers) <= 1:
            helper = self._default_helper()
            return self._catalog_body(helper) if helper else ""
        sections = [
            f"## Catalog `{cat_id}`\n\n{self._catalog_body(helper)}"
            for cat_id, helper in self.schema_helpers.items()
        ]
        return "\n\n".join(sections)

    def _catalog_body(self, helper: CatalogSchemaHelper) -> str:
        comps = self._generate_component_signatures(helper=helper)
        funcs = self._generate_function_signatures(helper=helper)
        parts = []
        if comps:
            parts.append(f"### Component Catalog Signatures:\n{comps}")
        if funcs:
            parts.append(f"### Function Signatures:\n{funcs}")
        return "\n\n".join(parts)

    def generate_examples(
        self,
        catalog: CatalogApi | None = None,
        validate: bool = False,
    ) -> str:
        """Loads and formats few-shot Atom examples."""
        active_catalogs = list(self.catalogs)
        if catalog is not None:
            active_catalogs = [
                catalog,
                *(c for c in active_catalogs if c is not catalog),
            ]
        if not active_catalogs or not self._format.examples_path:
            return ""
        raw_examples = load_examples(
            active_catalogs, self._format.examples_path, validate=validate
        )
        if not raw_examples:
            return ""
        return self.transform_examples(raw_examples)

    def _decompile_example_json(self, json_content: str) -> str | None:
        """Decompiles one JSON example block into a sentinel-wrapped Atom block.

        The whole payload is decompiled at once, so an update in it is read
        against the catalog of the surface the payload created.

        Returns:
            The Atom block, or None when the JSON does not parse or is not a
            payload of A2UI messages.
        """
        try:
            parsed = json.loads(json_content)
        except json.JSONDecodeError:
            return None
        messages = [parsed] if isinstance(parsed, dict) else parsed
        if not isinstance(messages, list) or not messages:
            return None
        if not all(
            isinstance(msg, dict) and any(k in msg for k in _EXAMPLE_MESSAGE_KEYS)
            for msg in messages
        ):
            return None
        catalogs = self.catalogs
        try:
            normalized = normalize_prompt_example_messages(
                messages,
                version=catalogs_protocol_version(catalogs),
                default_catalog_id=surface_catalog_id(catalogs),
            )
        except A2uiValidationError:
            # Example JSON that is not a valid message payload stays as JSON.
            return None
        decompiler = AtomDecompiler(self.catalogs)
        return decompiler.wrap_decompiled_blocks([decompiler.decompile(normalized)])

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
        """Transforms JSON blocks in raw markdown into Atom S-expression syntax."""
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

    def generate(
        self,
        role_description: str = "",
        workflow_description: str = "",
        ui_description: str = "",
        client_ui_capabilities: Mapping[str, Any] | V09Capabilities | None = None,
        allowed_components: Sequence[str] | None = None,
        allowed_messages: Sequence[str] | None = None,
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

        rules = self.generate_base_rules()
        if workflow_description:
            rules += f"\n\n{workflow_description}"
        parts.append(f"## Instructions:\n{rules}")

        if include_schema and self.schema_helpers:
            instructions = self.generate_catalog_instructions(include_schema=True)
            if instructions:
                parts.append(instructions)

        if include_examples and self._format.examples_path and self.catalogs:
            formatted_examples = self.generate_examples(validate=validate_examples)
            if formatted_examples:
                parts.append(f"### Examples:\n{formatted_examples}")

        return "\n\n".join(parts)

    def _generate_component_signatures(
        self, helper: CatalogSchemaHelper | None = None
    ) -> str:
        """Compiles component definitions into S-expression signatures."""
        h = helper or self._default_helper()
        if not h:
            return ""
        signatures = []
        for name in sorted(h.component_properties.keys()):
            props = h.get_component_properties(name)
            reqs = h.get_component_required(name)
            comp_desc = h.get_component_description(name)

            ordered_args = []
            prop_details = []
            for p in props:
                if p in ("id", "component"):
                    continue
                is_req = p in reqs
                opt_suffix = "" if is_req else "?"
                p_schema = h.get_property_schema(name, p)

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

    def _generate_function_signatures(
        self, helper: CatalogSchemaHelper | None = None
    ) -> str:
        """Compiles function definitions into S-expression signatures."""
        h = helper or self._default_helper()
        if not h:
            return ""
        signatures = []
        for name in sorted(h.function_properties.keys()):
            props = h.get_function_properties(name)
            reqs = h.get_function_required(name)
            f_desc = h.get_function_description(name)

            ordered_args = []
            prop_details = []
            for p in props:
                is_req = p in reqs
                opt_suffix = "" if is_req else "?"
                p_schema = h.get_function_property_schema(name, p)

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
