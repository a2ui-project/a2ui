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

from collections.abc import ItemsView, KeysView, Mapping, ValuesView
from ..catalog import CatalogApi
from ..common.events import EventSource
from ..common.semver import is_at_least_version
from ..exceptions import (
    A2uiErrorDetail,
    A2uiIntegrityError,
    A2uiStateError,
    A2uiValidationError,
)
from ..schema import ProtocolVersion
from .component_graph_bound import ComponentGraphBound
from .component_model import ComponentModel
from .validation_helpers import (
    MAX_GLOBAL_DEPTH,
    analyze_topology,
    validate_component_integrity,
    validate_composition_constraints,
)
from ..validation.payload_validator import PayloadValidator, ValidationConfig


class SurfaceComponentsModel:
    """Manages the adjacency map of component configs in a surface."""

    def __init__(self, default_catalog: CatalogApi | None = None) -> None:
        self.default_catalog = default_catalog
        self._components: dict[str, ComponentModel] = {}
        self.on_created = EventSource()
        self.on_deleted = EventSource()
        # Counts the changes to the components, so that `_bound` is used only
        # for the graph it describes.
        self._changes = 0
        # What the last check found about the graph (see ComponentGraphBound),
        # which describes the components while `_changes` is `_bound_at`.
        self._bound: ComponentGraphBound | None = None
        self._bound_at = -1
        # The batch `_bound` describes the graph with, until it is applied.
        self._bound_batch: list[ComponentModel] | None = None

    def __len__(self) -> int:
        """Returns total number of components."""
        return len(self._components)

    def __contains__(self, component_id: str) -> bool:
        """Checks if a component with the specified ID exists in the model."""
        return component_id in self._components

    def has(self, component_id: str) -> bool:
        """Checks if a component with the specified ID exists in the model."""
        return component_id in self._components

    @property
    def size(self) -> int:
        """Returns total number of components."""
        return len(self._components)

    @property
    def entries(self) -> ItemsView[str, ComponentModel]:
        """Returns an items view of (component_id, ComponentModel) pairs."""
        return self._components.items()

    @property
    def keys(self) -> KeysView[str]:
        """Returns a keys view of component IDs."""
        return self._components.keys()

    @property
    def values(self) -> ValuesView[ComponentModel]:
        """Returns a values view of ComponentModel instances."""
        return self._components.values()

    @property
    def components_map(self) -> Mapping[str, ComponentModel]:
        """Returns a read-only mapping of component IDs to ComponentModel instances."""
        return self._components

    def get(self, component_id: str) -> ComponentModel | None:
        """Retrieves a component model by ID, or None if not present."""
        return self._components.get(component_id)

    def get_all(self) -> dict[str, ComponentModel]:
        """Returns a shallow dictionary copy of all component models."""
        return dict(self._components)

    def add_component(self, component: ComponentModel) -> None:
        """Adds a new component model to the surface, emitting on_created."""
        self.insert_component(len(self._components), component)

    def insert_component(self, index: int, component: ComponentModel) -> None:
        """Adds a new component model at a position, emitting on_created.

        Like `add_component`, but the component takes `index` in the model's
        order (see `keys`), and the components from that position on move one
        place later. An index at or past the end appends. The order matters to
        checks that read it, such as `allowedParents`, which takes a
        component's last parent in that order. Inserting before the end costs
        time in proportion to the number of components.
        """
        if component.id in self._components:
            raise A2uiStateError(f"Component with id '{component.id}' already exists.")
        if index >= len(self._components):
            self._components[component.id] = component
        else:
            # Rebuilt in place, so that views of the model stay valid.
            entries = list(self._components.items())
            entries.insert(max(index, 0), (component.id, component))
            self._components.clear()
            self._components.update(entries)
        self._changes += 1
        component.on_updated.subscribe(self._note_change)
        self.on_created.emit(component)

    def remove_component(self, component_id: str) -> None:
        """Removes and disposes a component model by ID, emitting on_deleted."""
        if component_id in self._components:
            comp = self._components[component_id]
            del self._components[component_id]
            self._changes += 1
            comp.dispose()
            self.on_deleted.emit(component_id)

    def _note_change(self, _: object = None) -> None:
        self._changes += 1

    def get_child_references(self, component_id: str) -> list[tuple[str, str]]:
        """Resolves child component references for a given component identifier."""
        comp = self.get(component_id)
        if not comp:
            return []
        return list(comp.get_child_references(set(self._components.keys())))

    def _validate_component(
        self, comp: ComponentModel, config: ValidationConfig
    ) -> None:
        """Validates one component, telling the validator which catalog it is in.

        From v1.0, a function call that names no `catalogId` runs in the surface
        default catalog. When the component's catalog is another one, the
        validator is given the component's `catalogId` so it leaves those calls
        to `MessageProcessor`, which checks them against the surface default.
        """
        comp_dict = comp.component_tree
        ver = comp.catalog.protocol_version
        if (
            comp.catalog is not self.default_catalog
            and ver
            and is_at_least_version(ver, ProtocolVersion.V1_0)
        ):
            comp_dict["catalogId"] = comp.catalog.catalog_id
        PayloadValidator(comp.catalog, config=config).validate_component(comp_dict)

    def get_child_ids(self, component_id: str) -> list[str]:
        """Returns list of referenced child component IDs for a given component identifier."""
        return [ref_id for ref_id, _ in self.get_child_references(component_id)]

    def detect_cycles(
        self,
        config: ValidationConfig | None = None,
    ) -> set[str]:
        """Detects self-references, circular dependencies, and exceeds depth limits."""
        cfg = (config or ValidationConfig()).model_copy(
            update={"allow_orphan_components": True}
        )
        return analyze_topology(
            self._components,
            root_id=cfg.root_id,
            config=cfg,
        )

    def validate_topology(
        self,
        config: ValidationConfig | None = None,
    ) -> None:
        """Validates full graph topology (integrity, dangling references, orphans, cycles, and depth)."""
        if not self._components:
            return
        cfg = config or ValidationConfig()
        validate_component_integrity(self._components, root_id=cfg.root_id, config=cfg)
        analyze_topology(self._components, root_id=cfg.root_id, config=cfg)

    def validate_references(
        self,
        config: ValidationConfig | None = None,
    ) -> list[A2uiValidationError]:
        """Non-throwing wrapper over validate_topology returning a list of A2uiValidationError."""
        try:
            self.validate_topology(config)
            return []
        except A2uiValidationError as err:
            return [err]

    def validate_components_update(
        self,
        new_components: list[ComponentModel],
        root_id: str = "root",
        config: ValidationConfig | None = None,
    ) -> None:
        """Validates inbound component models schema, composition constraints, and graph completeness BEFORE updating surface state.

        Under a config that allows dangling references, and orphans or a
        missing root, the model keeps what the last check found about its
        graph (see `ComponentGraphBound`). Once that batch is applied and
        reported to `components_update_applied`, the next check reads only the
        components its batch changes, and walks the whole graph only when that
        cannot show the graph passes. The checks and their errors are the same
        either way. Under any other config every check reads the whole graph.

        Args:
            new_components: The inbound component models.
            root_id: The surface root component id.
            config: Validation settings; validation is skipped when None.
        """
        if config is None:
            return

        seen_ids: set[str] = set()
        for comp_model in new_components:
            if comp_model.id in seen_ids:
                raise A2uiIntegrityError(
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
            try:
                self._validate_component(comp_model, config)
            except A2uiValidationError as e:
                all_errors.extend(e.details)
                comp_type = comp_model.type
                comp_str = f"'{comp_type}'" if comp_type else f"id '{comp_model.id}'"
                comp_summary = "\n".join(
                    f"{detail.path}: {detail.message}" for detail in e.details
                )
                comp_summaries.append(f"{comp_str}: {comp_summary}")

        if all_errors:
            summary = "\n".join(comp_summaries)
            raise A2uiValidationError(
                f"Validation failed for component {summary}",
                details=all_errors,
            )

        batch = {comp_model.id: comp_model for comp_model in new_components}
        bound = self._bound if self._bound_at == self._changes else None
        # The bound changes with the batch, and describes the components again
        # only once the batch is applied.
        self._bound = None
        self._bound_at = -1
        self._bound_batch = None
        # Under a config that checks neither references nor reachability, the
        # graph checks need only the components the batch changes.
        deferred = config.allow_dangling_references and (
            config.allow_orphan_components or config.allow_missing_root
        )
        if deferred and bound is not None:
            if not bound.composition_holds(batch, self._components):
                # The whole-surface check decides, and raises the error it
                # reports for the surface.
                prospective_components = dict(self._components)
                prospective_components.update(batch)
                validate_composition_constraints(prospective_components)
            if (
                not config.allow_missing_root
                and root_id not in batch
                and root_id not in self._components
            ):
                raise A2uiIntegrityError(
                    f"Missing root component: No component has id='{root_id}'"
                )
            limit = (
                config.max_depth if config.max_depth is not None else MAX_GLOBAL_DEPTH
            )
            if bound.admits(
                batch,
                limit,
                lambda comp_id: comp_id in batch or comp_id in self._components,
            ):
                bound.record_batch(batch, self._components)
                self._keep_bound(bound, new_components)
                return
            # The bound cannot show that the graph passes; walk all of it.
            prospective_components = dict(self._components)
            prospective_components.update(batch)
            analyze_topology(prospective_components, root_id=root_id, config=config)
        else:
            prospective_components = dict(self._components)
            prospective_components.update(batch)
            validate_composition_constraints(prospective_components)
            validate_component_integrity(
                prospective_components, root_id=root_id, config=config
            )
            analyze_topology(prospective_components, root_id=root_id, config=config)
        if deferred:
            self._keep_bound(
                ComponentGraphBound.of(prospective_components), new_components
            )

    def _keep_bound(
        self, bound: ComponentGraphBound, new_components: list[ComponentModel]
    ) -> None:
        """Keeps the bound of the graph a checked batch leaves, until it is applied.

        A component replaced by one of another type or catalog moves to the end
        of the surface when it is applied, which changes the order the bound
        records, so the bound is not kept then.
        """
        for comp_model in new_components:
            existing = self._components.get(comp_model.id)
            if existing is not None and (
                existing.type != comp_model.type
                or existing.catalog is not comp_model.catalog
            ):
                return
        self._bound = bound
        self._bound_batch = new_components

    def components_update_applied(self, new_components: list[ComponentModel]) -> None:
        """Reports that a batch `validate_components_update` passed has been applied.

        The next check may then start from what that check found about the
        graph, rather than walking the whole graph. A batch that is checked
        but not applied, or a change made in any other way, makes the next
        check walk the whole graph.
        """
        if self._bound is not None and new_components is self._bound_batch:
            self._bound_at = self._changes
        self._bound_batch = None

    def dispose(self) -> None:
        """Disposes of the model and all its components."""
        for component in list(self._components.values()):
            component.dispose()
        self._components.clear()
        self._bound = None
        self.on_created.dispose()
        self.on_deleted.dispose()
