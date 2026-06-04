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
from ..schema.constants import CATALOG_COMPONENTS_KEY, SPEC_BASE_URL
from .catalog import Catalog

JSON_SCHEMA_DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema"
COMMON_TYPES_SCHEMA_FILE = "common_types.json"
CATALOG_SCHEMA_FILE = "catalog.json"


def _schema_url(version: str, file_name: str) -> str:
    ver = version if version.startswith("v") else f"v{version}"
    return f"{SPEC_BASE_URL}/{ver.replace('.', '_')}/{file_name}"


class JsonCatalog(Catalog):
    """A Catalog subclass representing JSON-based catalog specifications.

    This is specifically designed for server-side inference prompt building and
    dynamic validation checks where concrete component Pydantic model classes are
    not pre-compiled or loaded.
    """

    def __init__(
        self,
        version: str,
        catalog_schema: Dict[str, Any],
        catalog_id: Optional[str] = None,
        common_types_schema: Optional[Dict[str, Any]] = None,
        custom_single_refs: Optional[List[str]] = None,
        custom_list_refs: Optional[List[str]] = None,
    ):
        if not catalog_id:
            catalog_id = catalog_schema.get("catalogId")
        if not catalog_id:
            raise ValueError("catalog_id must be provided or exist in catalog_schema.")
        super().__init__(
            version=version,
            catalog_id=catalog_id,
            custom_single_refs=custom_single_refs,
            custom_list_refs=custom_list_refs,
        )
        self.catalog_schema = catalog_schema
        self.common_types_schema = common_types_schema
        self._validators: Dict[str, Draft202012Validator] = {}
        self._registry = self._build_registry()

    def _build_registry(self) -> Registry:
        resources = []
        resources.append(
            (
                CATALOG_SCHEMA_FILE,
                Resource.from_contents(
                    self.catalog_schema, default_specification=DRAFT202012
                ),
            )
        )
        resources.append(
            (
                _schema_url(self.version, CATALOG_SCHEMA_FILE),
                Resource.from_contents(
                    self.catalog_schema, default_specification=DRAFT202012
                ),
            )
        )
        if self.common_types_schema:
            resources.append(
                (
                    COMMON_TYPES_SCHEMA_FILE,
                    Resource.from_contents(
                        self.common_types_schema, default_specification=DRAFT202012
                    ),
                )
            )
            resources.append(
                (
                    _schema_url(self.version, COMMON_TYPES_SCHEMA_FILE),
                    Resource.from_contents(
                        self.common_types_schema, default_specification=DRAFT202012
                    ),
                )
            )
        return Registry().with_resources(resources)

    def _get_component_schema(self, comp_type: str) -> Optional[Dict[str, Any]]:
        """Retrieves the raw JSON schema representing a component's properties."""
        components = self.catalog_schema.get("components", {})
        return components.get(comp_type)

    def _get_function_schema(self, func_name: str) -> Optional[Dict[str, Any]]:
        """Retrieves the raw JSON schema representing a function's arguments and returnType."""
        functions = self.catalog_schema.get("functions", {})
        return functions.get(func_name)

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
        comp_schema = self._get_component_schema(comp_type)
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
        comp_schema = self._get_component_schema(comp_type) or {}

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
        theme_spec = self.catalog_schema.get("theme")
        if not theme_spec:
            return

        ref_path = (
            f"{CATALOG_SCHEMA_FILE}#/$defs/theme"
            if "$defs" in self.catalog_schema
            and "theme" in self.catalog_schema["$defs"]
            else "catalog.json#/theme"
        )
        validator = self._get_validator("theme:schema", ref_path)
        errors = list(validator.iter_errors(theme_payload))
        if errors:
            raise ValueError(errors[0].message)

    def validate_function(self, func_name: str, args: Dict[str, Any]) -> None:
        """Validates function arguments dynamically against raw function specification."""
        func_spec = self._get_function_schema(func_name)
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

    def extract_ref_fields(self) -> Dict[str, Tuple[Set[str], Set[str]]]:
        """
        Parses the catalog/schema to identify which component properties reference other components.
        Returns a map: { component_name: (set_of_single_ref_fields, set_of_list_ref_fields) }
        """

        all_components = self.catalog_schema.get(CATALOG_COMPONENTS_KEY, {})

        # Helper to check if a property schema looks like a ComponentId reference
        def is_component_id_ref(prop_schema: Dict[str, Any]) -> bool:
            if not isinstance(prop_schema, dict):
                return False
            ref = prop_schema.get("$ref", "")
            if isinstance(ref, str) and ref.endswith("$defs/ComponentId"):
                return True

            # Check oneOf/anyOf for refs
            for key in ["oneOf", "anyOf", "allOf"]:
                if key in prop_schema:
                    for sub in prop_schema[key]:
                        if is_component_id_ref(sub):
                            return True
            return False

        def is_child_list_ref(prop_schema: Dict[str, Any]) -> bool:
            if not isinstance(prop_schema, dict):
                return False
            ref = prop_schema.get("$ref", "")
            if isinstance(ref, str) and ref.endswith("$defs/ChildList"):
                return True

            # Check oneOf/anyOf for refs
            for key in ["oneOf", "anyOf", "allOf"]:
                if key in prop_schema:
                    for sub in prop_schema[key]:
                        if is_child_list_ref(sub):
                            return True
            return False

        ref_map = {}
        for comp_name, comp_schema in all_components.items():
            single_refs = set()
            list_refs = set()

            def extract_from_props(comp_schema: Dict[str, Any]):
                if not isinstance(comp_schema, dict):
                    return
                props = comp_schema.get("properties", {})
                for prop_name, prop_schema in props.items():
                    if (
                        is_component_id_ref(prop_schema)
                        or prop_name in self.single_refs
                    ):
                        single_refs.add(prop_name)
                    elif is_child_list_ref(prop_schema) or prop_name in self.list_refs:
                        list_refs.add(prop_name)

                for key in ["allOf", "oneOf", "anyOf"]:
                    if key in comp_schema:
                        for sub in comp_schema[key]:
                            extract_from_props(sub)

            extract_from_props(comp_schema)

            if single_refs or list_refs:
                ref_map[comp_name] = (single_refs, list_refs)

        return ref_map
