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

"""In-memory hierarchy container for A2UI builder component trees."""

from __future__ import annotations

import json
from typing import Any, Optional, Sequence

from .base_node import ComponentBuilderNode
from .flattener import flatten_component_tree


class ComponentTree:
    """An in-memory hierarchy of components, containing a primary root and any unlinked subtrees."""

    def __init__(
        self,
        root: ComponentBuilderNode,
        unlinked_roots: Sequence[ComponentBuilderNode] | None = None,
        surface_id: str | None = None,
    ):
        self.root = root
        self.unlinked_roots = list(unlinked_roots or [])
        self.surface_id = surface_id

    def to_components(self) -> list[dict[str, Any]]:
        """Serializes the primary tree and all unlinked subtrees into flat component dicts."""
        comps = flatten_component_tree(self.root, root_id=self.root.id or "root")
        for sub_tree in self.unlinked_roots:
            comps.extend(flatten_component_tree(sub_tree, root_id=sub_tree.id or "sub"))
        return comps

    def to_json(self, indent: Optional[int] = None) -> str:
        """Serializes the component list into a JSON string."""
        return json.dumps(self.to_components(), indent=indent)

    def to_update(self, surface_id: str | None = None) -> dict[str, Any]:
        """Packages the tree into an updateComponents envelope for incremental updates."""
        target_id = surface_id or self.surface_id or "main"
        return {
            "updateComponents": {
                "surfaceId": target_id,
                "components": self.to_components(),
            }
        }

    def to_surface(
        self,
        surface_id: str | None = None,
        catalog_id: str | None = None,
        data_model: Optional[dict[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        """Packages the tree into createSurface, updateComponents, and optional updateDataModel envelopes."""
        target_id = surface_id or self.surface_id or "main"
        create_env: dict[str, Any] = {"createSurface": {"surfaceId": target_id}}
        if catalog_id:
            create_env["createSurface"]["catalogId"] = catalog_id
        messages: list[dict[str, Any]] = [create_env, self.to_update(target_id)]
        if data_model:
            for path, val in data_model.items():
                norm_path = path if path.startswith("/") else f"/{path}"
                messages.append({
                    "updateDataModel": {
                        "surfaceId": target_id,
                        "path": norm_path,
                        "value": val,
                    }
                })
        return messages

    def prune_unlinked(self) -> None:
        """Clears all unlinked subtrees from the container."""
        self.unlinked_roots.clear()
