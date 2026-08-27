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
from typing import Any, Dict, Iterator, List, Optional, Set, Tuple
from ..common.events import EventSource
from ..catalog.catalog import Catalog, TComponent, TFunction
from ..exceptions import A2uiErrorDetail
from ..schema.common_types import (
    ComponentReference,
    SingleReference,
    ListReference,
    TemplateChildList,
)


def is_child_prop_key(
    key: str, val: Any = None, known_ids: Optional[Set[str]] = None
) -> bool:
    """Checks if property key or value structure matches component reference conventions or reference types."""
    if isinstance(val, ComponentReference):
        return True

    if (
        key in ("child", "children", "items", "components")
        or key.endswith("Child")
        or key.endswith("children")
    ):
        return True

    if isinstance(val, list):
        return any(
            isinstance(i, ComponentReference)
            or (isinstance(i, str) and known_ids is not None and i in known_ids)
            or (isinstance(i, dict) and any(k in i for k in ("child", "componentId")))
            for i in val
        )
    elif isinstance(val, dict):
        return isinstance(val, ComponentReference) or any(
            k in val for k in ("child", "componentId")
        )
    elif isinstance(val, str) and known_ids is not None:
        return isinstance(val, SingleReference) or val in known_ids

    return False


def _extract_child_refs(val: Any) -> Iterator[Tuple[str, str]]:
    """Helper that recursively extracts component IDs from property values."""
    if not val:
        return
    if isinstance(val, SingleReference):
        if str(val):
            yield str(val), ""
    elif isinstance(val, TemplateChildList):
        if isinstance(val.component_id, str) and val.component_id:
            yield str(val.component_id), "componentId"
    elif isinstance(val, str):
        if val:
            yield val, ""
    elif isinstance(val, list):
        for idx, item in enumerate(val):
            for ref_id, sub_path in _extract_child_refs(item):
                yield ref_id, f"[{idx}]{'.' + sub_path if sub_path else ''}"
    elif isinstance(val, dict):
        if "componentId" in val and isinstance(val["componentId"], str):
            yield val["componentId"], "componentId"
        elif "child" in val and isinstance(val["child"], str):
            yield val["child"], "child"
        else:
            for sub_k, sub_v in val.items():
                for ref_id, sub_path in _extract_child_refs(sub_v):
                    yield ref_id, f"{sub_k}{'.' + sub_path if sub_path else ''}"


class ComponentModel:
    """Represents a single active UI component instance."""

    def __init__(
        self,
        component_id: str,
        component_type: str,
        catalog: Catalog[TComponent, TFunction],
        properties: Optional[Dict[str, Any]] = None,
    ):
        self.id = component_id
        self.type = component_type
        self.catalog = catalog
        self._properties = copy.deepcopy(properties or {})
        self.on_updated = EventSource()

    @property
    def properties(self) -> Dict[str, Any]:
        return self._properties

    @properties.setter
    def properties(self, new_props: Dict[str, Any]) -> None:
        self._properties = copy.deepcopy(new_props)
        self.on_updated.emit(self)

    @property
    def component_tree(self) -> Dict[str, Any]:
        """Returns a dictionary representation of the component tree."""
        tree = {"id": self.id, "type": self.type}
        tree.update(self._properties)
        return tree

    def validate(self, config: Optional[Any] = None) -> List[A2uiErrorDetail]:
        """Validates this component instance against its bound catalog using PayloadValidator."""
        from ..validation.payload_validator import PayloadValidator

        comp_dict = {"id": self.id, "component": self.type, **self.properties}
        validator = PayloadValidator(self.catalog, config=config)
        return validator.validate_component(comp_dict)

    def get_child_references(
        self, known_component_ids: Optional[Set[str]] = None
    ) -> Iterator[Tuple[str, str]]:
        """Recursively extracts referenced child ComponentIds from component properties."""
        props = self.properties
        if not isinstance(props, dict):
            return

        for key, value in props.items():
            if key in ("id", "component"):
                continue

            if (
                is_child_prop_key(key, value, known_component_ids)
                or known_component_ids is None
            ):
                for ref_id, sub_path in _extract_child_refs(value):
                    full_path = f"{key}.{sub_path}" if sub_path else key
                    yield ref_id, full_path

    def dispose(self) -> None:
        """Disposes of the component and its resources."""
        if hasattr(self.on_updated, "dispose"):
            self.on_updated.dispose()
