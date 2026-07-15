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

from .prompt_generator import ElementalPromptGenerator
from .decompiler import ElementalDecompiler


@experimental
class ElementalParser(Parser):
    """Concrete parser implementation for A2UI Elemental TSX/HTML5 responses."""

    def __init__(self, catalog: A2uiCatalog, surface_id: str = "main"):
        self.catalog = catalog
        self.surface_id = surface_id

    def has_format_content(self, content: str, *, complete: bool = False) -> bool:
        if complete:
            return "<a2ui" in content and "</a2ui>" in content
        return "<a2ui" in content

    def unwrap(self, content: str) -> List[ResponsePart]:
        """Unwraps/tokenizes the response content into raw Elemental HTML parts."""
        import re
        from a2ui.inference_formats.experimental.elemental.parser import _A2UI_OPEN_PATTERN
        from a2ui.inference_formats.experimental.elemental.compiler import TAG_PREFIX

        content_lower = content.lower()
        last_open_match = list(_A2UI_OPEN_PATTERN.finditer(content))
        last_close = content_lower.rfind("</a2ui>")

        is_truncated = False
        if last_open_match:
            last_open = last_open_match[-1].start()
            if last_open > last_close:
                content += "\n</a2ui>"
                is_truncated = True

        block_pattern = re.compile(
            r"<a2ui\b[^>]*>.*</a2ui>"
            f"|<{TAG_PREFIX}delete-surface\\b[^>]*>(?:.*?</{TAG_PREFIX}delete-surface>|/>)?"
            f"|<{TAG_PREFIX}call-function\\b[^>]*>(?:.*?</{TAG_PREFIX}call-function>|/>)?",
            re.DOTALL | re.IGNORECASE,
        )
        matches = list(block_pattern.finditer(content))

        if not matches:
            return [ResponsePart(text=content, a2ui_raw=None)]

        response_parts = []
        last_end = 0

        for idx, match in enumerate(matches):
            start, end = match.span()

            text_part = content[last_end:start]
            text_part_stripped = re.sub(
                r"```html\s*$", "", text_part, flags=re.IGNORECASE
            ).strip()

            html_content = match.group(0).strip()
            response_parts.append(
                ResponsePart(
                    text=text_part_stripped if text_part_stripped else "",
                    a2ui_raw=html_content,
                )
            )
            last_end = end

        trailing_text = content[last_end:].strip()
        if trailing_text:
            response_parts.append(ResponsePart(text=trailing_text, a2ui_raw=None))

        return response_parts

    def compile(self, format_content: str) -> List[dict[str, Any]]:
        """Compiles raw Elemental HTML to structured A2UI messages."""
        from a2ui.inference_formats.experimental.elemental.compiler import ElementalCompiler

        compiler = ElementalCompiler(self.catalog)
        compiled_json = compiler.compile(
            format_content, surface_id=self.surface_id, is_final=True
        )
        return [compiled_json]

    def process_chunk(self, chunk: str) -> List[ResponsePart]:
        """Elemental is parsed as a whole HTML5 document; streaming is not supported."""
        raise NotImplementedError(
            "Streaming parsing is not supported for Elemental HTML."
        )


@experimental
class ElementalFormat(InferenceFormat):
    """Elemental HTML5-like markup format strategy."""

    def __init__(
        self,
        catalog: Optional[A2uiCatalog] = None,
        surface_id: str = "main",
        examples_path: Optional[str] = None,
    ):
        self.catalog = catalog
        self.surface_id = surface_id
        self.examples_path = examples_path
        self._decompiler = ElementalDecompiler(catalog) if catalog else None
        self._prompt_generator: Optional[ElementalPromptGenerator] = None

    def _ensure_catalog(self) -> None:
        if not self.catalog or not self._decompiler:
            raise ValueError(
                "Catalog is required for parsing and decompiling in elemental format."
            )

    @property
    def prompt_generator(self) -> ElementalPromptGenerator:
        """Returns the PromptGenerator instance for this format."""
        if self._prompt_generator is None:
            self._prompt_generator = ElementalPromptGenerator(self)
        return self._prompt_generator

    @property
    def parser(self) -> Parser:
        self._ensure_catalog()
        return ElementalParser(self.catalog, self.surface_id)

    def format_description(
        self,
        prompt_gen: Optional[ElementalPromptGenerator] = None,
        custom_workflow_description: str = "",
    ) -> str:
        rules = r"""# A2UI Elemental Output Contract

You must output the user interface using A2UI Elemental HTML5-like markup.
Surround the entire output with `<body>` and `</body>` tags, including a `<link rel="catalog" href="[CATALOG_ID]">` at the start.
**CRITICAL**: DO NOT output raw JSON or `<a2ui-json>`. Direct JSON outputs are strictly prohibited.

## HTML5 Markup Rules

1. **Component Tags**: Use elements prefixed with `ui-` in kebab-case (e.g. `<ui-card>`).
2. **Component IDs**: Provide a unique `id` attribute for every component. The single top-level element MUST have `id="root"`.
3. **Attributes**: Pass static string values as regular attributes (`variant="primary"`). Wrap numbers, booleans, and expressions in double-quoted curly braces: `elevation="{4}"`, `disabled="{true}"`.
4. **Data Binding**: Bind data using curly braces prefixed with `$`: `value="{$/user/name}"` (absolute) or `value="{$name}"` (relative in list templates). Use `{$/items/0}` for arrays, never brackets.
5. **Expressions**: Call catalog functions inside curly braces using named arguments: `text="{formatCurrency(value: $/price, currency: 'USD')}"`.
6. **Slots & Children**: Nest children inside parent elements. Use the `slot` attribute to specify child properties: `<ui-card slot="leading">`.
7. **Complex Properties**: For objects/arrays, use `<script type="application/json" slot="prop">`. For HTML/long text, use `<script type="text/html" slot="prop">`.
8. **Templates**: For dynamic lists, nest child elements inside a `<template>` tag, and specify the bound data array path via the `path` attribute on the list component itself (e.g. `<ui-list path="{$/items}"><template>...</template></ui-list>`).
9. **Actions**: Use `on-<property-name>` in kebab-case (e.g. `onclick="{Event('name', {args})}"`). If submitting or validating data, pass the data paths inside the event context dict (e.g. `onclick="{Event('login', {username: $/login/username})}"`).
10. **Standalone Directives**:
    - Data Initialization: `<script type="application/json">{"data"}</script>` at root of body.
    - Surface Deletion: `<ui-delete-surface surface-id="id" />`.
    - Standalone Function Call: `<ui-call-function id="id" name="func"><script type="application/json" slot="args">{"args"}</script></ui-call-function>`.
"""
        catalog_id = prompt_gen.catalog_id if prompt_gen else "[CATALOG_ID]"
        rules = rules.replace("[CATALOG_ID]", catalog_id)
        if custom_workflow_description:
            rules += f"\n\n{custom_workflow_description}"
        return rules

    def catalog_description(
        self, prompt_gen: ElementalPromptGenerator, include_schema: bool = True
    ) -> str:
        if not include_schema:
            return ""
        comp_decls = prompt_gen.generate_component_declarations()
        func_decls = prompt_gen.generate_function_declarations()

        catalog_instructions = prompt_gen.helper.catalog.get("instructions", "")
        # Decompile json blocks in catalog instructions to HTML
        catalog_instructions_block = ""
        if catalog_instructions:
            try:
                json_blocks = re.findall(
                    r"```json\s*(.*?)\s*```", catalog_instructions, re.DOTALL
                )
                for block in json_blocks:
                    try:
                        parsed_json = json.loads(block)
                        if isinstance(parsed_json, list):
                            html_parts = []
                            for item in parsed_json:
                                if isinstance(item, dict):
                                    html_parts.append(self._decompiler.decompile(item))
                            html_block = "\n\n".join(html_parts)
                        elif isinstance(parsed_json, dict):
                            html_block = self._decompiler.decompile(parsed_json)
                        else:
                            continue

                        target_block = f"```json\n{block}\n```"
                        catalog_id = prompt_gen.catalog_id
                        html_block = html_block.replace(catalog_id, "[CATALOG_ID]")
                        replacement_block = f"```html\n{html_block}\n```"
                        catalog_instructions = catalog_instructions.replace(
                            target_block, replacement_block
                        )
                    except Exception:
                        pass
            except Exception:
                pass

            catalog_instructions_block = (
                f"\n\n## Catalog Instructions\n\n{catalog_instructions}"
            )

        common_types = """type DataBinding = string;
type A2UIElement = string; // ID of the referenced component
type Action = any;
type FunctionCall = any;"""

        desc_template = r"""## Component Interfaces

Your elements and attributes must match these TypeScript definitions (converting camelCase props to kebab-case attributes in HTML, e.g. `errorMessage` -> `error-message`).

```typescript
[COMMON_TYPES]

[COMPONENT_DECLARATIONS]
```

## Helper Functions

You can call these functions inside attribute expressions `{...}` using named arguments.

```typescript
[FUNCTION_DECLARATIONS]
```[CATALOG_INSTRUCTIONS_BLOCK]"""

        return (
            desc_template.replace("[COMMON_TYPES]", common_types)
            .replace("[COMPONENT_DECLARATIONS]", comp_decls)
            .replace("[FUNCTION_DECLARATIONS]", func_decls)
            .replace("[CATALOG_INSTRUCTIONS_BLOCK]", catalog_instructions_block)
        )

    def decompile(self, val: dict[str, Any]) -> str:
        self._ensure_catalog()
        return self._decompiler.decompile(val)

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        full_html = "\n\n".join(blocks)
        triple_backticks = chr(96) * 3
        return f"{triple_backticks}html\n{full_html}\n{triple_backticks}"

    def transform_examples(self, raw_examples_markdown: str) -> str:
        """Transforms JSON blocks in raw markdown into Elemental HTML syntax."""
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
