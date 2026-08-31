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
from .common_types import StrictBaseModel, Extensions
from .constants import PROTOCOL_VERSION, PROTOCOL_VERSION_TYPE


class FunctionDefinition(BaseModel):
    """Describes a function's validation schema and interface metadata."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)
    return_type: Literal[
        "string",
        "number",
        "boolean",
        "array",
        "object",
        "validationResult",
        "any",
        "void",
    ] = Field(
        ..., alias="returnType", description="The type of value this function returns."
    )
    allowed_callers: Literal["rendererOnly", "agentOnly", "rendererOrAgent"] | None = (
        Field(
            alias="allowedCallers",
            description="Specifies which roles are authorized to invoke this function.",
            default="rendererOnly",
        )
    )
    requires_user_activation: bool | None = Field(
        alias="requiresUserActivation",
        description=(
            "Specifies whether this function requires a user activation context to"
            " execute."
        ),
        default=False,
    )

    @model_validator(mode="after")
    def _validate_user_activation(self) -> FunctionDefinition:
        if self.requires_user_activation and self.allowed_callers != "rendererOnly":
            raise ValueError(
                "Functions with requiresUserActivation=True can only have"
                " allowedCallers equal to 'rendererOnly'."
            )
        return self


class ComponentDefinition(BaseModel):
    """Describes a component's validation schema and composition constraints."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)
    allowed_parents: list[str] | None = Field(
        None,
        alias="allowedParents",
        description=(
            "The list of parent component type names that can contain this component"
            " type. If omitted, all parent component types are allowed. To restrict a"
            " component so it can appear only as the top-level component (id='root')"
            ' of a surface, set "allowedParents": ["Surface"]. To allow a component as'
            " either the top-level component of a surface or a child of a specific"
            ' container, specify both (e.g., "allowedParents": ["Surface",'
            ' "CanvasContainer"]).'
        ),
    )
    allowed_children: list[str] | None = Field(
        None,
        alias="allowedChildren",
        description=(
            "The list of child component type names allowed inside this container or"
            " slot. If omitted, all child component types are allowed."
        ),
    )
    metadata: Extensions | None = Field(None, description="Optional static metadata.")


class ValidationResult(StrictBaseModel):
    """Dynamic validation result object returned by a validation condition function or data binding."""

    model_config = ConfigDict(populate_by_name=True)
    valid: bool = Field(..., description="Whether the check passed.")
    code: str | None = Field(
        None,
        description="Machine-readable error code (e.g. EXPIRED_CARD, OUT_OF_RANGE).",
    )
    message: str | None = Field(
        None, description="Human-readable error or warning message."
    )
    severity: Literal["error", "warning", "info"] | None = Field(
        description="Severity level of the validation result.", default="error"
    )


class CatalogDefs(BaseModel):
    """Standardized schema definitions referenced from outside the catalog file."""

    model_config = ConfigDict(populate_by_name=True)
    any_component: Any = Field(
        ...,
        alias="anyComponent",
        description="Unified validation schema for all components.",
    )
    any_function: Any = Field(
        ...,
        alias="anyFunction",
        description="Unified validation schema for all functions.",
    )


class CatalogDefinition(StrictBaseModel):
    """A collection of component and function definitions."""

    model_config = ConfigDict(populate_by_name=True)
    schema_uri: str | None = Field(None, alias="$schema")
    schema_id: str | None = Field(None, alias="$id")
    protocol_version: str | None = Field(
        alias="protocolVersion",
        description=(
            "The A2UI specification version of this catalog definition (e.g. '1.0')."
            " Defaults to '0.9' if omitted."
        ),
        pattern=r"^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:\\.(0|[1-9][0-9]*))?(?:-((?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$",
        default="0.9",
    )
    defs: CatalogDefs | None = Field(None, alias="$defs")
    title: str | None = Field(None, description="The title of the catalog.")
    description: str | None = Field(
        None, description="A human-readable description of the catalog."
    )
    catalog_id: str = Field(
        ..., alias="catalogId", description="Unique identifier for this catalog."
    )
    instructions: str | None = Field(
        None,
        description=(
            "Markdown-formatted design guidelines or instructions specific to this"
            " catalog."
        ),
    )
    components: dict[str, ComponentDefinition] | None = Field(
        None, description="Definitions for UI components supported by this catalog."
    )
    functions: dict[str, FunctionDefinition] | None = Field(
        None, description="Definitions for functions supported by this catalog."
    )
