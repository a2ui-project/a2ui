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

"""Tests for RendererFunctionCalls, the agent's `callRendererFunction` table."""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any

import pytest

from a2ui.core import A2uiCatalogError, A2uiRpcError, AgentFunction, Catalog
from a2ui.core.catalog import FunctionApi
from a2ui.core.schema import ProtocolVersion
from a2ui.core.schema.v1_0 import FunctionResponse, RendererFunctionResponseMessage
from a2ui.rpc import (
    DEFAULT_RENDERER_CALL_TIMEOUT,
    RendererFunctionCalls,
    RendererToAgentMessageProcessor,
)

CATALOG = "https://example.com/device/v1/catalog.json"


def _value(call_id: str, value: Any) -> dict[str, Any]:
    return {
        "version": "1.0",
        "rendererFunctionResponse": {"functionCallId": call_id, "value": value},
    }


def _failure(call_id: str, code: str, message: str) -> dict[str, Any]:
    return {
        "version": "1.0",
        "rendererFunctionResponse": {
            "functionCallId": call_id,
            "error": {"code": code, "message": message},
        },
    }


def _id(message: Any) -> str:
    return message.call_renderer_function.function_call_id


async def _settle(future: asyncio.Future[Any]) -> Any:
    return await asyncio.wait_for(future, timeout=5)


class TestCall:

    @pytest.mark.asyncio
    async def test_builds_the_message_without_waiting(self) -> None:
        calls = RendererFunctionCalls()

        message, future = calls.call(
            catalog_id=CATALOG,
            name="getResolution",
            args={"unit": "px"},
            surface_id="s1",
        )

        assert not future.done()
        dumped = message.model_dump(by_alias=True, exclude_unset=True)
        call_id = dumped["callRendererFunction"]["functionCallId"]
        assert call_id
        assert dumped == {
            "version": "1.0",
            "callRendererFunction": {
                "surfaceId": "s1",
                "functionCallId": call_id,
                "callFunction": {
                    "@call": "getResolution",
                    "catalogId": CATALOG,
                    "args": {"unit": "px"},
                },
            },
        }
        assert calls.pending_count == 1
        future.cancel()

    @pytest.mark.asyncio
    async def test_leaves_out_surface_id_when_not_given(self) -> None:
        calls = RendererFunctionCalls()

        message, future = calls.call(catalog_id=CATALOG, name="now")

        dumped = message.model_dump(by_alias=True, exclude_unset=True)
        assert "surfaceId" not in dumped["callRendererFunction"]
        assert dumped["callRendererFunction"]["callFunction"]["args"] == {}
        future.cancel()

    @pytest.mark.asyncio
    async def test_generates_distinct_ids(self) -> None:
        calls = RendererFunctionCalls()

        pairs = [calls.call(catalog_id=CATALOG, name="now") for _ in range(3)]

        assert len({_id(message) for message, _ in pairs}) == 3
        for _, future in pairs:
            future.cancel()

    @pytest.mark.asyncio
    async def test_leaves_out_an_empty_surface_id(self) -> None:
        calls = RendererFunctionCalls()

        message, future = calls.call(catalog_id=CATALOG, name="now", surface_id="")

        dumped = message.model_dump(by_alias=True, exclude_unset=True)
        assert "surfaceId" not in dumped["callRendererFunction"]
        future.cancel()

    @pytest.mark.asyncio
    async def test_requires_a_function_name(self) -> None:
        calls = RendererFunctionCalls()

        with pytest.raises(A2uiRpcError) as excinfo:
            calls.call(catalog_id=CATALOG, name="")

        assert excinfo.value.code == "INVALID_FUNCTION_CALL"
        assert calls.pending_count == 0

    @pytest.mark.asyncio
    async def test_requires_a_catalog_id(self) -> None:
        calls = RendererFunctionCalls()

        with pytest.raises(A2uiRpcError) as excinfo:
            calls.call(catalog_id="", name="now")

        assert excinfo.value.code == "INVALID_FUNCTION_CALL"
        assert calls.pending_count == 0

    @pytest.mark.asyncio
    async def test_rejects_a_pending_call_id(self) -> None:
        calls = RendererFunctionCalls()
        _, future = calls.call(catalog_id=CATALOG, name="now", function_call_id="c1")

        with pytest.raises(A2uiRpcError) as excinfo:
            calls.call(catalog_id=CATALOG, name="now", function_call_id="c1")

        assert excinfo.value.code == "DUPLICATE"
        future.cancel()

    @pytest.mark.asyncio
    async def test_max_pending(self) -> None:
        calls = RendererFunctionCalls(max_pending=2)
        _, first = calls.call(catalog_id=CATALOG, name="now", function_call_id="a")
        _, second = calls.call(catalog_id=CATALOG, name="now")

        with pytest.raises(A2uiRpcError) as excinfo:
            calls.call(catalog_id=CATALOG, name="now")
        assert excinfo.value.code == "TOO_MANY_PENDING"

        calls.resolve(_value("a", 1))
        assert await _settle(first) == 1
        _, third = calls.call(catalog_id=CATALOG, name="now")
        second.cancel()
        third.cancel()

    def test_needs_a_running_loop(self) -> None:
        with pytest.raises(RuntimeError):
            RendererFunctionCalls().call(catalog_id=CATALOG, name="now")

    def test_belongs_to_the_first_loop(self) -> None:
        calls = RendererFunctionCalls()

        async def call() -> None:
            _, future = calls.call(catalog_id=CATALOG, name="now")
            future.cancel()

        asyncio.run(call())
        with pytest.raises(RuntimeError, match="another event loop"):
            asyncio.run(call())

    def test_rejects_bad_settings(self) -> None:
        with pytest.raises(ValueError):
            RendererFunctionCalls(max_pending=0)

    @pytest.mark.parametrize("timeout", [0, -1, float("nan"), float("inf"), True, "30"])
    def test_rejects_a_default_timeout_that_is_not_finite_and_positive(
        self, timeout: Any
    ) -> None:
        with pytest.raises(ValueError, match="default_timeout"):
            RendererFunctionCalls(default_timeout=timeout)

    def test_accepts_no_default_timeout(self) -> None:
        RendererFunctionCalls(default_timeout=None)


class TestCallChecks:
    """The checks `call` makes, in order, before anything is registered."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "timeout", [0, -1, float("nan"), float("inf"), float("-inf"), True, False]
    )
    async def test_rejects_a_timeout_that_is_not_finite_and_positive(
        self, timeout: Any
    ) -> None:
        calls = RendererFunctionCalls()

        with pytest.raises(ValueError, match="timeout"):
            calls.call(catalog_id=CATALOG, name="now", timeout=timeout)

        assert calls.pending_count == 0

    @pytest.mark.asyncio
    async def test_checks_the_timeout_before_disposal(self) -> None:
        calls = RendererFunctionCalls()
        calls.dispose()

        with pytest.raises(ValueError):
            calls.call(catalog_id=CATALOG, name="now", timeout=float("nan"))

    @pytest.mark.asyncio
    async def test_rejects_an_empty_function_call_id(self) -> None:
        calls = RendererFunctionCalls()

        with pytest.raises(A2uiRpcError) as excinfo:
            calls.call(catalog_id=CATALOG, name="now", function_call_id="")

        assert excinfo.value.code == "INVALID_FUNCTION_CALL"
        assert calls.pending_count == 0

    @pytest.mark.asyncio
    async def test_checks_disposal_before_the_function_call_id(self) -> None:
        calls = RendererFunctionCalls()
        calls.dispose()

        with pytest.raises(A2uiRpcError) as excinfo:
            calls.call(catalog_id=CATALOG, name="now", function_call_id="")

        assert excinfo.value.code == "DISPOSED"

    @pytest.mark.asyncio
    async def test_checks_the_name_before_the_catalog_id(self) -> None:
        calls = RendererFunctionCalls()

        with pytest.raises(A2uiRpcError, match="function name"):
            calls.call(catalog_id="", name="")

    @pytest.mark.asyncio
    async def test_checks_the_pending_limit_before_the_name(self) -> None:
        calls = RendererFunctionCalls(max_pending=1)
        _, future = calls.call(catalog_id=CATALOG, name="now")

        with pytest.raises(A2uiRpcError) as excinfo:
            calls.call(catalog_id=CATALOG, name="")

        assert excinfo.value.code == "TOO_MANY_PENDING"
        future.cancel()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("name", ["get-location", "@index", "1st", "a b"])
    async def test_rejects_a_name_that_is_not_an_identifier(self, name: str) -> None:
        calls = RendererFunctionCalls()

        with pytest.raises(A2uiRpcError) as excinfo:
            calls.call(catalog_id=CATALOG, name=name)

        assert excinfo.value.code == "INVALID_FUNCTION_CALL"
        assert calls.pending_count == 0

    @pytest.mark.asyncio
    async def test_checks_the_catalog_id_before_the_identifier(self) -> None:
        calls = RendererFunctionCalls()

        with pytest.raises(A2uiRpcError, match="needs a catalogId"):
            calls.call(catalog_id="", name="get-location")

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("args", "text"),
        [
            (["Saved"], "must be an object"),
            ("Saved", "must be an object"),
            ({"bad-key": 1}, "bad-key"),
            ({1: "one"}, "1"),
            ({"x": float("nan")}, "'x'"),
            ({"x": float("inf")}, "'x'"),
            ({"x": [1, float("-inf")]}, "x[1]"),
            ({"x": {"y": float("nan")}}, "x.y"),
            ({"x": {1: "one"}}, "isn't a string"),
            ({"x": object()}, "isn't a JSON value"),
            ({"x": {1, 2}}, "isn't a JSON value"),
        ],
        ids=[
            "list",
            "string",
            "bad-key",
            "non-string-key",
            "nan",
            "inf",
            "nested-inf",
            "nested-nan",
            "nested-non-string-key",
            "object",
            "set",
        ],
    )
    async def test_rejects_args_that_are_not_a_json_object(
        self, args: Any, text: str
    ) -> None:
        calls = RendererFunctionCalls()

        with pytest.raises(A2uiRpcError) as excinfo:
            calls.call(catalog_id=CATALOG, name="notify", args=args)

        assert excinfo.value.code == "INVALID_FUNCTION_CALL"
        assert text in str(excinfo.value)
        assert calls.pending_count == 0

    @pytest.mark.asyncio
    async def test_accepts_json_args_and_leaves_reserved_objects_alone(self) -> None:
        calls = RendererFunctionCalls()
        args = {
            "a": None,
            "b": True,
            "c": "text",
            "d": 1,
            "e": 1.5,
            "f": [1, "two", {"g": None}],
            "h": {"@path": "/x"},
            "i": {"@call": "now", "args": {}},
        }

        message, future = calls.call(catalog_id=CATALOG, name="notify", args=args)

        dumped = message.model_dump(by_alias=True, exclude_unset=True)
        assert dumped["callRendererFunction"]["callFunction"]["args"] == args
        future.cancel()

    @pytest.mark.asyncio
    async def test_checks_the_args_before_the_catalogs(self) -> None:
        calls = RendererFunctionCalls(catalogs=[_device_catalog()])

        with pytest.raises(A2uiRpcError) as excinfo:
            calls.call(catalog_id=CATALOG, name="formatLocal", args={"bad-key": 1})

        assert "bad-key" in str(excinfo.value)
        assert "may not call" not in str(excinfo.value)

    @pytest.mark.asyncio
    async def test_checks_the_name_identifier_before_the_catalogs(self) -> None:
        calls = RendererFunctionCalls(catalogs=[_device_catalog()])

        with pytest.raises(A2uiRpcError) as excinfo:
            calls.call(catalog_id="https://example.com/other.json", name="@index")

        assert excinfo.value.code == "INVALID_FUNCTION_CALL"

    @pytest.mark.asyncio
    async def test_no_limit_comes_only_from_the_instance(self) -> None:
        loop = asyncio.get_running_loop()
        delays: list[float] = []
        call_later = loop.call_later

        def recording_call_later(delay: float, *args: Any) -> asyncio.TimerHandle:
            delays.append(delay)
            return call_later(delay, *args)

        unlimited = RendererFunctionCalls(default_timeout=None)
        with pytest.MonkeyPatch.context() as patch:
            patch.setattr(loop, "call_later", recording_call_later)
            _, first = unlimited.call(catalog_id=CATALOG, name="now")
            _, second = unlimited.call(catalog_id=CATALOG, name="now", timeout=5)
            _, third = RendererFunctionCalls(default_timeout=7).call(
                catalog_id=CATALOG, name="now", timeout=None
            )

        assert delays == [5, 7]
        for future in (first, second, third):
            future.cancel()


def _device_catalog(catalog_id: str = CATALOG) -> Catalog:
    def fn(name: str, **kwargs: Any) -> FunctionApi:
        return FunctionApi(name, return_type="any", schema={"type": "object"}, **kwargs)

    return Catalog(
        catalog_id,
        ProtocolVersion.V1_0,
        functions=[
            fn("getLocation", allowed_callers="rendererOrAgent"),
            fn("notify", allowed_callers="agentOnly"),
            fn("formatLocal", allowed_callers="rendererOnly"),
            fn("unset", allowed_callers=None),
            fn(
                "vibrate",
                allowed_callers="rendererOrAgent",
                requires_user_activation=True,
            ),
        ],
    )


class TestCatalogChecks:

    @pytest.mark.asyncio
    @pytest.mark.parametrize("name", ["getLocation", "notify"])
    async def test_allows_functions_the_agent_may_call(self, name: str) -> None:
        calls = RendererFunctionCalls(catalogs=[_device_catalog()])

        message, future = calls.call(catalog_id=CATALOG, name=name)

        assert message.call_renderer_function.call_function.call == name
        assert calls.pending_count == 1
        future.cancel()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("catalog_id", "name", "code", "text"),
        [
            (
                "https://example.com/other.json",
                "getLocation",
                "UNKNOWN_FUNCTION",
                "isn't one",
            ),
            (
                CATALOG,
                "getAltitude",
                "UNKNOWN_FUNCTION",
                "no renderer function 'getAltitude'",
            ),
            (CATALOG, "formatLocal", "INVALID_FUNCTION_CALL", "may not call"),
            (CATALOG, "unset", "INVALID_FUNCTION_CALL", "may not call"),
            (CATALOG, "vibrate", "INVALID_FUNCTION_CALL", "user gesture"),
        ],
        ids=[
            "unknown-catalog",
            "unknown-function",
            "renderer-only",
            "unset",
            "activation",
        ],
    )
    async def test_rejects_before_registering(
        self, catalog_id: str, name: str, code: str, text: str
    ) -> None:
        calls = RendererFunctionCalls(catalogs=[_device_catalog()])
        loop = asyncio.get_running_loop()
        timers: list[Any] = []
        call_later = loop.call_later

        def recording_call_later(*args: Any) -> asyncio.TimerHandle:
            timers.append(args)
            return call_later(*args)

        with pytest.MonkeyPatch.context() as patch:
            patch.setattr(loop, "call_later", recording_call_later)
            with pytest.raises(A2uiRpcError) as excinfo:
                calls.call(catalog_id=catalog_id, name=name, function_call_id="c1")

        assert excinfo.value.code == code
        assert text in str(excinfo.value)
        assert excinfo.value.function_call_id == "c1"
        assert calls.pending_count == 0
        assert not calls.is_pending("c1")
        assert timers == []

    @pytest.mark.asyncio
    async def test_empty_name_is_checked_first(self) -> None:
        calls = RendererFunctionCalls(catalogs=[_device_catalog()])

        with pytest.raises(A2uiRpcError, match="needs a function name"):
            calls.call(catalog_id="https://example.com/other.json", name="")

    @pytest.mark.asyncio
    async def test_rejects_an_agent_function(self) -> None:
        catalog = _device_catalog().copy_with(
            agent_functions=[AgentFunction("lookUp", handler=lambda args: 1)]
        )
        calls = RendererFunctionCalls(catalogs=[catalog])

        with pytest.raises(A2uiRpcError) as excinfo:
            calls.call(catalog_id=CATALOG, name="lookUp")

        assert excinfo.value.code == "UNKNOWN_FUNCTION"
        assert "no renderer function 'lookUp'" in str(excinfo.value)
        assert calls.pending_count == 0

    @pytest.mark.asyncio
    async def test_rejects_an_agent_function_built_from_renderer_or_agent(
        self,
    ) -> None:
        source = _device_catalog()
        agent_function = AgentFunction.from_api(
            source.functions["getLocation"], lambda args: "here"
        )
        assert agent_function.allowed_callers == "rendererOrAgent"
        catalog = source.copy_with(agent_functions=[agent_function])
        calls = RendererFunctionCalls(catalogs=[catalog])

        with pytest.raises(A2uiRpcError) as excinfo:
            calls.call(catalog_id=CATALOG, name="getLocation", function_call_id="c1")

        assert excinfo.value.code == "UNKNOWN_FUNCTION"
        assert "no renderer function 'getLocation'" in str(excinfo.value)
        assert calls.pending_count == 0
        assert not calls.is_pending("c1")

    def test_two_catalogs_with_one_id_are_a_catalog_error(self) -> None:
        with pytest.raises(A2uiCatalogError, match="Duplicate catalog ID"):
            RendererFunctionCalls(catalogs=[_device_catalog(), _device_catalog()])

    @pytest.mark.asyncio
    async def test_without_catalogs_nothing_is_checked(self) -> None:
        calls = RendererFunctionCalls()

        _, future = calls.call(catalog_id="https://example.com/any.json", name="any")

        assert calls.pending_count == 1
        future.cancel()

    @pytest.mark.asyncio
    async def test_reads_an_iterable_once(self) -> None:
        calls = RendererFunctionCalls(catalogs=iter([_device_catalog()]))

        _, future = calls.call(catalog_id=CATALOG, name="getLocation")
        _, other = calls.call(catalog_id=CATALOG, name="getLocation")

        future.cancel()
        other.cancel()


class TestResolve:

    @pytest.mark.asyncio
    async def test_value_settles_the_matching_call(self) -> None:
        calls = RendererFunctionCalls()
        message_a, future_a = calls.call(catalog_id=CATALOG, name="a")
        message_b, future_b = calls.call(catalog_id=CATALOG, name="b")

        calls.resolve(_value(_id(message_b), [1920, 1080]))

        assert await _settle(future_b) == [1920, 1080]
        assert not future_a.done()
        assert calls.pending_count == 1
        future_a.cancel()

    @pytest.mark.asyncio
    async def test_accepts_the_schema_model(self) -> None:
        calls = RendererFunctionCalls()
        message, future = calls.call(catalog_id=CATALOG, name="now")

        calls.resolve(
            RendererFunctionResponseMessage(
                version="1.0",
                rendererFunctionResponse=FunctionResponse(
                    functionCallId=_id(message), value="12:00"
                ),
            )
        )

        assert await _settle(future) == "12:00"

    @pytest.mark.asyncio
    async def test_none_value(self) -> None:
        calls = RendererFunctionCalls()
        message, future = calls.call(catalog_id=CATALOG, name="clear")

        calls.resolve(_value(_id(message), None))

        assert await _settle(future) is None

    @pytest.mark.asyncio
    async def test_error_fails_the_call_with_the_renderer_code(self) -> None:
        calls = RendererFunctionCalls()
        message, future = calls.call(catalog_id=CATALOG, name="getResolution")

        calls.resolve(
            _failure(_id(message), "EXECUTION_ERROR", "Failed to query the screen.")
        )

        with pytest.raises(A2uiRpcError) as excinfo:
            await _settle(future)
        assert excinfo.value.code == "EXECUTION_ERROR"
        assert excinfo.value.function_call_id == _id(message)
        assert "getResolution" in str(excinfo.value)
        assert "Failed to query the screen." in str(excinfo.value)

    @pytest.mark.asyncio
    async def test_unknown_late_and_duplicate_responses_are_ignored(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        calls = RendererFunctionCalls()
        message, future = calls.call(catalog_id=CATALOG, name="now")
        call_id = _id(message)

        with caplog.at_level(logging.DEBUG, logger="a2ui.rpc"):
            assert calls.resolve(_value("never-sent", 0)) is False
            assert calls.resolve(_value(call_id, "first")) is True
            assert calls.resolve(_value(call_id, "duplicate")) is False
            assert calls.resolve(_failure(call_id, "EXECUTION_ERROR", "late")) is False

        assert await _settle(future) == "first"
        ignored = [r for r in caplog.records if "Ignoring" in r.getMessage()]
        assert len(ignored) == 3
        assert all(r.levelno == logging.DEBUG for r in ignored)

    @pytest.mark.asyncio
    async def test_malformed_response_is_logged_and_ignored(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        calls = RendererFunctionCalls()
        message, future = calls.call(catalog_id=CATALOG, name="now")

        with caplog.at_level(logging.WARNING, logger="a2ui.rpc"):
            assert not calls.resolve({"version": "1.0", "rendererFunctionResponse": {}})
            assert not calls.resolve({"something": "else"})

        assert len(caplog.records) == 2
        assert not future.done()
        future.cancel()

    @pytest.mark.asyncio
    async def test_malformed_response_to_a_pending_call_fails_it(self) -> None:
        calls = RendererFunctionCalls()
        message, future = calls.call(catalog_id=CATALOG, name="now")
        _, other = calls.call(catalog_id=CATALOG, name="other")

        # Both `value` and `error`, which the schema forbids.
        assert (
            calls.resolve({
                "version": "1.0",
                "rendererFunctionResponse": {
                    "functionCallId": _id(message),
                    "value": 1,
                    "error": {"code": "EXECUTION_ERROR", "message": "boom"},
                },
            })
            is True
        )

        with pytest.raises(A2uiRpcError) as excinfo:
            await _settle(future)
        assert excinfo.value.code == "UNKNOWN_ERROR"
        assert excinfo.value.function_call_id == _id(message)
        assert "Malformed rendererFunctionResponse" in str(excinfo.value)
        assert not other.done()
        assert calls.pending_count == 1
        other.cancel()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "version, body, extra",
        [
            ("1.0", {"error": None}, {}),
            ("1.0", {}, {}),
            ("1.0", {"value": 1, "extra": 2}, {}),
            ("1.0", {"value": 1}, {"extra": 2}),
            ("0.9", {"value": 1}, {}),
            ("v1.0", {"value": 1}, {}),
        ],
        ids=[
            "null-error",
            "neither-value-nor-error",
            "extra-body-key",
            "extra-message-key",
            "version-0.9",
            "version-v1.0",
        ],
    )
    async def test_malformed_response_shapes_fail_the_pending_call(
        self, version: str, body: dict[str, Any], extra: dict[str, Any]
    ) -> None:
        calls = RendererFunctionCalls()
        message, future = calls.call(catalog_id=CATALOG, name="now")

        response = {
            "version": version,
            "rendererFunctionResponse": {"functionCallId": _id(message), **body},
            **extra,
        }
        assert calls.resolve(response) is True

        with pytest.raises(A2uiRpcError) as excinfo:
            await _settle(future)
        assert excinfo.value.code == "UNKNOWN_ERROR"
        assert calls.pending_count == 0

    @pytest.mark.asyncio
    async def test_malformed_response_is_logged_without_its_payload(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        calls = RendererFunctionCalls()
        message, future = calls.call(catalog_id=CATALOG, name="now")

        with caplog.at_level(logging.WARNING, logger="a2ui.rpc"):
            calls.resolve({
                "version": "1.0",
                "rendererFunctionResponse": {
                    "functionCallId": _id(message),
                    "value": 1,
                    "secret": "hunter2",
                },
            })

        assert "Ignoring a malformed rendererFunctionResponse" in caplog.text
        assert "hunter2" not in caplog.text
        with pytest.raises(A2uiRpcError):
            await _settle(future)

    @pytest.mark.asyncio
    async def test_malformed_response_to_an_unknown_call_is_ignored(self) -> None:
        calls = RendererFunctionCalls()
        _, future = calls.call(catalog_id=CATALOG, name="now")

        assert (
            calls.resolve({
                "version": "1.0",
                "rendererFunctionResponse": {"functionCallId": "unknown"},
            })
            is False
        )

        assert not future.done()
        future.cancel()

    @pytest.mark.asyncio
    async def test_is_pending(self) -> None:
        calls = RendererFunctionCalls()
        message, future = calls.call(catalog_id=CATALOG, name="now")

        assert calls.is_pending(_id(message))
        assert not calls.is_pending("unknown")
        calls.resolve(_value(_id(message), 1))
        assert await _settle(future) == 1
        assert not calls.is_pending(_id(message))

    @pytest.mark.asyncio
    async def test_resolve_is_the_processor_callback(self) -> None:
        calls = RendererFunctionCalls()
        processor = RendererToAgentMessageProcessor(
            [], on_renderer_function_response=calls.resolve
        )
        message, future = calls.call(catalog_id=CATALOG, name="now")

        result = await processor.process_message(_value(_id(message), "Paris"))

        assert result.handled
        assert result.replies == []
        assert await _settle(future) == "Paris"

    @pytest.mark.asyncio
    async def test_processor_declines_responses_it_does_not_own(self) -> None:
        calls = RendererFunctionCalls()
        processor = RendererToAgentMessageProcessor(
            [], on_renderer_function_response=calls.resolve
        )
        message, future = calls.call(catalog_id=CATALOG, name="now")
        assert (await processor.process_message(_value(_id(message), 1))).handled

        for call_id in ("unknown", _id(message)):  # unknown, then duplicate
            result = await processor.process_message(_value(call_id, 2))
            assert not result.handled
            assert result.replies == []
        assert await _settle(future) == 1

    def test_response_before_any_call_is_ignored(self) -> None:
        assert RendererFunctionCalls().resolve(_value("c1", 1)) is False

    @pytest.mark.asyncio
    async def test_resolve_from_another_thread(self) -> None:
        calls = RendererFunctionCalls()
        message, future = calls.call(catalog_id=CATALOG, name="now")

        thread = threading.Thread(
            target=calls.resolve, args=(_value(_id(message), "from thread"),)
        )
        thread.start()
        thread.join()

        assert await _settle(future) == "from thread"
        assert calls.pending_count == 0


class TestTimeouts:

    def test_default_timeout_matches_the_renderer_side(self) -> None:
        assert DEFAULT_RENDERER_CALL_TIMEOUT == 30.0

    @pytest.mark.asyncio
    async def test_timeout_fails_the_call_and_forgets_it(self) -> None:
        calls = RendererFunctionCalls(default_timeout=0.01)
        message, future = calls.call(catalog_id=CATALOG, name="slow")

        with pytest.raises(A2uiRpcError) as excinfo:
            await _settle(future)

        assert excinfo.value.code == "TIMEOUT"
        assert calls.pending_count == 0
        calls.resolve(_value(_id(message), "too late"))

    @pytest.mark.asyncio
    async def test_per_call_timeout(self) -> None:
        calls = RendererFunctionCalls()
        _, future = calls.call(catalog_id=CATALOG, name="slow", timeout=0.01)

        with pytest.raises(A2uiRpcError) as excinfo:
            await _settle(future)
        assert excinfo.value.code == "TIMEOUT"

    @pytest.mark.asyncio
    async def test_settling_cancels_the_timer(self) -> None:
        loop = asyncio.get_running_loop()
        timers: list[asyncio.TimerHandle] = []
        call_later = loop.call_later

        def recording_call_later(*args: Any) -> asyncio.TimerHandle:
            timer = call_later(*args)
            timers.append(timer)
            return timer

        calls = RendererFunctionCalls(default_timeout=0.01)
        with pytest.MonkeyPatch.context() as patch:
            patch.setattr(loop, "call_later", recording_call_later)
            message, future = calls.call(catalog_id=CATALOG, name="now")
        (timer,) = timers
        calls.resolve(_value(_id(message), 1))

        assert await _settle(future) == 1
        assert timer.cancelled()
        await asyncio.sleep(0.03)
        assert future.result() == 1

    @pytest.mark.asyncio
    async def test_no_timeout(self) -> None:
        calls = RendererFunctionCalls(default_timeout=None)
        message, future = calls.call(catalog_id=CATALOG, name="now")

        await asyncio.sleep(0.02)
        assert not future.done()
        calls.resolve(_value(_id(message), 1))
        assert await _settle(future) == 1


class TestCancellationAndDisposal:

    @pytest.mark.asyncio
    async def test_cancelling_the_future_forgets_the_call(self) -> None:
        calls = RendererFunctionCalls(default_timeout=0.01)
        message, future = calls.call(catalog_id=CATALOG, name="now")

        future.cancel()
        await asyncio.sleep(0)

        assert calls.pending_count == 0
        calls.resolve(_value(_id(message), "ignored"))
        await asyncio.sleep(0.03)
        assert future.cancelled()

    @pytest.mark.asyncio
    async def test_cancelling_the_awaiting_task_forgets_the_call(self) -> None:
        calls = RendererFunctionCalls()
        _, future = calls.call(catalog_id=CATALOG, name="now")
        waiter = asyncio.ensure_future(future)
        await asyncio.sleep(0)

        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
        await asyncio.sleep(0)

        assert calls.pending_count == 0

    @pytest.mark.asyncio
    async def test_dispose_fails_pending_calls_and_refuses_new_ones(self) -> None:
        calls = RendererFunctionCalls()
        message, future = calls.call(catalog_id=CATALOG, name="now")

        calls.dispose("the session ended")
        calls.dispose("again")

        with pytest.raises(A2uiRpcError) as excinfo:
            await _settle(future)
        assert excinfo.value.code == "CANCELLED"
        assert "the session ended" in str(excinfo.value)
        assert calls.disposed
        assert calls.pending_count == 0
        with pytest.raises(A2uiRpcError) as refused:
            calls.call(catalog_id=CATALOG, name="now")
        assert refused.value.code == "DISPOSED"
        calls.resolve(_value(_id(message), "ignored"))

    @pytest.mark.asyncio
    async def test_dispose_from_another_thread(self) -> None:
        calls = RendererFunctionCalls()
        _, future = calls.call(catalog_id=CATALOG, name="now")

        thread = threading.Thread(target=calls.dispose, args=("closed",))
        thread.start()
        thread.join()

        with pytest.raises(A2uiRpcError) as excinfo:
            await _settle(future)
        assert excinfo.value.code == "CANCELLED"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("malformed", [False, True])
    async def test_response_after_dispose_from_another_thread_is_ignored(
        self, malformed: bool
    ) -> None:
        calls = RendererFunctionCalls()
        message, future = calls.call(catalog_id=CATALOG, name="now")
        call_id = _id(message)

        # `dispose` hands `_fail_all` to the loop, which hasn't run it yet.
        thread = threading.Thread(target=calls.dispose, args=("closed",))
        thread.start()
        thread.join()
        response = (
            {"version": "1.0", "rendererFunctionResponse": {"functionCallId": call_id}}
            if malformed
            else _value(call_id, "too late")
        )

        assert not calls.is_pending(call_id)
        assert calls.resolve(response) is False
        with pytest.raises(A2uiRpcError) as excinfo:
            await _settle(future)
        assert excinfo.value.code == "CANCELLED"

    def test_dispose_after_the_loop_closes_does_not_raise(self) -> None:
        loop = asyncio.new_event_loop()
        calls = RendererFunctionCalls()

        async def start() -> asyncio.Future[Any]:
            _, future = calls.call(catalog_id=CATALOG, name="now")
            # A callback makes failing the future schedule work on the loop,
            # which raises once the loop is closed.
            future.add_done_callback(lambda _: None)
            return future

        future = loop.run_until_complete(start())
        loop.close()

        thread = threading.Thread(target=calls.dispose, args=("closed",))
        thread.start()
        thread.join()

        assert calls.disposed
        assert calls.pending_count == 0
        del future

    def test_dispose_when_the_loop_closes_during_the_call(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        loop = asyncio.new_event_loop()
        calls = RendererFunctionCalls()

        async def start() -> asyncio.Future[Any]:
            _, future = calls.call(catalog_id=CATALOG, name="now")
            return future

        future = loop.run_until_complete(start())

        def closed(*args: Any) -> None:
            raise RuntimeError("Event loop is closed")

        # The loop is open when `dispose` checks it, then closes before the
        # handoff, as during teardown on another thread.
        monkeypatch.setattr(loop, "call_soon_threadsafe", closed)
        thread = threading.Thread(target=calls.dispose, args=("closed",))
        thread.start()
        thread.join()

        assert calls.pending_count == 0
        assert future.done()
        assert isinstance(future.exception(), A2uiRpcError)
        loop.close()

    @pytest.mark.asyncio
    async def test_async_with_disposes(self) -> None:
        async with RendererFunctionCalls() as calls:
            _, future = calls.call(catalog_id=CATALOG, name="now")

        assert calls.disposed
        with pytest.raises(A2uiRpcError) as excinfo:
            await _settle(future)
        assert excinfo.value.code == "CANCELLED"
