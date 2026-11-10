# Copyright 2026 Google LLC
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

"""The package data matches the ReactApp contracts it copies."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "sync_assets.py"


def _load_sync_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("sync_assets", _SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_copies_match_their_sources() -> None:
    sync = _load_sync_script()
    pairs = sync.asset_pairs()
    assert {copy.name for _, copy in pairs} >= {
        "catalog.json",
        "a2ui.d.ts",
        "loan_explorer.json",
    }
    drifted = [
        str(copy.relative_to(sync.PACKAGE_ROOT))
        for source, copy in pairs
        if not copy.is_file() or copy.read_bytes() != source.read_bytes()
    ]
    assert not drifted, (
        f"Package data differs from its sources: {drifted}. Run `uv run python"
        " scripts/sync_assets.py`."
    )


def test_package_has_no_stale_copies() -> None:
    sync = _load_sync_script()
    stale = [str(p.relative_to(sync.PACKAGE_ROOT)) for p in sync.stale_copies()]
    assert not stale, (
        f"Package data has files without a source: {stale}. Run `uv run python"
        " scripts/sync_assets.py`."
    )
