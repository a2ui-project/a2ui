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

"""Copies the decision layout grammar and catalog patterns into the package.

The canonical files live in the repository's ``catalogs/`` directory. An
installed wheel cannot read the repository, so the decision format loads
vendored copies from ``src/a2ui/inference_formats/decision/assets/``. After
changing a canonical file, run this from ``python/a2ui_agent`` and commit the
result::

    uv run python scripts/sync_decision_assets.py

With ``--check``, the script compares the vendored copies with the canonical
files instead of writing, prints a unified diff for each difference, and
exits 1 if any differ. ``tests/decision/test_decision_assets.py`` runs the
same comparison.
"""

import argparse
import difflib
from pathlib import Path
import sys

_SDK_DIR = Path(__file__).resolve().parents[1]
_REPO_ROOT = _SDK_DIR.parents[1]
_ASSETS_DIR = _SDK_DIR / "src" / "a2ui" / "inference_formats" / "decision" / "assets"

# Canonical file (relative to the repository root) to vendored copy (relative
# to the assets directory).
ASSET_SOURCES: dict[str, str] = {
    "catalogs/decision/v1/archetypes.json": "archetypes.json",
    "catalogs/decision/v1/archetype_definition.json": "archetype_definition.json",
    "catalogs/decision/v1/pattern_definition.json": "pattern_definition.json",
    "catalogs/basic/v1/patterns.json": "patterns/basic_v1_0.json",
}

_SYNC_COMMAND = "uv run python scripts/sync_decision_assets.py"
_MAX_DIFF_LINES = 40


def _diff(canonical: Path, vendored: Path) -> list[str]:
    """Returns unified diff lines between `vendored` and `canonical` (empty if same)."""
    expected = canonical.read_text(encoding="utf-8")
    actual = vendored.read_text(encoding="utf-8") if vendored.is_file() else ""
    if expected == actual:
        return []
    return list(
        difflib.unified_diff(
            actual.splitlines(keepends=True),
            expected.splitlines(keepends=True),
            fromfile=str(vendored),
            tofile=str(canonical),
        )
    )


def check(repo_root: Path, assets_dir: Path) -> int:
    """Reports vendored assets that differ from their canonical files."""
    stale = 0
    for source, target in ASSET_SOURCES.items():
        diff = _diff(repo_root / source, assets_dir / target)
        if not diff:
            continue
        stale += 1
        print(f"{target} is out of date with {source}:", file=sys.stderr)
        for line in diff[:_MAX_DIFF_LINES]:
            sys.stderr.write(line if line.endswith("\n") else line + "\n")
        if len(diff) > _MAX_DIFF_LINES:
            print(f"  ... ({len(diff) - _MAX_DIFF_LINES} more lines)", file=sys.stderr)
    if stale:
        print(
            f"{stale} vendored asset(s) out of date. Run `{_SYNC_COMMAND}` from"
            " python/a2ui_agent and commit the result.",
            file=sys.stderr,
        )
        return 1
    print("Decision assets are in sync.")
    return 0


def sync(repo_root: Path, assets_dir: Path) -> int:
    """Copies every canonical file over its vendored copy."""
    for source, target in ASSET_SOURCES.items():
        destination = assets_dir / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes((repo_root / source).read_bytes())
        print(f"{source} -> {destination.relative_to(_SDK_DIR)}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--check",
        action="store_true",
        help="compare instead of writing; exit 1 if any vendored asset differs",
    )
    args = parser.parse_args(argv)
    missing = [s for s in ASSET_SOURCES if not (_REPO_ROOT / s).is_file()]
    if missing:
        print(
            f"Canonical file(s) not found under {_REPO_ROOT}: {missing}",
            file=sys.stderr,
        )
        return 2
    if args.check:
        return check(_REPO_ROOT, _ASSETS_DIR)
    return sync(_REPO_ROOT, _ASSETS_DIR)


if __name__ == "__main__":
    sys.exit(main())
