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

from typing import Any, Optional, Sequence, Union
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

Root = Union[ComponentBuilderNode, Sequence[ComponentBuilderNode]]


def _default_root_id(root: Root) -> Optional[str]:
    """Anchors a single root to its own ID; a list of roots has no shared anchor."""
    if isinstance(root, ComponentBuilderNode):
        return root.id or "root"
    return None


def _to_update_message(
    root: Root,
    surface_id: str = "main",
    root_id: Optional[str] = None,
) -> UpdateComponentsMessage:
    """Packages a component hierarchy into a v0.9 updateComponents message.

    Shared by both public entry points: establishing a surface sends this
    alongside a createSurface, and updating one sends it alone.
    """
    return UpdateComponentsMessage(
        update_components=UpdateComponents(
            surface_id=surface_id,
            components=flatten_component_tree(
                root, root_id=root_id or _default_root_id(root)
            ),
        )
    )


def create_surface(
    surface_id: str,
    root: Root,
    *,
    catalog_id: str | None = None,
    data_model: Optional[dict[str, Any]] = None,
    root_id: Optional[str] = None,
) -> list[A2uiMessage]:
    """Creates messages to establish a new surface (createSurface + updateComponents + optional updateDataModel)."""
    messages: list[A2uiMessage] = [
        CreateSurfaceMessage(
            create_surface=CreateSurface(
                surface_id=surface_id,
                catalog_id=catalog_id or DEFAULT_CATALOG_ID,
            )
        ),
        _to_update_message(root, surface_id=surface_id, root_id=root_id),
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


def update_components(
    surface_id: str,
    root: Root,
    *,
    root_id: Optional[str] = None,
) -> list[A2uiMessage]:
    """Creates an incremental surface update message (updateComponents only)."""
    return [_to_update_message(root=root, surface_id=surface_id, root_id=root_id)]
