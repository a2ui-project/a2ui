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

from typing import Any, Dict, List, Optional, Set, Tuple


class CatalogApi:
    """Base abstract Catalog API definition representing the schemas of an A2UI Catalog."""

    def __init__(
        self,
        spec_version: str,
        catalog_id: str,
    ):
        if not spec_version:
            raise ValueError("A2UI specification version must be provided.")
        if not catalog_id:
            raise ValueError("catalog_id must be provided.")

        self.spec_version = spec_version
        self.catalog_id = catalog_id

    def get_component_schema(self, comp_type: str) -> Optional[Dict[str, Any]]:
        """Retrieves the JSON Schema representing a component's properties."""
        raise NotImplementedError("Subclasses must implement get_component_schema()")

    def get_function_schema(self, func_name: str) -> Optional[Dict[str, Any]]:
        """Retrieves the JSON Schema representing a function's arguments."""
        raise NotImplementedError("Subclasses must implement get_function_schema()")

    def get_theme_schema(self) -> Optional[Dict[str, Any]]:
        """Retrieves the JSON Schema representing the catalog's theme."""
        raise NotImplementedError("Subclasses must implement get_theme_schema()")

    def extract_ref_fields(self) -> Dict[str, Tuple[Set[str], Set[str]]]:
        """Inspects and retrieves the topological reference pointer map for the active catalog components."""
        raise NotImplementedError("Subclasses must implement extract_ref_fields()")


class CatalogImplementation(CatalogApi):
    """Abstract Catalog subclass that extends CatalogApi with concrete runtime implementations.

    In addition to schemas, a CatalogImplementation provides executable function
    invokers and component model classes, serving client-side rendering and
    local function evaluation.
    """

    def get_component_class(self, comp_type: str) -> Optional[Any]:
        """Retrieves the concrete model class representing a component."""
        raise NotImplementedError("Subclasses must implement get_component_class()")

    def get_function_class(self, func_name: str) -> Optional[Any]:
        """Retrieves the concrete model class representing a function's schema."""
        raise NotImplementedError("Subclasses must implement get_function_class()")

    def get_function_implementation(self, func_name: str) -> Optional[Any]:
        """Retrieves the concrete FunctionImplementation object for a function."""
        raise NotImplementedError(
            "Subclasses must implement get_function_implementation()"
        )

    def invoke_function(
        self,
        name: str,
        args: Dict[str, Any],
        context: Any = None,
        abort_signal: Optional[Any] = None,
    ) -> Any:
        """Executes a catalog function dynamically."""
        raise NotImplementedError("Subclasses must implement invoke_function()")
