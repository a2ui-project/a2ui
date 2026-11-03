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

"""Processes the messages that a renderer sends to the agent (A2UI v1.0)."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field
import inspect
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from a2ui.core import A2uiValidationError, CatalogApi
from a2ui.core.schema.v1_0 import (
    A2uiRendererActionMessage,
    A2uiRendererErrorMessage,
    AgentToRendererMessage,
    CallAgentFunctionMessage,
    RendererFunctionResponseMessage,
)

from ._agent_function_registry import AgentFunctionRegistry

RendererToAgentMessageInput = BaseModel | Mapping[str, Any]
"""A renderer-to-agent message, as a schema model or as parsed JSON."""

_M = TypeVar("_M", bound=BaseModel)

ActionCallback = Callable[[A2uiRendererActionMessage], Awaitable[None] | None]
"""Receives a validated `action` message."""

ErrorCallback = Callable[[A2uiRendererErrorMessage], Awaitable[None] | None]
"""Receives a validated `error` message."""

RendererFunctionResponseCallback = Callable[
    [RendererFunctionResponseMessage], Awaitable[None] | None
]
"""Receives a validated `rendererFunctionResponse` message."""

_CALL_AGENT_FUNCTION = "callAgentFunction"
_ACTION = "action"
_ERROR = "error"
_RENDERER_FUNCTION_RESPONSE = "rendererFunctionResponse"

_MODEL_KINDS: dict[type[BaseModel], str] = {
    CallAgentFunctionMessage: _CALL_AGENT_FUNCTION,
    A2uiRendererActionMessage: _ACTION,
    A2uiRendererErrorMessage: _ERROR,
    RendererFunctionResponseMessage: _RENDERER_FUNCTION_RESPONSE,
}


@dataclass(frozen=True)
class ProcessResult:
    """What processing one renderer message did.

    Attributes:
        handled: Whether the processor handled the message. A message it
            didn't handle, such as an `action` without an `on_action`
            callback, is for the agent's turn.
        replies: The messages to send back to the renderer. Serialize them
            with `model_dump(by_alias=True, exclude_unset=True)`.
    """

    handled: bool
    replies: list[AgentToRendererMessage] = field(default_factory=list)


class RendererToAgentMessageProcessor:
    """Processes the messages that a renderer sends to the agent.

    The agent-side counterpart of `a2ui.core.MessageProcessor`. Each message
    is one of the four renderer-to-agent messages of v1.0:

    1. `callAgentFunction` is always handled. The processor runs the agent
       function of the agent's catalogs that the call names, and replies with
       exactly one `agentFunctionResponse`, carrying the handler's value or an
       error (`UNKNOWN_FUNCTION`, `INVALID_FUNCTION_CALL`, `EXECUTION_ERROR`,
       or the code of an `A2uiRpcError` the handler raised).
    2. `action`, `error` and `rendererFunctionResponse` are handled by the
       matching callback, if one is set. The processor validates the message,
       awaits the callback with the schema model, and replies with nothing.
       Without the callback, the message isn't handled and isn't validated,
       so an agent framework can pass it on to the model's turn.

    ```python
    processor = RendererToAgentMessageProcessor(request_processor.active_catalogs)

    result = await processor.process_message(message)
    for reply in result.replies:
        await send_to_renderer(reply.model_dump(by_alias=True, exclude_unset=True))
    if not result.handled:
        ...  # run the agent's turn
    ```

    The processor keeps no state about a message once it has processed it,
    so build one per agent, or one per request from the active catalogs.
    """

    def __init__(
        self,
        catalogs: Iterable[CatalogApi],
        *,
        agent_function_timeout: float | None = None,
        on_action: ActionCallback | None = None,
        on_error: ErrorCallback | None = None,
        on_renderer_function_response: RendererFunctionResponseCallback | None = None,
    ) -> None:
        """Initializes the processor.

        Args:
            catalogs: The agent's catalogs, such as
                `A2uiRequestProcessor.active_catalogs`. Their
                `agent_functions` answer `callAgentFunction`.
            agent_function_timeout: Seconds an agent function call may take
                before its handler is cancelled and the call gets
                `EXECUTION_ERROR`. None, the default, sets no limit, because
                the renderer already times out its calls. A sync handler
                can't be stopped: the reply is sent, but its thread runs to
                the end.
            on_action: Handles `action` messages. None leaves them unhandled.
            on_error: Handles `error` messages. None leaves them unhandled.
            on_renderer_function_response: Handles `rendererFunctionResponse`
                messages. None leaves them unhandled.

        Raises:
            ValueError: If `agent_function_timeout` is not positive.
        """
        self._agent_functions = AgentFunctionRegistry(
            catalogs, timeout=agent_function_timeout
        )
        self._on_action = on_action
        self._on_error = on_error
        self._on_renderer_function_response = on_renderer_function_response

    async def process_message(
        self, message: RendererToAgentMessageInput
    ) -> ProcessResult:
        """Processes one renderer-to-agent message.

        Cancelling the call cancels a running agent function handler and
        replies with nothing.

        Args:
            message: The message, as a schema model or as parsed JSON.

        Returns:
            Whether the message was handled, and the replies to send.

        Raises:
            A2uiValidationError: If the message isn't one renderer-to-agent
                message, a `callAgentFunction` has no `functionCallId` or an
                empty one, or a message for a callback fails its schema.
            Exception: Whatever a callback raises.
        """
        kind = _message_kind(message)
        if kind == _CALL_AGENT_FUNCTION:
            call = (
                message
                if isinstance(message, (CallAgentFunctionMessage, Mapping))
                else message.model_dump(by_alias=True, exclude_unset=True)
            )
            return ProcessResult(
                handled=True, replies=[await self._agent_functions.handle(call)]
            )
        if kind == _ACTION:
            return await _dispatch(message, A2uiRendererActionMessage, self._on_action)
        if kind == _ERROR:
            return await _dispatch(message, A2uiRendererErrorMessage, self._on_error)
        return await _dispatch(
            message,
            RendererFunctionResponseMessage,
            self._on_renderer_function_response,
        )

    async def process_messages(
        self, messages: Iterable[RendererToAgentMessageInput]
    ) -> list[ProcessResult]:
        """Processes several messages concurrently.

        Args:
            messages: The messages, each as a schema model or as parsed JSON.

        Returns:
            The result of each message, in the order of `messages`.

        Raises:
            A2uiValidationError: As `process_message` does, for the first
                message that fails.
            Exception: Whatever a callback raises.
        """
        return list(
            await asyncio.gather(
                *(self.process_message(message) for message in messages)
            )
        )


async def _dispatch(
    message: RendererToAgentMessageInput,
    model: type[_M],
    callback: Callable[[_M], Awaitable[None] | None] | None,
) -> ProcessResult:
    """Validates a message and runs its callback, if it has one."""
    if callback is None:
        return ProcessResult(handled=False)
    if isinstance(message, model):
        parsed = message
    else:
        payload = (
            message.model_dump(by_alias=True, exclude_unset=True)
            if isinstance(message, BaseModel)
            else message
        )
        try:
            parsed = model.model_validate(payload)
        except ValidationError as e:
            raise A2uiValidationError(f"Malformed {model.__name__}: {e}") from e
    result = callback(parsed)
    if inspect.isawaitable(result):
        await result
    return ProcessResult(handled=True)


def _message_kind(message: RendererToAgentMessageInput) -> str:
    """The message's type key, such as `callAgentFunction`.

    Raises:
        A2uiValidationError: If the message isn't one renderer-to-agent
            message.
    """
    for model, kind in _MODEL_KINDS.items():
        if isinstance(message, model):
            return kind
    if isinstance(message, BaseModel):
        message = message.model_dump(by_alias=True, exclude_unset=True)
    if not isinstance(message, Mapping):
        raise A2uiValidationError(
            "A renderer-to-agent message must be an object, got"
            f" {type(message).__name__}."
        )
    keys = [key for key in message if key != "version"]
    if len(keys) != 1:
        raise A2uiValidationError(
            "A renderer-to-agent message must have exactly one of"
            f" {sorted(_MODEL_KINDS.values())}, got {sorted(map(str, keys))}."
        )
    kind = keys[0]
    if kind not in _MODEL_KINDS.values():
        raise A2uiValidationError(
            f"Unknown renderer-to-agent message '{kind}'; expected one of"
            f" {sorted(_MODEL_KINDS.values())}."
        )
    return kind
