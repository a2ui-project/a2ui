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

import sys
from typing import Any, Callable, Dict, Generic, List, Optional, Union, cast

if sys.version_info >= (3, 13):
    from typing import TypeVar
else:
    from typing_extensions import TypeVar
from pydantic import BaseModel

from ..exceptions import A2uiCatalogError
from .functions import (
    AllowedCallers,
    FunctionApi,
    FunctionImplementation,
    FunctionReturnType,
    create_function_implementation,
)
from .components import ComponentApi, ComponentImplementation, ModelComponentApi
from .reference_map import ComponentRefSpec, build_component_ref_map


def is_valid_uax31_identifier(name: str) -> bool:
    """Validates whether a string conforms to UAX #31 / system identifier syntax."""
    if not name:
        return False
    test_name = name[1:] if name.startswith("@") else name
    return test_name.isidentifier()


def _is_version_at_least_1_0(protocol_version: Union[str, Any]) -> bool:
    """Returns True if the protocol version is 1.0 or higher (e.g. v1.0, v1.1, v2.0)."""
    ver_str = str(protocol_version).strip().lstrip("vV").replace("_", ".")
    parts = ver_str.split(".")
    try:
        major = int(parts[0])
        return major >= 1
    except (ValueError, IndexError):
        return False


TComponent = TypeVar("TComponent", bound=ComponentApi, default=Any)
TFunction = TypeVar("TFunction", bound=FunctionApi, default=Any)


class Catalog(Generic[TComponent, TFunction]):
    """A unified collection of available components and functions."""

    def __init__(
        self,
        catalog_id: str,
        protocol_version: Optional[str] = None,
        components: Optional[List[TComponent]] = None,
        functions: Optional[List[TFunction]] = None,
        theme_schema: Dict[str, Any] = {},
        instructions: Optional[str] = None,
    ):
        if not catalog_id:
            raise ValueError("catalog_id must be provided.")
        self.catalog_id = catalog_id
        if not protocol_version:
            raise ValueError("protocol_version must be provided.")
        self.protocol_version = protocol_version
        self.instructions = instructions

        validate_identifiers = _is_version_at_least_1_0(protocol_version)

        self.components: Dict[str, TComponent] = {}
        for c in components or []:
            if validate_identifiers and not is_valid_uax31_identifier(c.name):
                raise A2uiCatalogError(
                    f"Invalid UAX #31 component identifier: '{c.name}'"
                )
            self.components[c.name] = c

        self.functions: Dict[str, TFunction] = {}
        for fn in functions or []:
            if validate_identifiers and not is_valid_uax31_identifier(fn.name):
                raise A2uiCatalogError(
                    f"Invalid UAX #31 function identifier: '{fn.name}'"
                )
            self.functions[fn.name] = fn

        self.theme_schema = theme_schema
        self._catalog_schema: Optional[Dict[str, Any]] = None

    @property
    def id(self) -> str:
        """Symmetrical alias for catalog_id."""
        return self.catalog_id

    @property
    def catalog_schema(self) -> Optional[Dict[str, Any]]:
        """Returns the raw JSON Schema if loaded via from_json(), else None."""
        return self._catalog_schema

    def get_component(self, name: str) -> Optional[TComponent]:
        """Directly retrieves a component by name."""
        return self.components.get(name)

    @property
    def component_ref_map(self) -> Dict[str, ComponentRefSpec]:
        """Returns the pre-analyzed component reference map for all components in this catalog."""
        if not hasattr(self, "_component_ref_map") or self._component_ref_map is None:
            self._component_ref_map = build_component_ref_map(self)
        return self._component_ref_map

    def get_component_ref_spec(self, name: str) -> Optional[ComponentRefSpec]:
        """Directly retrieves the pre-analyzed ComponentRefSpec for a component by name."""
        return self.component_ref_map.get(name)

    def get_function(self, name: str) -> Optional[TFunction]:
        """Directly retrieves a function by name."""
        if not name:
            return None
        return (
            self.functions.get(name)
            or self.functions.get(name[0].lower() + name[1:])
            or self.functions.get(name[0].upper() + name[1:])
        )

    def get_theme_schema(self) -> Dict[str, Any]:
        return self.theme_schema

    @classmethod
    def from_json(
        cls,
        catalog_schema: Dict[str, Any],
        protocol_version: Optional[str] = None,
        catalog_id: Optional[str] = None,
    ) -> "Catalog[ComponentApi, FunctionApi]":
        """Constructs a schema-only Catalog directly from raw JSON Schema."""
        catalog_id = catalog_id or catalog_schema.get("catalogId")
        if not catalog_id:
            raise A2uiCatalogError(
                "catalog_id must be provided or exist in catalog_schema."
            )

        p_ver = protocol_version or catalog_schema.get("protocolVersion")
        if not p_ver:
            raise ValueError("protocol_version must be provided.")

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

        components = []
        for name, schema in components_map.items():
            if not permitted_names or name in permitted_names:
                allowed_parents = (
                    schema.get("allowedParents") if isinstance(schema, dict) else None
                )
                allowed_children = (
                    schema.get("allowedChildren") if isinstance(schema, dict) else None
                )
                components.append(
                    ComponentApi(
                        name,
                        schema,
                        allowed_parents=allowed_parents,
                        allowed_children=allowed_children,
                    )
                )

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
                    spec_dict = spec if isinstance(spec, dict) else {}
                    functions.append(
                        FunctionApi(
                            name=name,
                            return_type=spec_dict.get("returnType"),
                            schema=spec,
                            allowed_callers=spec_dict.get("allowedCallers"),
                            requires_user_activation=spec_dict.get(
                                "requiresUserActivation"
                            ),
                        )
                    )

        cat = Catalog[ComponentApi, FunctionApi](
            catalog_id=catalog_id,
            protocol_version=p_ver,
            components=components,
            functions=functions,
            theme_schema=catalog_schema.get("theme") or {},
            instructions=catalog_schema.get("instructions"),
        )
        cat._catalog_schema = catalog_schema
        return cat
