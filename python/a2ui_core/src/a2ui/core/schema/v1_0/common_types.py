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
    """Invokes a named function."""

    call: str = Field(..., description="The name of the function to call.")
    catalog_id: Optional[str] = Field(
        None,
        alias="catalogId",
        description=(
            "The catalog ID for this function, overriding any surface-level default"
            " catalogId."
        ),
    )
    args: Optional[Dict[str, Union[DynamicValue, Dict[str, Any]]]] = Field(
        None, description="Arguments passed to the function."
    )


DynamicValue = Union[
    str, float, bool, List[Any], Dict[str, Any], DataBinding, FunctionCall
]

DynamicString = Union[str, DataBinding, FunctionCall]

DynamicNumber = Union[float, DataBinding, FunctionCall]

DynamicBoolean = Union[bool, DataBinding, FunctionCall]

DynamicStringList = Union[List[str], DataBinding, FunctionCall]


class TemplateChildList(StrictBaseModel, ListReference):
    """A template for generating a dynamic list of children from a data model list. The `componentId` is the component to use as a template."""

    component_id: ComponentId = Field(..., alias="componentId")
    path: str = Field(
        ...,
        description=(
            "The path to the list of component property objects in the data model."
        ),
    )


ChildList = Union[List[ComponentId], TemplateChildList]


class AccessibilityAttributes(StrictBaseModel):
    """Attributes to enhance accessibility when using assistive technologies like screen readers or model understanding."""

    label: Optional[DynamicString] = Field(
        None,
        description=(
            "A short string, typically 1 to 3 words, used by assistive technologies to"
            " convey the purpose or intent of an element. For example, an input field"
            " might have an accessible label of 'User ID' or a button might be labeled"
            " 'Submit'."
        ),
    )
    description: Optional[DynamicString] = Field(
        None,
        description=(
            "Additional information provided by assistive technologies about an element"
            " such as instructions, format requirements, or result of an action. For"
            " example, a mute button might have a label of 'Mute' and a description of"
            " 'Silences notifications about this conversation'."
        ),
    )
    live: Optional[Literal["off", "polite", "assertive"]] = Field(
        description=(
            "Controls screen reader announcements for dynamic updates (WAI-ARIA"
            " aria-live). 'polite' waits for user pause; 'assertive' interrupts"
            " immediately for alerts."
        ),
        default="off",
    )
    hidden: Optional[DynamicBoolean] = Field(
        None,
        description=(
            "Hides the element and its children from assistive technologies when true."
            " Default is false."
        ),
    )


class FunctionCommon(StrictBaseModel):
    catalog_id: Optional[str] = Field(
        None,
        alias="catalogId",
        description=(
            "The catalog ID for this function, overriding any surface-level default"
            " catalogId."
        ),
    )


class IndexSystemFunctionArgs(StrictBaseModel):
    offset: Optional[DynamicNumber] = Field(
        description=(
            "Optional. An offset to add to the 0-based index (e.g., 1 for 1-based"
            " indexing). Defaults to 0."
        ),
        default=0,
    )


class IndexSystemFunction(StrictBaseModel):
    """Returns the 0-based index of the current item when rendering a dynamic list from a template. This function MUST ONLY be available when evaluating template items within a list context."""

    call: Literal["@index"] = Field("@index")
    args: Optional[IndexSystemFunctionArgs] = Field(
        None, description="Arguments passed to the @index function."
    )


class CheckRule(StrictBaseModel):
    """A single validation check rule applied to an input component. The condition function or path evaluates to a ValidationResult object."""

    condition: Union[DataBinding, FunctionCall] = Field(
        ...,
        description="Path or function call evaluating to a ValidationResult object.",
    )
    message: Optional[str] = Field(None, description="Optional fallback error message.")


class Extensions(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)
    """Optional extension metadata. Keys MUST be Unicode identifiers (UAX #31). Keys starting with 'a2ui_' are reserved for official extensions."""
    pass


class ActionEvent(StrictBaseModel):
    """The event to dispatch to the agent."""

    name: str = Field(
        ..., description="The name of the action to be dispatched to the agent."
    )
    user_message: Optional[DynamicString] = Field(
        None,
        alias="userMessage",
        description=(
            "An optional human-readable message describing the action performed by the"
            " user, to present in conversation history or user feedback."
        ),
    )
    context: Optional[Dict[str, DynamicValue]] = Field(
        None,
        description=(
            "A JSON object containing the key-value pairs for the action context."
            " Values can be literals or paths. Use literal values unless the value must"
            " be dynamically bound to the data model. Do NOT use paths for static IDs."
        ),
    )


class ActionEventWrapper(StrictBaseModel):
    """Triggers an agent-side event."""

    event: ActionEvent = Field(..., description="The event to dispatch to the agent.")


class ActionFunctionCallWrapper(StrictBaseModel):
    """Executes a renderer or agent-side function."""

    function_call: FunctionCall = Field(..., alias="functionCall")


Action = Union[ActionEventWrapper, ActionFunctionCallWrapper]


class ComponentCommon(StrictBaseModel):
    id: ComponentId = Field(...)
    catalog_id: Optional[str] = Field(
        None,
        alias="catalogId",
        description=(
            "The catalog ID for this component, overriding any surface-level default"
            " catalogId."
        ),
    )
    accessibility: Optional[AccessibilityAttributes] = Field(None)
    metadata: Optional[Dict[str, Any]] = Field(
        None, description="Optional component-level metadata for vendor extensions."
    )


class FunctionResponseError(StrictBaseModel):
    code: str = Field(...)
    message: str = Field(...)


class FunctionResponse(StrictBaseModel):
    function_call_id: Optional[str] = Field(None, alias="functionCallId")
    call_id: Optional[str] = Field(None, alias="callId")
    value: Optional[Any] = Field(None)
    result: Optional[Any] = Field(None)
    error: Optional[Union[FunctionResponseError, str, Dict[str, Any]]] = Field(None)
