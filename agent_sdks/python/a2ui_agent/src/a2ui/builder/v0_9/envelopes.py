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
from a2ui.core.schema.server_to_client import (
    A2uiMessage,
    CreateSurface,
    CreateSurfaceMessage,
    UpdateComponents,
    UpdateComponentsMessage,
    UpdateDataModel,
    UpdateDataModelMessage,
)
from ..core.base_node import ComponentBuilderNode
from ..core.flattener import flatten_component_tree

DEFAULT_CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"


def to_update_message(
    root: ComponentBuilderNode, surface_id: str = "main"
) -> UpdateComponentsMessage:
    """Packages a component hierarchy into a v0.9 updateComponents message."""
    return UpdateComponentsMessage(
        update_components=UpdateComponents(
            surface_id=surface_id,
            components=flatten_component_tree(root, root_id=root.id or "root"),
        )
    )


def to_surface_messages(
    root: ComponentBuilderNode,
    surface_id: str = "main",
    catalog_id: Optional[str] = None,
    data_model: Optional[dict[str, Any]] = None,
) -> list[A2uiMessage]:
    """Packages a component hierarchy into v0.9 createSurface, updateComponents, and optional updateDataModel messages."""
    cat_id = catalog_id or DEFAULT_CATALOG_ID
    messages: list[A2uiMessage] = [
        CreateSurfaceMessage(
            create_surface=CreateSurface(surface_id=surface_id, catalog_id=cat_id)
        ),
        to_update_message(root, surface_id=surface_id),
    ]
    if data_model:
        for path, val in data_model.items():
            norm_path = path if path.startswith("/") else f"/{path}"
            messages.append(
                UpdateDataModelMessage(
                    update_data_model=UpdateDataModel(
                        surface_id=surface_id,
                        path=norm_path,
                        value=val,
                    )
                )
            )
    return messages


def create_surface(
    surface_id: str,
    root: ComponentBuilderNode,
    *,
    catalog_id: str | None = None,
    data_model: Optional[dict[str, Any]] = None,
) -> list[A2uiMessage]:
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
) -> list[A2uiMessage]:
    """Creates an incremental surface update message (updateComponents only)."""
    return [to_update_message(root=root, surface_id=surface_id)]
