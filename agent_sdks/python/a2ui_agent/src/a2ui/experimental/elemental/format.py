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
from typing import Any, Optional
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.response_part import ResponsePart
from a2ui.formats import InferenceFormat
from google.adk.utils.feature_decorator import experimental

from .prompt_generator import ElementalPromptGenerator
from .decompiler import ElementalDecompiler
from .parser import parse_elemental_response


@experimental
class ElementalInferenceFormat(InferenceFormat):
    """Elemental TSX/HTML5 format strategy."""

    def __init__(
        self,
        catalog: Optional[A2uiCatalog] = None,
        surface_id: str = "main",
    ):
        super().__init__(catalog, surface_id)
        self._prompt_gen = ElementalPromptGenerator(catalog) if catalog else None
        self._decompiler = ElementalDecompiler(catalog) if catalog else None

    def _ensure_catalog(self) -> None:
        if not self.catalog or not self._decompiler:
            raise ValueError(
                f"Catalog is required for parsing and decompiling in {self.name}"
                " format."
            )

    @property
    def name(self) -> str:
        return "elemental"

    def format_description(self, custom_workflow_description: str = "") -> str:
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
        catalog_id = self._prompt_gen.catalog_id if self._prompt_gen else "[CATALOG_ID]"
        rules = rules.replace("[CATALOG_ID]", catalog_id)
        if custom_workflow_description:
            rules += f"\n\n{custom_workflow_description}"
        return rules

    def catalog_description(self, include_schema: bool = True) -> str:
        if not self._prompt_gen or not include_schema:
            return ""
        comp_decls = self._prompt_gen.generate_component_declarations()
        func_decls = self._prompt_gen.generate_function_declarations()

        catalog_instructions = self._prompt_gen.helper.catalog.get("instructions", "")
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
                        catalog_id = self._prompt_gen.catalog_id
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

    def parse_response(self, content: str) -> list[ResponsePart]:
        self._ensure_catalog()
        return parse_elemental_response(content, self.catalog, self.surface_id)

    def decompile(self, val: dict[str, Any]) -> str:
        self._ensure_catalog()
        return self._decompiler.decompile(val)

    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        full_html = "\n\n".join(blocks)
        triple_backticks = chr(96) * 3
        return f"{triple_backticks}html\n{full_html}\n{triple_backticks}"
