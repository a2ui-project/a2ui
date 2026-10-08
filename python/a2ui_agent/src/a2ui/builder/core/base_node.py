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
from pydantic import ConfigDict

from .base_model import BuilderBaseModel


class ComponentBuilderNode(BuilderBaseModel):
    """Base class for all generated A2UI component builders."""

    model_config = ConfigDict(
        # Validate whenever the datamodel is changed, not just created
        validate_assignment=True,
    )

    component: str = ""
    id: Optional[str] = None

    @property
    def component_name(self) -> str:
        return self.component

    def flatten(self, prefix: Optional[str] = None) -> list[dict[str, Any]]:
        """Flattens this component subtree into A2UI wire-format dictionaries."""
        from .flattener import flatten_component_tree

        return flatten_component_tree(self, root_id=prefix)


class ComponentRef(ComponentBuilderNode):
    """References an existing surface component by ``id`` without emitting or namespacing it."""

    def __init__(self, id: str, **kwargs: Any):
        super().__init__(id=id, **kwargs)
