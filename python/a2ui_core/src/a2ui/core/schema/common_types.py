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

from __future__ import annotations
import sys
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, ConfigDict, Field, GetCoreSchemaHandler, ValidationInfo, field_validator
from pydantic_core import CoreSchema, PydanticUndefined


class ComponentReference:
    """Base marker class for all A2UI component references."""


class SingleReference(str, ComponentReference):

    @classmethod
    def __get_pydantic_core_schema__(
        cls, source_type: Any, handler: GetCoreSchemaHandler
    ) -> CoreSchema:
        from pydantic_core import core_schema

        return core_schema.no_info_after_validator_function(
            cls,
            core_schema.str_schema(ref="ComponentId"),
            serialization=core_schema.plain_serializer_function_ser_schema(str),
        )


class ListReference(ComponentReference):
    """Marker class indicating a field holds a list of component references."""


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("version", mode="after", check_fields=False)
    @classmethod
    def validate_version_field(cls, v: Any, info: ValidationInfo) -> Any:
        context = info.context if isinstance(info.context, dict) else {}
        target_version = context.get("target_version") or context.get(
            "protocol_version"
        )
        if target_version is None:
            if "version" in cls.model_fields:
                default_val = cls.model_fields["version"].default
                if (
                    default_val is not None
                    and default_val != PydanticUndefined
                    and isinstance(default_val, str)
                ):
                    target_version = default_val
            if target_version is None and cls.__module__:
                mod = sys.modules.get(cls.__module__)
                if mod:
                    target_version = getattr(mod, "PROTOCOL_VERSION", None)
        if target_version is not None:
            mod = sys.modules.get(cls.__module__) if cls.__module__ else None
            valid_versions = None
            if mod:
                valid_versions = getattr(mod, "SUPPORTED_PROTOCOL_VERSIONS", None)
                if (
                    valid_versions is None
                    and hasattr(mod, "__package__")
                    and mod.__package__
                ):
                    try:
                        constants_mod = sys.modules.get(f"{mod.__package__}.constants")
                        if constants_mod:
                            valid_versions = getattr(
                                constants_mod, "SUPPORTED_PROTOCOL_VERSIONS", None
                            )
                    except Exception:
                        pass
            if valid_versions is None:
                valid_versions = (
                    {target_version}
                    if isinstance(target_version, str)
                    else set(target_version)
                )
            if v not in valid_versions:
                raise ValueError(f"Input should be '{target_version}'")
        return v


ComponentId = SingleReference
Child = SingleReference


class ComponentCommon(StrictBaseModel):
    id: ComponentId = Field(...)


class DataBinding(StrictBaseModel):
    path: str = Field(
        ..., description="A JSON Pointer path to a value in the data model."
    )


class FunctionCall(StrictBaseModel):
    """Invokes a named function."""

    call: str = Field(..., description="The name of the function to call.")
    args: Optional[Dict[str, Any]] = Field(
        None, description="Arguments passed to the function."
    )
    catalog_id: Optional[str] = Field(
        None,
        alias="catalogId",
        description=(
            "The catalog ID for this function, overriding any surface-level default"
            " catalogId."
        ),
    )


DynamicString = Union[str, DataBinding, FunctionCall]
DynamicNumber = Union[float, int, DataBinding, FunctionCall]
DynamicBoolean = Union[bool, DataBinding, FunctionCall]
DynamicStringList = Union[List[str], DataBinding, FunctionCall]


class TemplateChildList(StrictBaseModel, ListReference):
    """A template for generating a dynamic list of children from a data model list.

    The `componentId` is the component to use as a template.
    """

    component_id: ComponentId = Field(..., alias="componentId")
    path: str = Field(
        ...,
        description=(
            "The path to the list of component property objects in the data model."
        ),
    )


ChildList = Union[List[ComponentId], TemplateChildList]
