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

from typing import Any, Dict, List, Optional
from ..common.events import EventSource
from ..exceptions import A2uiValidationError
from .component_model import ComponentModel
from ..validation.catalog_schema_validator import (
    CatalogSchemaValidator,
    ValidationConfig,
)


class SurfaceComponentsModel:
    """Manages the adjacency map of component configs in a surface."""

    def __init__(self) -> None:
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

    def validate_components_update(
        self,
        catalog: Any,
        components: List[Dict[str, Any]],
        config: Optional[ValidationConfig] = None,
    ) -> None:
        """Validates inbound component properties schema and composition constraints."""
        if config is None:
            return

        from ..validation.composition_validator import validate_composition_constraints

        try:
            CatalogSchemaValidator.from_catalog(catalog).validate_components(
                components, config=config
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
            ) from e

        validate_composition_constraints(catalog, self.get_all(), components)

    def validate_completeness(
        self,
        root_id: str = "root",
        config: Optional[ValidationConfig] = None,
    ) -> None:
        """Validates post-update surface graph completeness (root presence, dangling refs, cycles, orphans)."""
        if config is None:
            return

        from ..validation.integrity_checker import validate_component_integrity
        from ..validation.topology_analyzer import analyze_topology

        comps = self.get_all()
        try:
            validate_component_integrity(comps, root_id=root_id, config=config)
            analyze_topology(comps, root_id=root_id, config=config)
        except Exception as e:
            raise A2uiValidationError(str(e)) from e

    def dispose(self) -> None:
        """Disposes of the model and all its components."""
        for component in list(self._components.values()):
            component.dispose()
        self._components.clear()
        if hasattr(self.on_created, "dispose"):
            self.on_created.dispose()
        if hasattr(self.on_deleted, "dispose"):
            self.on_deleted.dispose()
