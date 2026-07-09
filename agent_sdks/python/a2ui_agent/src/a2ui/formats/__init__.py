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
from abc import ABC, abstractmethod
from typing import List, Any, Callable
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.response_part import ResponsePart

__all__ = [
    "InferenceFormat",
    "InferenceFormatRegistry",
    "JsonInferenceFormat",
]


class InferenceFormat(ABC):
    """Abstract interface defining an alternative A2UI payload format."""

    @property
    @abstractmethod
    def name(self) -> str:
        """The format name (e.g., 'json', 'express')."""
        pass

    @abstractmethod
    def generate_workflow_rules(self, custom_workflow_description: str = "") -> str:
        """Generates formatting rules and sentinel tag expectations."""
        pass

    @abstractmethod
    def generate_instructions(self, catalog: A2uiCatalog) -> str:
        """Generates component and function signatures for the catalog in this format."""
        pass

    def transform_examples(
        self, raw_examples_markdown: str, catalog: A2uiCatalog
    ) -> str:
        """Transforms examples markdown (e.g., converting JSON blocks to the target format)."""
        return raw_examples_markdown

    @abstractmethod
    def parse_response(
        self,
        content: str,
        catalog: A2uiCatalog,
        surface_id: str = "main",
    ) -> List[ResponsePart]:
        """Parses model response content and compiles it to standard A2UI JSON payload parts."""
        pass

    @abstractmethod
    def decompile(self, val: dict[str, Any], catalog: A2uiCatalog) -> str:
        """Decompiles standard JSON payload back into this format's string representation."""
        pass


class classproperty:
    """Custom descriptor to support class-level properties."""

    def __init__(self, func: Callable[[Any], Any]) -> None:
        self.func = func

    def __get__(self, owner_self: Any, owner_cls: Any) -> Any:
        return self.func(owner_cls)


class InferenceFormatRegistry:
    """Registry to register and retrieve inference formats."""

    _formats: dict[str, InferenceFormat] = {}

    @classmethod
    def register(cls, format_strategy: InferenceFormat) -> None:
        cls._formats[format_strategy.name] = format_strategy

    @classmethod
    def unregister(cls, name: str) -> None:
        cls._formats.pop(name, None)

    @classmethod
    def get(cls, name: str) -> InferenceFormat:
        if name not in cls._formats:
            raise ValueError(f"Unknown inference format: {name}")
        return cls._formats[name]

    @classproperty
    def available_formats(cls) -> list[str]:
        return list(cls._formats.keys())


# Automatically register standard JSON format
from .json_inference_format import JsonInferenceFormat

InferenceFormatRegistry.register(JsonInferenceFormat())

# Conditionally register experimental Express and Elemental formats if enabled
if os.environ.get("A2UI_EXPRESS_ENABLED", "").lower() in ("true", "1", "yes"):
    try:
        from a2ui.experimental.express.format import ExpressInferenceFormat

        InferenceFormatRegistry.register(ExpressInferenceFormat())
    except ImportError:
        pass

    try:
        from a2ui.experimental.elemental.format import ElementalInferenceFormat

        InferenceFormatRegistry.register(ElementalInferenceFormat())
    except ImportError:
        pass
