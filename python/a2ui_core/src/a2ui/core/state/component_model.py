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
from typing import Any, Final, Iterator
from ..common.events import EventSource
from ..catalog.catalog import Catalog, TComponent, TFunction
from ..catalog.reference_map import (
    ComponentRefSpec,
    analyze_child_ref_schema,
    extract_child_refs_from_val,
    COMPONENT_ID_KEY,
    CHILD_KEY,
)
from ..exceptions import A2uiErrorDetail
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
    known_ids: set[str] | None = None,
) -> bool:
    """Heuristically checks if a property key represents a child component reference for legacy v0.8 components.

    NOTE: This is ONLY a fallback for legacy v0.8 protocol support, where catalog component schemas
    do not define formal ComponentId or ChildList $ref types.
    """
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
        catalog: Catalog[TComponent, TFunction] | dict[str, Any] | None = None,
        properties: dict[str, Any] | None = None,
    ):
        self.id = component_id
        self.type = component_type
        if isinstance(catalog, dict) and properties is None:
            self.catalog = None
            self._properties = copy.deepcopy(catalog)
        else:
            self.catalog = catalog
            self._properties = copy.deepcopy(properties or {})
        self.on_updated = EventSource()

    @property
    def properties(self) -> dict[str, Any]:
        return self._properties

    @properties.setter
    def properties(self, new_props: dict[str, Any]) -> None:
        self._properties = copy.deepcopy(new_props)
        self.on_updated.emit(self)

    @property
    def component_tree(self) -> dict[str, Any]:
        """Returns a dictionary representation of the component tree."""
        tree = {"id": self.id, "type": self.type}
        tree.update(self._properties)
        return tree

    def validate(self, config: Any | None = None) -> list[A2uiErrorDetail]:
        """Validates this component instance against its bound catalog using PayloadValidator."""
        from ..validation.payload_validator import PayloadValidator

        comp_dict = {"id": self.id, "component": self.type, **self.properties}
        if not isinstance(self.catalog, Catalog):
            return []
        validator = PayloadValidator(self.catalog, config=config)
        return validator.validate_component(comp_dict)

    def get_child_references(
        self, known_component_ids: set[str] | None = None
    ) -> Iterator[tuple[str, str]]:
        """Recursively extracts referenced child ComponentIds and their property paths from properties.

        Args:
            known_component_ids: Optional set of active component IDs on the surface used
                during fallback heuristic discovery for legacy v0.8 components.

        Yields:
            Tuples of `(referenced_component_id, property_path)` where:
            - referenced_component_id: The unique ID of the referenced child component.
            - property_path: The property path inside this component where the reference
              resides (e.g., `"child"`, `"children[0]"`, `"children.componentId"`, or `"tabs[0].child"`).
        """
        props = self.properties
        if not isinstance(props, dict):
            return

        ref_spec = (
            self.catalog.get_component_ref_spec(self.type)
            if self.catalog is not None
            and hasattr(self.catalog, "get_component_ref_spec")
            else None
        )

        if ref_spec is not None and (ref_spec.single_refs or ref_spec.list_refs):
            yield from ref_spec.extract_child_references(props)
            return

        # Fallback for legacy v0.8 protocol support where catalog schemas don't define formal ComponentId/ChildList refs
        for key, value in props.items():
            if key in ("id", "component"):
                continue

            if isinstance(
                value, ComponentReference
            ) or is_v0_8_heuristic_child_prop_key(key, value, known_component_ids):
                for ref_id, sub_path in extract_child_refs_from_val(value):
                    full_path = f"{key}.{sub_path}" if sub_path else key
                    yield ref_id, full_path

    def dispose(self) -> None:
        """Disposes of the component and its resources."""
        if hasattr(self.on_updated, "dispose"):
            self.on_updated.dispose()
