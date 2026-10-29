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

"""Guards that the agent SDK stays independent of agent frameworks.

Framework integrations (A2A, ADK, GenAI, ...) belong in their own distributions,
such as `a2ui-a2a` and `a2ui-adk`. This test scans every Python source file of
the agent SDK and fails if one imports a framework package.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

SRC_ROOT = Path(__file__).resolve().parents[1] / "src" / "a2ui"

FORBIDDEN_PREFIXES = (
    "a2a",
    "google.adk",
    "google.genai",
    "a2ui.a2a",
    "a2ui.adk",
)


def _imported_modules(tree: ast.AST) -> list[tuple[int, str]]:
    modules: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.extend((node.lineno, alias.name) for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            modules.append((node.lineno, node.module))
    return modules


def _is_forbidden(module: str) -> bool:
    return any(module == p or module.startswith(p + ".") for p in FORBIDDEN_PREFIXES)


SOURCE_FILES = sorted(SRC_ROOT.rglob("*.py"))


def test_source_files_are_found() -> None:
    assert SOURCE_FILES, f"No source files found under {SRC_ROOT}"


def test_framework_packages_are_not_in_the_agent_sdk_tree() -> None:
    assert not (SRC_ROOT / "a2a").exists()
    assert not (SRC_ROOT / "adk").exists()


@pytest.mark.parametrize(
    "path",
    SOURCE_FILES,
    ids=[str(p.relative_to(SRC_ROOT)) for p in SOURCE_FILES],
)
def test_no_framework_imports(path: Path) -> None:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    offending = [
        f"{path.relative_to(SRC_ROOT)}:{line}: {module}"
        for line, module in _imported_modules(tree)
        if _is_forbidden(module)
    ]
    assert not offending, "Agent SDK must not import agent frameworks:\n" + "\n".join(
        offending
    )
