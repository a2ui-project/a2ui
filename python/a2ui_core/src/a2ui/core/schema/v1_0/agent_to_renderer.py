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
from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import BaseModel, Field, ConfigDict
from .common_types import StrictBaseModel, CallId, ComponentCommon, Extensions, FunctionCall, FunctionResponse
from .constants import SPEC_VERSION, SPEC_VERSION_TYPE


ComponentsList = List[Dict[str, Any]]
Component = Dict[str, Any]


class CreateSurface(StrictBaseModel):
    """Signals the renderer to create a new surface and begin rendering it. Creating a surface implicitly instantiates the canonical 'Surface' container component ('common_types.json#/$defs/Surface') with 'child': 'root'. It is an error to try to create a surface with an existing ID without first deleting it; surfaceId MUST be globally unique for the renderer's lifetime. When this message is sent, the renderer expects 'updateComponents' and/or 'updateDataModel' messages for the same surfaceId to define the component tree."""

    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description=(
            "The unique identifier for the UI surface to be rendered. It must be"
            " globally unique for the renderer's lifetime."
        ),
    )
    catalog_id: Optional[str] = Field(
        None,
        alias="catalogId",
        description=(
            "A string that uniquely identifies the default catalog for this surface. It"
            " is recommended to prefix this with an internet domain that you own, to"
            " avoid conflicts e.g. 'mycompany.com:somecatalog'. Components and function"
            " calls that do not explicitly specify a catalogId will use this"
            " surface-level default catalogId."
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
    components: Optional[List[Dict[str, Any]]] = Field(None)
    data_model: Optional[Dict[str, Any]] = Field(
        None,
        alias="dataModel",
        description="The initial root data model object for the surface.",
    )
    metadata: Optional[Dict[str, Any]] = Field(
        None, description="Optional surface-level metadata."
    )


class CreateSurfaceMessage(StrictBaseModel):
    version: SPEC_VERSION_TYPE = SPEC_VERSION
    create_surface: CreateSurface = Field(..., alias="createSurface")


class UpdateComponents(StrictBaseModel):
    """Updates a surface with a new set of components. This message can be sent multiple times to update the component tree of an existing surface. One of the components in one of the components lists MUST have an 'id' of 'root' to serve as the root of the component tree. The createSurface message MUST have been previously sent for this surfaceId."""

    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description=(
            "The unique identifier for the UI surface to be updated. It must be"
            " globally unique for the renderer's lifetime."
        ),
    )
    components: List[Dict[str, Any]] = Field(...)


class UpdateComponentsMessage(StrictBaseModel):
    version: SPEC_VERSION_TYPE = SPEC_VERSION
    update_components: UpdateComponents = Field(..., alias="updateComponents")


class UpdateDataModel(StrictBaseModel):
    """Updates the data model for an existing surface. This message can be sent multiple times to update the data model. The createSurface message MUST have been previously sent for this surfaceId."""

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
    """Signals the renderer to delete the surface identified by 'surfaceId'. The createSurface message MUST have been previously sent for this surfaceId."""

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


class CallRendererFunction(StrictBaseModel):
    """Signals the renderer to execute a function locally on behalf of the agent."""

    function_call_id: str = Field(
        ...,
        alias="functionCallId",
        description=(
            "Unique ID for this instance of the function call. The renderer MUST copy"
            " this ID into the return response."
        ),
    )
    call_function: FunctionCall = Field(..., alias="callFunction")


class CallRendererFunctionMessage(StrictBaseModel):
    version: SPEC_VERSION_TYPE = SPEC_VERSION
    call_renderer_function: CallRendererFunction = Field(
        ..., alias="callRendererFunction"
    )


class AgentFunctionResponse(StrictBaseModel):
    pass


class AgentFunctionResponseMessage(StrictBaseModel):
    version: SPEC_VERSION_TYPE = SPEC_VERSION
    agent_function_response: AgentFunctionResponse = Field(
        ..., alias="agentFunctionResponse"
    )


AgentToRendererMessage = Union[
    CreateSurfaceMessage,
    UpdateComponentsMessage,
    UpdateDataModelMessage,
    DeleteSurfaceMessage,
    CallRendererFunctionMessage,
    AgentFunctionResponseMessage,
]


AgentToRendererMessageList = List[AgentToRendererMessage]


class AgentToRendererMessageListWrapper(StrictBaseModel):
    messages: AgentToRendererMessageList = Field(
        ..., description="An object wrapping a list of A2UI Agent-to-Renderer messages."
    )
