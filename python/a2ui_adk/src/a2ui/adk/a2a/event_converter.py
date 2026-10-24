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

"""Module for the A2UI Event Converter.

This module provides the `A2uiEventConverter` which intercepts ADK events and automatically
translates GenAI model outputs (both tool-based A2UI function calls and text-based delimited A2UI blocks)
into A2A (Agent-to-Agent) event structures with A2UI payloads, using the session catalog if available.

Key Components:
  * `A2uiEventConverter`: An event converter that automatically injects the A2UI catalog into part conversion.

Usage Example:

  Configure the ADK executor to use the A2UI event converter:

  ```python
  config = A2aAgentExecutorConfig(
      event_converter=A2uiEventConverter()
  )
  executor = A2aAgentExecutor(config)
  ```
"""

from __future__ import annotations

from collections.abc import Sequence
import logging
from typing import TYPE_CHECKING, Any
import weakref

from a2a import types as a2a_types
from google.adk.a2a.converters import part_converter
from google.adk.utils.feature_decorator import experimental
from google.genai import types as genai_types

from a2ui.a2a import to_a2a_parts
from a2ui.core import CatalogApi
from a2ui.parser import ResponseStream
from a2ui.processor import A2uiRequestProcessor
from a2ui.utils import RendererState

from .part_converter import A2uiPartConverter

if TYPE_CHECKING:
    from a2a.server.events import Event as A2AEvent
    from google.adk.a2a.converters.part_converter import GenAIPartToA2APartConverter
    from google.adk.agents.invocation_context import InvocationContext
    from google.adk.events.event import Event

logger = logging.getLogger(__name__)


@experimental
class A2uiEventConverter:
    """An event converter that automatically injects the A2UI catalogs into part conversion.

    This allows text-based A2UI extraction and validation to work even when the
    catalogs, request processor, renderer state, or response stream are
    session-specific. By default it reads from the `system:a2ui_processor`,
    `system:a2ui_catalogs`, `system:a2ui_state`, and `system:a2ui_stream`
    session-state keys.
    """

    def __init__(
        self,
        catalogs_key: str = "system:a2ui_catalogs",
        bypass_tool_check: bool = False,
        fallback_text: str | None = None,
        *,
        processor_key: str = "system:a2ui_processor",
        state_key: str = "system:a2ui_state",
        stream_key: str = "system:a2ui_stream",
    ):
        self._catalogs_key = catalogs_key
        self._bypass_tool_check = bypass_tool_check
        self._fallback_text = fallback_text
        self._processor_key = processor_key
        self._state_key = state_key
        self._stream_key = stream_key
        self._cached_converter_key: tuple[Any, ...] | None = None
        self._cached_part_converter: A2uiPartConverter | None = None
        # The streams fed a partial event and not yet closed. Held weakly, so a
        # stream abandoned mid-response is not kept alive, and by object rather
        # than by id(), which a later stream could reuse.
        self._active_streams: weakref.WeakSet[ResponseStream] = weakref.WeakSet()

    def _get_part_converter(
        self,
        catalogs: Sequence[CatalogApi] | None,
        processor: A2uiRequestProcessor | None,
        state: RendererState | None,
    ) -> A2uiPartConverter:
        resolved_catalogs = (
            list(catalogs)
            if catalogs is not None
            else (processor.active_catalogs if processor is not None else [])
        )
        key = (
            tuple(id(c) for c in resolved_catalogs),
            id(processor) if processor is not None else None,
            id(state) if state is not None else None,
        )
        if self._cached_part_converter is None or self._cached_converter_key != key:
            self._cached_converter_key = key
            self._cached_part_converter = A2uiPartConverter(
                catalogs=resolved_catalogs if catalogs is not None else None,
                bypass_tool_check=self._bypass_tool_check,
                fallback_text=self._fallback_text,
                processor=processor,
                state=state,
            )
        return self._cached_part_converter

    def __call__(
        self,
        event: "Event",
        invocation_context: "InvocationContext",
        task_id: str | None = None,
        context_id: str | None = None,
        part_converter_func: "GenAIPartToA2APartConverter" = part_converter.convert_genai_part_to_a2a_part,
    ) -> list["A2AEvent"]:
        """Converts an ADK event to A2A events, using the session catalog or processor if available."""
        from google.adk.a2a.converters.event_converter import (
            convert_event_to_a2a_events,
        )

        session_state = invocation_context.session.state
        raw_processor = session_state.get(self._processor_key)
        processor = (
            raw_processor if isinstance(raw_processor, A2uiRequestProcessor) else None
        )
        raw_state = session_state.get(self._state_key)
        state = raw_state if isinstance(raw_state, RendererState) else None
        raw_stream = session_state.get(self._stream_key)
        stream = raw_stream if isinstance(raw_stream, ResponseStream) else None

        catalog = session_state.get(self._catalogs_key)
        catalogs: list[CatalogApi] | None = None
        if catalog:
            catalogs = (
                list(catalog)
                if isinstance(catalog, Sequence)
                and not isinstance(catalog, (str, bytes))
                else [catalog]
            )

        effective_converter: GenAIPartToA2APartConverter
        if catalogs is not None or processor is not None:
            converter_instance = self._get_part_converter(
                catalogs=catalogs, processor=processor, state=state
            )
            if stream is not None:
                effective_converter = self._make_stream_part_converter(
                    event=event,
                    stream=stream,
                    base_converter=converter_instance,
                )
            else:
                effective_converter = converter_instance.convert
        else:
            effective_converter = part_converter_func

        return convert_event_to_a2a_events(
            event,
            invocation_context,
            task_id,
            context_id,
            effective_converter,
        )

    def _make_stream_part_converter(
        self,
        *,
        event: "Event",
        stream: ResponseStream,
        base_converter: A2uiPartConverter,
    ) -> "GenAIPartToA2APartConverter":
        is_partial = getattr(event, "partial", None) is True
        flushed_final = False

        def _convert_part(part: genai_types.Part) -> list[a2a_types.Part]:
            nonlocal flushed_final
            if part.text is not None:
                if is_partial:
                    self._active_streams.add(stream)
                    try:
                        return to_a2a_parts(
                            stream.feed(part.text),
                            version=base_converter._version,
                        )
                    except Exception as e:
                        logger.warning("Failed to stream A2UI chunk: %s", e)
                        return []
                if stream in self._active_streams:
                    self._active_streams.discard(stream)
                    flushed_final = True
                    try:
                        return to_a2a_parts(
                            stream.close(),
                            version=base_converter._version,
                        )
                    except Exception as e:
                        logger.warning("Failed to close A2UI stream: %s", e)
                        if base_converter._fallback_text:
                            return [
                                a2a_types.Part(
                                    root=a2a_types.TextPart(
                                        text=base_converter._fallback_text
                                    )
                                )
                            ]
                        return []
                if flushed_final:
                    return []
            return base_converter.convert(part)

        return _convert_part
