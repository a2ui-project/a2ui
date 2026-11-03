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

"""One entry point for the RPC messages that a renderer sends to the agent."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from pydantic import BaseModel

from a2ui.core import A2uiValidationError
from a2ui.core.schema.v1_0 import (
    AgentToRendererMessage,
    CallAgentFunctionMessage,
    RendererFunctionResponseMessage,
)

from .agent_function_registry import AgentFunctionRegistry
from .renderer_function_calls import RendererFunctionCalls

RendererMessageInput = BaseModel | Mapping[str, Any]
"""A renderer-to-agent message, as a schema model or as parsed JSON."""

_CALL_AGENT_FUNCTION = "callAgentFunction"
_RENDERER_FUNCTION_RESPONSE = "rendererFunctionResponse"


class RendererMessageRouter:
    """Sends each renderer RPC message to the helper that handles it.

    1. `callAgentFunction` goes to the `AgentFunctionRegistry`, and `dispatch`
       returns its `agentFunctionResponse`.
    2. `rendererFunctionResponse` settles a call in `RendererFunctionCalls`,
       and `dispatch` returns nothing.

    Other messages, such as `action` and `error`, are for the agent itself, so
    the router doesn't handle them: check `handles` first, and pass the
    messages it rejects on to the agent.

    ```python
    if router.handles(message):
        for reply in await router.dispatch(message):
            await send_to_renderer(reply.model_dump(by_alias=True, exclude_unset=True))
    else:
        ...  # run the agent's turn
    ```
    """

    def __init__(
        self,
        *,
        agent_functions: AgentFunctionRegistry | None = None,
        renderer_calls: RendererFunctionCalls | None = None,
    ) -> None:
        """Initializes the router.

        Args:
            agent_functions: Answers `callAgentFunction`. None leaves those
                messages unhandled.
            renderer_calls: Settles `rendererFunctionResponse`. None leaves
                those messages unhandled.
        """
        self.agent_functions = agent_functions
        self.renderer_calls = renderer_calls

    def handles(self, message: RendererMessageInput) -> bool:
        """Whether `dispatch` accepts the message.

        Args:
            message: A renderer-to-agent message, as a schema model or as
                parsed JSON.

        Returns:
            True for `callAgentFunction` when the router has an
            `AgentFunctionRegistry`, and for `rendererFunctionResponse` when
            it has a `RendererFunctionCalls`.
        """
        kind = _message_kind(message)
        if kind == _CALL_AGENT_FUNCTION:
            return self.agent_functions is not None
        if kind == _RENDERER_FUNCTION_RESPONSE:
            return self.renderer_calls is not None
        return False

    async def dispatch(
        self, message: RendererMessageInput
    ) -> list[AgentToRendererMessage]:
        """Handles one renderer RPC message.

        Args:
            message: A `callAgentFunction` or `rendererFunctionResponse`
                message, as a schema model or as parsed JSON.

        Returns:
            The messages to send back to the renderer: the
            `agentFunctionResponse` for a `callAgentFunction`, and none for a
            `rendererFunctionResponse`. Serialize them with
            `model_dump(by_alias=True, exclude_unset=True)`.

        Raises:
            A2uiValidationError: If the router doesn't handle the message (see
                `handles`).
            A2uiRpcError: If the registry is disposed while it handles a
                `callAgentFunction`.
        """
        kind = _message_kind(message)
        if kind == _CALL_AGENT_FUNCTION and self.agent_functions is not None:
            payload = (
                message
                if isinstance(message, (CallAgentFunctionMessage, Mapping))
                else message.model_dump(by_alias=True, exclude_unset=True)
            )
            return [await self.agent_functions.handle(payload)]
        if kind == _RENDERER_FUNCTION_RESPONSE and self.renderer_calls is not None:
            self.renderer_calls.resolve(
                message
                if isinstance(message, (RendererFunctionResponseMessage, Mapping))
                else message.model_dump(by_alias=True, exclude_unset=True)
            )
            return []
        described = f"'{kind}' messages" if kind else "this message"
        raise A2uiValidationError(
            f"RendererMessageRouter doesn't handle {described}; check"
            " `handles` before calling `dispatch`."
        )


def _message_kind(message: RendererMessageInput) -> str | None:
    """The message's type key, such as `callAgentFunction`."""
    if isinstance(message, CallAgentFunctionMessage):
        return _CALL_AGENT_FUNCTION
    if isinstance(message, RendererFunctionResponseMessage):
        return _RENDERER_FUNCTION_RESPONSE
    if isinstance(message, BaseModel):
        message = message.model_dump(by_alias=True, exclude_unset=True)
    if not isinstance(message, Mapping):
        return None
    keys = [key for key in message if key != "version"]
    return keys[0] if len(keys) == 1 and isinstance(keys[0], str) else None
