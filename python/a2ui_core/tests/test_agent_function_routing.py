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
import enum
import inspect
import threading
from typing import Any

import pytest
from pydantic import BaseModel, ConfigDict

from a2ui.core import (
    A2uiExpressionError,
    A2uiRpcError,
    AgentFunctionCall,
    Catalog,
    DataContext,
    MessageProcessor,
    MessageProcessorOptions,
    SurfaceModel,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.catalog import FunctionApi, FunctionImplementation
from a2ui.core.common import Signal
from a2ui.core.resolution import ComponentContext, GenericBinder
from a2ui.core.schema.v1_0 import DynamicString
from a2ui.core.state import ComponentModel

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


def _agent_only() -> FunctionApi:
    """A schema-only function restricted to agent-initiated calls."""
    return FunctionApi(
        name="lookupAccount",
        return_type="string",
        schema=_UpperArgs,
        allowed_callers="agentOnly",
    )


class _ProbeArgs(BaseModel):
    value: Any = None


def _probe(seen: list[tuple[bool, bool]]) -> FunctionImplementation[Any]:
    """A local function that records the evaluation flags it runs with."""

    def _execute(args: Any, ctx: Any, abort: Any = None) -> Any:
        seen.append((ctx.is_user_activated, ctx._in_action_execution))
        return args.get("value")

    return FunctionImplementation(
        name="probe", return_type="any", schema=_ProbeArgs, execute=_execute
    )


def _tap_only() -> FunctionImplementation[Any]:
    """A local function that needs a user gesture."""
    return FunctionImplementation(
        name="tapOnly",
        return_type="string",
        schema=_ProbeArgs,
        requires_user_activation=True,
        execute=lambda args, ctx, abort=None: "tapped",
    )


def _streaming(stream: Signal[Any]) -> FunctionImplementation[Any]:
    """A local function that returns a signal that keeps emitting."""
    return FunctionImplementation(
        name="streaming",
        return_type="any",
        schema=_ProbeArgs,
        execute=lambda args, ctx, abort=None: stream,
    )


def _read(
    ctx: DataContext,
    value: Any,
    peek: bool = True,
    abort_signal: Any = None,
) -> Any:
    """Resolves `value` the way a caller that can wait for an agent does.

    A one-shot peeked read can't wait for an agent function's answer, so it
    is never routed. This reads through a pending signal instead and, when
    `peek` is True, returns its current value.
    """
    result = ctx.resolve_dynamic_value(value, peek=False, abort_signal=abort_signal)
    if peek and isinstance(result, Signal):
        return result.peek()
    return result


async def _flush() -> None:
    """Lets the event loop run the callbacks of settled futures."""
    for _ in range(5):
        await asyncio.sleep(0)


class _Harness:
    """A v1.0 surface on a processor that records outbound messages."""

    def __init__(
        self,
        *,
        outbound_listener: bool = True,
        default_timeout_ms: float = 30000.0,
        version: str = "1.0",
        extra_functions: list[Any] | None = None,
    ) -> None:
        self.outbound: list[dict[str, Any]] = []
        self.errors: list[dict[str, Any]] = []
        catalog = Catalog(
            FIN_CATALOG_ID,
            version,
            [],
            [_upper(), _quote(), _confirm(), _agent_only(), *(extra_functions or [])],
        )
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
    result = _read(h.ctx, {"@call": "fetchFxRate", "args": {"base": "EUR"}}, peek=False)

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
    assert _read(h.ctx, {"@call": "fetchFxRate", "args": {"base": "EUR"}}) is None
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
    _read(h.ctx, {"@call": "fetchFxRate", "args": {"base": {"@path": "/base"}}})
    assert h.outbound[0]["callAgentFunction"]["callFunction"]["args"] == {"base": "EUR"}


@pytest.mark.asyncio
async def test_feeds_agent_result_into_local_function() -> None:
    h = _Harness()
    result = _read(
        h.ctx,
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
    result = _read(
        h.ctx,
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
    result = _read(
        h.ctx,
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
    _read(h.ctx, {"@call": "quote", "args": {"symbol": 42}})
    assert h.outbound == []
    assert len(h.errors) == 1
    assert h.errors[0]["code"] == "EXPRESSION_ERROR"
    assert "Validation failed for function 'quote'" in h.errors[0]["message"]

    result = _read(h.ctx, {"@call": "quote", "args": {"symbol": "GOOG"}}, peek=False)
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
    _read(h.ctx, {"@call": "confirmOrder", "args": {"order_id": "o-1"}})
    assert h.outbound == []
    assert len(h.errors) == 1
    assert h.errors[0]["code"] == "EXPRESSION_ERROR"
    assert "requires user activation" in h.errors[0]["message"]

    h.ctx.resolve_action(
        {"functionCall": {"@call": "confirmOrder", "args": {"order_id": "o-1"}}}
    )
    assert len(h.outbound) == 1
    assert h.ctx.is_user_activated is False


def test_agent_only_function_is_not_routed() -> None:
    h = _Harness()
    assert _read(h.ctx, {"@call": "lookupAccount", "args": {"value": "a"}}) is None
    h.ctx.resolve_action(
        {"functionCall": {"@call": "lookupAccount", "args": {"value": "a"}}}
    )
    assert h.outbound == [], "an agentOnly function is never sent to the agent"
    assert [e["code"] for e in h.errors] == ["EXPRESSION_ERROR", "EXPRESSION_ERROR"]
    assert all(
        "cannot be called by renderer (allowedCallers is agentOnly)" in e["message"]
        for e in h.errors
    )


def test_runs_implemented_function_locally() -> None:
    h = _Harness()
    assert _read(h.ctx, {"@call": "upper", "args": {"value": "abc"}}) == "ABC"
    assert h.outbound == []


@pytest.mark.asyncio
async def test_reports_agent_error_as_expression_error() -> None:
    h = _Harness()
    result = _read(h.ctx, {"@call": "fetchFxRate", "args": {"base": "EUR"}}, peek=False)
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
    result = _read(h.ctx, {"@call": "fetchFxRate", "args": {"base": "EUR"}}, peek=False)
    await asyncio.sleep(0.05)
    await _flush()
    assert result.peek() is None
    assert len(h.errors) == 1
    assert h.errors[0]["code"] == "EXPRESSION_ERROR"
    assert "timed out" in h.errors[0]["message"]


@pytest.mark.asyncio
async def test_identical_calls_share_request_and_cache_settled_answer() -> None:
    h = _Harness()
    call = {"@call": "fetchFxRate", "args": {"base": "EUR"}}
    first = _read(h.ctx, call, peek=False)
    second = _read(h.ctx, call, peek=False)
    assert len(h.outbound) == 1

    h.respond(0, value=1.08)
    await _flush()
    assert (first.peek(), second.peek()) == (1.08, 1.08)

    # Once answered, reactive bindings reuse the settled answer from the surface cache.
    assert _read(h.ctx, call) == 1.08
    assert len(h.outbound) == 1


@pytest.mark.asyncio
async def test_reactive_binding_flips_back_to_cached_answer_without_rpc() -> None:
    h = _Harness()
    h.surface.data_model.set("/base", "EUR")
    changes: list[Any] = []
    sub = h.ctx.subscribe_dynamic_value(
        {"@call": "fetchFxRate", "args": {"base": {"@path": "/base"}}},
        changes.append,
    )
    assert sub.value is None
    assert len(h.outbound) == 1

    h.respond(0, value=1.08)
    await _flush()
    assert changes == [1.08]

    h.surface.data_model.set("/base", "USD")
    assert len(h.outbound) == 2
    h.respond(1, value=1.0)
    await _flush()
    assert changes == [1.08, None, 1.0]

    # Flipping back to EUR resolves immediately from the surface cache.
    h.surface.data_model.set("/base", "EUR")
    assert len(h.outbound) == 2
    assert changes == [1.08, None, 1.0, 1.08]
    sub.unsubscribe()


@pytest.mark.asyncio
async def test_failed_call_is_evicted_so_retry_sends_new_request() -> None:
    h = _Harness()
    call = {"@call": "fetchFxRate", "args": {"base": "EUR"}}
    first = _read(h.ctx, call, peek=False)
    h.respond(0, error={"code": "UNKNOWN_FUNCTION", "message": "temporary error"})
    await _flush()
    assert first.peek() is None
    assert len(h.errors) == 1

    second = _read(h.ctx, call, peek=False)
    assert len(h.outbound) == 2
    h.respond(1, value=1.08)
    await _flush()
    assert second.peek() == 1.08


@pytest.mark.asyncio
async def test_action_calls_never_share_or_cache() -> None:
    h = _Harness()
    call = {"@call": "fetchFxRate", "args": {"base": "EUR"}}
    # Populate the reactive cache first.
    reactive = _read(h.ctx, call, peek=False)
    h.respond(0, value=1.08)
    await _flush()
    assert reactive.peek() == 1.08

    # Two concurrent action invocations each send a fresh request and ignore the cache.
    h.ctx.resolve_action({"functionCall": call})
    h.ctx.resolve_action({"functionCall": call})
    assert len(h.outbound) == 3


@pytest.mark.asyncio
async def test_event_action_context_waits_for_agent_function_and_bypasses_cache() -> (
    None
):
    h = _Harness()
    dispatched: list[dict[str, Any]] = []
    h.surface.on_action.subscribe(dispatched.append)

    action = {
        "event": {
            "name": "checkout",
            "context": {
                "rate": {"@call": "fetchFxRate", "args": {"base": "EUR"}},
            },
        }
    }
    resolved = h.ctx.resolve_action(action)
    h.surface.dispatch_action(resolved, "btn1")
    assert len(h.outbound) == 1
    assert dispatched == []

    h.respond(0, value=1.08)
    await _flush()
    assert len(dispatched) == 1
    assert dispatched[0]["context"] == {"rate": 1.08}

    # A second event action dispatches a fresh callAgentFunction.
    resolved2 = h.ctx.resolve_action(action)
    h.surface.dispatch_action(resolved2, "btn1")
    assert len(h.outbound) == 2


@pytest.mark.asyncio
async def test_event_action_waiting_for_agent_function_keeps_metadata() -> None:
    h = _Harness()
    dispatched: list[dict[str, Any]] = []
    h.surface.on_action.subscribe(dispatched.append)

    resolved = h.ctx.resolve_action({
        "event": {
            "name": "checkout",
            "context": {"rate": {"@call": "fetchFxRate", "args": {}}},
            "metadata": {"extensions": {"trace": "t-1"}},
        }
    })
    h.surface.dispatch_action(
        resolved, "btn1", metadata={"extensions": {"origin": "tap"}}
    )
    assert dispatched == []

    h.respond(0, value=1.08)
    await _flush()
    assert len(dispatched) == 1
    assert dispatched[0]["context"] == {"rate": 1.08}
    assert dispatched[0]["metadata"] == {
        "extensions": {"trace": "t-1", "origin": "tap"}
    }


@pytest.mark.asyncio
async def test_different_arguments_send_separate_requests() -> None:
    h = _Harness()
    _read(h.ctx, {"@call": "fetchFxRate", "args": {"base": "EUR"}})
    _read(h.ctx, {"@call": "fetchFxRate", "args": {"base": "USD"}})
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
    _read(
        h.ctx,
        {
            "@call": "fetchFxRate",
            "catalogId": "https://example.com/unknown.json",
            "args": {},
        },
    )
    assert h.outbound == []
    assert len(h.errors) == 1
    assert h.errors[0]["code"] == "CATALOG_ERROR"


@pytest.mark.asyncio
async def test_system_functions_are_never_routed() -> None:
    h = _Harness()
    _read(h.ctx, {"@call": "@unknownSystemFunction", "args": {}})
    assert h.outbound == []
    assert len(h.errors) == 1
    assert h.errors[0]["code"] == "EXPRESSION_ERROR"


def test_keeps_failing_locally_without_outbound_listener() -> None:
    h = _Harness(outbound_listener=False)
    assert h.surface.agent_function_caller is None
    assert _read(h.ctx, {"@call": "fetchFxRate", "args": {"base": "EUR"}}) is None
    assert len(h.errors) == 1
    assert h.errors[0]["code"] == "EXPRESSION_ERROR"
    assert "Unrecognized function 'fetchFxRate'" in h.errors[0]["message"]


def test_does_not_route_calls_on_pre_1_0_surface() -> None:
    h = _Harness(version="0.9")
    assert h.surface.agent_function_caller is None
    _read(h.ctx, {"call": "fetchFxRate", "args": {}})
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
    assert len(calls) == 1

    futures[0].set_result(2)
    assert await first == 2
    assert await second == 2
    await _flush()
    # Settled answer is cached for reactive calls, bypassed when bypass_cache=True.
    cached = surface.call_agent_function(call)
    assert await cached == 2
    assert len(calls) == 1
    surface.call_agent_function(call, bypass_cache=True)
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
    _read(DataContext(surface, "/"), {"@call": "quote", "args": {"symbol": "GOOG"}})
    assert outbound[0]["callAgentFunction"]["callFunction"]["args"] == {
        "symbol": "GOOG",
        "currency": "USD",
    }


def test_synchronous_nested_argument_failure_stops_enclosing_calls() -> None:
    h = _Harness()
    res = _read(
        h.ctx,
        {
            "@call": "formatPrice",
            "args": {
                "amount": {"@call": "quote", "args": {"symbol": 123}},
            },
        },
    )
    assert res is None
    assert h.outbound == []
    assert len(h.errors) == 1
    assert h.errors[0]["expression"] == "quote"

    h.errors.clear()
    res_agent = _read(
        h.ctx,
        {
            "@call": "outerAgent",
            "args": {
                "nested": {"@call": "quote", "args": {"symbol": 123}},
            },
        },
    )
    assert res_agent is None
    assert h.outbound == []
    assert len(h.errors) == 1
    assert h.errors[0]["expression"] == "quote"


@pytest.mark.asyncio
async def test_delete_surface_cancels_pending_agent_calls_without_surface_errors() -> (
    None
):
    h = _Harness()
    changes: list[Any] = []
    sub = h.ctx.subscribe_dynamic_value(
        {"@call": "fetchFxRate", "args": {"base": "EUR"}},
        changes.append,
    )
    assert len(h.outbound) == 1
    assert len(h.proc.rpc._pending_agent_calls) == 1

    h.proc.process_messages([{"version": "1.0", "deleteSurface": {"surfaceId": "s1"}}])
    await _flush()

    assert len(h.proc.rpc._pending_agent_calls) == 0
    assert h.errors == []
    sub.unsubscribe()


@pytest.mark.asyncio
async def test_subscribe_dynamic_value_unwraps_and_updates_nested_agent_signals() -> (
    None
):
    h = _Harness()
    changes: list[Any] = []
    sub = h.ctx.subscribe_dynamic_value(
        {
            "rate": {"@call": "fetchFxRate", "args": {"base": "EUR"}},
            "items": [{"@call": "quote", "args": {"symbol": "GOOG"}}],
        },
        changes.append,
    )
    assert sub.value == {"rate": None, "items": [None]}
    assert changes == []
    assert len(h.outbound) == 2

    h.respond(0, value=1.08)
    await _flush()
    assert changes == [{"rate": 1.08, "items": [None]}]

    h.respond(1, value=180.5)
    await _flush()
    assert changes[-1] == {"rate": 1.08, "items": [180.5]}
    sub.unsubscribe()


def _call_name(message: dict[str, Any]) -> str:
    return str(message["callAgentFunction"]["callFunction"]["@call"])


@pytest.mark.asyncio
async def test_deferred_local_action_function_keeps_evaluation_flags() -> None:
    seen: list[tuple[bool, bool]] = []
    h = _Harness(extra_functions=[_probe(seen)])
    h.ctx.resolve_action(
        {
            "functionCall": {
                "@call": "probe",
                "args": {"value": {"@call": "fetchGreeting", "args": {}}},
            }
        },
        is_user_activated=True,
    )
    assert seen == [], "the local function waits for its agent argument"
    assert h.ctx.is_user_activated is False

    h.respond(0, value="hi")
    await _flush()
    assert seen == [(True, True)]


@pytest.mark.asyncio
async def test_event_action_waits_for_each_context_entry_in_order() -> None:
    h = _Harness()
    dispatched: list[dict[str, Any]] = []
    h.surface.on_action.subscribe(dispatched.append)
    resolved = h.ctx.resolve_action({
        "event": {
            "name": "checkout",
            "context": {
                "rate": {"@call": "fetchFxRate", "args": {}},
                "fee": {"@call": "fetchFee", "args": {}},
            },
            "userMessage": {"@call": "fetchMessage", "args": {}},
        }
    })
    h.surface.dispatch_action(resolved, "btn1")
    assert [_call_name(m) for m in h.outbound] == ["fetchFxRate"]

    h.respond(0, value=1.08)
    await _flush()
    assert [_call_name(m) for m in h.outbound] == ["fetchFxRate", "fetchFee"]
    h.respond(1, value=2)
    await _flush()
    assert [_call_name(m) for m in h.outbound][-1] == "fetchMessage"
    h.respond(2, value="Paying")
    await _flush()
    assert len(dispatched) == 1
    assert dispatched[0]["context"] == {"rate": 1.08, "fee": 2}
    assert dispatched[0]["userMessage"] == "Paying"
    assert h.errors == []


@pytest.mark.asyncio
async def test_event_action_stops_at_first_failed_entry() -> None:
    h = _Harness()
    dispatched: list[dict[str, Any]] = []
    h.surface.on_action.subscribe(dispatched.append)
    resolved = h.ctx.resolve_action({
        "event": {
            "name": "checkout",
            "context": {
                "rate": {"@call": "fetchFxRate", "args": {}},
                "fee": {"@call": "fetchFee", "args": {}},
            },
            "userMessage": {"@call": "fetchMessage", "args": {}},
        }
    })
    h.surface.dispatch_action(resolved, "btn1")
    h.respond(0, error={"code": "UNKNOWN_FUNCTION", "message": "down"})
    await _flush()

    assert [_call_name(m) for m in h.outbound] == ["fetchFxRate"]
    assert dispatched == []
    assert [e["expression"] for e in h.errors] == ["fetchFxRate"]


def test_event_action_with_synchronous_failure_sends_nothing() -> None:
    h = _Harness()
    resolved = h.ctx.resolve_action({
        "event": {
            "name": "checkout",
            "context": {
                "quote": {"@call": "quote", "args": {"symbol": 42}},
                "rate": {"@call": "fetchFxRate", "args": {}},
            },
        }
    })
    assert resolved is None, "no failed placeholder is returned"
    assert h.outbound == []
    assert [e["expression"] for e in h.errors] == ["quote"]


@pytest.mark.asyncio
async def test_event_action_honors_user_activation() -> None:
    h = _Harness(extra_functions=[_tap_only()])
    action = {
        "event": {
            "name": "confirm",
            "context": {
                "tap": {"@call": "tapOnly", "args": {}},
                "ok": {"@call": "confirmOrder", "args": {"order_id": "o-1"}},
            },
        }
    }
    assert h.ctx.resolve_action(action, is_user_activated=False) is None
    assert h.outbound == []
    assert ["requires user activation" in e["message"] for e in h.errors] == [True]

    h.errors.clear()
    resolved = h.ctx.resolve_action(action, is_user_activated=True)
    assert resolved["event"]["context"]["tap"] == "tapped"
    assert [_call_name(m) for m in h.outbound] == ["confirmOrder"]
    assert h.errors == []


@pytest.mark.asyncio
async def test_call_keys_are_canonical() -> None:
    h = _Harness()
    _read(
        h.ctx,
        {
            "@call": "fetchFxRate",
            "args": {"pair": {"base": "EUR", "quote": "USD"}, "days": [1, 2]},
        },
    )
    _read(
        h.ctx,
        {
            "@call": "fetchFxRate",
            "args": {"days": [1, 2], "pair": {"quote": "USD", "base": "EUR"}},
        },
    )
    assert len(h.outbound) == 1, "key order does not matter"
    _read(
        h.ctx,
        {
            "@call": "fetchFxRate",
            "args": {"days": [2, 1], "pair": {"quote": "USD", "base": "EUR"}},
        },
    )
    assert len(h.outbound) == 2, "array order does"


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
async def test_arguments_that_are_not_json_fail_locally(bad: float) -> None:
    h = _Harness()
    h.surface.data_model.set("/rate", bad)
    for _ in range(2):
        assert (
            _read(h.ctx, {"@call": "convert", "args": {"rate": {"@path": "/rate"}}})
            is None
        )
    h.ctx.resolve_action(
        {"functionCall": {"@call": "convert", "args": {"rate": {"@path": "/rate"}}}}
    )
    assert h.outbound == [], "nothing is sent, shared or cached"
    assert [e["code"] for e in h.errors] == ["EXPRESSION_ERROR"] * 3
    assert all(
        "Function 'convert' arguments are not valid JSON" in e["message"]
        for e in h.errors
    )


@pytest.mark.asyncio
async def test_null_argument_is_sent() -> None:
    h = _Harness()
    _read(h.ctx, {"@call": "convert", "args": {"rate": {"@path": "/missing"}}})
    assert h.outbound[0]["callAgentFunction"]["callFunction"]["args"] == {"rate": None}


@pytest.mark.asyncio
async def test_replacing_the_caller_drops_cached_and_in_flight_calls() -> None:
    h = _Harness()
    call = {"@call": "fetchFxRate", "args": {"base": "EUR"}}
    _read(h.ctx, call)
    h.respond(0, value=1.08)
    await _flush()
    assert _read(h.ctx, call) == 1.08

    loop = asyncio.get_running_loop()
    sent: list[AgentFunctionCall] = []
    answers: list[asyncio.Future[Any]] = []

    def replacement(c: AgentFunctionCall) -> asyncio.Future[Any]:
        sent.append(c)
        answers.append(loop.create_future())
        return answers[-1]

    h.surface.agent_function_caller = replacement
    assert _read(h.ctx, call) is None, "the old answer is dropped"
    assert len(sent) == 1

    # Clearing the caller drops the call in flight too.
    h.surface.agent_function_caller = None
    h.surface.agent_function_caller = replacement
    _read(h.ctx, call)
    assert len(sent) == 2


@pytest.mark.asyncio
async def test_answer_arriving_after_caller_replacement_is_not_cached() -> None:
    surface = SurfaceModel("s1", None, protocol_version="1.0")
    loop = asyncio.get_running_loop()
    first_answer: asyncio.Future[Any] = loop.create_future()
    second_calls: list[AgentFunctionCall] = []
    surface.agent_function_caller = lambda c: first_answer

    def second(c: AgentFunctionCall) -> asyncio.Future[Any]:
        second_calls.append(c)
        return loop.create_future()

    call = AgentFunctionCall(call="f", catalog_id=FIN_CATALOG_ID, args={})
    pending = surface.call_agent_function(call)
    surface.agent_function_caller = second
    first_answer.set_result(1)
    assert await pending == 1
    await _flush()

    surface.call_agent_function(call)
    assert len(second_calls) == 1, "the stale answer was not cached"


@pytest.mark.asyncio
async def test_cached_and_shared_answers_are_copies() -> None:
    h = _Harness()
    call = {"@call": "fetchQuote", "args": {}}
    first = _read(h.ctx, call, peek=False)
    second = _read(h.ctx, call, peek=False)
    h.respond(0, value={"prices": [1]})
    await _flush()

    first.peek()["prices"].append(2)
    assert second.peek() == {"prices": [1]}
    cached = _read(h.ctx, call)
    assert cached == {"prices": [1]}
    cached["prices"].append(3)
    assert _read(h.ctx, call) == {"prices": [1]}
    assert len(h.outbound) == 1


@pytest.mark.asyncio
async def test_cancelled_calls_report_nothing() -> None:
    h = _Harness()
    dispatched: list[dict[str, Any]] = []
    h.surface.on_action.subscribe(dispatched.append)
    changes: list[Any] = []
    sub = h.ctx.subscribe_dynamic_value(
        {"@call": "upper", "args": {"value": {"@call": "fetchGreeting", "args": {}}}},
        changes.append,
    )
    resolved = h.ctx.resolve_action(
        {"event": {"name": "go", "context": {"x": {"@call": "fetchX", "args": {}}}}}
    )
    h.surface.dispatch_action(resolved, "btn1")
    assert len(h.outbound) == 2

    # Cancelled without deleting, so the surface is still live.
    h.proc.rpc.cancel_surface_calls("s1")
    await _flush()
    assert not h.surface.disposed
    assert h.errors == []
    assert dispatched == []
    assert changes == []
    sub.unsubscribe()


@pytest.mark.asyncio
async def test_cancellation_message_is_neutral() -> None:
    h = _Harness()
    result = h.surface.call_agent_function(
        AgentFunctionCall(call="f", catalog_id=FIN_CATALOG_ID, args={})
    )
    h.proc.rpc.cancel_surface_calls("s1")
    with pytest.raises(A2uiRpcError) as err:
        await result
    assert err.value.code == "CANCELLED"
    assert str(err.value) == "Pending calls for surface 's1' were cancelled."


def test_disposed_surface_sends_nothing_and_raises_cancelled() -> None:
    sent: list[AgentFunctionCall] = []
    surface = SurfaceModel("s1", None, protocol_version="1.0")
    surface.agent_function_caller = lambda c: sent.append(c)  # type: ignore[func-returns-value,return-value]
    surface.dispose()
    with pytest.raises(A2uiRpcError) as err:
        surface.call_agent_function(
            AgentFunctionCall(call="f", catalog_id=FIN_CATALOG_ID, args={})
        )
    assert err.value.code == "CANCELLED"
    assert sent == []


def test_aborted_evaluation_sends_nothing() -> None:
    from a2ui.core.common import AbortSignal

    h = _Harness()
    signal = AbortSignal()
    signal.abort()
    result = _read(
        h.ctx, {"@call": "fetchFxRate", "args": {}}, peek=False, abort_signal=signal
    )
    assert result.peek() is None
    assert h.outbound == []
    assert h.errors == []


@pytest.mark.asyncio
async def test_processor_caller_refuses_deleted_surface() -> None:
    h = _Harness()
    caller = h.surface.agent_function_caller
    assert caller is not None
    h.proc.process_messages([{"version": "1.0", "deleteSurface": {"surfaceId": "s1"}}])
    with pytest.raises(A2uiRpcError) as err:
        caller(AgentFunctionCall(call="f", catalog_id=FIN_CATALOG_ID, args={}))
    assert err.value.code == "CANCELLED"
    assert h.outbound == []


@pytest.mark.asyncio
async def test_event_action_resuming_after_delete_surface_sends_nothing() -> None:
    h = _Harness()
    dispatched: list[dict[str, Any]] = []
    h.surface.on_action.subscribe(dispatched.append)
    resolved = h.ctx.resolve_action({
        "event": {
            "name": "go",
            "context": {
                "a": {"@call": "fetchA", "args": {}},
                "b": {"@call": "fetchB", "args": {}},
            },
        }
    })
    h.surface.dispatch_action(resolved, "btn1")
    first = h.outbound[0]["callAgentFunction"]["functionCallId"]
    h.proc.process_messages([{"version": "1.0", "deleteSurface": {"surfaceId": "s1"}}])
    # A late answer to the first call doesn't resume the action.
    h.proc.process_messages([{
        "version": "1.0",
        "agentFunctionResponse": {"functionCallId": first, "value": 1},
    }])
    await _flush()
    assert [_call_name(m) for m in h.outbound] == ["fetchA"]
    assert dispatched == []
    assert h.errors == []


@pytest.mark.asyncio
async def test_schema_only_arguments_are_validated_after_they_resolve() -> None:
    outbound: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
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
    surface.on_error.subscribe(errors.append)
    surface.data_model.set("/symbol", "GOOG")
    surface.data_model.set("/bad", 42)
    ctx = DataContext(surface, "/")

    _read(ctx, {"@call": "quote", "args": {"symbol": {"@path": "/symbol"}}})
    assert errors == [], "a binding in the raw arguments is not rejected"
    assert outbound[0]["callAgentFunction"]["callFunction"]["args"] == {
        "symbol": "GOOG",
        "currency": "USD",
    }

    _read(ctx, {"@call": "quote", "args": {"symbol": {"@path": "/bad"}}})
    assert len(outbound) == 1, "an invalid resolved argument is not sent"
    assert [e["code"] for e in errors] == ["EXPRESSION_ERROR"]
    assert "Validation failed for function 'quote'" in errors[0]["message"]


@pytest.mark.asyncio
async def test_schema_only_arguments_resolved_later_are_validated() -> None:
    h = _Harness()
    h.ctx.resolve_action({
        "functionCall": {
            "@call": "quote",
            "args": {"symbol": {"@call": "fetchSymbol", "args": {}}},
        }
    })
    h.respond(0, value=42)
    await _flush()
    assert [_call_name(m) for m in h.outbound] == ["fetchSymbol"]
    assert [e["code"] for e in h.errors] == ["EXPRESSION_ERROR"]
    assert "Validation failed for function 'quote'" in h.errors[0]["message"]


def _checked_button(h: _Harness | None = None) -> tuple[Any, GenericBinder, Any]:
    outbound: list[dict[str, Any]] = []
    proc = MessageProcessor(
        [BasicCatalog("1.0")],
        options=MessageProcessorOptions(outbound_listener=outbound.append),
    )
    proc.process_messages([{
        "version": "1.0",
        "createSurface": {"surfaceId": "s1", "catalogId": BasicCatalog("1.0").id},
    }])
    surface = proc.model.get_surface("s1")
    assert surface is not None
    comp = ComponentModel(
        "b1",
        "Button",
        surface.default_catalog,
        {
            "checks": [{
                "condition": {"@call": "inStock", "args": {}},
                "message": "Out of stock",
            }]
        },
    )
    binder = GenericBinder(ComponentContext(comp, DataContext(surface, "/")))
    return proc, binder, outbound


@pytest.mark.asyncio
async def test_pending_check_rule_is_not_a_failure() -> None:
    proc, binder, outbound = _checked_button()
    props: list[dict[str, Any]] = []
    binder.subscribe(lambda p: props.append(dict(p)))
    assert len(outbound) == 1
    assert binder.current_props["isValid"] is True, "pending is not invalid"

    call_id = outbound[0]["callAgentFunction"]["functionCallId"]
    proc.process_messages([{
        "version": "1.0",
        "agentFunctionResponse": {"functionCallId": call_id, "value": False},
    }])
    await _flush()
    assert binder.current_props["isValid"] is False
    assert binder.current_props["validationErrors"] == ["Out of stock"]
    binder.dispose()


@pytest.mark.asyncio
async def test_failed_check_call_invalidates_and_notifies() -> None:
    proc, binder, outbound = _checked_button()
    props: list[dict[str, Any]] = []
    binder.subscribe(lambda p: props.append(dict(p)))
    assert binder.current_props["isValid"] is True
    count = len(props)

    call_id = outbound[0]["callAgentFunction"]["functionCallId"]
    proc.process_messages([{
        "version": "1.0",
        "agentFunctionResponse": {
            "functionCallId": call_id,
            "error": {"code": "UNKNOWN_FUNCTION", "message": "down"},
        },
    }])
    await _flush()
    assert len(props) > count, "pending to failed notifies subscribers"
    assert props[-1]["isValid"] is False
    binder.dispose()


@pytest.mark.asyncio
async def test_failed_call_is_not_resent_on_unrelated_change() -> None:
    h = _Harness()
    h.surface.data_model.set("/b", "x")
    h.surface.data_model.set("/base", "EUR")
    changes: list[Any] = []
    sub = h.ctx.subscribe_dynamic_value(
        {
            "parts": [
                {"@call": "fetchFxRate", "args": {"base": {"@path": "/base"}}},
                {"@path": "/b"},
            ]
        },
        changes.append,
    )
    assert len(h.outbound) == 1
    h.respond(0, error={"code": "UNKNOWN_FUNCTION", "message": "down"})
    await _flush()
    assert len(h.errors) == 1

    h.surface.data_model.set("/b", "y")
    assert len(h.outbound) == 1, "an unrelated change doesn't re-send the call"
    assert len(h.errors) == 1
    assert changes[-1] == {"parts": [None, "y"]}

    h.surface.data_model.set("/base", "USD")
    assert len(h.outbound) == 2, "a change to the call's own arguments sends it"
    h.surface.data_model.set("/base", "EUR")
    assert len(h.outbound) == 3, "flipping back is a new call too"
    sub.unsubscribe()


@pytest.mark.asyncio
async def test_failed_call_is_resent_by_a_new_evaluation() -> None:
    h = _Harness()
    call = {"@call": "fetchFxRate", "args": {}}
    sub = h.ctx.subscribe_dynamic_value(call, lambda _: None)
    h.respond(0, error={"code": "UNKNOWN_FUNCTION", "message": "down"})
    await _flush()

    second = h.ctx.subscribe_dynamic_value(call, lambda _: None)
    assert len(h.outbound) == 2, "a newly mounted binding sends it again"
    _read(h.ctx, call)
    assert len(h.outbound) == 2, "the new call is in flight and shared"
    sub.unsubscribe()
    second.unsubscribe()


@pytest.mark.asyncio
async def test_local_signal_result_keeps_streaming_after_agent_argument() -> None:
    stream: Signal[Any] = Signal("first")
    h = _Harness(extra_functions=[_streaming(stream)])
    changes: list[Any] = []
    sub = h.ctx.subscribe_dynamic_value(
        {
            "@call": "streaming",
            "args": {"value": {"@call": "fetchGreeting", "args": {}}},
        },
        changes.append,
    )
    h.respond(0, value="hi")
    await _flush()
    assert changes == ["first"]

    stream.value = "second"
    assert changes == ["first", "second"]
    sub.unsubscribe()
    stream.value = "third"
    assert changes == ["first", "second"], "updates stop when unsubscribed"


@pytest.mark.asyncio
async def test_failed_nested_argument_in_action_returns_none() -> None:
    h = _Harness()
    result = h.ctx.resolve_action({
        "functionCall": {
            "@call": "upper",
            "args": {"value": {"@call": "quote", "args": {"symbol": 1}}},
        }
    })
    assert result is None
    assert (
        _read(
            h.ctx,
            {
                "@call": "upper",
                "args": {"value": {"@call": "quote", "args": {"symbol": 1}}},
            },
            peek=False,
        )
        is None
    )


def test_failed_context_call_before_1_0_resolves_to_none() -> None:
    h = _Harness(version="0.9")
    dispatched: list[dict[str, Any]] = []
    h.surface.on_action.subscribe(dispatched.append)
    resolved = h.ctx.resolve_action(
        {"event": {"name": "go", "context": {"x": {"call": "missingFn", "args": {}}}}}
    )
    h.surface.dispatch_action(resolved, "btn1")
    assert len(dispatched) == 1
    assert dispatched[0]["context"] == {"x": None}


@pytest.mark.asyncio
async def test_non_string_user_message_is_invalid_whether_sync_or_async() -> None:
    h = _Harness()
    dispatched: list[dict[str, Any]] = []
    h.surface.on_action.subscribe(dispatched.append)

    h.surface.data_model.set("/n", 5)
    assert (
        h.ctx.resolve_action({"event": {"name": "go", "userMessage": {"@path": "/n"}}})
        is None
    )
    resolved = h.ctx.resolve_action(
        {"event": {"name": "go", "userMessage": {"@call": "fetchMessage", "args": {}}}}
    )
    h.surface.dispatch_action(resolved, "btn1")
    h.respond(0, value=5)
    await _flush()
    assert dispatched == []
    assert [e["code"] for e in h.errors] == ["INVALID_ACTION", "INVALID_ACTION"]
    assert all(
        e["message"] == "Action event 'userMessage' must resolve to a string."
        for e in h.errors
    )

    # A literal passed straight to dispatch_action is ignored.
    h.surface.dispatch_action({"event": {"name": "go", "userMessage": 5}}, "btn1")
    assert len(dispatched) == 1
    assert "userMessage" not in dispatched[0]


def test_public_resolve_methods_expose_no_internal_flags() -> None:
    for method in (DataContext.resolve_dynamic_value, DataContext.resolve_action):
        params = inspect.signature(method).parameters
        assert not [p for p in params if p.startswith("_")]


def test_cache_hit_works_on_a_worker_thread_and_after_asyncio_run() -> None:
    h = _Harness()
    call = {"@call": "fetchFxRate", "args": {}}

    async def _populate() -> None:
        _read(h.ctx, call)
        h.respond(0, value=1.08)
        await _flush()

    asyncio.run(_populate())
    assert _read(h.ctx, call) == 1.08, "after asyncio.run()"

    results: list[Any] = []
    errors: list[BaseException] = []

    def _worker() -> None:
        try:
            results.append(_read(h.ctx, call))
        except BaseException as e:  # pragma: no cover - reported below
            errors.append(e)

    thread = threading.Thread(target=_worker)
    thread.start()
    thread.join()
    assert errors == []
    assert results == [1.08]
    assert len(h.outbound) == 1


def test_cache_miss_off_the_loop_fails_fast() -> None:
    surface = SurfaceModel("s1", None, protocol_version="1.0")
    sent: list[AgentFunctionCall] = []

    async def caller(call: AgentFunctionCall) -> Any:
        sent.append(call)
        return 3

    surface.agent_function_caller = caller
    with pytest.raises(A2uiExpressionError, match="no event loop is running"):
        surface.call_agent_function(
            AgentFunctionCall(call="f", catalog_id=FIN_CATALOG_ID, args={})
        )
    assert sent == []


def test_binding_read_off_the_loop_reports_instead_of_hanging() -> None:
    h = _Harness()
    assert _read(h.ctx, {"@call": "fetchFxRate", "args": {}}) is None
    assert h.outbound == []
    assert [e["code"] for e in h.errors] == ["EXPRESSION_ERROR"]
    assert "no event loop is running" in h.errors[0]["message"]


@pytest.mark.asyncio
async def test_caller_returning_none_is_an_expression_error() -> None:
    h = _Harness()
    h.surface.agent_function_caller = lambda c: None  # type: ignore[arg-type,return-value]
    _read(h.ctx, {"@call": "fetchFxRate", "args": {}})
    assert [e["code"] for e in h.errors] == ["EXPRESSION_ERROR"]
    assert "must return an awaitable" in h.errors[0]["message"]


@pytest.mark.asyncio
async def test_user_message_resolving_to_none_is_absent() -> None:
    h = _Harness()
    dispatched: list[dict[str, Any]] = []
    h.surface.on_action.subscribe(dispatched.append)

    with pytest.warns(UserWarning):
        resolved = h.ctx.resolve_action(
            {"event": {"name": "go", "userMessage": {"@path": "/missing"}}}
        )
    h.surface.dispatch_action(resolved, "btn1")
    resolved = h.ctx.resolve_action(
        {"event": {"name": "go", "userMessage": {"@call": "fetchMessage", "args": {}}}}
    )
    h.surface.dispatch_action(resolved, "btn1")
    h.respond(0, value=None)
    await _flush()

    assert len(dispatched) == 2
    assert all("userMessage" not in action for action in dispatched)
    assert h.errors == []


@pytest.mark.asyncio
async def test_one_shot_peeked_read_is_never_routed() -> None:
    h = _Harness()
    assert (
        h.ctx.resolve_dynamic_value({"@call": "fetchFxRate", "args": {"base": "EUR"}})
        is None
    )
    assert h.outbound == [], "nothing is sent for a read that can't wait"
    assert [e["code"] for e in h.errors] == ["EXPRESSION_ERROR"]
    assert "can't be awaited here" in h.errors[0]["message"]


def _basic_harness() -> tuple[MessageProcessor, SurfaceModel, list[Any], list[Any]]:
    outbound: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    catalog = BasicCatalog("1.0")
    proc = MessageProcessor(
        [catalog], options=MessageProcessorOptions(outbound_listener=outbound.append)
    )
    proc.process_messages([{
        "version": "1.0",
        "createSurface": {"surfaceId": "s1", "catalogId": catalog.id},
    }])
    surface = proc.model.get_surface("s1")
    assert surface is not None
    surface.on_error.subscribe(errors.append)
    return proc, surface, outbound, errors


@pytest.mark.asyncio
async def test_format_string_part_calling_the_agent_is_refused() -> None:
    proc, surface, outbound, errors = _basic_harness()
    changes: list[Any] = []
    sub = DataContext(surface, "/").subscribe_dynamic_value(
        {"@call": "formatString", "args": {"value": "Rate: ${fetchFxRate()}"}},
        changes.append,
    )
    assert outbound == [], "a template part is not sent to the agent"
    assert [e["code"] for e in errors] == ["EXPRESSION_ERROR"]
    assert "fetchFxRate" in errors[0]["message"]
    sub.unsubscribe()


@pytest.mark.asyncio
async def test_call_renderer_function_argument_is_not_routed() -> None:
    seen: list[tuple[bool, bool]] = []
    probe = _probe(seen)
    probe.allowed_callers = "rendererOrAgent"
    h = _Harness(extra_functions=[probe])
    responses = h.proc.process_messages([{
        "version": "1.0",
        "callRendererFunction": {
            "functionCallId": "r1",
            "surfaceId": "s1",
            "callFunction": {
                "call": "probe",
                "catalogId": FIN_CATALOG_ID,
                "args": {"value": {"@call": "fetchFxRate", "args": {}}},
            },
        },
    }])
    await _flush()
    assert not [m for m in h.outbound if "callAgentFunction" in m]
    assert seen == [], "the function doesn't run with a None argument"
    replies = [
        m["rendererFunctionResponse"]
        for m in [*h.outbound, *(responses or [])]
        if isinstance(m, dict) and "rendererFunctionResponse" in m
    ]
    assert replies and "error" in replies[0]
    assert "fetchFxRate" in replies[0]["error"]["message"]


@pytest.mark.asyncio
async def test_cancelled_call_is_sent_again_on_reevaluation() -> None:
    h = _Harness()
    h.surface.data_model.set("/other", 1)
    sub = h.ctx.subscribe_dynamic_value(
        {"parts": [{"@call": "fetchFxRate", "args": {}}, {"@path": "/other"}]},
        lambda _: None,
    )
    assert len(h.outbound) == 1
    h.proc.rpc.cancel_surface_calls("s1")
    await _flush()
    h.surface.data_model.set("/other", 2)
    assert len(h.outbound) == 2, "a cancellation is not remembered as a failure"
    assert h.errors == []
    sub.unsubscribe()


@pytest.mark.asyncio
async def test_processor_dispose_cancels_pending_calls_silently() -> None:
    h = _Harness()
    proc_errors: list[Any] = []
    h.proc.model.on_error.subscribe(proc_errors.append)
    changes: list[Any] = []
    sub = h.ctx.subscribe_dynamic_value(
        {"@call": "fetchFxRate", "args": {}}, changes.append
    )
    assert len(h.proc.rpc._pending_agent_calls) == 1

    h.proc.dispose()
    await _flush()
    assert h.surface.disposed
    assert h.proc.rpc.disposed
    assert h.proc.rpc._pending_agent_calls == {}
    assert h.errors == []
    assert proc_errors == []
    assert changes == []
    sub.unsubscribe()


@pytest.mark.asyncio
async def test_sibling_failure_aborts_the_other_arguments() -> None:
    h = _Harness()
    result = _read(
        h.ctx,
        {
            "@call": "combine",
            "args": {
                "a": {"@call": "fetchA", "args": {}},
                "b": {"@call": "fetchB", "args": {}},
                "c": {"@call": "inner", "args": {"x": {"@call": "fetchC", "args": {}}}},
            },
        },
        peek=False,
    )
    assert [_call_name(m) for m in h.outbound] == [
        "fetchA",
        "fetchB",
        "fetchC",
    ], "siblings are sent together"
    h.respond(0, error={"code": "UNKNOWN_FUNCTION", "message": "a failed"})
    await _flush()
    h.respond(1, error={"code": "UNKNOWN_FUNCTION", "message": "b failed"})
    h.respond(2, value=1)
    await _flush()

    assert len(h.errors) == 1, "later sibling failures are silent"
    assert "a failed" in h.errors[0]["message"]
    assert [_call_name(m) for m in h.outbound] == [
        "fetchA",
        "fetchB",
        "fetchC",
    ], "a sibling still waiting sends nothing more"
    assert result.peek() is None


@pytest.mark.asyncio
async def test_many_bindings_settle_without_resending() -> None:
    h = _Harness()
    values: dict[int, list[Any]] = {}
    subs = []
    for i in range(300):
        values[i] = []
        subs.append(
            h.ctx.subscribe_dynamic_value(
                {"@call": "fetchItem", "args": {"id": i}}, values[i].append
            )
        )
    assert len(h.outbound) == 300
    for i in range(300):
        h.respond(i, value=i * 2)
    await _flush()
    assert len(h.outbound) == 300, "evicted answers don't make bindings resend"
    assert all(values[i] == [i * 2] for i in range(300))
    for sub in subs:
        sub.unsubscribe()


class _Currency(str, enum.Enum):
    USD = "USD"
    EUR = "EUR"


class _Level(enum.IntEnum):
    LOW = 1


class _EnumQuoteArgs(BaseModel):
    symbol: DynamicString
    currency: _Currency = _Currency.USD


@pytest.mark.asyncio
async def test_json_gate_accepts_what_json_dumps_accepts() -> None:
    quote = FunctionApi(name="enumQuote", return_type="number", schema=_EnumQuoteArgs)
    h = _Harness(extra_functions=[quote])
    _read(h.ctx, {"@call": "enumQuote", "args": {"symbol": "GOOG"}})
    assert h.errors == [], "an enum default the SDK fills in is sent"
    assert h.outbound[0]["callAgentFunction"]["callFunction"]["args"] == {
        "symbol": "GOOG",
        "currency": "USD",
    }

    h.surface.data_model.set("/pair", ("EUR", "USD"))
    h.surface.data_model.set("/level", _Level.LOW)
    _read(
        h.ctx,
        {
            "@call": "convert",
            "args": {"pair": {"@path": "/pair"}, "level": {"@path": "/level"}},
        },
    )
    assert h.errors == []
    assert len(h.outbound) == 2

    h.surface.data_model.set("/byId", {1: "one"})
    _read(h.ctx, {"@call": "convert", "args": {"byId": {"@path": "/byId"}}})
    assert len(h.outbound) == 2, "a non-string key would be changed, so not sent"
    assert "not valid JSON" in h.errors[0]["message"]


class _Window(BaseModel):
    days: int = 7
    unit: str = "d"


class _HistoryArgs(BaseModel):
    symbol: DynamicString
    window: _Window = _Window()


@pytest.mark.asyncio
async def test_nested_defaults_are_filled_for_code_and_document_catalogs() -> None:
    from_code = FunctionApi(name="history", return_type="any", schema=_HistoryArgs)
    h = _Harness(extra_functions=[from_code])
    _read(h.ctx, {"@call": "history", "args": {"symbol": "G", "window": {"days": 1}}})
    code_args = h.outbound[0]["callAgentFunction"]["callFunction"]["args"]

    from_document = FunctionApi(
        name="history",
        return_type="any",
        schema={
            "type": "object",
            "properties": {
                "symbol": {"type": "string"},
                "window": {
                    "type": "object",
                    "properties": {
                        "days": {"type": "integer", "default": 7},
                        "unit": {"type": "string", "default": "d"},
                    },
                    "default": {},
                },
            },
            "required": ["symbol"],
        },
    )
    outbound: list[dict[str, Any]] = []
    proc = MessageProcessor(
        [Catalog(FIN_CATALOG_ID, "1.0", [], [from_document])],
        options=MessageProcessorOptions(outbound_listener=outbound.append),
    )
    proc.process_messages([{
        "version": "1.0",
        "createSurface": {"surfaceId": "s1", "catalogId": FIN_CATALOG_ID},
    }])
    surface = proc.model.get_surface("s1")
    assert surface is not None
    ctx = DataContext(surface, "/")
    _read(ctx, {"@call": "history", "args": {"symbol": "G", "window": {"days": 1}}})
    _read(ctx, {"@call": "history", "args": {"symbol": "H"}})
    document_args = outbound[0]["callAgentFunction"]["callFunction"]["args"]

    assert code_args == {"symbol": "G", "window": {"days": 1, "unit": "d"}}
    assert document_args == code_args
    assert outbound[1]["callAgentFunction"]["callFunction"]["args"] == {
        "symbol": "H",
        "window": {"days": 7, "unit": "d"},
    }


@pytest.mark.asyncio
async def test_malformed_context_value_is_reported_the_same_way() -> None:
    h = _Harness()
    malformed = {"@bogus": 1}
    assert (
        h.ctx.resolve_action({"event": {"name": "go", "context": {"bad": malformed}}})
        is None
    ), "no exception escapes"
    resolved = h.ctx.resolve_action({
        "event": {
            "name": "go",
            "context": {"rate": {"@call": "fetchFxRate", "args": {}}, "bad": malformed},
        }
    })
    h.surface.dispatch_action(resolved, "btn1")
    h.respond(0, value=1)
    await _flush()

    assert [e["code"] for e in h.errors] == ["EXPRESSION_ERROR"] * 2
    assert all(e["surfaceId"] == "s1" for e in h.errors)
    assert [e["expression"] for e in h.errors] == ["event.context.bad"] * 2


@pytest.mark.asyncio
async def test_setter_replaces_an_equal_but_different_caller() -> None:
    loop = asyncio.get_running_loop()

    class _Client:

        def __init__(self) -> None:
            self.sent: list[AgentFunctionCall] = []

        def __eq__(self, other: object) -> bool:
            return isinstance(other, _Client)

        __hash__ = object.__hash__

        def send(self, call: AgentFunctionCall) -> asyncio.Future[Any]:
            self.sent.append(call)
            return loop.create_future()

    first, second = _Client(), _Client()
    surface = SurfaceModel("s1", None, protocol_version="1.0")
    surface.agent_function_caller = first.send
    surface.agent_function_caller = second.send
    surface.call_agent_function(
        AgentFunctionCall(call="f", catalog_id=FIN_CATALOG_ID, args={})
    )
    assert (len(first.sent), len(second.sent)) == (0, 1)
