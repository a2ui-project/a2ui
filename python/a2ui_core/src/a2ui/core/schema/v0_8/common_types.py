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

# Auto-generated. Do not edit manually.
from __future__ import annotations
from typing import Annotated, Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field, ConfigDict, GetCoreSchemaHandler, ValidationInfo, field_validator
from pydantic_core import CoreSchema


class ComponentReference:
    """Base marker class for all A2UI component references."""


class SingleReference(str, ComponentReference):

    @classmethod
    def __get_pydantic_core_schema__(
        cls, source_type: Any, handler: GetCoreSchemaHandler
    ) -> CoreSchema:
        from pydantic_core import core_schema

        return core_schema.no_info_after_validator_function(
            cls,
            core_schema.str_schema(),
            serialization=core_schema.plain_serializer_function_ser_schema(str),
        )


class ListReference(ComponentReference):
    """Marker class indicating a field holds a list of component references."""


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("version", mode="after", check_fields=False)
    @classmethod
    def validate_version_field(cls, v: Any, info: ValidationInfo) -> Any:
        context = info.context or {}
        target_version = context.get("target_version")
        if target_version is None:
            from .constants import SPEC_VERSION

            target_version = SPEC_VERSION
        if v != target_version:
            raise ValueError(f"Input should be '{target_version}'")
        return v


ComponentId = SingleReference
Child = SingleReference
CallId = str


class DataBinding(StrictBaseModel):
    path: str = Field(
        ..., description="A JSON Pointer path to a value in the data model."
    )


class FunctionCall(StrictBaseModel):
    call: str = Field(..., description="The name of the function to call.")
    args: Optional[Dict[str, Any]] = Field(None)
    return_type: Optional[str] = Field("boolean", alias="returnType")


DynamicValue = Union[str, float, bool, List[Any], DataBinding, FunctionCall]

DynamicString = Union[str, DataBinding, FunctionCall]

DynamicNumber = Union[float, DataBinding, FunctionCall]

DynamicBoolean = Union[bool, DataBinding, FunctionCall]

DynamicStringList = Union[List[str], DataBinding, FunctionCall]


class TemplateChildList(StrictBaseModel, ListReference):
    component_id: ComponentId = Field(..., alias="componentId")
    path: str = Field(...)


ChildList = Union[List[ComponentId], TemplateChildList]


class AccessibilityAttributes(StrictBaseModel):
    label: Optional[DynamicString] = Field(None)
    description: Optional[DynamicString] = Field(None)
    live: Literal["off", "polite", "assertive"] = Field("off")
    hidden: Optional[DynamicBoolean] = Field(None)


class CheckRule(StrictBaseModel):
    condition: Any = Field(...)
    message: Optional[str] = Field(None)


class ActionEvent(StrictBaseModel):
    name: str = Field(...)
    context: Optional[Dict[str, Any]] = Field(None)


class ActionEventWrapper(StrictBaseModel):
    event: ActionEvent = Field(...)


class ActionFunctionCallWrapper(StrictBaseModel):
    function_call: FunctionCall = Field(..., alias="functionCall")


Action = Union[ActionEventWrapper, ActionFunctionCallWrapper]


class ComponentCommon(StrictBaseModel):
    id: ComponentId = Field(...)
    accessibility: Optional[AccessibilityAttributes] = Field(None)
