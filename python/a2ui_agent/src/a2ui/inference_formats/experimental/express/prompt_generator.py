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

"""Prompt compiler for A2UI Express.

Compiles A2UI catalog schemas into compact plain-text signatures and
instruction blocks.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import json
import re
from typing import Any

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_formats._shared import (
    CatalogSchemaHelper,
    build_catalog_helpers,
    catalogs_defining,
    normalize_prompt_example_messages,
    surface_catalog_id,
)
from a2ui.prompt import PromptGenerator

# Envelope keys of the messages a JSON example may hold to be decompiled.
_EXAMPLE_MESSAGE_KEYS = (
    "createSurface",
    "updateComponents",
    "updateDataModel",
    "deleteSurface",
    "callFunction",
    "callRendererFunction",
)

EXPRESS_RULES = r'''# A2UI Express DSL Output Contract

You must output the user interface using A2UI Express.

IMPORTANT: You MUST always surround the entire A2UI Express block with the sentinel tags `<a2ui>` and `</a2ui>`.

The host compiler will compile your A2UI Express output into the correct JSON envelopes automatically.

## Grammar Rules

1. Component constructors can be assigned to variables or nested inline inside parent component arguments:
   header = ComponentA(prop1="val1")
   root = ComponentB([header, ComponentC("Click", action=Event("submit"))])

   Keyword arguments (`param=value`) and positional arguments with `_` placeholders are supported.

   Variable names MUST start with a letter or underscore, and only contain letters, digits, and underscores.

2. The interface tree must have a single entry point assigned to the reserved variable 'root'.

3. Primitives:
   - Strings: Quoted with `"` or `"""`. Support for `\n`, `\t`, `\\`, and `\"` escapes.
     Raw Strings: Prefaced by `r` (e.g., `r"..."` or `r"""..."""`), with no escape processing.
   - Numbers: write as integers or decimals, e.g., 42
   - Booleans: write true or false
   - Null values: write null
   - Dates & Times: Values for date-time inputs (e.g. in DateTimeInput) must strictly use RFC 3339 format with a timezone offset (e.g. "2026-03-14T00:00:00Z").

4. Lists: represent as arrays, e.g., [child1, child2].

5. Maps: represent as key-value blocks, e.g., {title: "Overview", child: contentCol}. Map keys are always literal strings (dynamic variable resolution is not supported for keys).

6. Data bindings: prefix absolute paths in the data model with '$', e.g., $/user/firstName.
   Prefix relative list scopes with '$', e.g., $firstName.
   A lone '$' represents an empty relative path which resolves to the root of the current context (e.g. inside a template, representing the entire item itself).

7. Logic and validation: prefix client check rules with '?', e.g., ?required or ?regex("^[0-9]{5}$"). To specify a custom error message for validation failures, append it as an extra string argument, e.g. ?regex("^[0-9]{5}$", "Postal code must be 5 digits").

8. Action events: represent server-side actions using the Event helper:
   Event("save_deal", {rep: $/form/rep})

9. Nested functions: call client functions directly using catalog signatures, for example myFunction("value").

10. Data model population: Assign a value directly to an absolute data path (e.g. $/path/to/key = "value") to populate or initialize values inside the shared dataModel. The value can be a primitive, array, or map.

11. Dynamic list templates: If a component expects a template child list, represent it using the _template helper:
    _template($/path/to/list, itemTemplate)
    And define the template component variable on another line, utilizing relative path references prefixed with $:
    itemTemplate = Image($url)

12. To delete a user interface surface, output the standalone `deleteSurface(surfaceId)` command (no variable assignment):
    deleteSurface("dashboard-surface-1")

13. Static properties: Arguments annotated with '(static)' in the signatures below MUST be defined as literal values or arrays inline. You CANNOT use a dynamic data binding path (prefixed by $) for these arguments.

14. Required actions: Parameters named 'action' (or annotated in component signatures) are strictly required. You must pass a valid Event (e.g. Event("click")) or function call. If no specific action is described in the user request, you must provide a dummy click event like Event("click") instead of passing null or omitting the parameter.

15. Surface targeting: Output `surface(surfaceId)` to specify or target a user interface surface:
    surface("dashboard-surface-1")
    root = ComponentA(...)'''


def _multi_catalog_rules(helpers: Mapping[str, CatalogSchemaHelper]) -> str:
    """Builds the rules that explain how to use several catalogs.

    The rules are written from the catalog IDs and the names each catalog
    defines, so they hold for any catalogs.

    Args:
        helpers: The schema helpers keyed by catalog ID, in catalog order.

    Returns:
        The rules, as a markdown section.
    """
    catalog_ids = list(helpers)
    example_id = catalog_ids[-1]
    listing = "\n".join(f"- `{cat_id}`" for cat_id in catalog_ids)
    rules = [
        "## Multiple Catalogs",
        "",
        (
            "Several component catalogs are active. Each is identified by its catalog"
            " ID, and the signatures below are grouped by catalog:"
        ),
        listing,
        "",
        (
            "16. A surface has no catalog of its own: do not name a catalog on a"
            " `surface` line. Each component and function call, including checks,"
            " actions, nested function calls and inline child components, is found"
            " by its name in whichever catalog defines it."
        ),
        "",
        (
            "17. When several catalogs define the same component or function name,"
            " you MUST say which one you mean: add a `catalogId` keyword argument"
            " to the component or function call, or a `{catalogId: ...}` argument"
            " to a check. Do not add `catalogId` to any other name:"
        ),
        f'    widget = ComponentName(..., catalogId="{example_id}")',
        f'    action = functionName(..., catalogId="{example_id}")',
        f'    ?checkName(..., {{catalogId: "{example_id}"}})',
    ]
    shared = []
    for kind, label in (("component", "Component"), ("function", "Function")):
        names = {
            name
            for helper in helpers.values()
            for name in (helper.components if kind == "component" else helper.functions)
        }
        for name in sorted(names):
            defining = catalogs_defining(helpers, kind, name)
            if len(defining) > 1:
                ids = ", ".join(f"`{cat_id}`" for cat_id in defining)
                shared.append(f"- {label} `{name}`: {ids}")
    if shared:
        rules.extend([
            "",
            "These names are defined in several catalogs and need a `catalogId`:",
            *shared,
        ])
    return "\n".join(rules)


def _schema_allows_databinding(prop_schema: Any) -> bool:
    """Helper to check if a JSON schema allows data binding (DynamicString/DataBinding, etc)."""
    if not isinstance(prop_schema, dict):
        return False
    if "$ref" in prop_schema:
        ref = prop_schema["$ref"]
        if "DataBinding" in ref or "Dynamic" in ref or "ChildList" in ref:
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


def _filter_express_rules(allowed_messages: Sequence[str]) -> str:
    """Filters EXPRESS_RULES to only the rules for the allowed message types."""
    allowed = set(allowed_messages)
    creates = "createSurface" in allowed or "CreateSurfaceMessage" in allowed
    components = (
        creates or "updateComponents" in allowed or "UpdateComponentsMessage" in allowed
    )
    data = "updateDataModel" in allowed or "UpdateDataModelMessage" in allowed
    delete = "deleteSurface" in allowed or "DeleteSurfaceMessage" in allowed

    contract, _, rules_block = EXPRESS_RULES.partition("## Grammar Rules\n\n")
    raw_rules = re.split(r"\n\n(?=\d+\. )", rules_block.strip())
    rule_bodies = [
        re.sub(r"^\d+\. ", "", r).replace("\n   ", "\n").replace("\n    ", "\n ")
        for r in raw_rules
    ]
    # rule_bodies indices (0-based, matching rules 1..15):
    # 0: components, 1: root, 2..5: values, 6..8: calls, 9: dataModel,
    # 10: template, 11: deleteSurface, 12..13: arguments, 14: surface
    selected: list[str] = []
    if components:
        selected.append(rule_bodies[0])
    if creates:
        selected.append(rule_bodies[1])
    selected.extend(rule_bodies[2:6])
    if components:
        selected.extend(rule_bodies[6:9])
    if data:
        selected.append(rule_bodies[9])
    if components:
        selected.append(rule_bodies[10])
    if delete:
        selected.append(rule_bodies[11])
    if components:
        selected.extend(rule_bodies[12:14])
    if components or data:
        surface_rule = rule_bodies[14]
        if not creates:
            surface_rule = "\n".join(surface_rule.splitlines()[:-1])
        selected.append(surface_rule)

    out = [f"{contract}## Grammar Rules"]
    for idx, body in enumerate(selected, start=1):
        prefix = f"{idx}. "
        indented = re.sub(r"\n(?!\n)", "\n" + (" " * len(prefix)), body)
        out.append(f"{prefix}{indented}")
    return "\n\n".join(out)


class ExpressPromptGenerator(PromptGenerator):
    """Generates system prompt contracts guiding models to produce A2UI Express.

    Compiles component catalog structures and logic helper catalogs into standard
    positional signatures, reducing prompt token utilization.
    """

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
        allowed_messages: Sequence[str] | None = None,
        *,
        version: str | None = None,
    ):
        from .decompiler import ExpressDecompiler
        from a2ui.inference_formats._shared import (
            catalogs_protocol_version,
            check_mixed_catalogs,
        )

        checked = check_mixed_catalogs(catalogs)
        self._catalogs = list(checked)
        self._examples = [list(t) for t in examples] if examples is not None else None
        self._allowed_messages = (
            list(allowed_messages) if allowed_messages is not None else None
        )
        self._version = version or catalogs_protocol_version(checked)
        self._helpers = build_catalog_helpers(self._catalogs)
        self._decompiler = ExpressDecompiler(self._catalogs)

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs configured on this prompt generator."""
        return list(self._catalogs)

    @property
    def helpers(self) -> dict[str, CatalogSchemaHelper]:
        """Schema helpers for the format's catalogs, keyed by catalog ID."""
        return self._helpers

    def generate_base_rules(self, allowed_messages: Sequence[str] | None = None) -> str:
        """Returns the core syntax contract and grammar rules for A2UI Express."""
        effective_allowed = (
            allowed_messages if allowed_messages is not None else self._allowed_messages
        )
        base = (
            EXPRESS_RULES
            if effective_allowed is None
            else _filter_express_rules(effective_allowed)
        )
        if len(self.catalogs) <= 1:
            return base
        if effective_allowed is not None:
            allowed_set = set(effective_allowed)
            has_comp_or_data = any(
                m in allowed_set
                for m in (
                    "createSurface",
                    "CreateSurfaceMessage",
                    "updateComponents",
                    "UpdateComponentsMessage",
                    "updateDataModel",
                    "UpdateDataModelMessage",
                )
            )
            if not has_comp_or_data:
                return base
        return f"{base}\n\n{_multi_catalog_rules(self.helpers)}"

    def generate_catalog_instructions(
        self,
        include_schema: bool = True,
        catalog: Any | None = None,
    ) -> str:
        """Assembles positional signatures and instructions for one or all catalogs."""
        if not include_schema:
            return ""
        if catalog is not None:
            return self._catalog_description(include_schema=True, catalog=catalog)
        active_catalogs = self.catalogs
        if len(active_catalogs) <= 1:
            return self._catalog_description(include_schema=True)
        sections = []
        for cat in active_catalogs:
            desc = self._catalog_description(include_schema=True, catalog=cat)
            sections.append(f"# Catalog `{cat.catalog_id}`\n\n{desc}")
        return "\n\n".join(sections)

    def generate_examples(
        self, catalog: Any | None = None, validate: bool = False
    ) -> str:
        """Formats few-shot Express DSL examples."""
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

        blocks = []
        for turn in self._examples:
            if validate:
                validate_payload(active_catalogs, to_message_dicts(turn))
            dsl = self.decompile(turn)
            blocks.append(self.wrap_decompiled_blocks([dsl]))
        return "\n\n".join(blocks)

    def _generate_component_signatures(
        self, helper: CatalogSchemaHelper | None = None
    ) -> str:
        """Compiles component definitions into clean function-like signatures.

        Returns:
            A plain-text multi-line list of component signatures.
        """
        h = helper or next(iter(self.helpers.values()), None)
        if not h:
            return ""
        signatures = []
        for name in sorted(h.component_properties.keys()):
            props = h.get_component_properties(name)
            reqs = h.get_component_required(name)

            # Retrieve component-level description
            comp_desc = h.get_component_description(name)

            ordered_args = []
            prop_details = []
            for p in props:
                is_req = p in reqs
                opt_suffix = "" if is_req else "?"

                p_schema = h.get_property_schema(name, p)

                # Determine signature argument label
                arg_label = f"{p}{opt_suffix}"

                is_component_id = False
                if isinstance(p_schema, dict) and "$ref" in p_schema:
                    if "ComponentId" in p_schema["$ref"]:
                        is_component_id = True

                if is_component_id:
                    arg_label += " (component ID)"
                elif not _schema_allows_databinding(p_schema):
                    arg_label += " (static)"

                ordered_args.append(arg_label)

                # Retrieve parameter description
                p_desc = (
                    p_schema.get("description") if isinstance(p_schema, dict) else None
                )
                enum_vals = _get_schema_enum(p_schema)

                # Build property detail description
                if p_desc or enum_vals:
                    p_line_parts = []
                    if p_desc:
                        p_line_parts.append(p_desc)
                    if enum_vals:
                        enum_vals_str = ", ".join([f"'{v}'" for v in enum_vals])
                        p_line_parts.append(f"Must be one of: {enum_vals_str}")
                    prop_details.append(f"  - {p}: {' '.join(p_line_parts)}")

                # Fetch property schema and check if it has nested object structure
                if isinstance(p_schema, dict):
                    if p_schema.get("type") == "object" and "properties" in p_schema:
                        sub_keys = []
                        for sub_k, sub_v in p_schema["properties"].items():
                            desc = sub_v.get("description", "")
                            desc_suffix = f" - {desc}" if desc else ""
                            sub_keys.append(f"    * {sub_k}{desc_suffix}")

                        if prop_details and prop_details[-1].startswith(f"  - {p}:"):
                            prop_details[-1] += "\n    Map keys:\n" + "\n".join(
                                sub_keys
                            )
                        else:
                            prop_details.append(
                                f"  - {p}: Map with keys:\n" + "\n".join(sub_keys)
                            )
                    elif p_schema.get("type") == "array" and "items" in p_schema:
                        items_schema = p_schema["items"]
                        if (
                            isinstance(items_schema, dict)
                            and items_schema.get("type") == "object"
                            and "properties" in items_schema
                        ):
                            sub_keys = []
                            for sub_k, sub_v in items_schema["properties"].items():
                                desc = sub_v.get("description", "")
                                desc_suffix = f" - {desc}" if desc else ""
                                sub_keys.append(f"    * {sub_k}{desc_suffix}")

                            if prop_details and prop_details[-1].startswith(
                                f"  - {p}:"
                            ):
                                prop_details[
                                    -1
                                ] += "\n    List of maps keys:\n" + "\n".join(sub_keys)
                            else:
                                prop_details.append(
                                    f"  - {p}: List of maps with keys:\n"
                                    + "\n".join(sub_keys)
                                )

            sig = f"• {name}({', '.join(ordered_args)})"
            if comp_desc:
                desc_indented = comp_desc.replace("\n", "\n    ")
                sig += f"\n  - Description: {desc_indented}"
            if prop_details:
                sig += "\n" + "\n".join(prop_details)
            signatures.append(sig)
        return "\n".join(signatures)

    def _generate_function_signatures(
        self, helper: CatalogSchemaHelper | None = None
    ) -> str:
        """Compiles function definitions into clean signatures.

        Returns:
            A plain-text multi-line list of function signatures.
        """
        h = helper or next(iter(self.helpers.values()), None)
        if not h:
            return ""
        signatures = []
        for name in sorted(h.function_properties.keys()):
            props = h.get_function_properties(name)
            reqs = h.get_function_required(name)

            # Retrieve function-level description
            f_desc = h.get_function_description(name)

            ordered_args = []
            prop_details = []

            func_schema = h.functions.get(name, {})
            args_properties = (
                func_schema.get("properties", {}).get("args", {}).get("properties", {})
            )

            for p in props:
                is_req = p in reqs
                opt_suffix = "" if is_req else "?"
                ordered_args.append(f"{p}{opt_suffix}")

                p_schema = args_properties.get(p, {})
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

    def _build_schema_prompt(self) -> str:
        return self.generate_catalog_instructions(include_schema=True)

    def _catalog_description(
        self, include_schema: bool = True, catalog: Any | None = None
    ) -> str:
        """Assembles the system prompt component catalog signatures block.

        Args:
            include_schema: Whether to include the schema description.
            catalog: Optional catalog override to render signatures for.

        Returns:
            The rendered LLM instructions string block containing positional signatures.
        """
        if not include_schema:
            return ""

        h = (
            self.helpers.get(catalog.catalog_id) or CatalogSchemaHelper(catalog)
            if catalog
            else next(iter(self.helpers.values()), None)
        )
        comp_sigs = self._generate_component_signatures(helper=h)
        func_sigs = self._generate_function_signatures(helper=h)
        catalog_instructions = h.catalog.get("instructions", "") if h else ""

        # Translate json examples in catalog instructions into A2UI Express DSL.
        # An example in a catalog's instructions belongs to that catalog.
        if catalog_instructions and h:
            instructions_catalog_id = h.catalog_model.catalog_id
            pattern = r"```json\s*\n(.*?)\n```"
            catalog_instructions = re.sub(
                pattern,
                lambda match: self._replace_json_block_in_instructions(
                    match, instructions_catalog_id
                ),
                catalog_instructions,
                flags=re.DOTALL,
            )

        # Format catalog instructions block if it exists
        catalog_instructions_block = ""
        if catalog_instructions:
            catalog_instructions_block = (
                f"\n\n## Catalog Instructions\n\n{catalog_instructions}"
            )

        desc = (
            "## Positional Component Signatures\n\nUse these exact positional"
            " signatures to instantiate components. Do not output property"
            f" keys:\n{comp_sigs}\n\n## Positional Function Signatures\n\nUse these"
            " exact positional signatures to instantiate check rules or logic"
            f" functions:\n{func_sigs}{catalog_instructions_block}"
        )
        return desc

    def decompile(self, a2ui_payload: Sequence[AgentToRendererMessage]) -> str:
        """Decompiles structured A2UI payload messages into Express DSL."""
        return self._decompiler.decompile(a2ui_payload)

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        """Encloses decompiled DSL code blocks in markdown code fences and sentinel tags."""
        return self._decompiler.wrap_decompiled_blocks(blocks)

    def _decompile_example_messages(
        self, json_content: str, default_catalog_id: str | None = None
    ) -> str | None:
        """Decompiles a JSON example payload into one Express block."""
        try:
            parsed = json.loads(json_content)
            messages = [parsed] if isinstance(parsed, dict) else parsed
            if not isinstance(messages, list) or not messages:
                return None
            if not all(
                isinstance(msg, dict) and any(k in msg for k in _EXAMPLE_MESSAGE_KEYS)
                for msg in messages
            ):
                return None
            return self.decompile(
                normalize_prompt_example_messages(
                    messages,
                    version=self._version,
                    default_catalog_id=(
                        default_catalog_id or surface_catalog_id(self.catalogs)
                    ),
                )
            )
        except Exception:
            return None

    def _replace_json_block_in_instructions(
        self, match: re.Match[str], catalog_id: str
    ) -> str:
        dsl = self._decompile_example_messages(match.group(1).strip(), catalog_id)
        if dsl is None:
            return str(match.group(0))
        return f"```\n{self.wrap_decompiled_blocks([dsl])}\n```"

    def _decompile_example_json(self, json_content: str) -> str | None:
        dsl = self._decompile_example_messages(json_content)
        return None if dsl is None else self.wrap_decompiled_blocks([dsl])

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
        """Transforms JSON blocks in raw markdown into Express DSL syntax."""
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
        """Assembles the prompt snippet for A2UI Express."""
        parts: list[str] = []

        rules = self.generate_base_rules()
        if rules:
            parts.append(f"## Workflow Description:\n{rules}")

        catalog_inst = self.generate_catalog_instructions(include_schema=True)
        if catalog_inst:
            parts.append(catalog_inst)

        examples = self.generate_examples()
        if examples:
            parts.append(f"### Examples:\n{examples}")

        return "\n\n".join(parts)
