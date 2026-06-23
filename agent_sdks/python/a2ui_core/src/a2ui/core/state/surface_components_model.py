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

from typing import Dict, Optional
from ..common.events import EventSource
from .component_model import ComponentModel


class SurfaceComponentsModel:
    """Manages the adjacency map of component configs in a surface."""

    def __init__(self):
        self._components: Dict[str, ComponentModel] = {}
        self.on_created = EventSource()
        self.on_deleted = EventSource()

    def get(self, component_id: str) -> Optional[ComponentModel]:
        return self._components.get(component_id)

    def get_all(self) -> Dict[str, ComponentModel]:
        return self._components

    def add_component(self, component: ComponentModel) -> None:
        if component.id in self._components:
            raise ValueError(f"Component with id '{component.id}' already exists.")
        self._components[component.id] = component
        self.on_created.emit(component)

    def remove_component(self, component_id: str) -> None:
        if component_id in self._components:
            comp = self._components[component_id]
            del self._components[component_id]
            comp.dispose()
            self.on_deleted.emit(component_id)

    def dispose(self) -> None:
        """Disposes of the model and all its components."""
        for component in list(self._components.values()):
            component.dispose()
        self._components.clear()
        if hasattr(self.on_created, "dispose"):
            self.on_created.dispose()
        if hasattr(self.on_deleted, "dispose"):
            self.on_deleted.dispose()
