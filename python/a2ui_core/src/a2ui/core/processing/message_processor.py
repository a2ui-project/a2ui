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
from typing import Any, Callable, Sequence, cast

from ..state import SurfaceGroupModel, SurfaceModel, ComponentModel
from ..validation import (
    PayloadValidator,
    ValidationConfig,
    STRICT_VALIDATION,
)
from ..catalog import Catalog
from ..catalog.catalog import TComponent, TFunction
from ..exceptions import (
    A2uiCatalogError,
    A2uiError,
    A2uiErrorDetail,
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
    """Core state engine that validates payloads, manages surfaces, and applies mutation ops."""

    def __init__(
        self,
        catalogs: list[Catalog[TComponent, TFunction]] | None = None,
        validation_config: ValidationConfig | None = None,
        action_handler: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        if not catalogs:
            raise ValueError("At least one catalog must be provided.")
        self.catalogs = catalogs
        self.model = SurfaceGroupModel()
        self.validation_config = validation_config
        if action_handler:
            self.model.on_action.subscribe(action_handler)

    def process_messages(self, messages: AgentToRendererMessagePayload) -> None:
        """Accepts a list of parsed JSON messages and executes them in order."""
        adapter = VersionAdapterFactory.resolve_from_payload(messages)
        operations = adapter.extract_operations(messages)
        for op in operations:
            self._process_operation(op)

    def get_renderer_capabilities(
        self,
        versions: list[ProtocolVersion],
        include_inline_catalogs: bool = False,
    ) -> dict[str, Any]:
        """Generates renderer capabilities dictionary keyed by protocol version(s)."""
        capabilities: dict[str, Any] = {}
        for ver in versions:
            version_caps: dict[str, Any] = {
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

    def get_renderer_data_model(
        self, version: str | ProtocolVersion = ProtocolVersion.V0_9
    ) -> dict[str, Any] | None:
        """Aggregates active renderer data models for sync metadata."""
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

        if catalog_id:
            matched_catalog = None
            for cat in self.catalogs:
                if getattr(cat, "catalog_id", None) == catalog_id:
                    matched_catalog = cat
                    break
            if not matched_catalog:
                raise A2uiCatalogError(f"Catalog not found: {catalog_id}")
            surface_catalog = matched_catalog
        elif self.catalogs:
            # v0.8 fallback: catalog_id is missing -> default to registered catalogs
            surface_catalog = self.catalogs[0]
        else:
            raise A2uiCatalogError("No default catalog available for surface.")

        if self.model.get_surface(surface_id):
            raise A2uiIntegrityError(f"Surface {surface_id} already exists.")

        if theme:
            try:
                PayloadValidator(
                    catalog=surface_catalog,
                    config=self.validation_config,
                ).validate_theme(theme)
            except Exception as e:
                raise A2uiValidationError(
                    f"Validation failed for theme on surface '{surface_id}': {e}"
                ) from e

        new_surface = SurfaceModel(
            surface_id=surface_id,
            default_catalog=surface_catalog,
            theme=theme,
            send_data_model=send_data_model,
        )
        if op.root:
            new_surface.root_id = op.root
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

        components = op.components
        if not isinstance(components, list):
            raise A2uiValidationError("Components payload must be a list.")

        component_catalogs: dict[str, Catalog[Any, Any]] = {}
        for comp in components:
            comp_dict = (
                comp
                if isinstance(comp, dict)
                else comp.model_dump(by_alias=True, exclude_none=True)
                if hasattr(comp, "model_dump")
                else cast(dict[str, Any], comp)
            )
            comp_id = comp_dict.get("id")
            if not comp_id:
                raise A2uiValidationError(
                    "Component update payload is missing an 'id' / missing required"
                    " 'id' field."
                )
            comp_cat_id = comp_dict.get("catalogId")
            if comp_cat_id:
                matched_catalog = None
                for cat in self.catalogs:
                    if getattr(cat, "catalog_id", None) == comp_cat_id:
                        matched_catalog = cat
                        break
                if not matched_catalog:
                    raise A2uiCatalogError(f"Catalog not found: {comp_cat_id}")
                component_catalogs[comp_id] = matched_catalog

            existing = surface.components_model.get(comp_id)
            comp_type = comp_dict.get("component")
            if not existing and not comp_type:
                raise A2uiValidationError(
                    f"Cannot create component {comp_id} without a type."
                )

        new_component_models: list[ComponentModel] = []
        for comp in components:
            comp_dict = (
                comp
                if isinstance(comp, dict)
                else comp.model_dump(by_alias=True, exclude_none=True)
                if hasattr(comp, "model_dump")
                else cast(dict[str, Any], comp)
            )
            c_id = cast(str, comp_dict.get("id"))
            existing = surface.components_model.get(c_id)
            c_type = cast(
                str, comp_dict.get("component") or (existing.type if existing else "")
            )

            properties = {
                k: v
                for k, v in comp_dict.items()
                if k not in ("id", "component", "catalogId")
            }

            comp_catalog = component_catalogs.get(c_id, surface.default_catalog)
            new_comp = ComponentModel(c_id, c_type, comp_catalog, properties)
            new_component_models.append(new_comp)

        surface.components_model.validate_components_update(
            new_component_models,
            root_id=surface.root_id or "root",
            config=self.validation_config,
        )

        for new_comp in new_component_models:
            existing = surface.components_model.get(new_comp.id)
            if existing:
                if existing.type != new_comp.type:
                    surface.components_model.remove_component(new_comp.id)
                    surface.components_model.add_component(new_comp)
                else:
                    existing.catalog = new_comp.catalog
                    existing.properties = new_comp.properties
            else:
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
