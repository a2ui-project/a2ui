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
import pytest
from typing import Any, cast

from a2ui.core.catalog import Catalog, FunctionApi, FunctionImplementation
from a2ui.core.exceptions import A2uiRpcError, RpcErrorCode
from a2ui.core.resolution import DataContext
from a2ui.core.rpc import CallOptions, RpcHandler
from a2ui.core.schema.v1_0 import CallRendererFunction, CallRendererFunctionMessage
from a2ui.core.schema.v1_0.common_types import FunctionCall


def test_rpc_handler_initialization_and_disposal() -> None:
    cat = Catalog("basic", protocol_version="v1.0")
    handler = RpcHandler([cat], default_timeout_ms=5000.0)

    assert not handler.disposed
    handler.dispose()
    assert handler.disposed

    from a2ui.core.schema.v1_0 import CallRendererFunction, CallRendererFunctionMessage
    from a2ui.core.schema.v1_0.common_types import FunctionCall

    resp = handler.handle_call_renderer_function(
        CallRendererFunctionMessage(
            version="v1.0",
            call_renderer_function=CallRendererFunction(
                function_call_id="call-1",
                call_function=FunctionCall(call="someFunc"),
            ),
        ),
        context=None,
    )
    assert resp["rendererFunctionResponse"]["error"]["code"] == "DISPOSED"


@pytest.mark.asyncio
async def test_rpc_handler_outbound_call_agent_function() -> None:
    sent_msgs: list[dict[str, Any]] = []

    def outbound_listener(msg: dict[str, Any]) -> None:
        sent_msgs.append(msg)

    cat = Catalog("basic", protocol_version="v1.0")
    handler = RpcHandler([cat], outbound_listener=outbound_listener)

    from a2ui.core.rpc import CallOptions
    from a2ui.core.schema.v1_0.common_types import FunctionCall

    fut = handler.call_agent_function(
        surface_id="s1",
        call=FunctionCall(call="fetchData", args={"query": "test"}),
        options=CallOptions(function_call_id="call-123"),
    )

    assert len(sent_msgs) == 1
    assert sent_msgs[0]["callAgentFunction"]["functionCallId"] == "call-123"

    handler.handle_agent_function_response({
        "agentFunctionResponse": {
            "functionCallId": "call-123",
            "value": {"status": "ok"},
        }
    })

    result = await fut
    assert result == {"status": "ok"}


@pytest.mark.asyncio
async def test_rpc_handler_outbound_timeout() -> None:
    cat = Catalog("basic", protocol_version="v1.0")
    handler = RpcHandler(
        [cat], outbound_listener=lambda msg: None, default_timeout_ms=50.0
    )

    fut = handler.call_agent_function(
        surface_id="s1",
        call=FunctionCall(call="slowCall"),
        options=CallOptions(function_call_id="call-timeout"),
    )

    with pytest.raises(A2uiRpcError) as exc_info:
        await fut

    assert exc_info.value.code == RpcErrorCode.TIMEOUT.value


def test_rpc_handler_caller_permissions() -> None:
    func_renderer = FunctionImplementation(
        name="rendererFn",
        execute=lambda args, *_: "ok",
        allowed_callers="rendererOnly",
    )
    func_agent = FunctionImplementation(
        name="agentFn",
        execute=lambda args, *_: "ok",
        allowed_callers="agentOnly",
    )
    cat = Catalog(
        "basic",
        protocol_version="v1.0",
        functions=[func_renderer, func_agent],
    )
    handler = RpcHandler([cat])

    resp_ren = handler.handle_call_renderer_function(
        CallRendererFunctionMessage(
            version="v1.0",
            call_renderer_function=CallRendererFunction(
                function_call_id="call-ren",
                call_function=FunctionCall(call="rendererFn", catalog_id="basic"),
            ),
        )
    )
    assert (
        resp_ren["rendererFunctionResponse"]["error"]["code"] == "INVALID_FUNCTION_CALL"
    )
    assert (
        "cannot be called by agent"
        in resp_ren["rendererFunctionResponse"]["error"]["message"]
    )

    resp_agent = handler.handle_call_renderer_function(
        CallRendererFunctionMessage(
            version="v1.0",
            call_renderer_function=CallRendererFunction(
                function_call_id="call-ag",
                call_function=FunctionCall(call="agentFn", catalog_id="basic"),
            ),
        )
    )
    assert resp_agent["rendererFunctionResponse"]["value"] == "ok"


def test_rpc_handler_user_activation() -> None:
    func_active = FunctionImplementation(
        name="activeFn",
        execute=lambda args, *_: "done",
        allowed_callers="agentOnly",
        requires_user_activation=True,
    )
    cat = Catalog("basic", protocol_version="v1.0", functions=[func_active])
    handler = RpcHandler([cat])

    resp_denied = handler.handle_call_renderer_function(
        CallRendererFunctionMessage(
            version="v1.0",
            call_renderer_function=CallRendererFunction(
                function_call_id="call-act-1",
                call_function=FunctionCall(call="activeFn", catalog_id="basic"),
            ),
        ),
        is_user_activated=False,
    )
    assert (
        resp_denied["rendererFunctionResponse"]["error"]["code"]
        == "INVALID_FUNCTION_CALL"
    )

    resp_allowed = handler.handle_call_renderer_function(
        CallRendererFunctionMessage(
            version="v1.0",
            call_renderer_function=CallRendererFunction(
                function_call_id="call-act-2",
                call_function=FunctionCall(call="activeFn", catalog_id="basic"),
            ),
        ),
        is_user_activated=True,
    )
    assert resp_allowed["rendererFunctionResponse"]["value"] == "done"


def test_rpc_handler_non_callable_function() -> None:
    func_bad = FunctionApi(
        name="badFn",
        allowed_callers="agentOnly",
    )
    cat = Catalog("basic", protocol_version="v1.0", functions=[func_bad])
    handler = RpcHandler([cat])

    resp = handler.handle_call_renderer_function(
        CallRendererFunctionMessage(
            version="v1.0",
            call_renderer_function=CallRendererFunction(
                function_call_id="call-bad",
                call_function=FunctionCall(call="badFn", catalog_id="basic"),
            ),
        )
    )
    assert resp["rendererFunctionResponse"]["error"]["code"] == "EXECUTION_ERROR"


@pytest.mark.asyncio
async def test_rpc_handler_future_cancellation_cleanup() -> None:
    cat = Catalog("basic", protocol_version="v1.0")
    handler = RpcHandler(
        [cat], outbound_listener=lambda msg: None, default_timeout_ms=5000.0
    )

    fut = handler.call_agent_function(
        surface_id="s1",
        call=FunctionCall(call="slowCall"),
        options=CallOptions(function_call_id="call-cancel"),
    )

    assert "call-cancel" in handler._pending_agent_calls
    fut.cancel()

    # Give event loop a tick to process done callbacks
    await asyncio.sleep(0)
    assert "call-cancel" not in handler._pending_agent_calls


def test_rpc_handler_duplicate_call_id_rejection() -> None:
    cat = Catalog("basic", protocol_version="v1.0")
    handler = RpcHandler(
        [cat], outbound_listener=lambda msg: None, default_timeout_ms=5000.0
    )

    handler.call_agent_function(
        surface_id="s1",
        call=FunctionCall(call="func1"),
        options=CallOptions(function_call_id="dup-call-1"),
    )

    with pytest.raises(A2uiRpcError) as exc_info:
        handler.call_agent_function(
            surface_id="s1",
            call=FunctionCall(call="func2"),
            options=CallOptions(function_call_id="dup-call-1"),
        )
    assert exc_info.value.code == RpcErrorCode.DUPLICATE.value


def test_rpc_handler_missing_outbound_listener() -> None:
    cat = Catalog("basic", protocol_version="v1.0")
    handler = RpcHandler([cat])

    with pytest.raises(A2uiRpcError) as exc_info:
        handler.call_agent_function(
            surface_id="s1",
            call=FunctionCall(call="noListenerFunc"),
        )
    assert exc_info.value.code == RpcErrorCode.NO_LISTENER.value


def test_rpc_handler_disposed_call_prevention() -> None:
    cat = Catalog("basic", protocol_version="v1.0")
    handler = RpcHandler([cat], outbound_listener=lambda msg: None)
    handler.dispose()

    with pytest.raises(A2uiRpcError) as exc_info:
        handler.call_agent_function(
            surface_id="s1",
            call=FunctionCall(call="disposedFunc"),
        )
    assert exc_info.value.code == RpcErrorCode.DISPOSED.value


def test_rpc_handler_incompatible_catalog_version() -> None:
    cat = Catalog("basic", protocol_version="v0.8")
    handler = RpcHandler([cat])

    resp = handler.handle_call_renderer_function(
        CallRendererFunctionMessage(
            version="v1.0",
            call_renderer_function=CallRendererFunction(
                function_call_id="call-incompatible",
                call_function=FunctionCall(call="someFunc", catalog_id="basic"),
            ),
        )
    )
    assert (
        resp["rendererFunctionResponse"]["error"]["code"]
        == RpcErrorCode.INVALID_FUNCTION_CALL.value
    )
    assert "does not match" in resp["rendererFunctionResponse"]["error"]["message"]


@pytest.mark.asyncio
async def test_rpc_handler_async_function_execution() -> None:
    async def async_fn(args: dict[str, Any], context: DataContext | None = None) -> str:
        await asyncio.sleep(0.01)
        return f"Async result: {args.get('val')}"

    func_impl = FunctionImplementation(
        name="asyncFunc",
        execute=async_fn,
        allowed_callers="agentOnly",
    )
    cat = Catalog("basic", protocol_version="v1.0", functions=[func_impl])
    handler = RpcHandler([cat])

    resp = await handler.handle_call_renderer_function_async(
        CallRendererFunctionMessage(
            version="v1.0",
            call_renderer_function=CallRendererFunction(
                function_call_id="call-async-1",
                call_function=FunctionCall(
                    call="asyncFunc", catalog_id="basic", args={"val": "test"}
                ),
            ),
        )
    )
    assert resp["rendererFunctionResponse"]["value"] == "Async result: test"


@pytest.mark.asyncio
async def test_rpc_handler_async_function_exception_handling() -> None:
    async def throwing_async_fn(
        args: dict[str, Any], context: DataContext | None = None
    ) -> str:
        raise ValueError("Async execution failure")

    func_impl = FunctionImplementation(
        name="throwingAsyncFunc",
        execute=throwing_async_fn,
        allowed_callers="agentOnly",
    )
    cat = Catalog("basic", protocol_version="v1.0", functions=[func_impl])
    handler = RpcHandler([cat])

    resp = await handler.handle_call_renderer_function_async(
        CallRendererFunctionMessage(
            version="v1.0",
            call_renderer_function=CallRendererFunction(
                function_call_id="call-async-err",
                call_function=FunctionCall(
                    call="throwingAsyncFunc", catalog_id="basic"
                ),
            ),
        )
    )
    assert (
        resp["rendererFunctionResponse"]["error"]["code"]
        == RpcErrorCode.EXECUTION_ERROR.value
    )
    assert (
        "Async execution failure"
        in resp["rendererFunctionResponse"]["error"]["message"]
    )


@pytest.mark.asyncio
async def test_rpc_handler_async_outbound_listener_error() -> None:
    async def bad_listener(msg: dict[str, Any]) -> None:
        raise RuntimeError("Transport failed")

    cat = Catalog("basic", protocol_version="v1.0")
    handler = RpcHandler([cat], outbound_listener=bad_listener)

    fut = handler.call_agent_function(
        surface_id="s1",
        call=FunctionCall(call="testCall"),
        options=CallOptions(function_call_id="call-listener-err"),
    )

    with pytest.raises(RuntimeError) as exc_info:
        await fut
    assert "Transport failed" in str(exc_info.value)


def test_rpc_handler_handle_agent_function_response_pydantic_model() -> None:
    from a2ui.core.schema.v1_0 import AgentFunctionResponse, AgentFunctionResponseMessage

    cat = Catalog("basic", protocol_version="v1.0")
    handler = RpcHandler([cat], outbound_listener=lambda msg: None)

    fut = handler.call_agent_function(
        surface_id="s1",
        call=FunctionCall(call="fetchData"),
        options=CallOptions(function_call_id="call-pydantic-1"),
    )

    model_resp = AgentFunctionResponseMessage(
        version="v1.0",
        agentFunctionResponse=AgentFunctionResponse(
            functionCallId="call-pydantic-1",
            value={"data": "pydantic_success"},
        ),
    )

    handler.handle_agent_function_response(model_resp)
    assert fut.done()
    assert fut.result() == {"data": "pydantic_success"}


def test_rpc_handler_unknown_function_error_code() -> None:
    cat = Catalog("basic", protocol_version="v1.0", functions=[])
    handler = RpcHandler([cat])

    resp = handler.handle_call_renderer_function(
        CallRendererFunctionMessage(
            version="v1.0",
            call_renderer_function=CallRendererFunction(
                function_call_id="call-missing",
                call_function=FunctionCall(call="nonExistentFunc", catalog_id="basic"),
            ),
        )
    )
    assert (
        resp["rendererFunctionResponse"]["error"]["code"]
        == RpcErrorCode.INVALID_FUNCTION_CALL.value
    )
    assert "Function not found" in resp["rendererFunctionResponse"]["error"]["message"]
