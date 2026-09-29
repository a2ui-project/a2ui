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
from typing import Any
from pydantic import BaseModel, Field, ConfigDict
from .common_types import StrictBaseModel
from .constants import PROTOCOL_VERSION, PROTOCOL_VERSION_TYPE


class V09ServerCapabilities(StrictBaseModel):
    supported_catalog_ids: list[str] | None = Field(
        None,
        alias="supportedCatalogIds",
        description=(
            "An array of strings, where each string is an ID identifying a Catalog"
            " Definition Schema that the server can generate. This is not necessarily a"
            " resolvable URI."
        ),
    )
    accepts_inline_catalogs: bool | None = Field(
        alias="acceptsInlineCatalogs",
        description=(
            "A boolean indicating if the server can accept an 'inlineCatalogs' array in"
            " the client's a2uiClientCapabilities. If omitted, this defaults to false."
        ),
        default=False,
    )


V0_9ServerCapabilities = V09ServerCapabilities


V09AgentCapabilities = V09ServerCapabilities


V0_9AgentCapabilities = V09ServerCapabilities


class A2uiServerCapabilities(StrictBaseModel):
    v0_9: V09ServerCapabilities | None = Field(None, alias=PROTOCOL_VERSION)


A2uiAgentCapabilities = A2uiServerCapabilities
