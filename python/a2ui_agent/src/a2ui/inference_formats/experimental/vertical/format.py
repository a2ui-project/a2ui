# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Vertical inference format implementation for A2UI."""

from __future__ import annotations

from collections.abc import Sequence

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_format import InferenceFormat, InferenceFormatFactory
from a2ui.inference_formats._shared import (
    catalogs_protocol_version,
    check_mixed_catalogs,
)
from a2ui.utils._experimental import experimental

from .compiler import normalize_wire_version
from .parser import VerticalParser
from .prompt_generator import VerticalPromptGenerator


@experimental
class VerticalFormat(InferenceFormat):
    """Concrete strategy for the A2UI Vertical inference format.

    Targets flat, non-nested standalone UI generation where each constructor
    invocation maps to its own surface (`surface_id`, `surface_id_1`, ...) and
    container components requiring children are pruned from prompt signatures.
    Supports A2UI v0.9, v0.9.1, and v1.0 (including multi-catalog resolution,
    `@path` / `@call`, `Event(..., userMessage=...)`, `extensions=`, and
    standalone `callRendererFunction`).
    """

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
        allowed_messages: Sequence[str] | None = None,
        surface_id: str = "main",
        version: str | None = None,
    ):
        self._catalogs = check_mixed_catalogs(catalogs)
        self._examples = (
            [list(turn) for turn in examples] if examples is not None else None
        )
        self._allowed_messages = (
            list(allowed_messages) if allowed_messages is not None else None
        )
        self.surface_id = surface_id
        resolved_ver = (
            normalize_wire_version(version)
            if version is not None
            else normalize_wire_version(catalogs_protocol_version(self._catalogs))
        )
        self._version = resolved_ver
        self._prompt_generator: VerticalPromptGenerator | None = None

    @property
    def version(self) -> str:
        """The target wire protocol version: the override, else the catalogs' version."""
        return self._version

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
    def supports_streaming(self) -> bool:
        """Whether this format's parser supports incremental streaming."""
        return True

    @property
    def prompt_generator(self) -> VerticalPromptGenerator:
        """The prompt generator instance configured for this Vertical format."""
        if self._prompt_generator is None:
            self._prompt_generator = VerticalPromptGenerator(
                self._catalogs,
                examples=self._examples,
                allowed_messages=self._allowed_messages,
                surface_id=self.surface_id,
                version=self._version,
            )
        return self._prompt_generator

    def create_parser(self) -> VerticalParser:
        """Creates a new stateless parser instance configured for this Vertical format."""
        return VerticalParser(
            self._catalogs,
            surface_id=self.surface_id,
            version=self._version,
        )


@experimental
class VerticalFormatFactory(InferenceFormatFactory):
    """Factory for creating `VerticalFormat` instances."""

    def __init__(
        self,
        allowed_messages: Sequence[str] | None = None,
        surface_id: str = "main",
        version: str | None = None,
    ):
        self._allowed_messages = (
            list(allowed_messages) if allowed_messages is not None else None
        )
        self._surface_id = surface_id
        self._version = normalize_wire_version(version) if version is not None else None

    @property
    def allowed_messages(self) -> list[str] | None:
        """The allowed message types, if restricted."""
        return (
            list(self._allowed_messages) if self._allowed_messages is not None else None
        )

    def create_format(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
    ) -> VerticalFormat:
        return VerticalFormat(
            catalogs,
            examples=examples,
            allowed_messages=self._allowed_messages,
            surface_id=self._surface_id,
            version=self._version,
        )
