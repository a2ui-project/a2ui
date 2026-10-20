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

Exposes the `timing` fixture of the a2ui_core test suite's
`timing_harness.py`, which the agent's `performance` tests use. That module
is a test helper rather than part of a package, so it is loaded by path. The
root `pyproject.toml` registers and deselects the `performance` marker for
every test directory.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

# The name python/a2ui_core/tests/conftest.py registers the harness under in
# `sys.modules`, so that a run of both suites loads it once.
_HARNESS_MODULE = "a2ui_core_tests_timing_harness"
_HARNESS_PATH = (
    Path(__file__).resolve().parents[2] / "a2ui_core" / "tests" / "timing_harness.py"
)


def _load_timing_harness() -> ModuleType:
    """Returns a2ui_core's `timing_harness.py`, loading it on first use."""
    module = sys.modules.get(_HARNESS_MODULE)
    if module is None:
        spec = importlib.util.spec_from_file_location(_HARNESS_MODULE, _HARNESS_PATH)
        assert spec is not None and spec.loader is not None, _HARNESS_PATH
        module = importlib.util.module_from_spec(spec)
        sys.modules[_HARNESS_MODULE] = module
        spec.loader.exec_module(module)
    return module


timing = _load_timing_harness().timing
