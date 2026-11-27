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

from typing import TYPE_CHECKING, Any, Type

from pydantic import BaseModel, TypeAdapter
from pydantic_core import PydanticUndefined

if TYPE_CHECKING:
    from .model import ComponentDefinition


class ComponentApi:
    """The framework-agnostic definition of a UI component's API (schema-only)."""

    def __init__(
        self,
        name: str,
        schema: dict[str, Any] | None = None,
        allowed_parents: list[str] | None = None,
        allowed_children: list[str] | None = None,
        from_document: bool = False,
        metadata: dict[str, Any] | None = None,
        *,
        definition: ComponentDefinition | None = None,
    ):
        """Initializes the component API.

        Args:
            name: The component's name, which instances use as `component`.
            schema: The component's JSON schema, as its catalog document
                writes it. Optional when `definition` is provided; synthesized
                lazily on access when omitted.
            allowed_parents: The components this component may be a child of.
            allowed_children: The components this component may contain.
            from_document: Whether `schema` was loaded from a catalog
                document, which `Catalog.from_json` sets on every component
                it loads.
            metadata: Optional static component-level metadata envelope.
            definition: Canonical schema-library-independent component
                definition. When provided, `allowed_parents`,
                `allowed_children`, and `metadata` default from it.
        """
        self.name = name
        self._schema: dict[str, Any] | None = schema
        self._definition: ComponentDefinition | None = definition
        self._explicit_definition: bool = definition is not None
        if definition is not None:
            if allowed_parents is None and definition.allowed_parents is not None:
                allowed_parents = list(definition.allowed_parents)
            if allowed_children is None and definition.allowed_children is not None:
                allowed_children = list(definition.allowed_children)
            if metadata is None and definition.metadata is not None:
                metadata = dict(definition.metadata)
        self.allowed_parents = allowed_parents
        self.allowed_children = allowed_children
        self.from_document = from_document
        self.metadata = metadata

    @classmethod
    def from_definition(cls, definition: ComponentDefinition) -> ComponentApi:
        """Creates a `ComponentApi` purely from a canonical `ComponentDefinition`."""
        return cls(name=definition.name, definition=definition)

    @property
    def schema(self) -> dict[str, Any]:
        """The component's JSON Schema dict (synthesized lazily if defined via `definition`)."""
        if self._schema is None:
            if self._definition is not None:
                from .json_schema_adapter import component_definition_to_json_schema

                self._schema = component_definition_to_json_schema(self._definition)
            else:
                self._schema = {}
        return self._schema

    @schema.setter
    def schema(self, value: dict[str, Any]) -> None:
        self._schema = value
        if not self._explicit_definition:
            self._definition = None

    @property
    def definition(self) -> ComponentDefinition:
        """Returns the canonical `ComponentDefinition` for this component."""
        if self._definition is None:
            from .json_schema_adapter import component_definition_from_json_schema

            self._definition = component_definition_from_json_schema(
                self.name,
                self._schema if isinstance(self._schema, dict) else {},
                allowed_parents=self.allowed_parents,
                allowed_children=self.allowed_children,
                metadata=self.metadata,
            )
        return self._definition

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
        metadata: dict[str, Any] | None = None,
    ):
        super().__init__(
            name=name,
            schema=schema,
            allowed_parents=allowed_parents,
            allowed_children=allowed_children,
            metadata=metadata,
        )
        self.model_class = model_class
        self._type_adapter: TypeAdapter[Any] | None = None

    @property
    def type_adapter(self) -> TypeAdapter[Any]:
        if self._type_adapter is None:
            self._type_adapter = TypeAdapter(self.model_class)
        return self._type_adapter

    @property
    def definition(self) -> ComponentDefinition:
        if self._definition is None:
            from .pydantic_adapter import component_definition_from_model

            self._definition = component_definition_from_model(
                self.model_class,
                name=self.name,
                allowed_parents=self.allowed_parents,
                allowed_children=self.allowed_children,
                metadata=self.metadata,
            )
        return self._definition


class ModelComponentApi(ComponentImplementation):
    """Surgically wraps a Pydantic BaseModel as a ComponentImplementation."""

    def __init__(
        self,
        model_class: Type[BaseModel],
        name: str | None = None,
        allowed_parents: list[str] | None = None,
        allowed_children: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
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
            metadata=metadata,
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
