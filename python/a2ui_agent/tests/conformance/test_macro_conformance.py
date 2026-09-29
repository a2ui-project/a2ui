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

"""Conformance tests running ``conformance/agent/macros/macros.yaml`` against golden files, error expectations, and schema validation."""

from __future__ import annotations

import pytest

from a2ui.core import A2uiCatalogError, A2uiError, A2uiRecursionError
from .macro_suite import Case, load_cases, run_case, validate_payload

CASES = load_cases()
GOLDEN_CASES = [c for c in CASES if c.golden is not None]
ERROR_CASES = [c for c in CASES if c.expect_error is not None]

CATEGORY_TO_EXCEPTION = {
    "CatalogError": A2uiCatalogError,
    "RecursionError": A2uiRecursionError,
}


@pytest.mark.parametrize("case", GOLDEN_CASES, ids=lambda c: c.id)
def test_matches_golden(case: Case) -> None:
    """Macro expansion emits exactly the recorded wire payload."""
    assert run_case(case) == case.load_golden(), case.description


@pytest.mark.parametrize("case", GOLDEN_CASES, ids=lambda c: c.id)
def test_golden_is_spec_valid(case: Case) -> None:
    """The recorded payload passes the validator the agent SDK uses at runtime."""
    validate_payload(case.load_golden(), case)


@pytest.mark.parametrize("case", ERROR_CASES, ids=lambda c: c.id)
def test_expect_error(case: Case) -> None:
    """Error cases trigger the expected exception category."""
    category = case.expect_error.get("category")
    expected_exc = CATEGORY_TO_EXCEPTION.get(category, A2uiError)
    with pytest.raises(expected_exc):
        run_case(case)


def test_suite_covers_every_golden() -> None:
    """No golden file is orphaned by a case being renamed or removed."""
    import os

    from .macro_suite import GOLDEN_DIR

    on_disk = {f for f in os.listdir(GOLDEN_DIR) if f.endswith(".json")}
    declared = {case.golden for case in GOLDEN_CASES}
    assert on_disk == declared
