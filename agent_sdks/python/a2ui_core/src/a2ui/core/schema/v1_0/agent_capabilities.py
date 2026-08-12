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

"""Pydantic v2 models for Agent Capabilities in v1.0."""

from typing import List, Optional
from pydantic import Field
from .common_types import StrictBaseModel


class V10AgentCapabilities(StrictBaseModel):
    """Agent capabilities structure for version 1.0 of the A2UI protocol."""

    supported_catalog_ids: Optional[List[str]] = Field(
        None,
        alias="supportedCatalogIds",
        description="Array of catalog IDs supported by the agent.",
    )
    accepts_inline_catalogs: Optional[bool] = Field(
        False,
        alias="acceptsInlineCatalogs",
        description="Whether agent accepts inline catalogs from renderer capabilities.",
    )


class AgentCapabilities(StrictBaseModel):
    """Agent capabilities metadata container for v1.0 protocol."""

    v1_0: Optional[V10AgentCapabilities] = Field(
        None,
        alias="v1.0",
        description="Version 1.0 agent capabilities configuration.",
    )
