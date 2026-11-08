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
import re
from collections.abc import Collection, ItemsView, KeysView, Mapping, ValuesView
from typing import Any
from ..catalog import CatalogApi
from ..common.events import EventSource
from ..common.semver import is_at_least_version
from ..exceptions import (
    A2uiError,
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
    declares_composition_rules,
    validate_component_integrity,
    validate_composition_constraints,
)
from ..validation.payload_validator import PayloadValidator, ValidationConfig

_PARTIAL_REMOVED = object()


class SurfaceComponentsModel:
    """Manages the adjacency map of component configs in a surface."""

    def __init__(self, default_catalog: CatalogApi | None = None) -> None:
        self.default_catalog = default_catalog
        self._components: dict[str, ComponentModel] = {}
        # The catalogs the components come from, keyed by identity, with the
        # number of components from each.
        self._catalogs: dict[int, tuple[CatalogApi, int]] = {}
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
        place later. An index at or past the end appends. Inserting before the
        end costs time in proportion to the number of components.
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
        self._count_catalog(component.catalog, 1)
        component.on_updated.subscribe(self._note_change)
        self.on_created.emit(component)

    def remove_component(self, component_id: str) -> None:
        """Removes and disposes a component model by ID, emitting on_deleted."""
        if component_id in self._components:
            comp = self._components[component_id]
            del self._components[component_id]
            self._changes += 1
            self._count_catalog(comp.catalog, -1)
            comp.dispose()
            self.on_deleted.emit(component_id)

    def replace_component(self, component: ComponentModel) -> None:
        """Replaces an existing component model, emitting on_deleted and on_created."""
        old = self._components.get(component.id)
        if old is not None:
            del self._components[component.id]
            old.dispose()
        self._components[component.id] = component
        self._changes += 1
        component.on_updated.subscribe(self._note_change)
        if old is not None:
            self.on_deleted.emit(component.id)
        self.on_created.emit(component)

    def _note_change(self, _: object = None) -> None:
        self._changes += 1

    def _count_catalog(self, catalog: CatalogApi | None, delta: int) -> None:
        """Adds `delta` to the number of components from `catalog`."""
        if catalog is None:
            return
        _, count = self._catalogs.get(id(catalog), (catalog, 0))
        if count + delta > 0:
            self._catalogs[id(catalog)] = (catalog, count + delta)
        else:
            self._catalogs.pop(id(catalog), None)

    def _may_have_composition_rules(self, new_components: list[ComponentModel]) -> bool:
        """Whether a catalog of the components, held or new, declares composition rules.

        Reads the catalogs rather than the components, so it costs time in
        proportion to the catalogs, not to the number of components.
        """
        catalogs = {key: catalog for key, (catalog, _) in self._catalogs.items()}
        for comp_model in new_components:
            if comp_model.catalog is not None:
                catalogs[id(comp_model.catalog)] = comp_model.catalog
        return any(declares_composition_rules(c) for c in catalogs.values())

    def get_child_references(self, component_id: str) -> list[tuple[str, str]]:
        """Resolves child component references for a given component identifier."""
        comp = self.get(component_id)
        if not comp:
            return []
        return list(comp.get_child_references(set(self._components.keys())))

    def _validate_component(
        self,
        comp: ComponentModel,
        config: ValidationConfig,
        *,
        component_index: int | None = None,
        surface_id: str | None = None,
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
        PayloadValidator(comp.catalog, config=config).validate_component(
            comp_dict,
            component_index=component_index,
            surface_id=surface_id,
        )

    @staticmethod
    def _build_batch_index_map(
        new_components: list[ComponentModel], surface_id: str | None
    ) -> dict[str, int]:
        """Checks for duplicate component IDs in the batch and returns ID-to-index map."""
        batch_index_map: dict[str, int] = {}
        for idx, comp_model in enumerate(new_components):
            if comp_model.id in batch_index_map:
                msg = f"Duplicate component ID '{comp_model.id}' in update payload."
                raise A2uiIntegrityError(
                    msg,
                    details=[
                        A2uiErrorDetail(
                            path=f"components.{comp_model.id}",
                            code="duplicate_id",
                            message=msg,
                            surface_id=surface_id,
                        )
                    ],
                    path=f"/components/{idx}/id",
                    surface_id=surface_id,
                )
            batch_index_map[comp_model.id] = idx
        return batch_index_map

    def _collect_batch_component_errors(
        self,
        new_components: list[ComponentModel],
        config: ValidationConfig,
        surface_id: str | None,
    ) -> None:
        """Validates each component in the batch and raises if any fail."""
        all_errors: list[A2uiErrorDetail] = []
        comp_summaries: list[str] = []
        first_err_path: str | None = None
        for idx, comp_model in enumerate(new_components):
            try:
                self._validate_component(
                    comp_model,
                    config,
                    component_index=idx,
                    surface_id=surface_id,
                )
            except A2uiValidationError as e:
                if first_err_path is None:
                    first_err_path = e.path
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
                path=first_err_path,
                surface_id=surface_id,
            )

    def get_child_ids(self, component_id: str) -> list[str]:
        """Returns list of referenced child component IDs for a given component identifier."""
        return [ref_id for ref_id, _ in self.get_child_references(component_id)]

    def get_partial_components(
        self, *, exclude_ids: Collection[str] = (), root_id: str = "root"
    ) -> list[dict[str, Any]]:
        """Returns a detached, valid rooted view of an incomplete component graph.

        Missing or excluded children are removed from their enclosing list item,
        or from their single-child property. If that violates the catalog schema
        (for example, a required single child), the parent is unavailable too.
        Only components reachable from the root are returned. An unavailable root
        or an invalid projected graph yields an empty list.

        Catalog reference metadata identifies child slots; ordinary strings are
        never treated as references. ``exclude_ids`` lets a caller defer components
        whose external prerequisites, such as binding data, have not arrived.
        This does not change accumulated state or replace final validation.
        """
        excluded = set(exclude_ids)
        projected: dict[str, ComponentModel | None] = {}
        visiting: set[str] = set()
        config = ValidationConfig(root_id=root_id)

        def removal_target(
            properties: dict[str, Any], path: str
        ) -> tuple[str | int, ...] | None:
            # Reference paths are display strings, not escaped JSON pointers.
            # Match actual property names before interpreting separators; an
            # ambiguous spelling cannot safely identify a slot to remove.
            current: Any = properties
            tokens: list[str | int] = []
            while isinstance(current, dict):
                keys = [
                    key
                    for key in current
                    if path == key
                    or path.startswith(key + ".")
                    or path.startswith(key + "[")
                ]
                if len(keys) != 1:
                    return None
                key = keys[0]
                tokens.append(key)
                current = current[key]
                path = path[len(key) :]
                if not path:
                    return tuple(tokens)
                if isinstance(current, list):
                    match = re.match(r"\[(\d+)\]", path)
                    if match is None or int(match.group(1)) >= len(current):
                        return None
                    # Drop the enclosing entry, rather than leave a shell
                    # without its required nested child property.
                    return (*tokens, int(match.group(1)))
                if not path.startswith("."):
                    return None
                path = path[1:]
            return None

        def project(component_id: str, depth: int = 0) -> ComponentModel | None:
            if component_id in projected:
                return projected[component_id]
            component = self.get(component_id)
            if (
                component is None
                or component_id in excluded
                or component_id in visiting
                or depth > MAX_GLOBAL_DEPTH
            ):
                return None
            visiting.add(component_id)
            properties = copy.deepcopy(component.properties)
            removals: set[tuple[str | int, ...]] = set()
            for child_id, path in component.get_child_references(self.keys):
                if project(child_id, depth + 1) is not None:
                    continue
                removal = removal_target(properties, path)
                if removal is None:
                    visiting.remove(component_id)
                    projected[component_id] = None
                    return None
                removals.add(removal)
            # Mark list entries before compacting so indices never shift.
            for removal in removals:
                parent: Any = properties
                for token in removal[:-1]:
                    parent = parent[token]
                if removal:
                    token = removal[-1]
                    if isinstance(parent, list) and isinstance(token, int):
                        parent[token] = _PARTIAL_REMOVED
                    elif isinstance(parent, dict):
                        parent.pop(token, None)

            def compact(value: Any) -> Any:
                if isinstance(value, list):
                    return [
                        compact(item) for item in value if item is not _PARTIAL_REMOVED
                    ]
                if isinstance(value, dict):
                    return {key: compact(item) for key, item in value.items()}
                return value

            candidate = ComponentModel(
                component.id,
                component.type,
                component.catalog,
                compact(properties),
                metadata=component.metadata,
            )
            try:
                self._validate_component(candidate, config)
            except A2uiError:
                projected[component_id] = None
            else:
                projected[component_id] = candidate
            visiting.remove(component_id)
            return projected[component_id]

        if project(root_id) is None:
            return []
        reachable: dict[str, ComponentModel] = {}

        def collect(component_id: str) -> None:
            if component_id in reachable:
                return
            candidate = projected.get(component_id)
            if candidate is None:
                return
            reachable[component_id] = candidate
            for child_id, _ in candidate.get_child_references(projected.keys()):
                collect(child_id)

        collect(root_id)
        try:
            validate_component_integrity(reachable, root_id=root_id, config=config)
            analyze_topology(reachable, root_id=root_id, config=config)
            validate_composition_constraints(reachable, root_id=root_id)
        except A2uiError:
            return []
        result: list[dict[str, Any]] = []
        for key in self.keys:
            if key not in reachable:
                continue
            component = reachable[key]
            tree = copy.deepcopy(component.component_tree)
            version = component.catalog.protocol_version
            if (
                component.catalog is not self.default_catalog
                and version
                and is_at_least_version(version, ProtocolVersion.V1_0)
            ):
                tree["catalogId"] = component.catalog.catalog_id
            result.append(tree)
        return result

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
        *,
        surface_id: str | None = None,
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
            root_id: The surface root component id. A config whose `root_id`
                is not the default `"root"` overrides it.
            config: Validation settings; validation is skipped when None.
            surface_id: Optional ID of the target surface for error metadata.
        """
        if config is not None and config.root_id != "root":
            root_id = config.root_id
        batch_index_map = self._build_batch_index_map(new_components, surface_id)
        if config is None:
            if self._may_have_composition_rules(new_components):
                prospective_components = dict(self._components)
                for comp_model in new_components:
                    prospective_components[comp_model.id] = comp_model
                validate_composition_constraints(
                    prospective_components,
                    root_id=root_id,
                    batch_index_map=batch_index_map,
                    surface_id=surface_id,
                )
            return

        self._collect_batch_component_errors(new_components, config, surface_id)

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
        try:
            if deferred and bound is not None:
                if not bound.composition_holds(batch, self._components, root_id):
                    # The whole-surface check decides, and raises the error it
                    # reports for the surface.
                    prospective_components = dict(self._components)
                    prospective_components.update(batch)
                    validate_composition_constraints(
                        prospective_components,
                        root_id=root_id,
                        batch_index_map=batch_index_map,
                        surface_id=surface_id,
                    )
                if (
                    not config.allow_missing_root
                    and root_id not in batch
                    and root_id not in self._components
                ):
                    raise A2uiIntegrityError(
                        f"Missing root component: No component has id='{root_id}'",
                        surface_id=surface_id,
                    )
                limit = (
                    config.max_depth
                    if config.max_depth is not None
                    else MAX_GLOBAL_DEPTH
                )
                if bound.admits(
                    batch,
                    limit,
                    lambda comp_id: comp_id in batch or comp_id in self._components,
                ):
                    bound.record_batch(batch)
                    self._keep_bound(bound, new_components)
                    return
                # The bound cannot show that the graph passes; walk all of it.
                prospective_components = dict(self._components)
                prospective_components.update(batch)
                analyze_topology(prospective_components, root_id=root_id, config=config)
            else:
                prospective_components = dict(self._components)
                prospective_components.update(batch)
                validate_composition_constraints(
                    prospective_components,
                    root_id=root_id,
                    batch_index_map=batch_index_map,
                    surface_id=surface_id,
                )
                validate_component_integrity(
                    prospective_components, root_id=root_id, config=config
                )
                analyze_topology(prospective_components, root_id=root_id, config=config)
        except A2uiError as err:
            if err.surface_id is None and surface_id is not None:
                err.surface_id = surface_id
            raise
        if deferred:
            self._keep_bound(
                ComponentGraphBound.of(prospective_components), new_components
            )

    def _keep_bound(
        self, bound: ComponentGraphBound, new_components: list[ComponentModel]
    ) -> None:
        """Keeps the bound of the graph a checked batch leaves, until it is applied."""
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
        for comp_id in list(self._components.keys()):
            self.remove_component(comp_id)
        self._components.clear()
        self._catalogs.clear()
        self._bound = None
        self.on_created.dispose()
        self.on_deleted.dispose()
