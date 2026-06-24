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
from ..common.events import EventSource, Subscription
from .surface_model import SurfaceModel


class SurfaceGroupModel:
    """The global manager and lifecycle container for all surfaces."""

    def __init__(self):
        self.surfaces: Dict[str, SurfaceModel] = {}
        self._surface_unsubscribers: Dict[str, Subscription] = {}

        self.on_surface_created = EventSource()
        self.on_surface_deleted = EventSource()
        self.on_action = EventSource()

    def get_surface(self, surface_id: str) -> Optional[SurfaceModel]:
        return self.surfaces.get(surface_id)

    def add_surface(self, surface: SurfaceModel) -> None:
        if surface.id in self.surfaces:
            return

        self.surfaces[surface.id] = surface
        # Forward actions from surface to global group listener and store subscription
        sub = surface.on_action.subscribe(lambda act: self.on_action.emit(act))
        self._surface_unsubscribers[surface.id] = sub

        self.on_surface_created.emit(surface)

    def delete_surface(self, surface_id: str) -> None:
        if surface_id in self.surfaces:
            surface = self.surfaces[surface_id]
            sub = self._surface_unsubscribers.pop(surface_id, None)
            if sub and hasattr(sub, "unsubscribe"):
                sub.unsubscribe()

            del self.surfaces[surface_id]
            surface.dispose()
            self.on_surface_deleted.emit(surface_id)

    @property
    def surfaces_map(self) -> Dict[str, SurfaceModel]:
        """Returns the dictionary of all active surfaces."""
        return self.surfaces

    def dispose(self) -> None:
        """Disposes of the group and all its surfaces."""
        for surface_id in list(self.surfaces.keys()):
            self.delete_surface(surface_id)
        if hasattr(self.on_surface_created, "dispose"):
            self.on_surface_created.dispose()
        if hasattr(self.on_surface_deleted, "dispose"):
            self.on_surface_deleted.dispose()
        if hasattr(self.on_action, "dispose"):
            self.on_action.dispose()
