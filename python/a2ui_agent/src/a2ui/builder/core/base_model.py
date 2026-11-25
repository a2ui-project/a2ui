# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Strict Pydantic configuration shared by all builder models."""

from __future__ import annotations

from typing import Any, cast

from pydantic import (
    BaseModel,
    ConfigDict,
    GetCoreSchemaHandler,
    SerializationInfo,
    SerializerFunctionWrapHandler,
)
from pydantic_core import core_schema


class BuilderBaseModel(BaseModel):
    """Base model configuring strict validation for builder components and nested items."""

    model_config = ConfigDict(
        extra="forbid",
        arbitrary_types_allowed=False,
        validate_by_name=True,
    )

    @classmethod
    def __get_pydantic_core_schema__(
        cls, source: type[BaseModel], handler: GetCoreSchemaHandler, /
    ) -> core_schema.CoreSchema:
        schema = handler(source)
        model_schema: core_schema.CoreSchema = schema
        while model_schema["type"] in (
            "function-before",
            "function-after",
            "function-wrap",
        ):
            model_schema = model_schema["schema"]
        if (
            model_schema["type"] == "model"
            and not model_schema.get("root_model", False)
            and "serialization" not in model_schema
        ):
            # Bind to the declared schema, not the runtime type of a nested value.
            model = cast(core_schema.ModelSchema, model_schema)
            model["serialization"] = core_schema.wrap_serializer_function_ser_schema(
                cls._serialize_for_flatten, info_arg=True
            )
        return schema

    @classmethod
    def _serialize_for_flatten(
        cls,
        value: BuilderBaseModel,
        handler: SerializerFunctionWrapHandler,
        info: SerializationInfo,
    ) -> dict[str, Any]:
        from .child import flatten_context_of

        payload: dict[str, Any] = handler(value)
        if not info.exclude_none or flatten_context_of(info) is None:
            return payload

        # exclude_none omits required nullable fields too. Restore only those
        # fields during flattening; optional None values remain omitted.
        for name, field in cls.model_fields.items():
            if (
                not field.is_required()
                or field.exclude
                or getattr(value, name) is not None
            ):
                continue
            if info.include is not None and name not in info.include:
                continue
            if info.exclude is not None and name in info.exclude:
                if isinstance(info.exclude, set):
                    continue
                excluded: Any = info.exclude[name]
                if excluded is True or excluded is ...:
                    continue
            exclude_if = getattr(field, "exclude_if", None)
            if exclude_if is not None and exclude_if(None):
                continue
            if info.exclude_unset and name not in value.model_fields_set:
                continue
            key = field.serialization_alias if info.by_alias else name
            payload[name if key is None else key] = None
        return payload
