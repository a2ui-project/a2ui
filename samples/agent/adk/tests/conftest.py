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

from collections.abc import Callable, Iterator
import importlib
from pathlib import Path
import sys
from types import ModuleType

import pytest


def _sample_modules(sample_dir: Path) -> list[str]:
    """Returns the names of the loaded modules that live in `sample_dir`."""
    names = []
    for name, module in list(sys.modules.items()):
        module_file = getattr(module, "__file__", None)
        if module_file and Path(module_file).resolve().parent == sample_dir:
            names.append(name)
    return names


@pytest.fixture
def import_sample(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[Callable[..., list[ModuleType]]]:
    """Imports modules of a sample the way the sample runs them.

    A sample imports its own modules by their bare names (`agent`, `tools`...),
    and opens its files relative to its directory. Samples reuse these names,
    so the fixture runs from the sample's directory, puts it first on the
    import path, and unloads the sample's modules afterwards.
    """
    sample_dirs: list[Path] = []

    def _import(sample_dir: Path, *names: str) -> list[ModuleType]:
        sample_dir = sample_dir.resolve()
        sample_dirs.append(sample_dir)
        monkeypatch.chdir(sample_dir)
        monkeypatch.syspath_prepend(str(sample_dir))
        # Another sample's module of the same name may be loaded already.
        for module_path in sample_dir.glob("*.py"):
            sys.modules.pop(module_path.stem, None)
        return [importlib.import_module(name) for name in names]

    yield _import

    for sample_dir in sample_dirs:
        for name in _sample_modules(sample_dir):
            del sys.modules[name]
