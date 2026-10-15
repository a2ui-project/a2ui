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

"""Tests for the internal `experimental` decorator."""

from typing import Any

import pytest

from a2ui.utils._experimental import SUPPRESS_ENV_VAR, experimental


@experimental
class _WithInit:

    def __init__(self, value: int) -> None:
        self.value = value


# No `__init__` of its own: the decorator wraps `object.__init__`, a slot
# wrapper, which `functools.wraps` must handle.
@experimental
class _WithoutInit:
    pass


# Inherits a C-implemented `__init__` from a built-in type.
@experimental
class _FromBuiltin(dict[str, Any]):
    pass


@experimental
def _function(x: int) -> int:
    return x * 2


@pytest.fixture(autouse=True)
def _show_warnings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(SUPPRESS_ENV_VAR, raising=False)


@pytest.mark.parametrize(
    "factory, name",
    [
        (lambda: _WithInit(1), "_WithInit"),
        (_WithoutInit, "_WithoutInit"),
        (lambda: _FromBuiltin(a=1), "_FromBuiltin"),
        (lambda: _function(2), "_function"),
    ],
)
def test_warns_on_use(factory: Any, name: str) -> None:
    with pytest.warns(UserWarning, match=rf"\[EXPERIMENTAL\] {name}:"):
        factory()


def test_decorated_objects_keep_their_behavior() -> None:
    with pytest.warns(UserWarning):
        assert _WithInit(3).value == 3
        assert _FromBuiltin(a=1) == {"a": 1}
        assert isinstance(_WithoutInit(), _WithoutInit)
        assert _function(4) == 8
    assert _function.__name__ == "_function"


def test_warnings_can_be_suppressed(
    monkeypatch: pytest.MonkeyPatch, recwarn: pytest.WarningsRecorder
) -> None:
    monkeypatch.setenv(SUPPRESS_ENV_VAR, "true")
    _WithInit(1)
    _WithoutInit()
    _function(1)
    assert not [w for w in recwarn if "EXPERIMENTAL" in str(w.message)]


def test_rejects_non_callables() -> None:
    with pytest.raises(TypeError):
        experimental(42)
