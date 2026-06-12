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
from .data_model import DataModel
from .surface_components_model import SurfaceComponentsModel


class SurfaceModel:
    """Represents a single active UI Surface state tree."""

    def __init__(
        self,
        surface_id: str,
        catalog: Any,
        theme: Optional[Dict[str, Any]] = None,
        send_data_model: bool = False,
        locale: Optional[str] = None,
    ):
        self.id = surface_id
        self.catalog = catalog
        self.theme = theme or {}
        self.send_data_model = send_data_model
        self.locale = locale

        self.data_model = DataModel()
        self.components_model = SurfaceComponentsModel()
        self.on_action = EventSource()
        self.on_error = EventSource()

    def dispatch_action(
        self, payload: Dict[str, Any], source_component_id: str
    ) -> None:
        """Triggers action emission from component interactives."""
        import datetime

        now_str = datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")
        action_event = {
            "name": payload.get("name", ""),
            "surfaceId": self.id,
            "sourceComponentId": source_component_id,
            "timestamp": now_str,
            "context": payload.get("context", {}),
        }
        self.on_action.emit(action_event)

    def dispatch_error(self, error: Dict[str, Any]) -> None:
        """Dispatches an error from this surface to listeners."""
        err_payload = copy.deepcopy(error)
        err_payload["surfaceId"] = self.id
        self.on_error.emit(err_payload)

    def dispose(self) -> None:
        """Disposes of the surface and its resources."""
        self.data_model.dispose()
        self.components_model.dispose()
        if hasattr(self.on_action, "dispose"):
            self.on_action.dispose()
        if hasattr(self.on_error, "dispose"):
            self.on_error.dispose()
