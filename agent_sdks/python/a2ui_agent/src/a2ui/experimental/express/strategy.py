# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import json
import re
from typing import Any, Optional, List
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.response_part import ResponsePart
from a2ui.inference_strategy import InferenceStrategy, Parser
from google.adk.utils.feature_decorator import experimental

from .prompt_generator import ExpressPromptGenerator
from .decompiler import ExpressDecompiler
from .parser import parse_express_response


@experimental
class ExpressParser(Parser):
    """Concrete parser implementation for A2UI Express DSL responses."""

    def __init__(self, catalog: A2uiCatalog, surface_id: str = "main"):
        self.catalog = catalog
        self.surface_id = surface_id

    def parse_response(self, content: str) -> List[ResponsePart]:
        """Parses Express DSL blocks wrapped inside <a2ui> tags."""
        return parse_express_response(content, self.catalog, self.surface_id)

    def process_chunk(self, chunk: str) -> List[ResponsePart]:
        """Express DSL is parsed as a whole script block; streaming is not supported."""
        raise NotImplementedError("Streaming parsing is not supported for Express DSL.")


@experimental
class ExpressInferenceStrategy(InferenceStrategy):
    """Concrete strategy for Express DSL representation."""

    def __init__(
        self,
        catalog: Optional[A2uiCatalog] = None,
        surface_id: str = "main",
        examples_path: Optional[str] = None,
    ):
        self.catalog = catalog
        self.surface_id = surface_id
        self.examples_path = examples_path
        self._decompiler = ExpressDecompiler(catalog) if catalog else None

    def _ensure_catalog(self) -> None:
        if not self.catalog or not self._decompiler:
            raise ValueError(
                "Catalog is required for parsing and decompiling in express format."
            )

    @property
    def parser(self) -> Parser:
        self._ensure_catalog()
        return ExpressParser(self.catalog, self.surface_id)

    def has_a2ui_parts(self, content: str) -> bool:
        return "<a2ui" in content

    def format_description(self, custom_workflow_description: str = "") -> str:
        rules = r'''# A2UI Express Output Contract

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
        if custom_workflow_description:
            rules += f"\n\n{custom_workflow_description}"
        return rules

    def catalog_description(
        self, prompt_gen: ExpressPromptGenerator, include_schema: bool = True
    ) -> str:
        if not include_schema:
            return ""
        comp_sigs = prompt_gen.generate_component_signatures()
        func_sigs = prompt_gen.generate_function_signatures()
        catalog_instructions = prompt_gen.helper.catalog.get("instructions", "")

        # Translate json examples in catalog instructions into A2UI Express DSL
        if catalog_instructions:
            pattern = r"```json\s*\n(.*?)\n```"

            def replace_json_block(match):
                json_content = match.group(1).strip()
                try:
                    parsed = json.loads(json_content)
                    if isinstance(parsed, dict):
                        messages = [parsed]
                    elif isinstance(parsed, list):
                        messages = parsed
                    else:
                        return match.group(0)

                    dsl_blocks = []
                    for msg in messages:
                        if any(
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
                            return match.group(0)

                    full_dsl = "<a2ui>\n" + "\n".join(dsl_blocks) + "\n</a2ui>"
                    return f"```\n{full_dsl}\n```"
                except Exception:
                    return match.group(0)

            catalog_instructions = re.sub(
                pattern, replace_json_block, catalog_instructions, flags=re.DOTALL
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

    def decompile(self, val: dict[str, Any]) -> str:
        self._ensure_catalog()
        # Decompile standard JSON payload to express syntax and strip outer <a2ui> tags
        dsl = self._decompiler.decompile(val)
        return dsl.replace("<a2ui>\n", "").replace("\n</a2ui>", "")

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        # Merge individual express blocks into a single <a2ui> wrapper block
        full_dsl = "\n".join(blocks)
        return f"<a2ui>\n{full_dsl}\n</a2ui>"

    def transform_examples(self, raw_examples_markdown: str) -> str:
        """Transforms JSON blocks in raw markdown into Express DSL syntax."""
        if not self.catalog:
            return raw_examples_markdown

        triple_backticks = chr(96) * 3
        pattern = rf"{triple_backticks}json\s*\n(.*?)\n{triple_backticks}"

        def replace_json_block(match: re.Match[str]) -> str:
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

        return re.sub(
            pattern, replace_json_block, raw_examples_markdown, flags=re.DOTALL
        )

    def generate_system_prompt(
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
        format_strategy: Optional[Any] = None,
    ) -> str:
        """Assembles the final system instruction prompt for Express DSL."""
        catalog = self.catalog
        if catalog and (allowed_components or allowed_messages):
            catalog = catalog.with_pruning(allowed_components, allowed_messages)

        prompt_gen = ExpressPromptGenerator(catalog) if catalog else None

        parts = [role_description]

        workflow = self.format_description(workflow_description)
        parts.append(f"## Workflow Description:\n{workflow}")

        if ui_description:
            parts.append(f"## UI Description:\n{ui_description}")

        if include_schema and prompt_gen:
            parts.append(self.catalog_description(prompt_gen, include_schema))

        if include_examples and self.examples_path and catalog:
            raw_examples = catalog.load_examples(
                self.examples_path, validate=validate_examples
            )
            if raw_examples:
                formatted_examples = self.transform_examples(raw_examples)
                parts.append(f"### Examples:\n{formatted_examples}")

        return "\n\n".join(parts)
