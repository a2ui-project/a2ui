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
from .constants import SPEC_VERSION


class CreateSurface(StrictBaseModel):
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="The unique identifier for the UI surface to be rendered.",
    )
    catalog_id: str = Field(
        ...,
        alias="catalogId",
        description="A string that uniquely identifies this catalog. It is recommended to prefix this with an internet domain that you own, to avoid conflicts e.g. mycompany.com:somecatalog'.",
    )
    theme: Optional[Any] = Field(
        None,
        description="Theme parameters for the surface (e.g., {'primaryColor': '#FF0000'}). These must validate against the 'theme' schema defined in the catalog.",
    )
    send_data_model: Optional[bool] = Field(
        None,
        alias="sendDataModel",
        description="If true, the client will send the full data model of this surface in the metadata of every A2A message sent to the server that created the surface. Defaults to false.",
    )


class CreateSurfaceMessage(StrictBaseModel):
    version: Literal[SPEC_VERSION] = SPEC_VERSION
    create_surface: CreateSurface = Field(..., alias="createSurface")


class UpdateComponents(StrictBaseModel):
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="The unique identifier for the UI surface to be updated.",
    )
    components: List[Any] = Field(
        ..., description="A list containing all UI components for the surface."
    )


class UpdateComponentsMessage(StrictBaseModel):
    version: Literal[SPEC_VERSION] = SPEC_VERSION
    update_components: UpdateComponents = Field(..., alias="updateComponents")


class UpdateDataModel(StrictBaseModel):
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="The unique identifier for the UI surface this data model update applies to.",
    )
    path: Optional[str] = Field(
        None,
        description="An optional path to a location within the data model (e.g., '/user/name'). If omitted, or set to '/', refers to the entire data model.",
    )
    value: Optional[Any] = Field(
        None,
        description="The data to be updated in the data model. If present, the value at 'path' is replaced (or created). If omitted, the key at 'path' is removed.",
    )


class UpdateDataModelMessage(StrictBaseModel):
    version: Literal[SPEC_VERSION] = SPEC_VERSION
    update_data_model: UpdateDataModel = Field(..., alias="updateDataModel")


class DeleteSurface(StrictBaseModel):
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="The unique identifier for the UI surface to be deleted.",
    )


class DeleteSurfaceMessage(StrictBaseModel):
    version: Literal[SPEC_VERSION] = SPEC_VERSION
    delete_surface: DeleteSurface = Field(..., alias="deleteSurface")


A2uiMessage = Union[
    CreateSurfaceMessage,
    UpdateComponentsMessage,
    UpdateDataModelMessage,
    DeleteSurfaceMessage,
]


class A2uiMessageListWrapper(StrictBaseModel):
    messages: List[A2uiMessage] = Field(..., description="A list of messages.")
