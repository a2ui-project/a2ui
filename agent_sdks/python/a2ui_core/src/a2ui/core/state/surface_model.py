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
import warnings
from typing import Any, Dict, Optional
from ..common.events import EventSource
from .data_model import DataModel
from .surface_components_model import SurfaceComponentsModel
from ..catalog import Catalog
from ..catalog.catalog import TComponent, TFunction


class SurfaceModel:
    """Represents a single active UI Surface state tree."""

    def __init__(
        self,
        surface_id: str,
        catalog: Catalog[TComponent, TFunction],
        theme: Optional[Dict[str, Any]] = None,
        send_data_model: bool = False,
        data_model: Optional[DataModel] = None,
    ) -> None:
        self.id = surface_id
        self.catalog = catalog
        self.theme = theme or {}
        self.send_data_model = send_data_model

        self.data_model = data_model or DataModel()
        self.components_model = SurfaceComponentsModel()
        self.on_action = EventSource()
        self.on_error = EventSource()

    def dispatch_action(
        self, payload: Dict[str, Any], source_component_id: str
    ) -> None:
        """Triggers action emission from component interactives."""
        import datetime

        event_payload = payload
        if isinstance(payload, dict):
            if "event" in payload:
                event_payload = payload["event"]
            elif "functionCall" in payload:
                event_payload = payload["functionCall"]

        action_event = {
            "name": event_payload.get("name", event_payload.get("call", "")),
            "surfaceId": self.id,
            "sourceComponentId": source_component_id,
            "timestamp": datetime.datetime.now(datetime.timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
            "context": event_payload.get("context", event_payload.get("args", {})),
        }
        self.on_action.emit(action_event)

    def dispatch_error(self, error: Dict[str, Any]) -> None:
        """Dispatches an error from this surface to listeners."""
        err_payload = copy.deepcopy(error)
        err_payload["surfaceId"] = self.id
        self.on_error.emit(err_payload)

    def dispose(self) -> None:
        """Disposes of the surface and its resources."""
        if hasattr(self.data_model, "dispose") and callable(self.data_model.dispose):
            try:
                self.data_model.dispose()
            except Exception as e:
                warnings.warn(
                    f"Error disposing data_model on surface '{self.id}': {e}",
                    RuntimeWarning,
                    stacklevel=2,
                )
        if hasattr(self.components_model, "dispose") and callable(
            self.components_model.dispose
        ):
            try:
                self.components_model.dispose()
            except Exception as e:
                warnings.warn(
                    f"Error disposing components_model on surface '{self.id}': {e}",
                    RuntimeWarning,
                    stacklevel=2,
                )
