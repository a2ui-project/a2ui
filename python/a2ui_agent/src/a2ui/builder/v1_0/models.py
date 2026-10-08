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

"""Protocol v1.0 data models, bindings, actions, and type aliases for A2UI builders.

Re-exports ``AccessibilityAttributes``, ``ActionEvent``, and ``CheckRule`` from
``a2ui.core.schema.v1_0``. Builder-adapts ``DataBinding`` and ``FunctionCall``
for typesafe fluent authoring while maintaining full wire and union compatibility
with core schema models. Defines ``Action`` and ``DynamicChildList`` locally for
ergonomic authoring.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, TypeAlias
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

from a2ui.core.schema.v1_0 import (
    AccessibilityAttributes as AccessibilityAttributes,
    ActionEvent as ActionEvent,
    CheckRule as CheckRule,
    DataBinding as CoreDataBinding,
    FunctionCall as CoreFunctionCall,
)


class DataBinding(CoreDataBinding):
    """A JSON Pointer path to a value in the data model."""

    def __init__(self, *, path: str, **kwargs: Any) -> None:
        super().__init__(**{"@path": path, **kwargs})


class FunctionCall(CoreFunctionCall):
    """Invokes a named function, serializing with the v1.0 '@call' wire alias."""

    def __init__(
        self,
        *,
        call: str,
        args: dict[str, Any] | None = None,
        catalog_id: str | None = None,
        **kwargs: Any,
    ) -> None:
        init_kwargs: dict[str, Any] = {"@call": call, **kwargs}
        if args is not None:
            init_kwargs["args"] = args
        if catalog_id is not None:
            init_kwargs["catalog_id"] = catalog_id
        super().__init__(**init_kwargs)


# Canonical Protocol Type Aliases
DynamicString = StrictStr | DataBinding | FunctionCall
DynamicNumber = StrictInt | StrictFloat | DataBinding | FunctionCall
DynamicBoolean = StrictBool | DataBinding | FunctionCall
DynamicStringList = Sequence[StrictStr] | DataBinding | FunctionCall
DynamicValue = (
    StrictStr
    | StrictInt
    | StrictFloat
    | StrictBool
    | Sequence[Any]
    | DataBinding
    | FunctionCall
)


class Action(BuilderBaseModel):
    """Dispatches either an agent ``event`` or a renderer/agent ``function_call`` (mutually exclusive)."""

    event: ActionEvent | None = None
    function_call: FunctionCall | None = Field(
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


ChildList: TypeAlias = Sequence[Child] | DynamicChildList

__all__ = [
    "AccessibilityAttributes",
    "Action",
    "ActionEvent",
    "CheckRule",
    "ChildList",
    "DataBinding",
    "DynamicBoolean",
    "DynamicChildList",
    "DynamicNumber",
    "DynamicString",
    "DynamicStringList",
    "DynamicValue",
    "FunctionCall",
]
