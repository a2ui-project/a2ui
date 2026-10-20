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

"""Pytest configuration for the a2ui_core tests.

Exposes the `timing` fixture of `timing_harness.py`. Tests run with
`--import-mode=importlib`, which leaves this directory off `sys.path`, so the
module is loaded by path.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

# The name the harness module is registered under in `sys.modules`. Other test
# suites that load the harness use the same name, so it is loaded once.
_HARNESS_MODULE = "a2ui_core_tests_timing_harness"


def _load_timing_harness() -> ModuleType:
    """Returns `timing_harness.py`, loading it on first use."""
    module = sys.modules.get(_HARNESS_MODULE)
    if module is None:
        path = Path(__file__).with_name("timing_harness.py")
        spec = importlib.util.spec_from_file_location(_HARNESS_MODULE, path)
        assert spec is not None and spec.loader is not None, path
        module = importlib.util.module_from_spec(spec)
        sys.modules[_HARNESS_MODULE] = module
        spec.loader.exec_module(module)
    return module


timing = _load_timing_harness().timing
