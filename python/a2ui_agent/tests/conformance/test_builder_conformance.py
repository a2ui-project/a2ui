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

"""Conformance tests running ``conformance/agent/builder/builder.yaml`` against golden files and schema validation."""

from __future__ import annotations

import os

import pytest

from .builder_suite import GOLDEN_DIR, Case, load_cases, run_case, validate_payload
from .conformance_helpers import case_params

SUITE = "agent/builder/builder.yaml"
CASES = load_cases()


@pytest.mark.parametrize("suite, case", case_params(SUITE, CASES))
def test_matches_golden(suite: str, case: Case) -> None:
    """The builder emits exactly the recorded wire payload."""
    del suite
    assert run_case(case) == case.load_golden(), case.description


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.id)
def test_golden_is_spec_valid(case: Case) -> None:
    """The recorded payload passes the validator the agent SDK uses at runtime."""
    validate_payload(case.load_golden(), case)


def test_suite_covers_every_golden() -> None:
    """No golden file is orphaned by a case being renamed or removed."""
    on_disk: set[str] = set()
    for dirpath, _dirnames, filenames in os.walk(GOLDEN_DIR):
        for fname in filenames:
            if fname.endswith(".json"):
                rel = os.path.relpath(os.path.join(dirpath, fname), GOLDEN_DIR)
                on_disk.add(rel.replace(os.sep, "/"))
    declared = {case.golden for case in CASES}
    assert on_disk == declared
