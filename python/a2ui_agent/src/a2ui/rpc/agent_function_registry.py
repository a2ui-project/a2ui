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

"""Answers the `callAgentFunction` messages that a renderer sends."""

from __future__ import annotations

import asyncio
from collections.abc import Iterable, Mapping
import inspect
import logging
from typing import Any

from pydantic import ValidationError

from a2ui.core import (
    STRICT_VALIDATION,
    A2uiError,
    A2uiRpcError,
    A2uiValidationError,
    PayloadValidator,
    RpcErrorCode,
)
from a2ui.core.catalog import AgentFunction, AgentFunctionContext, CatalogApi
from a2ui.core.schema.v1_0 import (
    AgentFunctionResponseMessage,
    CallAgentFunctionMessage,
    FunctionResponse,
    FunctionResponseError,
)

logger = logging.getLogger(__name__)

CallAgentFunctionInput = CallAgentFunctionMessage | Mapping[str, Any]
"""A `callAgentFunction` message, as a schema model or as parsed JSON."""


class AgentFunctionRegistry:
    """Runs the agent functions of a set of catalogs for the renderer.

    The registry indexes each catalog's `agent_functions` by catalog ID and
    function name. `handle` answers one `callAgentFunction` message with the
    `agentFunctionResponse` to send back:

    1. The response copies the call's `functionCallId`.
    2. A function name or catalog ID that the registry doesn't know gets
       `UNKNOWN_FUNCTION`. Renderers set `catalogId` on every call; a call
       without one runs the agent function of that name if exactly one
       catalog has it.
    3. Arguments that fail the function's schema get `INVALID_FUNCTION_CALL`,
       as does a call to an `agentOnly` function, which renderers may not
       call. Valid arguments are passed to the handler with the schema's
       defaults applied, as `a2ui_core` validates them.
    4. A handler that raises gets `EXECUTION_ERROR`, with the exception's
       message and no traceback (the traceback is logged). A handler that
       raises `A2uiRpcError` chooses the code itself, so it can send codes
       such as `PROVIDER_NOT_FOUND`.

    Async handlers are awaited on the caller's event loop. Sync handlers run
    on a worker thread through `asyncio.to_thread`, so a slow handler doesn't
    stall the loop. The registry keeps no state about a call once it has
    answered it, so one registry can serve many conversations.
    """

    def __init__(
        self,
        catalogs: Iterable[CatalogApi],
        *,
        max_concurrency: int | None = None,
        timeout: float | None = None,
    ) -> None:
        """Initializes the registry.

        Args:
            catalogs: The agent's catalogs, such as
                `A2uiRequestProcessor.active_catalogs`. Only their
                `agent_functions` are registered.
            max_concurrency: The most handlers that may run at once. Calls
                beyond it wait for a running one to finish. None, the
                default, sets no limit.
            timeout: Seconds a call may take before its handler is cancelled
                and the call gets `EXECUTION_ERROR`. None, the default, sets
                no limit, because the renderer already times out its calls.
                `handle` can override it per call.

        Raises:
            ValueError: If `max_concurrency` is less than 1, or `timeout` is
                not positive.
        """
        if max_concurrency is not None and max_concurrency < 1:
            raise ValueError("max_concurrency must be at least 1.")
        if timeout is not None and timeout <= 0:
            raise ValueError("timeout must be positive.")
        self._catalogs: dict[str, CatalogApi] = {}
        self._functions: dict[tuple[str, str], AgentFunction] = {}
        for catalog in catalogs:
            self._catalogs[catalog.catalog_id] = catalog
            for name, fn in catalog.agent_functions.items():
                self._functions[(catalog.catalog_id, name)] = fn
        self._timeout = timeout
        self._semaphore = (
            asyncio.Semaphore(max_concurrency) if max_concurrency is not None else None
        )
        self._tasks: set[asyncio.Task[Any]] = set()
        self._disposed = False

    @property
    def functions(self) -> dict[tuple[str, str], AgentFunction]:
        """The registered agent functions, keyed by `(catalog_id, name)`."""
        return dict(self._functions)

    @property
    def disposed(self) -> bool:
        """Whether `dispose` has been called."""
        return self._disposed

    def get(self, catalog_id: str, name: str) -> AgentFunction | None:
        """Returns the agent function a catalog registers under `name`, if any."""
        return self._functions.get((catalog_id, name))

    def dispose(self) -> None:
        """Cancels the handlers that are running and refuses later calls.

        A `handle` call whose handler is cancelled this way raises
        `A2uiRpcError` with code `DISPOSED` instead of returning a response,
        because nobody is left to send it to.
        """
        if self._disposed:
            return
        self._disposed = True
        for task in list(self._tasks):
            task.cancel()

    async def handle(
        self,
        message: CallAgentFunctionInput,
        *,
        timeout: float | None = None,
    ) -> AgentFunctionResponseMessage:
        """Runs a `callAgentFunction` call and returns the response to send.

        Serialize the response with `model_dump(by_alias=True,
        exclude_unset=True)`. `exclude_none=True` would drop a `value` of
        `None`, which the response must still carry.

        Args:
            message: The `callAgentFunction` message, as a schema model or as
                parsed JSON.
            timeout: Seconds this call may take, in place of the registry's
                timeout.

        Returns:
            The `agentFunctionResponse` message, with the handler's return
            value or an error.

        Raises:
            A2uiRpcError: With code `DISPOSED`, if the registry is disposed
                before or while the call runs.
            A2uiValidationError: If the message is so malformed that it has
                no `functionCallId` to answer.
            ValueError: If `timeout` is not positive.
        """
        if timeout is not None and timeout <= 0:
            raise ValueError("timeout must be positive.")
        if self._disposed:
            raise A2uiRpcError(
                "AgentFunctionRegistry has been disposed.",
                code=RpcErrorCode.DISPOSED,
            )

        call_message = _parse_call(message)
        if isinstance(call_message, AgentFunctionResponseMessage):
            return call_message

        call = call_message.call_agent_function
        call_id = call.function_call_id
        name = call.call_function.call
        catalog_id = call.call_function.catalog_id
        if catalog_id is None:
            matches = [cid for (cid, fn_name) in self._functions if fn_name == name]
            if len(matches) > 1:
                return _error(
                    call_id,
                    RpcErrorCode.INVALID_FUNCTION_CALL,
                    f"The call to '{name}' has no catalogId, and several"
                    f" catalogs have an agent function of that name: {matches}.",
                )
            if not matches:
                return _error(
                    call_id,
                    RpcErrorCode.UNKNOWN_FUNCTION,
                    f"No catalog of the agent has an agent function '{name}'.",
                )
            catalog_id = matches[0]
        catalog = self._catalogs.get(catalog_id)
        if catalog is None:
            return _error(
                call_id,
                RpcErrorCode.UNKNOWN_FUNCTION,
                f"The agent has no catalog '{catalog_id}'.",
            )
        fn = self._functions.get((catalog_id, name))
        if fn is None:
            return _error(
                call_id,
                RpcErrorCode.UNKNOWN_FUNCTION,
                f"Catalog '{catalog_id}' has no agent function '{name}'.",
            )
        if fn.allowed_callers == "agentOnly":
            return _error(
                call_id,
                RpcErrorCode.INVALID_FUNCTION_CALL,
                f"Function '{name}' can't be called by the renderer"
                " (allowedCallers is agentOnly).",
            )

        try:
            args = PayloadValidator(
                catalog, config=STRICT_VALIDATION
            ).validate_function(name, call.call_function.args)
        except (A2uiError, ValueError) as e:
            return _error(
                call_id,
                RpcErrorCode.INVALID_FUNCTION_CALL,
                f"Invalid arguments for function '{name}': {e}",
            )

        context = AgentFunctionContext(
            catalog_id=catalog_id,
            surface_id=call.surface_id,
            function_call_id=call_id,
        )
        effective_timeout = timeout if timeout is not None else self._timeout
        task = asyncio.ensure_future(self._run(fn, args, context))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        try:
            value = await asyncio.wait_for(task, effective_timeout)
        except asyncio.TimeoutError:
            logger.warning(
                "Agent function '%s' (call %s) timed out after %ss.",
                name,
                call_id,
                effective_timeout,
            )
            return _error(
                call_id,
                RpcErrorCode.EXECUTION_ERROR,
                f"Function '{name}' timed out after {effective_timeout}s.",
            )
        except asyncio.CancelledError:
            if self._disposed and task.cancelled() and not _current_task_cancelling():
                raise A2uiRpcError(
                    "AgentFunctionRegistry was disposed while the call was running.",
                    code=RpcErrorCode.DISPOSED,
                    function_call_id=call_id,
                ) from None
            raise
        except A2uiRpcError as e:
            logger.info(
                "Agent function '%s' (call %s) failed with %s: %s",
                name,
                call_id,
                e.code,
                e.message,
            )
            return _error(call_id, e.code, e.message)
        except Exception as e:
            logger.exception("Agent function '%s' (call %s) failed.", name, call_id)
            return _error(call_id, RpcErrorCode.EXECUTION_ERROR, str(e))

        return AgentFunctionResponseMessage(
            version="1.0",
            agentFunctionResponse=FunctionResponse(functionCallId=call_id, value=value),
        )

    async def _run(
        self,
        fn: AgentFunction,
        args: dict[str, Any],
        context: AgentFunctionContext,
    ) -> Any:
        """Runs a handler, within the concurrency limit."""
        if self._semaphore is None:
            return await _call_handler(fn, args, context)
        async with self._semaphore:
            return await _call_handler(fn, args, context)


async def _call_handler(
    fn: AgentFunction, args: dict[str, Any], context: AgentFunctionContext
) -> Any:
    """Awaits an async handler, or runs a sync one on a worker thread."""
    handler = fn.handler
    if _is_async_callable(handler):
        result = handler(args, context)
    else:
        result = await asyncio.to_thread(handler, args, context)
    if inspect.isawaitable(result):
        result = await result
    return result


def _is_async_callable(handler: Any) -> bool:
    return inspect.iscoroutinefunction(handler) or inspect.iscoroutinefunction(
        getattr(handler, "__call__", None)
    )


def _current_task_cancelling() -> bool:
    """Whether the running task itself has been asked to cancel (Python 3.11+)."""
    task = asyncio.current_task()
    cancelling = getattr(task, "cancelling", None)
    return bool(cancelling()) if cancelling is not None else False


def _parse_call(
    message: CallAgentFunctionInput,
) -> CallAgentFunctionMessage | AgentFunctionResponseMessage:
    """Validates a call message, or returns the error response for it."""
    if isinstance(message, CallAgentFunctionMessage):
        return message
    try:
        return CallAgentFunctionMessage.model_validate(message)
    except ValidationError as e:
        call = (
            message.get("callAgentFunction") if isinstance(message, Mapping) else None
        )
        call_id = call.get("functionCallId") if isinstance(call, Mapping) else None
        if not isinstance(call_id, str) or not call_id:
            raise _malformed_call(e) from e
        return _error(
            call_id,
            RpcErrorCode.INVALID_FUNCTION_CALL,
            f"Malformed callAgentFunction message: {e}",
        )


def _malformed_call(e: ValidationError) -> A2uiValidationError:
    return A2uiValidationError(
        f"Malformed callAgentFunction message without a functionCallId: {e}"
    )


def _error(
    call_id: str, code: RpcErrorCode | str, message: str
) -> AgentFunctionResponseMessage:
    return AgentFunctionResponseMessage(
        version="1.0",
        agentFunctionResponse=FunctionResponse(
            functionCallId=call_id,
            error=FunctionResponseError(
                code=code.value if isinstance(code, RpcErrorCode) else code,
                message=message,
            ),
        ),
    )
