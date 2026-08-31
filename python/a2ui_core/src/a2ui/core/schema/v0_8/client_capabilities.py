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
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field, ConfigDict
from ..common_types import StrictBaseModel
from .constants import PROTOCOL_VERSION, PROTOCOL_VERSION_TYPE


from .catalog_definition import CatalogDefinition

InlineCatalog = CatalogDefinition
Catalog = InlineCatalog


class V08Capabilities(StrictBaseModel):
    supported_catalog_ids: list[str] = Field(
        ...,
        alias="supportedCatalogIds",
        description=(
            "The URI of each of the catalogs that is supported by the client. The"
            " standard catalog for v0.8 is"
            " 'https://a2ui.org/specification/v0_8/standard_catalog_definition.json'."
        ),
    )
    inline_catalogs: list[CatalogDefinition] | None = Field(
        None,
        alias="inlineCatalogs",
        description=(
            "An array of inline catalog definitions. This should only be provided if"
            " the agent declares 'acceptsInlineCatalogs: true' in its capabilities."
        ),
    )


V0_8Capabilities = V08Capabilities


class A2uiClientCapabilities(StrictBaseModel):
    v0_8: V08Capabilities | None = Field(None, alias=PROTOCOL_VERSION)


A2uiRendererCapabilities = A2uiClientCapabilities
