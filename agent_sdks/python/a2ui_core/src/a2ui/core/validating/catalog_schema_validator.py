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
from pydantic import BaseModel, ValidationError, TypeAdapter
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from ..catalog import Catalog, ComponentApi, ModelComponentApi
from ..catalog.catalog import TComponent, TFunction
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


class CatalogSchemaValidator:
    """Consolidated Catalog Schema Validator for A2UI catalogs using jsonschema engine."""

    def __init__(
        self,
        catalog: Catalog[TComponent, TFunction],
        common_types_schema: Dict[str, Any] = {},
    ):
        self.catalog = catalog
        self.common_types_schema = common_types_schema
        self._validators: Dict[str, Draft202012Validator] = {}
        self._registry = self._build_registry()

    def _build_registry(self) -> Registry:
        resources = []
        catalog_schema = self.catalog.catalog_schema
        if not catalog_schema:
            components_dict = {}
            for name in self.catalog.components:
                comp_schema = self._get_component_schema(name)
                if comp_schema:
                    components_dict[name] = comp_schema
            catalog_schema = {
                "catalogId": self.catalog.catalog_id,
                "components": components_dict,
            }
            theme_schema = self.catalog.get_theme_schema()
            if theme_schema:
                catalog_schema["theme"] = theme_schema

        resources.append(
            (
                CATALOG_SCHEMA_FILE,
                Resource.from_contents(
                    catalog_schema, default_specification=DRAFT202012
                ),
            )
        )
        resources.append(
            (
                _schema_url(self.catalog.spec_version, CATALOG_SCHEMA_FILE),
                Resource.from_contents(
                    catalog_schema, default_specification=DRAFT202012
                ),
            )
        )
        if self.common_types_schema:
            resources.append(
                (
                    COMMON_TYPES_SCHEMA_FILE,
                    Resource.from_contents(
                        self.common_types_schema,
                        default_specification=DRAFT202012,
                    ),
                )
            )
            resources.append(
                (
                    _schema_url(self.catalog.spec_version, COMMON_TYPES_SCHEMA_FILE),
                    Resource.from_contents(
                        self.common_types_schema,
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

        # 1. Native Pydantic Validation Pathway
        if hasattr(comp_obj, "model_class") and comp_obj.model_class:
            model_config = getattr(comp_obj.model_class, "model_config", {})
            schema_extra = model_config.get("json_schema_extra", {})
            forbid_extra = model_config.get("extra") == "forbid"
            if (
                isinstance(schema_extra, dict)
                and schema_extra.get("unevaluatedProperties") is False
            ):
                forbid_extra = True

            try:
                if forbid_extra:

                    class ForbidModel(comp_obj.model_class):
                        model_config = {"extra": "forbid"}

                    ForbidModel.model_validate(comp_payload)
                else:
                    comp_obj.model_class.model_validate(comp_payload)
            except ValidationError as ve:
                raise ValueError(self._format_pydantic_errors(ve))
            except Exception as e:
                raise ValueError(str(e))

        # 2. JSON Schema Validation Pathway
        else:
            comp_schema = self._get_component_schema(comp_type) or {}
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

                properties = {
                    k: v for k, v in comp_payload.items() if k not in strip_keys
                }

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

    def _format_pydantic_errors(self, err: ValidationError) -> str:
        msgs = []
        for error in err.errors():
            path_str = ".".join(map(str, error["loc"]))
            msg = error["msg"]
            if error.get("type") == "extra_forbidden":
                msg = "Additional properties are not allowed"
            msgs.append(f"[{path_str}] {msg}")
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
                if self.catalog.catalog_schema is not None
                and "$defs" in self.catalog.catalog_schema
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

        if func_obj.schema and hasattr(func_obj.schema, "model_validate"):
            if (
                hasattr(func_obj.schema, "model_fields")
                and "call" in func_obj.schema.model_fields
                and "args" in func_obj.schema.model_fields
            ):
                payload = {"call": func_name, "args": args}
            else:
                payload = args
            try:
                func_obj.schema.model_validate(payload)
            except ValidationError as ve:
                raise ValueError(self._format_pydantic_errors(ve))
            except Exception as e:
                raise ValueError(str(e))
        else:
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
    def from_catalog(
        cls,
        catalog: Any,
        common_types_schema: Optional[Dict[str, Any]] = None,
    ) -> "CatalogSchemaValidator":
        if isinstance(catalog, CatalogSchemaValidator):
            return catalog
        return cls(catalog, common_types_schema=common_types_schema)


def _extract_ref_fields_pydantic(
    catalog: Catalog[Any, Any],
) -> Dict[str, Tuple[Set[str], Set[str]]]:
    ref_map = {}

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

    for comp_name, comp_obj in catalog.components.items():
        single_refs = set()
        list_refs = set()

        if hasattr(comp_obj, "model_class") and hasattr(
            comp_obj.model_class, "model_fields"
        ):
            model_cls = comp_obj.model_class
        elif isinstance(comp_obj, type) and issubclass(comp_obj, BaseModel):
            model_cls = comp_obj
        else:
            continue

        for field_name, field_info in model_cls.model_fields.items():
            if field_name in ("id", "component"):
                continue
            s, l = _is_ref_type(field_info.annotation)
            if s:
                single_refs.add(field_name)
            if l:
                list_refs.add(field_name)

        if single_refs or list_refs:
            ref_map[comp_name] = (single_refs, list_refs)

    return ref_map


def _extract_ref_fields_json(
    catalog: Catalog[Any, Any],
) -> Dict[str, Tuple[Set[str], Set[str]]]:
    ref_map = {}

    def is_component_id_ref(prop_schema: Any) -> bool:
        if not isinstance(prop_schema, dict):
            return False
        ref = prop_schema.get("$ref", "")
        if isinstance(ref, str) and ref.endswith("/ComponentId"):
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
        if isinstance(ref, str) and ref.endswith("/ChildList"):
            return True

        for key in ["oneOf", "anyOf", "allOf"]:
            if key in prop_schema and isinstance(prop_schema[key], list):
                for sub in prop_schema[key]:
                    if is_child_list_ref(sub):
                        return True
        return False

    def resolve_ref(
        schema: Any, comp_schema: Dict[str, Any], visited: Optional[Set[str]] = None
    ) -> Any:
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
        # Check local component defs first!
        if parts[0] == "$defs":
            local_defs = comp_schema.get("$defs", {})
            cur = local_defs
            for p in parts[1:]:
                if isinstance(cur, dict):
                    cur = cur.get(p, {})
                else:
                    cur = {}
            if cur:
                return resolve_ref(cur, comp_schema, visited)

        # Fallback to root catalog schema defs
        cur = catalog.catalog_schema
        for p in parts:
            if isinstance(cur, dict):
                cur = cur.get(p, {})
            else:
                return schema
        if isinstance(cur, dict) and cur:
            return resolve_ref(cur, comp_schema, visited)
        return schema

    for comp_name, comp_obj in catalog.components.items():
        single_refs = set()
        list_refs = set()

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
                resolved_prop = resolve_ref(prop_schema, comp_schema)
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
                        items = resolve_ref(resolved_prop["items"], comp_schema)
                        if isinstance(items, dict):
                            if is_component_id_ref(items) or is_child_list_ref(items):
                                list_refs.add(prop_name)
                            elif "properties" in items:
                                for sub_schema in items["properties"].values():
                                    resolved_sub = resolve_ref(sub_schema, comp_schema)
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


def extract_ref_fields(
    catalog: Catalog[Any, Any],
) -> Dict[str, Tuple[Set[str], Set[str]]]:
    """Inspects and retrieves the topological reference pointer map from the underlying catalog."""
    has_pydantic_models = False
    for comp in catalog.components.values():
        if hasattr(comp, "model_class") and comp.model_class:
            has_pydantic_models = True
            break
        if isinstance(comp, type) and issubclass(comp, BaseModel):
            has_pydantic_models = True
            break

    if has_pydantic_models:
        return _extract_ref_fields_pydantic(catalog)
    return _extract_ref_fields_json(catalog)
