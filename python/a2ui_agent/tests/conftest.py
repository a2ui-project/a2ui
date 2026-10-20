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

"""Pytest configuration for the a2ui_agent tests.

Provides the `timing` fixture that the agent's `performance` tests use. It
returns a `TimingHarness` from the a2ui_core test suite's `timing_harness.py`.
That module is a test helper rather than part of a package, so it is loaded by
path. The root `pyproject.toml` registers and deselects the `performance`
marker for every test directory.

The harness is loaded when a test first asks for `timing`, not when this file
is imported, so a build that leaves `timing_harness.py` out of the test's
files fails only the timing tests. The path is taken from `__file__` as it is,
without resolving symlinks, so that it stays inside a test runner's runfiles
tree rather than following the link to the source file.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

# The name python/a2ui_core/tests/conftest.py registers the harness under in
# `sys.modules`, so that a run of both suites loads it once.
_HARNESS_MODULE = "a2ui_core_tests_timing_harness"
_HARNESS_PATH = Path(__file__).parents[2] / "a2ui_core" / "tests" / "timing_harness.py"


def _load_timing_harness() -> ModuleType:
    """Returns a2ui_core's `timing_harness.py`, loading it on first use."""
    module = sys.modules.get(_HARNESS_MODULE)
    if module is None:
        spec = importlib.util.spec_from_file_location(_HARNESS_MODULE, _HARNESS_PATH)
        if spec is None or spec.loader is None or not _HARNESS_PATH.is_file():
            raise FileNotFoundError(
                f"The timing tests need a2ui_core's timing harness at {_HARNESS_PATH}."
            )
        module = importlib.util.module_from_spec(spec)
        sys.modules[_HARNESS_MODULE] = module
        try:
            spec.loader.exec_module(module)
        except BaseException:
            del sys.modules[_HARNESS_MODULE]
            raise
    return module


@pytest.fixture
def timing() -> Any:
    """The harness that runs the conformance timing cases."""
    return _load_timing_harness().TimingHarness()
