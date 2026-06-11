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

from typing import Any, Dict, List, Optional, Set, Tuple, Union, get_args, get_origin
from jsonschema import Draft202012Validator
from pydantic import BaseModel
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from ..catalog import Catalog, ComponentApi, ModelComponentApi
from ..schema.common_types import (
    ComponentReference,
    ListReference,
    SingleReference,
)
from ..schema.constants import CATALOG_COMPONENTS_KEY, SPEC_BASE_URL

JSON_SCHEMA_DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema"
COMMON_TYPES_SCHEMA_FILE = "common_types.json"
CATALOG_SCHEMA_FILE = "catalog.json"


def _schema_url(spec_version: str, file_name: str) -> str:
    ver = spec_version if spec_version.startswith("v") else f"v{spec_version}"
    return f"{SPEC_BASE_URL}/{ver.replace('.', '_')}/{file_name}"


class CatalogValidator:
    """Consolidated Catalog Validator for A2UI catalogs using jsonschema engine."""

    def __init__(self, catalog: Catalog[Any, Any]):
        self.catalog = catalog
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
            full_schema = {
                "$schema": JSON_SCHEMA_DRAFT_2020_12,
                "$ref": ref_path,
            }
            try:
                self._validators[key] = Draft202012Validator(
                    full_schema, registry=self._registry
                )
            except Exception as e:
                raise ValueError(str(e))
        return self._validators[key]

    def _get_component_schema(self, comp_type: str) -> Optional[Dict[str, Any]]:
        comp = self.catalog.get_component(comp_type)
        if hasattr(comp, "schema"):
            return comp.schema
        if isinstance(comp, dict):
            return comp
        if comp and hasattr(comp, "model_json_schema"):
            return comp.model_json_schema()
        return None

    def _get_function_schema(self, func_name: str) -> Optional[Dict[str, Any]]:
        fn = self.catalog.get_function(func_name)
        if fn is not None:
            if hasattr(fn, "schema"):
                if isinstance(fn.schema, dict):
                    return fn.schema
                if hasattr(fn.schema, "model_json_schema"):
                    return fn.schema.model_json_schema()
            if isinstance(fn, dict):
                return fn
        if fn and hasattr(fn, "model_json_schema"):
            return fn.model_json_schema()
        return None

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
        """Validates that a component payload conforms to the catalog's schemas and models."""
        comp_obj = self.catalog.get_component(comp_type)
        if not comp_obj:
            raise ValueError(f"Unknown component type: {comp_type}")

        comp_schema = self._get_component_schema(comp_type) or {}

        # 1. Run pure jsonschema validation
        if comp_schema:

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

            # Check unevaluatedProperties / extra for Pydantic match
            if comp_schema.get("unevaluatedProperties") is False and hasattr(
                comp_obj, "model_class"
            ):
                defined = set()
                if hasattr(comp_obj.model_class, "model_fields"):
                    defined = set(comp_obj.model_class.model_fields.keys())
                extra = [
                    k for k in comp_payload if k not in defined and k != "component"
                ]
                if extra:
                    raise ValueError(f"Extra inputs are not permitted: {extra}")

            try:
                validator = self._get_validator(
                    f"comp:{comp_type}",
                    f"{CATALOG_SCHEMA_FILE}#/components/{comp_type}",
                )
                errors = list(validator.iter_errors(properties))
                if errors:
                    raise ValueError(self._format_errors(errors))
            except Exception as e:
                raise ValueError(str(e))

        self._check_nested_functions(comp_payload)

    def _format_errors(self, errors: List[Any]) -> str:
        msgs = []
        for err in errors:
            path_str = (
                ".".join(map(str, err.path))
                if hasattr(err, "path") and err.path
                else "root"
            )
            msgs.append(f"[{path_str}] {err.message}")
        return "\n".join(msgs)

    def validate_components(self, comp_payload: List[Dict[str, Any]]) -> None:
        """Validates a list of component payloads conforming to the catalog's schemas."""
        for comp in comp_payload:
            if isinstance(comp, dict) and "component" in comp:
                self._validate_component(comp["component"], comp)

    def validate_theme(self, theme_payload: Dict[str, Any]) -> None:
        """Validates theme properties dynamically against catalog theme specification."""
        theme_spec = self.catalog.get_theme_schema()
        if theme_spec:
            ref_path = (
                f"{CATALOG_SCHEMA_FILE}#/$defs/theme"
                if "$defs" in self.catalog.catalog_schema
                and "theme" in self.catalog.catalog_schema["$defs"]
                else f"{CATALOG_SCHEMA_FILE}#/theme"
            )
            try:
                validator = self._get_validator("theme:schema", ref_path)
                errors = list(validator.iter_errors(theme_payload))
                if errors:
                    raise ValueError(self._format_errors(errors))
            except Exception as e:
                raise ValueError(str(e))

    def validate_function(self, func_name: str, args: Dict[str, Any]) -> None:
        """Validates function arguments dynamically against raw function specification."""
        func_obj = self.catalog.get_function(func_name)
        if not func_obj:
            raise ValueError(f"Unknown function: {func_name}")

        func_spec = self._get_function_schema(func_name)
        if func_spec:
            validator = self._get_validator(
                f"func:{func_name}",
                f"{CATALOG_SCHEMA_FILE}#/functions/{func_name}",
            )
            # Some JSON specs have call/args envelope in function schema
            if (
                isinstance(func_spec, dict)
                and "properties" in func_spec
                and "call" in func_spec["properties"]
            ):
                payload = {"call": func_name, "args": args}
            elif isinstance(func_spec, list):
                payload = args
            else:
                payload = args  # type: ignore
            errors = list(validator.iter_errors(payload))
            if errors:
                raise ValueError(self._format_errors(errors))

    def extract_ref_fields(self) -> Dict[str, Tuple[Set[str], Set[str]]]:
        """Inspects and retrieves the topological reference pointer map from the underlying catalog."""
        return extract_ref_fields(self.catalog)

    @classmethod
    def from_catalog(cls, catalog: Any) -> "CatalogValidator":
        if isinstance(catalog, CatalogValidator):
            return catalog
        return cls(catalog)


def extract_ref_fields(
    catalog: Catalog[Any, Any],
) -> Dict[str, Tuple[Set[str], Set[str]]]:
    """Inspects and retrieves the topological reference pointer map from the underlying catalog."""
    ref_map = {}

    # 1. Pydantic-based helper
    def _is_ref_type(typ: Any) -> Tuple[bool, bool]:
        if isinstance(typ, type):
            if issubclass(typ, SingleReference):
                return True, False
            if issubclass(typ, ListReference):
                return False, True

        origin = get_origin(typ)
        if origin in (list, List):
            args = get_args(typ)
            if args:
                elem = args[0]
                if isinstance(elem, type) and issubclass(elem, ComponentReference):
                    return False, True
                if isinstance(elem, type) and issubclass(elem, BaseModel):
                    for fi in elem.model_fields.values():
                        s, l = _is_ref_type(fi.annotation)
                        if s or l:
                            return False, True

        if origin == Union:
            args = get_args(typ)
            has_s, has_l = False, False
            for arg in args:
                s, l = _is_ref_type(arg)
                if s:
                    has_s = True
                if l:
                    has_l = True
            return has_s, has_l

        return False, False

    # 2. JSON Schema-based helper
    def is_component_id_ref(prop_schema: Any) -> bool:
        if not isinstance(prop_schema, dict):
            return False
        ref = prop_schema.get("$ref", "")
        if isinstance(ref, str) and ref.endswith("$defs/ComponentId"):
            return True

        for key in ["oneOf", "anyOf", "allOf"]:
            if key in prop_schema and isinstance(prop_schema[key], list):
                for sub in prop_schema[key]:
                    if is_component_id_ref(sub):
                        return True
        return False

    def is_child_list_ref(prop_schema: Any) -> bool:
        if not isinstance(prop_schema, dict):
            return False
        ref = prop_schema.get("$ref", "")
        if isinstance(ref, str) and ref.endswith("$defs/ChildList"):
            return True

        for key in ["oneOf", "anyOf", "allOf"]:
            if key in prop_schema and isinstance(prop_schema[key], list):
                for sub in prop_schema[key]:
                    if is_child_list_ref(sub):
                        return True
        return False

    def resolve_ref(schema: Any, visited: Optional[Set[str]] = None) -> Any:
        if not isinstance(schema, dict) or "$ref" not in schema:
            return schema
        visited = visited or set()
        ref = schema.get("$ref", "")
        if (
            not isinstance(ref, str)
            or not ref.startswith("#/")
            or ref in visited
            or ref.endswith("/ComponentId")
            or ref.endswith("/ChildList")
        ):
            return schema
        visited.add(ref)

        parts = ref.split("/")[1:]
        cur = catalog.catalog_schema
        for p in parts:
            if isinstance(cur, dict):
                cur = cur.get(p, {})
            else:
                return schema
        if isinstance(cur, dict) and cur:
            return resolve_ref(cur, visited)
        return schema

    # Now iterate over all components in the catalog
    for comp_name, comp_obj in catalog.components.items():
        single_refs = set()
        list_refs = set()

        # If it's a ModelComponentApi (or BaseModel subclass), inspect fields
        if hasattr(comp_obj, "model_class") and hasattr(
            comp_obj.model_class, "model_fields"
        ):
            for field_name, field_info in comp_obj.model_class.model_fields.items():
                if field_name in ("id", "component"):
                    continue
                s, l = _is_ref_type(field_info.annotation)
                if s:
                    single_refs.add(field_name)
                if l:
                    list_refs.add(field_name)
        elif isinstance(comp_obj, type) and issubclass(comp_obj, BaseModel):
            for field_name, field_info in comp_obj.model_fields.items():
                if field_name in ("id", "component"):
                    continue
                s, l = _is_ref_type(field_info.annotation)
                if s:
                    single_refs.add(field_name)
                if l:
                    list_refs.add(field_name)
        else:
            # Use JSON schema inspection
            comp_schema = (
                comp_obj.schema
                if hasattr(comp_obj, "schema")
                else (comp_obj if isinstance(comp_obj, dict) else {})
            )

            def extract_from_props(comp_schema: Any):
                if not isinstance(comp_schema, dict):
                    return
                props = comp_schema.get("properties", {})
                for prop_name, prop_schema in props.items():
                    resolved_prop = resolve_ref(prop_schema)
                    if is_component_id_ref(resolved_prop):
                        single_refs.add(prop_name)
                    elif is_child_list_ref(resolved_prop):
                        list_refs.add(prop_name)
                    else:
                        if (
                            isinstance(resolved_prop, dict)
                            and resolved_prop.get("type") == "array"
                            and "items" in resolved_prop
                        ):
                            items = resolve_ref(resolved_prop["items"])
                            if isinstance(items, dict):
                                if is_component_id_ref(items) or is_child_list_ref(
                                    items
                                ):
                                    list_refs.add(prop_name)
                                elif "properties" in items:
                                    for sub_schema in items["properties"].values():
                                        resolved_sub = resolve_ref(sub_schema)
                                        if is_component_id_ref(
                                            resolved_sub
                                        ) or is_child_list_ref(resolved_sub):
                                            list_refs.add(prop_name)
                                            break

                for key in ["allOf", "oneOf", "anyOf"]:
                    if key in comp_schema and isinstance(comp_schema[key], list):
                        for sub in comp_schema[key]:
                            extract_from_props(sub)

            extract_from_props(comp_schema)

        if single_refs or list_refs:
            ref_map[comp_name] = (single_refs, list_refs)

    return ref_map
