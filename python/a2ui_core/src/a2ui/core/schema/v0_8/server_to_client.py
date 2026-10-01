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
"""Describes a JSON payload for an A2UI (Agent to UI) message, which is used to dynamically construct and update user interfaces. A message MUST contain exactly ONE of the action properties: 'beginRendering', 'surfaceUpdate', 'dataModelUpdate', or 'deleteSurface'."""

from __future__ import annotations
from typing import Annotated, Any, Final, Literal
from pydantic import BaseModel, Field, ConfigDict
from .._json_schema import INLINE_DEF_MARKER, SchemaKeywords
from ..common_types import StrictBaseModel
from .constants import PROTOCOL_VERSION, PROTOCOL_VERSION_TYPE


ComponentsList = list[dict[str, Any]]
Component = dict[str, Any]


class BeginRendering(StrictBaseModel):
    """Signals the client to begin rendering a surface with a root component and specific styles."""

    model_config = ConfigDict(
        populate_by_name=True,
        json_schema_extra=SchemaKeywords({"required": ["root", "surfaceId"]}),
    )
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="The unique identifier for the UI surface to be rendered.",
    )
    catalog_id: str | None = Field(
        default=None,
        alias="catalogId",
        description=(
            "The identifier of the component catalog to use for this surface. If"
            " omitted, the client MUST default to the standard catalog for this A2UI"
            " version"
            " (https://a2ui.org/specification/v0_8/standard_catalog_definition.json)."
        ),
    )
    root: str = Field(..., description="The ID of the root component to render.")
    styles: dict[str, Any] | None = Field(
        default=None, description="Styling information for the UI."
    )


class BeginRenderingMessage(StrictBaseModel):
    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION
    begin_rendering: BeginRendering = Field(..., alias="beginRendering")


class SurfaceUpdateComponentsItem(StrictBaseModel):
    """Represents a *single* component in a UI widget tree. This component could be one of many supported types."""

    model_config = ConfigDict(
        populate_by_name=True, json_schema_extra={INLINE_DEF_MARKER: True}
    )
    id: str = Field(..., description="The unique identifier for this component.")
    weight: float | None = Field(
        default=None,
        description=(
            "The relative weight of this component within a Row or Column. This"
            " corresponds to the CSS 'flex-grow' property. Note: this may ONLY be set"
            " when the component is a direct descendant of a Row or Column."
        ),
    )
    component: dict[str, Any] = Field(
        ...,
        description=(
            "A wrapper object that MUST contain exactly one key, which is the name of"
            " the component type (e.g., 'Heading'). The value is an object containing"
            " the properties for that specific component."
        ),
    )


class SurfaceUpdate(StrictBaseModel):
    """Updates a surface with a new set of components."""

    model_config = ConfigDict(populate_by_name=True)
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description=(
            "The unique identifier for the UI surface to be updated. If you are adding"
            " a new surface this *must* be a new, unique identified that has never been"
            " used for any existing surfaces shown."
        ),
    )
    components: Annotated[
        list[SurfaceUpdateComponentsItem], SchemaKeywords({"minItems": 1})
    ] = Field(..., description="A list containing all UI components for the surface.")


class SurfaceUpdateMessage(StrictBaseModel):
    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION
    surface_update: SurfaceUpdate = Field(..., alias="surfaceUpdate")


class DataModelUpdateContentsItemValueMapItem(StrictBaseModel):
    """One entry in the map. Exactly one 'value*' property should be provided alongside the key."""

    model_config = ConfigDict(
        populate_by_name=True, json_schema_extra={INLINE_DEF_MARKER: True}
    )
    key: str = Field(...)
    value_string: str | None = Field(default=None, alias="valueString")
    value_number: float | None = Field(default=None, alias="valueNumber")
    value_boolean: bool | None = Field(default=None, alias="valueBoolean")


class DataModelUpdateContentsItem(StrictBaseModel):
    """A single data entry. Exactly one 'value*' property should be provided alongside the key."""

    model_config = ConfigDict(
        populate_by_name=True, json_schema_extra={INLINE_DEF_MARKER: True}
    )
    key: str = Field(..., description="The key for this data entry.")
    value_string: str | None = Field(default=None, alias="valueString")
    value_number: float | None = Field(default=None, alias="valueNumber")
    value_boolean: bool | None = Field(default=None, alias="valueBoolean")
    value_map: list[DataModelUpdateContentsItemValueMapItem] | None = Field(
        default=None,
        alias="valueMap",
        description="Represents a map as an adjacency list.",
    )


class DataModelUpdate(StrictBaseModel):
    """Updates the data model for a surface."""

    model_config = ConfigDict(
        populate_by_name=True,
        json_schema_extra=SchemaKeywords({"required": ["contents", "surfaceId"]}),
    )
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description=(
            "The unique identifier for the UI surface this data model update"
            " applies to."
        ),
    )
    path: str | None = Field(
        default=None,
        description=(
            "An optional path to a location within the data model (e.g., '/user/name')."
            " If omitted, or set to '/', the entire data model will be replaced."
        ),
    )
    contents: list[DataModelUpdateContentsItem] = Field(
        ...,
        description=(
            "An array of data entries. Each entry must contain a 'key' and exactly one"
            " corresponding typed 'value*' property."
        ),
    )


class DataModelUpdateMessage(StrictBaseModel):
    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION
    data_model_update: DataModelUpdate = Field(..., alias="dataModelUpdate")


class DeleteSurface(StrictBaseModel):
    """Signals the client to delete the surface identified by 'surfaceId'."""

    model_config = ConfigDict(populate_by_name=True)
    surface_id: str = Field(
        ...,
        alias="surfaceId",
        description="The unique identifier for the UI surface to be deleted.",
    )


class DeleteSurfaceMessage(StrictBaseModel):
    version: PROTOCOL_VERSION_TYPE = PROTOCOL_VERSION
    delete_surface: DeleteSurface = Field(..., alias="deleteSurface")


CreateSurface = BeginRendering
CreateSurfaceMessage = BeginRenderingMessage
UpdateComponents = SurfaceUpdate
UpdateComponentsMessage = SurfaceUpdateMessage
UpdateDataModel = DataModelUpdate
UpdateDataModelMessage = DataModelUpdateMessage


ServerToClientMessage = (
    BeginRenderingMessage
    | SurfaceUpdateMessage
    | DataModelUpdateMessage
    | DeleteSurfaceMessage
)


AgentToRendererMessage = ServerToClientMessage
A2uiMessage = ServerToClientMessage


class A2uiMessageListWrapper(StrictBaseModel):
    messages: list[ServerToClientMessage] = Field(
        ..., description="A list of messages."
    )


AGENT_TO_RENDERER_DEFS: Final[dict[str, Any]] = {
    "beginRendering": BeginRendering,
    "surfaceUpdate": SurfaceUpdate,
    "dataModelUpdate": DataModelUpdate,
    "deleteSurface": DeleteSurface,
}
