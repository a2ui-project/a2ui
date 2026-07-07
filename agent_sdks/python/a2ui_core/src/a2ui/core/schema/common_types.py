# Copyright 2026 Google LLC
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
from typing import Annotated, Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field, ConfigDict, GetCoreSchemaHandler
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


ComponentId = SingleReference


class DataBinding(StrictBaseModel):
    path: str = Field(
        ..., description="A JSON Pointer path to a value in the data model."
    )


class FunctionCall(StrictBaseModel):
    call: str = Field(..., description="The name of the function to call.")
    args: Optional[Dict[str, Any]] = Field(
        None, description="Arguments passed to the function."
    )
    return_type: Optional[
        Literal["string", "number", "boolean", "array", "object", "any", "void"]
    ] = Field(
        alias="returnType",
        description="The expected return type of the function call.",
        default="boolean",
    )


DynamicValue = Union[str, float, bool, List[Any], DataBinding, FunctionCall]

DynamicString = Union[str, DataBinding, FunctionCall]

DynamicNumber = Union[float, DataBinding, FunctionCall]

DynamicBoolean = Union[bool, DataBinding, FunctionCall]

DynamicStringList = Union[List[str], DataBinding, FunctionCall]


class TemplateChildList(StrictBaseModel, ListReference):
    component_id: ComponentId = Field(..., alias="componentId")
    path: str = Field(
        ...,
        description="The path to the list of component property objects in the data model.",
    )


ChildList = Union[List[ComponentId], TemplateChildList]


class AccessibilityAttributes(StrictBaseModel):
    label: Optional[DynamicString] = Field(
        None,
        description="A short string, typically 1 to 3 words, used by assistive technologies to convey the purpose or intent of an element. For example, an input field might have an accessible label of 'User ID' or a button might be labeled 'Submit'.",
    )
    description: Optional[DynamicString] = Field(
        None,
        description="Additional information provided by assistive technologies about an element such as instructions, format requirements, or result of an action. For example, a mute button might have a label of 'Mute' and a description of 'Silences notifications about this conversation'.",
    )


class CheckRule(StrictBaseModel):
    condition: DynamicBoolean = Field(...)
    message: str = Field(
        ..., description="The error message to display if the check fails."
    )


class ActionEvent(StrictBaseModel):
    name: str = Field(
        ..., description="The name of the action to be dispatched to the server."
    )
    context: Optional[Dict[str, Any]] = Field(
        None,
        description="A JSON object containing the key-value pairs for the action context. Values can be literals or paths. Use literal values unless the value must be dynamically bound to the data model. Do NOT use paths for static IDs.",
    )


class ActionEventWrapper(StrictBaseModel):
    event: ActionEvent = Field(..., description="The event to dispatch to the server.")


class ActionFunctionCallWrapper(StrictBaseModel):
    function_call: FunctionCall = Field(..., alias="functionCall")


Action = Union[ActionEventWrapper, ActionFunctionCallWrapper]


class ComponentCommon(StrictBaseModel):
    id: ComponentId = Field(...)
    accessibility: Optional[AccessibilityAttributes] = Field(None)
