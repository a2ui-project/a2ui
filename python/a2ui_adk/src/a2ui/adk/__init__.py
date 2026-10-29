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

"""A2UI extension for the Agent Development Kit (ADK).

`SendA2uiToClientToolset` and `A2uiProcessorStore` only need ADK. The ADK-to-A2A
converters (`A2uiPartConverter`, `A2uiEventConverter`, the `a2a` subpackage) and
the A2A subagent orchestration helpers (`A2uiSubagentMap`,
`SurfaceIdAlreadyExistsError`, the `orchestration` subpackage) need the `a2a`
extra:

  pip install "a2ui-adk[a2a]"

They are imported lazily, so `import a2ui.adk` works without the extra.
"""

from __future__ import annotations

import importlib
from typing import TYPE_CHECKING, Any

from .processor_store import A2uiProcessorStore
from .send_a2ui_to_client_toolset import (
    A2uiEnabledProvider,
    A2uiProcessorProvider,
    SendA2uiToClientToolset,
)

if TYPE_CHECKING:
    from . import a2a as a2a
    from . import orchestration as orchestration
    from .a2a import A2uiEventConverter, A2uiPartConverter
    from .orchestration import A2uiSubagentMap, SurfaceIdAlreadyExistsError

# Public names that need the `a2a` extra, mapped to the submodule they live in
# (relative to this package) and the attribute to read from it (None for the
# submodule itself).
_A2A_EXPORTS: dict[str, tuple[str, str | None]] = {
    "a2a": (".a2a", None),
    "orchestration": (".orchestration", None),
    "A2uiEventConverter": (".a2a", "A2uiEventConverter"),
    "A2uiPartConverter": (".a2a", "A2uiPartConverter"),
    "A2uiSubagentMap": (".orchestration", "A2uiSubagentMap"),
    "SurfaceIdAlreadyExistsError": (
        ".orchestration",
        "SurfaceIdAlreadyExistsError",
    ),
}


# Top-level modules that the `a2a` extra installs: `a2a-sdk` and `a2ui-a2a`.
_A2A_EXTRA_MODULES = ("a2a", "a2ui.a2a")


def _is_missing_a2a_extra(error: ImportError) -> bool:
    """Reports whether an import failed because the `a2a` extra is missing.

    Any other import error, such as a circular import or a broken dependency,
    is not about the extra and must propagate unchanged.
    """
    name = error.name or ""
    return isinstance(error, ModuleNotFoundError) and any(
        name == module or name.startswith(module + ".") for module in _A2A_EXTRA_MODULES
    )


def __getattr__(name: str) -> Any:
    target = _A2A_EXPORTS.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module_name, attr = target
    try:
        module = importlib.import_module(module_name, __name__)
    except ImportError as e:
        if not _is_missing_a2a_extra(e):
            raise
        raise ImportError(
            f"'a2ui.adk.{name}' requires the A2A extension. Install it with:"
            ' pip install "a2ui-adk[a2a]"'
        ) from e
    value = module if attr is None else getattr(module, attr)
    globals()[name] = value
    return value


__all__ = [
    "A2uiEnabledProvider",
    "A2uiEventConverter",
    "A2uiPartConverter",
    "A2uiProcessorProvider",
    "A2uiProcessorStore",
    "A2uiSubagentMap",
    "SendA2uiToClientToolset",
    "SurfaceIdAlreadyExistsError",
    "a2a",
    "orchestration",
]
