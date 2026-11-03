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

from collections.abc import Mapping, Sequence
from typing import Any

from a2ui.core import A2uiValidationError, CatalogApi
from a2ui.core.catalog import FunctionApi

__all__ = [
    "agent_callable_functions",
    "check_agent_callable",
]


def agent_callable_functions(catalogs: Sequence[CatalogApi]) -> list[str]:
    """Returns the names of functions the agent may call via `callRendererFunction`.

    Iterates catalogs in order and their functions in declaration order,
    returning each unique function name whose `requires_user_activation` is
    false and whose `allowed_callers` is `"agentOnly"` or `"rendererOrAgent"`.

    Args:
        catalogs: Active catalogs in priority order.

    Returns:
        Function names eligible for standalone agent calls.
    """
    seen: set[str] = set()
    names: list[str] = []
    for catalog in catalogs:
        for fn in catalog.functions.values():
            if (
                not fn.requires_user_activation
                and fn.allowed_callers in ("agentOnly", "rendererOrAgent")
                and fn.name not in seen
            ):
                seen.add(fn.name)
                names.append(fn.name)
    return names


def _find_function(
    name: str,
    catalog_id: str | None,
    catalogs: Sequence[CatalogApi],
) -> FunctionApi | None:
    if catalog_id is not None:
        for catalog in catalogs:
            if catalog.catalog_id == catalog_id:
                return catalog.functions.get(name)
        return None
    for catalog in catalogs:
        fn = catalog.functions.get(name)
        if fn is not None:
            return fn
    return None


def check_agent_callable(
    message: Mapping[str, Any],
    catalogs: Sequence[CatalogApi],
) -> None:
    """Validates that a `callRendererFunction` message calls an agent-callable function.

    Unknown catalogs or functions are left to schema and processor validation.

    Args:
        message: An agent-to-renderer message dictionary.
        catalogs: Active catalogs in priority order.

    Raises:
        A2uiValidationError: If the target function requires user activation or
            declares `allowedCallers: "rendererOnly"`.
    """
    call_renderer = message.get("callRendererFunction")
    if not isinstance(call_renderer, Mapping):
        return
    call_fn = call_renderer.get("callFunction")
    if not isinstance(call_fn, Mapping):
        return
    raw_name = call_fn.get("@call") if "@call" in call_fn else call_fn.get("call")
    if not isinstance(raw_name, str) or not raw_name:
        return
    raw_catalog_id = call_fn.get("catalogId")
    catalog_id = (
        raw_catalog_id
        if isinstance(raw_catalog_id, str) and raw_catalog_id
        else None
    )
    fn = _find_function(raw_name, catalog_id, catalogs)
    if fn is None:
        return
    if fn.requires_user_activation:
        raise A2uiValidationError(
            f"Function '{raw_name}' cannot be called by the agent"
            " (requiresUserActivation is true)."
        )
    if fn.allowed_callers not in ("agentOnly", "rendererOrAgent"):
        raise A2uiValidationError(
            f"Function '{raw_name}' cannot be called by the agent"
            f" (allowedCallers is {fn.allowed_callers})."
        )
