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

"""Graph integrity, topology analysis, and composition constraint checks for ComponentModel trees."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from ..catalog import Catalog
from ..catalog.catalog import TComponent, TFunction
from ..exceptions import (
    A2uiErrorDetail,
    A2uiIntegrityError,
    A2uiRecursionError,
    A2uiValidationError,
)
from .component_model import ComponentModel

if TYPE_CHECKING:
    from ..validation.payload_validator import ValidationConfig

ROOT_ID = "root"
MAX_GLOBAL_DEPTH = 50
MAX_FUNC_CALL_DEPTH = 5
RELAXED_PATH_PATTERN = re.compile(
    r"^(?:(?:\/(?:[^~\/]|~[01])*)*|(?:[^~\/]|~[01])+(?:\/(?:[^~\/]|~[01])*)*)$"
)


def validate_component_integrity(
    components: dict[str, ComponentModel],
    root_id: str = ROOT_ID,
    config: ValidationConfig | None = None,
) -> None:
    """Validates component ID validity, root component existence, and non-dangling references."""
    allow_dangling_references = config.allow_dangling_references if config else False
    allow_missing_root = config.allow_missing_root if config else False

    ids: set[str] = set(components.keys())

    if allow_dangling_references:
        return

    if not allow_missing_root and root_id not in ids:
        raise A2uiIntegrityError(
            f"Missing root component: No component has id='{root_id}'"
        )

    for comp_id, comp in components.items():
        if comp_id is None or not isinstance(comp_id, str):
            raise A2uiIntegrityError("Component must have a valid string 'id'")
        for ref_id, field_name in comp.get_child_references(known_component_ids=ids):
            if ref_id not in ids:
                raise A2uiIntegrityError(
                    f"Dangling reference: Component '{comp_id}' references non-existent"
                    f" component '{ref_id}' in field '{field_name}'"
                )


def validate_recursion_and_paths(data: Any) -> None:
    """Traverses message payload structures verifying recursion depth and data pointer path syntax."""

    def traverse(item: Any, global_depth: int, func_depth: int) -> None:
        if global_depth > MAX_GLOBAL_DEPTH:
            raise A2uiRecursionError(
                f"Global recursion limit exceeded: Depth > {MAX_GLOBAL_DEPTH}"
            )

        if isinstance(item, list):
            for x in item:
                traverse(x, global_depth + 1, func_depth)
            return

        if isinstance(item, dict):
            if "path" in item and isinstance(item["path"], str):
                path = item["path"]
                if not re.fullmatch(RELAXED_PATH_PATTERN, path):
                    raise A2uiValidationError(
                        f"Invalid path syntax: '{path}'",
                        details=[
                            A2uiErrorDetail(
                                path="path",
                                code="invalid_pointer",
                                message=f"Invalid path syntax: '{path}'",
                            )
                        ],
                    )

            is_func_v08 = "functionCall" in item and isinstance(
                item["functionCall"], dict
            )
            is_func_v09 = "call" in item and "args" in item

            if is_func_v08:
                if func_depth >= MAX_FUNC_CALL_DEPTH:
                    raise A2uiRecursionError(
                        "Recursion limit exceeded: functionCall depth >"
                        f" {MAX_FUNC_CALL_DEPTH}"
                    )
                traverse(item["functionCall"], global_depth + 1, func_depth + 1)
            elif is_func_v09:
                if func_depth >= MAX_FUNC_CALL_DEPTH:
                    raise A2uiRecursionError(
                        "Recursion limit exceeded: functionCall depth >"
                        f" {MAX_FUNC_CALL_DEPTH}"
                    )
                for k, v in item.items():
                    if k == "args":
                        traverse(v, global_depth + 1, func_depth + 1)
                    else:
                        traverse(v, global_depth + 1, func_depth)
            else:
                for v in item.values():
                    traverse(v, global_depth + 1, func_depth)

    traverse(data, 0, 0)


def analyze_topology(
    components: dict[str, ComponentModel],
    root_id: str = ROOT_ID,
    config: ValidationConfig | None = None,
) -> set[str]:
    """Analyzes component graph topology for self-references, circular cycles, and unreachable orphans."""
    allow_orphan_components = config.allow_orphan_components if config else False
    allow_missing_root = config.allow_missing_root if config else False

    adj_list: dict[str, list[str]] = {}
    all_ids: set[str] = set(components.keys())

    for comp_id, comp in components.items():
        if comp_id is None:
            continue
        if comp_id not in adj_list:
            adj_list[comp_id] = []

        for ref_id, field_name in comp.get_child_references(
            known_component_ids=all_ids
        ):
            if ref_id == comp_id:
                raise A2uiRecursionError(
                    f"Self-reference detected: Component '{comp_id}' references itself"
                    f" in field '{field_name}'"
                )
            adj_list[comp_id].append(ref_id)

    visited: set[str] = set()
    recursion_stack: set[str] = set()

    def dfs(node_id: str, depth: int) -> None:
        if depth > MAX_GLOBAL_DEPTH:
            raise A2uiRecursionError(
                f"Global recursion limit exceeded: logical depth > {MAX_GLOBAL_DEPTH}"
            )

        visited.add(node_id)
        recursion_stack.add(node_id)

        for neighbor in adj_list.get(node_id, []):
            if neighbor not in visited:
                dfs(neighbor, depth + 1)
            elif neighbor in recursion_stack:
                raise A2uiRecursionError(
                    f"Circular reference detected involving component '{neighbor}'"
                )

        recursion_stack.remove(node_id)

    if allow_missing_root:
        for node_id in sorted(list(all_ids)):
            if node_id not in visited:
                dfs(node_id, 0)
    else:
        if root_id in all_ids:
            dfs(root_id, 0)

        if not allow_orphan_components:
            orphans = all_ids - visited
            if orphans:
                sorted_orphans = sorted(list(orphans))
                raise A2uiIntegrityError(
                    f"Component '{sorted_orphans[0]}' is not reachable from '{root_id}'"
                )

    return visited


def validate_composition_constraints(
    components: dict[str, ComponentModel],
) -> None:
    """Validates allowed_parents and allowed_children composition constraints for component trees."""
    type_map: dict[str, str] = {
        comp_id: model.type for comp_id, model in components.items()
    }
    child_map: dict[str, list[str]] = {}
    for comp_id, model in components.items():
        children = [ref_id for ref_id, _ in model.get_child_references()]
        if children:
            child_map[comp_id] = children

    parent_map: dict[str, dict[str, str]] = {}
    for parent_id, children in child_map.items():
        parent_type = type_map.get(parent_id, "Unknown")
        for child_id in children:
            parent_map[child_id] = {
                "parent_id": parent_id,
                "parent_type": parent_type,
            }

    for comp_id, model in components.items():
        if model.catalog is None or not hasattr(model.catalog, "get_component"):
            continue
        component_api = model.catalog.get_component(model.type)
        if not component_api:
            continue

        allowed_parents = getattr(component_api, "allowed_parents", None)
        if allowed_parents:
            parent_info = parent_map.get(comp_id)
            if parent_info is None:
                parent_type = "Surface"
                parent_id = "Surface"
            else:
                parent_type = parent_info["parent_type"]
                parent_id = parent_info["parent_id"]

            if parent_type not in allowed_parents:
                msg = (
                    f"Component '{comp_id}' ({model.type}) cannot be placed"
                    f" under parent '{parent_id}' ({parent_type}). Allowed parents:"
                    f" {allowed_parents}."
                )
                raise A2uiValidationError(
                    msg,
                    details=[
                        A2uiErrorDetail(
                            path=f"components.{comp_id}",
                            code="UNALLOWED_PARENT",
                            message=msg,
                        )
                    ],
                )

        allowed_children = getattr(component_api, "allowed_children", None)
        if allowed_children:
            children = child_map.get(comp_id, [])
            for child_id in children:
                child_type = type_map.get(child_id)
                if child_type and child_type not in allowed_children:
                    msg = (
                        f"Component '{comp_id}' ({model.type}) cannot contain child"
                        f" '{child_id}' ({child_type}). Allowed children:"
                        f" {allowed_children}."
                    )
                    raise A2uiValidationError(
                        msg,
                        details=[
                            A2uiErrorDetail(
                                path=f"components.{comp_id}",
                                code="UNALLOWED_CHILD",
                                message=msg,
                            )
                        ],
                    )
