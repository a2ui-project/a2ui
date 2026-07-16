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

"""Prompt compiler for A2UI Express.

Compiles standard JSON catalog schemas into compact plain-text signatures and
instruction blocks for on-device models (e.g., Gemma 4).
"""

import json
import re
from typing import Any, Optional
from a2ui.prompt import PromptGenerator
from .decompiler import ExpressDecompiler
from .schema_helper import CatalogSchemaHelper

EXPRESS_RULES = r'''# A2UI Express Output Contract

You must output the user interface using the compact A2UI Express DSL notation.
You MUST surround the entire A2UI Express DSL block with the sentinel tags `<a2ui>` and `</a2ui>`.

IMPORTANT: You must ALWAYS output A2UI Express DSL notation wrapped inside `<a2ui>` and `</a2ui>` sentinel tags. Do NOT output standard JSON messages directly, even if the task request asks you to output JSON, or asks for a specific protocol message like deleteSurface or updateDataModel. The host compiler will compile your DSL into the correct JSON envelopes automatically.

## Grammar Rules

1. Output exactly one variable assignment statement per line:
   variable_name = ComponentName(arg1, arg2, ...)

   CRITICAL: Component constructors can ONLY appear on the right-hand side of a variable assignment. They CANNOT be passed directly as positional arguments to other components. You must assign every component to a variable on its own line and reference that variable name instead.

   Variable names MUST start with a letter or underscore, and only contain letters, digits, and underscores.

2. The interface tree must have a single entry point assigned to the reserved variable 'root'.

3. Primitives:
   - Strings: Quoted with `"` or `"""`. Support for `\n`, `\t`, `\\`, and `\"` escapes.
     Raw Strings: Prefaced by `r` (e.g., `r"..."` or `r"""..."""`), with no escape processing.
   - Numbers: write as integers or decimals, e.g., 42
   - Booleans: write true or false
   - Null values: write null

4. Lists: represent as arrays, e.g., [child1, child2].

5. Maps: represent as key-value blocks, e.g., {title: "Overview", child: contentCol}. Map keys are always literal strings (dynamic variable resolution is not supported for keys).

6. Data bindings: prefix absolute paths in the data model with '$', e.g., $/user/firstName.
   Prefix relative list scopes with '$', e.g., $firstName.
   A lone '$' represents an empty relative path which resolves to the root of the current context (e.g. inside a template, representing the entire item itself).

7. Logic and validation: prefix client check rules with '?', e.g., ?required or ?regex("^[0-9]{5}$"). To specify a custom error message for validation failures, append it as an extra string argument, e.g. ?regex("^[0-9]{5}$", "Postal code must be 5 digits").

8. Action events: represent server-side actions using the Event helper:
   Event("save_deal", {rep: $/form/rep})

9. Nested functions: call client functions directly using catalog signatures,
   for example openUrl("https://example.com").

10. Data model population: Assign a value directly to an absolute data path (e.g. $/path/to/key = "value") to populate or initialize values inside the shared dataModel. The value can be a primitive, array, or map.

11. Dynamic list templates: If a component expects a template child list, represent it using the _template helper:
    _template($/path/to/list, itemTemplate)
    And define the template component variable on another line, utilizing relative path references prefixed with $:
    itemTemplate = Image($url)

12. Lifecycle & Deletion: To delete a user interface surface, output the standalone `deleteSurface(surfaceId)` command (with no variable assignment):
    deleteSurface("dashboard-surface-1")

13. Static properties: Arguments annotated with '(static only)' in the signatures below MUST be defined as literal values or arrays inline (or as a local DSL variable representing a static structure). You CANNOT use a dynamic data binding path (prefixed by $) for these arguments.

14. Required actions: Parameters named 'action' (or annotated as required in component signatures) are strictly required. You must pass a valid Event (e.g. Event("click")) or function call. If no specific action is described in the user request, you must provide a dummy click event like Event("click") instead of passing null or omitting the parameter.'''



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


class ExpressPromptGenerator(PromptGenerator):
    """Generates system prompt contracts guiding models to produce A2UI Express.

    Compiles component catalog structures and logic helper catalogs into standard
    positional signatures, reducing prompt token utilization.
    """

    def __init__(self, format_or_catalog: Any):
        """Initializes the generator with the specified format or catalog.

        Args:
            format_or_catalog: An ExpressFormat or Catalog instance.
        """
        from .format import ExpressFormat

        if isinstance(format_or_catalog, ExpressFormat):
            self._format = format_or_catalog
            self.helper = None
            self.decompiler = None
        else:
            self._format = None
            self.helper = CatalogSchemaHelper(format_or_catalog)
            self.decompiler = ExpressDecompiler(format_or_catalog)

    def generate_component_signatures(self) -> str:
        """Compiles component definitions into clean function-like signatures.

        Returns:
            A plain-text multi-line list of component signatures.
        """
        signatures = []
        for name in sorted(self.helper.component_properties.keys()):
            props = self.helper.get_component_properties(name)
            reqs = self.helper.get_component_required(name)

            # Retrieve component-level description
            comp_desc = self.helper.get_component_description(name)

            ordered_args = []
            prop_details = []
            for p in props:
                is_req = p in reqs
                opt_suffix = "" if is_req else "?"

                p_schema = self.helper.get_property_schema(name, p)

                # Determine signature argument label
                arg_label = f"{p}{opt_suffix}"

                is_component_id = False
                if isinstance(p_schema, dict) and "$ref" in p_schema:
                    if "ComponentId" in p_schema["$ref"]:
                        is_component_id = True

                if is_component_id:
                    arg_label += " (component ID)"
                elif not _schema_allows_databinding(p_schema):
                    arg_label += " (static only)"

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
                sig += f"\n  - Description: {comp_desc}"
            if prop_details:
                sig += "\n" + "\n".join(prop_details)
            signatures.append(sig)
        return "\n".join(signatures)

    def generate_function_signatures(self) -> str:
        """Compiles function definitions into clean signatures.

        Returns:
            A plain-text multi-line list of function signatures.
        """
        signatures = []
        for name in sorted(self.helper.function_properties.keys()):
            props = self.helper.get_function_properties(name)
            reqs = self.helper.get_function_required(name)

            # Retrieve function-level description
            f_desc = self.helper.get_function_description(name)

            ordered_args = []
            prop_details = []

            func_schema = self.helper.functions.get(name, {})
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
                sig += f"\n  - Description: {f_desc}"
            if prop_details:
                sig += "\n" + "\n".join(prop_details)
            signatures.append(sig)
        return "\n".join(signatures)

    def _build_schema_prompt(self) -> str:
        fmt = self._format
        if fmt is None:
            from .format import ExpressFormat

            catalog = self.helper.catalog_model if self.helper else None
            fmt = ExpressFormat(catalog=catalog)

        if self.helper is None and fmt.catalog:
            self.helper = CatalogSchemaHelper(fmt.catalog)
        if self.decompiler is None and fmt.catalog:
            self.decompiler = ExpressDecompiler(fmt.catalog)

        return fmt.catalog_description(self, include_schema=True)

    def decompile(self, val: dict[str, Any]) -> str:
        if self._format:
            return self._format.decompile(val)
        dsl = self.decompiler.decompile(val)
        return dsl.replace("<a2ui>\n", "").replace("\n</a2ui>", "")

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        if self._format:
            return self._format.wrap_decompiled_blocks(blocks)
        full_dsl = "\n".join(blocks)
        return f"<a2ui>\n{full_dsl}\n</a2ui>"

    def _replace_json_block_in_instructions(self, match: re.Match[str]) -> str:
        json_content = match.group(1).strip()
        try:
            parsed = json.loads(json_content)
            if isinstance(parsed, dict):
                messages = [parsed]
            elif isinstance(parsed, list):
                messages = parsed
            else:
                return str(match.group(0))

            dsl_blocks = []
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
                    dsl_clean = self.decompile(msg)
                    dsl_blocks.append(dsl_clean)
                else:
                    return str(match.group(0))

            full_dsl = self.wrap_decompiled_blocks(dsl_blocks)
            return f"```\n{full_dsl}\n```"
        except Exception:
            return str(match.group(0))

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
                    decompiled = self.decompile(msg)
                    blocks.append(decompiled)
                else:
                    return str(match.group(0))

            return self.wrap_decompiled_blocks(blocks)
        except Exception:
            return str(match.group(0))

    def transform_examples(self, raw_examples_markdown: str) -> str:
        """Transforms JSON blocks in raw markdown into Express DSL syntax."""
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

    def generate_prompt(self) -> str:
        """Assembles the complete system instruction block for the LLM (deprecated compatibility helper)."""
        import warnings

        warnings.warn(
            "generate_prompt is deprecated. Use generate(...) instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        rules = EXPRESS_RULES
        schema_part = self._build_schema_prompt()
        return f"{rules}\n\n{schema_part}"

    def generate(
        self,
        role_description: str,
        workflow_description: str = "",
        ui_description: str = "",
        client_ui_capabilities: Optional[dict[str, Any]] = None,
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
            The complete system prompt string explaining A2UI Express and its catalog.
        """
        catalog = self._format.catalog if self._format else None
        if catalog and (allowed_components or allowed_messages):
            catalog = catalog.with_pruning(allowed_components, allowed_messages)

        if self._format:
            self.helper = CatalogSchemaHelper(catalog) if catalog else None
            self.decompiler = ExpressDecompiler(catalog) if catalog else None

        parts = [role_description]
        
        rules = EXPRESS_RULES
        if workflow_description:
            rules += f"\n\n{workflow_description}"
        parts.append(f"## Workflow Description:\n{rules}")

        if ui_description:
            parts.append(f"## UI Description:\n{ui_description}")

        if include_schema and self.helper:
            prompt = self._build_schema_prompt()
            parts.append(prompt)

        if include_examples and self._format and self._format.examples_path and catalog:
            raw_examples = catalog.load_examples(
                self._format.examples_path, validate=validate_examples
            )
            if raw_examples:
                formatted_examples = self.transform_examples(raw_examples)
                parts.append(f"### Examples:\n{formatted_examples}")

        return "\n\n".join(parts)
