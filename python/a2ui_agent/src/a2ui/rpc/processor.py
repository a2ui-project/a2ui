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

from collections.abc import Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass, field
import inspect
from typing import Any, TypeVar, cast

from pydantic import BaseModel, ValidationError

from a2ui.core import A2uiValidationError, CatalogApi
from a2ui.core.schema.v1_0 import (
    A2uiRendererActionMessage,
    A2uiRendererErrorMessage,
    AgentToRendererMessage,
    CallAgentFunctionMessage,
    RendererFunctionResponseMessage,
    RendererToAgentMessage,
)

from ._agent_function_registry import AgentFunctionRegistry

RendererToAgentMessageInput = RendererToAgentMessage | Mapping[str, Any]
"""A v1.0 renderer-to-agent message, as a schema model or as parsed JSON.

Parsed JSON must have `"version": "1.0"`.
"""

_M = TypeVar("_M", bound=BaseModel)

ActionCallback = Callable[
    [A2uiRendererActionMessage], Awaitable[bool | None] | bool | None
]
"""Receives a validated `action` message. Returns False to decline it."""

ErrorCallback = Callable[
    [A2uiRendererErrorMessage], Awaitable[bool | None] | bool | None
]
"""Receives a validated `error` message. Returns False to decline it."""

RendererFunctionResponseCallback = Callable[
    [RendererFunctionResponseMessage], Awaitable[bool | None] | bool | None
]
"""Receives a validated `rendererFunctionResponse` message.

Returns False to decline it.
"""

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
       A callback that returns False declines the message, which is then not
       handled; returning None or True means handled. Without the callback,
       the message isn't handled and isn't validated, so an agent framework
       can pass it on to the model's turn.

    Parsed JSON must have `"version": "1.0"`, as `renderer_to_agent.json`
    requires. To process several messages, call `process_message` for each,
    which leaves concurrency and per-message error handling to the caller.

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
            A2uiCatalogError: If two catalogs have the same ID.
            ValueError: If `agent_function_timeout` is not a finite positive
                number.
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
            A2uiValidationError: If the message isn't one v1.0
                renderer-to-agent message (parsed JSON without
                `"version": "1.0"` included), a `callAgentFunction` has no
                `functionCallId` or an empty one, or a message for a callback
                fails its schema.
            Exception: Whatever a callback raises.
        """
        kind = _message_kind(message)
        if kind == _CALL_AGENT_FUNCTION:
            call = cast(CallAgentFunctionMessage | Mapping[str, Any], message)
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


async def _dispatch(
    message: RendererToAgentMessageInput,
    model: type[_M],
    callback: Callable[[_M], Awaitable[bool | None] | bool | None] | None,
) -> ProcessResult:
    """Validates a message and runs its callback, if it has one."""
    if callback is None:
        return ProcessResult(handled=False)
    parsed: _M
    if isinstance(message, model):
        parsed = cast(_M, message)
    else:
        try:
            parsed = model.model_validate(message)
        except ValidationError as e:
            raise A2uiValidationError(f"Malformed {model.__name__}: {e}") from e
    result = callback(parsed)
    if inspect.isawaitable(result):
        result = await result
    return ProcessResult(handled=result is not False)


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
        raise A2uiValidationError(
            f"{type(message).__name__} is not a v1.0 renderer-to-agent message."
        )
    if not isinstance(message, Mapping):
        raise A2uiValidationError(
            "A renderer-to-agent message must be an object, got"
            f" {type(message).__name__}."
        )
    version = message.get("version")
    if version != "1.0":
        raise A2uiValidationError(
            f'A renderer-to-agent message must have "version": "1.0", got {version!r}.'
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
