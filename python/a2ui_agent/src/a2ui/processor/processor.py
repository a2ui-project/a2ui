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

"""Central request processor facade for A2UI agents."""

from __future__ import annotations

from collections.abc import Sequence

from a2ui.core import A2uiCatalogError, CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_format import InferenceFormat, InferenceFormatFactory
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
from a2ui.parser import Parser, ResponsePart
from a2ui.utils import validate_payload

__all__ = [
    "A2uiRequestProcessor",
]


class A2uiRequestProcessor:
    """Central request processor facade unifying multi-catalog capability resolution, prompt rendering, parser creation, and validation."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
        format_factory: InferenceFormatFactory | None = None,
    ):
        """Initializes A2uiRequestProcessor, resolving active catalogs and instantiating validator and format strategy.

        Args:
            catalogs: List of active Catalog instances.
            examples: Optional list of prompt example turns.
            format_factory: Format factory for instantiating format strategies.

        Raises:
            A2uiCatalogError: If no active catalogs are provided.
            A2uiValidationError: If any prompt example fails validation against the active catalogs.
        """
        if not catalogs:
            raise A2uiCatalogError("At least one active catalog is required.")
        self._active_catalogs = list(catalogs)
        self._examples = (
            [list(turn) for turn in examples] if examples is not None else None
        )
        if self._examples:
            for turn in self._examples:
                validate_payload(self._active_catalogs, turn)
        factory = (
            format_factory if format_factory is not None else DirectJsonFormatFactory()
        )
        self._format: InferenceFormat = factory.create_format(
            catalogs=self._active_catalogs,
            examples=self._examples,
        )

    @property
    def active_catalogs(self) -> list[CatalogApi]:
        """Returns the list of active negotiated Catalog instances for this processor."""
        return list(self._active_catalogs)

    @property
    def examples(self) -> list[list[AgentToRendererMessage]] | None:
        """Returns the ordered list of prompt example turns."""
        if self._examples is None:
            return None
        return [list(turn) for turn in self._examples]

    @property
    def format(self) -> InferenceFormat:
        """Returns the InferenceFormat bound to this processor."""
        return self._format

    @property
    def prompt_snippet(self) -> str:
        """Format-specific system prompt instruction snippet."""
        return self._format.prompt_generator.generate()

    def create_parser(self) -> Parser:
        """Creates a fresh Parser instance bound to the active catalogs."""
        return self._format.create_parser()

    def parse_response(self, content: str, wrapped: bool = True) -> list[ResponsePart]:
        """Parses and validates the LLM response into ResponseParts."""
        return self._format.create_parser().parse_response(content, wrapped=wrapped)
