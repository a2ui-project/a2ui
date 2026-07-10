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

import os
import re
import json
from abc import ABC, abstractmethod
from typing import List, Any, Optional
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.response_part import ResponsePart

__all__ = [
    "InferenceFormat",
    "InferenceFormatRegistry",
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
    def parse_response(self, content: str) -> List[ResponsePart]:
        """Parses model response content and compiles it to standard A2UI JSON payload parts."""
        pass

    @abstractmethod
    def decompile(self, val: dict[str, Any]) -> str:
        """Decompiles standard JSON payload back into this format's string representation."""
        pass

    @abstractmethod
    def wrap_decompiled_blocks(self, blocks: List[str]) -> str:
        """Wraps decompiled code blocks in format-specific tags and code block wrappers."""
        pass

    def detect_format(self, content: str) -> bool:
        """Returns True if the content contains this format's sentinel/payload tags."""
        return "<a2ui" in content


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

        def replace_json_block(match) -> str:
            json_content = match.group(1).strip()
            try:
                parsed = json.loads(json_content)
                if isinstance(parsed, dict):
                    messages = [parsed]
                elif isinstance(parsed, list):
                    messages = parsed
                else:
                    return match.group(0)

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
                        return match.group(0)

                return self.strategy.wrap_decompiled_blocks(blocks)
            except Exception:
                return match.group(0)

        return re.sub(
            pattern, replace_json_block, raw_examples_markdown, flags=re.DOTALL
        )


class InferenceFormatRegistry:
    """Registry to register and retrieve inference formats."""

    _formats: dict[str, InferenceFormat] = {}
    _initialized: bool = False

    @classmethod
    def _ensure_initialized(cls) -> None:
        if cls._initialized:
            return
        cls._initialized = True

        # Lazy-import and register default JSON format
        from .json_inference_format import JsonInferenceFormat

        cls.register(JsonInferenceFormat())

        # Lazy-import and conditionally register experimental Express format if enabled
        if os.environ.get("A2UI_EXPRESS_ENABLED", "").lower() in ("true", "1", "yes"):
            try:
                import importlib

                express_mod = importlib.import_module(
                    "a2ui.experimental.express.format"
                )
                ExpressInferenceFormat = getattr(express_mod, "ExpressInferenceFormat")
                cls.register(ExpressInferenceFormat())
            except ImportError:
                pass

        # Lazy-import and conditionally register experimental Elemental format if enabled
        if os.environ.get("A2UI_ELEMENTAL_ENABLED", "").lower() in ("true", "1", "yes"):
            try:
                import importlib

                elemental_mod = importlib.import_module(
                    "a2ui.experimental.elemental.format"
                )
                ElementalInferenceFormat = getattr(
                    elemental_mod, "ElementalInferenceFormat"
                )
                cls.register(ElementalInferenceFormat())
            except ImportError:
                pass

    @classmethod
    def register(cls, format_strategy: InferenceFormat) -> None:
        cls._formats[format_strategy.name] = format_strategy

    @classmethod
    def unregister(cls, name: str) -> None:
        cls._ensure_initialized()
        cls._formats.pop(name, None)

    @classmethod
    def get(cls, name: str) -> InferenceFormat:
        cls._ensure_initialized()
        if name not in cls._formats:
            raise ValueError(f"Unknown inference format: {name}")
        return cls._formats[name]

    @classmethod
    def available_formats(cls) -> list[str]:
        cls._ensure_initialized()
        return list(cls._formats.keys())


def __getattr__(name: str) -> Any:
    if name == "JsonInferenceFormat":
        from .json_inference_format import JsonInferenceFormat

        return JsonInferenceFormat
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
