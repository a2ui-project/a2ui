# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""AST fitness test enforcing isolation across experimental decision tracks."""

from __future__ import annotations

import ast
from pathlib import Path

_SRC_ROOT = Path(__file__).resolve().parents[1] / "src" / "a2ui"
_INF_EXP_ROOT = _SRC_ROOT / "inference_formats" / "experimental"
_RPC_EXP_ROOT = _SRC_ROOT / "rpc" / "experimental"

# Planner-internal modules under experimental/decision/ that sibling tracks
# must not import directly.
_FORBIDDEN_DECISION_INTERNALS = frozenset({
    "archetypes",
    "decision_block",
    "format",
    "layout_lint",
    "layout_planner",
    "parser",
    "patterns",
    "plan_cache",
    "prompt_generator",
    "synthesizer",
    "tool",
})


def _collect_imported_modules(py_file: Path) -> list[str]:
    tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=str(py_file))
    rel_parts = list(py_file.relative_to(_SRC_ROOT.parent).with_suffix("").parts)
    pkg_parts = rel_parts[:-1]
    imports: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                base = pkg_parts[: len(pkg_parts) - node.level + 1]
                mod = ".".join([*base, node.module] if node.module else base)
            else:
                mod = node.module or ""
            if mod:
                imports.append(mod)
                imports.extend(f"{mod}.{alias.name}" for alias in node.names)
    return imports


def _iter_track_dirs() -> list[tuple[str, Path]]:
    tracks: list[tuple[str, Path]] = []
    if _INF_EXP_ROOT.is_dir():
        for child in sorted(_INF_EXP_ROOT.iterdir()):
            if child.is_dir() and not child.name.startswith("__"):
                tracks.append(
                    (f"a2ui.inference_formats.experimental.{child.name}", child)
                )
    if _RPC_EXP_ROOT.is_dir():
        for child in sorted(_RPC_EXP_ROOT.iterdir()):
            if child.is_dir() and not child.name.startswith("__"):
                tracks.append((f"a2ui.rpc.experimental.{child.name}", child))
    return tracks


def test_experimental_tracks_have_no_sibling_or_planner_internal_imports() -> None:
    tracks = _iter_track_dirs()
    sibling_prefixes = {
        pkg
        for pkg, _ in tracks
        if pkg != "a2ui.inference_formats.experimental.decision"
    }
    violations: list[str] = []
    for own_pkg, track_dir in tracks:
        if own_pkg == "a2ui.inference_formats.experimental.decision":
            continue
        for py_file in sorted(track_dir.rglob("*.py")):
            for mod in _collect_imported_modules(py_file):
                for other_pkg in sibling_prefixes:
                    if other_pkg != own_pkg and (
                        mod == other_pkg or mod.startswith(f"{other_pkg}.")
                    ):
                        violations.append(
                            f"{py_file.relative_to(_SRC_ROOT)}: cross-track import"
                            f" {mod}"
                        )
                prefix = "a2ui.inference_formats.experimental.decision."
                if mod.startswith(prefix):
                    sub = mod[len(prefix) :].split(".", 1)[0]
                    if sub in _FORBIDDEN_DECISION_INTERNALS:
                        violations.append(
                            f"{py_file.relative_to(_SRC_ROOT)}: planner-internal import"
                            f" {mod}"
                        )
    assert not violations, "\n".join(violations)
