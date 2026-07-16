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
from a2ui.decompiler import Decompiler
from a2ui.schema.capabilities import ClientUiCapabilities
from a2ui.parser.parser import Parser
from google.adk.utils.feature_decorator import experimental

from .prompt_generator import ElementalPromptGenerator
from .decompiler import ElementalDecompiler
from .compiler import TAG_PREFIX
from .parser import ElementalParser


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
            self._ensure_catalog()
            self._prompt_generator = ElementalPromptGenerator(self)
        return self._prompt_generator

    @property
    def parser(self) -> Parser:
        self._ensure_catalog()
        return ElementalParser(self.catalog, self.surface_id)

    @property
    def decompiler(self) -> ElementalDecompiler:
        self._ensure_catalog()
        assert self._decompiler is not None
        return self._decompiler



    def catalog_description(self, prompt_gen: Any, include_schema: bool = True) -> str:
        if not include_schema:
            return ""
        if prompt_gen.helper is None and self.catalog:
            from a2ui.inference_formats.experimental.express.schema_helper import (
                CatalogSchemaHelper,
            )

            prompt_gen.catalog = self.catalog
            prompt_gen.helper = CatalogSchemaHelper(self.catalog)

        comp_decls = prompt_gen.generate_component_declarations()
        func_decls = prompt_gen.generate_function_declarations()

        catalog_instructions = (
            prompt_gen.helper.catalog.get("instructions", "")
            if prompt_gen.helper
            else ""
        )
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

