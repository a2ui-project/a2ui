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

from typing import Any, Callable, Dict, List, Optional, Sequence, Union

from ..state import SurfaceGroupModel, SurfaceModel, ComponentModel
from ..validating import A2uiValidator, CatalogSchemaValidator, ValidationConfig, STRICT_VALIDATION
from ..catalog import Catalog
from ..catalog.catalog import TComponent, TFunction
from ..exceptions import (
    A2uiCatalogError,
    A2uiError,
    A2uiIntegrityError,
    A2uiValidationError,
)
from ..schema import ProtocolVersion, AgentToRendererMessagePayload
from .adapters import VersionAdapterFactory
from .operations import (
    InternalCreateSurfaceOp,
    InternalDeleteSurfaceOp,
    InternalOperation,
    InternalUpdateComponentsOp,
    InternalUpdateDataModelOp,
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

    def process_messages(self, messages: AgentToRendererMessagePayload) -> None:
        """Accepts a list of parsed JSON messages and executes them in order."""
        message_list = (
            messages.get("messages", []) if isinstance(messages, dict) else messages
        )

        if self.strict_mode:
            self.validator.validate_protocol_envelope(message_list)

        adapter = VersionAdapterFactory.resolve_from_payload(messages)
        operations = adapter.extract_operations(messages)
        for op in operations:
            self._process_operation(op)

    def get_renderer_capabilities(
        self,
        versions: List[ProtocolVersion],
        include_inline_catalogs: bool = False,
    ) -> Dict[str, Any]:
        """Generates renderer capabilities dictionary keyed by protocol version(s)."""
        capabilities: Dict[str, Any] = {}
        for ver in versions:
            version_caps: Dict[str, Any] = {
                "supportedCatalogIds": [
                    cat_id
                    for c in self.catalogs
                    if (cat_id := getattr(c, "catalog_id", None)) is not None
                ]
            }
            if include_inline_catalogs:
                version_caps["inlineCatalogs"] = [
                    schema
                    for c in self.catalogs
                    if (schema := getattr(c, "catalog_schema", None)) is not None
                ]
            capabilities[ver.value] = version_caps

        return capabilities

    def get_client_data_model(
        self, version: Union[str, ProtocolVersion] = ProtocolVersion.V0_9
    ) -> Optional[Dict[str, Any]]:
        """Aggregates active client data models for sync metadata."""
        surfaces = {}
        for surface in self.model.surfaces.values():
            if surface.send_data_model:
                surfaces[surface.id] = surface.data_model.get("/")

        if not surfaces:
            return None

        ver_str = (
            version.value if isinstance(version, ProtocolVersion) else str(version)
        )
        return {"version": ver_str, "surfaces": surfaces}

    def _process_operation(self, op: InternalOperation) -> None:
        """Dispatches canonical internal operations."""
        if isinstance(op, InternalCreateSurfaceOp):
            self._process_create_surface_op(op)
        elif isinstance(op, InternalDeleteSurfaceOp):
            self.model.delete_surface(op.surface_id)
        elif isinstance(op, InternalUpdateComponentsOp):
            self._process_update_components_op(op)
        elif isinstance(op, InternalUpdateDataModelOp):
            self._process_update_data_model_op(op)

    def _process_create_surface_op(self, op: InternalCreateSurfaceOp) -> None:
        surface_id = op.surface_id
        catalog_id = op.catalog_id
        theme = op.theme or {}
        send_data_model = op.send_data_model

        # Find matching catalog definition
        catalog = None
        if catalog_id:
            for cat in self.catalogs:
                if hasattr(cat, "catalog_id") and cat.catalog_id == catalog_id:
                    catalog = cat
                    break
            if not catalog:
                raise A2uiCatalogError(f"Catalog not found: {catalog_id}")
        elif self.catalogs:
            catalog = self.catalogs[0]
        else:
            raise A2uiCatalogError("No default catalog available for surface.")

        if self.model.get_surface(surface_id):
            raise A2uiIntegrityError(f"Surface {surface_id} already exists.")

        if self.strict_mode and theme:
            try:
                CatalogSchemaValidator.from_catalog(catalog).validate_theme(theme)
            except Exception as e:
                raise A2uiValidationError(
                    f"Validation failed for theme on surface '{surface_id}': {e}"
                )

        new_surface = SurfaceModel(
            surface_id=surface_id,
            catalog=catalog,
            theme=theme,
            send_data_model=send_data_model,
        )
        self.model.add_surface(new_surface)

        if op.components is not None:
            self._process_update_components_op(
                InternalUpdateComponentsOp(
                    surface_id=surface_id, components=op.components
                )
            )

        if op.data_model is not None:
            self._process_update_data_model_op(
                InternalUpdateDataModelOp(
                    surface_id=surface_id, path="/", value=op.data_model
                )
            )

    def _process_update_components_op(self, op: InternalUpdateComponentsOp) -> None:
        surface_id = op.surface_id
        surface = self.model.get_surface(surface_id)
        if not surface:
            raise A2uiIntegrityError(
                f"Surface not found for message: {surface_id}. Surface {surface_id} not"
                " found for components update."
            )
        catalog = surface.catalog
        if not catalog:
            raise A2uiCatalogError(
                f"Catalog for surface {surface_id} not found for components update."
            )

        components = op.components
        if not isinstance(components, list):
            raise A2uiValidationError("Components payload must be a list.")

        if self.strict_mode:
            try:
                self.validator.validate_components(
                    CatalogSchemaValidator.from_catalog(catalog),
                    components,
                    config=STRICT_VALIDATION,
                )
            except Exception as e:
                comp_types = [
                    c.get("component")
                    for c in components
                    if isinstance(c, dict) and c.get("component")
                ]
                comp_str = ", ".join(f"'{t}'" for t in comp_types if t)
                raise A2uiValidationError(
                    f"Validation failed for component {comp_str}: {e}"
                )

        for comp in components:
            comp_id = comp.get("id")
            if not comp_id:
                raise A2uiValidationError(
                    "Component update payload is missing an 'id' / missing required"
                    " 'id' field."
                )
            comp_type = comp.get("component")

            # Strip id and component envelope to isolate properties
            properties = {k: v for k, v in comp.items() if k not in ("id", "component")}

            existing = surface.components_model.get(comp_id)
            if existing:
                if comp_type and comp_type != existing.type:
                    surface.components_model.remove_component(comp_id)
                    new_comp = ComponentModel(comp_id, comp_type, properties)
                    surface.components_model.add_component(new_comp)
                else:
                    existing.properties = properties
            else:
                if not comp_type:
                    raise A2uiValidationError(
                        f"Cannot create component {comp_id} without a type."
                    )
                new_comp = ComponentModel(comp_id, comp_type, properties)
                surface.components_model.add_component(new_comp)

    def _process_update_data_model_op(self, op: InternalUpdateDataModelOp) -> None:
        surface_id = op.surface_id
        surface = self.model.get_surface(surface_id)
        if not surface:
            raise A2uiIntegrityError(
                f"Surface not found for message: {surface_id}. Surface {surface_id} not"
                " found for data model update."
            )

        path = op.path or "/"
        value = op.value

        surface.data_model.set(path, value)
