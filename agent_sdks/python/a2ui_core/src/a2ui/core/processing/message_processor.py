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
from typing import Any, Callable, Dict, List, Optional, Union

from ..state import SurfaceGroupModel, SurfaceModel, ComponentModel
from ..validating import A2uiValidator, CatalogSchemaValidator, ValidationConfig, STRICT_VALIDATION
from ..catalog import Catalog
from ..catalog.catalog import TComponent, TFunction
from ..schema.constants import (
    MSG_TYPE_CREATE_SURFACE,
    MSG_TYPE_DELETE_SURFACE,
    MSG_TYPE_UPDATE_COMPONENTS,
    MSG_TYPE_UPDATE_DATA_MODEL,
)


class MessageProcessor:
    """The central logic controller for parsing protocol updates and mutating active state trees."""

    def __init__(
        self,
        catalogs: List[Catalog[TComponent, TFunction]],
        action_handler: Optional[Callable[[Dict[str, Any]], None]] = None,
        strict_mode: bool = False,
    ):
        if not catalogs:
            raise ValueError("At least one catalog must be provided.")
        self.catalogs = catalogs
        self.strict_mode = strict_mode
        self.model = SurfaceGroupModel()
        self.validator = A2uiValidator()
        if action_handler:
            self.model.on_action.subscribe(action_handler)

    def process_messages(
        self, messages: Union[List[Dict[str, Any]], Dict[str, Any]]
    ) -> None:
        """Accepts a list of parsed JSON messages and executes them in order."""
        message_list = (
            messages.get("messages", []) if isinstance(messages, dict) else messages
        )

        if self.strict_mode:
            self.validator.validate_protocol_envelope(message_list)

        for msg in message_list:
            self._process_message(msg)

    def get_client_capabilities(
        self, include_inline_catalogs: bool = False
    ) -> Dict[str, Any]:
        """Aggregates supported catalog schemas into standard A2UI capabilities."""
        v09_caps: Dict[str, Any] = {
            "supportedCatalogIds": [
                cat_id
                for c in self.catalogs
                if (cat_id := getattr(c, "catalog_id", None)) is not None
            ]
        }
        capabilities: Dict[str, Any] = {"v0.9": v09_caps}
        if include_inline_catalogs:
            # In Python core, we can export direct schemas as inline catalogs
            v09_caps["inlineCatalogs"] = [
                schema
                for c in self.catalogs
                if (schema := getattr(c, "catalog_schema", None)) is not None
            ]
        return capabilities

    def get_client_data_model(self) -> Optional[Dict[str, Any]]:
        """Aggregates active client data models for sync metadata."""
        surfaces = {}
        for surface in self.model.surfaces.values():
            if surface.send_data_model:
                surfaces[surface.id] = surface.data_model.get("/")

        if not surfaces:
            return None

        return {"version": "v0.9", "surfaces": surfaces}

    def _process_message(self, message: Dict[str, Any]) -> None:
        """Dispatches individual message payloads."""
        update_types = [
            k
            for k in (
                MSG_TYPE_CREATE_SURFACE,
                MSG_TYPE_UPDATE_COMPONENTS,
                MSG_TYPE_UPDATE_DATA_MODEL,
                MSG_TYPE_DELETE_SURFACE,
            )
            if k in message
        ]
        if len(update_types) > 1:
            raise ValueError(
                f"Message contains multiple conflicting update actions: {update_types}"
            )

        if MSG_TYPE_CREATE_SURFACE in message:
            self._process_create_surface(message[MSG_TYPE_CREATE_SURFACE])
        elif MSG_TYPE_DELETE_SURFACE in message:
            self._process_delete_surface(message[MSG_TYPE_DELETE_SURFACE])
        elif MSG_TYPE_UPDATE_COMPONENTS in message:
            self._process_update_components(message[MSG_TYPE_UPDATE_COMPONENTS])
        elif MSG_TYPE_UPDATE_DATA_MODEL in message:
            self._process_update_data_model(message[MSG_TYPE_UPDATE_DATA_MODEL])

    def _process_create_surface(self, payload: Dict[str, Any]) -> None:
        surface_id = payload.get("surfaceId")
        if not isinstance(surface_id, str):
            raise ValueError("surfaceId must be a string")
        catalog_id = payload.get("catalogId")
        theme = payload.get("theme", {})
        send_data_model = payload.get("sendDataModel", False)

        # Find matching catalog definition
        catalog = None
        for cat in self.catalogs:
            if hasattr(cat, "catalog_id") and cat.catalog_id == catalog_id:
                catalog = cat
                break

        if not catalog:
            raise ValueError(f"Catalog not found: {catalog_id}")

        if self.model.get_surface(surface_id):
            raise ValueError(f"Surface {surface_id} already exists.")

        if self.strict_mode and theme:
            try:
                CatalogSchemaValidator.from_catalog(catalog).validate_theme(theme)
            except Exception as e:
                raise ValueError(
                    f"Validation failed for theme on surface '{surface_id}': {e}"
                )

        new_surface = SurfaceModel(
            surface_id=surface_id,
            catalog=catalog,
            theme=theme,
            send_data_model=send_data_model,
        )
        self.model.add_surface(new_surface)

    def _process_delete_surface(self, payload: Dict[str, Any]) -> None:
        surface_id = payload.get("surfaceId")
        if isinstance(surface_id, str):
            self.model.delete_surface(surface_id)

    def _process_update_components(self, payload: Dict[str, Any]) -> None:
        surface_id = payload.get("surfaceId")
        if not isinstance(surface_id, str):
            return

        surface = self.model.get_surface(surface_id)
        if not surface:
            raise ValueError(f"Surface '{surface_id}' not found for components update.")
        catalog = surface.catalog
        if not catalog:
            raise ValueError(
                f"Catalog for surface '{surface_id}' not found for components update."
            )

        components = payload.get("components", [])

        if self.strict_mode:
            try:
                self.validator.validate_components(
                    CatalogSchemaValidator.from_catalog(catalog),
                    components,
                    config=STRICT_VALIDATION,
                )
            except Exception as e:
                err_msg = str(e)
                raise ValueError(
                    f"Components validation failed for surface '{surface_id}': {err_msg}"
                )

        for comp in components:
            comp_id = comp.get("id")
            if not comp_id:
                raise ValueError(
                    "Component update payload is missing required 'id' field."
                )
            comp_type = comp.get("component")

            # Strip id and component envelope to isolate properties
            properties = {k: v for k, v in comp.items() if k not in ("id", "component")}

            final_properties = properties

            existing = surface.components_model.get(comp_id)
            if existing:
                if comp_type and comp_type != existing.type:
                    # Recreate if type has mutated
                    surface.components_model.remove_component(comp_id)
                    new_comp = ComponentModel(comp_id, comp_type, final_properties)
                    surface.components_model.add_component(new_comp)
                else:
                    existing.properties = final_properties
            else:
                if not comp_type:
                    raise ValueError(
                        f"Cannot create component '{comp_id}' without a component type."
                    )
                new_comp = ComponentModel(comp_id, comp_type, final_properties)
                surface.components_model.add_component(new_comp)

    def _process_update_data_model(self, payload: Dict[str, Any]) -> None:
        surface_id = payload.get("surfaceId")
        if not isinstance(surface_id, str):
            return

        surface = self.model.get_surface(surface_id)
        if not surface:
            raise ValueError(f"Surface '{surface_id}' not found for data model update.")

        path = payload.get("path", "/")
        value = payload.get("value")

        # Set dynamically in reactive DataStore
        surface.data_model.set(path, value)
