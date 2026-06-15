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

import copy
from typing import Any, Dict, Optional
from ..common.events import EventSource


class ComponentModel:
    """Represents a single active UI component instance."""

    def __init__(
        self,
        component_id: str,
        component_type: str,
        properties: Optional[Dict[str, Any]] = None,
    ):
        self.id = component_id
        self.type = component_type
        self._properties = copy.deepcopy(properties or {})
        self.on_updated = EventSource()

    @property
    def properties(self) -> Dict[str, Any]:
        return self._properties

    @properties.setter
    def properties(self, new_props: Dict[str, Any]) -> None:
        self._properties = copy.deepcopy(new_props)
        self.on_updated.emit(self)

    @property
    def component_tree(self) -> Dict[str, Any]:
        """Returns a dictionary representation of the component tree."""
        tree = {"id": self.id, "type": self.type}
        tree.update(self._properties)
        return tree

    def dispose(self) -> None:
        """Disposes of the component and its resources."""
        if hasattr(self.on_updated, "dispose"):
            self.on_updated.dispose()
