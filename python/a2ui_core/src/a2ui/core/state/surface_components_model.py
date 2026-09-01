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

from typing import Any
from ..common.events import EventSource
from ..exceptions import A2uiErrorDetail, A2uiValidationError
from .component_model import ComponentModel
from .validation_helpers import (
    analyze_topology,
    validate_component_integrity,
    validate_composition_constraints,
)
from ..validation.payload_validator import (
    PayloadValidator,
    ValidationConfig,
)

from ..catalog import Catalog
from ..catalog.catalog import TComponent, TFunction


class SurfaceComponentsModel:
    """Manages the adjacency map of component configs in a surface."""

    def __init__(self) -> None:
        self._components: dict[str, ComponentModel] = {}
        self.on_created = EventSource()
        self.on_deleted = EventSource()

    def get(self, component_id: str) -> ComponentModel | None:
        return self._components.get(component_id)

    def get_all(self) -> dict[str, ComponentModel]:
        return dict(self._components)

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
        new_components: list[ComponentModel],
        root_id: str = "root",
        config: ValidationConfig | None = None,
    ) -> None:
        """Validates inbound component models schema, composition constraints, and graph completeness BEFORE updating surface state."""
        if config is None:
            return

        seen_ids: set[str] = set()
        for comp_model in new_components:
            if comp_model.id in seen_ids:
                raise A2uiValidationError(
                    f"Duplicate component ID '{comp_model.id}' in update payload.",
                    details=[
                        A2uiErrorDetail(
                            path=f"components.{comp_model.id}",
                            code="duplicate_id",
                            message=(
                                f"Duplicate component ID '{comp_model.id}' in update"
                                " payload."
                            ),
                        )
                    ],
                )
            seen_ids.add(comp_model.id)

        all_errors: list[A2uiErrorDetail] = []
        comp_summaries: list[str] = []
        for comp_model in new_components:
            errors = comp_model.validate(config=config)
            if errors:
                all_errors.extend(errors)
                comp_type = comp_model.type
                comp_str = f"'{comp_type}'" if comp_type else f"id '{comp_model.id}'"
                comp_summary = "\n".join(f"{e.path}: {e.message}" for e in errors)
                comp_summaries.append(f"{comp_str}: {comp_summary}")

        if all_errors:
            summary = "\n".join(comp_summaries)
            raise A2uiValidationError(
                f"Validation failed for component {summary}",
                details=all_errors,
            )

        prospective_components = dict(self._components)
        for comp_model in new_components:
            prospective_components[comp_model.id] = comp_model

        validate_composition_constraints(prospective_components)
        validate_component_integrity(
            prospective_components, root_id=root_id, config=config
        )
        analyze_topology(prospective_components, root_id=root_id, config=config)

    def dispose(self) -> None:
        """Disposes of the model and all its components."""
        for component in list(self._components.values()):
            component.dispose()
        self._components.clear()
        if hasattr(self.on_created, "dispose"):
            self.on_created.dispose()
        if hasattr(self.on_deleted, "dispose"):
            self.on_deleted.dispose()
