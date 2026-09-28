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

"""Compatibility helpers for deprecated v0.1 module import paths."""

from __future__ import annotations

import importlib
import inspect
from typing import Any
import warnings


def warn_moved(old_module: str, new_module: str) -> None:
    """Emits a DeprecationWarning when a moved v0.1 module path is imported."""
    warnings.warn(
        f"'{old_module}' is deprecated and will be removed in v0.3.0; import"
        f" from '{new_module}' instead.",
        DeprecationWarning,
        stacklevel=2,
    )


def reexport_all(new_module: str, target_globals: dict[str, Any]) -> list[str]:
    """Copies public symbols from new_module into target_globals and returns __all__."""
    mod = importlib.import_module(new_module)
    if hasattr(mod, "__all__"):
        public_names: list[str] = list(mod.__all__)
    else:
        public_names = [
            name
            for name in dir(mod)
            if not name.startswith("_") and not inspect.ismodule(getattr(mod, name))
        ]
        for name in list(target_globals):
            if not name.startswith("_") and inspect.ismodule(target_globals[name]):
                target_globals.pop(name, None)
    for name in public_names:
        target_globals[name] = getattr(mod, name)
    return public_names
