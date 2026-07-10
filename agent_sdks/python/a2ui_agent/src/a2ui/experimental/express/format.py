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
from functools import partial
from typing import List, Any
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.response_part import ResponsePart
from a2ui.formats import InferenceFormat
from .prompt_generator import ExpressPromptGenerator
from .decompiler import ExpressDecompiler
from .parser import parse_express_response


EXPRESS_GRAMMAR_RULES = r'''# A2UI Express Output Contract

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

14. Required actions: Parameters named 'action' (or annotated as required in component signatures) are strictly required. You must pass a valid Event (e.g. Event("click")) or function call. If no specific action is described in the user request, you must provide a dummy click event like Event("click") instead of passing null or omitting the parameter.
'''


def _replace_json_block(match, decompiler) -> str:
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
            if isinstance(msg, dict) and any(
                k in msg
                for k in [
                    "createSurface",
                    "updateDataModel",
                    "deleteSurface",
                    "callFunction",
                ]
            ):
                dsl = decompiler.decompile(msg)
                dsl_clean = dsl.replace("<a2ui>\n", "").replace("\n</a2ui>", "")
                dsl_blocks.append(dsl_clean)
            else:
                return match.group(0)

        full_dsl = "<a2ui>\n" + "\n".join(dsl_blocks) + "\n</a2ui>"
        return f"```\n{full_dsl}\n```"
    except Exception:
        return match.group(0)


class ExpressInferenceFormat(InferenceFormat):
    """A2UI Express DSL format strategy."""

    @property
    def name(self) -> str:
        return "express"

    def generate_workflow_rules(self, custom_workflow_description: str = "") -> str:
        rules = EXPRESS_GRAMMAR_RULES
        if custom_workflow_description:
            rules += f"\n{custom_workflow_description}"
        return rules

    def generate_instructions(self, catalog: A2uiCatalog) -> str:
        generator = ExpressPromptGenerator(catalog)
        comp_sigs = generator.generate_component_signatures()
        func_sigs = generator.generate_function_signatures()

        return (
            "## Positional Component Signatures\n\nUse these exact positional"
            " signatures to instantiate components. Do not output property"
            f" keys:\n{comp_sigs}\n\n## Positional Function Signatures\n\nUse these"
            " exact positional signatures to instantiate check rules or logic"
            f" functions:\n{func_sigs}"
        )

    def transform_examples(
        self, raw_examples_markdown: str, catalog: A2uiCatalog
    ) -> str:
        decompiler = ExpressDecompiler(catalog)
        pattern = r"```json\s*\n(.*?)\n```"

        replace_func = partial(_replace_json_block, decompiler=decompiler)
        return re.sub(pattern, replace_func, raw_examples_markdown, flags=re.DOTALL)

    def parse_response(
        self,
        content: str,
        catalog: A2uiCatalog,
        surface_id: str | None = None,
    ) -> List[ResponsePart]:
        surf_id = surface_id or self.default_surface_id
        return parse_express_response(content, catalog, surface_id=surf_id)

    def decompile(self, val: dict[str, Any], catalog: A2uiCatalog) -> str:
        return ExpressDecompiler(catalog).decompile(val)

    def detect_format(self, content: str) -> bool:
        return "<a2ui>" in content and "</a2ui>" in content
