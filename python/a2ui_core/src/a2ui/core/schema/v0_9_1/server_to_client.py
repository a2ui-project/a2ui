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
from .common_types import StrictBaseModel
from .constants import PROTOCOL_VERSION, PROTOCOL_VERSION_TYPE


ComponentsList = list[dict[str, Any]]
Component = dict[str, Any]


class CreateSurface(StrictBaseModel):
    """Signals the client to create a new surface and begin rendering it. It is an error to send 'createSurface' for a surfaceId that already exists without first deleting it. When this message is sent, the client will expect 'updateComponents' and/or 'updateDataModel' messages for the same surfaceId that define the component tree."""

    model_config = ConfigDict(populate_by_name=True)
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="The unique identifier for the UI surface to be rendered.",
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
    theme: Any | None = Field(
        None,
        description=(
            "Theme parameters for the surface (e.g., {'primaryColor': '#FF0000'})."
            " These must validate against the 'theme' schema defined in the catalog."
        ),
    )
    send_data_model: bool | None = Field(
        None,
        alias="sendDataModel",
        description=(
            "If true, the client will send the full data model of this surface in the"
            " metadata of every A2A message sent to the server that created the"
            " surface. Defaults to false."
        ),
    )


class CreateSurfaceMessage(StrictBaseModel):
    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION
    create_surface: CreateSurface = Field(..., alias="createSurface")


class UpdateComponents(StrictBaseModel):
    """Updates a surface with a new set of components. This message can be sent multiple times to update the component tree of an existing surface. One of the components in one of the components lists MUST have an 'id' of 'root' to serve as the root of the component tree. The createSurface message MUST have been previously sent with the 'catalogId' that is in this message."""

    model_config = ConfigDict(populate_by_name=True)
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="The unique identifier for the UI surface to be updated.",
    )
    components: list[dict[str, Any]] = Field(
        ..., description="A list containing all UI components for the surface."
    )


class UpdateComponentsMessage(StrictBaseModel):
    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION
    update_components: UpdateComponents = Field(..., alias="updateComponents")


class UpdateDataModel(StrictBaseModel):
    """Updates the data model for an existing surface. This message can be sent multiple times to update the data model. The createSurface message MUST have been previously sent with the 'catalogId' that is in this message."""

    model_config = ConfigDict(populate_by_name=True)
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description=(
            "The unique identifier for the UI surface this data model update"
            " applies to."
        ),
    )
    path: str | None = Field(
        None,
        description=(
            "An optional path to a location within the data model (e.g., '/user/name')."
            " If omitted, or set to '/', refers to the entire data model."
        ),
    )
    value: Any | None = Field(
        None,
        description=(
            "The data to be updated in the data model. If present, the value at 'path'"
            " is replaced (or created). If omitted, the key at 'path' is removed."
        ),
    )


class UpdateDataModelMessage(StrictBaseModel):
    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION
    update_data_model: UpdateDataModel = Field(..., alias="updateDataModel")


class DeleteSurface(StrictBaseModel):
    """Signals the client to delete the surface identified by 'surfaceId'. The createSurface message MUST have been previously sent with the 'catalogId' that is in this message."""

    model_config = ConfigDict(populate_by_name=True)
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="The unique identifier for the UI surface to be deleted.",
    )


class DeleteSurfaceMessage(StrictBaseModel):
    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION
    delete_surface: DeleteSurface = Field(..., alias="deleteSurface")


ServerToClientMessage = (
    CreateSurfaceMessage
    | UpdateComponentsMessage
    | UpdateDataModelMessage
    | DeleteSurfaceMessage
)


AgentToRendererMessage = ServerToClientMessage
A2uiMessage = ServerToClientMessage


class A2uiMessageListWrapper(StrictBaseModel):
    messages: list[ServerToClientMessage] = Field(
        ..., description="A list of messages."
    )
