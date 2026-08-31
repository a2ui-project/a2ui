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
from pydantic import BaseModel, Field, ConfigDict, model_validator
from ..common_types import StrictBaseModel
from .constants import PROTOCOL_VERSION, PROTOCOL_VERSION_TYPE


class CatalogDefinition(StrictBaseModel):
    """A schema for a custom Catalog Description including A2UI components and styles."""

    model_config = ConfigDict(populate_by_name=True)
    catalog_id: str = Field(
        ...,
        alias="catalogId",
        description=(
            "A string that uniquely identifies this catalog. It is recommended to"
            " prefix this with an internet domain that you own, to avoid conflicts e.g."
            " mycompany.com:somecatalog'."
        ),
    )
    components: dict[str, Any] = Field(
        ...,
        description=(
            "A schema that defines a catalog of A2UI components. Each key is a"
            " component name, and each value is the JSON schema for that component's"
            " properties."
        ),
    )
    styles: dict[str, Any] = Field(
        ...,
        description=(
            "A schema that defines a catalog of A2UI styles. Each key is a style name,"
            " and each value is the JSON schema for that style's properties."
        ),
    )
