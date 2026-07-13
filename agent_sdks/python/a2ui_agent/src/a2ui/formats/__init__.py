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

import re
import json
from abc import ABC, abstractmethod
from typing import Any, Optional
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.response_part import ResponsePart


__all__ = [
    "InferenceFormat",
    "JsonInferenceFormat",
    "PromptGenerator",
]


class InferenceFormat(ABC):
    """Abstract interface defining an alternative A2UI payload format."""

    def __init__(
        self,
        catalog: Optional[A2uiCatalog] = None,
        surface_id: str = "main",
    ):
        self.catalog = catalog
        self.surface_id = surface_id

    @property
    @abstractmethod
    def name(self) -> str:
        """The format name (e.g., 'json', 'express')."""
        pass

    @abstractmethod
    def format_description(self, custom_workflow_description: str = "") -> str:
        """Generates formatting rules and sentinel tag expectations."""
        pass

    @abstractmethod
    def catalog_description(self, include_schema: bool = True) -> str:
        """Generates component and function signatures for the catalog in this format."""
        pass

    @abstractmethod
    def parse_response(self, content: str) -> list[ResponsePart]:
        """Parses model response content and compiles it to standard A2UI JSON payload parts."""
        pass

    @abstractmethod
    def decompile(self, val: dict[str, Any]) -> str:
        """Decompiles standard JSON payload back into this format's string representation."""
        pass

    @abstractmethod
    def wrap_decompiled_blocks(self, blocks: list[str]) -> str:
        """Wraps decompiled code blocks in format-specific tags and code block wrappers."""
        pass

    @property
    def open_tag_prefix(self) -> str:
        """The opening tag prefix to match in token stream (e.g. '<a2ui-json', '<a2ui')."""
        from a2ui.schema.constants import A2UI_OPEN_TAG

        return A2UI_OPEN_TAG.rstrip(">")

    def has_a2ui_parts(self, content: str) -> bool:
        """Checks if the content contains formatted structured blocks for this format."""
        return self.open_tag_prefix in content


class PromptGenerator:
    """Helper to assemble prompt instructions and transform examples."""

    def __init__(self, format_strategy: InferenceFormat):
        self.strategy = format_strategy

    def generate_system_prompt(
        self,
        role_description: str,
        workflow_description: str = "",
        ui_description: str = "",
        include_schema: bool = True,
        include_examples: bool = False,
        examples_raw: str = "",
    ) -> str:
        """Assembles the final system prompt instructions."""
        parts = [role_description]

        workflow = self.strategy.format_description(workflow_description)
        parts.append(f"## Workflow Description:\n{workflow}")

        if ui_description:
            parts.append(f"## UI Description:\n{ui_description}")

        if include_schema:
            parts.append(self.strategy.catalog_description(include_schema))

        if include_examples and examples_raw:
            formatted_examples = self.transform_examples(examples_raw)
            parts.append(f"### Examples:\n{formatted_examples}")

        return "\n\n".join(parts)

    def transform_examples(self, raw_examples_markdown: str) -> str:
        """Transforms JSON blocks in raw markdown into the target format syntax."""
        if not self.strategy.catalog:
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
                        decompiled = self.strategy.decompile(msg)
                        blocks.append(decompiled)
                    else:
                        return str(match.group(0))

                return self.strategy.wrap_decompiled_blocks(blocks)
            except Exception:
                return str(match.group(0))

        return re.sub(
            pattern, replace_json_block, raw_examples_markdown, flags=re.DOTALL
        )


from .json_inference_format import JsonInferenceFormat
