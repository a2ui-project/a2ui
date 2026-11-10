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

"""Helpers for functions the agent may invoke via `callRendererFunction`."""

from __future__ import annotations

from collections.abc import Sequence

from a2ui.core import CatalogApi
from a2ui.core.common import is_at_least_version
from a2ui.core.schema import ProtocolVersion

__all__ = [
    "agent_callable_functions",
]


def agent_callable_functions(catalogs: Sequence[CatalogApi]) -> list[str]:
    """Returns the names of functions the agent may call via `callRendererFunction`.

    Iterates catalogs in order and their functions in declaration order,
    returning each unique function name on v1.0+ catalogs whose
    `requires_user_activation` is false and whose `allowed_callers` is
    `"agentOnly"` or `"rendererOrAgent"`.

    Args:
        catalogs: Active catalogs in priority order.

    Returns:
        Function names eligible for standalone agent calls.
    """
    seen: set[str] = set()
    names: list[str] = []
    for catalog in catalogs:
        ver = getattr(catalog, "protocol_version", ProtocolVersion.V0_9)
        if ver is None or not is_at_least_version(ver, ProtocolVersion.V1_0):
            continue
        for fn in catalog.functions.values():
            if (
                not fn.requires_user_activation
                and fn.allowed_callers in ("agentOnly", "rendererOrAgent")
                and fn.name not in seen
            ):
                seen.add(fn.name)
                names.append(fn.name)
    return names
