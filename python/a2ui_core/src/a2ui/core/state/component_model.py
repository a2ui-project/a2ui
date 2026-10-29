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
from collections.abc import Container
from typing import Any, Final, Iterator
from ..common.events import EventSource
from ..common.metadata import (
    A2uiMetadata,
    clone_metadata,
    normalize_metadata,
    validate_metadata,
)
from ..common.semver import is_at_least_version
from ..common.uax31 import is_valid_uax31_identifier
from ..catalog import CatalogApi
from ..catalog.reference_map import (
    ComponentRefSpec,
    analyze_child_ref_schema,
    extract_child_refs_from_val,
    COMPONENT_ID_KEY,
    CHILD_KEY,
)
from ..exceptions import A2uiErrorDetail, A2uiValidationError
from ..schema import ProtocolVersion
from ..schema.common_types import (
    ComponentReference,
    SingleReference,
    ListReference,
    TemplateChildList,
)

# Legacy v0.8 fallback field names for component child reference identification
V0_8_SINGLE_REF_FIELDS: Final[set[str]] = {
    "child",
    "contentChild",
    "entryPointChild",
    COMPONENT_ID_KEY,
}

V0_8_LIST_REF_FIELDS: Final[set[str]] = {
    "children",
    "explicitList",
    "template",
    "tabs",
}


def is_v0_8_heuristic_child_prop_key(
    key: str,
    val: Any = None,
    known_ids: Container[str] | None = None,
) -> bool:
    """Heuristically checks if a property key represents a child component.

    Used as a fallback for legacy v0.8 protocol support where catalog schemas
    do not define formal ComponentId or ChildList schema references.

    Args:
        key: Property key name to evaluate.
        val: Optional property value to inspect for child ID structures.
        known_ids: Optional set of known component IDs for verification.

    Returns:
        True if the property key or value likely represents a child reference.
    """
    if key.lower() in (
        "text",
        "title",
        "label",
        "description",
        "icon",
        "url",
        "path",
        "value",
        "key",
        "id",
        "component",
        "type",
        "variant",
        "size",
        "color",
        "action",
        "style",
        "styles",
        "theme",
        "weight",
        "align",
        "distribution",
        "disabled",
        "selected",
    ):
        return False

    # Naming conventions
    if (
        key in V0_8_SINGLE_REF_FIELDS
        or key in V0_8_LIST_REF_FIELDS
        or key.endswith("Child")
        or key.endswith("children")
        or key.startswith("child")
        or key.startswith("children")
    ):
        return True

    # Value inspection
    if isinstance(val, list):
        return any(
            (isinstance(i, str) and known_ids is not None and i in known_ids)
            or (
                isinstance(i, dict)
                and any(k in i for k in (CHILD_KEY, COMPONENT_ID_KEY))
            )
            for i in val
        )
    elif isinstance(val, dict):
        return any(k in val for k in (CHILD_KEY, COMPONENT_ID_KEY))
    elif isinstance(val, str) and known_ids is not None:
        return val in known_ids

    return False


class ComponentModel:
    """Represents a single active UI component instance."""

    def __init__(
        self,
        component_id: str,
        component_type: str,
        catalog: CatalogApi,
        properties: dict[str, Any] | None = None,
        metadata: A2uiMetadata | None = None,
    ):
        """Initializes the component.

        Args:
            component_id: The component's ID.
            component_type: The component's type name.
            catalog: The catalog the component resolved to: the catalog it
                names, or else the surface default catalog.
            properties: The component's properties.
            metadata: Optional component envelope metadata.
        """
        self.id = component_id
        self.type = component_type
        self.catalog: CatalogApi = catalog
        self._properties = copy.deepcopy(properties or {})
        validate_metadata(metadata, context=f"component '{component_id}' metadata")
        self._metadata: A2uiMetadata | None = normalize_metadata(metadata)
        self._in_combined_update: bool = False
        self.on_updated = EventSource()
        self.on_metadata_changed = EventSource()

    @property
    def properties(self) -> dict[str, Any]:
        return self._properties

    @properties.setter
    def properties(self, new_props: dict[str, Any]) -> None:
        self._properties = copy.deepcopy(new_props)
        self.on_updated.emit(self)

    def apply_update(
        self,
        new_properties: dict[str, Any],
        new_metadata: A2uiMetadata | None,
    ) -> None:
        """Atomically updates both properties and metadata before emitting events."""
        validate_metadata(new_metadata, context=f"component '{self.id}' metadata")
        next_meta = normalize_metadata(new_metadata)
        props_changed = self._properties != new_properties
        meta_changed = self._metadata != next_meta
        if props_changed:
            self._properties = copy.deepcopy(new_properties)
        if meta_changed:
            self._metadata = next_meta
        self._in_combined_update = props_changed and meta_changed
        try:
            if props_changed:
                self.on_updated.emit(self)
            if meta_changed:
                self.on_metadata_changed.emit(clone_metadata(self._metadata))
        finally:
            self._in_combined_update = False

    @property
    def metadata(self) -> A2uiMetadata | None:
        """Returns a defensive copy of the component's metadata envelope, or None."""
        return clone_metadata(self._metadata)

    @metadata.setter
    def metadata(self, metadata: A2uiMetadata | None) -> None:
        """Replaces the component's metadata envelope after validating UAX #31 keys."""
        validate_metadata(metadata, context=f"component '{self.id}' metadata")
        next_meta = normalize_metadata(metadata)
        if self._metadata == next_meta:
            return
        self._metadata = next_meta
        self.on_metadata_changed.emit(clone_metadata(self._metadata))

    @property
    def extensions(self) -> dict[str, Any] | None:
        """Returns a defensive copy of `metadata['extensions']`, or None."""
        if self._metadata is None or not isinstance(
            self._metadata.get("extensions"), dict
        ):
            return None
        return dict(copy.deepcopy(self._metadata["extensions"]))

    def set_extension(self, key: str, value: Any) -> None:
        """Sets a single extension key on the component metadata envelope.

        Passing ``None`` stores a JSON ``null`` value under ``key``; use
        :meth:`remove_extension` to delete an extension key.
        """
        if not isinstance(key, str) or not is_valid_uax31_identifier(key):
            raise A2uiValidationError(
                f"Invalid UAX #31 extension identifier '{key}' in component"
                f" '{self.id}' metadata.extensions."
            )
        current_ext = (
            dict(self._metadata.get("extensions") or {})
            if self._metadata is not None
            else {}
        )
        current_ext[key] = copy.deepcopy(value)
        self.metadata = {"extensions": current_ext}

    def remove_extension(self, key: str) -> None:
        """Removes a single extension key, collapsing empty metadata to None."""
        if (
            self._metadata is None
            or not isinstance(self._metadata.get("extensions"), dict)
            or key not in self._metadata["extensions"]
        ):
            return
        current_ext = dict(self._metadata["extensions"])
        del current_ext[key]
        self.metadata = {"extensions": current_ext} if current_ext else None

    @property
    def component_tree(self) -> dict[str, Any]:
        """Returns a dictionary representation of the component tree."""
        tree: dict[str, Any] = {
            **self._properties,
            "id": self.id,
            "component": self.type,
        }
        if self._metadata is not None:
            tree["metadata"] = clone_metadata(self._metadata)
        return tree

    def validate(self, config: Any | None = None) -> None:
        """Validates this component instance against its bound catalog using PayloadValidator.

        On its own, a component can't tell whether its catalog is the surface
        default, so it is validated as if it were: function calls that name no
        `catalogId` are checked against its catalog.
        `SurfaceComponentsModel.validate_components_update` knows the surface
        default and handles components in other catalogs.

        Args:
            config: Optional validation settings.

        Raises:
            A2uiValidationError: If component schema or identifier validation fails.
        """
        from ..validation.payload_validator import PayloadValidator

        PayloadValidator(self.catalog, config=config).validate_component(
            self.component_tree
        )

    def get_child_references(
        self,
        known_component_ids: Container[str] | None = None,
        catalog: CatalogApi | None = None,
    ) -> Iterator[tuple[str, str]]:
        """Recursively extracts referenced child ComponentIds and their property paths from properties.

        Args:
            known_component_ids: Optional set of active component IDs on the surface used
                during fallback heuristic discovery for legacy v0.8 components.
            catalog: Optional catalog used to resolve component reference specs if not
                already bound to this component model.

        Yields:
            Tuples of `(referenced_component_id, property_path)` where:
            - referenced_component_id: The unique ID of the referenced child component.
            - property_path: The property path inside this component where the reference
              resides (e.g., `"child"`, `"children[0]"`, `"children.componentId"`, or `"tabs[0].child"`).
        """
        props = self.properties
        if not isinstance(props, dict):
            return

        target_catalog = catalog if catalog is not None else self.catalog
        ref_spec = (
            target_catalog.get_component_ref_spec(self.type)
            if target_catalog is not None
            and hasattr(target_catalog, "get_component_ref_spec")
            else None
        )

        if ref_spec is not None and (ref_spec.single_refs or ref_spec.list_refs):
            yield from ref_spec.extract_child_references(props)
            return

        # Fallback for legacy v0.8 protocol support where catalog schemas don't define formal ComponentId/ChildList refs
        # From v0.9 a catalog declares every child with a $ref, so a component it
        # declares with no reference props has no children to infer.
        infer_refs = ref_spec is None or not is_at_least_version(
            target_catalog.protocol_version, ProtocolVersion.V0_9
        )
        for key, value in props.items():
            if key in ("id", "component"):
                continue

            if isinstance(value, ComponentReference) or (
                infer_refs
                and is_v0_8_heuristic_child_prop_key(key, value, known_component_ids)
            ):
                for ref_id, sub_path in extract_child_refs_from_val(value):
                    full_path = f"{key}.{sub_path}" if sub_path else key
                    yield ref_id, full_path

    def dispose(self) -> None:
        """Disposes of the component and its resources."""
        if hasattr(self.on_updated, "dispose"):
            self.on_updated.dispose()
        if hasattr(self.on_metadata_changed, "dispose"):
            self.on_metadata_changed.dispose()
