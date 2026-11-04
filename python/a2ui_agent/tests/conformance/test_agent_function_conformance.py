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
`_handler` turns into a handler. Every message goes through
`RendererToAgentMessageProcessor`.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
import os
import re
from typing import Any

import pytest

from a2ui.core import (
    A2uiCatalogError,
    A2uiRpcError,
    A2uiValidationError,
    AgentFunction,
    AgentFunctionContext,
    CatalogApi,
)
from a2ui.core.catalog import FunctionApi
from a2ui.processor import InMemoryCatalogProvider
from a2ui.rpc import RendererToAgentMessageProcessor
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
            if failure.get("validation"):
                raise A2uiValidationError(failure["message"])
            raise RuntimeError(failure["message"])

        return raises
    raise ValueError(f"Unknown agent function behavior: {behavior}")


def _agent_function(
    key: str, declaration: Mapping[str, Any], catalog: CatalogApi
) -> AgentFunction:
    """The agent function a declaration describes, for `catalog`."""
    name = declaration.get("name", key)
    handler = _handler(declaration["behavior"])
    if declaration.get("from_api"):
        api = catalog.functions.get(name) or FunctionApi(
            name,
            return_type=declaration.get("returnType", "any"),
            schema=declaration.get("args"),
            description=declaration.get("description"),
        )
        return AgentFunction.from_api(api, handler)
    return AgentFunction(
        name,
        handler=handler,
        return_type=declaration["returnType"],
        schema=declaration["args"],
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
            _agent_function(key, declaration, catalog)
            for key, declaration in entry.get("agent_functions", {}).items()
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
    processor = RendererToAgentMessageProcessor(
        [_catalog(entry) for entry in args["catalogs"]]
    )

    if "expect_error" in case:
        with pytest.raises(Exception) as excinfo:
            asyncio.run(processor.process_message(args["message"]))
        _assert_error_matches(excinfo.value, case["expect_error"])
        return

    result = asyncio.run(processor.process_message(args["message"]))
    assert result.handled
    assert len(result.replies) == 1, result.replies
    dumped = result.replies[0].model_dump(by_alias=True, exclude_unset=True)
    assert set(dumped) == {"version", "agentFunctionResponse"}, dumped
    assert dumped["version"] == "1.0"
    response = dumped["agentFunctionResponse"]
    expected = case["expect"]
    assert response["functionCallId"] == expected["functionCallId"]
    if "error" in expected:
        assert set(response) == {"functionCallId", "error"}, response
        error = response["error"]
        assert set(error) == {"code", "message"}, error
        assert isinstance(error["message"], str) and error["message"], error
        assert error["code"] == expected["error"]["code"], error
        if "message" in expected["error"]:
            assert expected["error"]["message"] in error["message"], error
    else:
        assert set(response) == {"functionCallId", "value"}, response
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


_CALLBACK_OPTIONS = {
    "action": "on_action",
    "error": "on_error",
    "rendererFunctionResponse": "on_renderer_function_response",
}


def _assert_reply_matches(
    actual: Any, expected: Any, path: tuple[str, ...] = ()
) -> None:
    """Compares a reply exactly, but an expected `error.message` as a substring."""
    if isinstance(expected, Mapping):
        assert isinstance(actual, Mapping), actual
        if path == ("agentFunctionResponse", "error"):
            assert set(actual) == {"code", "message"}, actual
            assert isinstance(actual["message"], str) and actual["message"], actual
            assert actual["code"] == expected["code"], (actual, expected)
            if "message" in expected:
                assert expected["message"] in actual["message"], (actual, expected)
            return
        assert set(actual) == set(expected), (actual, expected)
        for key, value in expected.items():
            _assert_reply_matches(actual[key], value, (*path, key))
    else:
        assert actual == expected, (actual, expected)


def _run_process(case: Mapping[str, Any]) -> None:
    args = case["args"]
    received: list[tuple[str, Any]] = []

    def record(kind: str, declines: bool) -> Callable[[Any], bool]:
        def callback(message: Any) -> bool:
            received.append((kind, message))
            return not declines

        return callback

    callbacks: dict[str, Callable[[Any], bool]] = {}
    for entry in args.get("callbacks", []):
        kind = entry if isinstance(entry, str) else entry["kind"]
        declines = not isinstance(entry, str) and entry.get("declines", False)
        callbacks[_CALLBACK_OPTIONS[kind]] = record(kind, declines)
    entries = args.get("catalogs") or ([args["catalog"]] if "catalog" in args else [])

    def build() -> RendererToAgentMessageProcessor:
        return RendererToAgentMessageProcessor(
            [_catalog(entry) for entry in entries], **callbacks
        )

    if "expect_error" in case:
        with pytest.raises(Exception) as excinfo:
            asyncio.run(build().process_message(args["message"]))
        _assert_error_matches(excinfo.value, case["expect_error"])
        assert received == []
        return

    processor = build()
    result = asyncio.run(processor.process_message(args["message"]))
    expected = case["expect"]
    assert result.handled is expected["handled"]
    replies = [
        reply.model_dump(by_alias=True, exclude_unset=True) for reply in result.replies
    ]
    expected_replies = expected.get("replies", [])
    assert len(replies) == len(expected_replies), replies
    for reply, expected_reply in zip(replies, expected_replies):
        _assert_reply_matches(reply, expected_reply)
    if "callback" in expected:
        assert len(received) == 1, received
        kind, message = received[0]
        assert kind == expected["callback"]["kind"]
        assert (
            message.model_dump(by_alias=True, exclude_unset=True)
            == expected["callback"]["message"]
        )
    else:
        assert received == []


RUNNERS: dict[str, Callable[[Mapping[str, Any]], None]] = {
    "declare_agent_functions": _run_declare,
    "handle_agent_function": _run_handle,
    "validate_payload": _run_validate,
    "process_renderer_message": _run_process,
}


@pytest.mark.parametrize("case", CASES)
def test_agent_function_conformance(case: Mapping[str, Any]) -> None:
    action = case["action"]
    runner = RUNNERS.get(action)
    if runner is None:
        raise ValueError(f"Unhandled conformance action: {action}")
    runner(case)
