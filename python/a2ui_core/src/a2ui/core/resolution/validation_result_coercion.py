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

"""Reads a v1.0 ``ValidationResult`` by its validity where a schema asks for a ``DynamicBoolean``.

From v1.0 the validation functions return a ``ValidationResult`` rather than
a boolean, and the specification defines ``DynamicBoolean`` as a boolean, a
binding, or a call returning a boolean or a validation result object,
coerced to its ``valid`` boolean. A resolved function argument that is such
an object is therefore coerced wherever the function's argument schema
types it as a ``DynamicBoolean``, and left alone everywhere else: a dict is
always truthy in Python, so an uncoerced ``{"valid": False}`` would read as
true.
"""

from __future__ import annotations

import types
import typing
from typing import Any

from pydantic import BaseModel

from ..schema.v1_0 import DynamicBoolean

_DYNAMIC_BOOLEAN_DEF = "DynamicBoolean"


def validity_of(value: Any) -> bool | None:
    """Returns the validity a ``ValidationResult`` object carries, or None.

    Args:
        value: Any resolved value.

    Returns:
        The ``valid`` member when ``value`` is a dict whose ``valid`` member
        is a boolean, otherwise None.
    """
    if isinstance(value, dict):
        valid = value.get("valid")
        if isinstance(valid, bool):
            return valid
    return None


def _without_none(annotation: Any) -> list[Any]:
    """Returns the members of a union annotation other than None, unwrapping ``Annotated``."""
    origin = typing.get_origin(annotation)
    if origin is typing.Annotated:
        return _without_none(typing.get_args(annotation)[0])
    if origin in (typing.Union, types.UnionType):
        members: list[Any] = []
        for member in typing.get_args(annotation):
            if member is type(None):
                continue
            members.extend(_without_none(member))
        return members
    return [annotation]


# The members of `DynamicBoolean` with their `Annotated` strictness markers
# removed, as `_without_none` reads a field annotation.
_DYNAMIC_BOOLEAN_MEMBERS: tuple[Any, ...] = tuple(_without_none(DynamicBoolean))


def is_dynamic_boolean_annotation(annotation: Any) -> bool:
    """Whether a model field annotation is the common ``DynamicBoolean`` type.

    ``DynamicBoolean`` is a union alias, so it is recognized by its members:
    an annotation whose non-None members are exactly those of
    ``DynamicBoolean``, under any ``Annotated`` or ``Optional`` wrapping.

    Args:
        annotation: A model field's annotation.
    """
    members = _without_none(annotation)
    return (
        len(members) == len(_DYNAMIC_BOOLEAN_MEMBERS)
        and all(member in _DYNAMIC_BOOLEAN_MEMBERS for member in members)
        and all(expected in members for expected in _DYNAMIC_BOOLEAN_MEMBERS)
    )


def _list_item_annotation(annotation: Any) -> Any | None:
    """Returns the item annotation of a ``list[...]`` annotation, or None.

    Looks through ``Annotated`` and through the members of an ``Optional``
    or other union, so ``list[DynamicBoolean] | None`` yields
    ``DynamicBoolean``.
    """
    origin = typing.get_origin(annotation)
    if origin is typing.Annotated:
        return _list_item_annotation(typing.get_args(annotation)[0])
    if origin in (typing.Union, types.UnionType):
        for member in typing.get_args(annotation):
            item = _list_item_annotation(member)
            if item is not None:
                return item
        return None
    if origin in (list, typing.List):
        args = typing.get_args(annotation)
        return args[0] if args else None
    return None


def _model_annotation(annotation: Any) -> type[BaseModel] | None:
    """Returns the ``BaseModel`` subclass of an object annotation, or None.

    Looks through ``Annotated`` and through the members of an ``Optional``
    or other union, so ``NestedModel | None`` yields ``NestedModel``.
    """
    origin = typing.get_origin(annotation)
    if origin is typing.Annotated:
        return _model_annotation(typing.get_args(annotation)[0])
    if origin in (typing.Union, types.UnionType):
        for member in typing.get_args(annotation):
            sub_model = _model_annotation(member)
            if sub_model is not None:
                return sub_model
        return None
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return annotation
    return None


def _coerce_for_annotation(annotation: Any, value: Any) -> Any:
    if is_dynamic_boolean_annotation(annotation):
        valid = validity_of(value)
        return value if valid is None else valid
    item_annotation = _list_item_annotation(annotation)
    if item_annotation is not None and isinstance(value, list):
        return [_coerce_for_annotation(item_annotation, item) for item in value]
    sub_model = _model_annotation(annotation)
    if sub_model is not None and isinstance(value, dict):
        return _coerce_for_model(sub_model, value)
    return value


def _coerce_for_model(model: type[BaseModel], args: dict[str, Any]) -> dict[str, Any]:
    by_key: dict[str, Any] = {}
    for name, field in model.model_fields.items():
        by_key[name] = field.annotation
        if field.alias:
            by_key[field.alias] = field.annotation
    return {
        key: _coerce_for_annotation(by_key[key], value) if key in by_key else value
        for key, value in args.items()
    }


def is_dynamic_boolean_schema(schema: Any) -> bool:
    """Whether a JSON schema node references the common ``DynamicBoolean`` type.

    Args:
        schema: A property schema from a catalog document, as the catalog
            keeps it or with its references resolved to local pointers.
    """
    ref = schema.get("$ref") if isinstance(schema, dict) else None
    return isinstance(ref, str) and ref.rsplit("/", 1)[-1] == _DYNAMIC_BOOLEAN_DEF


def _coerce_for_json_schema(schema: Any, value: Any) -> Any:
    if not isinstance(schema, dict):
        return value
    if is_dynamic_boolean_schema(schema):
        valid = validity_of(value)
        return value if valid is None else valid
    items = schema.get("items")
    if isinstance(items, dict) and isinstance(value, list):
        return [_coerce_for_json_schema(items, item) for item in value]
    properties = schema.get("properties")
    if isinstance(properties, dict) and isinstance(value, dict):
        return {
            key: _coerce_for_json_schema(properties.get(key), item)
            for key, item in value.items()
        }
    return value


def _json_schema_properties(schema: dict[str, Any]) -> dict[str, Any] | None:
    """Returns the argument properties of a function's document schema.

    Accepts the published form, an object schema with ``properties``, and
    the v0.9 inline form, a definition with ``parameters``.
    """
    properties = schema.get("properties")
    if isinstance(properties, dict):
        args = properties.get("args")
        if isinstance(args, dict):
            args_properties = args.get("properties")
            if isinstance(args_properties, dict):
                return args_properties
        return properties
    parameters = schema.get("parameters")
    return parameters if isinstance(parameters, dict) else None


def coerce_validation_results(schema: Any, args: dict[str, Any]) -> dict[str, Any]:
    """Coerces the ``ValidationResult`` arguments that ``schema`` types as ``DynamicBoolean``.

    Follows the schema through the argument properties and list items. Any
    other argument, and any argument the schema does not describe, is
    returned as it is.

    Args:
        schema: The function's argument schema: a Pydantic model class, or a
            JSON schema dict from a catalog document.
        args: The function's resolved arguments.

    Returns:
        The arguments, with every ``ValidationResult`` in a ``DynamicBoolean``
        position replaced by its ``valid`` boolean.
    """
    if isinstance(schema, type) and issubclass(schema, BaseModel):
        return _coerce_for_model(schema, args)
    if isinstance(schema, dict):
        properties = _json_schema_properties(schema)
        if properties is not None:
            return {
                key: _coerce_for_json_schema(properties.get(key), value)
                for key, value in args.items()
            }
    return args
