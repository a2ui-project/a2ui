# Copyright 2024 Google LLC
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

"""Abstract prompt generator interface for inference formats."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

__all__ = [
    "PromptGenerator",
]


class PromptGenerator(ABC):
    """Abstract base class for inference format prompt generators."""

    def generate_base_rules(self) -> str:
        """Returns the core syntax contract and grammar rules for the inference format."""
        return ""

    def generate_catalog_instructions(
        self,
        include_schema: bool = True,
        catalog: Any | None = None,
    ) -> str:
        """Returns component and function signatures or JSON schemas for a catalog."""
        return ""

    def generate_examples(
        self,
        catalog: Any | None = None,
        validate: bool = False,
    ) -> str:
        """Returns formatted few-shot examples for a catalog."""
        return ""

    @abstractmethod
    def generate(self) -> str:
        """Generates the format and catalog prompt snippet."""
        parts: list[str] = []

        rules = self.generate_base_rules()
        if rules:
            parts.append(f"## Workflow Description:\n{rules}")

        catalog_inst = self.generate_catalog_instructions(include_schema=True)
        if catalog_inst:
            parts.append(catalog_inst)

        examples = self.generate_examples()
        if examples:
            parts.append(f"### Examples:\n{examples}")

        return "\n\n".join(parts)
