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
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from ..catalog import CatalogApi, JsonCatalog, ModelCatalog
from ..schema.constants import CATALOG_COMPONENTS_KEY, SPEC_BASE_URL

JSON_SCHEMA_DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema"
COMMON_TYPES_SCHEMA_FILE = "common_types.json"
CATALOG_SCHEMA_FILE = "catalog.json"


def _schema_url(spec_version: str, file_name: str) -> str:
    ver = spec_version if spec_version.startswith("v") else f"v{spec_version}"
    return f"{SPEC_BASE_URL}/{ver.replace('.', '_')}/{file_name}"


class CatalogValidator:
    """Base abstract Catalog Validator definition."""

    def __init__(self, catalog: CatalogApi):
        self.catalog = catalog

    def validate_components(self, comp_payload: List[Dict[str, Any]]) -> None:
        """Validates a list of component payloads conforming to the catalog's schemas."""
        raise NotImplementedError("Subclasses must implement validate_components()")

    def validate_function(self, func_name: str, args: Dict[str, Any]) -> None:
        """Validates that function arguments conform to the catalog's schema for this function."""
        raise NotImplementedError("Subclasses must implement validate_function()")

    def validate_theme(self, theme_payload: Dict[str, Any]) -> None:
        """Validates that theme properties conform to the catalog's theme schema."""
        raise NotImplementedError("Subclasses must implement validate_theme()")

    def extract_ref_fields(self) -> Dict[str, Tuple[Set[str], Set[str]]]:
        """Inspects and retrieves the topological reference pointer map from the underlying catalog."""
        return self.catalog.extract_ref_fields()

    @classmethod
    def from_catalog(cls, catalog: CatalogApi) -> "CatalogValidator":
        if isinstance(catalog, ModelCatalog):
            return ModelCatalogValidator(catalog)
        elif isinstance(catalog, JsonCatalog):
            return JsonCatalogValidator(catalog)
        raise ValueError(
            f"No CatalogValidator implementation found for catalog type '{type(catalog).__name__}'"
        )


class ModelCatalogValidator(CatalogValidator):
    """Validator for ModelCatalog instances (Pydantic models)."""

    def __init__(self, catalog: ModelCatalog):
        super().__init__(catalog)
        self.catalog: ModelCatalog = catalog

    def _check_nested_functions(self, val: Any) -> None:
        if isinstance(val, list):
            for item in val:
                self._check_nested_functions(item)
        elif isinstance(val, dict):
            if "call" in val and "args" in val:
                func_name = val["call"]
                try:
                    self.validate_function(func_name, val["args"])
                except Exception as e:
                    raise ValueError(f"Invalid function call '{func_name}': {e}")
            for value in val.values():
                self._check_nested_functions(value)

    def _validate_component(self, comp_type: str, comp_payload: Dict[str, Any]) -> None:
        """Validates that a component payload conforms to the catalog's schema for this type."""
        comp_class = self.catalog.get_component_class(comp_type)
        if not comp_class:
            raise ValueError(f"Unknown component type: {comp_type}")

        schema = (
            comp_class.model_json_schema()
            if hasattr(comp_class, "model_json_schema")
            else {}
        )
        if schema.get("unevaluatedProperties") is False:
            defined = (
                set(comp_class.model_fields.keys())
                if hasattr(comp_class, "model_fields")
                else set()
            )
            extra = [k for k in comp_payload if k not in defined and k != "component"]
            if extra:
                raise ValueError(f"Extra inputs are not permitted: {extra}")

        comp_class.model_validate(comp_payload)
        self._check_nested_functions(comp_payload)

    def validate_components(self, comp_payload: List[Dict[str, Any]]) -> None:
        """Validates a list of component payloads conforming to the catalog's schemas."""
        for comp in comp_payload:
            if isinstance(comp, dict) and "component" in comp:
                self._validate_component(comp["component"], comp)

    def validate_theme(self, theme_payload: Dict[str, Any]) -> None:
        """Validates that theme properties conform to the catalog's theme schema."""
        if self.catalog.theme:
            self.catalog.theme.model_validate(theme_payload)

    def validate_function(self, func_name: str, args: Dict[str, Any]) -> None:
        """Validates that function arguments conform to the catalog's schema for this function."""
        func_class = self.catalog.get_function_class(func_name)
        if not func_class:
            raise ValueError(f"Unknown function: {func_name}")
        if hasattr(func_class, "model_fields") and "call" in func_class.model_fields:
            payload = {"call": func_name, "args": args}
            func_class.model_validate(payload)
        else:
            func_class.model_validate(args)


class JsonCatalogValidator(CatalogValidator):
    """Validator for JsonCatalog instances (raw JSON schema definitions)."""

    def __init__(self, catalog: JsonCatalog):
        super().__init__(catalog)
        self.catalog: JsonCatalog = catalog
        self._validators: Dict[str, Draft202012Validator] = {}
        self._registry = self._build_registry()

    def _build_registry(self) -> Registry:
        resources = []
        resources.append(
            (
                CATALOG_SCHEMA_FILE,
                Resource.from_contents(
                    self.catalog.catalog_schema, default_specification=DRAFT202012
                ),
            )
        )
        resources.append(
            (
                _schema_url(self.catalog.spec_version, CATALOG_SCHEMA_FILE),
                Resource.from_contents(
                    self.catalog.catalog_schema, default_specification=DRAFT202012
                ),
            )
        )
        if self.catalog.common_types_schema:
            resources.append(
                (
                    COMMON_TYPES_SCHEMA_FILE,
                    Resource.from_contents(
                        self.catalog.common_types_schema,
                        default_specification=DRAFT202012,
                    ),
                )
            )
            resources.append(
                (
                    _schema_url(self.catalog.spec_version, COMMON_TYPES_SCHEMA_FILE),
                    Resource.from_contents(
                        self.catalog.common_types_schema,
                        default_specification=DRAFT202012,
                    ),
                )
            )
        return Registry().with_resources(resources)

    def _get_validator(self, key: str, ref_path: str) -> Draft202012Validator:
        """Creates or retrieves a cached Draft202012Validator for the given ref path."""
        if key not in self._validators:
            full_schema = {"$schema": JSON_SCHEMA_DRAFT_2020_12, "$ref": ref_path}
            try:
                self._validators[key] = Draft202012Validator(
                    full_schema, registry=self._registry
                )
            except Exception as e:
                raise ValueError(str(e))
        return self._validators[key]

    def validate_component_properties(
        self, comp_type: str, properties: Dict[str, Any]
    ) -> None:
        """Validates raw component properties dynamically using jsonschema draft 2020-12."""
        comp_schema = self.catalog.get_component_schema(comp_type)
        if not comp_schema:
            raise ValueError(f"Unknown component type: {comp_type}")

        validator = self._get_validator(
            f"comp:{comp_type}", f"{CATALOG_SCHEMA_FILE}#/components/{comp_type}"
        )
        errors = list(validator.iter_errors(properties))
        if errors:
            raise ValueError("\n".join(err.message for err in errors))

    def _validate_component(self, comp_type: str, comp_payload: Dict[str, Any]) -> None:
        """Overrides component validation to validate using raw JSON Schema rules."""
        comp_schema = self.catalog.get_component_schema(comp_type) or {}

        def defines_property(schema: Any, prop_name: str) -> bool:
            if not isinstance(schema, dict):
                return False
            if "properties" in schema and prop_name in schema["properties"]:
                return True
            for key in ["allOf", "oneOf", "anyOf"]:
                if key in schema and isinstance(schema[key], list):
                    for sub in schema[key]:
                        if defines_property(sub, prop_name):
                            return True
            if "$ref" in schema and isinstance(schema["$ref"], str):
                ref = schema["$ref"]
                if "ComponentCommon" in ref and prop_name == "id":
                    return True
            return False

        strip_keys = []
        if not defines_property(comp_schema, "id"):
            strip_keys.append("id")
        if not defines_property(comp_schema, "component"):
            strip_keys.append("component")

        properties = {k: v for k, v in comp_payload.items() if k not in strip_keys}
        try:
            self.validate_component_properties(comp_type, properties)
            self._check_nested_functions(comp_payload)
        except Exception as e:
            raise ValueError(str(e))

    def validate_components(self, comp_payload: List[Dict[str, Any]]) -> None:
        """Validates a list of component payloads conforming to the catalog's schemas."""
        for comp in comp_payload:
            if isinstance(comp, dict) and "component" in comp:
                self._validate_component(comp["component"], comp)

    def validate_theme(self, theme_payload: Dict[str, Any]) -> None:
        """Validates theme properties dynamically against raw catalog theme specification."""
        theme_spec = self.catalog.catalog_schema.get("theme")
        if not theme_spec:
            return

        ref_path = (
            f"{CATALOG_SCHEMA_FILE}#/$defs/theme"
            if "$defs" in self.catalog.catalog_schema
            and "theme" in self.catalog.catalog_schema["$defs"]
            else "catalog.json#/theme"
        )
        validator = self._get_validator("theme:schema", ref_path)
        errors = list(validator.iter_errors(theme_payload))
        if errors:
            raise ValueError(errors[0].message)

    def validate_function(self, func_name: str, args: Dict[str, Any]) -> None:
        """Validates function arguments dynamically against raw function specification."""
        func_spec = self.catalog.get_function_schema(func_name)
        if not func_spec:
            raise ValueError(f"Unknown function: {func_name}")

        validator = self._get_validator(
            f"func:{func_name}", f"{CATALOG_SCHEMA_FILE}#/functions/{func_name}"
        )
        # JSON spec validator expects function call wrapper structure
        payload = {"call": func_name, "args": args}
        errors = list(validator.iter_errors(payload))
        if errors:
            raise ValueError(errors[0].message)

    def _check_nested_functions(self, val: Any) -> None:
        if isinstance(val, list):
            for item in val:
                self._check_nested_functions(item)
        elif isinstance(val, dict):
            if "call" in val and "args" in val:
                func_name = val["call"]
                try:
                    self.validate_function(func_name, val["args"])
                except Exception as e:
                    raise ValueError(f"Invalid function call '{func_name}': {e}")
            for value in val.values():
                self._check_nested_functions(value)
