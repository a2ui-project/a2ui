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

from typing import Any, Callable, Dict, Generic, List, Optional, Type, TypeVar, Union
from pydantic import BaseModel

from .functions import (
    FunctionApi,
    FunctionImplementation,
    create_function_implementation,
)
from .components import ComponentApi, ComponentImplementation, ModelComponentApi


TComponent = TypeVar("TComponent", bound=ComponentApi)
TFunction = TypeVar("TFunction", bound=FunctionApi)


class Catalog(Generic[TComponent, TFunction]):
    """A unified collection of available components and functions."""

    def __init__(
        self,
        catalog_id: str,
        spec_version: str,
        components: List[TComponent],
        functions: List[TFunction],
        theme_schema: Optional[Dict[str, Any]] = None,
        theme_class: Optional[Type[BaseModel]] = None,
    ):
        self.catalog_id = catalog_id
        self.spec_version = spec_version

        # Symmetrical map to Catalog.components in TypeScript
        self.components: Dict[str, TComponent] = {c.name: c for c in components}

        # Symmetrical map to Catalog.functions in TypeScript
        self.functions: Dict[str, TFunction] = {fn.name: fn for fn in functions}

        self.theme_schema = theme_schema
        self.theme_class = theme_class
        self._catalog_schema: Optional[Dict[str, Any]] = None
        self._common_types_schema: Optional[Dict[str, Any]] = None

    @property
    def theme(self) -> Optional[Any]:
        return self.theme_class or self.theme_schema

    @property
    def common_types_schema(self) -> Optional[Dict[str, Any]]:
        return self._common_types_schema

    @property
    def catalog_schema(self) -> Dict[str, Any]:
        return self._catalog_schema

    def get_component(self, name: str) -> Optional[TComponent]:
        """Directly retrieves a component by name."""
        return self.components.get(name)

    def get_function(self, name: str) -> Optional[TFunction]:
        """Directly retrieves a function by name."""
        if not name:
            return None
        return (
            self.functions.get(name)
            or self.functions.get(name[0].lower() + name[1:])
            or self.functions.get(name[0].upper() + name[1:])
        )

    def get_theme_schema(self) -> Optional[Dict[str, Any]]:
        if isinstance(self.theme_schema, dict):
            return self.theme_schema
        if self.theme_class and hasattr(self.theme_class, "model_json_schema"):
            return self.theme_class.model_json_schema()
        if hasattr(self.theme, "model_json_schema"):
            return self.theme.model_json_schema()
        return None

    @classmethod
    def from_json(
        cls,
        catalog_schema: Dict[str, Any],
        spec_version: str,
        catalog_id: Optional[str] = None,
        common_types_schema: Optional[Dict[str, Any]] = None,
    ) -> "Catalog[ComponentApi, FunctionApi]":
        """Constructs a schema-only Catalog directly from raw JSON Schema."""
        catalog_id = catalog_id or catalog_schema.get("catalogId")
        if not catalog_id:
            raise ValueError("catalog_id must be provided or exist in catalog_schema.")

        components_map = catalog_schema.get("components", {})
        any_comp_refs = (
            catalog_schema.get("$defs", {}).get("anyComponent", {}).get("oneOf", [])
        )
        permitted_names = set()
        for item in any_comp_refs:
            if isinstance(item, dict):
                ref = item.get("$ref", "")
                if isinstance(ref, str) and ref.startswith("#/components/"):
                    permitted_names.add(ref.split("/")[-1])
        if permitted_names:
            components = [
                ComponentApi(name, schema)
                for name, schema in components_map.items()
                if name in permitted_names
            ]
        else:
            components = [
                ComponentApi(name, schema) for name, schema in components_map.items()
            ]

        functions = []
        raw_functions = catalog_schema.get("functions", {})
        any_func_refs = (
            catalog_schema.get("$defs", {}).get("anyFunction", {}).get("oneOf", [])
        )
        permitted_func_names = set()
        for item in any_func_refs:
            ref = item.get("$ref", "")
            if ref.startswith("#/functions/"):
                permitted_func_names.add(ref.split("/")[-1])

        if isinstance(raw_functions, dict):
            for name, spec in raw_functions.items():
                if not permitted_func_names or name in permitted_func_names:
                    return_type = (
                        spec.get("returnType", "any")
                        if isinstance(spec, dict)
                        else "any"
                    )
                    functions.append(
                        FunctionApi(
                            name,
                            return_type,
                            spec,
                        )
                    )

        cat = cls(
            catalog_id=catalog_id,
            spec_version=spec_version,
            components=components,
            functions=functions,
            theme_schema=catalog_schema.get("theme"),
        )
        cat._catalog_schema = catalog_schema
        cat._common_types_schema = common_types_schema
        return cat
