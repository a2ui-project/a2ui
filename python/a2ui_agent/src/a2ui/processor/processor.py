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
from a2ui.core.common import to_protocol_version
from a2ui.core.schema import AgentToRendererMessage
from a2ui.inference_format import InferenceFormat, InferenceFormatFactory
from a2ui.inference_formats.express import ExpressFormatFactory
from a2ui.parser import Parser, ResponsePart, ResponseStream
from a2ui.utils import RendererState, validate_payload

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
        *,
        state: RendererState | None = None,
    ):
        """Initializes A2uiRequestProcessor, resolving active catalogs and instantiating validator and format strategy.

        Args:
            catalogs: List of active Catalog instances.
            examples: Optional list of prompt example turns.
            format_factory: Format factory for instantiating format strategies (defaults to ExpressFormatFactory).
            state: The renderer state a canvas agent keeps for the
                conversation. `parse_response` and `open_stream` use it when
                a call passes none. Without one, each call checks the response
                against a new state, as a chat agent wants. A processor bound
                to a state serves only that conversation.

        Raises:
            A2uiCatalogError: If no active catalogs are provided, or if `state`
                holds other catalogs.
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
            format_factory if format_factory is not None else ExpressFormatFactory()
        )
        self._format: InferenceFormat = factory.create_format(
            catalogs=self._active_catalogs,
            examples=self._examples,
        )
        self._parser: Parser | None = None
        self._check_state(state)
        self._state = state

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
    def state(self) -> RendererState | None:
        """The renderer state bound to this processor, if any."""
        return self._state

    @property
    def prompt_snippet(self) -> str:
        """Format-specific system prompt instruction snippet."""
        return self._format.prompt_generator.generate()

    @property
    def parser(self) -> Parser:
        """The parser for the format, bound to the active catalogs.

        A parser holds no state, so the processor creates one and reuses it.
        """
        if self._parser is None:
            self._parser = self._format.create_parser()
        return self._parser

    def create_state(self) -> RendererState:
        """Creates an empty renderer state that holds the active catalogs.

        A canvas agent keeps the state for the whole conversation and passes
        it to `parse_response` or `open_stream` on every turn.
        """
        return RendererState(self._active_catalogs)

    def parse_response(
        self,
        content: str,
        wrapped: bool = True,
        *,
        state: RendererState | None = None,
    ) -> list[ResponsePart]:
        """Parses and validates the LLM response into ResponseParts.

        Args:
            content: The response text.
            wrapped: False if the whole response is one block, without tags.
            state: The renderer state to check the response against and apply
                it to. Defaults to the state bound to the processor. With
                neither, the response is checked on its own, against a new
                state.

        Raises:
            A2uiCatalogError: If the state holds other catalogs than the
                processor.
        """
        target = self._resolve_state(state)
        return self.parser.parse_response(content, wrapped, state=target)

    def open_stream(
        self, *, wrapped: bool = True, state: RendererState | None = None
    ) -> ResponseStream:
        """Opens a stream that reads one LLM response chunk by chunk.

        Args:
            wrapped: False if the whole response is one block, without tags.
            state: The renderer state to check the response against and apply
                it to, as for `parse_response`.

        Raises:
            A2uiCatalogError: If the state holds other catalogs than the
                processor.
            NotImplementedError: If the format cannot be read incrementally.
        """
        target = self._resolve_state(state)
        return self.parser.open_stream(wrapped=wrapped, state=target)

    def _resolve_state(self, state: RendererState | None) -> RendererState | None:
        if state is None:
            return self._state
        self._check_state(state)
        return state

    def accepts_state(self, state: RendererState) -> bool:
        """Whether the processor can check responses against a renderer state.

        A state is accepted when it holds the processor's active catalogs, in
        the same order, since the order decides which catalog a surface
        resolves to. A state made with `create_state` is always accepted. An
        agent that keeps a state per conversation calls this to tell whether
        the state still fits the request's catalogs, and makes a new one with
        `create_state` when it doesn't.
        """
        return _catalog_keys(state.catalogs) == _catalog_keys(self._active_catalogs)

    def _check_state(self, state: RendererState | None) -> None:
        if state is None or self.accepts_state(state):
            return
        raise A2uiCatalogError(
            f"The renderer state holds catalogs {_catalog_keys(state.catalogs)},"
            " but the processor's active catalogs are"
            f" {_catalog_keys(self._active_catalogs)}."
        )


def _catalog_keys(catalogs: Sequence[CatalogApi]) -> list[tuple[str, str]]:
    """The id and normalized protocol version of each catalog, in order."""
    return [
        (c.catalog_id, to_protocol_version(c.protocol_version).value) for c in catalogs
    ]
