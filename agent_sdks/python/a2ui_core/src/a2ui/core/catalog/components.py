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

from typing import Any, Dict, Optional, Type, Union
from pydantic import BaseModel
from pydantic_core import PydanticUndefined


class ComponentApi:
    """The framework-agnostic definition of a UI component's API (schema-only)."""

    def __init__(self, name: str, schema: Dict[str, Any]):
        self.name = name
        self.schema = schema

    @property
    def comp_type(self) -> str:
        return self.name


class ComponentImplementation(ComponentApi):
    """Extends ComponentApi to couple schema metadata with concrete Python classes."""

    def __init__(
        self,
        name: str,
        schema: Dict[str, Any],
        model_class: Type[BaseModel],
    ):
        super().__init__(name, schema)
        self.model_class = model_class


class ModelComponentApi(ComponentImplementation):
    """Surgically wraps a Pydantic BaseModel as a ComponentImplementation."""

    def __init__(
        self,
        model_class: Type[BaseModel],
        name: Optional[str] = None,
    ):
        if not (isinstance(model_class, type) and issubclass(model_class, BaseModel)):
            raise ValueError(f"Expected a Pydantic BaseModel class, got {model_class}")

        extracted_name = name or self._extract_name(model_class)
        schema = (
            model_class.model_json_schema()
            if hasattr(model_class, "model_json_schema")
            else {}
        )
        super().__init__(extracted_name, schema, model_class)

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
