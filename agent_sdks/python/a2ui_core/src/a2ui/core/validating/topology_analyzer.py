# Copyright 2026 Google LLC
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

from typing import Any, Dict, List, Optional, Set, Tuple, Mapping
from .integrity_checker import get_component_references, MAX_GLOBAL_DEPTH
from ..schema.constants import ROOT_ID
from ..exceptions import A2uiRecursionError, A2uiIntegrityError


def analyze_topology(
    components: List[Dict[str, Any]],
    ref_fields_map: Mapping[str, Tuple[Set[str], Set[str]]],
    root_id: str = ROOT_ID,
    allow_orphan_components: bool = False,
    allow_missing_root: bool = False,
) -> Set[str]:
    adj_list: Dict[str, List[str]] = {}
    all_ids: Set[str] = set()

    # Build Adjacency List
    for comp in components:
        comp_id = comp.get("id")
        if comp_id is None:
            continue

        all_ids.add(comp_id)
        if comp_id not in adj_list:
            adj_list[comp_id] = []

        for ref_id, field_name in get_component_references(comp, ref_fields_map):
            if ref_id == comp_id:
                raise A2uiRecursionError(
                    f"Self-reference detected: Component '{comp_id}' references itself in field"
                    f" '{field_name}'"
                )
            adj_list[comp_id].append(ref_id)

    # Detect Cycles and Depth using DFS
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
        # No root provided or allowed missing (e.g. partial update): we traverse everything to check for cycles
        for node_id in sorted(list(all_ids)):
            if node_id not in visited:
                dfs(node_id, 0)
    else:
        if root_id in all_ids:
            dfs(root_id, 0)

        # Check for Orphans if prohibited
        if not allow_orphan_components:
            orphans = all_ids - visited
            if orphans:
                sorted_orphans = sorted(list(orphans))
                raise A2uiIntegrityError(
                    f"Component '{sorted_orphans[0]}' is not reachable from '{root_id}'"
                )

    return visited
