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

"""Protocol v0.9 data models, bindings, actions, and type aliases for A2UI builders."""

from __future__ import annotations

from typing import Any, Optional, Sequence, TypeAlias, Union
from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_serializer,
)

from ..core.base_node import ComponentBuilderNode


class DataBinding(BaseModel):
    """A two-way binding to a path in the client data model."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        arbitrary_types_allowed=False,
        validate_by_name=True,
    )

    path: str

    @field_validator("path")
    @classmethod
    def _normalize_path(cls, v: str) -> str:
        return v if v.startswith("/") else f"/{v}"

    @model_serializer
    def serialize_model(self) -> dict[str, Any]:
        return {"path": self.path}

    def to_dict(self) -> dict[str, Any]:
        return {"path": self.path}


def bind(path: str) -> DataBinding:
    """Ergonomic helper to construct a DataBinding."""
    return DataBinding(path=path)


class AccessibilityAttributes(BaseModel):
    """Attributes to enhance accessibility when using assistive technologies."""

    model_config = ConfigDict(
        extra="forbid",
        arbitrary_types_allowed=False,
        validate_by_name=True,
    )

    label: Optional[Union[str, DataBinding]] = None
    description: Optional[Union[str, DataBinding]] = None
    live: Optional[str] = None
    hidden: Optional[Union[bool, DataBinding]] = None

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True, by_alias=True)


class FunctionCall(BaseModel):
    """Invocation of a client-side catalog function."""

    model_config = ConfigDict(
        extra="forbid",
        arbitrary_types_allowed=False,
        populate_by_name=True,
    )

    call: str
    args: dict[str, Any] = Field(default_factory=dict)
    call_id: Optional[str] = Field(
        default=None,
        serialization_alias="callId",
        validation_alias=AliasChoices("call_id", "callId"),
    )

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True, by_alias=True)


class Action(BaseModel):
    """An interaction handler dispatching a server event or client function."""

    model_config = ConfigDict(
        extra="forbid",
        arbitrary_types_allowed=False,
        validate_by_name=True,
    )

    event: Optional[Union[str, dict[str, Any]]] = None
    function: Optional[FunctionCall] = None
    context: Optional[dict[str, Any]] = None

    @model_serializer
    def serialize_model(self) -> dict[str, Any]:
        if self.event is not None:
            if isinstance(self.event, str):
                d: dict[str, Any] = {"name": self.event}
                if self.context:
                    d["context"] = {
                        k: (
                            v.model_dump(exclude_none=True, by_alias=True)
                            if isinstance(v, BaseModel)
                            else (v.to_dict() if hasattr(v, "to_dict") else v)
                        )
                        for k, v in self.context.items()
                    }
                return {"event": d}
            elif isinstance(self.event, dict):
                ev = dict(self.event)
                if self.context and "context" not in ev:
                    ev["context"] = {
                        k: (
                            v.model_dump(exclude_none=True, by_alias=True)
                            if isinstance(v, BaseModel)
                            else (v.to_dict() if hasattr(v, "to_dict") else v)
                        )
                        for k, v in self.context.items()
                    }
                if "name" in ev:
                    return {"event": ev}
                return {"event": {"name": ev.get("name", "action"), **ev}}
            return {"event": self.event}
        if self.function is not None:
            return {
                "function": self.function.model_dump(exclude_none=True, by_alias=True)
            }
        return {}

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True, by_alias=True)


class CheckRule(BaseModel):
    """A client-side validation check (condition + error message)."""

    model_config = ConfigDict(
        extra="forbid",
        arbitrary_types_allowed=False,
        validate_by_name=True,
    )

    condition: FunctionCall
    message: str

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True, by_alias=True)


class DynamicChildList(BaseModel):
    """Generates dynamic children from a collection in the data model."""

    model_config = ConfigDict(
        extra="forbid",
        arbitrary_types_allowed=False,
        validate_by_name=True,
    )

    data_model_path: str = Field(
        serialization_alias="dataModelPath",
        validation_alias=AliasChoices("data_model_path", "dataModelPath"),
    )
    template: ComponentBuilderNode

    @field_validator("data_model_path")
    @classmethod
    def _normalize_path(cls, v: str) -> str:
        return v if v.startswith("/") else f"/{v}"

    @model_serializer(mode="wrap")
    def _serialize(self, handler: Any) -> dict[str, Any]:
        tmpl = self.template
        return {
            "dataModelPath": self.data_model_path,
            "template": (
                tmpl.to_dict() if hasattr(tmpl, "to_dict") else tmpl.model_dump()
            ),
        }

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump(exclude_none=True, by_alias=True)


# Canonical Protocol Type Aliases
DynamicString = Union[str, DataBinding, FunctionCall]
DynamicNumber = Union[int, float, DataBinding, FunctionCall]
DynamicBoolean = Union[bool, DataBinding, FunctionCall]
DynamicStringList = Union[Sequence[str], DataBinding, FunctionCall]
DynamicValue = Union[Any, DataBinding, FunctionCall]

Slot: TypeAlias = ComponentBuilderNode
SlotList: TypeAlias = Sequence[Slot]
Child = Slot
ChildList = Union[Sequence[ComponentBuilderNode], DynamicChildList]
