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

"""Answers the `callAgentFunction` messages that a renderer sends.

Internal: `RendererToAgentMessageProcessor` is the public entry point.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable, Mapping
import inspect
import logging
import math
from typing import Any

from pydantic import ValidationError

from a2ui.core import (
    STRICT_VALIDATION,
    A2uiCatalogError,
    A2uiError,
    A2uiRpcError,
    A2uiValidationError,
    AgentFunction,
    AgentFunctionContext,
    CatalogApi,
    PayloadValidator,
    RpcErrorCode,
)
from a2ui.core.schema.v1_0 import (
    AgentFunctionResponseMessage,
    CallAgentFunctionMessage,
    FunctionResponse,
    FunctionResponseError,
)

logger = logging.getLogger(__name__)


class AgentFunctionRegistry:
    """Runs the agent functions of a set of catalogs for the renderer.

    The registry indexes each catalog's `agent_functions` by catalog ID and
    function name. `handle` answers one `callAgentFunction` message with the
    `agentFunctionResponse` to send back:

    1. The response copies the call's `functionCallId`. A call without one
       can't be answered, so `handle` raises `A2uiValidationError`.
    2. A call with an empty `surfaceId` or function name gets
       `INVALID_FUNCTION_CALL`.
    3. A function name or catalog ID that the registry doesn't know gets
       `UNKNOWN_FUNCTION`. Renderers set `catalogId` on every call; a call
       without one runs the agent function of that name if exactly one
       catalog has it.
    4. Arguments that fail the function's schema get `INVALID_FUNCTION_CALL`,
       as does a call to an `agentOnly` function, which renderers may not
       call. Valid arguments are passed to the handler with the schema's
       defaults applied, as `a2ui_core` validates them.
    5. A handler that raises gets `EXECUTION_ERROR`, with the exception's
       message and no traceback (the traceback is logged). A handler that
       raises `A2uiRpcError` chooses the code itself, so it can send codes
       such as `PROVIDER_NOT_FOUND`.

    Async handlers are awaited on the caller's event loop. Sync handlers run
    on a worker thread through `asyncio.to_thread`, so a slow handler doesn't
    stall the loop. The registry keeps no state about a call, so one registry
    can serve many conversations.
    """

    def __init__(
        self,
        catalogs: Iterable[CatalogApi],
        *,
        timeout: float | None = None,
    ) -> None:
        """Initializes the registry.

        Args:
            catalogs: The agent's catalogs. Only their `agent_functions` are
                registered.
            timeout: Seconds a call may take before its handler is cancelled
                and the call gets `EXECUTION_ERROR`. None sets no limit.

        Raises:
            A2uiCatalogError: If two catalogs have the same ID.
            ValueError: If `timeout` is not a finite positive number.
        """
        if timeout is not None and (
            isinstance(timeout, bool)
            or not isinstance(timeout, (int, float))
            or not math.isfinite(timeout)
            or timeout <= 0
        ):
            raise ValueError(
                "The agent function timeout must be a finite positive number,"
                f" got {timeout!r}."
            )
        self._catalogs: dict[str, CatalogApi] = {}
        self._functions: dict[tuple[str, str], AgentFunction] = {}
        for catalog in catalogs:
            if catalog.catalog_id in self._catalogs:
                raise A2uiCatalogError(
                    f"Duplicate catalog ID: '{catalog.catalog_id}'. Pass each"
                    " catalog once."
                )
            self._catalogs[catalog.catalog_id] = catalog
            for name, fn in catalog.agent_functions.items():
                self._functions[(catalog.catalog_id, name)] = fn
        self._timeout = timeout

    async def handle(
        self, message: CallAgentFunctionMessage | Mapping[str, Any]
    ) -> AgentFunctionResponseMessage:
        """Runs a `callAgentFunction` call and returns the response to send.

        Args:
            message: The `callAgentFunction` message, as a schema model or as
                parsed JSON.

        Returns:
            The `agentFunctionResponse` message, with the handler's return
            value or an error.

        Raises:
            A2uiValidationError: If the message has no `functionCallId` to
                answer, or an empty one.
        """
        call_message = _parse_call(message)
        if isinstance(call_message, AgentFunctionResponseMessage):
            return call_message

        call = call_message.call_agent_function
        call_id = call.function_call_id
        name = call.call_function.call
        if not call.surface_id:
            return _error(
                call_id,
                RpcErrorCode.INVALID_FUNCTION_CALL,
                f"The call to '{name}' has an empty surfaceId.",
            )
        if not name:
            return _error(
                call_id,
                RpcErrorCode.INVALID_FUNCTION_CALL,
                "callAgentFunction.callFunction['@call'] must be a non-empty string.",
            )
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

        async def run() -> AgentFunctionResponseMessage:
            # Catches the handler's own errors, including a TimeoutError it
            # raises, so that only the processor's deadline below counts as a
            # timeout.
            try:
                value = await _call_handler(fn, args, context)
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
                agentFunctionResponse=FunctionResponse(
                    functionCallId=call_id, value=value
                ),
            )

        if self._timeout is None:
            return await run()
        try:
            return await asyncio.wait_for(run(), self._timeout)
        except asyncio.TimeoutError:
            logger.warning(
                "Agent function '%s' (call %s) timed out after %ss.",
                name,
                call_id,
                self._timeout,
            )
            return _error(
                call_id,
                RpcErrorCode.EXECUTION_ERROR,
                f"Function '{name}' timed out after {self._timeout}s.",
            )


async def _call_handler(
    fn: AgentFunction, args: dict[str, Any], context: AgentFunctionContext
) -> Any:
    """Awaits an async handler, or runs a sync one on a worker thread."""
    if _is_async_callable(fn.handler):
        result = fn.invoke(args, context)
    else:
        result = await asyncio.to_thread(fn.invoke, args, context)
    if inspect.isawaitable(result):
        result = await result
    return result


def _is_async_callable(handler: Any) -> bool:
    return inspect.iscoroutinefunction(handler) or inspect.iscoroutinefunction(
        getattr(handler, "__call__", None)
    )


def _parse_call(
    message: CallAgentFunctionMessage | Mapping[str, Any],
) -> CallAgentFunctionMessage | AgentFunctionResponseMessage:
    """Validates a call message, or returns the error response for it.

    Raises:
        A2uiValidationError: If the message has no `functionCallId`, or an
            empty one.
    """
    if isinstance(message, CallAgentFunctionMessage):
        parsed = message
    else:
        try:
            parsed = CallAgentFunctionMessage.model_validate(message)
        except ValidationError as e:
            call = (
                message.get("callAgentFunction")
                if isinstance(message, Mapping)
                else None
            )
            call_id = call.get("functionCallId") if isinstance(call, Mapping) else None
            if not isinstance(call_id, str) or not call_id:
                raise A2uiValidationError(
                    f"Malformed callAgentFunction message without a functionCallId: {e}"
                ) from e
            return _error(
                call_id,
                RpcErrorCode.INVALID_FUNCTION_CALL,
                f"Malformed callAgentFunction message: {e}",
            )
    if not parsed.call_agent_function.function_call_id:
        raise A2uiValidationError(
            "callAgentFunction has an empty functionCallId, so it can't be answered."
        )
    return parsed


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
