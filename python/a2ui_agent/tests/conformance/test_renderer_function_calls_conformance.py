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

"""Runs the shared `conformance/agent/renderer_function_calls.yaml` suite.

The cases run on `_FakeClockLoop`, an event loop whose clock moves only when a
case's `advance_ms` step moves it, so their timeouts don't depend on real
time. Responses go through a `RendererToAgentMessageProcessor` whose
`on_renderer_function_response` callback is `RendererFunctionCalls.resolve`.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
import re
import selectors
from typing import Any

import pytest

from a2ui.core import A2uiCatalogError, A2uiRpcError, Catalog, CatalogApi
from a2ui.core.catalog import FunctionApi
from a2ui.core.schema import ProtocolVersion
from a2ui.rpc import RendererFunctionCalls, RendererToAgentMessageProcessor

from .conformance_helpers import load_conformance_yaml

SUITE = "agent/renderer_function_calls.yaml"

CASES = [pytest.param(case, id=case["name"]) for case in load_conformance_yaml(SUITE)]


def test_suite_is_not_empty() -> None:
    assert CASES


CATEGORY_TO_EXCEPTION: dict[str, type[Exception]] = {"CatalogError": A2uiCatalogError}


def _assert_error_matches(error: BaseException, expected: Mapping[str, Any]) -> None:
    if "category" in expected:
        assert isinstance(error, CATEGORY_TO_EXCEPTION[expected["category"]]), error
    if "code" in expected:
        assert getattr(error, "code", None) == expected["code"], error
    if "message" in expected:
        assert re.search(re.escape(expected["message"]), str(error)), error


class _FakeClockLoop(asyncio.SelectorEventLoop):
    """An event loop whose clock moves only when `advance` moves it."""

    def __init__(self) -> None:
        # Set before the base constructor, which may already read the clock.
        self._now_ms = 0
        super().__init__(selectors.DefaultSelector())

    def time(self) -> float:
        return self._now_ms / 1000

    def advance(self, ms: int) -> None:
        self._now_ms += ms


async def _let_pending_work_run() -> None:
    for _ in range(5):
        await asyncio.sleep(0)


def _call_state(future: asyncio.Future[Any]) -> Any:
    """A call's state in the suite's vocabulary."""
    if not future.done():
        return "pending"
    error = future.exception()
    if error is None:
        return {"value": future.result()}
    assert isinstance(error, A2uiRpcError), error
    return {"error": {"code": error.code, "message": str(error)}}


def _assert_call_state(label: str, actual: Any, expected: Any) -> None:
    if expected == "pending" or actual == "pending":
        assert actual == expected, f"call {label}: {actual}"
        return
    if "value" in expected:
        assert actual == expected, f"call {label}: {actual}"
        return
    assert "error" in actual, f"call {label}: {actual}"
    assert actual["error"]["code"] == expected["error"]["code"], f"call {label}"
    if "message" in expected["error"]:
        assert expected["error"]["message"] in actual["error"]["message"]


def _catalog(entry: Mapping[str, Any]) -> CatalogApi:
    """Builds a `RendererCallCatalog` entry in code, as the suite requires."""
    functions = []
    for name, spec in entry["functions"].items():
        kwargs: dict[str, Any] = {"allowed_callers": spec.get("allowedCallers")}
        if "requiresUserActivation" in spec:
            kwargs["requires_user_activation"] = spec["requiresUserActivation"]
        functions.append(
            FunctionApi(name, return_type="any", schema={"type": "object"}, **kwargs)
        )
    return Catalog(entry["catalogId"], ProtocolVersion.V1_0, functions=functions)


async def _run_calls_on_loop(case: Mapping[str, Any], loop: _FakeClockLoop) -> None:
    args = case.get("args", {})
    options: dict[str, Any] = {}
    if "catalogs" in args:
        options["catalogs"] = [_catalog(entry) for entry in args["catalogs"]]
    if "expect_error" in case:
        with pytest.raises(Exception) as excinfo:
            RendererFunctionCalls(**options)
        _assert_error_matches(excinfo.value, case["expect_error"])
        return
    if "default_timeout_ms" in args:
        timeout_ms = args["default_timeout_ms"]
        options["default_timeout"] = None if timeout_ms is None else timeout_ms / 1000
    if "max_pending" in args:
        options["max_pending"] = args["max_pending"]
    calls = RendererFunctionCalls(**options)
    # Responses reach the calls the way an agent receives them: through the
    # processor, with `resolve` as its callback.
    processor = RendererToAgentMessageProcessor(
        [], on_renderer_function_response=calls.resolve
    )
    futures: dict[str, asyncio.Future[Any]] = {}
    call_ids: dict[str, str] = {}

    for index, step in enumerate(case["steps"]):
        where = f"step {index}"
        if "call" in step:
            spec = step["call"]
            kwargs: dict[str, Any] = {
                "catalog_id": spec["catalogId"],
                "name": spec["name"],
            }
            if "args" in spec:
                kwargs["args"] = spec["args"]
            if "surfaceId" in spec:
                kwargs["surface_id"] = spec["surfaceId"]
            if "timeout_ms" in spec:
                kwargs["timeout"] = spec["timeout_ms"] / 1000
            if "functionCallId" in spec:
                kwargs["function_call_id"] = spec["functionCallId"]
            if "expect_error" in step:
                with pytest.raises(A2uiRpcError) as excinfo:
                    calls.call(**kwargs)
                _assert_error_matches(excinfo.value, step["expect_error"])
            else:
                message, future = calls.call(**kwargs)
                dumped = message.model_dump(by_alias=True, exclude_unset=True)
                body = dumped["callRendererFunction"]
                call_id = body.pop("functionCallId")
                assert isinstance(call_id, str) and call_id, where
                assert call_id not in call_ids.values(), f"{where}: reused {call_id}"
                call_ids[spec["label"]] = call_id
                futures[spec["label"]] = future
                if "expect_message" in step:
                    assert dumped == step["expect_message"], where
        elif "respond" in step:
            spec = step["respond"]
            call_id = (
                call_ids[spec["call"]] if "call" in spec else spec["functionCallId"]
            )
            response: dict[str, Any] = {"functionCallId": call_id}
            if "error" in spec:
                response["error"] = spec["error"]
            else:
                response["value"] = spec["value"]
            owned = calls.is_pending(call_id)
            result = await processor.process_message(
                {"version": "1.0", "rendererFunctionResponse": response}
            )
            # `resolve` declines a response to a call that isn't pending.
            assert result.handled == owned and not result.replies, where
        elif "advance_ms" in step:
            loop.advance(step["advance_ms"])
        elif "dispose" in step:
            reason = step["dispose"].get("reason")
            if reason is None:
                calls.dispose()
            else:
                calls.dispose(reason)
        else:
            raise ValueError(f"{where}: unknown step {step}")

        await _let_pending_work_run()
        for label, expected in step.get("expect_calls", {}).items():
            _assert_call_state(label, _call_state(futures[label]), expected)
        if "expect_pending_count" in step:
            assert calls.pending_count == step["expect_pending_count"], where

    calls.dispose()
    await _let_pending_work_run()
    # Reads each failure, so asyncio doesn't log "exception was never
    # retrieved". `dispose` settles every pending call, but a future that is
    # somehow still pending is skipped rather than raising InvalidStateError.
    for future in futures.values():
        if future.done() and not future.cancelled():
            future.exception()


def _run_calls(case: Mapping[str, Any]) -> None:
    loop = _FakeClockLoop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(_run_calls_on_loop(case, loop))
    finally:
        loop.close()
        asyncio.set_event_loop(None)


@pytest.mark.parametrize("case", CASES)
def test_renderer_function_calls_conformance(case: Mapping[str, Any]) -> None:
    action = case["action"]
    if action != "call_renderer_function":
        raise ValueError(f"Unhandled conformance action: {action}")
    _run_calls(case)
