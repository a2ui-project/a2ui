# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Base component node classes for typesafe A2UI builders."""

from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, ConfigDict


class ComponentBuilderNode(BaseModel):
    """Base class for all generated A2UI component builders."""

    model_config = ConfigDict(
        # Strict authoring validation: catches typos (e.g. lable="Save") at runtime and edit-time.
        # Loose parsing will be handled by dedicated deserialization constructors in Phase 2 (#2571).
        extra="forbid",
        # Arbitrary types forbidden to enforce strict typing on builder inputs
        arbitrary_types_allowed=False,
        # Modern Pydantic 2.11+ replacement for populate_by_name
        validate_by_name=True,
        # Validate whenever the datamodel is changed, not just created
        validate_assignment=True,
    )

    component: str = ""
    id: Optional[str] = None

    @property
    def component_name(self) -> str:
        return self.component

    @component_name.setter
    def component_name(self, value: str) -> None:
        self.component = value

    def to_dict(self) -> dict[str, Any]:
        """Serializes this component into an A2UI wire format dictionary."""
        d: dict[str, Any] = {"component": self.component_name or self.component}
        if self.id is not None:
            d["id"] = self.id
        return d

    def to_components(self, prefix: Optional[str] = None) -> list[dict[str, Any]]:
        """Flattens this component subtree into A2UI wire-format dictionaries."""
        from .flattener import flatten_component_tree

        return flatten_component_tree(self, root_id=prefix)


class ExternalComponentBuilderNode(ComponentBuilderNode):
    """Represents a component defined outside the current macro (slot reference).

    External components are referenced strictly by ID. They are never assigned
    namespaced IDs during macro expansion, preserving outer component addresses.
    """

    def __init__(self, id: str, **kwargs: Any):
        super().__init__(id=id, component="ExternalComponent", **kwargs)

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id}


# Ergonomic alias for referencing external/existing components
ComponentRef = ExternalComponentBuilderNode
