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
from a2ui.inference_format import InferenceFormat
from a2ui.parser.parser import Parser
from google.adk.utils.feature_decorator import experimental

from .prompt_generator import ExpressPromptGenerator
from .decompiler import ExpressDecompiler


@experimental
class ExpressParser(Parser):
    """Concrete parser implementation for A2UI Express DSL responses."""

    def __init__(self, catalog: A2uiCatalog, surface_id: str = "main"):
        self.catalog = catalog
        self.surface_id = surface_id

    def has_format_content(self, content: str, *, complete: bool = False) -> bool:
        if complete:
            return "<a2ui>" in content and "</a2ui>" in content
        return "<a2ui" in content

    def unwrap(self, content: str) -> List[ResponsePart]:
        """Unwraps/tokenizes the response content into raw Express DSL parts."""
        from a2ui.inference_formats.experimental.express.parser import _A2UI_DSL_BLOCK_PATTERN

        # Handle unclosed tag auto-closing
        last_open = content.rfind("<a2ui>")
        last_close = content.rfind("</a2ui>")
        if last_open != -1 and last_open > last_close:
            content += "</a2ui>"

        matches = list(_A2UI_DSL_BLOCK_PATTERN.finditer(content))
        if not matches:
            return [ResponsePart(text=content, a2ui_raw=None)]

        response_parts = []
        last_end = 0

        for idx, match in enumerate(matches):
            start, end = match.span()
            text_part = content[last_end:start].strip()

            dsl_content = match.group(1).strip()
            response_parts.append(
                ResponsePart(
                    text=text_part,
                    a2ui_raw=dsl_content,
                )
            )
            last_end = end

        trailing_text = content[last_end:].strip()
        if trailing_text:
            response_parts.append(ResponsePart(text=trailing_text, a2ui_raw=None))

        return response_parts

    def compile(self, format_content: str) -> List[dict[str, Any]]:
        """Compiles raw Express DSL to structured A2UI messages."""
        from a2ui.inference_formats.experimental.express.compiler import ExpressCompiler

        compiler = ExpressCompiler(self.catalog)
        compiled_json = compiler.compile(
            format_content, surface_id=self.surface_id, is_final=True
        )
        return [compiled_json]

    def process_chunk(self, chunk: str) -> List[ResponsePart]:
        """Express DSL is parsed as a whole script block; streaming is not supported."""
        raise NotImplementedError("Streaming parsing is not supported for Express DSL.")


@experimental
class ExpressFormat(InferenceFormat):
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
        self._prompt_generator: Optional[ExpressPromptGenerator] = None

    def _ensure_catalog(self) -> None:
        if not self.catalog or not self._decompiler:
            raise ValueError(
                "Catalog is required for parsing and decompiling in express format."
            )

    @property
    def prompt_generator(self) -> ExpressPromptGenerator:
        """Returns the PromptGenerator instance for this format."""
        if self._prompt_generator is None:
            self._prompt_generator = ExpressPromptGenerator(self)
        return self._prompt_generator

    @property
    def parser(self) -> Parser:
        self._ensure_catalog()
        return ExpressParser(self.catalog, self.surface_id)

    def has_a2ui_parts(self, content: str) -> bool:
        return "<a2ui" in content

    def format_description(
        self,
        custom_workflow_description: str = "",
        catalog_id: Optional[str] = None,
    ) -> str:
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

    def catalog_description(self, prompt_gen: Any, include_schema: bool = True) -> str:
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
