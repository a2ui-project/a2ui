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

"""Conformance harness for `conformance/extensions/adk/adk_extensions.yaml`."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
import copy
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

from google.adk.events.event import Event
from google.adk.sessions.session import Session
from google.genai import types as genai_types
import pytest

from a2ui.a2a import create_a2ui_part
from a2ui.adk import (
    A2uiEventConverter,
    A2uiSubagentMap,
    SendA2uiToClientToolset,
    SurfaceIdAlreadyExistsError,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
from a2ui.processor import A2uiRequestProcessor
from .conformance_helpers import load_conformance_yaml

SUITE = "extensions/adk/adk_extensions.yaml"

# Actions or `<action>.<key path>` entries that this harness does not implement,
# mapped to the reason each matching case is recorded as skipped.
UNSUPPORTED: dict[str, str] = {}

# `<suite>#<case>` entries that exercise a known gap, executed strictly as xfail.
EXPECTED_FAILURES: dict[str, str] = {}

_CASE_METADATA_KEYS: frozenset[str] = frozenset({
    "name",
    "description",
    "features",
})

_SUBAGENT_EVENT_ARG_KEYS: frozenset[str] = frozenset({
    "subagent",
    "surfaceId",
    "state",
    "message",
})

_CONVERTER_EVENT_ARG_KEYS: frozenset[str] = frozenset({
    "errorCode",
    "errorMessage",
    "contentText",
    "hasCatalog",
})

_KNOWN_KEYS: dict[str, frozenset[str]] = {
    "execute_tool.case": _CASE_METADATA_KEYS | frozenset({"action", "args", "expect"}),
    "execute_tool.args": frozenset({"a2uiJson", "wrongArg"}),
    "execute_tool.expect": frozenset({
        "success",
        "containsValidatedJson",
        "errorContains",
    }),
    "convert_event.subagent_case": (
        _CASE_METADATA_KEYS | frozenset({"action", "args", "expect", "expectError"})
    ),
    "convert_event.subagent_args": _SUBAGENT_EVENT_ARG_KEYS,
    "convert_event.subagent_expect": frozenset({"stateDelta"}),
    "convert_event.expect_error": frozenset({"category", "message"}),
    "convert_event.converter_case": (
        _CASE_METADATA_KEYS | frozenset({"action", "args", "expect", "expectEmpty"})
    ),
    "convert_event.converter_args": _CONVERTER_EVENT_ARG_KEYS,
    "convert_event.converter_expect": frozenset({"type", "state", "message"}),
    "data_model.case": _CASE_METADATA_KEYS | frozenset({"action", "args", "expect"}),
    "data_model.args": frozenset({"subagent", "state", "clientDataModel"}),
    "data_model.expect": frozenset({"clientDataModel"}),
}

_CURRENT_CASE_KEY: str = ""


def _assert_known_keys(
    obj: Mapping[str, Any],
    allowed: frozenset[str],
    where: str,
    case_key: str | None = None,
) -> None:
    target = case_key or _CURRENT_CASE_KEY or str(obj.get("name", "<unknown>"))
    for key in obj:
        if key not in allowed:
            pytest.fail(f"Unknown {where} '{key}' in {target}")


def _has_nested_key_path(obj: Mapping[str, Any], dotted_path: str) -> bool:
    cur: Any = obj
    for segment in dotted_path.split("."):
        if not isinstance(cur, Mapping) or segment not in cur:
            return False
        cur = cur[segment]
    return cur is not None


def _find_unsupported_reason(test_case: Mapping[str, Any]) -> str | None:
    case_key = f"{SUITE}#{test_case.get('name', '')}"
    if case_key in UNSUPPORTED:
        return UNSUPPORTED[case_key]
    action = str(test_case.get("action", ""))
    if action in UNSUPPORTED:
        return UNSUPPORTED[action]
    prefix = f"{action}."
    for key, reason in UNSUPPORTED.items():
        if key.startswith(prefix) and _has_nested_key_path(
            test_case, key[len(prefix) :]
        ):
            return reason
    return None


def get_conformance_cases(filename: str) -> list[tuple[str, dict[str, Any]]]:
    cases = load_conformance_yaml(filename)
    assert isinstance(cases, list) and cases, f"No cases loaded from {filename}"
    return [(case["name"], case) for case in cases]


def _run_execute_tool(test_case: dict[str, Any]) -> None:
    _assert_known_keys(test_case, _KNOWN_KEYS["execute_tool.case"], "case key")
    args = test_case.get("args", {})
    expect = test_case["expect"]
    _assert_known_keys(args, _KNOWN_KEYS["execute_tool.args"], "args key")
    _assert_known_keys(expect, _KNOWN_KEYS["execute_tool.expect"], "expect key")

    tool_cls = SendA2uiToClientToolset._SendA2uiJsonToClientTool
    a2ui_json_str = args.get("a2uiJson")
    tool_args = (
        {tool_cls.A2UI_PAYLOAD_ARG_NAME: a2ui_json_str}
        if a2ui_json_str is not None
        else args
    )

    # The shared cases write the payload in Direct JSON.
    tool = tool_cls(
        A2uiRequestProcessor(
            [BasicCatalog("0.8")], format_factory=DirectJsonFormatFactory()
        )
    )

    tool_context_mock = MagicMock()
    tool_context_mock.state = {}
    tool_context_mock.actions = MagicMock(skip_summarization=False)

    with patch("a2ui.adk.send_a2ui_to_client_toolset.validate_payload"):
        result = asyncio.run(
            tool.run_async(args=tool_args, tool_context=tool_context_mock)
        )

    expect_success = expect["success"]
    assert isinstance(expect_success, bool)

    if expect_success:
        assert "error" not in result
        assert tool_cls.VALIDATED_A2UI_JSON_KEY in result
        if expect.get("containsValidatedJson"):
            validated_payload = result[tool_cls.VALIDATED_A2UI_JSON_KEY]
            assert "beginRendering" in json.dumps(validated_payload)
    else:
        assert "error" in result
        if "errorContains" in expect:
            assert expect["errorContains"] in result["error"]


def _run_subagent_event(test_case: dict[str, Any]) -> None:
    _assert_known_keys(
        test_case, _KNOWN_KEYS["convert_event.subagent_case"], "case key"
    )
    args = test_case.get("args", {})
    _assert_known_keys(args, _KNOWN_KEYS["convert_event.subagent_args"], "args key")

    subagent = args["subagent"]
    state = args.get("state", {})
    message = args["message"]
    a2a_part = create_a2ui_part(message)

    session_service = AsyncMock()
    session = MagicMock(spec=Session)
    session.state = dict(state)

    expect_error = test_case.get("expectError")
    if expect_error is not None:
        if isinstance(expect_error, Mapping):
            _assert_known_keys(
                expect_error,
                _KNOWN_KEYS["convert_event.expect_error"],
                "expectError key",
            )
            category = expect_error.get("category")
            if category is not None:
                assert category == "IntegrityError"
            expected_msg = expect_error.get("message", "")
        else:
            expected_msg = str(expect_error)

        with pytest.raises(SurfaceIdAlreadyExistsError) as exc_info:
            asyncio.run(
                A2uiSubagentMap.update_from_server_event(
                    a2a_part, subagent, session_service, session
                )
            )
        if expected_msg:
            assert expected_msg in str(exc_info.value)
        return

    asyncio.run(
        A2uiSubagentMap.update_from_server_event(
            a2a_part, subagent, session_service, session
        )
    )
    expect = test_case["expect"]
    _assert_known_keys(
        expect, _KNOWN_KEYS["convert_event.subagent_expect"], "expect key"
    )
    assert "stateDelta" in expect
    session_service.append_event.assert_called_once()
    call_args = session_service.append_event.call_args[0]
    event = call_args[1]
    assert event.actions.state_delta == expect["stateDelta"]


def _run_converter_event(test_case: dict[str, Any]) -> None:
    _assert_known_keys(
        test_case, _KNOWN_KEYS["convert_event.converter_case"], "case key"
    )
    args = test_case.get("args", {})
    _assert_known_keys(args, _KNOWN_KEYS["convert_event.converter_args"], "args key")

    content = (
        genai_types.Content(
            role="model",
            parts=[genai_types.Part(text=args["contentText"])],
        )
        if "contentText" in args
        else None
    )
    event = Event(
        author="agent",
        error_code=args.get("errorCode"),
        error_message=args.get("errorMessage"),
        content=content,
    )

    has_catalog = bool(args.get("hasCatalog", False))
    processor = (
        A2uiRequestProcessor(
            [BasicCatalog("0.8")], format_factory=DirectJsonFormatFactory()
        )
        if has_catalog
        else None
    )
    converter = A2uiEventConverter(a2ui_processor=lambda _: processor)

    invocation_context = MagicMock()
    invocation_context.invocation_id = "inv-1"
    invocation_context.session.id = "session-1"
    invocation_context.session.state = {}

    events = converter(
        event, invocation_context, task_id="task-1", context_id="context-1"
    )

    if test_case.get("expectEmpty"):
        assert events == []
        return

    expect = test_case["expect"]
    _assert_known_keys(
        expect, _KNOWN_KEYS["convert_event.converter_expect"], "expect key"
    )
    assert len(events) == 1
    actual: Any = events[0]
    assert type(actual).__name__ == expect["type"]
    assert actual.status.state.value.upper() == expect["state"]
    assert actual.status.message is not None
    assert actual.status.message.parts[0].root.text == expect["message"]


def _run_convert_event(test_case: dict[str, Any]) -> None:
    args = test_case.get("args", {})
    is_subagent = "subagent" in args and "message" in args
    is_converter = any(k in args for k in _CONVERTER_EVENT_ARG_KEYS)
    if is_subagent and not is_converter:
        _run_subagent_event(test_case)
    elif is_converter and not is_subagent:
        _run_converter_event(test_case)
    else:
        pytest.fail(
            f"convert_event args {sorted(args)} do not match subagent or converter"
            f" key set in {_CURRENT_CASE_KEY}"
        )


def _run_data_model(test_case: dict[str, Any]) -> None:
    _assert_known_keys(test_case, _KNOWN_KEYS["data_model.case"], "case key")
    args = test_case.get("args", {})
    expect = test_case["expect"]
    _assert_known_keys(args, _KNOWN_KEYS["data_model.args"], "args key")
    _assert_known_keys(expect, _KNOWN_KEYS["data_model.expect"], "expect key")
    assert "clientDataModel" in expect

    subagent = args["subagent"]
    state = args.get("state", {})
    client_data_model = copy.deepcopy(args.get("clientDataModel", {}))

    asyncio.run(
        A2uiSubagentMap.strip_unowned_surfaces_from_data_model(
            subagent, client_data_model, state
        )
    )
    assert client_data_model == expect["clientDataModel"]


RUNNERS: dict[str, Callable[[dict[str, Any]], None]] = {
    "convert_event": _run_convert_event,
    "data_model": _run_data_model,
    "execute_tool": _run_execute_tool,
}

cases_adk_extensions = get_conformance_cases(SUITE)


def test_unsupported_and_expected_failures_are_used() -> None:
    """Every UNSUPPORTED and EXPECTED_FAILURES entry must match at least one case."""
    matched_unsupported: set[str] = set()
    for name, case in cases_adk_extensions:
        case_key = f"{SUITE}#{name}"
        action = str(case.get("action", ""))
        if case_key in UNSUPPORTED:
            matched_unsupported.add(case_key)
        if action in UNSUPPORTED:
            matched_unsupported.add(action)
        prefix = f"{action}."
        for key in UNSUPPORTED:
            if key.startswith(prefix) and _has_nested_key_path(
                case, key[len(prefix) :]
            ):
                matched_unsupported.add(key)
    unused_unsupported = sorted(set(UNSUPPORTED) - matched_unsupported)
    assert not unused_unsupported, f"Unused UNSUPPORTED entries: {unused_unsupported}"

    loaded_keys = {f"{SUITE}#{name}" for name, _ in cases_adk_extensions}
    unused_xfails = sorted(set(EXPECTED_FAILURES) - loaded_keys)
    assert not unused_xfails, f"Unused EXPECTED_FAILURES entries: {unused_xfails}"


@pytest.mark.parametrize(
    "name, test_case",
    cases_adk_extensions,
    ids=[c[0] for c in cases_adk_extensions],
)
def test_adk_extensions_conformance(name: str, test_case: dict[str, Any]) -> None:
    global _CURRENT_CASE_KEY
    case_key = f"{SUITE}#{name}"
    _CURRENT_CASE_KEY = case_key

    unsupported_reason = _find_unsupported_reason(test_case)
    if unsupported_reason is not None:
        pytest.skip(unsupported_reason)

    action = test_case.get("action")
    if not isinstance(action, str) or action not in RUNNERS:
        pytest.fail(f"unknown action {action!r}")

    runner = RUNNERS[action]
    if case_key in EXPECTED_FAILURES:
        try:
            runner(test_case)
        except (Exception, pytest.fail.Exception):
            pytest.xfail(EXPECTED_FAILURES[case_key])
        pytest.fail(f"Expected failure '{case_key}' passed unexpectedly.")
    else:
        runner(test_case)
