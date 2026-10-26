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
into A2A (Agent-to-Agent) event structures with A2UI payloads, using the session's request processor.

Key Components:
  * `A2uiEventConverter`: An event converter that converts A2UI with the session's request processor.

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

import logging
from typing import TYPE_CHECKING

from a2a import types as a2a_types
from google.adk.a2a.converters import part_converter
from google.adk.utils.feature_decorator import experimental
from google.genai import types as genai_types

from a2ui.a2a import to_a2a_parts
from a2ui.parser import ResponseStream
from a2ui.processor import A2uiRequestProcessor

from .part_converter import A2uiPartConverter

if TYPE_CHECKING:
    from a2a.server.events import Event as A2AEvent
    from google.adk.a2a.converters.part_converter import GenAIPartToA2APartConverter
    from google.adk.agents.invocation_context import InvocationContext
    from google.adk.events.event import Event

logger = logging.getLogger(__name__)


@experimental
class A2uiEventConverter:
    """An event converter that converts A2UI with the session's request processor.

    It reads an `A2uiRequestProcessor` from the `system:a2ui_processor`
    session-state key, which the agent's executor stores for each request. The
    processor supplies everything else: its catalogs, its inference format, and
    the `RendererState` bound to it, which a canvas agent binds with
    `A2uiRequestProcessor(state=...)` or `A2uiGenerator.create_processor(...,
    state=...)`. Without a processor in session state, events are converted
    with ADK's default part converter.

    When the processor's format can stream and the agent streams partial
    events, the converter opens one `ResponseStream` per response with
    `processor.open_stream()`, feeds it each partial event, and closes it on the
    final event.
    """

    def __init__(
        self,
        bypass_tool_check: bool = False,
        fallback_text: str | None = None,
        *,
        processor_key: str = "system:a2ui_processor",
    ):
        self._bypass_tool_check = bypass_tool_check
        self._fallback_text = fallback_text
        self._processor_key = processor_key
        # The open stream of each invocation whose response is still streaming.
        # The final event of the response closes and removes it.
        self._streams: dict[str, ResponseStream] = {}

    def __call__(
        self,
        event: "Event",
        invocation_context: "InvocationContext",
        task_id: str | None = None,
        context_id: str | None = None,
        part_converter_func: "GenAIPartToA2APartConverter" = part_converter.convert_genai_part_to_a2a_part,
    ) -> list["A2AEvent"]:
        """Converts an ADK event to A2A events, using the session processor if available."""
        from google.adk.a2a.converters.event_converter import (
            convert_event_to_a2a_events,
        )

        processor = invocation_context.session.state.get(self._processor_key)
        if not isinstance(processor, A2uiRequestProcessor):
            return convert_event_to_a2a_events(
                event, invocation_context, task_id, context_id, part_converter_func
            )

        a2ui_part_converter = A2uiPartConverter(
            processor,
            bypass_tool_check=self._bypass_tool_check,
            fallback_text=self._fallback_text,
        )
        convert_part: GenAIPartToA2APartConverter = (
            self._streaming_part_converter(
                event=event,
                invocation_id=invocation_context.invocation_id,
                processor=processor,
                a2ui_part_converter=a2ui_part_converter,
            )
            if processor.format.supports_streaming
            else a2ui_part_converter.convert
        )
        return convert_event_to_a2a_events(
            event, invocation_context, task_id, context_id, convert_part
        )

    def _streaming_part_converter(
        self,
        *,
        event: "Event",
        invocation_id: str,
        processor: A2uiRequestProcessor,
        a2ui_part_converter: A2uiPartConverter,
    ) -> "GenAIPartToA2APartConverter":
        """Returns the part converter for one event of a streamed response.

        ADK calls it once per part with only the part, so it captures what
        streaming needs from the event: whether the event is partial, and the
        invocation whose stream to use. A partial event's text is fed to the
        invocation's stream, which is opened on the first one. The final event
        of a streamed response closes the stream, and its text, which repeats
        what the partial events held, is dropped. Every other part, and the
        text of a response sent without partial events, goes to
        `a2ui_part_converter`.
        """
        is_partial = getattr(event, "partial", None) is True
        closed_stream = False

        def convert_part(part: genai_types.Part) -> list[a2a_types.Part]:
            nonlocal closed_stream
            if part.text is None:
                return a2ui_part_converter.convert(part)
            if is_partial:
                stream = self._streams.get(invocation_id)
                if stream is None:
                    stream = self._streams[invocation_id] = processor.open_stream()
                try:
                    return to_a2a_parts(stream.feed(part.text))
                except Exception as e:
                    logger.warning("Failed to stream A2UI chunk: %s", e)
                    return []
            stream = self._streams.pop(invocation_id, None)
            if stream is not None:
                closed_stream = True
                try:
                    return to_a2a_parts(stream.close())
                except Exception as e:
                    logger.warning("Failed to close A2UI stream: %s", e)
                    return self._fallback_parts()
            if closed_stream:
                return []
            return a2ui_part_converter.convert(part)

        return convert_part

    def _fallback_parts(self) -> list[a2a_types.Part]:
        """The fallback text as a part, or no parts when there is none."""
        if not self._fallback_text:
            return []
        return [a2a_types.Part(root=a2a_types.TextPart(text=self._fallback_text))]
