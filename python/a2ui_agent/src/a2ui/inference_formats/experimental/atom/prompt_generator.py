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

from __future__ import annotations

from collections.abc import Sequence
import json
import re
from typing import Any, Literal

from a2ui.core import A2uiValidationError, CatalogApi
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

from .decompiler import AtomDecompiler

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

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[Any]] | None = None,
        allowed_messages: Sequence[str] | None = None,
    ):
        from a2ui.inference_formats._shared import check_mixed_catalogs

        self._catalogs = list(check_mixed_catalogs(catalogs))
        self._examples = [list(t) for t in examples] if examples is not None else None
        self._allowed_messages = (
            list(allowed_messages) if allowed_messages is not None else None
        )
        self.schema_helpers: dict[str, CatalogSchemaHelper] = build_catalog_helpers(
            self._catalogs
        )

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs configured on this prompt generator."""
        return list(self._catalogs)

    def _default_helper(self) -> CatalogSchemaHelper | None:
        return next(iter(self.schema_helpers.values()), None)

    def _at_least_v10(self) -> bool:
        if not self.catalogs:
            return True
        return is_at_least_version(self.catalogs[0].protocol_version, "1.0")

    def generate_base_rules(self) -> str:
        """Returns core syntax rules for A2UI Atom.

        Standalone function calls (`callRendererFunction`) exist from protocol
        v1.0 on, so the rule for them is omitted for earlier catalogs.
        """
        rules = ATOM_RULES
        if not self._at_least_v10():
            rules = "".join(
                line
                for line in rules.splitlines(keepends=True)
                if "Call a client function:" not in line
            )
        return rules + self._generate_multi_catalog_rules()

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
            helper = self.schema_helpers.get(
                getattr(catalog, "catalog_id", None)
            ) or CatalogSchemaHelper(catalog)
            return self._catalog_body(helper)
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
        """Formats few-shot Atom examples."""
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

        decompiler = AtomDecompiler(self.catalogs)
        blocks = []
        for turn in self._examples:
            if validate:
                validate_payload(active_catalogs, to_message_dicts(turn))
            dsl = decompiler.decompile(turn)
            blocks.append(decompiler.wrap_decompiled_blocks([dsl]))
        return "\n\n".join(blocks)

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

    def generate(self) -> str:
        """Generates the prompt snippet for Atom S-expression UI generation."""
        parts = [f"## Instructions:\n{self.generate_base_rules()}"]

        if self.schema_helpers:
            instructions = self.generate_catalog_instructions(include_schema=True)
            if instructions:
                parts.append(instructions)

        formatted_examples = self.generate_examples()
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
