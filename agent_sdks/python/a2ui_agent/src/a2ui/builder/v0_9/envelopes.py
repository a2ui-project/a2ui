# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Protocol v0.9 wire envelope packaging helpers (server_to_client messages)."""

from __future__ import annotations

from typing import Any, Optional
from ..core.base_node import ComponentBuilderNode
from ..core.flattener import flatten_component_tree


def to_update_message(
    root: ComponentBuilderNode, surface_id: str = "main"
) -> dict[str, Any]:
    """Packages a component hierarchy into a v0.9 updateComponents message."""
    return {
        "updateComponents": {
            "surfaceId": surface_id,
            "components": flatten_component_tree(root, root_id=root.id or "root"),
        }
    }


def to_surface_messages(
    root: ComponentBuilderNode,
    surface_id: str = "main",
    catalog_id: Optional[str] = None,
    data_model: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    """Packages a component hierarchy into v0.9 createSurface, updateComponents, and optional updateDataModel messages."""
    create_env: dict[str, Any] = {"createSurface": {"surfaceId": surface_id}}
    if catalog_id:
        create_env["createSurface"]["catalogId"] = catalog_id
    messages: list[dict[str, Any]] = [
        create_env,
        to_update_message(root, surface_id=surface_id),
    ]
    if data_model:
        for path, val in data_model.items():
            norm_path = path if path.startswith("/") else f"/{path}"
            messages.append({
                "updateDataModel": {
                    "surfaceId": surface_id,
                    "path": norm_path,
                    "value": val,
                }
            })
    return messages


def create_surface(
    surface_id: str,
    root: ComponentBuilderNode,
    *,
    catalog_id: str | None = None,
    data_model: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    """Creates messages to establish a new surface (createSurface + updateComponents + optional updateDataModel)."""
    return to_surface_messages(
        root=root,
        surface_id=surface_id,
        catalog_id=catalog_id,
        data_model=data_model,
    )


def update_components(
    surface_id: str,
    root: ComponentBuilderNode,
) -> list[dict[str, Any]]:
    """Creates an incremental surface update message (updateComponents only)."""
    return [to_update_message(root=root, surface_id=surface_id)]
