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
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field, ConfigDict
from .common_types import StrictBaseModel
from .constants import SPEC_VERSION, SPEC_VERSION_TYPE


class A2uiClientAction(StrictBaseModel):
    name: str = Field(
        ...,
        description="The name of the action, taken from the component's action.event.name property.",
    )
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="The id of the surface where the event originated.",
    )
    source_component_id: str = Field(
        ...,
        alias="sourceComponentId",
        description="The id of the component that triggered the event.",
    )
    timestamp: str = Field(
        ..., description="An ISO 8601 timestamp of when the event occurred."
    )
    context: Dict[str, Any] = Field(
        ...,
        description="A JSON object containing the key-value pairs from the component's action.event.context, after resolving all data bindings.",
    )


class A2uiValidationError(StrictBaseModel):
    code: Literal["VALIDATION_FAILED"] = Field("VALIDATION_FAILED")
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="The id of the surface where the error occurred.",
    )
    path: str = Field(
        ...,
        description="The JSON pointer to the field that failed validation (e.g. '/components/0/text').",
    )
    message: str = Field(
        ...,
        description="A short one or two sentence description of why validation failed.",
    )


class A2uiGenericError(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    code: Any = Field(...)
    message: str = Field(
        ...,
        description="A short one or two sentence description of why the error occurred.",
    )
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="The id of the surface where the error occurred.",
    )


A2uiClientError = Union[A2uiValidationError, A2uiGenericError]


class A2uiClientActionMessage(StrictBaseModel):
    version: SPEC_VERSION_TYPE = SPEC_VERSION
    action: A2uiClientAction = Field(...)


class A2uiClientErrorMessage(StrictBaseModel):
    version: SPEC_VERSION_TYPE = SPEC_VERSION
    error: A2uiClientError = Field(...)


A2uiClientMessage = Union[A2uiClientActionMessage, A2uiClientErrorMessage]


class A2uiClientDataModel(StrictBaseModel):
    version: SPEC_VERSION_TYPE = SPEC_VERSION
    surfaces: Dict[str, Dict[str, Any]] = Field(
        ..., description="A map of surface IDs to their current data models."
    )


A2uiClientMessageList = List[A2uiClientMessage]


class A2uiClientMessageListWrapper(StrictBaseModel):
    messages: A2uiClientMessageList = Field(
        ..., description="An object wrapping a list of A2UI Client-to-Server messages."
    )
