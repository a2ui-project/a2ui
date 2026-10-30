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

"""Calls renderer functions from the agent and matches up their responses."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from dataclasses import dataclass
import logging
from types import TracebackType
from typing import Any
import uuid

from pydantic import ValidationError

from a2ui.core import A2uiRpcError, RpcErrorCode
from a2ui.core.schema.v1_0 import (
    CallRendererFunction,
    CallRendererFunctionMessage,
    FunctionCall,
    RendererFunctionResponseMessage,
)

logger = logging.getLogger(__name__)

DEFAULT_RENDERER_CALL_TIMEOUT = 30.0
"""Seconds a renderer function call waits for its response by default."""

RendererFunctionResponseInput = RendererFunctionResponseMessage | Mapping[str, Any]
"""A `rendererFunctionResponse` message, as a schema model or as parsed JSON."""


@dataclass
class _PendingCall:
    name: str
    future: asyncio.Future[Any]
    timer: asyncio.TimerHandle | None


class RendererFunctionCalls:
    """The agent's pending `callRendererFunction` calls in one conversation.

    `call` builds the message to send and returns it with a future, without
    waiting; `resolve` settles the future when the renderer's
    `rendererFunctionResponse` arrives:

    ```python
    message, result = calls.call(catalog_id=CATALOG_ID, name="getLocation")
    await send_to_renderer(message)
    value = await result
    ```

    An instance belongs to the event loop it is first used on. `call` and
    `dispose` must run on that loop; `resolve` may be called from any thread
    and hands the work to the loop. A call fails with `A2uiRpcError` when it
    times out (code `TIMEOUT`), when the renderer answers with an error (the
    renderer's code), or when the instance is disposed (code `CANCELLED`).
    Responses to calls that are unknown, already settled, timed out or
    cancelled are logged at debug level and ignored.
    """

    def __init__(
        self,
        *,
        default_timeout: float | None = DEFAULT_RENDERER_CALL_TIMEOUT,
        max_pending: int | None = None,
    ) -> None:
        """Initializes the call table.

        Args:
            default_timeout: Seconds a call waits for its response unless
                `call` sets another timeout. None waits without a limit.
            max_pending: The most calls that may wait for a response at once.
                `call` raises beyond it. None, the default, sets no limit.

        Raises:
            ValueError: If `default_timeout` or `max_pending` is not positive.
        """
        if default_timeout is not None and default_timeout <= 0:
            raise ValueError("default_timeout must be positive or None.")
        if max_pending is not None and max_pending < 1:
            raise ValueError("max_pending must be at least 1.")
        self._default_timeout = default_timeout
        self._max_pending = max_pending
        self._pending: dict[str, _PendingCall] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._disposed = False

    @property
    def disposed(self) -> bool:
        """Whether `dispose` has been called."""
        return self._disposed

    @property
    def pending_count(self) -> int:
        """The number of calls waiting for a response."""
        return len(self._pending)

    def call(
        self,
        *,
        catalog_id: str,
        name: str,
        args: Mapping[str, Any] | None = None,
        surface_id: str | None = None,
        timeout: float | None = None,
        function_call_id: str | None = None,
    ) -> tuple[CallRendererFunctionMessage, asyncio.Future[Any]]:
        """Registers a renderer function call and returns its message and future.

        Send the message to the renderer, then await the future for the
        function's value. Cancelling the future forgets the call. Serialize
        the message with `model_dump(by_alias=True, exclude_unset=True)`, as
        every A2UI RPC message.

        Args:
            catalog_id: The catalog that defines the function, which
                `callRendererFunction` requires.
            name: The function's name.
            args: The function's arguments.
            surface_id: The surface whose data model the call runs against.
                None runs it against an empty data model.
            timeout: Seconds to wait for the response, in place of the
                default timeout.
            function_call_id: The call's ID. None generates one.

        Returns:
            The `callRendererFunction` message and the future of its value.

        Raises:
            A2uiRpcError: If the instance is disposed (code `DISPOSED`), the
                ID is already pending (code `DUPLICATE`), `max_pending` calls
                are pending (code `TOO_MANY_PENDING`), or the message fails
                the schema (code `INVALID_FUNCTION_CALL`).
            RuntimeError: If no event loop is running, or the instance
                belongs to another loop.
            ValueError: If `timeout` is not positive.
        """
        if timeout is not None and timeout <= 0:
            raise ValueError("timeout must be positive.")
        if self._disposed:
            raise A2uiRpcError(
                "RendererFunctionCalls has been disposed.", code=RpcErrorCode.DISPOSED
            )
        loop = self._bind_loop()
        call_id = function_call_id or f"call-{uuid.uuid4().hex}"
        if call_id in self._pending:
            raise A2uiRpcError(
                f"A call with functionCallId '{call_id}' is already pending.",
                code=RpcErrorCode.DUPLICATE,
                function_call_id=call_id,
            )
        if self._max_pending is not None and len(self._pending) >= self._max_pending:
            raise A2uiRpcError(
                f"{len(self._pending)} renderer function calls are already"
                " pending, the most allowed.",
                code="TOO_MANY_PENDING",
                function_call_id=call_id,
            )
        if not catalog_id:
            raise A2uiRpcError(
                f"The call to '{name}' needs a catalogId.",
                code=RpcErrorCode.INVALID_FUNCTION_CALL,
                function_call_id=call_id,
            )
        try:
            # Left unset, not None, without a surface, so that
            # `model_dump(exclude_unset=True)` omits it: the schema types
            # `surfaceId` as a string and rejects null.
            surface = {} if surface_id is None else {"surfaceId": surface_id}
            message = CallRendererFunctionMessage(
                version="1.0",
                callRendererFunction=CallRendererFunction(
                    **surface,
                    functionCallId=call_id,
                    callFunction=FunctionCall.model_validate({
                        "@call": name,
                        "catalogId": catalog_id,
                        "args": dict(args or {}),
                    }),
                ),
            )
        except ValidationError as e:
            raise A2uiRpcError(
                f"Invalid callRendererFunction message for '{name}': {e}",
                code=RpcErrorCode.INVALID_FUNCTION_CALL,
                function_call_id=call_id,
            ) from e

        future: asyncio.Future[Any] = loop.create_future()
        effective_timeout = timeout if timeout is not None else self._default_timeout
        timer = (
            loop.call_later(
                effective_timeout, self._time_out, call_id, effective_timeout
            )
            if effective_timeout is not None
            else None
        )
        self._pending[call_id] = _PendingCall(name=name, future=future, timer=timer)
        future.add_done_callback(lambda _: self._forget(call_id, future))
        return message, future

    def resolve(self, message: RendererFunctionResponseInput) -> None:
        """Settles the call that a `rendererFunctionResponse` answers.

        The response comes from the network, so this never raises for it: a
        malformed response is logged as a warning, and a response that
        matches no pending call is logged at debug level. It may be called
        from any thread.

        Args:
            message: The `rendererFunctionResponse` message, as a schema model
                or as parsed JSON.
        """
        try:
            response = (
                message
                if isinstance(message, RendererFunctionResponseMessage)
                else RendererFunctionResponseMessage.model_validate(message)
            )
        except ValidationError as e:
            logger.warning("Ignoring a malformed rendererFunctionResponse: %s", e)
            return
        loop = self._loop
        if loop is None:
            logger.debug(
                "Ignoring rendererFunctionResponse %s: no call was made.",
                response.renderer_function_response.function_call_id,
            )
            return
        if _running_loop() is loop:
            self._settle(response)
            return
        try:
            loop.call_soon_threadsafe(self._settle, response)
        except RuntimeError:
            logger.debug(
                "Ignoring rendererFunctionResponse %s: the event loop is closed.",
                response.renderer_function_response.function_call_id,
            )

    def dispose(self, reason: str = "RendererFunctionCalls was disposed.") -> None:
        """Fails every pending call and refuses later ones.

        Pending futures fail with `A2uiRpcError` (code `CANCELLED`) carrying
        `reason`. Later `call`s raise, and later responses are ignored.

        Args:
            reason: Why the calls were dropped, such as "the session ended".
        """
        if self._disposed:
            return
        self._disposed = True
        loop = self._loop
        if loop is None or _running_loop() is loop or loop.is_closed():
            self._fail_all(reason)
            return
        try:
            loop.call_soon_threadsafe(self._fail_all, reason)
        except RuntimeError:
            # The loop closed after the check above.
            self._fail_all(reason)

    async def __aenter__(self) -> RendererFunctionCalls:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.dispose("RendererFunctionCalls was closed.")

    def _bind_loop(self) -> asyncio.AbstractEventLoop:
        loop = asyncio.get_running_loop()
        if self._loop is None:
            self._loop = loop
        elif self._loop is not loop:
            raise RuntimeError(
                "RendererFunctionCalls belongs to another event loop; use one"
                " instance per conversation, on one loop."
            )
        return loop

    def _settle(self, response: RendererFunctionResponseMessage) -> None:
        body = response.renderer_function_response
        call_id = body.function_call_id
        pending = self._pending.pop(call_id, None)
        if pending is None or pending.future.done():
            logger.debug(
                "Ignoring rendererFunctionResponse %s: no pending call has that"
                " ID (unknown, late or duplicate).",
                call_id,
            )
            return
        if pending.timer is not None:
            pending.timer.cancel()
        if body.error is not None:
            pending.future.set_exception(
                A2uiRpcError(
                    f"Renderer function '{pending.name}' failed"
                    f" ({body.error.code}): {body.error.message}",
                    code=body.error.code,
                    function_call_id=call_id,
                )
            )
        else:
            pending.future.set_result(body.value)

    def _time_out(self, call_id: str, timeout: float) -> None:
        pending = self._pending.pop(call_id, None)
        if pending is None or pending.future.done():
            return
        pending.future.set_exception(
            A2uiRpcError(
                f"Renderer function '{pending.name}' timed out after {timeout}s.",
                code=RpcErrorCode.TIMEOUT,
                function_call_id=call_id,
            )
        )

    def _forget(self, call_id: str, future: asyncio.Future[Any]) -> None:
        """Drops a settled or cancelled call and its timer."""
        pending = self._pending.get(call_id)
        if pending is None or pending.future is not future:
            return
        del self._pending[call_id]
        if pending.timer is not None:
            pending.timer.cancel()

    def _fail_all(self, reason: str) -> None:
        pending_calls = list(self._pending.items())
        self._pending.clear()
        for call_id, pending in pending_calls:
            if pending.timer is not None:
                pending.timer.cancel()
            if pending.future.done():
                continue
            try:
                pending.future.set_exception(
                    A2uiRpcError(
                        reason, code=RpcErrorCode.CANCELLED, function_call_id=call_id
                    )
                )
            except RuntimeError:
                # Failing a future schedules its callbacks on its loop, which
                # raises once the loop is closed. Nothing can await the future
                # then, so the call is just dropped.
                logger.debug(
                    "Dropping renderer function call %s: the event loop is closed.",
                    call_id,
                )


def _running_loop() -> asyncio.AbstractEventLoop | None:
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None
