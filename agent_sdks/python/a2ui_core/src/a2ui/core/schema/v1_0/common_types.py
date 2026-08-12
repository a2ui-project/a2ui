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

"""Common type definitions used across A2UI v1.0 schemas."""

from typing import Annotated, Any, Dict, List, Literal, Optional, TypeAlias, Union
from pydantic import BaseModel, ConfigDict, Field, GetCoreSchemaHandler
from pydantic_core import CoreSchema


class ComponentReference:
    """Base marker class for all A2UI component references."""


class SingleReference(str, ComponentReference):
    """Marker class indicating a field holds a single component reference string."""

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
    """Strict base model forbidding extra fields and enabling population by field name."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)


ComponentId: TypeAlias = SingleReference
Child: TypeAlias = ComponentId
CallId: TypeAlias = str


class Extensions(BaseModel):
    """Optional extension metadata container allowing custom key-value pairs."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class AccessibilityAttributes(StrictBaseModel):
    """Accessibility attributes for assistive technologies and screen readers."""

    label: Optional[Union[str, Dict[str, Any]]] = Field(
        None,
        description="A short label conveying the purpose of an element.",
    )
    description: Optional[Union[str, Dict[str, Any]]] = Field(
        None,
        description="Additional context or instructions for an element.",
    )
    live: Optional[Literal["off", "polite", "assertive"]] = Field(
        "off",
        description="Controls screen reader announcements for dynamic updates.",
    )
    hidden: Optional[Union[bool, Dict[str, Any]]] = Field(
        None,
        description="Hides the element and its children from assistive tech when true.",
    )


class ComponentMetadata(StrictBaseModel):
    """Component-level metadata for vendor extensions."""

    extensions: Optional[Extensions] = Field(None, description="Extension metadata.")


class ComponentCommon(StrictBaseModel):
    """Common envelope attributes present on all UI components."""

    id: ComponentId = Field(..., description="Unique identifier for the component.")
    catalog_id: Optional[str] = Field(
        None,
        alias="catalogId",
        description="Catalog ID overriding surface-level default catalogId.",
    )
    accessibility: Optional[AccessibilityAttributes] = Field(
        None,
        description="Accessibility attributes for screen readers.",
    )
    metadata: Optional[ComponentMetadata] = Field(
        None,
        description="Optional component metadata.",
    )


class DataBinding(StrictBaseModel):
    """JSON Pointer path binding to a location in the surface data model."""

    path: str = Field(
        ...,
        description="A JSON Pointer path to a value in the data model.",
    )


DynamicString = Union[str, DataBinding, Dict[str, Any]]
DynamicNumber = Union[float, int, DataBinding, Dict[str, Any]]
DynamicBoolean = Union[bool, DataBinding, Dict[str, Any]]
DynamicValue = Union[str, float, int, bool, List[Any], DataBinding, Dict[str, Any]]
DynamicStringList = Union[List[str], DataBinding, Dict[str, Any]]


class TemplateChildList(StrictBaseModel, ListReference):
    """Template for generating a dynamic list of children from a data model path."""

    component_id: ComponentId = Field(
        ...,
        alias="componentId",
        description="Template component ID to instantiate.",
    )
    path: str = Field(
        ...,
        description="Path to the list of items in the data model.",
    )


ChildList = Union[List[ComponentId], TemplateChildList]


class FunctionCommon(StrictBaseModel):
    """Base function properties."""

    catalog_id: Optional[str] = Field(
        None,
        alias="catalogId",
        description="Catalog ID overriding surface-level default.",
    )


class IndexSystemFunctionArgs(StrictBaseModel):
    """Arguments for the system index function."""

    offset: Optional[DynamicNumber] = Field(
        0,
        description="Optional offset to add to the 0-based index.",
    )


class IndexSystemFunction(StrictBaseModel):
    """System function returning the current index when rendering template lists."""

    call: Literal["@index"] = Field("@index", description="Reserved function name.")
    args: Optional[IndexSystemFunctionArgs] = Field(
        None,
        description="Arguments passed to index function.",
    )


class FunctionCall(StrictBaseModel):
    """Named function invocation signature with typed or dynamic arguments."""

    call: str = Field(..., description="Name of the function to call.")
    catalog_id: Optional[str] = Field(
        None,
        alias="catalogId",
        description="Catalog ID for the function.",
    )
    args: Optional[Dict[str, Any]] = Field(
        None,
        description="Key-value arguments passed to the function.",
    )


class ValidationResult(StrictBaseModel):
    """Container holding validation outcome status and failure messages."""

    valid: bool = Field(True, description="Whether validation succeeded.")
    message: Optional[str] = Field(None, description="Validation failure explanation.")


class CheckRule(StrictBaseModel):
    """Single validation rule applied to an input component."""

    condition: Union[DataBinding, FunctionCall, Dict[str, Any]] = Field(
        ...,
        description="Path or function call evaluating to a ValidationResult.",
    )
    message: Optional[str] = Field(None, description="Optional fallback error message.")


class Checkable(StrictBaseModel):
    """Properties for components supporting renderer-side validation checks."""

    checks: Optional[List[CheckRule]] = Field(
        None,
        description="List of validation checks to perform.",
    )


class ActionEvent(StrictBaseModel):
    """Agent-side action event descriptor."""

    name: str = Field(..., description="Action event name.")
    user_message: Optional[DynamicString] = Field(
        None,
        alias="userMessage",
        description="Human-readable description of user action.",
    )
    context: Optional[Dict[str, DynamicValue]] = Field(
        None,
        description="Key-value action context.",
    )


class ActionEventWrapper(StrictBaseModel):
    """Wrapper object for agent-side action events."""

    event: ActionEvent = Field(..., description="Dispatched action event.")


class ActionFunctionCallWrapper(StrictBaseModel):
    """Wrapper object executing a local function call action."""

    function_call: FunctionCall = Field(
        ...,
        alias="functionCall",
        description="Function call to execute.",
    )


Action = Union[ActionEventWrapper, ActionFunctionCallWrapper]


class Surface(StrictBaseModel):
    """Reserved canonical container component representing an A2UI surface."""

    component: Literal["Surface"] = Field(
        "Surface", description="Surface component discriminator."
    )
    child: Literal["root"] = Field("root", description="Root child reference.")


class FunctionError(StrictBaseModel):
    """Error object details returned upon function execution failure."""

    code: str = Field(..., description="Error code identifier.")
    message: str = Field(..., description="Error message description.")


class FunctionResponse(StrictBaseModel):
    """Response matching a callAgentFunction or callRendererFunction invocation."""

    function_call_id: CallId = Field(
        ...,
        alias="functionCallId",
        description="Function call ID matching the invocation.",
    )
    value: Optional[Any] = Field(None, description="Return value upon success.")
    error: Optional[FunctionError] = Field(
        None, description="Error details upon failure."
    )


class DataModelUpdate(StrictBaseModel):
    """Represents an atomic update to a surface data model path."""

    path: Optional[str] = Field(None, description="Target data model path.")
    value: Any = Field(..., description="Value to write at path.")
