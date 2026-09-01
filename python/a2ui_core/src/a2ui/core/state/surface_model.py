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
        available_catalogs: Sequence[Catalog[TComponent, TFunction]] | None = None,
        theme: dict[str, Any] | None = None,
        send_data_model: bool = False,
        data_model: DataModel | None = None,
    ) -> None:
        self.id = surface_id
        self.default_catalog = default_catalog
        self.available_catalogs: list[Catalog[TComponent, TFunction]] = list(
            available_catalogs or [default_catalog]
        )
        if default_catalog not in self.available_catalogs:
            self.available_catalogs.append(default_catalog)
        self.theme = theme or {}
        self.send_data_model = send_data_model

        self.data_model = data_model or DataModel()
        self.components_model = SurfaceComponentsModel()
        self.root_id: str | None = None
        self.on_action = EventSource()
        self.on_error = EventSource()

    def validate_catalog_versions(self) -> None:
        """Verifies that all active catalogs mixed within this surface share the same protocolVersion."""
        cats_to_check: list[Catalog[Any, Any]] = [self.default_catalog]
        for cat in self.available_catalogs:
            if cat not in cats_to_check:
                cats_to_check.append(cat)
        for comp in self.components_model.get_all().values():
            if isinstance(comp.catalog, Catalog) and comp.catalog not in cats_to_check:
                cats_to_check.append(comp.catalog)

        cats_tuple = tuple(sorted(cats_to_check, key=lambda c: id(c)))
        if getattr(self, "_validated_catalogs_cache", None) == cats_tuple:
            return

        versions = {
            cat.protocol_version.value
            if hasattr(cat.protocol_version, "value")
            else str(cat.protocol_version)
            for cat in cats_to_check
            if getattr(cat, "protocol_version", None) is not None
        }
        if len(versions) > 1:
            vers_str = ", ".join(sorted(versions))
            raise A2uiCatalogError(
                f"Mixed catalogs on surface '{self.id}' have mismatched protocol"
                f" versions: {vers_str}."
            )
        self._validated_catalogs_cache = cats_tuple

    def dispatch_action(
        self, payload: dict[str, Any], source_component_id: str
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
            "timestamp": (
                datetime.datetime.now(datetime.timezone.utc)
                .isoformat()
                .replace("+00:00", "Z")
            ),
            "context": event_payload.get("context", event_payload.get("args", {})),
        }
        self.on_action.emit(action_event)

    def dispatch_error(self, error: dict[str, Any]) -> None:
        """Dispatches an error from this surface to listeners."""
        err_payload = copy.deepcopy(error)
        if "surfaceId" not in err_payload:
            err_payload["surfaceId"] = self.id
        self.on_error.emit(err_payload)

    @property
    def catalogs(self) -> dict[str, Catalog[TComponent, TFunction]]:
        res: dict[str, Catalog[TComponent, TFunction]] = {}
        for comp in self.components_model.get_all().values():
            res[comp.id] = cast(Catalog[TComponent, TFunction], comp.catalog)
        return res

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
