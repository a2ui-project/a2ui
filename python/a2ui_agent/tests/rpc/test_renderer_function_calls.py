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

from a2ui.core import A2uiRpcError
from a2ui.core.schema.v1_0 import FunctionResponse, RendererFunctionResponseMessage
from a2ui.rpc import DEFAULT_RENDERER_CALL_TIMEOUT, RendererFunctionCalls

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
            RendererFunctionCalls(default_timeout=0)
        with pytest.raises(ValueError):
            RendererFunctionCalls(max_pending=0)


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
            calls.resolve(_value("never-sent", 0))
            calls.resolve(_value(call_id, "first"))
            calls.resolve(_value(call_id, "duplicate"))
            calls.resolve(_failure(call_id, "EXECUTION_ERROR", "late"))

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
            calls.resolve({"version": "1.0", "rendererFunctionResponse": {}})
            calls.resolve({"something": "else"})

        assert len(caplog.records) == 2
        assert not future.done()
        future.cancel()

    def test_response_before_any_call_is_ignored(self) -> None:
        RendererFunctionCalls().resolve(_value("c1", 1))

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
        calls = RendererFunctionCalls(default_timeout=0.01)
        message, future = calls.call(catalog_id=CATALOG, name="now")
        calls.resolve(_value(_id(message), 1))

        assert await _settle(future) == 1
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
