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

"""Abstract InferenceFormat and InferenceFormatFactory facades."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence

from a2ui.core.catalog import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.parser import Parser
from a2ui.prompt import PromptGenerator


class InferenceFormatFactory(ABC):
    """Abstract interface for constructing InferenceFormat strategies bound to active catalogs."""

    @abstractmethod
    def create_format(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
    ) -> InferenceFormat:
        """Constructs an InferenceFormat instance bound to the provided active catalogs.

        Args:
            catalogs: List of active Catalog instances.
            examples: Optional list of few-shot example turns, each a list of messages.

        Returns:
            An InferenceFormat strategy instance.
        """


class InferenceFormat(ABC):
    """Coordinator facade pairing a prompt generator (input) and parser (output) for a format."""

    _parser: Parser | None = None

    @property
    @abstractmethod
    def prompt_generator(self) -> PromptGenerator:
        """Returns the format prompt generator instance."""

    @abstractmethod
    def create_parser(self) -> Parser:
        """Creates a new parser instance bound to this format strategy."""

    @property
    def parser(self) -> Parser:
        """Returns a cached parser instance associated with this inference format."""
        if self._parser is None:
            self._parser = self.create_parser()
        return self._parser

    @property
    def supports_streaming(self) -> bool:
        """Whether this inference format supports streaming token chunk parsing."""
        return self.parser.supports_streaming


__all__ = [
    "InferenceFormat",
    "InferenceFormatFactory",
]
