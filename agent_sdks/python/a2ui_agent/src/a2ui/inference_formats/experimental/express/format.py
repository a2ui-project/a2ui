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
from .parser import ExpressParser


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


    def catalog_description(self, prompt_gen: Any, include_schema: bool = True) -> str:
        if not include_schema:
            return ""
        if prompt_gen.helper is None and self.catalog:
            from .schema_helper import CatalogSchemaHelper

            prompt_gen.helper = CatalogSchemaHelper(self.catalog)
            prompt_gen.decompiler = ExpressDecompiler(self.catalog)

        comp_sigs = prompt_gen.generate_component_signatures()
        func_sigs = prompt_gen.generate_function_signatures()
        catalog_instructions = (
            prompt_gen.helper.catalog.get("instructions", "")
            if prompt_gen.helper
            else ""
        )

        # Translate json examples in catalog instructions into A2UI Express DSL
        if catalog_instructions:
            pattern = r"```json\s*\n(.*?)\n```"
            catalog_instructions = re.sub(
                pattern,
                prompt_gen._replace_json_block_in_instructions,
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
        return self.prompt_generator.transform_examples(raw_examples_markdown)
