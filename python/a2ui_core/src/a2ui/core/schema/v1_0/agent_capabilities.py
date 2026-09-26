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


class V10AgentCapabilities(StrictBaseModel):
    supported_catalog_ids: list[str] | None = Field(
        None,
        alias="supportedCatalogIds",
        description=(
            "An array of strings, where each is an ID identifying a Catalog for which"
            " the agent can generate content. This is not a resolvable URI. Multiple"
            " catalogs can be mixed in a single surface."
        ),
    )
    accepts_inline_catalogs: bool | None = Field(
        alias="acceptsInlineCatalogs",
        description=(
            "A boolean indicating if the agent can accept an 'inlineCatalogs' array in"
            " the renderer's a2uiRendererCapabilities. If omitted, this defaults to"
            " false."
        ),
        default=False,
    )


V1_0AgentCapabilities = V10AgentCapabilities


class A2uiAgentCapabilities(StrictBaseModel):
    v1_0: V10AgentCapabilities | None = Field(None, alias=PROTOCOL_VERSION)
