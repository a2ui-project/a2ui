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

"""Standard A2UI Direct JSON inference format coordination."""

from __future__ import annotations

from collections.abc import Collection
from collections.abc import Sequence

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_format import InferenceFormat
from a2ui.inference_format import InferenceFormatFactory
from a2ui.inference_formats._shared import check_catalogs
from a2ui.inference_formats.direct_json.parser import DirectJsonParser
from a2ui.inference_formats.direct_json.prompt_generator import DirectJsonPromptGenerator
from a2ui.inference_formats.direct_json.streaming import DirectJsonStreamParser


class DirectJsonFormat(InferenceFormat):
    """Manages standard A2UI JSON schema responses and prompt injection (Direct JSON Format)."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
        allowed_messages: Sequence[str] | None = None,
        progressive_keys: Collection[str] = frozenset(),
    ):
        self._catalogs = check_catalogs(catalogs)
        self._examples = (
            [list(turn) for turn in examples] if examples is not None else None
        )
        self._allowed_messages = (
            list(allowed_messages) if allowed_messages is not None else None
        )
        self._progressive_keys = frozenset(progressive_keys)
        self._prompt_generator: DirectJsonPromptGenerator | None = None

    @property
    def prompt_generator(self) -> DirectJsonPromptGenerator:
        """The prompt generator instance configured for this Direct JSON format."""
        if self._prompt_generator is None:
            self._prompt_generator = DirectJsonPromptGenerator(
                self._catalogs,
                examples=self._examples,
                allowed_messages=self._allowed_messages,
            )
        return self._prompt_generator

    def create_parser(self) -> DirectJsonParser:
        """Creates a new parser instance configured for this Direct JSON format."""
        return DirectJsonParser(
            self._catalogs,
            progressive_keys=self._progressive_keys,
        )

    def create_stream_parser(self) -> DirectJsonStreamParser:
        """Creates a streaming parser configured by this format."""
        return DirectJsonStreamParser(
            self._catalogs,
            progressive_keys=self._progressive_keys,
        )

    @property
    def parser(self) -> DirectJsonParser:
        """Creates a parser instance configured for this Direct JSON format."""
        return self.create_parser()

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
    def progressive_keys(self) -> frozenset[str]:
        """The progressive string property keys healed while streaming."""
        return self._progressive_keys


class DirectJsonFormatFactory(InferenceFormatFactory):
    """Factory for creating DirectJsonFormat instances."""

    def __init__(
        self,
        allowed_messages: Sequence[str] | None = None,
        progressive_keys: Collection[str] = frozenset(),
    ):
        self._allowed_messages = (
            list(allowed_messages) if allowed_messages is not None else None
        )
        self._progressive_keys = frozenset(progressive_keys)

    @property
    def allowed_messages(self) -> list[str] | None:
        """The allowed message types, if restricted."""
        return (
            list(self._allowed_messages) if self._allowed_messages is not None else None
        )

    @property
    def progressive_keys(self) -> frozenset[str]:
        """The progressive string property keys healed while streaming."""
        return self._progressive_keys

    def create_format(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
    ) -> DirectJsonFormat:
        return DirectJsonFormat(
            catalogs,
            examples=examples,
            allowed_messages=self._allowed_messages,
            progressive_keys=self._progressive_keys,
        )
