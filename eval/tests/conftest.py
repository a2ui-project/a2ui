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


"""Skips TypeScript and Dart SDK test cases when their toolchain is missing.

Mark a test with ``@pytest.mark.sdk_toolchain`` and parametrize it over ``sdk``.
Its ``ts`` and ``dart`` cases are skipped unless node, yarn and a built ``@a2ui/agent`` (for ``ts``) or a
resolved Dart workspace (for ``dart``) are available. Tests that mock the bridge
don't need the marker.
"""

from __future__ import annotations

import importlib
from pathlib import Path
import shutil

import pytest

from a2ui_eval.shared.utils import GIT_ROOT


def _find_node() -> str | None:
    found = shutil.which("node")
    if found:
        return found
    nvm_nodes = sorted((Path.home() / ".nvm" / "versions" / "node").glob("*/bin/node"))
    return str(nvm_nodes[-1]) if nvm_nodes else None


def _ts_toolchain_available() -> bool:
    # Require an existing build so that unrelated test runs (for example the
    # repository-wide Python CI) don't start a full yarn install and build.
    built = all(
        (GIT_ROOT / "typescript" / pkg / "dist" / "src" / "index.js").is_file()
        for pkg in ("a2ui_agent", "core/web_core")
    )
    node = _find_node()
    if node is None or not built:
        return False
    return bool(shutil.which("yarn")) or (Path(node).parent / "yarn").is_file()


def _dart_toolchain_available() -> bool:
    # Use the bridge's own lookup, so a test is skipped exactly when
    # DartSdkBridge.prepare() would fail to find a supported Dart SDK.
    package_config = GIT_ROOT / ".dart_tool" / "package_config.json"
    if not package_config.is_file():
        return False
    from a2ui_eval.bridges import DartSdkBridge

    dart_bridge = importlib.import_module(DartSdkBridge.__module__)
    try:
        dart_bridge.find_dart_binary()
    except RuntimeError:
        return False
    return True


_TOOLCHAIN_SKIP_REASONS = {
    "ts": (
        "TypeScript SDK bridge needs node, yarn and a built @a2ui/agent and"
        " @a2ui/web_core (yarn workspace @a2ui/agent build)."
    ),
    "dart": (
        "Dart SDK bridge needs a Dart SDK >= 3.10 and a resolved"
        " .dart_tool/package_config.json at the repository root."
    ),
}


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "sdk_toolchain: skip the ts/dart cases when that SDK's toolchain is missing",
    )


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    available = {
        "ts": _ts_toolchain_available(),
        "dart": _dart_toolchain_available(),
    }
    for item in items:
        if item.get_closest_marker("sdk_toolchain") is None:
            continue
        callspec = getattr(item, "callspec", None)
        sdk = callspec.params.get("sdk") if callspec else None
        if sdk in available and not available[sdk]:
            item.add_marker(pytest.mark.skip(reason=_TOOLCHAIN_SKIP_REASONS[sdk]))
