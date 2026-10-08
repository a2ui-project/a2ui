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

from collections.abc import Mapping, Sequence
import json
import re
from typing import Any, TYPE_CHECKING

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.core.schema.v0_9 import V09Capabilities
from a2ui.inference_formats._shared import (
    CatalogSchemaHelper,
    build_catalog_helpers,
    catalogs_defining,
    normalize_prompt_example_messages,
    surface_catalog_id,
)
from a2ui.prompt import PromptGenerator
from a2ui.schema import load_examples

if TYPE_CHECKING:
    from .format import ExpressFormat

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


class ExpressPromptGenerator(PromptGenerator):
    """Generates system prompt contracts guiding models to produce A2UI Express.

    Compiles component catalog structures and logic helper catalogs into standard
    positional signatures, reducing prompt token utilization.
    """

    def __init__(self, format_inst: "ExpressFormat"):
        """Initializes the generator with the specified format.

        Args:
            format_inst: An ExpressFormat instance. The generator reads the
                format's catalogs, version and parser whenever it needs them,
                so it follows later changes to the format.
        """
        self._format = format_inst
        self._helpers_cache: tuple[list[CatalogApi], dict[str, CatalogSchemaHelper]] = (
            [],
            {},
        )

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the catalogs configured on this prompt generator's format."""
        return self._format.catalogs

    @property
    def helpers(self) -> dict[str, CatalogSchemaHelper]:
        """Schema helpers for the format's current catalogs, keyed by catalog ID."""
        catalogs = self.catalogs
        cached_catalogs, cached_helpers = self._helpers_cache
        # `catalogs` is a fresh copy on every read, so compare the catalogs.
        if len(cached_catalogs) != len(catalogs) or any(
            a is not b for a, b in zip(cached_catalogs, catalogs)
        ):
            cached_helpers = build_catalog_helpers(catalogs)
            self._helpers_cache = (catalogs, cached_helpers)
        return cached_helpers

    def generate_base_rules(self) -> str:
        """Returns the core syntax contract and grammar rules for A2UI Express.

        With more than one active catalog, rules that explain how components
        and functions are found by name, and when they need a `catalogId`,
        follow the grammar rules.
        """
        if len(self.catalogs) <= 1:
            return EXPRESS_RULES
        return f"{EXPRESS_RULES}\n\n{_multi_catalog_rules(self.helpers)}"

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
        """Loads and formats few-shot Express DSL examples."""
        active_catalogs = list(self.catalogs)
        if catalog is not None:
            active_catalogs = [
                catalog,
                *(c for c in active_catalogs if c is not catalog),
            ]
        if not active_catalogs or not self._format or not self._format.examples_path:
            return ""
        raw_examples = load_examples(
            active_catalogs, self._format.examples_path, validate=validate
        )
        if not raw_examples:
            return ""
        return self.transform_examples(raw_examples)

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
            CatalogSchemaHelper(catalog)
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
        """Decompiles structured A2UI payload messages into Express DSL.

        Args:
            a2ui_payload: Sequence of AgentToRendererMessage objects.

        Returns:
            The Express DSL string representation of the payload.
        """
        return self._format.parser.decompile(a2ui_payload)

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        """Encloses decompiled DSL code blocks in markdown code fences and sentinel tags.

        Args:
            blocks: A list of Express DSL snippet strings.

        Returns:
            The enclosed and formatted markdown block.
        """
        return self._format.parser.wrap_decompiled_blocks(blocks)

    def _decompile_example_messages(
        self, json_content: str, default_catalog_id: str | None = None
    ) -> str | None:
        """Decompiles a JSON example payload into one Express block.

        The whole payload is decompiled at once, so that an update in it is
        read against the catalog of the surface the payload created.

        Args:
            json_content: The JSON example.
            default_catalog_id: The catalog of a surface that the example
                creates without naming one. Defaults to the single catalog, or
                none when several catalogs are active.

        Returns:
            The Express block without sentinel tags, or None when the JSON is
            not a payload of A2UI messages or cannot be decompiled.
        """
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
                    version=self._format.version,
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

    def generate(
        self,
        role_description: str,
        workflow_description: str = "",
        ui_description: str = "",
        client_ui_capabilities: Mapping[str, Any] | V09Capabilities | None = None,
        allowed_components: Sequence[str] | None = None,
        allowed_messages: Sequence[str] | None = None,
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
            The complete system prompt string explaining A2UI Express and its catalog.
        """
        return super().generate(
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
