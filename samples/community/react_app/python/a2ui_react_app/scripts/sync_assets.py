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

"""Copies the ReactApp contracts into the package so the wheel ships them.

The sources of truth are the catalog and its examples under
`samples/community/react_app/catalog/v1/` and the `a2ui` module typings under
`samples/community/react_app/typescript/react_app_runtime/src/a2ui.d.ts`, with
the words that can't name a bound function next to it (`reserved_words.json`). Run
this script after changing any of them; `tests/test_assets.py` fails while the
copies differ from the sources.

Usage:
    uv run python scripts/sync_assets.py
"""

from __future__ import annotations

from pathlib import Path
import shutil

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
REACT_APP_ROOT = PACKAGE_ROOT.parent.parent
ASSETS_DIR = PACKAGE_ROOT / "src" / "a2ui_react_app" / "assets"
_CATALOG_DIR = REACT_APP_ROOT / "catalog" / "v1"
_RUNTIME_SRC = REACT_APP_ROOT / "typescript" / "react_app_runtime" / "src"


def asset_pairs() -> list[tuple[Path, Path]]:
    """Returns each source file with the path of its copy in the package."""
    pairs = [
        (_CATALOG_DIR / "catalog.json", ASSETS_DIR / "catalog.json"),
        (_RUNTIME_SRC / "a2ui.d.ts", ASSETS_DIR / "a2ui.d.ts"),
        (_RUNTIME_SRC / "reserved_words.json", ASSETS_DIR / "reserved_words.json"),
    ]
    for example in sorted((_CATALOG_DIR / "examples").glob("*.json")):
        pairs.append((example, ASSETS_DIR / "examples" / example.name))
    return pairs


def stale_copies() -> list[Path]:
    """Returns the copies in the package that don't belong to any source."""
    expected = {copy for _, copy in asset_pairs()}
    return sorted(
        path
        for path in ASSETS_DIR.rglob("*")
        if path.is_file() and path not in expected
    )


def main() -> None:
    """Copies every source into the package and removes stale copies."""
    for source, copy in asset_pairs():
        copy.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, copy)
        print(f"copied {source.relative_to(REACT_APP_ROOT)}")
    for stale in stale_copies():
        stale.unlink()
        print(f"removed {stale.relative_to(PACKAGE_ROOT)}")


if __name__ == "__main__":
    main()
