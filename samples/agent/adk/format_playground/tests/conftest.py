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

"""Test fixtures for the format playground.

The sample's modules are flat top-level names (`agent`, `modes`, ...), as in
the other ADK samples, so the sample directory is put on `sys.path` here.
"""

from __future__ import annotations

import os
from pathlib import Path
import sys

import pytest

_TESTS_DIR = Path(__file__).resolve().parent
_SAMPLE_DIR = _TESTS_DIR.parent
for _dir in (_TESTS_DIR, _SAMPLE_DIR):
    _dir_str = str(_dir)
    if _dir_str in sys.path:
        sys.path.remove(_dir_str)
    sys.path.insert(0, _dir_str)
for _mod in ("agent", "agent_executor"):
    _loaded = sys.modules.get(_mod)
    _file = getattr(_loaded, "__file__", None) if _loaded else None
    if _file and not str(Path(_file).resolve()).startswith(str(_SAMPLE_DIR)):
        sys.modules.pop(_mod, None)

os.environ.setdefault("A2UI_DECISION_BACKEND", "mock")
os.environ.setdefault("GEMINI_API_KEY", "test-key")

from fakes import FakeLlmCaller  # noqa: E402  (needs the sys.path change above)


@pytest.fixture
def scripted_llm() -> FakeLlmCaller:
    return FakeLlmCaller()
