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

"""Runs the Elemental and Atom experimental format conformance suites.

Both formats are experimental and implemented only by the Python Agent SDK, so
their suites run here, apart from the suites every SDK shares, and are
recorded in the `python-agent` manifest like any other executed suite. The
cases are written against v1.0 only.
"""

from __future__ import annotations

import pytest

from .test_conformance import get_marked_conformance_cases
from .test_conformance import run_format_case

EXPERIMENTAL_FORMAT_SUITES: tuple[str, ...] = (
    "agent/elemental/compiler.yaml",
    "agent/atom/compiler.yaml",
)

cases_experimental_formats = get_marked_conformance_cases(
    *EXPERIMENTAL_FORMAT_SUITES
)


@pytest.mark.parametrize("suite, test_case", cases_experimental_formats)
def test_experimental_format_conformance(suite, test_case, tmp_path):
    assert test_case["action"] in ("compile", "decompile")
    run_format_case(test_case, tmp_path, suite=suite, version="v1.0")
