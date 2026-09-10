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
