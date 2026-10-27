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
into A2A (Agent-to-Agent) event structures with A2UI payloads, using the request's processor.

Key Components:
  * `A2uiEventConverter`: An event converter that converts A2UI with the request's processor.

Usage Example:

  Configure the ADK executor to use the A2UI event converter, with the
  `A2uiProcessorStore` that the executor puts each request's processor in:

  ```python
  config = A2aAgentExecutorConfig(
      event_converter=A2uiEventConverter(a2ui_processor=processors.get)
  )
  executor = A2aAgentExecutor(config)
  ```
"""

from __future__ import annotations

from collections.abc import Callable
import dataclasses
import inspect
import logging
import time
from typing import TYPE_CHECKING, TypeAlias

from a2a import types as a2a_types
from google.adk.a2a.converters import event_converter as adk_event_converter
from google.adk.a2a.converters import part_converter
from google.adk.agents.readonly_context import ReadonlyContext
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

EventProcessorProvider: TypeAlias = Callable[
    [ReadonlyContext], A2uiRequestProcessor | None
]

# A stream is keyed by its invocation and the branch or author of its events,
# since the sub-agents of a `ParallelAgent` share the invocation and stream
# their responses at the same time.
_StreamKey: TypeAlias = tuple[str, str]


@dataclasses.dataclass
class _OpenStream:
    """The stream of a response that is still streaming."""

    # None once a chunk of the response failed.
    stream: ResponseStream | None
    last_used: float


@experimental
class A2uiEventConverter:
    """An event converter that converts A2UI with the request's processor.

    It gets the `A2uiRequestProcessor` for each event from `a2ui_processor`:
    one processor for every request, or a provider that returns the request's
    processor, such as `A2uiProcessorStore.get`. The processor supplies
    everything else: its catalogs, its inference format, and the
    `RendererState` bound to it, which a canvas agent binds with
    `A2uiRequestProcessor(state=...)` or `A2uiGenerator.create_processor(...,
    state=...)`. When the provider returns None, events are converted with
    ADK's default part converter.

    When the processor's format can stream and the agent streams partial
    events, the converter opens one `ResponseStream` per response with
    `processor.open_stream()`, feeds it each partial event, and closes it on the
    final event. A response is the events of one invocation from one branch or
    author, so the sub-agents of a `ParallelAgent` each get their own stream. A
    stream that gets no event for `stream_idle_timeout` seconds, as when the
    run was cancelled before its final event, is dropped.
    """

    def __init__(
        self,
        bypass_tool_check: bool = False,
        fallback_text: str | None = None,
        *,
        a2ui_processor: A2uiRequestProcessor | EventProcessorProvider,
        stream_idle_timeout: float = 600.0,
    ):
        """Initializes the converter.

        Args:
            bypass_tool_check: If True, bypass tool validation.
            fallback_text: Optional text to fall back on if parsing fails.
            a2ui_processor: The request processor for every request, or a
              provider that returns the request's processor, or None for a
              request without A2UI. The provider is called with a
              `ReadonlyContext` and must not be async, so the provider of
              `SendA2uiToClientToolset` can be shared with it if it is not
              async. Don't keep the processor in session state: ADK's session
              services save state as JSON and copy it each time they load a
              session. Keep it in an `A2uiProcessorStore` instead. A processor
              given for every request must not have a `RendererState` bound
              to it, since every conversation would share that state.
            stream_idle_timeout: The seconds after which a stream that gets no
              event is dropped.
        """
        self._bypass_tool_check = bypass_tool_check
        self._fallback_text = fallback_text
        if (
            isinstance(a2ui_processor, A2uiRequestProcessor)
            and a2ui_processor.state is not None
        ):
            logger.warning(
                "A2uiEventConverter got one processor for every request, with a"
                " RendererState bound to it: every conversation shares that"
                " state. Pass a provider that returns each conversation's"
                " processor instead."
            )
        self._a2ui_processor = a2ui_processor
        self._stream_idle_timeout = stream_idle_timeout
        self._streams: dict[_StreamKey, _OpenStream] = {}

    def _resolve_processor(
        self, invocation_context: InvocationContext
    ) -> A2uiRequestProcessor | None:
        """Returns the request's processor, or None for a request without A2UI."""
        if isinstance(self._a2ui_processor, A2uiRequestProcessor):
            return self._a2ui_processor
        processor = self._a2ui_processor(ReadonlyContext(invocation_context))
        if inspect.isawaitable(processor):
            close = getattr(processor, "close", None)
            if callable(close):
                close()
            raise TypeError(
                "The a2ui_processor provider of A2uiEventConverter must not be async."
            )
        if processor is not None and not isinstance(processor, A2uiRequestProcessor):
            raise TypeError(
                "The a2ui_processor provider of A2uiEventConverter returned"
                f" {type(processor).__name__}, not an A2uiRequestProcessor."
            )
        return processor

    def _drop_idle_streams(self) -> None:
        """Drops the streams that got no event for `stream_idle_timeout` seconds."""
        now = time.monotonic()
        idle = [
            key
            for key, open_stream in self._streams.items()
            if now - open_stream.last_used > self._stream_idle_timeout
        ]
        for key in idle:
            del self._streams[key]
        if idle:
            logger.warning(
                "Dropped %d A2UI streams that got no event for %s seconds.",
                len(idle),
                self._stream_idle_timeout,
            )

    def __call__(
        self,
        event: Event,
        invocation_context: InvocationContext,
        task_id: str | None = None,
        context_id: str | None = None,
        part_converter_func: GenAIPartToA2APartConverter = part_converter.convert_genai_part_to_a2a_part,
    ) -> list[A2AEvent]:
        """Converts an ADK event to A2A events, using the request's processor if it has one."""
        self._drop_idle_streams()
        processor = self._resolve_processor(invocation_context)
        if processor is None:
            return adk_event_converter.convert_event_to_a2a_events(
                event, invocation_context, task_id, context_id, part_converter_func
            )

        a2ui_part_converter = A2uiPartConverter(
            processor,
            bypass_tool_check=self._bypass_tool_check,
            fallback_text=self._fallback_text,
        )
        key: _StreamKey = (
            invocation_context.invocation_id,
            getattr(event, "branch", None) or getattr(event, "author", None) or "",
        )
        convert_part: GenAIPartToA2APartConverter = (
            self._streaming_part_converter(
                event=event,
                key=key,
                processor=processor,
                a2ui_part_converter=a2ui_part_converter,
            )
            if processor.format.supports_streaming
            else a2ui_part_converter.convert
        )
        a2a_events = adk_event_converter.convert_event_to_a2a_events(
            event, invocation_context, task_id, context_id, convert_part
        )
        if getattr(event, "partial", None) is not True and key in self._streams:
            # A final event with no parts, such as an error, never reaches
            # convert_part, so the stream would stay open. Its trailing parts
            # have no event to go in.
            if trailing := self._close_stream(key):
                logger.warning(
                    "Dropped %d A2UI parts left in the stream of invocation %s,"
                    " whose final event has no parts.",
                    len(trailing),
                    key[0],
                )
        return a2a_events

    def _close_stream(self, key: _StreamKey) -> list[a2a_types.Part]:
        """Closes and removes the response's open stream, returning any trailing parts."""
        stream = self._streams.pop(key).stream
        if stream is None:
            return self._fallback_parts()
        try:
            return to_a2a_parts(stream.close())
        except Exception as e:
            # The error may quote the response, so its text is only logged at
            # debug level.
            logger.warning("Failed to close A2UI stream: %s", type(e).__name__)
            logger.debug("A2UI stream close error: %s", e)
            return self._fallback_parts()

    def _streaming_part_converter(
        self,
        *,
        event: Event,
        key: _StreamKey,
        processor: A2uiRequestProcessor,
        a2ui_part_converter: A2uiPartConverter,
    ) -> GenAIPartToA2APartConverter:
        """Returns the part converter for one event of a streamed response.

        ADK calls it once per part with only the part, so it captures what
        streaming needs from the event: whether the event is partial, and the
        key of the response whose stream to use. A partial event's text is fed
        to the response's stream, which is opened on the first one. If a chunk fails,
        the rest of the response's partial text is dropped. The final event of
        a streamed response closes the stream, or sends the fallback text if a
        chunk failed, and its own text, which repeats what the partial events
        held, is dropped. Every other part, including model thoughts, and the
        text of a response sent without partial events, goes to
        `a2ui_part_converter`.
        """
        is_partial = getattr(event, "partial", None) is True
        closed_stream = False

        def convert_part(part: genai_types.Part) -> list[a2a_types.Part]:
            nonlocal closed_stream
            if part.text is None or part.thought:
                parts = a2ui_part_converter.convert(part)
                if not is_partial and key in self._streams:
                    closed_stream = True
                    return [*self._close_stream(key), *parts]
                return parts
            if is_partial:
                open_stream = self._streams.get(key)
                if open_stream is None:
                    open_stream = self._streams[key] = _OpenStream(
                        stream=processor.open_stream(), last_used=time.monotonic()
                    )
                open_stream.last_used = time.monotonic()
                if open_stream.stream is None:
                    # A chunk of this response failed and ended its stream. A
                    # new stream would start in the middle of a block and send
                    # the rest of the block as text, so the rest is dropped.
                    return []
                try:
                    return to_a2a_parts(open_stream.stream.feed(part.text))
                except Exception as e:
                    # The error may quote the response, so its text is only
                    # logged at debug level.
                    logger.warning("Failed to stream A2UI chunk: %s", type(e).__name__)
                    logger.debug("A2UI stream chunk error: %s", e)
                    open_stream.stream = None
                    return []
            if key in self._streams:
                closed_stream = True
                return self._close_stream(key)
            if closed_stream:
                return []
            return a2ui_part_converter.convert(part)

        return convert_part

    def _fallback_parts(self) -> list[a2a_types.Part]:
        """The fallback text as a part, or no parts when there is none."""
        if not self._fallback_text:
            return []
        return [a2a_types.Part(root=a2a_types.TextPart(text=self._fallback_text))]
