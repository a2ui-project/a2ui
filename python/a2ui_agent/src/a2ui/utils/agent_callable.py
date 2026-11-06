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
from a2ui.core.common import is_at_least_version
from a2ui.core.schema import ProtocolVersion
from a2ui.core.validation import PayloadValidator

__all__ = [
    "agent_callable_functions",
    "check_agent_callable",
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


def _resolve_catalog(
    name: str,
    catalog_id: str | None,
    catalogs: Sequence[CatalogApi],
) -> CatalogApi:
    if catalog_id is not None:
        for catalog in catalogs:
            if catalog.catalog_id == catalog_id:
                return catalog
        raise A2uiValidationError(
            f"Function '{name}' names catalog '{catalog_id}', which is not active."
        )
    for catalog in catalogs:
        if name in catalog.functions:
            return catalog
    raise A2uiValidationError(
        f"Function '{name}' is not declared in any active catalog."
    )


def _validate_nested_calls(
    value: Any,
    default_catalog: CatalogApi,
    catalogs: Sequence[CatalogApi],
) -> None:
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        for item in value:
            _validate_nested_calls(item, default_catalog, catalogs)
        return
    if not isinstance(value, Mapping):
        return
    if "@call" in value and isinstance(value.get("@call"), str):
        nested_name = value["@call"]
        raw_cat = value.get("catalogId")
        if raw_cat is not None and not isinstance(raw_cat, str):
            raise A2uiValidationError(
                f"Function '{nested_name}' catalogId must be a string."
            )
        nested_cat = (
            default_catalog
            if nested_name.startswith("@")
            else (
                _resolve_catalog(nested_name, raw_cat, catalogs)
                if raw_cat
                else default_catalog
            )
        )
        raw_nested_args = value.get("args")
        if raw_nested_args is not None and not isinstance(raw_nested_args, Mapping):
            raise A2uiValidationError(
                f"Function '{nested_name}' arguments must be an object."
            )
        nested_args = (
            dict(raw_nested_args) if isinstance(raw_nested_args, Mapping) else None
        )
        PayloadValidator(catalog=nested_cat).validate_function(nested_name, nested_args)
        if nested_args is not None:
            _validate_nested_calls(nested_args, default_catalog, catalogs)
        return
    for item in value.values():
        _validate_nested_calls(item, default_catalog, catalogs)


def check_agent_callable(
    message: Mapping[str, Any],
    catalogs: Sequence[CatalogApi],
) -> None:
    """Validates that a `callRendererFunction` message calls an agent-callable function.

    Args:
        message: An agent-to-renderer message dictionary.
        catalogs: Active catalogs in priority order.

    Raises:
        A2uiValidationError: If the target catalog is inactive, the function is
            undeclared, the function requires user activation or declares
            `allowedCallers: "rendererOnly"`, or its arguments fail schema
            validation.
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
    if raw_catalog_id is not None and not isinstance(raw_catalog_id, str):
        raise A2uiValidationError(f"Function '{raw_name}' catalogId must be a string.")
    catalog_id = raw_catalog_id if raw_catalog_id else None
    target_catalog = _resolve_catalog(raw_name, catalog_id, catalogs)
    fn: FunctionApi | None = target_catalog.functions.get(raw_name)
    if fn is None:
        raise A2uiValidationError(
            f"Function '{raw_name}' is not declared in catalog"
            f" '{target_catalog.catalog_id}'."
        )
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
    raw_args = call_fn.get("args")
    if raw_args is not None and not isinstance(raw_args, Mapping):
        raise A2uiValidationError(f"Function '{raw_name}' arguments must be an object.")
    args_dict = dict(raw_args) if isinstance(raw_args, Mapping) else None
    PayloadValidator(catalog=target_catalog).validate_function(raw_name, args_dict)
    if args_dict is not None:
        _validate_nested_calls(args_dict, target_catalog, catalogs)
