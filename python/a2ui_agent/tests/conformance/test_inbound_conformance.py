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

"""Conformance runner for `conformance/agent/inbound_messages.yaml`."""

from __future__ import annotations

from typing import Any

import pytest

from a2ui.core import A2uiValidationError
from a2ui.inbound import (
    format_inbound_for_model,
    get_inbound_message_kind,
    parse_inbound_message,
)

from .conformance_helpers import (
    assert_known_keys,
    case_params,
    load_conformance_yaml,
)

_SUITE = "agent/inbound_messages.yaml"
_CASE_KEYS = frozenset({
    "name",
    "description",
    "action",
    "args",
    "expect",
    "expect_error",
})
_EXPECT_KEYS = frozenset({
    "kind",
    "model_input",
    "model_input_contains",
})
_EXPECT_ERROR_KEYS = frozenset({"category", "message"})
_ERROR_CATEGORIES: dict[str, type[Exception]] = {
    "ValidationError": A2uiValidationError,
}


def _load_cases(suite: str) -> list[Any]:
    cases = load_conformance_yaml(suite)
    assert isinstance(cases, list) and cases, f"Empty suite: {suite}"
    return case_params(suite, cases)


@pytest.mark.parametrize("suite, case", _load_cases(_SUITE))
def test_inbound_messages_conformance(suite: str, case: dict[str, Any]) -> None:
    del suite
    assert case["action"] == "parse_inbound_message"
    assert_known_keys(case, _CASE_KEYS, "parse_inbound_message case")
    args = case["args"]
    version = args["version"]
    raw_message = args["message"]

    if "expect_error" in case:
        assert_known_keys(case["expect_error"], _EXPECT_ERROR_KEYS, "expect_error")
        with pytest.raises(
            _ERROR_CATEGORIES[case["expect_error"]["category"]],
            match=case["expect_error"].get("message"),
        ):
            parse_inbound_message(raw_message, version)
        return

    parsed = parse_inbound_message(raw_message, version)
    expect = case["expect"]
    assert_known_keys(expect, _EXPECT_KEYS, "expect")
    assert get_inbound_message_kind(parsed) == expect["kind"]

    formatted = format_inbound_for_model(parsed)
    if "model_input" in expect:
        assert formatted == expect["model_input"]
    if "model_input_contains" in expect:
        assert formatted is not None
        for substring in expect["model_input_contains"]:
            assert substring in formatted
