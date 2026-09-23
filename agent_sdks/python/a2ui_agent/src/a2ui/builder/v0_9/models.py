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

"""Protocol v0.9 data models, bindings, actions, and type aliases for A2UI builders.

Re-exports ``AccessibilityAttributes``, ``ActionEvent``, ``CheckRule``,
``DataBinding``, and ``FunctionCall`` from ``a2ui.core.schema.common_types``.
Defines ``Action`` and ``DynamicChildList`` locally for ergonomic authoring.
"""

from __future__ import annotations

from typing import Any, Optional, Sequence, TypeAlias, Union
from pydantic import (
    AliasChoices,
    Field,
    StrictBool,
    StrictFloat,
    StrictInt,
    StrictStr,
    model_validator,
)

from ..core.base_model import BuilderBaseModel
from ..core.child import Child

from a2ui.core.schema.common_types import (
    AccessibilityAttributes as AccessibilityAttributes,
)
from a2ui.core.schema.common_types import ActionEvent as ActionEvent
from a2ui.core.schema.common_types import CheckRule as CheckRule
from a2ui.core.schema.common_types import DataBinding as DataBinding
from a2ui.core.schema.common_types import FunctionCall as FunctionCall


# Canonical Protocol Type Aliases
DynamicString = Union[StrictStr, DataBinding, FunctionCall]
DynamicNumber = Union[StrictInt, StrictFloat, DataBinding, FunctionCall]
DynamicBoolean = Union[StrictBool, DataBinding, FunctionCall]
DynamicStringList = Union[Sequence[StrictStr], DataBinding, FunctionCall]
DynamicValue = Union[
    StrictStr,
    StrictInt,
    StrictFloat,
    StrictBool,
    Sequence[Any],
    DataBinding,
    FunctionCall,
]


class Action(BuilderBaseModel):
    """Dispatches either a server ``event`` or a client ``function_call`` (mutually exclusive)."""

    event: Optional[ActionEvent] = None
    function_call: Optional[FunctionCall] = Field(
        default=None,
        serialization_alias="functionCall",
        validation_alias=AliasChoices("function_call", "functionCall"),
    )

    @model_validator(mode="after")
    def _require_exactly_one_branch(self) -> Action:
        if (self.event is None) == (self.function_call is None):
            raise ValueError(
                "Action requires exactly one of 'event' or 'function_call'."
            )
        return self


class DynamicChildList(BuilderBaseModel):
    """Repeats ``template`` for each item in the data model array at ``path``.

    During flattening, ``template`` is emitted as a sibling component and
    replaced by its allocated ``componentId`` on the wire. ``path`` may be
    absolute (``/items``) or relative to an enclosing template scope.
    """

    path: str = Field(
        validation_alias=AliasChoices("path", "data_model_path", "dataModelPath"),
    )
    template: Child = Field(
        serialization_alias="componentId",
        validation_alias=AliasChoices("template", "componentId"),
    )


ChildList: TypeAlias = Union[Sequence[Child], DynamicChildList]
