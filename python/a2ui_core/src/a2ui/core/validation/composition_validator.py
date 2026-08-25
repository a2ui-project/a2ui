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

from typing import Any, Dict, List, Optional

from ..catalog import Catalog
from ..catalog.catalog import TComponent, TFunction
from ..exceptions import A2uiValidationError
from ..state.component_model import ComponentModel


def validate_composition_constraints(
    catalog: Optional[Catalog[TComponent, TFunction]],
    existing_components: Dict[str, ComponentModel],
    new_components: List[Dict[str, Any]],
) -> None:
    """Validates allowed_parents and allowed_children composition constraints for component trees."""
    type_map: Dict[str, str] = {}
    child_map: Dict[str, List[str]] = {}

    # 1. Populate from existing surface components
    for comp_id, model in existing_components.items():
        type_map[comp_id] = model.type
        children_list = [ref_id for ref_id, _ in model.get_child_references()]
        if children_list:
            child_map[comp_id] = children_list

    # 2. Populate / override from inbound component payload updates
    for comp in new_components:
        c_id = comp.get("id")
        c_type = comp.get("component")
        if isinstance(c_id, str) and isinstance(c_type, str):
            type_map[c_id] = c_type
        if isinstance(c_id, str):
            props = {k: v for k, v in comp.items() if k not in ("id", "component")}
            temp_comp = ComponentModel(c_id, c_type or "Unknown", props)
            inbound_children_list = [
                ref_id for ref_id, _ in temp_comp.get_child_references()
            ]
            if inbound_children_list:
                child_map[c_id] = inbound_children_list
            elif c_id in child_map:
                del child_map[c_id]

    # Build parent map: child_id -> { "parent_id": ..., "parent_type": ... }
    parent_map: Dict[str, Dict[str, str]] = {}
    for parent_id, children in child_map.items():
        parent_type = type_map.get(parent_id, "Unknown")
        for child_id in children:
            parent_map[child_id] = {
                "parent_id": parent_id,
                "parent_type": parent_type,
            }

    # 3. Validate constraints for each component
    if not catalog or not hasattr(catalog, "get_component"):
        return

    for comp_id, component_type in type_map.items():
        component_api = catalog.get_component(component_type)
        if not component_api:
            continue

        # Parent constraint validation
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
                raise A2uiValidationError(
                    f"Component '{comp_id}' ({component_type}) cannot be placed"
                    f" under parent '{parent_id}' ({parent_type}). Allowed parents:"
                    f" {allowed_parents}."
                )

        # Child constraint validation
        allowed_children = getattr(component_api, "allowed_children", None)
        if allowed_children:
            children = child_map.get(comp_id, [])
            for child_id in children:
                child_type = type_map.get(child_id)
                if child_type and child_type not in allowed_children:
                    raise A2uiValidationError(
                        f"Container '{comp_id}' ({component_type}) cannot contain"
                        f" child '{child_id}' ({child_type}). Allowed children:"
                        f" {allowed_children}."
                    )
