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

"""InferenceFormat and factory bindings for A2UI XML format."""

from __future__ import annotations

from collections.abc import Collection, Sequence

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_format import InferenceFormat, InferenceFormatFactory
from a2ui.inference_formats._shared import (
    catalogs_protocol_version,
    check_mixed_catalogs,
)
from a2ui.utils._experimental import experimental

from .parser import A2uiXmlParser
from .prompt_generator import A2uiXmlPromptGenerator
from .response_stream import DEFAULT_A2UI_XML_PROGRESSIVE_KEYS


@experimental
class A2uiXmlFormat(InferenceFormat):
    """Concrete strategy for A2UI XML representation."""

    def __init__(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
        allowed_messages: Sequence[str] | None = None,
        *,
        surface_id: str = "main",
        version: str | None = None,
        progressive_keys: Collection[str] | None = None,
        strict: bool = False,
        tuned: bool = True,
    ):
        self._catalogs = check_mixed_catalogs(catalogs)
        self._examples = (
            [list(turn) for turn in examples] if examples is not None else None
        )
        self._allowed_messages = (
            list(allowed_messages) if allowed_messages is not None else None
        )
        self.surface_id = surface_id
        self._version = version
        self._progressive_keys: frozenset[str] = (
            frozenset(progressive_keys)
            if progressive_keys is not None
            else DEFAULT_A2UI_XML_PROGRESSIVE_KEYS
        )
        self._strict = strict
        self._tuned = tuned
        self._prompt_generator = A2uiXmlPromptGenerator(
            self._catalogs,
            examples=self._examples,
            allowed_messages=self._allowed_messages,
            surface_id=surface_id,
            version=version,
            tuned=tuned,
        )

    @property
    def version(self) -> str:
        """The target protocol version: the override, else the catalogs' version."""
        return self._version or catalogs_protocol_version(self._catalogs)

    @property
    def catalogs(self) -> list[CatalogApi]:
        """A copy of the active catalogs in priority order."""
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
        """Property keys configured for progressive streaming."""
        return self._progressive_keys

    @property
    def strict(self) -> bool:
        """Whether strict syntax enforcement is enabled on created parsers."""
        return self._strict

    @property
    def tuned(self) -> bool:
        """Whether optimized XML prompt and healing enhancements are enabled."""
        return self._tuned

    @property
    def supports_streaming(self) -> bool:
        """Returns True as ``A2uiXmlParser`` supports progressive streaming."""
        return True

    @property
    def prompt_generator(self) -> A2uiXmlPromptGenerator:
        return self._prompt_generator

    def create_parser(self) -> A2uiXmlParser:
        return A2uiXmlParser(
            self._catalogs,
            surface_id=self.surface_id,
            version=self._version,
            progressive_keys=self._progressive_keys,
            strict=self._strict,
            tuned=self._tuned,
        )


class A2uiXmlFormatFactory(InferenceFormatFactory):
    """Factory that creates ``A2uiXmlFormat`` instances for negotiated catalogs."""

    def __init__(
        self,
        allowed_messages: Sequence[str] | None = None,
        surface_id: str = "main",
        *,
        version: str | None = None,
        progressive_keys: Collection[str] | None = None,
        strict: bool = False,
        tuned: bool = True,
    ):
        self._allowed_messages = (
            list(allowed_messages) if allowed_messages is not None else None
        )
        self._surface_id = surface_id
        self._version = version
        self._progressive_keys: frozenset[str] = (
            frozenset(progressive_keys)
            if progressive_keys is not None
            else DEFAULT_A2UI_XML_PROGRESSIVE_KEYS
        )
        self._strict = strict
        self._tuned = tuned

    @property
    def progressive_keys(self) -> frozenset[str]:
        """Property keys configured for progressive streaming."""
        return self._progressive_keys

    @property
    def tuned(self) -> bool:
        """Whether created ``A2uiXmlFormat`` instances enable tuned mode."""
        return self._tuned

    def create_format(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
    ) -> A2uiXmlFormat:
        return A2uiXmlFormat(
            catalogs,
            examples=examples,
            allowed_messages=self._allowed_messages,
            surface_id=self._surface_id,
            version=self._version,
            progressive_keys=self._progressive_keys,
            strict=self._strict,
            tuned=self._tuned,
        )

    def bind(
        self,
        catalogs: Sequence[CatalogApi],
        examples: Sequence[Sequence[AgentToRendererMessage]] | None = None,
    ) -> A2uiXmlFormat:
        """Convenience alias for ``create_format``."""
        return self.create_format(catalogs, examples=examples)
