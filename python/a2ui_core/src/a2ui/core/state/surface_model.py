# Copyright 2024 Google LLC
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
from typing import Any, Generic, cast
from ..common.events import EventSource
from .data_model import DataModel
from .surface_components_model import SurfaceComponentsModel
from ..catalog import Catalog
from ..catalog.catalog import TComponent, TFunction


from collections.abc import Sequence
from ..exceptions import A2uiCatalogError


class SurfaceModel(Generic[TComponent, TFunction]):
    """Represents a single active UI Surface state tree."""

    def __init__(
        self,
        surface_id: str,
        default_catalog: Catalog[TComponent, TFunction],
        available_catalogs: dict[str, Catalog[TComponent, TFunction]] | None = None,
        theme: dict[str, Any] | None = None,
        send_data_model: bool = False,
        data_model: DataModel | None = None,
        root_id: str = "root",
    ) -> None:
        self.id = surface_id
        self.default_catalog = default_catalog
        catalogs: dict[str, Catalog[TComponent, TFunction]] = (
            dict(available_catalogs) if available_catalogs else {}
        )
        cat_id = getattr(default_catalog, "catalog_id", None) or getattr(
            default_catalog, "id", None
        )
        if cat_id and cat_id not in catalogs:
            catalogs[cat_id] = default_catalog
        self.available_catalogs = catalogs

        self.theme = theme or {}
        self.send_data_model = send_data_model

        self.data_model = data_model or DataModel()
        self.components_model = SurfaceComponentsModel(default_catalog)
        self.root_id = root_id
        self.on_action = EventSource()
        self.on_error = EventSource()
        self.on_warning = EventSource()

    @property
    def catalog(self) -> Catalog[TComponent, TFunction]:
        """The surface's default catalog (deprecated alias for default_catalog)."""
        return self.default_catalog

    def dispatch_action(
        self, payload: dict[str, Any], source_component_id: str
    ) -> None:
        """Triggers action emission from component interactives."""
        if not isinstance(payload, dict):
            return
        import datetime

        event_payload = payload
        catalog_id: str | None = payload.get("catalogId")
        if "event" in payload:
            event_payload = payload["event"]
        elif "functionCall" in payload:
            event_payload = payload["functionCall"]

        event_dict = event_payload if isinstance(event_payload, dict) else {}
        name = event_dict.get("name", event_dict.get("call", ""))
        if not name or not isinstance(name, str):
            return

        if not catalog_id:
            catalog_id = event_dict.get("catalogId")

        raw_context = event_dict.get("context", event_dict.get("args", {}))
        context = raw_context if isinstance(raw_context, dict) else {}

        action_event: dict[str, Any] = {
            "name": name,
            "surfaceId": self.id,
            "sourceComponentId": source_component_id,
            "timestamp": (
                datetime.datetime.now(datetime.timezone.utc)
                .isoformat()
                .replace("+00:00", "Z")
            ),
            "context": context,
        }
        if catalog_id and isinstance(catalog_id, str):
            action_event["catalogId"] = catalog_id
        user_message = event_dict.get("userMessage")
        if user_message is not None:
            action_event["userMessage"] = str(user_message)

        self.on_action.emit(action_event)

    def dispatch_error(self, error: dict[str, Any]) -> None:
        """Dispatches an error from this surface to listeners."""
        err_payload = copy.deepcopy(error) if isinstance(error, dict) else {}
        err_payload["surfaceId"] = self.id
        self.on_error.emit(err_payload)

    def dispatch_warning(self, warning: dict[str, Any]) -> None:
        """Dispatches a non-fatal warning from this surface to listeners."""
        warn_payload = copy.deepcopy(warning) if isinstance(warning, dict) else {}
        warn_payload["surfaceId"] = self.id
        self.on_warning.emit(warn_payload)

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
        if hasattr(self.on_action, "dispose") and callable(self.on_action.dispose):
            self.on_action.dispose()
        if hasattr(self.on_error, "dispose") and callable(self.on_error.dispose):
            self.on_error.dispose()
        if hasattr(self.on_warning, "dispose") and callable(self.on_warning.dispose):
            self.on_warning.dispose()
