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
`a2ui_rpc_callback` returns a `before_agent_callback` that answers a request
holding only such messages and skips the agent.

It works with ADK's `A2aAgentExecutor`. The executor turns each A2UI
`DataPart` of the request into a GenAI part, and the callback turns it back
with ADK's own converter to read the A2UI message. The replies go back the same
way, as GenAI parts that ADK's converter, and `A2uiPartConverter`, turn into
A2UI `DataPart`s.

Usage Example:

  ```python
  registry = AgentFunctionRegistry(catalogs)
  renderer_calls = A2uiRendererCallsStore()

  agent = LlmAgent(
      ...,
      before_agent_callback=a2ui_rpc_callback(
          agent_functions=registry, renderer_calls=renderer_calls.get
      ),
  )
  ```
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping
import inspect
import logging
from typing import Any, TypeAlias

from google.adk.a2a.converters import part_converter
from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.utils.feature_decorator import experimental
from google.genai import types as genai_types

from a2ui.a2a import create_a2ui_parts, get_a2ui_messages
from a2ui.core import A2uiRpcError, A2uiValidationError
from a2ui.core.schema.v1_0 import AgentToRendererMessage
from a2ui.rpc import AgentFunctionRegistry, RendererFunctionCalls, RendererMessageRouter

logger = logging.getLogger(__name__)

AgentFunctionRegistryProvider: TypeAlias = Callable[
    [ReadonlyContext],
    AgentFunctionRegistry | None | Awaitable[AgentFunctionRegistry | None],
]
"""Returns the agent function registry for a context, or None for none."""

RendererFunctionCallsProvider: TypeAlias = Callable[
    [ReadonlyContext],
    RendererFunctionCalls | None | Awaitable[RendererFunctionCalls | None],
]
"""Returns the session's `RendererFunctionCalls`, such as `A2uiRendererCallsStore.get`."""

A2uiRpcCallback: TypeAlias = Callable[
    [CallbackContext], Awaitable[genai_types.Content | None]
]
"""A `before_agent_callback` that answers A2UI RPC messages."""

_CALL_AGENT_FUNCTION = "callAgentFunction"
_RENDERER_FUNCTION_RESPONSE = "rendererFunctionResponse"


@experimental
def a2ui_rpc_callback(
    *,
    agent_functions: (
        AgentFunctionRegistry | AgentFunctionRegistryProvider | None
    ) = None,
    renderer_calls: RendererFunctionCallsProvider | None = None,
) -> A2uiRpcCallback:
    """Returns a `before_agent_callback` that answers A2UI RPC messages.

    The callback reads the user content that started the invocation. When
    every part of it is an A2UI message that the callback handles, it handles
    them and returns the replies as the agent's response, so the agent doesn't
    run:

    1. `callAgentFunction` runs the agent function in `agent_functions` and
       replies with its `agentFunctionResponse`.
    2. `rendererFunctionResponse` settles the call in the session's
       `RendererFunctionCalls`, from `renderer_calls`, and sends no reply. A
       request holding only such responses gets a response with no parts,
       and `A2aAgentExecutor` ends its task without a result.

    For any other content, such as text, a renderer's `action`, or a mix of
    RPC messages and other parts, it returns None and the agent runs as usual.
    A `callAgentFunction` without a `functionCallId` can't be answered, so it
    is logged and dropped.

    To combine it with a callback of your own, pass both as a list:
    `before_agent_callback=[a2ui_rpc_callback(...), my_callback]`. ADK runs
    them in order until one returns content.

    Args:
        agent_functions: The registry that answers `callAgentFunction`, or a
            provider that returns it, or None, per context. One registry can
            serve every session, since it keeps no state between calls. A
            provider can build one from the session's catalogs, such as
            `AgentFunctionRegistry(processors.get(ctx).active_catalogs)`.
            Without a registry, `callAgentFunction` goes to the agent.
        renderer_calls: A provider of the session's `RendererFunctionCalls`,
            such as `A2uiRendererCallsStore.get`. Without one,
            `rendererFunctionResponse` goes to the agent.

    Returns:
        The callback, for `before_agent_callback` of an ADK agent.

    Raises:
        ValueError: If neither `agent_functions` nor `renderer_calls` is
            given.
    """
    if agent_functions is None and renderer_calls is None:
        raise ValueError("Pass agent_functions, renderer_calls, or both.")

    async def callback(callback_context: CallbackContext) -> genai_types.Content | None:
        messages = _rpc_messages(callback_context.user_content)
        if not messages:
            return None

        registry: AgentFunctionRegistry | None = None
        calls: RendererFunctionCalls | None = None
        if any(_CALL_AGENT_FUNCTION in message for message in messages):
            registry = await _resolve_registry(agent_functions, callback_context)
        if any(_RENDERER_FUNCTION_RESPONSE in message for message in messages):
            calls = await _resolve_calls(renderer_calls, callback_context)
        router = RendererMessageRouter(agent_functions=registry, renderer_calls=calls)
        if not all(router.handles(message) for message in messages):
            return None

        replies = await asyncio.gather(
            *(_dispatch(router, message) for message in messages)
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
        a2a_part = part_converter.convert_genai_part_to_a2a_part(part)
        if a2a_part is None:
            return []
        part_messages = get_a2ui_messages([a2a_part])
        if not part_messages:
            return []
        messages.extend(part_messages)
    return messages


async def _resolve_registry(
    agent_functions: AgentFunctionRegistry | AgentFunctionRegistryProvider | None,
    ctx: ReadonlyContext,
) -> AgentFunctionRegistry | None:
    """Resolves the registry, or a sync or async provider of it, for `ctx`."""
    if agent_functions is None or isinstance(agent_functions, AgentFunctionRegistry):
        return agent_functions
    resolved = agent_functions(ctx)
    if inspect.isawaitable(resolved):
        resolved = await resolved
    return resolved


async def _resolve_calls(
    renderer_calls: RendererFunctionCallsProvider | None,
    ctx: ReadonlyContext,
) -> RendererFunctionCalls | None:
    """Resolves a sync or async provider of the session's calls for `ctx`."""
    if renderer_calls is None:
        return None
    resolved = renderer_calls(ctx)
    if inspect.isawaitable(resolved):
        resolved = await resolved
    return resolved


async def _dispatch(
    router: RendererMessageRouter, message: Mapping[str, Any]
) -> list[AgentToRendererMessage]:
    """Dispatches one message, logging and dropping one that can't be answered."""
    try:
        return await router.dispatch(message)
    except A2uiValidationError as e:
        # The message comes from the network, so it doesn't fail the request.
        logger.warning("Dropped an A2UI RPC message that can't be answered: %s", e)
    except A2uiRpcError as e:
        # The registry was disposed, so nobody is left to answer.
        logger.debug("Dropped an A2UI RPC message: %s", e)
    return []
