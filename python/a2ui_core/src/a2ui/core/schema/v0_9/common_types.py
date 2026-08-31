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


class AccessibilityAttributes(StrictBaseModel):
    """Attributes to enhance accessibility when using assistive technologies like screen readers."""

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


class ComponentCommon(StrictBaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: ComponentId = Field(...)
    accessibility: AccessibilityAttributes | None = Field(None)


DynamicValue = str | float | bool | list[Any] | DataBinding | FunctionCall


class CheckRule(StrictBaseModel):
    """A single validation rule applied to an input component."""

    model_config = ConfigDict(populate_by_name=True)
    condition: DynamicBoolean = Field(...)
    message: str = Field(
        ..., description="The error message to display if the check fails."
    )


class Checkable(StrictBaseModel):
    """Properties for components that support client-side checks."""

    model_config = ConfigDict(populate_by_name=True)
    checks: list[CheckRule] | None = Field(
        None,
        description=(
            "A list of checks to perform. These are function calls that must return a"
            " boolean indicating validity."
        ),
    )


class ActionEvent(StrictBaseModel):
    """The event to dispatch to the server."""

    model_config = ConfigDict(populate_by_name=True)
    name: str = Field(
        ..., description="The name of the action to be dispatched to the server."
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
    """Triggers a server-side event."""

    model_config = ConfigDict(populate_by_name=True)
    event: ActionEvent = Field(..., description="The event to dispatch to the server.")


class ActionFunctionCallWrapper(StrictBaseModel):
    """Executes a local client-side function."""

    model_config = ConfigDict(populate_by_name=True)
    function_call: FunctionCall = Field(..., alias="functionCall")


Action = ActionEventWrapper | ActionFunctionCallWrapper

__all__ = [
    "AccessibilityAttributes",
    "Action",
    "ActionEvent",
    "ActionEventWrapper",
    "ActionFunctionCallWrapper",
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
    "FunctionCall",
    "ListReference",
    "SingleReference",
    "StrictBaseModel",
    "TemplateChildList",
]
