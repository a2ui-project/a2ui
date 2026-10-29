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

"""Tests for the lazy exports that need the `a2a` extra."""

import asyncio
import importlib
import sys
from typing import Any
from unittest.mock import MagicMock

import pytest

A2A_EXPORTS = [
    "A2uiEventConverter",
    "A2uiPartConverter",
    "A2uiSubagentMap",
    "SurfaceIdAlreadyExistsError",
    "a2a",
    "orchestration",
]


@pytest.fixture
def adk_without_a2a(monkeypatch: pytest.MonkeyPatch):
    """Re-imports `a2ui.adk` as if `a2a-sdk` and `a2ui-a2a` were not installed."""
    for name in list(sys.modules):
        if name == "a2a" or name.startswith(("a2a.", "a2ui.a2a", "a2ui.adk")):
            monkeypatch.delitem(sys.modules, name)
    # A None entry makes `import a2a` raise ImportError.
    monkeypatch.setitem(sys.modules, "a2a", None)
    monkeypatch.setitem(sys.modules, "a2ui.a2a", None)
    yield importlib.import_module("a2ui.adk")
    # monkeypatch restores the original modules; drop the ones imported here.
    for name in list(sys.modules):
        if name.startswith("a2ui.adk"):
            sys.modules.pop(name, None)


def test_a2a_exports_resolve_with_extra() -> None:
    adk = importlib.import_module("a2ui.adk")
    for name in A2A_EXPORTS:
        assert getattr(adk, name) is not None
    assert adk.A2uiPartConverter is adk.a2a.A2uiPartConverter
    assert adk.A2uiSubagentMap is adk.orchestration.A2uiSubagentMap


def test_all_lists_every_export() -> None:
    adk = importlib.import_module("a2ui.adk")
    for name in adk.__all__:
        assert hasattr(adk, name), name


def test_base_exports_work_without_a2a(adk_without_a2a) -> None:
    assert adk_without_a2a.SendA2uiToClientToolset is not None
    assert adk_without_a2a.A2uiProcessorStore is not None


@pytest.mark.parametrize("name", A2A_EXPORTS)
def test_a2a_exports_explain_missing_extra(adk_without_a2a, name: str) -> None:
    with pytest.raises(ImportError, match=r'pip install "a2ui-adk\[a2a\]"'):
        getattr(adk_without_a2a, name)


def test_unrelated_import_errors_are_not_masked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adk = importlib.import_module("a2ui.adk")
    monkeypatch.delitem(adk.__dict__, "A2uiPartConverter", raising=False)

    def broken_import(name: str, package: str | None = None) -> Any:
        raise ModuleNotFoundError(
            "No module named 'some_dependency'", name="some_dependency"
        )

    monkeypatch.setattr(importlib, "import_module", broken_import)
    with pytest.raises(ModuleNotFoundError) as excinfo:
        adk.A2uiPartConverter
    assert excinfo.value.name == "some_dependency"
    assert "a2ui-adk[a2a]" not in str(excinfo.value)


def test_get_part_converter_explains_missing_extra(adk_without_a2a) -> None:
    toolset = adk_without_a2a.SendA2uiToClientToolset(
        a2ui_enabled=True, a2ui_processor=MagicMock()
    )
    with pytest.raises(ImportError, match=r'pip install "a2ui-adk\[a2a\]"'):
        asyncio.run(toolset.get_part_converter(MagicMock()))


def test_unknown_attribute_raises_attribute_error() -> None:
    adk = importlib.import_module("a2ui.adk")
    with pytest.raises(AttributeError):
        adk.DoesNotExist  # noqa: B018
