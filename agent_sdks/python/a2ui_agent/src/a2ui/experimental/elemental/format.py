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
from .prompt_generator import ElementalPromptGenerator
from .parser import parse_elemental_response
from .decompiler import ElementalDecompiler


ELEMENTAL_RULES_TEMPLATE = r"""# A2UI Elemental Output Contract

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

        html_blocks = []
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
                html = decompiler.decompile(msg)
                html_blocks.append(html)
            else:
                return match.group(0)

        full_html = "\n\n".join(html_blocks)
        return f"```html\n{full_html}\n```"
    except Exception:
        return match.group(0)


class ElementalInferenceFormat(InferenceFormat):
    """A2UI Elemental HTML5-like format strategy."""

    @property
    def name(self) -> str:
        return "elemental"

    def generate_workflow_rules(self, custom_workflow_description: str = "") -> str:
        rules = ELEMENTAL_RULES_TEMPLATE
        if custom_workflow_description:
            rules += f"\n{custom_workflow_description}"
        return rules

    def generate_instructions(self, catalog: A2uiCatalog) -> str:
        generator = ElementalPromptGenerator(catalog)
        comp_decls = generator.generate_component_declarations()
        func_decls = generator.generate_function_declarations()

        common_types = """type DataBinding = string;
type A2UIElement = string; // ID of the referenced component
type Action = any;
type FunctionCall = any;"""

        instructions = f"""## Component Interfaces

Your elements and attributes must match these TypeScript definitions (converting camelCase props to kebab-case attributes in HTML, e.g. `errorMessage` -> `error-message`).

```typescript
{common_types}

{comp_decls}
```

## Helper Functions

You can call these functions inside attribute expressions `{{...}}` using named arguments.

```typescript
{func_decls}
```"""
        return instructions

    def transform_examples(
        self, raw_examples_markdown: str, catalog: A2uiCatalog
    ) -> str:
        decompiler = ElementalDecompiler(catalog)
        pattern = r"```json\s*\n(.*?)\n```"

        replace_func = partial(_replace_json_block, decompiler=decompiler)
        transformed = re.sub(
            pattern, replace_func, raw_examples_markdown, flags=re.DOTALL
        )
        return transformed

    def parse_response(
        self,
        content: str,
        catalog: A2uiCatalog,
        surface_id: str = "main",
    ) -> List[ResponsePart]:
        return parse_elemental_response(content, catalog, surface_id=surface_id)

    def decompile(self, val: dict[str, Any], catalog: A2uiCatalog) -> str:
        return ElementalDecompiler(catalog).decompile(val)
