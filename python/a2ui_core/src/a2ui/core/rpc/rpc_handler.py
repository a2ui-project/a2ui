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

import asyncio
import inspect
import logging
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any, Generic, TypeVar, Union, cast

from ..catalog import Catalog
from ..catalog.catalog import TComponent, TFunction
from ..exceptions import A2uiRpcError, RpcErrorCode
from ..processing.adapters import is_catalog_version_compatible
from ..resolution.data_context import DataContext
from ..schema.v1_0 import (
    CallAgentFunction,
    CallAgentFunctionMessage,
    CallRendererFunctionMessage,
    FunctionResponse,
    FunctionResponseError,
    RendererFunctionResponseMessage,
)
from ..schema.v1_0.common_types import FunctionCall
from ..validation import PayloadValidator

logger = logging.getLogger(__name__)

T = TypeVar("T")

OutboundListener = Callable[[dict[str, Any]], Union[None, Awaitable[None]]]


@dataclass
class PendingAgentCall:
    """Record of a pending outbound callAgentFunction request matching TS interface."""

    resolve: Callable[[Any], None]
    reject: Callable[[BaseException], None]


@dataclass
class CallOptions:
    """Options for configuring an outbound call_agent_function request."""

    function_call_id: str | None = None
    timeout_ms: float | None = None
    version: str | None = None


@dataclass
class NormalizedAgentCall:
    """Normalized options for an outbound agent call."""

    function_call_id: str
    call: FunctionCall
    effective_timeout_ms: float
    version: str | None = None


class RpcHandler(Generic[TComponent, TFunction]):
    """Manages bidirectional RPC function execution between renderer and server agent."""

    def __init__(
        self,
        catalogs: Sequence[Catalog[TComponent, TFunction]] | None = None,
        outbound_listener: OutboundListener | None = None,
        default_timeout_ms: float = 30000.0,
    ) -> None:
        if not catalogs:
            raise ValueError("At least one catalog must be provided to RpcHandler.")
        self.catalogs = catalogs
        self.outbound_listener = outbound_listener
        self.default_timeout_ms = default_timeout_ms
        self._pending_agent_calls: dict[str, PendingAgentCall] = {}
        self._is_disposed = False

    @property
    def disposed(self) -> bool:
        """Indicates whether this RpcHandler instance has been disposed."""
        return self._is_disposed

    def dispose(self, reason: str = "RpcHandler has been disposed.") -> None:
        """Cancels all pending outbound RPC calls and marks the instance disposed."""
        if self._is_disposed:
            return
        self._is_disposed = True

        for call_id, pending in list(self._pending_agent_calls.items()):
            pending.reject(
                A2uiRpcError(
                    f"RpcHandler disposed while call '{call_id}' was pending: {reason}",
                    function_call_id=call_id,
                    code=RpcErrorCode.CANCELLED.value,
                )
            )
        self._pending_agent_calls.clear()

    def resolve_catalog(
        self, catalog_id: str | None = None
    ) -> Catalog[TComponent, TFunction] | None:
        """Resolves catalog by catalog_id or defaults to primary catalog."""
        if catalog_id is not None:
            for cat in self.catalogs:
                if getattr(cat, "catalog_id", None) == catalog_id:
                    return cat
            return None
        return None

    def create_response_error(
        self,
        call_id: str,
        code: RpcErrorCode,
        message: str,
        version: str,
    ) -> RendererFunctionResponseMessage:
        """Creates a renderer function error response payload model."""
        return RendererFunctionResponseMessage(
            version=cast(Any, version),
            rendererFunctionResponse=FunctionResponse(  # type: ignore[call-arg]
                functionCallId=call_id,
                error=FunctionResponseError(code=code.value, message=message),
            ),
        )

    def validate_inbound_message(
        self,
        message: CallRendererFunctionMessage,
    ) -> RendererFunctionResponseMessage | None:
        """Validates inbound CallRendererFunctionMessage.

        Returns:
            An error response model if validation fails, or None if valid.
        """
        version = str(getattr(message, "version", "v1.0"))
        if self._is_disposed:
            return self.create_response_error(
                getattr(
                    getattr(message, "call_renderer_function", None),
                    "function_call_id",
                    None,
                )
                or "unknown",
                RpcErrorCode.DISPOSED,
                "RpcHandler has been disposed.",
                version=version,
            )

        call_req = getattr(message, "call_renderer_function", None)
        if not call_req or not getattr(call_req, "call_function", None):
            return self.create_response_error(
                getattr(call_req, "function_call_id", None) or "unknown",
                RpcErrorCode.INVALID_FUNCTION_CALL,
                "Malformed message: missing callRendererFunction or callFunction.",
                version=version,
            )

        return None

    def check_execution_permissions(
        self,
        fn: Any,
        call_name: str,
        is_user_activated: bool,
    ) -> str | None:
        """Verifies function caller permissions and user activation requirements.

        Returns:
            An error message string if permission check fails, or None if allowed.
        """
        allowed_callers = getattr(fn, "allowed_callers", None) or "rendererOnly"
        if allowed_callers not in ("agentOnly", "rendererOrAgent"):
            return (
                f"Function '{call_name}' cannot be called by agent (allowedCallers is"
                f" {allowed_callers})."
            )

        requires_user_activation = getattr(fn, "requires_user_activation", False)
        if requires_user_activation and not is_user_activated:
            return (
                f"Function '{call_name}' requires user activation context to execute."
            )

        return None

    def resolve_function_implementation(
        self,
        catalog_id: str | None,
        call_name: str,
        context: DataContext | None = None,
        expected_version: str | None = None,
    ) -> tuple[Any | None, str | None]:
        """Resolves function implementation from catalog with optional version check.

        Returns:
            A tuple of (func_impl, error_message). If error_message is not None, resolution failed.
        """
        matched_catalog = self.resolve_catalog(catalog_id)
        if (
            not matched_catalog
            and context
            and hasattr(context, "surface")
            and context.surface
        ):
            matched_catalog = getattr(context.surface, "catalog", None)

        if not matched_catalog:
            return (
                None,
                f"Catalog not found: {catalog_id}"
                if catalog_id
                else "No catalog available for function resolution.",
            )

        if (
            matched_catalog
            and expected_version
            and not is_catalog_version_compatible(
                getattr(matched_catalog, "protocol_version", None),
                expected_version,
            )
        ):
            cat_version = getattr(matched_catalog, "protocol_version", None)
            return (
                None,
                (
                    f"Catalog specification version ({cat_version}) does not match"
                    f" message protocol version ({expected_version})."
                ),
            )

        fn = (
            matched_catalog.get_function(call_name)
            if hasattr(matched_catalog, "get_function")
            else getattr(matched_catalog, "functions", {}).get(call_name)
        )
        if not fn:
            return None, f"Function not found: {call_name}"

        return fn, None

    def _execute_function(
        self,
        fn: Any,
        args: dict[str, Any],
        context: DataContext | None,
        call_id: str,
        version: str,
        call_name: str = "",
        matched_catalog: Any = None,
    ) -> tuple[Any | None, dict[str, Any] | None]:
        """Validates args and invokes function, returning (result, error_response_dict)."""
        try:
            if matched_catalog:
                PayloadValidator(catalog=matched_catalog).validate_function(
                    call_name, args
                )
        except Exception as e:
            err_resp = self.create_response_error(
                call_id,
                RpcErrorCode.INVALID_FUNCTION_CALL,
                f"Invalid arguments for function '{call_name}': {e}",
                version=version,
            )
            return None, self.emit_outbound_response(
                err_resp.model_dump(
                    by_alias=True, exclude_none=True, exclude_unset=True
                )
            )

        try:
            target_fn = (
                fn.execute
                if hasattr(fn, "execute") and callable(fn.execute)
                else (fn if callable(fn) else None)
            )
            if target_fn is None:
                res = None
            else:
                sig = inspect.signature(target_fn)
                res = (
                    target_fn(args, context)
                    if len(sig.parameters) >= 2
                    else target_fn(args)
                )
            return res, None
        except Exception as e:
            err_resp = self.create_response_error(
                call_id,
                RpcErrorCode.EXECUTION_ERROR,
                str(e),
                version=version,
            )
            return None, self.emit_outbound_response(
                err_resp.model_dump(
                    by_alias=True, exclude_none=True, exclude_unset=True
                )
            )

    def _build_success_response(
        self, val: Any, call_id: str, version: str
    ) -> dict[str, Any]:
        """Constructs and emits a successful RendererFunctionResponseMessage dict."""
        resp = RendererFunctionResponseMessage(
            version=cast(Any, version),
            rendererFunctionResponse=FunctionResponse(  # type: ignore[call-arg]
                functionCallId=call_id,
                value=val,
            ),
        )
        return self.emit_outbound_response(
            resp.model_dump(by_alias=True, exclude_unset=True)
        )

    def execute_function_safely(
        self,
        fn: Any,
        args: dict[str, Any],
        context: DataContext | None,
        call_id: str,
        version: str,
        call_name: str = "",
        matched_catalog: Any = None,
    ) -> dict[str, Any]:
        """Safely executes a function implementation synchronously, returning response dict."""
        res, err = self._execute_function(
            fn, args, context, call_id, version, call_name, matched_catalog
        )
        if err is not None:
            return err
        val = asyncio.run(cast(Any, res)) if inspect.isawaitable(res) else res
        return self._build_success_response(val, call_id, version)

    async def execute_function_safely_async(
        self,
        fn: Any,
        args: dict[str, Any],
        context: DataContext | None,
        call_id: str,
        version: str,
        call_name: str = "",
        matched_catalog: Any = None,
    ) -> dict[str, Any]:
        """Safely executes a function implementation asynchronously, returning response dict."""
        res, err = self._execute_function(
            fn, args, context, call_id, version, call_name, matched_catalog
        )
        if err is not None:
            return err
        val = await cast(Any, res) if inspect.isawaitable(res) else res
        return self._build_success_response(val, call_id, version)

    async def handle_call_renderer_function_async(
        self,
        message: CallRendererFunctionMessage,
        context: DataContext | None = None,
        is_user_activated: bool = False,
    ) -> dict[str, Any]:
        """Asynchronously executes an agent-initiated function call on the renderer."""
        validation_error = self.validate_inbound_message(message)
        if validation_error is not None:
            res_dict = validation_error.model_dump(
                by_alias=True, exclude_none=True, exclude_unset=True
            )
            self.emit_outbound_response(res_dict)
            return res_dict

        version = str(message.version)
        call_req = message.call_renderer_function
        call_id = call_req.function_call_id or "unknown"
        call_fn = call_req.call_function
        call_name = call_fn.call
        catalog_id = call_fn.catalog_id
        args = call_fn.args or {}

        fn, resolve_error = self.resolve_function_implementation(
            catalog_id, call_name, context, version
        )
        if resolve_error:
            error_response = self.create_response_error(
                call_id,
                RpcErrorCode.INVALID_FUNCTION_CALL,
                resolve_error,
                version=version,
            )
            res_dict = error_response.model_dump(
                by_alias=True, exclude_none=True, exclude_unset=True
            )
            self.emit_outbound_response(res_dict)
            return res_dict

        access_error = self.check_execution_permissions(
            fn, call_name, is_user_activated
        )
        if access_error:
            error_response = self.create_response_error(
                call_id,
                RpcErrorCode.INVALID_FUNCTION_CALL,
                access_error,
                version=version,
            )
            res_dict = error_response.model_dump(
                by_alias=True, exclude_none=True, exclude_unset=True
            )
            self.emit_outbound_response(res_dict)
            return res_dict

        matched_catalog = self.resolve_catalog(catalog_id)
        return await self.execute_function_safely_async(
            fn,
            args,
            context,
            call_id,
            version,
            call_name=call_name,
            matched_catalog=matched_catalog,
        )

    def handle_call_renderer_function(
        self,
        message: CallRendererFunctionMessage,
        context: DataContext | None = None,
        is_user_activated: bool = False,
    ) -> dict[str, Any]:
        """Executes an agent-initiated function call on the renderer synchronously."""
        try:
            loop = asyncio.get_running_loop()
            if loop.is_running():
                # Avoid nested event loop blocking in async contexts
                return self.execute_function_safely(
                    self.resolve_function_implementation(
                        message.call_renderer_function.call_function.catalog_id,
                        message.call_renderer_function.call_function.call,
                        context,
                        str(message.version),
                    )[0],
                    message.call_renderer_function.call_function.args or {},
                    context,
                    message.call_renderer_function.function_call_id or "unknown",
                    str(message.version),
                    call_name=message.call_renderer_function.call_function.call,
                    matched_catalog=self.resolve_catalog(
                        message.call_renderer_function.call_function.catalog_id
                    ),
                )
            return loop.run_until_complete(
                self.handle_call_renderer_function_async(
                    message, context, is_user_activated=is_user_activated
                )
            )
        except RuntimeError:
            return asyncio.run(
                self.handle_call_renderer_function_async(
                    message, context, is_user_activated=is_user_activated
                )
            )

    def handle_agent_function_response(self, message: dict[str, Any]) -> None:
        """Resolves a pending outbound callAgentFunction request upon receiving agentFunctionResponse."""
        resp_obj = (
            message.get("agentFunctionResponse") if isinstance(message, dict) else None
        )
        if not resp_obj or not isinstance(resp_obj, dict):
            return

        call_id = resp_obj.get("functionCallId")
        if not call_id or call_id not in self._pending_agent_calls:
            return

        pending = self._pending_agent_calls.pop(call_id)
        error = resp_obj.get("error")
        if error and isinstance(error, dict):
            err_code = error.get("code", RpcErrorCode.UNKNOWN_ERROR.value)
            err_msg = error.get("message", "Agent function execution failed")
            pending.reject(
                A2uiRpcError(
                    f"Agent function error [{err_code}]: {err_msg}",
                    function_call_id=call_id,
                    code=err_code,
                )
            )
        else:
            pending.resolve(resp_obj.get("value"))

    def call_agent_function(
        self,
        surface_id: str,
        call: FunctionCall,
        options: CallOptions | None = None,
    ) -> asyncio.Future[Any]:
        """Invokes a remote function on the server agent using an options bag."""
        if self._is_disposed:
            raise A2uiRpcError(
                "RpcHandler has been disposed.",
                code=RpcErrorCode.DISPOSED.value,
            )
        if not self.outbound_listener:
            raise A2uiRpcError(
                "Cannot call agent function without outbound_listener configured.",
                code=RpcErrorCode.NO_LISTENER.value,
            )
        if not call or not getattr(call, "call", None):
            raise A2uiRpcError(
                "Missing or invalid function call name.",
                code=RpcErrorCode.INVALID_FUNCTION_CALL.value,
            )

        opts = options or CallOptions()
        call_id = opts.function_call_id or f"call-{uuid.uuid4().hex[:12]}"
        effective_timeout = (
            opts.timeout_ms if opts.timeout_ms is not None else self.default_timeout_ms
        )

        if call_id in self._pending_agent_calls:
            raise A2uiRpcError(
                f"A call with functionCallId '{call_id}' is already pending.",
                function_call_id=call_id,
                code=RpcErrorCode.DUPLICATE.value,
            )

        normalized = NormalizedAgentCall(
            function_call_id=call_id,
            call=call,
            effective_timeout_ms=effective_timeout,
            version=opts.version,
        )

        return self.dispatch_agent_call(surface_id, normalized)

    def dispatch_agent_call(
        self,
        surface_id: str,
        call_info: NormalizedAgentCall,
    ) -> asyncio.Future[Any]:
        """Dispatches a normalized agent function call to the outbound listener."""
        call_id = call_info.function_call_id
        call = call_info.call
        effective_timeout = call_info.effective_timeout_ms
        version = call_info.version

        outbound_msg = CallAgentFunctionMessage(
            version=cast(Any, version) if version is not None else cast(Any, "v1.0"),
            callAgentFunction=CallAgentFunction(
                surfaceId=surface_id,
                functionCallId=call_id,
                callFunction=call,
            ),
        ).model_dump(by_alias=True, exclude_none=True, exclude_unset=True)

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            try:
                loop = asyncio.get_event_loop_policy().get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)

        future: asyncio.Future[Any] = loop.create_future()

        timer_handle: asyncio.TimerHandle | None = None

        def resolve(val: Any) -> None:
            if timer_handle:
                timer_handle.cancel()
            if not future.done():
                try:
                    future.set_result(val)
                except (asyncio.InvalidStateError, Exception):
                    pass

        def reject(err: BaseException) -> None:
            if timer_handle:
                timer_handle.cancel()
            if not future.done():
                try:
                    future.set_exception(err)
                except (asyncio.InvalidStateError, Exception):
                    pass

        if effective_timeout > 0:

            def _on_timeout() -> None:
                p = self._pending_agent_calls.pop(call_id, None)
                if p:
                    p.reject(
                        A2uiRpcError(
                            f"Agent function call '{call.call}' timed out"
                            f" after {effective_timeout}ms.",
                            function_call_id=call_id,
                            code=RpcErrorCode.TIMEOUT.value,
                        )
                    )

            timer_handle = loop.call_later(effective_timeout / 1000.0, _on_timeout)

        pending = PendingAgentCall(resolve=resolve, reject=reject)
        self._pending_agent_calls[call_id] = pending

        if self.outbound_listener:
            try:
                res = self.outbound_listener(outbound_msg)
                if inspect.isawaitable(res):
                    loop.create_task(cast(Any, res))
            except Exception as exc:
                self._pending_agent_calls.pop(call_id, None)
                pending.reject(exc)
                raise exc
        else:
            self._pending_agent_calls.pop(call_id, None)
            err = A2uiRpcError(
                "No outbound_listener registered on RpcHandler",
                function_call_id=call_id,
                code=RpcErrorCode.NO_LISTENER.value,
            )
            pending.reject(err)
            raise err

        return future

    def emit_outbound_response(self, response: dict[str, Any]) -> dict[str, Any]:
        """Emits an outbound renderer function response message to the listener if registered."""
        if self.outbound_listener:
            try:
                res = self.outbound_listener(response)
                if inspect.isawaitable(res):
                    try:
                        loop = asyncio.get_running_loop()
                        loop.create_task(cast(Any, res))
                    except RuntimeError:
                        asyncio.run(cast(Any, res))
            except Exception:
                # Listener errors should not mask execution response
                pass
        return response

    def _emit_outbound_response(self, response: dict[str, Any]) -> dict[str, Any]:
        return self.emit_outbound_response(response)
