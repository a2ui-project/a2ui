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
import functools
import sys
import types
import typing
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, ConfigDict, Field, GetCoreSchemaHandler, ValidationInfo, field_validator, model_validator, StrictBool, StrictFloat, StrictInt, StrictStr
from pydantic_core import CoreSchema, PydanticUndefined
from typing_extensions import Self, TypeAliasType

from ._json_schema import _URI_RE, SchemaKeywords


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


def _unwrap_leaf_types(annotation: Any) -> list[Any]:
    """Unwraps Union, UnionType, Annotated, and TypeAliasType into leaf types."""
    if isinstance(annotation, TypeAliasType):
        return _unwrap_leaf_types(annotation.__value__)
    origin = typing.get_origin(annotation)
    if origin is typing.Annotated:
        args = typing.get_args(annotation)
        return _unwrap_leaf_types(args[0]) if args else []
    if origin is Union or origin is types.UnionType:
        leaves: list[Any] = []
        for arg in typing.get_args(annotation):
            leaves.extend(_unwrap_leaf_types(arg))
        return leaves
    return [annotation]


def _is_strict_numeric_field(annotation: Any) -> bool:
    """Returns whether non-None leaf annotations are strictly int or float."""
    non_none = [t for t in _unwrap_leaf_types(annotation) if t is not type(None)]
    return bool(non_none) and all(t is int or t is float for t in non_none)


def _has_uri_format(extra: Any) -> bool:
    """Returns whether `json_schema_extra` declares `format: "uri"`."""
    if isinstance(extra, dict):
        return extra.get("format") == "uri"
    if isinstance(extra, SchemaKeywords):
        return extra.keywords.get("format") == "uri"
    return False


@functools.cache
def _strict_field_checks(
    cls: type[BaseModel],
) -> tuple[frozenset[str], frozenset[str]]:
    """Returns `(numeric_keys, uri_keys)` for `cls` (including aliases)."""
    numeric_keys: set[str] = set()
    uri_keys: set[str] = set()
    for name, field in cls.model_fields.items():
        keys = {name, field.alias or name}
        if isinstance(field.validation_alias, str):
            keys.add(field.validation_alias)
        if _is_strict_numeric_field(field.annotation):
            numeric_keys.update(keys)
        if _has_uri_format(field.json_schema_extra):
            uri_keys.update(keys)
    return frozenset(numeric_keys), frozenset(uri_keys)


class StrictBaseModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @model_validator(mode="before")
    @classmethod
    def _validate_strict_fields(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        numeric_keys, uri_keys = _strict_field_checks(cls)
        for key in numeric_keys.intersection(data):
            if isinstance(data[key], (str, bool)):
                raise ValueError(
                    f"Field '{key}' expected a numeric value, got"
                    f" {type(data[key]).__name__}"
                )
        for key in uri_keys.intersection(data):
            val = data[key]
            if isinstance(val, str) and _URI_RE.match(val) is None:
                raise ValueError(f"Field '{key}' must be a valid URI, got '{val}'")
        return data

    @model_validator(mode="after")
    def _check_required_any_of(self) -> Self:
        keywords = type(self).model_config.get("json_schema_extra")
        branches = (
            keywords.required_any_of() if isinstance(keywords, SchemaKeywords) else None
        )
        if not branches:
            return self
        names = {
            field.alias or name: name for name, field in type(self).model_fields.items()
        }
        matched = any(
            all(
                names.get(prop, prop) in self.model_fields_set
                and getattr(self, names.get(prop, prop), None) is not None
                for prop in branch
            )
            for branch in branches
        )
        if not matched:
            choices = " | ".join(", ".join(branch) for branch in branches)
            raise ValueError(
                f"{type(self).__name__} must set at least one of: {choices}"
            )
        return self

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


@functools.cache
def _null_rejecting_keys(cls: type[BaseModel]) -> tuple[str, ...]:
    """Returns the input keys of `cls` whose fields reject an explicit null.

    These are the optional fields typed `X | None`, where None only stands
    for an absent property, unless `X` accepts null itself (`Any`). Each
    field is listed under its alias and its name.
    """
    keys: list[str] = []
    for name, field in cls.model_fields.items():
        args = typing.get_args(field.annotation)
        if (
            field.is_required()
            or type(None) not in args
            or any(arg is Any for arg in args)
        ):
            continue
        for key in (field.alias or name, name):
            if key not in keys:
                keys.append(key)
    return tuple(keys)


class SpecBaseModel(StrictBaseModel):
    """Base of the models generated from the common types specification.

    It enforces two rules of the specification that field types cannot:
    an optional property must not be null unless its schema allows null, and
    a `oneOf` of required properties declared through `SchemaKeywords` (for
    example `FunctionResponse`'s `value` or `error`) must match exactly once.
    A property counts as present when it is set, even to null, as JSON
    schema's `required` counts it.
    """

    @model_validator(mode="before")
    @classmethod
    def _reject_explicit_nulls(cls, data: Any) -> Any:
        if isinstance(data, dict):
            nulls = [
                key
                for key in _null_rejecting_keys(cls)
                if key in data and data[key] is None
            ]
            if nulls:
                raise ValueError(f"{cls.__name__} fields must not be null: {nulls}")
        return data

    @model_validator(mode="after")
    def _check_required_one_of(self) -> Self:
        keywords = type(self).model_config.get("json_schema_extra")
        branches = (
            keywords.required_one_of() if isinstance(keywords, SchemaKeywords) else None
        )
        if not branches:
            return self
        names = {
            field.alias or name: name for name, field in type(self).model_fields.items()
        }
        matched = sum(
            all(names.get(prop, prop) in self.model_fields_set for prop in branch)
            for branch in branches
        )
        if matched != 1:
            choices = " | ".join(", ".join(branch) for branch in branches)
            raise ValueError(
                f"{type(self).__name__} must set exactly one of: {choices}"
            )
        return self


ComponentId = SingleReference
# A named alias, so a field's JSON schema references `#/$defs/Child` as the
# specification does, instead of `ComponentId`.
Child = TypeAliasType("Child", SingleReference)


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
            "The catalog ID for this function, overriding any surface-level"
            " default catalogId."
        ),
    )


DynamicString = Union[StrictStr, DataBinding, FunctionCall]
DynamicNumber = Union[StrictFloat, StrictInt, DataBinding, FunctionCall]
DynamicBoolean = Union[StrictBool, DataBinding, FunctionCall]
DynamicStringList = Union[List[StrictStr], DataBinding, FunctionCall]


class TemplateChildList(StrictBaseModel, ListReference):
    # Kept on one line: the docstring is the JSON schema description, which must
    # match the specification text.
    """A template for generating a dynamic list of children from a data model list. The `componentId` is the component to use as a template."""

    component_id: ComponentId = Field(..., alias="componentId")
    path: str = Field(
        ...,
        description=(
            "The path to the list of component property objects in the data model."
        ),
    )


# A named alias, so a field's JSON schema references `#/$defs/ChildList` as
# the specification does, instead of inlining the union.
ChildList = TypeAliasType("ChildList", Union[List[ComponentId], TemplateChildList])
