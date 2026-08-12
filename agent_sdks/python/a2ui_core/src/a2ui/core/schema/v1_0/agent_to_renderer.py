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

"""Pydantic v2 models for Agent-to-Renderer v1.0 messages."""

from typing import Any, Dict, List, Literal, Optional, Union
from pydantic import Field
from .common_types import CallId, FunctionCall, FunctionResponse, StrictBaseModel
from .constants import VERSION_1_0


class CreateSurface(StrictBaseModel):
    """Payload instructing the renderer to create and initialize a surface."""

    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="Globally unique identifier for the surface.",
    )
    catalog_id: Optional[str] = Field(
        None,
        alias="catalogId",
        description="Default catalog identifier for the surface.",
    )
    send_data_model: Optional[bool] = Field(
        False,
        alias="sendDataModel",
        description="Whether renderer sends full data model in action metadata.",
    )
    components: Optional[List[Dict[str, Any]]] = Field(
        None,
        description="Initial list of UI components for the surface.",
    )
    data_model: Optional[Dict[str, Any]] = Field(
        None,
        alias="dataModel",
        description="Initial root data model object.",
    )
    metadata: Optional[Dict[str, Any]] = Field(
        None,
        description="Optional surface metadata.",
    )


class CreateSurfaceMessage(StrictBaseModel):
    """Envelope wrapping a createSurface message payload."""

    version: Literal["v1.0"] = Field(
        VERSION_1_0, description="Protocol specification version."
    )
    create_surface: CreateSurface = Field(
        ...,
        alias="createSurface",
        description="Create surface instruction payload.",
    )


class UpdateComponents(StrictBaseModel):
    """Payload instructing the renderer to update a surface component tree."""

    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="Identifier of the target surface.",
    )
    components: List[Dict[str, Any]] = Field(
        ...,
        description="List of updated UI components.",
    )


class UpdateComponentsMessage(StrictBaseModel):
    """Envelope wrapping an updateComponents message payload."""

    version: Literal["v1.0"] = Field(
        VERSION_1_0, description="Protocol specification version."
    )
    update_components: UpdateComponents = Field(
        ...,
        alias="updateComponents",
        description="Update components payload.",
    )


# Aliases for v1.0 surface component updates
UpdateSurface = UpdateComponents
UpdateSurfaceMessage = UpdateComponentsMessage


class UpdateDataModel(StrictBaseModel):
    """Payload updating the data model of an active surface."""

    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="Identifier of target surface.",
    )
    path: Optional[str] = Field(
        None,
        description="JSON Pointer path into data model. Defaults to root path '/'.",
    )
    value: Any = Field(
        ...,
        description="Value to write or update at target path.",
    )


class UpdateDataModelMessage(StrictBaseModel):
    """Envelope wrapping an updateDataModel message payload."""

    version: Literal["v1.0"] = Field(
        VERSION_1_0, description="Protocol specification version."
    )
    update_data_model: UpdateDataModel = Field(
        ...,
        alias="updateDataModel",
        description="Update data model payload.",
    )


class DeleteSurface(StrictBaseModel):
    """Payload instructing renderer to delete an active surface."""

    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="Identifier of surface to delete.",
    )


class DeleteSurfaceMessage(StrictBaseModel):
    """Envelope wrapping a deleteSurface message payload."""

    version: Literal["v1.0"] = Field(
        VERSION_1_0, description="Protocol specification version."
    )
    delete_surface: DeleteSurface = Field(
        ...,
        alias="deleteSurface",
        description="Delete surface payload.",
    )


class CallRendererFunction(StrictBaseModel):
    """Payload instructing renderer to execute a function locally."""

    function_call_id: CallId = Field(
        ...,
        alias="functionCallId",
        description="Unique function call instance ID.",
    )
    call_function: FunctionCall = Field(
        ...,
        alias="callFunction",
        description="Function signature and argument payload.",
    )


class CallRendererFunctionMessage(StrictBaseModel):
    """Envelope wrapping a callRendererFunction message payload."""

    version: Literal["v1.0"] = Field(
        VERSION_1_0, description="Protocol specification version."
    )
    call_renderer_function: CallRendererFunction = Field(
        ...,
        alias="callRendererFunction",
        description="Call renderer function payload.",
    )


class AgentFunctionResponseMessage(StrictBaseModel):
    """Envelope wrapping an agentFunctionResponse return payload."""

    version: Literal["v1.0"] = Field(
        VERSION_1_0, description="Protocol specification version."
    )
    agent_function_response: FunctionResponse = Field(
        ...,
        alias="agentFunctionResponse",
        description="Function response payload.",
    )


AgentToRendererMessage = Union[
    CreateSurfaceMessage,
    UpdateComponentsMessage,
    UpdateDataModelMessage,
    DeleteSurfaceMessage,
    CallRendererFunctionMessage,
    AgentFunctionResponseMessage,
]
