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

"""Runs the shared `conformance/core/data_model.yaml` suite against `DataModel`.

Two mappings, both documented in the suite header: `op: delete` maps to
`set(path, None)`, since Python has no `undefined`; `watch` attaches one
observer per entry, so a repeated path attaches a second.
"""

import copy
import os
import re
from typing import Any, Dict, List, Optional

import pytest
import yaml

from a2ui.core.exceptions import (
    A2uiCatalogError,
    A2uiCompileError,
    A2uiDataError,
    A2uiError,
    A2uiIntegrityError,
    A2uiParseError,
    A2uiRecursionError,
    A2uiValidationError,
)
from a2ui.core.state import DataModel

REPO_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "..")
)
SUITE_PATH = os.path.join(REPO_ROOT, "conformance", "core", "data_model.yaml")

_ERROR_CATEGORIES = {
    "DataError": A2uiDataError,
    "ValidationError": A2uiValidationError,
    "CatalogError": A2uiCatalogError,
    "IntegrityError": A2uiIntegrityError,
    "RecursionError": A2uiRecursionError,
    "ParseError": A2uiParseError,
    "CompileError": A2uiCompileError,
}


def load_suite() -> List[Dict[str, Any]]:
    with open(SUITE_PATH, encoding="utf-8") as handle:
        return [case for case in yaml.safe_load(handle) if case]


SUITE = load_suite()


def test_suite_is_not_empty() -> None:
    assert SUITE


class Observer:
    """One `watch` entry: counts notifications and keeps the last value seen."""

    def __init__(self, model: DataModel, path: str) -> None:
        self.path = path
        self.count = 0
        self.value: Any = None
        self._subscription = model.subscribe(path, self._on_change)
        self.value = self._subscription.value

    def _on_change(self, value: Any) -> None:
        self.count += 1
        self.value = value

    def reset_count(self) -> None:
        self.count = 0


@pytest.mark.parametrize("case", SUITE, ids=[c["name"] for c in SUITE])
def test_conformance_case(case: Dict[str, Any]) -> None:
    # The suite is shared across cases, so deep copy before mutating.
    model = DataModel(copy.deepcopy(case.get("initial")) or {})
    try:
        observers = [Observer(model, path) for path in case.get("watch", [])]

        for index, step in enumerate(case.get("steps", [])):
            reason = f"{case['name']} step {index} ({step['op']})"
            for observer in observers:
                observer.reset_count()

            expect_error = step.get("expect_error")
            if expect_error is not None:
                category = _ERROR_CATEGORIES.get(
                    expect_error.get("category"), A2uiError
                )
                with pytest.raises(category) as caught:
                    _apply_op(model, step)
                message = expect_error.get("message")
                if message is not None:
                    assert re.search(message, str(caught.value)), reason
                continue

            _apply_op(model, step)
            _check_notifications(step, observers, reason)
            _check_watched_values(step, observers, reason)
    finally:
        model.dispose()


def _apply_op(model: DataModel, step: Dict[str, Any]) -> None:
    op = step["op"]
    if op == "get":
        actual = model.get(step["path"])
        if "expect" in step:
            assert actual == step["expect"]
        if step.get("expect_absent"):
            assert actual is None
        expect_type = step.get("expect_type")
        if expect_type == "list":
            assert isinstance(actual, list)
        elif expect_type == "object":
            assert isinstance(actual, dict)
    elif op == "set":
        model.set(step["path"], step.get("value"))
    elif op == "delete":
        # Python has no `undefined`; removal is a write of None, which `set`
        # turns into a key removal.
        model.set(step["path"], None)
    elif op == "dispose":
        model.dispose()
    else:
        raise AssertionError(f"unknown op: {op}")


def _check_notifications(
    step: Dict[str, Any], observers: List[Observer], reason: str
) -> None:
    expected: Optional[List[str]] = step.get("expect_notified")
    if expected is None:
        return
    notified: List[str] = []
    for observer in observers:
        notified.extend([observer.path] * observer.count)
    assert sorted(notified) == sorted(expected), reason


def _check_watched_values(
    step: Dict[str, Any], observers: List[Observer], reason: str
) -> None:
    expected: Optional[Dict[str, Any]] = step.get("expect_values")
    if expected is None:
        return
    for path, value in expected.items():
        matching = [o for o in observers if o.path == path]
        assert matching, f"{reason}: no observer watches {path}"
        for observer in matching:
            assert observer.value == value, f"{reason}: {path}"
