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

from .common_types import *
from .constants import SPEC_VERSION, SPEC_VERSION_TYPE

ComponentsList = List[Any]


class CreateSurface(StrictBaseModel):
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description=(
            "The unique identifier for the UI surface to be rendered. It must be"
            " globally unique for the renderer's lifetime."
        ),
    )
    catalog_id: str = Field(
        ...,
        alias="catalogId",
        description=(
            "A string that uniquely identifies this catalog. It is recommended to"
            " prefix this with an internet domain that you own, to avoid conflicts e.g."
            " mycompany.com:somecatalog'."
        ),
    )
    surface_properties: Optional[Any] = Field(
        None,
        alias="surfaceProperties",
        description=(
            "Initial surface properties (e.g., {'agentDisplayName': 'My Agent'}). These"
            " must validate against the 'surfaceProperties' schema defined in the"
            " catalog."
        ),
    )
    send_data_model: Optional[bool] = Field(
        None,
        alias="sendDataModel",
        description=(
            "If true, the renderer will send the full data model of this surface in the"
            " metadata of every A2A message sent to the agent that created the surface."
            " Defaults to false."
        ),
    )
    components: Optional[ComponentsList] = Field(None)
    data_model: Optional[Dict[str, Any]] = Field(
        None,
        alias="dataModel",
        description="The initial root data model object for the surface.",
    )


class CreateSurfaceMessage(StrictBaseModel):
    version: SPEC_VERSION_TYPE = SPEC_VERSION
    create_surface: CreateSurface = Field(..., alias="createSurface")


class UpdateComponents(StrictBaseModel):
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description=(
            "The unique identifier for the UI surface to be updated. It must be"
            " globally unique for the renderer's lifetime."
        ),
    )
    components: ComponentsList = Field(...)


class UpdateComponentsMessage(StrictBaseModel):
    version: SPEC_VERSION_TYPE = SPEC_VERSION
    update_components: UpdateComponents = Field(..., alias="updateComponents")


class UpdateDataModel(StrictBaseModel):
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description=(
            "The unique identifier for the UI surface this data model update applies"
            " to. It must be globally unique for the renderer's lifetime."
        ),
    )
    path: Optional[str] = Field(
        None,
        description=(
            "An optional path to a location within the data model (e.g., '/user/name')."
            " If omitted, or set to '/', refers to the entire data model."
        ),
    )
    value: Any = Field(
        ...,
        description=(
            "The data to be updated in the data model. To delete the key/value at"
            " 'path', set 'value' explicitly to null."
        ),
    )


class UpdateDataModelMessage(StrictBaseModel):
    version: SPEC_VERSION_TYPE = SPEC_VERSION
    update_data_model: UpdateDataModel = Field(..., alias="updateDataModel")


class DeleteSurface(StrictBaseModel):
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description=(
            "The unique identifier for the UI surface to be deleted. It must be"
            " globally unique for the renderer's lifetime."
        ),
    )


class DeleteSurfaceMessage(StrictBaseModel):
    version: SPEC_VERSION_TYPE = SPEC_VERSION
    delete_surface: DeleteSurface = Field(..., alias="deleteSurface")


class CallFunction(StrictBaseModel):
    pass


class CallFunctionMessage(StrictBaseModel):
    version: SPEC_VERSION_TYPE = SPEC_VERSION
    function_call_id: CallId = Field(
        ...,
        alias="functionCallId",
        description=(
            "Unique ID for the instance of this function call. MUST be copied verbatim"
            " into the functionResponse or error."
        ),
    )
    want_response: Optional[bool] = Field(False, alias="wantResponse")
    call_function: CallFunction = Field(..., alias="callFunction")


class ActionResponse(StrictBaseModel):
    value: Optional[Any] = Field(None, description="The return value of the action.")
    error: Optional[Dict[str, Any]] = Field(None)


class ActionResponseMessage(StrictBaseModel):
    version: SPEC_VERSION_TYPE = SPEC_VERSION
    action_id: str = Field(
        ...,
        alias="actionId",
        description="The ID of the action call this response belongs to.",
    )
    action_response: ActionResponse = Field(..., alias="actionResponse")


A2uiMessage = Union[
    CreateSurfaceMessage,
    UpdateComponentsMessage,
    UpdateDataModelMessage,
    DeleteSurfaceMessage,
    CallFunctionMessage,
    ActionResponseMessage,
]


class A2uiMessageListWrapper(StrictBaseModel):
    messages: List[A2uiMessage] = Field(..., description="A list of messages.")
