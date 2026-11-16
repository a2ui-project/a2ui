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

"""Tests for how RendererToAgentMessageProcessor answers `callAgentFunction`."""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any

import pytest

from a2ui.core import (
    A2uiCatalogError,
    A2uiRpcError,
    A2uiValidationError,
    AgentFunction,
    AgentFunctionContext,
    AgentFunctionHandler,
    Catalog,
)
from a2ui.core.catalog import FunctionApi
from a2ui.core.schema.v1_0 import (
    AgentFunctionResponseMessage,
    CallAgentFunction,
    CallAgentFunctionMessage,
    FunctionCall,
)
from a2ui.rpc import RendererToAgentMessageProcessor

FIN = "https://example.com/fin/v1/catalog.json"
TRAVEL = "https://example.com/travel/v1/catalog.json"

FX_RATE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "base": {"type": "string"},
        "target": {"type": "string", "default": "USD"},
    },
    "required": ["base"],
    "additionalProperties": False,
}


def _fx(handler: AgentFunctionHandler, **kwargs: Any) -> AgentFunction:
    return AgentFunction(
        kwargs.pop("name", "fetchFxRate"),
        handler=handler,
        return_type="number",
        schema=FX_RATE_SCHEMA,
        **kwargs,
    )


def _processor(
    *functions: AgentFunction, **kwargs: Any
) -> RendererToAgentMessageProcessor:
    return RendererToAgentMessageProcessor(
        [Catalog(FIN, "1.0", functions=list(functions))], **kwargs
    )


async def _handle(
    processor: RendererToAgentMessageProcessor, message: Any
) -> AgentFunctionResponseMessage:
    """Processes a call, which always gets exactly one reply."""
    result = await processor.process_message(message)
    assert result.handled
    assert len(result.replies) == 1
    reply = result.replies[0]
    assert isinstance(reply, AgentFunctionResponseMessage)
    return reply


def _call(
    name: str = "fetchFxRate",
    args: dict[str, Any] | None = None,
    *,
    catalog_id: str | None = FIN,
    call_id: str = "fx-1",
    surface_id: str = "s1",
) -> dict[str, Any]:
    call_function: dict[str, Any] = {
        "@call": name,
        "args": {"base": "EUR"} if args is None else args,
    }
    if catalog_id is not None:
        call_function["catalogId"] = catalog_id
    return {
        "version": "1.0",
        "callAgentFunction": {
            "surfaceId": surface_id,
            "functionCallId": call_id,
            "callFunction": call_function,
        },
    }


def _response(message: Any) -> dict[str, Any]:
    dumped = message.model_dump(by_alias=True, exclude_unset=True)
    assert dumped["version"] == "1.0"
    return dumped["agentFunctionResponse"]


def _constant(value: Any) -> AgentFunctionHandler:
    return lambda args, context: value


class TestAnswers:

    @pytest.mark.asyncio
    async def test_returns_the_handler_value_and_copies_the_call_id(self) -> None:
        processor = _processor(_fx(_constant(1.08)))

        response = await _handle(processor, _call(call_id="Weird id/ü 42"))

        assert _response(response) == {"functionCallId": "Weird id/ü 42", "value": 1.08}

    @pytest.mark.asyncio
    async def test_accepts_the_schema_model(self) -> None:
        processor = _processor(_fx(_constant(1.08)))
        message = CallAgentFunctionMessage(
            version="1.0",
            callAgentFunction=CallAgentFunction(
                surfaceId="s1",
                functionCallId="fx-1",
                callFunction=FunctionCall.model_validate({
                    "@call": "fetchFxRate",
                    "catalogId": FIN,
                    "args": {"base": "EUR"},
                }),
            ),
        )

        response = await _handle(processor, message)

        assert _response(response) == {"functionCallId": "fx-1", "value": 1.08}

    @pytest.mark.asyncio
    async def test_keeps_a_none_value_in_the_response(self) -> None:
        processor = _processor(_fx(_constant(None)))

        response = await _handle(processor, _call())

        assert _response(response) == {"functionCallId": "fx-1", "value": None}

    @pytest.mark.asyncio
    async def test_passes_validated_args_with_defaults_and_the_context(self) -> None:
        seen: list[tuple[dict[str, Any], AgentFunctionContext]] = []

        def handler(args: dict[str, Any], context: AgentFunctionContext) -> float:
            seen.append((args, context))
            return 1.08

        processor = _processor(_fx(handler))

        await _handle(processor, _call(surface_id="checkout", call_id="fx-9"))

        assert seen == [(
            {"base": "EUR", "target": "USD"},
            AgentFunctionContext(
                catalog_id=FIN, surface_id="checkout", function_call_id="fx-9"
            ),
        )]

    @pytest.mark.asyncio
    async def test_finds_the_only_catalog_with_the_function_without_catalog_id(
        self,
    ) -> None:
        seen: list[str] = []

        def handler(args: dict[str, Any], context: AgentFunctionContext) -> float:
            seen.append(context.catalog_id)
            return 1.08

        processor = RendererToAgentMessageProcessor([
            Catalog(FIN, "1.0", functions=[_fx(handler)]),
            Catalog(TRAVEL, "1.0"),
        ])

        response = await _handle(processor, _call(catalog_id=None))

        assert _response(response)["value"] == 1.08
        assert seen == [FIN]

    @pytest.mark.asyncio
    async def test_routes_by_catalog_id(self) -> None:
        processor = RendererToAgentMessageProcessor([
            Catalog(FIN, "1.0", functions=[_fx(_constant("fin"))]),
            Catalog(TRAVEL, "1.0", functions=[_fx(_constant("travel"))]),
        ])

        fin = await _handle(processor, _call(catalog_id=FIN))
        travel = await _handle(processor, _call(catalog_id=TRAVEL))

        assert _response(fin)["value"] == "fin"
        assert _response(travel)["value"] == "travel"

    @pytest.mark.asyncio
    async def test_only_agent_functions_of_the_catalogs_answer(self) -> None:
        catalog = Catalog(
            FIN, "1.0", functions=[FunctionApi("formatMoney"), _fx(_constant(1.08))]
        )
        processor = RendererToAgentMessageProcessor([catalog])

        fx = await _handle(processor, _call())
        money = await _handle(processor, _call("formatMoney", {}))

        assert _response(fx)["value"] == 1.08
        assert _response(money)["error"]["code"] == "UNKNOWN_FUNCTION"

    @pytest.mark.asyncio
    async def test_passes_only_the_args_to_a_one_parameter_handler(self) -> None:
        seen: list[dict[str, Any]] = []

        def handler(args: dict[str, Any]) -> float:
            seen.append(args)
            return 1.08

        processor = _processor(_fx(handler))

        response = await _handle(processor, _call())

        assert _response(response)["value"] == 1.08
        assert seen == [{"base": "EUR", "target": "USD"}]


class TestErrors:

    @pytest.mark.asyncio
    async def test_unknown_function_name(self) -> None:
        processor = _processor(_fx(_constant(1.08)))

        response = await _handle(processor, _call("fetchWeather", call_id="w-1"))

        body = _response(response)
        assert body["functionCallId"] == "w-1"
        assert body["error"]["code"] == "UNKNOWN_FUNCTION"
        assert "fetchWeather" in body["error"]["message"]

    @pytest.mark.asyncio
    async def test_unknown_catalog(self) -> None:
        processor = _processor(_fx(_constant(1.08)))

        response = await _handle(processor, _call(catalog_id=TRAVEL))

        assert _response(response)["error"]["code"] == "UNKNOWN_FUNCTION"

    @pytest.mark.asyncio
    async def test_declared_function_that_is_not_an_agent_function(self) -> None:
        processor = RendererToAgentMessageProcessor(
            [Catalog(FIN, "1.0", functions=[FunctionApi("formatMoney")])]
        )

        response = await _handle(processor, _call("formatMoney", {}))

        assert _response(response)["error"]["code"] == "UNKNOWN_FUNCTION"

    @pytest.mark.asyncio
    async def test_no_catalog_id_and_no_catalog_has_the_function(self) -> None:
        processor = _processor(_fx(_constant(1.08)))

        response = await _handle(processor, _call("fetchWeather", catalog_id=None))

        assert _response(response)["error"]["code"] == "UNKNOWN_FUNCTION"

    @pytest.mark.asyncio
    async def test_no_catalog_id_and_several_catalogs_have_the_function(
        self,
    ) -> None:
        processor = RendererToAgentMessageProcessor([
            Catalog(FIN, "1.0", functions=[_fx(_constant(1))]),
            Catalog(TRAVEL, "1.0", functions=[_fx(_constant(2))]),
        ])

        response = await _handle(processor, _call(catalog_id=None))

        body = _response(response)
        assert body["error"]["code"] == "INVALID_FUNCTION_CALL"
        assert "catalogId" in body["error"]["message"]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("args", "detail"),
        [
            ({}, "'base' is a required property"),
            ({"base": 3}, "3 is not of type 'string'"),
            ({"base": "EUR", "extra": 1}, "'extra' was unexpected"),
        ],
    )
    async def test_invalid_args(self, args: dict[str, Any], detail: str) -> None:
        calls: list[Any] = []
        processor = _processor(_fx(lambda a, c: calls.append(a)))

        response = await _handle(processor, _call(args=args))

        body = _response(response)
        assert body["error"]["code"] == "INVALID_FUNCTION_CALL"
        assert detail in body["error"]["message"]
        assert calls == [], "the handler must not run"

    @pytest.mark.asyncio
    async def test_agent_only_function_cannot_be_called_by_the_renderer(
        self,
    ) -> None:
        # AgentFunction can't be built agentOnly; the guard still covers a
        # function whose allowed_callers was changed afterwards.
        fx = _fx(_constant(1.08))
        fx.allowed_callers = "agentOnly"
        processor = _processor(fx)

        response = await _handle(processor, _call())

        body = _response(response)
        assert body["error"]["code"] == "INVALID_FUNCTION_CALL"
        assert "agentOnly" in body["error"]["message"]

    @pytest.mark.asyncio
    async def test_handler_exception_is_execution_error_without_traceback(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        def handler(args: dict[str, Any], context: AgentFunctionContext) -> Any:
            raise LookupError("no rate for EUR")

        processor = _processor(_fx(handler))

        with caplog.at_level(logging.ERROR):
            response = await _handle(processor, _call())

        assert _response(response)["error"] == {
            "code": "EXECUTION_ERROR",
            "message": "no rate for EUR",
        }
        assert any(
            record.exc_info and record.exc_info[0] is LookupError
            for record in caplog.records
        ), "the traceback is logged"

    @pytest.mark.asyncio
    async def test_handler_chooses_the_code_with_rpc_error(self) -> None:
        async def handler(args: dict[str, Any], context: AgentFunctionContext) -> Any:
            raise A2uiRpcError("Provider PRV-102 not found.", code="PROVIDER_NOT_FOUND")

        processor = _processor(_fx(handler))

        response = await _handle(processor, _call())

        assert _response(response)["error"] == {
            "code": "PROVIDER_NOT_FOUND",
            "message": "Provider PRV-102 not found.",
        }

    @pytest.mark.asyncio
    async def test_malformed_message_with_a_call_id(self) -> None:
        processor = _processor(_fx(_constant(1.08)))
        message = _call()
        del message["callAgentFunction"]["surfaceId"]

        response = await _handle(processor, message)

        body = _response(response)
        assert body["functionCallId"] == "fx-1"
        assert body["error"]["code"] == "INVALID_FUNCTION_CALL"

    @pytest.mark.asyncio
    async def test_malformed_message_without_a_call_id_raises(self) -> None:
        processor = _processor(_fx(_constant(1.08)))
        message = _call()
        del message["callAgentFunction"]["functionCallId"]

        with pytest.raises(A2uiValidationError, match="functionCallId"):
            await _handle(processor, message)

    @pytest.mark.asyncio
    @pytest.mark.parametrize("as_model", [False, True])
    async def test_empty_call_id_raises_without_running_the_handler(
        self, as_model: bool
    ) -> None:
        calls: list[Any] = []
        processor = _processor(_fx(lambda a, c: calls.append(a)))
        message: Any = _call(call_id="")
        if as_model:
            message = CallAgentFunctionMessage.model_validate(message)

        with pytest.raises(A2uiValidationError, match="empty functionCallId"):
            await processor.process_message(message)
        assert calls == []

    @pytest.mark.asyncio
    async def test_empty_function_name_is_an_invalid_call(self) -> None:
        processor = _processor(_fx(_constant(1.08)))

        response = await _handle(processor, _call("", catalog_id=None))

        body = _response(response)
        assert body["functionCallId"] == "fx-1"
        assert body["error"]["code"] == "INVALID_FUNCTION_CALL"

    @pytest.mark.asyncio
    async def test_empty_surface_id_is_an_invalid_call(self) -> None:
        calls: list[Any] = []
        processor = _processor(_fx(lambda a, c: calls.append(a)))

        response = await _handle(processor, _call(surface_id=""))

        body = _response(response)
        assert body["functionCallId"] == "fx-1"
        assert body["error"]["code"] == "INVALID_FUNCTION_CALL"
        assert "surfaceId" in body["error"]["message"]
        assert calls == []


class TestExecution:

    @pytest.mark.asyncio
    async def test_async_handler_runs_on_the_loop_thread(self) -> None:
        threads: list[int] = []

        async def handler(args: dict[str, Any], context: AgentFunctionContext) -> int:
            threads.append(threading.get_ident())
            return 1

        processor = _processor(_fx(handler))

        await _handle(processor, _call())

        assert threads == [threading.get_ident()]

    @pytest.mark.asyncio
    async def test_sync_handler_runs_on_a_worker_thread(self) -> None:
        threads: list[int] = []

        def handler(args: dict[str, Any], context: AgentFunctionContext) -> int:
            threads.append(threading.get_ident())
            return 1

        processor = _processor(_fx(handler))

        await _handle(processor, _call())

        assert len(threads) == 1
        assert threads[0] != threading.get_ident()

    @pytest.mark.asyncio
    async def test_awaits_an_awaitable_returned_by_a_sync_handler(self) -> None:
        async def rate() -> float:
            return 1.08

        processor = _processor(_fx(lambda args, context: rate()))

        response = await _handle(processor, _call())

        assert _response(response)["value"] == 1.08

    @pytest.mark.asyncio
    async def test_async_callable_object(self) -> None:
        class Handler:

            async def __call__(
                self, args: dict[str, Any], context: AgentFunctionContext
            ) -> str:
                return threading.current_thread().name

        processor = _processor(_fx(Handler()))

        response = await _handle(processor, _call())

        assert _response(response)["value"] == threading.current_thread().name

    @pytest.mark.asyncio
    async def test_calls_run_concurrently_by_default(self) -> None:
        both_started = asyncio.Event()
        started = 0

        async def handler(args: dict[str, Any], context: AgentFunctionContext) -> str:
            nonlocal started
            started += 1
            if started == 2:
                both_started.set()
            await both_started.wait()
            return context.function_call_id

        processor = _processor(_fx(handler))

        responses = await asyncio.wait_for(
            asyncio.gather(
                _handle(processor, _call(call_id="a")),
                _handle(processor, _call(call_id="b")),
            ),
            timeout=5,
        )

        assert [_response(r)["value"] for r in responses] == ["a", "b"]

    @pytest.mark.parametrize("timeout", [0, -1, float("nan"), float("inf"), True, "1"])
    def test_rejects_a_timeout_that_is_not_finite_and_positive(
        self, timeout: Any
    ) -> None:
        with pytest.raises(ValueError, match="finite positive"):
            _processor(agent_function_timeout=timeout)

    def test_accepts_an_integer_timeout(self) -> None:
        _processor(agent_function_timeout=5)

    def test_rejects_two_catalogs_with_one_id(self) -> None:
        with pytest.raises(A2uiCatalogError, match="Duplicate catalog ID"):
            RendererToAgentMessageProcessor([
                Catalog(FIN, "1.0"),
                Catalog(FIN, "1.0", functions=[_fx(_constant(1))]),
            ])


class TestTimeoutsAndCancellation:

    @staticmethod
    def _hanging() -> tuple[AgentFunctionHandler, dict[str, bool]]:
        state = {"started": False, "cancelled": False}

        async def handler(args: dict[str, Any], context: AgentFunctionContext) -> Any:
            state["started"] = True
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                state["cancelled"] = True
                raise

        return handler, state

    @pytest.mark.asyncio
    async def test_timeout_cancels_the_handler_and_replies_execution_error(
        self,
    ) -> None:
        handler, state = self._hanging()
        processor = _processor(_fx(handler), agent_function_timeout=0.01)

        response = await asyncio.wait_for(_handle(processor, _call()), timeout=5)

        body = _response(response)
        assert body["error"]["code"] == "EXECUTION_ERROR"
        assert "timed out" in body["error"]["message"]
        assert state["cancelled"]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("timeout", [None, 30.0])
    async def test_a_timeout_error_from_the_handler_is_a_handler_error(
        self, timeout: float | None, caplog: pytest.LogCaptureFixture
    ) -> None:
        async def handler(args: dict[str, Any], context: AgentFunctionContext) -> Any:
            raise TimeoutError("upstream rates API timed out")

        processor = _processor(_fx(handler), agent_function_timeout=timeout)

        with caplog.at_level(logging.ERROR):
            response = await _handle(processor, _call())

        assert _response(response)["error"] == {
            "code": "EXECUTION_ERROR",
            "message": "upstream rates API timed out",
        }
        assert any(
            record.exc_info and record.exc_info[0] is TimeoutError
            for record in caplog.records
        ), "the traceback is logged"

    @pytest.mark.asyncio
    async def test_cancelling_the_caller_cancels_the_handler_without_reply(
        self,
    ) -> None:
        handler, state = self._hanging()
        processor = _processor(_fx(handler))
        task = asyncio.ensure_future(processor.process_message(_call()))
        while not state["started"]:
            await asyncio.sleep(0)

        task.cancel()

        with pytest.raises(asyncio.CancelledError):
            await task
        assert state["cancelled"]
