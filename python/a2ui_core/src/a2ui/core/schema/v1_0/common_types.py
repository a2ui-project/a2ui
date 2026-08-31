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
from pydantic import AfterValidator, BaseModel, Field, ConfigDict
from ..common_types import (
    Child,
    ChildList,
    ComponentId,
    ComponentReference,
    DataBinding,
    DynamicBoolean,
    DynamicNumber,
    DynamicString,
    DynamicStringList,
    FunctionCall,
    ListReference,
    SingleReference,
    StrictBaseModel,
    TemplateChildList,
)


CallId = str


class AccessibilityAttributes(StrictBaseModel):
    """Attributes to enhance accessibility when using assistive technologies like screen readers or model understanding."""

    model_config = ConfigDict(populate_by_name=True)
    label: DynamicString | None = Field(
        None,
        description=(
            "A short string, typically 1 to 3 words, used by assistive technologies to"
            " convey the purpose or intent of an element. For example, an input field"
            " might have an accessible label of 'User ID' or a button might be labeled"
            " 'Submit'."
        ),
    )
    description: DynamicString | None = Field(
        None,
        description=(
            "Additional information provided by assistive technologies about an element"
            " such as instructions, format requirements, or result of an action. For"
            " example, a mute button might have a label of 'Mute' and a description of"
            " 'Silences notifications about this conversation'."
        ),
    )
    live: Literal["off", "polite", "assertive"] | None = Field(
        description=(
            "Controls screen reader announcements for dynamic updates (WAI-ARIA"
            " aria-live). 'polite' waits for user pause; 'assertive' interrupts"
            " immediately for alerts."
        ),
        default="off",
    )
    hidden: DynamicBoolean | None = Field(
        None,
        description=(
            "Hides the element and its children from assistive technologies when true."
            " Default is false."
        ),
    )


class Extensions(StrictBaseModel):
    """Optional extension metadata. Keys MUST be Unicode identifiers (UAX #31). Keys starting with 'a2ui_' are reserved for official extensions."""

    model_config = ConfigDict(populate_by_name=True)
    pass


class ComponentCommon(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: ComponentId = Field(...)
    catalog_id: str | None = Field(
        None,
        alias="catalogId",
        description=(
            "The catalog ID for this component, overriding any surface-level default"
            " catalogId."
        ),
    )
    accessibility: AccessibilityAttributes | None = Field(None)
    metadata: dict[str, Any] | None = Field(
        None, description="Optional component-level metadata for vendor extensions."
    )


def _validate_literal_object(v: Any) -> dict[str, Any]:
    if not isinstance(v, dict):
        raise ValueError("Expected a dictionary object")
    forbidden = {"call", "path"}
    found = forbidden.intersection(v.keys())
    if found:
        raise ValueError(
            "Object in DynamicValue cannot contain forbidden properties:"
            f" {', '.join(sorted(found))}"
        )
    return v


LiteralObject = Annotated[dict[str, Any], AfterValidator(_validate_literal_object)]


DynamicValue = (
    str | float | bool | list[Any] | DataBinding | FunctionCall | LiteralObject
)


class FunctionCommon(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    catalog_id: str | None = Field(
        None,
        alias="catalogId",
        description=(
            "The catalog ID for this function, overriding any surface-level default"
            " catalogId."
        ),
    )


class IndexSystemFunctionArgs(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    offset: DynamicNumber | None = Field(
        description=(
            "Optional. An offset to add to the 0-based index (e.g., 1 for 1-based"
            " indexing). Defaults to 0."
        ),
        default=0,
    )


class IndexSystemFunction(StrictBaseModel):
    """Returns the 0-based index of the current item when rendering a dynamic list from a template. This function MUST ONLY be available when evaluating template items within a list context."""

    model_config = ConfigDict(populate_by_name=True)
    call: Literal["@index"] = Field("@index")
    args: IndexSystemFunctionArgs | None = Field(None)


class CheckRule(StrictBaseModel):
    """A single validation check rule applied to an input component. The condition function or path evaluates to a structured validation result object."""

    model_config = ConfigDict(populate_by_name=True)
    condition: DataBinding | FunctionCall = Field(
        ...,
        description=(
            "Path or function call evaluating to a structured validation result object."
        ),
    )
    message: str | None = Field(None, description="Optional fallback error message.")


class Checkable(StrictBaseModel):
    """Properties for components that support renderer-side checks."""

    model_config = ConfigDict(populate_by_name=True)
    checks: list[CheckRule] | None = Field(
        None,
        description=(
            "A list of checks to perform. These are function calls that must return a"
            " boolean indicating validity."
        ),
    )


class ActionEvent(StrictBaseModel):
    """The event to dispatch to the agent."""

    model_config = ConfigDict(populate_by_name=True)
    name: str = Field(
        ..., description="The name of the action to be dispatched to the agent."
    )
    user_message: DynamicString | None = Field(
        None,
        alias="userMessage",
        description=(
            "An optional human-readable message describing the action performed by the"
            " user, to present in conversation history or user feedback."
        ),
    )
    context: dict[str, DynamicValue] | None = Field(
        None,
        description=(
            "A JSON object containing the key-value pairs for the action context."
            " Values can be literals or paths. Use literal values unless the value must"
            " be dynamically bound to the data model. Do NOT use paths for static IDs."
        ),
    )


class ActionEventWrapper(StrictBaseModel):
    """Triggers an agent-side event."""

    model_config = ConfigDict(populate_by_name=True)
    event: ActionEvent = Field(..., description="The event to dispatch to the agent.")


class ActionFunctionCallWrapper(StrictBaseModel):
    """Executes a renderer or agent-side function."""

    model_config = ConfigDict(populate_by_name=True)
    function_call: FunctionCall = Field(..., alias="functionCall")


Action = ActionEventWrapper | ActionFunctionCallWrapper


class Surface(StrictBaseModel):
    """The reserved canonical container component representing an A2UI surface. The Surface component is immutable and always has 'child': 'root'."""

    model_config = ConfigDict(populate_by_name=True)
    child: Literal["root"] | None = Field(default="root")


class FunctionResponseError(StrictBaseModel):
    """An error object indicating failure of the function execution."""

    model_config = ConfigDict(populate_by_name=True)
    code: str = Field(...)
    message: str = Field(...)


class FunctionResponse(StrictBaseModel):
    """The return response matching a callAgentFunction or callRendererFunction invocation."""

    model_config = ConfigDict(populate_by_name=True)
    function_call_id: str = Field(
        ...,
        alias="functionCallId",
        description="The unique ID matching the initiating function call.",
    )
    value: Any | None = Field(None, description="The return value of the function.")
    error: FunctionResponseError | None = Field(
        None,
        description="An error object indicating failure of the function execution.",
    )


__all__ = [
    "AccessibilityAttributes",
    "Action",
    "ActionEvent",
    "ActionEventWrapper",
    "ActionFunctionCallWrapper",
    "CallId",
    "CheckRule",
    "Checkable",
    "Child",
    "ChildList",
    "ComponentCommon",
    "ComponentId",
    "ComponentReference",
    "DataBinding",
    "DynamicBoolean",
    "DynamicNumber",
    "DynamicString",
    "DynamicStringList",
    "DynamicValue",
    "Extensions",
    "FunctionCall",
    "FunctionCommon",
    "FunctionResponse",
    "FunctionResponseError",
    "IndexSystemFunction",
    "IndexSystemFunctionArgs",
    "ListReference",
    "LiteralObject",
    "SingleReference",
    "StrictBaseModel",
    "Surface",
    "TemplateChildList",
]
