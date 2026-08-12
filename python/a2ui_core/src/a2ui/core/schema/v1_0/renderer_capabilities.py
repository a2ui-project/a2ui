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

"""Pydantic v2 models for Renderer Capabilities in v1.0."""

from typing import Any, Dict, List, Literal, Optional
from pydantic import Field
from .common_types import StrictBaseModel
from .constants import VERSION_1_0


class V10RendererCapabilities(StrictBaseModel):
    """Capabilities structure for version 1.0 of the A2UI protocol."""

    supported_catalog_ids: List[str] = Field(
        ...,
        alias="supportedCatalogIds",
        description="Array of supported catalog identifiers.",
    )
    inline_catalogs: Optional[List[Dict[str, Any]]] = Field(
        None,
        alias="inlineCatalogs",
        description="Array of inline catalog definitions.",
    )


class RendererCapabilities(StrictBaseModel):
    """Renderer capabilities metadata container for v1.0 protocol."""

    v1_0: V10RendererCapabilities = Field(
        ...,
        alias="v1.0",
        description="Version 1.0 capabilities definition.",
    )


class RendererCapabilitiesMessage(StrictBaseModel):
    """Envelope wrapping a renderer capabilities metadata payload."""

    version: Literal["v1.0"] = Field(
        VERSION_1_0, description="Protocol specification version."
    )
    renderer_capabilities: RendererCapabilities = Field(
        ...,
        alias="rendererCapabilities",
        description="Renderer capabilities payload.",
    )
