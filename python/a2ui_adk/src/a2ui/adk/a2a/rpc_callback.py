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

"""Module for `a2ui_rpc_callback`, which answers A2UI RPC messages in ADK.

From v1.0, a renderer sends `callAgentFunction` to run a function on the agent,
and `rendererFunctionResponse` to answer the agent's `callRendererFunction`.
Answering them is deterministic, and the renderer shows a pending value until
the answer arrives, so they shouldn't wait for a model turn.
`a2ui_rpc_callback` returns a `before_agent_callback` that handles a request
holding only such messages, through a `RendererToAgentMessageProcessor`, and
skips the agent. The renderer's other messages (`action`, `error`), and
responses to calls the session's `RendererFunctionCalls` didn't make, go to
the agent's turn.

It works with ADK's `A2aAgentExecutor`. The executor turns each A2UI
`DataPart` of the request into a GenAI part, and the callback turns it back
with ADK's own converter to read the A2UI message. The replies go back the same
way, as GenAI parts that ADK's converter, and `A2uiPartConverter`, turn into
A2UI `DataPart`s.

Usage Example:

  ```python
  processors = A2uiProcessorStore()
  renderer_calls = A2uiRendererCallsStore()

  def active_catalogs(ctx: ReadonlyContext) -> list[CatalogApi] | None:
      processor = processors.get(ctx)
      return processor.active_catalogs if processor else None

  agent = LlmAgent(
      ...,
      before_agent_callback=a2ui_rpc_callback(
          catalogs=active_catalogs, renderer_calls=renderer_calls.get
      ),
  )
  ```
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Iterable, Mapping
import inspect
import logging
import math
from typing import Any, TypeAlias

from google.adk.a2a.converters import part_converter
from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.utils.feature_decorator import experimental
from google.genai import types as genai_types

from a2ui.a2a import create_a2ui_parts
from a2ui.core import A2uiValidationError, CatalogApi
from a2ui.core.schema.v1_0 import AgentToRendererMessage
from a2ui.rpc import RendererFunctionCalls, RendererToAgentMessageProcessor

from ._rpc import (
    CALL_AGENT_FUNCTION,
    RENDERER_FUNCTION_RESPONSE,
    RENDERER_RPC_KINDS,
    genai_part_a2ui_messages,
    message_kind,
    renderer_function_response_id,
)

logger = logging.getLogger(__name__)

CatalogsProvider: TypeAlias = Callable[
    [ReadonlyContext],
    Iterable[CatalogApi] | None | Awaitable[Iterable[CatalogApi] | None],
]
"""Returns the agent's catalogs for a context, or None for none."""

RendererFunctionCallsProvider: TypeAlias = Callable[
    [ReadonlyContext],
    RendererFunctionCalls | None | Awaitable[RendererFunctionCalls | None],
]
"""Returns the session's `RendererFunctionCalls`, such as `A2uiRendererCallsStore.get`."""

A2uiRpcCallback: TypeAlias = Callable[
    [CallbackContext], Awaitable[genai_types.Content | None]
]
"""A `before_agent_callback` that answers A2UI RPC messages."""


@experimental
def a2ui_rpc_callback(
    *,
    catalogs: Iterable[CatalogApi] | CatalogsProvider | None = None,
    renderer_calls: RendererFunctionCallsProvider | None = None,
    agent_function_timeout: float | None = None,
) -> A2uiRpcCallback:
    """Returns a `before_agent_callback` that answers A2UI RPC messages.

    The callback reads the user content that started the invocation. When
    every part of it is an A2UI message that the callback handles, it
    processes them with a `RendererToAgentMessageProcessor` and returns the
    replies as the agent's response, so the agent doesn't run:

    1. `callAgentFunction` runs the agent function of `catalogs` and replies
       with its `agentFunctionResponse`.
    2. `rendererFunctionResponse` that answers a pending call of the
       session's `RendererFunctionCalls`, from `renderer_calls`, settles the
       call (`RendererFunctionCalls.resolve` is the processor's
       `on_renderer_function_response`) and sends no reply. A request holding
       only such responses gets a response with no parts, which
       `A2aAgentExecutor` ends in the `working` state; `a2ui_rpc_interceptor`
       ends it `completed` instead.

    For any other content it returns None and the agent runs as usual. That
    includes text, the renderer's `action` and `error` messages, a mix of RPC
    messages and other parts, and a `rendererFunctionResponse` that answers no
    pending call, such as one to a call the model wrote itself, which the
    inference formats compile into `callRendererFunction`. Even then, any
    `rendererFunctionResponse` in the request that answers a pending call of
    the session settles that call first, so it doesn't wait for its timeout;
    the agent still sees the whole request. A `callAgentFunction` that the
    processor can't answer, such as one without a `functionCallId` or with a
    `version` other than `"1.0"`, is logged and dropped. A
    malformed `rendererFunctionResponse` fails the call it names.

    To combine it with a callback of your own, pass both as a list:
    `before_agent_callback=[a2ui_rpc_callback(...), my_callback]`. ADK runs
    them in order until one returns content.

    Args:
        catalogs: The catalogs whose agent functions answer
            `callAgentFunction`, or a sync or async provider that returns
            them, or None, per context. A provider can return the session's
            `A2uiRequestProcessor.active_catalogs`. Without catalogs,
            `callAgentFunction` goes to the agent.
        renderer_calls: A sync or async provider of the session's
            `RendererFunctionCalls`, such as `A2uiRendererCallsStore.get`.
            Without one, `rendererFunctionResponse` goes to the agent.
        agent_function_timeout: Seconds an agent function may run, as for
            `RendererToAgentMessageProcessor`. None, the default, sets no
            limit.

    Returns:
        The callback, for `before_agent_callback` of an ADK agent.

    Raises:
        ValueError: If neither `catalogs` nor `renderer_calls` is given, or
            `agent_function_timeout` is not a finite positive number.
    """
    if catalogs is None and renderer_calls is None:
        raise ValueError("Pass catalogs, renderer_calls, or both.")
    if agent_function_timeout is not None and (
        isinstance(agent_function_timeout, bool)
        or not isinstance(agent_function_timeout, (int, float))
        or not math.isfinite(agent_function_timeout)
        or agent_function_timeout <= 0
    ):
        raise ValueError("agent_function_timeout must be a finite positive number.")
    provider: CatalogsProvider | None = None
    fixed: list[CatalogApi] | None = None
    if callable(catalogs):
        provider = catalogs
    elif catalogs is not None:
        fixed = list(catalogs)

    async def callback(callback_context: CallbackContext) -> genai_types.Content | None:
        content = callback_context.user_content
        messages = _rpc_messages(content)
        kinds = {message_kind(message) for message in messages}

        calls: RendererFunctionCalls | None = None
        responses = [
            message
            for message in _a2ui_messages(content)
            if message_kind(message) == RENDERER_FUNCTION_RESPONSE
        ]
        if responses and renderer_calls is not None:
            calls = await _resolve(renderer_calls, callback_context)
        if not messages or not kinds <= RENDERER_RPC_KINDS:
            # The request goes to the agent, but responses to the session's
            # own calls still settle them, so those calls don't time out.
            _settle_pending(calls, responses)
            return None
        if RENDERER_FUNCTION_RESPONSE in kinds and (
            calls is None
            or not all(
                calls.is_pending(renderer_function_response_id(message) or "")
                for message in responses
            )
        ):
            # Some responses answer calls the session didn't make, such as
            # calls the model wrote, so the agent sees the request; the
            # session's own calls are settled first.
            _settle_pending(calls, responses)
            return None

        active: Iterable[CatalogApi] = []
        if CALL_AGENT_FUNCTION in kinds:
            resolved: Iterable[CatalogApi] | None = (
                fixed
                if provider is None
                else await _resolve(provider, callback_context)
            )
            if resolved is None:
                _settle_pending(calls, responses)
                return None
            active = resolved

        # The processor keeps no state, so building one per request is cheap.
        processor = RendererToAgentMessageProcessor(
            active,
            agent_function_timeout=agent_function_timeout,
            on_renderer_function_response=calls.resolve if calls else None,
        )
        replies = await asyncio.gather(
            *(_process(processor, calls, message) for message in messages)
        )
        parts: list[genai_types.Part] = []
        for a2a_part in create_a2ui_parts(
            reply for message_replies in replies for reply in message_replies
        ):
            genai_part = part_converter.convert_a2a_part_to_genai_part(a2a_part)
            if genai_part is not None:
                parts.append(genai_part)
        return genai_types.Content(role="model", parts=parts)

    return callback


def _rpc_messages(content: genai_types.Content | None) -> list[dict[str, Any]]:
    """The A2UI messages of `content`, or none if any part isn't A2UI."""
    if content is None or not content.parts:
        return []
    messages: list[dict[str, Any]] = []
    for part in content.parts:
        part_messages = genai_part_a2ui_messages(part)
        if not part_messages:
            return []
        messages.extend(part_messages)
    return messages


def _a2ui_messages(content: genai_types.Content | None) -> list[dict[str, Any]]:
    """The A2UI messages of every A2UI part of `content`, skipping other parts."""
    if content is None or not content.parts:
        return []
    return [
        message for part in content.parts for message in genai_part_a2ui_messages(part)
    ]


def _settle_pending(
    calls: RendererFunctionCalls | None, responses: list[dict[str, Any]]
) -> None:
    """Settles the session's pending calls that `responses` answer.

    Responses to calls the session didn't make are left for the agent.
    `RendererFunctionCalls.resolve` settles each call at most once, on its
    loop, so a call settled here is ignored if its response comes again.
    """
    if calls is None:
        return
    for message in responses:
        call_id = renderer_function_response_id(message)
        if call_id is not None and calls.is_pending(call_id):
            calls.resolve(message)


async def _resolve(
    provider: Callable[[ReadonlyContext], Any], ctx: ReadonlyContext
) -> Any:
    """Calls a sync or async provider for `ctx`."""
    resolved = provider(ctx)
    if inspect.isawaitable(resolved):
        resolved = await resolved
    return resolved


async def _process(
    processor: RendererToAgentMessageProcessor,
    calls: RendererFunctionCalls | None,
    message: Mapping[str, Any],
) -> list[AgentToRendererMessage]:
    """Processes one message, logging and dropping one that can't be answered."""
    try:
        result = await processor.process_message(message)
    except A2uiValidationError as e:
        # The message comes from the network, so it doesn't fail the request.
        # Its error may quote the payload, so the details are logged only at
        # debug level.
        logger.warning(
            "Dropped an A2UI RPC message that can't be answered: %s",
            type(e).__name__,
        )
        logger.debug("Dropped A2UI RPC message error: %s", e)
        if calls is not None and message_kind(message) == RENDERER_FUNCTION_RESPONSE:
            # Fails the pending call the malformed response names, at once.
            calls.resolve(message)
        return []
    return result.replies
