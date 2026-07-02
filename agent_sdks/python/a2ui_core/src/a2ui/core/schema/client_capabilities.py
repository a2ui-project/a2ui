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
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field, ConfigDict
from .common_types import StrictBaseModel
from .constants import SPEC_VERSION, SPEC_VERSION_TYPE


class FunctionDefinition(StrictBaseModel):
    name: str = Field(..., description="The unique name of the function.")
    description: Optional[str] = Field(
        None,
        description="A human-readable description of what the function does and how to use it.",
    )
    parameters: Any = Field(
        ...,
        description="A JSON Schema describing the expected arguments (args) for this function.",
    )
    return_type: Literal[
        "string", "number", "boolean", "array", "object", "any", "void"
    ] = Field(
        ..., alias="returnType", description="The type of value this function returns."
    )


class InlineCatalog(StrictBaseModel):
    catalog_id: str = Field(
        ..., alias="catalogId", description="Unique identifier for this catalog."
    )
    components: Optional[Dict[str, Any]] = Field(
        None, description="Definitions for UI components supported by this catalog."
    )
    functions: Optional[List[FunctionDefinition]] = Field(
        None, description="Definitions for functions supported by this catalog."
    )
    theme: Optional[Dict[str, Any]] = Field(
        None,
        description="A schema that defines a catalog of A2UI theme properties. Each key is a theme property name (e.g. 'primaryColor'), and each value is the JSON schema for that property.",
    )


class V09Capabilities(StrictBaseModel):
    supported_catalog_ids: List[str] = Field(
        ...,
        alias="supportedCatalogIds",
        description="The URI of each of the component and function catalogs that is supported by the client.",
    )
    inline_catalogs: Optional[List[InlineCatalog]] = Field(
        None,
        alias="inlineCatalogs",
        description="An array of inline catalog definitions, which can contain both components and functions. This should only be provided if the agent declares 'acceptsInlineCatalogs: true' in its capabilities.",
    )


class A2uiClientCapabilities(StrictBaseModel):
    v0_9: Optional[V09Capabilities] = Field(None, alias=SPEC_VERSION)
