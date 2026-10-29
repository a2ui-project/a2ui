# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Fallback routing of unimplemented functions to the agent (v1.0)."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from pydantic import BaseModel, ConfigDict

from a2ui.core import (
    AgentFunctionCall,
    Catalog,
    DataContext,
    MessageProcessor,
    MessageProcessorOptions,
    SurfaceModel,
)
from a2ui.core.catalog import FunctionApi, FunctionImplementation
from a2ui.core.schema.v1_0 import DynamicString

FIN_CATALOG_ID = "https://example.com/fin/v1/catalog.json"


class _UpperArgs(BaseModel):
    value: DynamicString


class _QuoteArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: DynamicString
    currency: DynamicString = "USD"


class _ConfirmArgs(BaseModel):
    order_id: DynamicString


def _upper() -> FunctionImplementation[Any]:
    return FunctionImplementation(
        name="upper",
        return_type="string",
        schema=_UpperArgs,
        execute=lambda args, ctx, abort=None: str(args["value"]).upper(),
    )


def _quote() -> FunctionApi:
    """Declared in the catalog, but implemented on the agent (schema-only)."""
    return FunctionApi(name="quote", return_type="number", schema=_QuoteArgs)


def _confirm() -> FunctionApi:
    """A schema-only function that needs a user gesture."""
    return FunctionApi(
        name="confirmOrder",
        return_type="boolean",
        schema=_ConfirmArgs,
        requires_user_activation=True,
    )


async def _flush() -> None:
    """Lets the event loop run the callbacks of settled futures."""
    for _ in range(3):
        await asyncio.sleep(0)


class _Harness:
    """A v1.0 surface on a processor that records outbound messages."""

    def __init__(
        self,
        *,
        outbound_listener: bool = True,
        default_timeout_ms: float = 30000.0,
        version: str = "1.0",
    ) -> None:
        self.outbound: list[dict[str, Any]] = []
        self.errors: list[dict[str, Any]] = []
        catalog = Catalog(FIN_CATALOG_ID, version, [], [_upper(), _quote(), _confirm()])
        self.proc = MessageProcessor(
            [catalog],
            options=MessageProcessorOptions(
                outbound_listener=(self.outbound.append if outbound_listener else None),
                default_timeout_ms=default_timeout_ms,
            ),
        )
        wire_version = "v0.9" if version.startswith("0.9") else version
        self.proc.process_messages([{
            "version": wire_version,
            "createSurface": {"surfaceId": "s1", "catalogId": FIN_CATALOG_ID},
        }])
        surface = self.proc.model.get_surface("s1")
        assert surface is not None
        self.surface: SurfaceModel = surface
        self.surface.on_error.subscribe(self.errors.append)
        self.ctx = DataContext(self.surface, "/")

    def respond(self, index: int, **response: Any) -> None:
        """Answers the outbound `callAgentFunction` at `index`."""
        call_id = self.outbound[index]["callAgentFunction"]["functionCallId"]
        self.proc.process_messages([{
            "version": "1.0",
            "agentFunctionResponse": {"functionCallId": call_id, **response},
        }])


@pytest.mark.asyncio
async def test_sends_undeclared_function_with_resolved_catalog_id() -> None:
    h = _Harness()
    result = h.ctx.resolve_dynamic_value(
        {"@call": "fetchFxRate", "args": {"base": "EUR"}}, peek=False
    )

    assert len(h.outbound) == 1
    assert h.outbound[0]["callAgentFunction"]["callFunction"] == {
        "@call": "fetchFxRate",
        "catalogId": FIN_CATALOG_ID,
        "args": {"base": "EUR"},
    }
    assert h.outbound[0]["callAgentFunction"]["surfaceId"] == "s1"
    assert result.peek() is None, "the value is pending until the agent answers"

    h.respond(0, value=1.08)
    await _flush()
    assert result.peek() == 1.08
    assert h.errors == []


@pytest.mark.asyncio
async def test_peeked_value_is_none_while_pending() -> None:
    h = _Harness()
    assert (
        h.ctx.resolve_dynamic_value({"@call": "fetchFxRate", "args": {"base": "EUR"}})
        is None
    )
    assert len(h.outbound) == 1


@pytest.mark.asyncio
async def test_binding_subscription_receives_agent_result() -> None:
    h = _Harness()
    changes: list[Any] = []
    sub = h.ctx.subscribe_dynamic_value(
        {"@call": "fetchFxRate", "args": {"base": "EUR"}}, changes.append
    )
    assert sub.value is None

    h.respond(0, value=1.08)
    await _flush()
    assert changes == [1.08]
    sub.unsubscribe()


@pytest.mark.asyncio
async def test_settles_bound_arguments_before_sending() -> None:
    h = _Harness()
    h.surface.data_model.set("/base", "EUR")
    h.ctx.resolve_dynamic_value(
        {"@call": "fetchFxRate", "args": {"base": {"@path": "/base"}}}
    )
    assert h.outbound[0]["callAgentFunction"]["callFunction"]["args"] == {"base": "EUR"}


@pytest.mark.asyncio
async def test_feeds_agent_result_into_local_function() -> None:
    h = _Harness()
    result = h.ctx.resolve_dynamic_value(
        {
            "@call": "upper",
            "args": {"value": {"@call": "fetchGreeting", "args": {}}},
        },
        peek=False,
    )
    assert len(h.outbound) == 1
    assert result.peek() is None

    h.respond(0, value="hello")
    await _flush()
    assert result.peek() == "HELLO"
    assert h.errors == []


@pytest.mark.asyncio
async def test_feeds_agent_result_into_agent_function() -> None:
    h = _Harness()
    result = h.ctx.resolve_dynamic_value(
        {
            "@call": "convert",
            "args": {"rate": {"@call": "fetchFxRate", "args": {"base": "EUR"}}},
        },
        peek=False,
    )
    assert len(h.outbound) == 1, "the outer call waits for its argument"

    h.respond(0, value=1.08)
    await _flush()
    assert len(h.outbound) == 2
    assert h.outbound[1]["callAgentFunction"]["callFunction"]["args"] == {"rate": 1.08}

    h.respond(1, value=108)
    await _flush()
    assert result.peek() == 108


@pytest.mark.asyncio
async def test_failed_argument_does_not_run_outer_call() -> None:
    h = _Harness()
    result = h.ctx.resolve_dynamic_value(
        {
            "@call": "upper",
            "args": {"value": {"@call": "fetchGreeting", "args": {}}},
        },
        peek=False,
    )
    h.respond(0, error={"code": "UNKNOWN_FUNCTION", "message": "nope"})
    await _flush()
    assert result.peek() is None
    assert len(h.errors) == 1
    assert h.errors[0]["expression"] == "fetchGreeting"


@pytest.mark.asyncio
async def test_validates_and_parses_schema_only_function_arguments() -> None:
    h = _Harness()
    h.ctx.resolve_dynamic_value({"@call": "quote", "args": {"symbol": 42}})
    assert h.outbound == []
    assert len(h.errors) == 1
    assert h.errors[0]["code"] == "EXPRESSION_ERROR"
    assert "Validation failed for function 'quote'" in h.errors[0]["message"]

    result = h.ctx.resolve_dynamic_value(
        {"@call": "quote", "args": {"symbol": "GOOG"}}, peek=False
    )
    assert len(h.outbound) == 1
    assert h.outbound[0]["callAgentFunction"]["callFunction"]["args"] == {
        "symbol": "GOOG",
        "currency": "USD",
    }, "the parsed arguments are sent, with schema defaults applied"
    h.respond(0, value=180)
    await _flush()
    assert result.peek() == 180


@pytest.mark.asyncio
async def test_schema_only_function_requiring_user_activation() -> None:
    h = _Harness()
    h.ctx.resolve_dynamic_value({"@call": "confirmOrder", "args": {"order_id": "o-1"}})
    assert h.outbound == []
    assert len(h.errors) == 1
    assert h.errors[0]["code"] == "EXPRESSION_ERROR"
    assert "requires user activation" in h.errors[0]["message"]

    h.ctx.resolve_action(
        {"functionCall": {"@call": "confirmOrder", "args": {"order_id": "o-1"}}}
    )
    assert len(h.outbound) == 1
    assert h.ctx.is_user_activated is False


def test_runs_implemented_function_locally() -> None:
    h = _Harness()
    assert (
        h.ctx.resolve_dynamic_value({"@call": "upper", "args": {"value": "abc"}})
        == "ABC"
    )
    assert h.outbound == []


@pytest.mark.asyncio
async def test_reports_agent_error_as_expression_error() -> None:
    h = _Harness()
    result = h.ctx.resolve_dynamic_value(
        {"@call": "fetchFxRate", "args": {"base": "EUR"}}, peek=False
    )
    h.respond(
        0,
        error={"code": "UNKNOWN_FUNCTION", "message": "No such function: fetchFxRate"},
    )
    await _flush()
    assert result.peek() is None
    assert len(h.errors) == 1
    assert h.errors[0]["code"] == "EXPRESSION_ERROR"
    assert "No such function: fetchFxRate" in h.errors[0]["message"]


@pytest.mark.asyncio
async def test_reports_timeout_as_expression_error() -> None:
    h = _Harness(default_timeout_ms=5)
    result = h.ctx.resolve_dynamic_value(
        {"@call": "fetchFxRate", "args": {"base": "EUR"}}, peek=False
    )
    await asyncio.sleep(0.05)
    await _flush()
    assert result.peek() is None
    assert len(h.errors) == 1
    assert h.errors[0]["code"] == "EXPRESSION_ERROR"
    assert "timed out" in h.errors[0]["message"]


@pytest.mark.asyncio
async def test_identical_calls_awaiting_response_share_one_request() -> None:
    h = _Harness()
    call = {"@call": "fetchFxRate", "args": {"base": "EUR"}}
    first = h.ctx.resolve_dynamic_value(call, peek=False)
    second = h.ctx.resolve_dynamic_value(call, peek=False)
    assert len(h.outbound) == 1

    h.respond(0, value=1.08)
    await _flush()
    assert (first.peek(), second.peek()) == (1.08, 1.08)

    # Once answered, the same call is sent again.
    h.ctx.resolve_dynamic_value(call)
    assert len(h.outbound) == 2


@pytest.mark.asyncio
async def test_different_arguments_send_separate_requests() -> None:
    h = _Harness()
    h.ctx.resolve_dynamic_value({"@call": "fetchFxRate", "args": {"base": "EUR"}})
    h.ctx.resolve_dynamic_value({"@call": "fetchFxRate", "args": {"base": "USD"}})
    assert len(h.outbound) == 2


@pytest.mark.asyncio
async def test_sends_action_function_call_to_agent() -> None:
    h = _Harness()
    h.ctx.resolve_action(
        {"functionCall": {"@call": "submitOrder", "args": {"id": "o-1"}}}
    )
    assert len(h.outbound) == 1
    assert h.outbound[0]["callAgentFunction"]["callFunction"]["@call"] == "submitOrder"


@pytest.mark.asyncio
async def test_aborted_evaluation_ignores_response() -> None:
    h = _Harness()
    h.surface.data_model.set("/base", "EUR")
    changes: list[Any] = []
    sub = h.ctx.subscribe_dynamic_value(
        {"@call": "fetchFxRate", "args": {"base": {"@path": "/base"}}},
        changes.append,
    )
    # Re-evaluating the binding aborts the first evaluation.
    h.surface.data_model.set("/base", "USD")
    assert len(h.outbound) == 2

    h.respond(0, value=1.08)
    await _flush()
    assert changes == [None], "the stale response is ignored"

    h.respond(1, value=1.0)
    await _flush()
    assert changes == [None, 1.0]
    sub.unsubscribe()


@pytest.mark.asyncio
async def test_unavailable_catalog_is_catalog_error() -> None:
    h = _Harness()
    h.ctx.resolve_dynamic_value({
        "@call": "fetchFxRate",
        "catalogId": "https://example.com/unknown.json",
        "args": {},
    })
    assert h.outbound == []
    assert len(h.errors) == 1
    assert h.errors[0]["code"] == "CATALOG_ERROR"


@pytest.mark.asyncio
async def test_system_functions_are_never_routed() -> None:
    h = _Harness()
    h.ctx.resolve_dynamic_value({"@call": "@unknownSystemFunction", "args": {}})
    assert h.outbound == []
    assert len(h.errors) == 1
    assert h.errors[0]["code"] == "EXPRESSION_ERROR"


def test_keeps_failing_locally_without_outbound_listener() -> None:
    h = _Harness(outbound_listener=False)
    assert h.surface.agent_function_caller is None
    assert (
        h.ctx.resolve_dynamic_value({"@call": "fetchFxRate", "args": {"base": "EUR"}})
        is None
    )
    assert len(h.errors) == 1
    assert h.errors[0]["code"] == "EXPRESSION_ERROR"
    assert "Unrecognized function 'fetchFxRate'" in h.errors[0]["message"]


def test_does_not_route_calls_on_pre_1_0_surface() -> None:
    h = _Harness(version="0.9")
    assert h.surface.agent_function_caller is None
    h.ctx.resolve_dynamic_value({"call": "fetchFxRate", "args": {}})
    assert h.outbound == []
    assert len(h.errors) == 1
    assert h.errors[0]["code"] == "EXPRESSION_ERROR"


@pytest.mark.asyncio
async def test_surface_call_agent_function_without_caller_raises() -> None:
    surface = SurfaceModel("s1", None, protocol_version="1.0")
    with pytest.raises(Exception, match="cannot call the agent"):
        surface.call_agent_function(
            AgentFunctionCall(call="f", catalog_id=FIN_CATALOG_ID, args={})
        )


@pytest.mark.asyncio
async def test_surface_call_agent_function_shares_in_flight_calls() -> None:
    surface = SurfaceModel("s1", None, protocol_version="1.0")
    calls: list[AgentFunctionCall] = []
    loop = asyncio.get_running_loop()
    futures: list[asyncio.Future[Any]] = []

    def caller(call: AgentFunctionCall) -> asyncio.Future[Any]:
        calls.append(call)
        fut: asyncio.Future[Any] = loop.create_future()
        futures.append(fut)
        return fut

    surface.agent_function_caller = caller
    call = AgentFunctionCall(call="f", catalog_id=FIN_CATALOG_ID, args={"a": 1})
    first = surface.call_agent_function(call)
    second = surface.call_agent_function(
        AgentFunctionCall(call="f", catalog_id=FIN_CATALOG_ID, args={"a": 1})
    )
    assert first is second
    assert len(calls) == 1

    futures[0].set_result(2)
    assert await first == 2
    await _flush()
    surface.call_agent_function(call)
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_applies_json_schema_defaults_of_schema_only_function() -> None:
    outbound: list[dict[str, Any]] = []
    quote_json = FunctionApi(
        name="quote",
        return_type="number",
        schema={
            "type": "object",
            "properties": {
                "symbol": {"type": "string"},
                "currency": {"type": "string", "default": "USD"},
            },
            "required": ["symbol"],
            "additionalProperties": False,
        },
    )
    proc = MessageProcessor(
        [Catalog(FIN_CATALOG_ID, "1.0", [], [quote_json])],
        options=MessageProcessorOptions(outbound_listener=outbound.append),
    )
    proc.process_messages([{
        "version": "1.0",
        "createSurface": {"surfaceId": "s1", "catalogId": FIN_CATALOG_ID},
    }])
    surface = proc.model.get_surface("s1")
    assert surface is not None
    DataContext(surface, "/").resolve_dynamic_value(
        {"@call": "quote", "args": {"symbol": "GOOG"}}
    )
    assert outbound[0]["callAgentFunction"]["callFunction"]["args"] == {
        "symbol": "GOOG",
        "currency": "USD",
    }
