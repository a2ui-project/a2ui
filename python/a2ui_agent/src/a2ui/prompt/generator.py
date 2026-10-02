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


class PromptGenerator(ABC):
    """Abstract base class for format-specific prompt generators."""

    def generate_base_rules(self) -> str:
        """Returns core syntax and workflow rules for this inference format."""
        return ""

    def generate_catalog_instructions(
        self,
        include_schema: bool = True,
        catalog: Any | None = None,
    ) -> str:
        """Renders catalog component and function schemas/instructions."""
        return ""

    def generate_examples(
        self,
        catalog: Any | None = None,
        validate: bool = False,
    ) -> str:
        """Loads and formats few-shot examples in this inference format."""
        return ""

    @abstractmethod
    def generate(
        self,
        role_description: str = "",
        workflow_description: str = "",
        **kwargs: Any,
    ) -> str:
        """Renders format-specific system prompt instructions and catalog schemas.

        The caller (Agent / Framework) prepends role/workflow preambles and
        appends suffixes.
        """


__all__ = ["PromptGenerator"]
