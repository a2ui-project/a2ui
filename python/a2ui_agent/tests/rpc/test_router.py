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

"""Tests for RendererMessageRouter."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from a2ui.core import A2uiValidationError
from a2ui.core.catalog import AgentFunction, AgentFunctionContext, Catalog
from a2ui.core.schema.v1_0 import (
    AgentFunctionResponseMessage,
    CallAgentFunctionMessage,
    RendererFunctionResponseMessage,
)
from a2ui.rpc import AgentFunctionRegistry, RendererFunctionCalls, RendererMessageRouter

CATALOG = "https://example.com/fin/v1/catalog.json"


def _double(args: dict[str, Any], context: AgentFunctionContext) -> Any:
    return args["n"] * 2


def _registry() -> AgentFunctionRegistry:
    schema = {
        "type": "object",
        "properties": {"n": {"type": "number"}},
        "required": ["n"],
    }
    return AgentFunctionRegistry([
        Catalog(
            CATALOG,
            "1.0",
            agent_functions=[AgentFunction("double", handler=_double, schema=schema)],
        )
    ])


CALL: dict[str, Any] = {
    "version": "1.0",
    "callAgentFunction": {
        "surfaceId": "s1",
        "functionCallId": "c1",
        "callFunction": {"@call": "double", "catalogId": CATALOG, "args": {"n": 21}},
    },
}

ACTION: dict[str, Any] = {
    "version": "1.0",
    "action": {
        "name": "submit",
        "surfaceId": "s1",
        "sourceComponentId": "b1",
        "timestamp": "2026-01-01T00:00:00Z",
        "context": {},
    },
}


@pytest.mark.asyncio
@pytest.mark.parametrize("as_model", [False, True])
async def test_call_agent_function_returns_the_response(as_model: bool) -> None:
    router = RendererMessageRouter(agent_functions=_registry())
    message: Any = CallAgentFunctionMessage.model_validate(CALL) if as_model else CALL

    assert router.handles(message)
    replies = await router.dispatch(message)

    assert len(replies) == 1
    assert isinstance(replies[0], AgentFunctionResponseMessage)
    assert replies[0].model_dump(by_alias=True, exclude_unset=True) == {
        "version": "1.0",
        "agentFunctionResponse": {"functionCallId": "c1", "value": 42},
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("as_model", [False, True])
async def test_renderer_function_response_settles_the_call(as_model: bool) -> None:
    calls = RendererFunctionCalls()
    router = RendererMessageRouter(renderer_calls=calls)
    _, future = calls.call(catalog_id=CATALOG, name="now", function_call_id="r1")
    response = {
        "version": "1.0",
        "rendererFunctionResponse": {"functionCallId": "r1", "value": "12:00"},
    }
    message: Any = (
        RendererFunctionResponseMessage.model_validate(response)
        if as_model
        else response
    )

    assert router.handles(message)
    assert await router.dispatch(message) == []
    assert await asyncio.wait_for(future, timeout=5) == "12:00"


@pytest.mark.asyncio
async def test_does_not_handle_other_messages() -> None:
    router = RendererMessageRouter(
        agent_functions=_registry(), renderer_calls=RendererFunctionCalls()
    )

    assert not router.handles(ACTION)
    with pytest.raises(A2uiValidationError, match="'action'"):
        await router.dispatch(ACTION)
    assert not router.handles({"version": "1.0"})
    assert not router.handles({"callAgentFunction": {}, "action": {}})


@pytest.mark.asyncio
async def test_does_not_handle_messages_without_their_helper() -> None:
    router = RendererMessageRouter()
    response = {
        "version": "1.0",
        "rendererFunctionResponse": {"functionCallId": "r1", "value": 1},
    }

    assert not router.handles(CALL)
    assert not router.handles(response)
    with pytest.raises(A2uiValidationError):
        await router.dispatch(CALL)
    with pytest.raises(A2uiValidationError):
        await router.dispatch(response)
