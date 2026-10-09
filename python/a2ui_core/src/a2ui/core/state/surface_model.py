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
from typing import Any, cast
from ..common.events import EventSource
from .data_model import DataModel
from .surface_components_model import SurfaceComponentsModel
from ..catalog import CatalogApi
from ..schema import ProtocolVersion


from collections.abc import Sequence
from ..exceptions import A2uiCatalogError


class SurfaceModel:
    """Represents a single active UI Surface state tree."""

    def __init__(
        self,
        surface_id: str,
        default_catalog: CatalogApi | None,
        available_catalogs: dict[str, CatalogApi] | None = None,
        theme: dict[str, Any] | None = None,
        send_data_model: bool = False,
        data_model: DataModel | None = None,
        root_id: str = "root",
        protocol_version: ProtocolVersion | str | None = None,
    ) -> None:
        self.id = surface_id
        # From v1.0 a surface may name no default catalog, so that each
        # component and function call names its own.
        self.default_catalog = default_catalog
        # The surface's protocol version. Defaults to the default catalog's
        # version; surfaces without a default catalog pass it explicitly.
        self.protocol_version: ProtocolVersion | str | None = (
            protocol_version or getattr(default_catalog, "protocol_version", None)
        )
        catalogs: dict[str, CatalogApi] = (
            dict(available_catalogs) if available_catalogs else {}
        )
        if (
            default_catalog is not None
            and default_catalog.id
            and default_catalog.id not in catalogs
        ):
            catalogs[default_catalog.id] = default_catalog
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
    def catalog(self) -> CatalogApi | None:
        """The surface's default catalog (deprecated alias for default_catalog)."""
        return self.default_catalog

    def resolve_catalog(
        self, catalog_id: str | None, *, subject: str = "Item"
    ) -> CatalogApi:
        """Resolves the catalog that an item on this surface runs in.

        From v1.0 a component or function call runs in the catalog it names,
        looked up in `available_catalogs`, or else in the surface's default
        catalog. There is no other fallback.

        Args:
            catalog_id: The `catalogId` the item names, or None if it names none.
                An empty string names a catalog too, so it does not fall back
                to the default.
            subject: Describes the item in the error message, e.g.
                "Function call 'formatString'".

        Returns:
            The catalog the item runs in.

        Raises:
            A2uiCatalogError: If the named catalog is not available on this
                surface, or the item names none and the surface has no default.
        """
        if catalog_id is not None:
            catalog = self.available_catalogs.get(catalog_id)
            if catalog is None:
                raise A2uiCatalogError(f"Catalog not found: {catalog_id}")
            return catalog
        if self.default_catalog is None:
            raise A2uiCatalogError(
                f"{subject} names no catalogId and surface {self.id} has no"
                " default catalogId."
            )
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
        if "event" in payload and isinstance(payload["event"], dict):
            event_payload = payload["event"]
        elif "name" in payload:
            event_payload = payload
        else:
            return

        event_dict = event_payload if isinstance(event_payload, dict) else {}
        name = event_dict.get("name")
        if not name or not isinstance(name, str):
            return

        if not catalog_id:
            catalog_id = event_dict.get("catalogId")

        raw_context = event_dict.get("context")
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
        if isinstance(user_message, str) and user_message:
            action_event["userMessage"] = user_message

        self.on_action.emit(action_event)

    def dispatch_error(self, error: dict[str, Any]) -> None:
        """Dispatches an error from this surface to listeners."""
        if not isinstance(error, dict):
            raise TypeError(
                f"Expected error payload to be a dict, got {type(error).__name__}"
            )
        err_payload = copy.deepcopy(error)
        err_payload["surfaceId"] = self.id
        self.on_error.emit(err_payload)

    def dispatch_warning(self, warning: dict[str, Any]) -> None:
        """Dispatches a non-fatal warning from this surface to listeners."""
        if not isinstance(warning, dict):
            raise TypeError(
                f"Expected warning payload to be a dict, got {type(warning).__name__}"
            )
        warn_payload = copy.deepcopy(warning)
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
        self.on_action.dispose()
        self.on_error.dispose()
        self.on_warning.dispose()
