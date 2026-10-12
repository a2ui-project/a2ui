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

from collections.abc import Sequence

from google.adk.utils.feature_decorator import experimental

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_format import InferenceFormat
from a2ui.inference_format import InferenceFormatFactory
from a2ui.inference_formats._shared import check_mixed_catalogs
from a2ui.parser import Parser

from .parser import ElementalParser
from .prompt_generator import ElementalPromptGenerator


@experimental
class ElementalFormat(InferenceFormat):
    """Elemental HTML5-like markup format strategy."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
        allowed_messages: Sequence[str] | None = None,
        surface_id: str = "main",
    ):
        self._catalogs = check_mixed_catalogs(catalogs)
        self._examples = (
            [list(turn) for turn in examples] if examples is not None else None
        )
        self._allowed_messages = (
            list(allowed_messages) if allowed_messages is not None else None
        )
        self.surface_id = surface_id
        self._prompt_generator: ElementalPromptGenerator | None = None

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the active catalogs, in the order the format received them."""
        return list(self._catalogs)

    @property
    def examples(self) -> list[list[AgentToRendererMessage]] | None:
        """The configured few-shot example turns, if any."""
        return [list(t) for t in self._examples] if self._examples is not None else None

    @property
    def allowed_messages(self) -> list[str] | None:
        """The allowed message types, if restricted."""
        return (
            list(self._allowed_messages) if self._allowed_messages is not None else None
        )

    @property
    def prompt_generator(self) -> ElementalPromptGenerator:
        """Returns the PromptGenerator instance for this format."""
        if self._prompt_generator is None:
            self._prompt_generator = ElementalPromptGenerator(
                self._catalogs,
                examples=self._examples,
                allowed_messages=self._allowed_messages,
                surface_id=self.surface_id,
            )
        return self._prompt_generator

    def create_parser(self) -> ElementalParser:
        """Creates a new parser instance for this Elemental format."""
        return ElementalParser(self._catalogs, self.surface_id)

    @property
    def parser(self) -> Parser:
        return self.create_parser()


class ElementalFormatFactory(InferenceFormatFactory):
    """Factory for creating ElementalFormat instances."""

    def __init__(
        self,
        allowed_messages: Sequence[str] | None = None,
        surface_id: str = "main",
    ):
        self._allowed_messages = (
            list(allowed_messages) if allowed_messages is not None else None
        )
        self._surface_id = surface_id

    def create_format(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
    ) -> ElementalFormat:
        return ElementalFormat(
            catalogs,
            examples=examples,
            allowed_messages=self._allowed_messages,
            surface_id=self._surface_id,
        )
