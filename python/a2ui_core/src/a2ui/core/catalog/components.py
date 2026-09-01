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

from typing import Any, Type
from pydantic import BaseModel, TypeAdapter
from pydantic_core import PydanticUndefined


class ComponentApi:
    """The framework-agnostic definition of a UI component's API (schema-only)."""

    def __init__(
        self,
        name: str,
        schema: dict[str, Any],
        allowed_parents: list[str] | None = None,
        allowed_children: list[str] | None = None,
    ):
        self.name = name
        self.schema = schema
        self.allowed_parents = allowed_parents
        self.allowed_children = allowed_children

    @property
    def comp_type(self) -> str:
        return self.name


class ComponentImplementation(ComponentApi):
    """Extends ComponentApi to couple schema metadata with concrete Python classes."""

    def __init__(
        self,
        name: str,
        schema: dict[str, Any],
        model_class: Type[BaseModel],
        allowed_parents: list[str] | None = None,
        allowed_children: list[str] | None = None,
    ):
        super().__init__(
            name=name,
            schema=schema,
            allowed_parents=allowed_parents,
            allowed_children=allowed_children,
        )
        self.model_class = model_class
        self._type_adapter: TypeAdapter[Any] | None = None

    @property
    def type_adapter(self) -> TypeAdapter[Any]:
        if self._type_adapter is None:
            self._type_adapter = TypeAdapter(self.model_class)
        return self._type_adapter


class ModelComponentApi(ComponentImplementation):
    """Surgically wraps a Pydantic BaseModel as a ComponentImplementation."""

    def __init__(
        self,
        model_class: Type[BaseModel],
        name: str | None = None,
        allowed_parents: list[str] | None = None,
        allowed_children: list[str] | None = None,
    ):
        if not (isinstance(model_class, type) and issubclass(model_class, BaseModel)):
            raise ValueError(f"Expected a Pydantic BaseModel class, got {model_class}")

        extracted_name = name or self._extract_name(model_class)
        schema = (
            model_class.model_json_schema()
            if hasattr(model_class, "model_json_schema")
            else {}
        )
        super().__init__(
            name=extracted_name,
            schema=schema,
            model_class=model_class,
            allowed_parents=allowed_parents,
            allowed_children=allowed_children,
        )

    @staticmethod
    def _extract_name(model_class: Type[BaseModel]) -> str:
        if (
            hasattr(model_class, "model_fields")
            and "component" in model_class.model_fields
        ):
            field = model_class.model_fields["component"]
            if (
                hasattr(field, "default")
                and field.default is not None
                and field.default is not PydanticUndefined
            ):
                return str(field.default)
        name = model_class.__name__
        return name[:-9] if name.endswith("Component") else name
