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

from __future__ import annotations

from abc import ABC
from abc import abstractmethod
from collections.abc import Sequence

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.parser import Parser
from a2ui.prompt import PromptGenerator

__all__ = [
    "InferenceFormat",
    "InferenceFormatFactory",
]


class InferenceFormat(ABC):
    """Abstract base class for an A2UI inference format."""

    @property
    @abstractmethod
    def prompt_generator(self) -> PromptGenerator:
        """Returns the prompt generator for this format."""

    @abstractmethod
    def create_parser(self) -> Parser:
        """Creates a new parser instance for this format."""

    @property
    def supports_streaming(self) -> bool:
        """Returns whether parsers created by this format support streaming."""
        return self.create_parser().supports_streaming


class InferenceFormatFactory(ABC):
    """Abstract factory for creating InferenceFormat instances."""

    @abstractmethod
    def create_format(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
    ) -> InferenceFormat:
        """Creates an InferenceFormat configured with the given catalogs and examples."""
