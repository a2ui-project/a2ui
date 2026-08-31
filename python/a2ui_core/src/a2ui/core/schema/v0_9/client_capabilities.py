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
from .common_types import StrictBaseModel
from .constants import PROTOCOL_VERSION, PROTOCOL_VERSION_TYPE


class FunctionDefinition(StrictBaseModel):
    """Describes a function's interface."""

    model_config = ConfigDict(populate_by_name=True)
    name: str = Field(..., description="The unique name of the function.")
    description: str | None = Field(
        None,
        description=(
            "A human-readable description of what the function does and how to use it."
        ),
    )
    parameters: Any = Field(
        ...,
        description=(
            "A JSON Schema describing the expected arguments (args) for this function."
        ),
    )
    return_type: Literal[
        "string", "number", "boolean", "array", "object", "any", "void"
    ] = Field(
        ..., alias="returnType", description="The type of value this function returns."
    )


class InlineCatalog(BaseModel):
    """A collection of component and function definitions."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)
    catalog_id: str = Field(
        ..., alias="catalogId", description="Unique identifier for this catalog."
    )
    components: dict[str, Any] | None = Field(
        None, description="Definitions for UI components supported by this catalog."
    )
    functions: list[FunctionDefinition] | None = Field(
        None, description="Definitions for functions supported by this catalog."
    )
    theme: dict[str, Any] | None = Field(
        None,
        description=(
            "A schema that defines a catalog of A2UI theme properties. Each key is a"
            " theme property name (e.g. 'primaryColor'), and each value is the JSON"
            " schema for that property."
        ),
    )


Catalog = InlineCatalog


class V09Capabilities(StrictBaseModel):
    supported_catalog_ids: list[str] = Field(
        ...,
        alias="supportedCatalogIds",
        description=(
            "An array of string identifiers for each of the component and function"
            " catalogs supported by the client."
        ),
    )
    inline_catalogs: list[Catalog] | None = Field(
        None,
        alias="inlineCatalogs",
        description=(
            "An array of inline catalog definitions, which can contain both components"
            " and functions. This should only be provided if the agent declares"
            " 'acceptsInlineCatalogs: true' in its capabilities."
        ),
    )


V0_9Capabilities = V09Capabilities


class A2uiClientCapabilities(StrictBaseModel):
    v0_9: V09Capabilities | None = Field(None, alias=PROTOCOL_VERSION)


A2uiRendererCapabilities = A2uiClientCapabilities
