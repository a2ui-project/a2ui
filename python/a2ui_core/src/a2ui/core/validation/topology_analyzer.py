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

from __future__ import annotations

from typing import TYPE_CHECKING, Dict, List, Optional, Set

from ..state.component_model import ComponentModel
from ..exceptions import A2uiIntegrityError, A2uiRecursionError
from .integrity_checker import ROOT_ID, MAX_GLOBAL_DEPTH

if TYPE_CHECKING:
    from .catalog_schema_validator import ValidationConfig


def analyze_topology(
    components: Dict[str, ComponentModel],
    root_id: str = ROOT_ID,
    config: Optional[ValidationConfig] = None,
) -> Set[str]:
    allow_orphan_components = config.allow_orphan_components if config else False
    allow_missing_root = config.allow_missing_root if config else False

    adj_list: Dict[str, List[str]] = {}
    all_ids: Set[str] = set(components.keys())

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

    visited: Set[str] = set()
    recursion_stack: Set[str] = set()

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
