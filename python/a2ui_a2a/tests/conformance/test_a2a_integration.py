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

"""Conformance harness for `conformance/extensions/a2a/a2a_integration.yaml`."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any
from unittest.mock import MagicMock

from a2a.server.agent_execution import RequestContext
from a2a.types import DataPart, Part
import pytest

from a2ui.a2a import (
    create_a2ui_part,
    get_a2ui_agent_extension,
    get_a2ui_datapart,
    get_a2ui_extension_uri,
    is_a2ui_part,
    try_activate_a2ui_extension,
)
from a2ui.a2a.extension import _select_newest_a2ui_extension
from a2ui.core.common import to_protocol_version
from .conformance_helpers import load_conformance_yaml

SUITE = "extensions/a2a/a2a_integration.yaml"

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

_KNOWN_KEYS: dict[str, frozenset[str]] = {
    "case": _CASE_METADATA_KEYS | frozenset({"action", "args", "expect"}),
    "create_a2ui_part.args": frozenset({"data", "version"}),
    "create_a2ui_part.expect": frozenset({"mimeType"}),
    "is_a2ui_part.args": frozenset({"mimeType"}),
    "try_activate_extension.args": frozenset({"uris"}),
    "get_extension.args": frozenset({
        "version",
        "acceptsInlineCatalogs",
        "supportedCatalogIds",
    }),
    "get_extension.expect": frozenset({"uri", "params"}),
    "try_activate.args": frozenset({"requested", "advertised"}),
    "try_activate.expect": frozenset({"activated", "version"}),
    "select_newest.args": frozenset({"requested", "advertised"}),
    "select_newest.expect": frozenset({"newest"}),
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


def _run_create_a2ui_part(test_case: dict[str, Any]) -> None:
    _assert_known_keys(test_case, _KNOWN_KEYS["case"], "case key")
    args = test_case.get("args", {})
    expect = test_case["expect"]
    _assert_known_keys(args, _KNOWN_KEYS["create_a2ui_part.args"], "args key")
    _assert_known_keys(expect, _KNOWN_KEYS["create_a2ui_part.expect"], "expect key")

    part = create_a2ui_part(args["data"], version=args.get("version"))
    assert is_a2ui_part(part)
    data_part = get_a2ui_datapart(part)
    assert data_part is not None
    assert data_part.metadata is not None
    assert data_part.metadata.get("mimeType") == expect["mimeType"]


def _run_is_a2ui_part(test_case: dict[str, Any]) -> None:
    _assert_known_keys(test_case, _KNOWN_KEYS["case"], "case key")
    args = test_case.get("args", {})
    _assert_known_keys(args, _KNOWN_KEYS["is_a2ui_part.args"], "args key")
    expect = test_case["expect"]
    assert isinstance(expect, bool)

    part = Part(root=DataPart(data={}, metadata={"mimeType": args["mimeType"]}))
    assert is_a2ui_part(part) == expect


def _run_try_activate_extension(test_case: dict[str, Any]) -> None:
    _assert_known_keys(test_case, _KNOWN_KEYS["case"], "case key")
    args = test_case.get("args", {})
    _assert_known_keys(args, _KNOWN_KEYS["try_activate_extension.args"], "args key")
    expect = test_case["expect"]
    assert isinstance(expect, bool)

    context = MagicMock(spec=RequestContext)
    context.requested_extensions = args["uris"]
    context.add_activated_extension = MagicMock()

    card = MagicMock()
    extensions = []
    for ver in ("0.8", "0.9", "1.0"):
        ext = MagicMock()
        ext.uri = get_a2ui_extension_uri(ver)
        extensions.append(ext)
    card.capabilities.extensions = extensions

    result_version = try_activate_a2ui_extension(context, card)
    assert (result_version is not None) == expect


def _run_get_extension(test_case: dict[str, Any]) -> None:
    _assert_known_keys(test_case, _KNOWN_KEYS["case"], "case key")
    args = test_case.get("args", {})
    expect = test_case["expect"]
    _assert_known_keys(args, _KNOWN_KEYS["get_extension.args"], "args key")
    _assert_known_keys(expect, _KNOWN_KEYS["get_extension.expect"], "expect key")

    kwargs: dict[str, Any] = {}
    if args.get("acceptsInlineCatalogs") is not None:
        kwargs["accepts_inline_catalogs"] = args["acceptsInlineCatalogs"]
    if args.get("supportedCatalogIds") is not None:
        kwargs["supported_catalog_ids"] = args["supportedCatalogIds"]

    ext = get_a2ui_agent_extension(args["version"], **kwargs)
    assert ext.uri == expect["uri"]
    if expect["params"] is None:
        assert ext.params is None
    else:
        assert ext.params == expect["params"]


def _run_try_activate(test_case: dict[str, Any]) -> None:
    _assert_known_keys(test_case, _KNOWN_KEYS["case"], "case key")
    args = test_case.get("args", {})
    expect = test_case["expect"]
    _assert_known_keys(args, _KNOWN_KEYS["try_activate.args"], "args key")
    _assert_known_keys(expect, _KNOWN_KEYS["try_activate.expect"], "expect key")

    context = MagicMock(spec=RequestContext)
    context.requested_extensions = args["requested"]
    context.add_activated_extension = MagicMock()

    card = MagicMock()
    extensions = []
    for uri in args["advertised"]:
        ext = MagicMock()
        ext.uri = uri
        extensions.append(ext)
    card.capabilities.extensions = extensions

    result_version = try_activate_a2ui_extension(context, card)
    if expect["activated"] is None:
        assert result_version is None
        context.add_activated_extension.assert_not_called()
    else:
        # The YAML is shared across SDKs and names the version as a string;
        # the Python helper returns the matching ProtocolVersion.
        assert result_version == to_protocol_version(expect["version"])
        context.add_activated_extension.assert_called_once_with(expect["activated"])


def _run_select_newest(test_case: dict[str, Any]) -> None:
    _assert_known_keys(test_case, _KNOWN_KEYS["case"], "case key")
    args = test_case.get("args", {})
    expect = test_case["expect"]
    _assert_known_keys(args, _KNOWN_KEYS["select_newest.args"], "args key")
    _assert_known_keys(expect, _KNOWN_KEYS["select_newest.expect"], "expect key")

    result = _select_newest_a2ui_extension(args["requested"], args["advertised"])
    assert result == expect["newest"]


RUNNERS: dict[str, Callable[[dict[str, Any]], None]] = {
    "create_a2ui_part": _run_create_a2ui_part,
    "get_extension": _run_get_extension,
    "is_a2ui_part": _run_is_a2ui_part,
    "select_newest": _run_select_newest,
    "try_activate": _run_try_activate,
    "try_activate_extension": _run_try_activate_extension,
}

cases_a2a_integration = get_conformance_cases(SUITE)


def test_unsupported_and_expected_failures_are_used() -> None:
    """Every UNSUPPORTED and EXPECTED_FAILURES entry must match at least one case."""
    matched_unsupported: set[str] = set()
    for name, case in cases_a2a_integration:
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

    loaded_keys = {f"{SUITE}#{name}" for name, _ in cases_a2a_integration}
    unused_xfails = sorted(set(EXPECTED_FAILURES) - loaded_keys)
    assert not unused_xfails, f"Unused EXPECTED_FAILURES entries: {unused_xfails}"


@pytest.mark.parametrize(
    "name, test_case",
    cases_a2a_integration,
    ids=[c[0] for c in cases_a2a_integration],
)
def test_a2a_integration_conformance(name: str, test_case: dict[str, Any]) -> None:
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
