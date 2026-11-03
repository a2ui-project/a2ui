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

"""Module for `a2ui_rpc_callback`, which answers agent function calls in ADK.

From v1.0, a renderer sends `callAgentFunction` to run a function on the agent.
Answering it is deterministic, and the renderer shows a pending value until
the answer arrives, so it shouldn't wait for a model turn.
`a2ui_rpc_callback` returns a `before_agent_callback` that answers a request
holding only such calls, through a `RendererToAgentMessageProcessor` built
from the agent's catalogs, and skips the agent. The renderer's other messages
(`action`, `error`, `rendererFunctionResponse`) go to the agent's turn.

It works with ADK's `A2aAgentExecutor`. The executor turns each A2UI
`DataPart` of the request into a GenAI part, and the callback turns it back
with ADK's own converter to read the A2UI message. The replies go back the same
way, as GenAI parts that ADK's converter, and `A2uiPartConverter`, turn into
A2UI `DataPart`s.

Usage Example:

  ```python
  processors = A2uiProcessorStore()

  def active_catalogs(ctx: ReadonlyContext) -> list[CatalogApi] | None:
      processor = processors.get(ctx)
      return processor.active_catalogs if processor else None

  agent = LlmAgent(
      ...,
      before_agent_callback=a2ui_rpc_callback(catalogs=active_catalogs),
  )
  ```
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Iterable, Mapping
import inspect
import logging
from typing import Any, TypeAlias

from google.adk.a2a.converters import part_converter
from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.utils.feature_decorator import experimental
from google.genai import types as genai_types

from a2ui.a2a import create_a2ui_parts
from a2ui.core import A2uiValidationError, CatalogApi
from a2ui.core.schema.v1_0 import AgentToRendererMessage
from a2ui.rpc import RendererToAgentMessageProcessor

from ._rpc import CALL_AGENT_FUNCTION, genai_part_a2ui_messages, message_kind

logger = logging.getLogger(__name__)

CatalogsProvider: TypeAlias = Callable[
    [ReadonlyContext],
    Iterable[CatalogApi] | None | Awaitable[Iterable[CatalogApi] | None],
]
"""Returns the agent's catalogs for a context, or None for none."""

A2uiRpcCallback: TypeAlias = Callable[
    [CallbackContext], Awaitable[genai_types.Content | None]
]
"""A `before_agent_callback` that answers A2UI agent function calls."""


@experimental
def a2ui_rpc_callback(
    *,
    catalogs: Iterable[CatalogApi] | CatalogsProvider,
    agent_function_timeout: float | None = None,
) -> A2uiRpcCallback:
    """Returns a `before_agent_callback` that answers agent function calls.

    The callback reads the user content that started the invocation. When
    every part of it is an A2UI `callAgentFunction` message, it builds a
    `RendererToAgentMessageProcessor` from `catalogs`, has it run each call's
    agent function, and returns the `agentFunctionResponse` replies as the
    agent's response, so the agent doesn't run.

    For any other content it returns None and the agent runs as usual. That
    includes text, the renderer's `action`, `error` and
    `rendererFunctionResponse` messages, and a mix of calls and other parts.
    A `callAgentFunction` without a `functionCallId` can't be answered, so it
    is logged and dropped.

    To combine it with a callback of your own, pass both as a list:
    `before_agent_callback=[a2ui_rpc_callback(...), my_callback]`. ADK runs
    them in order until one returns content.

    Args:
        catalogs: The catalogs whose agent functions answer
            `callAgentFunction`, or a sync or async provider that returns
            them, or None, per context. A provider can return the session's
            `A2uiRequestProcessor.active_catalogs`. When it returns None,
            the calls go to the agent.
        agent_function_timeout: Seconds an agent function may run, as for
            `RendererToAgentMessageProcessor`. None, the default, sets no
            limit.

    Returns:
        The callback, for `before_agent_callback` of an ADK agent.

    Raises:
        ValueError: If `agent_function_timeout` is not positive.
    """
    if agent_function_timeout is not None and agent_function_timeout <= 0:
        raise ValueError("agent_function_timeout must be positive.")
    provider: CatalogsProvider | None = None
    fixed: list[CatalogApi] | None = None
    if callable(catalogs):
        provider = catalogs
    else:
        fixed = list(catalogs)

    async def callback(callback_context: CallbackContext) -> genai_types.Content | None:
        messages = _rpc_messages(callback_context.user_content)
        if not messages or not all(
            message_kind(message) == CALL_AGENT_FUNCTION for message in messages
        ):
            return None

        resolved = (
            fixed
            if provider is None
            else await _resolve_catalogs(provider, callback_context)
        )
        if resolved is None:
            return None
        # The processor keeps no state, so building one per request is cheap.
        processor = RendererToAgentMessageProcessor(
            resolved, agent_function_timeout=agent_function_timeout
        )

        replies = await asyncio.gather(
            *(_process(processor, message) for message in messages)
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


async def _resolve_catalogs(
    provider: CatalogsProvider, ctx: ReadonlyContext
) -> Iterable[CatalogApi] | None:
    """Resolves a sync or async catalogs provider for `ctx`."""
    resolved = provider(ctx)
    if inspect.isawaitable(resolved):
        resolved = await resolved
    return resolved


async def _process(
    processor: RendererToAgentMessageProcessor, message: Mapping[str, Any]
) -> list[AgentToRendererMessage]:
    """Processes one call, logging and dropping one that can't be answered."""
    try:
        result = await processor.process_message(message)
    except A2uiValidationError as e:
        # The message comes from the network, so it doesn't fail the request.
        logger.warning("Dropped an A2UI RPC message that can't be answered: %s", e)
        return []
    return result.replies
