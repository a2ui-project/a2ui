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

"""Runs the shared `conformance/agent/agent_functions.yaml` suite.

A case declares each agent function with a scripted behaviour, which
`_handler` turns into a handler. The renderer call cases run on
`_FakeClockLoop`, an event loop whose clock moves only when a case's
`advance_ms` step moves it, so their timeouts don't depend on real time.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
import os
import re
import selectors
from typing import Any

import pytest

from a2ui.core import (
    A2uiCatalogError,
    A2uiRpcError,
    A2uiValidationError,
    CatalogApi,
)
from a2ui.core.catalog import AgentFunction, AgentFunctionContext
from a2ui.processor import InMemoryCatalogProvider
from a2ui.rpc import AgentFunctionRegistry, RendererFunctionCalls
from a2ui.utils import validate_payload

from .conformance_helpers import load_conformance_json, load_conformance_yaml

SUITE = "agent/agent_functions.yaml"

CATEGORY_TO_EXCEPTION: dict[str, type[Exception]] = {
    "CatalogError": A2uiCatalogError,
    "ValidationError": A2uiValidationError,
}

AgentFunctionHandler = Callable[[dict[str, Any], AgentFunctionContext], Any]


def _load_cases() -> list[Any]:
    cases = load_conformance_yaml(SUITE)
    return [pytest.param(case, id=case["name"]) for case in cases]


CASES = _load_cases()


def test_suite_is_not_empty() -> None:
    assert CASES


def _document(ref: str | Mapping[str, Any]) -> tuple[dict[str, Any], str]:
    """The catalog document a case names, and the id to use if it has none."""
    if isinstance(ref, str):
        return load_conformance_json(ref), os.path.basename(ref).removesuffix(".json")
    return dict(ref), "inline"


def _handler(behavior: Mapping[str, Any]) -> AgentFunctionHandler:
    """The handler that carries out a case's scripted behaviour."""
    if "returns" in behavior:
        value = behavior["returns"]

        async def returns(args: dict[str, Any], context: AgentFunctionContext) -> Any:
            return value

        return returns
    if behavior.get("returns_args"):

        async def returns_args(
            args: dict[str, Any], context: AgentFunctionContext
        ) -> Any:
            return args

        return returns_args
    if behavior.get("returns_context"):

        async def returns_context(
            args: dict[str, Any], context: AgentFunctionContext
        ) -> Any:
            return {
                "catalogId": context.catalog_id,
                "surfaceId": context.surface_id,
                "functionCallId": context.function_call_id,
            }

        return returns_context
    if "raises" in behavior:
        failure = behavior["raises"]

        async def raises(args: dict[str, Any], context: AgentFunctionContext) -> Any:
            if "code" in failure:
                raise A2uiRpcError(failure["message"], code=failure["code"])
            raise RuntimeError(failure["message"])

        return raises
    raise ValueError(f"Unknown agent function behavior: {behavior}")


def _agent_function(name: str, declaration: Mapping[str, Any]) -> AgentFunction:
    return AgentFunction(
        name,
        handler=_handler(declaration["behavior"]),
        return_type=declaration.get("returnType", "any"),
        schema=declaration["args"],
        allowed_callers=declaration.get("allowedCallers", "rendererOnly"),
        description=declaration.get("description"),
    )


def _catalog(entry: Mapping[str, Any]) -> CatalogApi:
    """The catalog a case's entry describes, with its agent functions."""
    document, fallback_id = _document(entry["catalog"])
    catalog = InMemoryCatalogProvider(
        document,
        protocol_version=None if "protocolVersion" in document else "1.0",
        catalog_id=None if "catalogId" in document else fallback_id,
    ).load()
    return catalog.copy_with(
        agent_functions=[
            _agent_function(name, declaration)
            for name, declaration in entry.get("agent_functions", {}).items()
        ]
    )


def _assert_error_matches(error: BaseException, expected: Mapping[str, Any]) -> None:
    if "category" in expected:
        assert isinstance(error, CATEGORY_TO_EXCEPTION[expected["category"]]), error
    if "code" in expected:
        assert getattr(error, "code", None) == expected["code"], error
    if "message" in expected:
        assert re.search(re.escape(expected["message"]), str(error)), error


def _run_declare(case: Mapping[str, Any]) -> None:
    entry = case["args"]["catalog"]
    if "expect_error" in case:
        with pytest.raises(Exception) as excinfo:
            _catalog(entry)
        _assert_error_matches(excinfo.value, case["expect_error"])
        return
    catalog = _catalog(entry)
    expected = case["expect"]
    assert sorted(catalog.functions) == sorted(expected["functions"])
    assert sorted(catalog.agent_functions) == sorted(expected["agent_functions"])
    document_functions = catalog.to_json().get("functions", {})
    assert sorted(document_functions) == sorted(expected["document_functions"])


def _run_handle(case: Mapping[str, Any]) -> None:
    args = case["args"]
    registry = AgentFunctionRegistry([_catalog(entry) for entry in args["catalogs"]])

    if "expect_error" in case:
        with pytest.raises(Exception) as excinfo:
            asyncio.run(registry.handle(args["message"]))
        _assert_error_matches(excinfo.value, case["expect_error"])
        return

    message = asyncio.run(registry.handle(args["message"]))
    dumped = message.model_dump(by_alias=True, exclude_unset=True)
    assert dumped["version"] == "1.0"
    response = dumped["agentFunctionResponse"]
    expected = case["expect"]
    assert response["functionCallId"] == expected["functionCallId"]
    if "error" in expected:
        assert "value" not in response, response
        error = response["error"]
        assert error["code"] == expected["error"]["code"], error
        if "message" in expected["error"]:
            assert expected["error"]["message"] in error["message"], error
    else:
        assert "error" not in response, response
        assert "value" in response, response
        assert response["value"] == expected["value"]


def _run_validate(case: Mapping[str, Any]) -> None:
    args = case["args"]
    catalogs = [_catalog(entry) for entry in args["catalogs"]]
    if "expect_error" in case:
        with pytest.raises(Exception) as excinfo:
            validate_payload(catalogs, args["messages"])
        _assert_error_matches(excinfo.value, case["expect_error"])
        return
    assert case["expect_valid"] is True
    validate_payload(catalogs, args["messages"])


class _FakeClockLoop(asyncio.SelectorEventLoop):
    """An event loop whose clock moves only when `advance` moves it."""

    def __init__(self) -> None:
        super().__init__(selectors.DefaultSelector())
        self._now_ms = 0

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


async def _run_calls_on_loop(case: Mapping[str, Any], loop: _FakeClockLoop) -> None:
    args = case.get("args", {})
    options: dict[str, Any] = {}
    if "default_timeout_ms" in args:
        timeout_ms = args["default_timeout_ms"]
        options["default_timeout"] = None if timeout_ms is None else timeout_ms / 1000
    if "max_pending" in args:
        options["max_pending"] = args["max_pending"]
    calls = RendererFunctionCalls(**options)
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
            calls.resolve({"version": "1.0", "rendererFunctionResponse": response})
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
    for future in futures.values():
        if not future.cancelled():
            future.exception()


def _run_calls(case: Mapping[str, Any]) -> None:
    loop = _FakeClockLoop()
    try:
        loop.run_until_complete(_run_calls_on_loop(case, loop))
    finally:
        loop.close()


RUNNERS: dict[str, Callable[[Mapping[str, Any]], None]] = {
    "declare_agent_functions": _run_declare,
    "handle_agent_function": _run_handle,
    "validate_payload": _run_validate,
    "call_renderer_function": _run_calls,
}


@pytest.mark.parametrize("case", CASES)
def test_agent_function_conformance(case: Mapping[str, Any]) -> None:
    action = case["action"]
    runner = RUNNERS.get(action)
    if runner is None:
        raise ValueError(f"Unhandled conformance action: {action}")
    runner(case)
