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
from typing import Any, Optional

from .base_node import ComponentBuilderNode
from .flattener import flatten_component_tree


class ComponentTree:
    """Transport-agnostic container holding a root ``ComponentBuilderNode`` and optional ``surface_id``."""

    def __init__(
        self,
        root: ComponentBuilderNode,
        surface_id: str | None = None,
    ):
        self.root = root
        self.surface_id = surface_id

    def flatten(self) -> list[dict[str, Any]]:
        """Serializes the primary tree into flat component dicts."""
        return flatten_component_tree(self.root, root_id=self.root.id or "root")

    def to_json(self, indent: Optional[int] = None) -> str:
        """Serializes the component list into a JSON string."""
        return json.dumps(self.flatten(), indent=indent)
