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

import json
from typing import (
    Any,
    Dict,
    Generic,
    List,
    Optional,
    Set,
    Tuple,
    Type,
    Union,
    cast,
    get_args,
    get_origin,
    TYPE_CHECKING,
)

from pydantic import BaseModel, ConfigDict, ValidationError
from jsonschema import Draft202012Validator
from ..exceptions import A2uiValidationError, A2uiErrorDetail, A2uiCatalogError
from ..catalog.catalog import Catalog, TComponent, TFunction


class A2uiValidatorError(A2uiValidationError):
    """Exception raised when an A2UI Catalog payload validation fails."""


class ValidationConfig(BaseModel):
    """Configuration options for A2UI payload and component validation."""

    model_config = ConfigDict(frozen=True)

    allow_orphan_components: bool = False
    allow_dangling_references: bool = False
    allow_missing_root: bool = False
    allow_unknown_elements: bool = False
    allowed_messages: list[str] | None = None


# Presets for validation configuration
STRICT_VALIDATION = ValidationConfig()
RELAXED_VALIDATION = ValidationConfig(
    allow_orphan_components=True,
    allow_dangling_references=True,
    allow_missing_root=True,
    allow_unknown_elements=True,
)

JSON_SCHEMA_DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema"


def _schema_has_property(schema: Any, prop_name: str) -> bool:
    if not isinstance(schema, dict):
        return False
    if "$ref" in schema:
        return True
    if (
        "properties" in schema
        and isinstance(schema["properties"], dict)
        and prop_name in schema["properties"]
    ):
        return True
    if "allOf" in schema and isinstance(schema["allOf"], list):
        return any(_schema_has_property(sub, prop_name) for sub in schema["allOf"])
    if "anyOf" in schema and isinstance(schema["anyOf"], list):
        return any(_schema_has_property(sub, prop_name) for sub in schema["anyOf"])
    if "oneOf" in schema and isinstance(schema["oneOf"], list):
        return any(_schema_has_property(sub, prop_name) for sub in schema["oneOf"])
    return False


class PayloadValidator(Generic[TComponent, TFunction]):
    """Validates A2UI payloads against catalog JSON schema definitions."""

    def __init__(
        self,
        catalog: Catalog[TComponent, TFunction],
        config: ValidationConfig | None = None,
    ) -> None:
        self.catalog: Catalog[TComponent, TFunction] = catalog
        self.config = config

    def validate(
        self, payload: dict[str, Any] | list[dict[str, Any]]
    ) -> list[A2uiErrorDetail]:
        """Validates component dictionary or list of components against catalog schemas."""
        errors: list[A2uiErrorDetail] = []
        components = (
            payload["components"]
            if isinstance(payload, dict)
            and "components" in payload
            and isinstance(payload["components"], list)
            else payload
            if isinstance(payload, list)
            else [payload]
            if isinstance(payload, dict)
            else []
        )
        for comp in components:
            if isinstance(comp, dict):
                errors.extend(self.validate_component(comp))
        return errors

    def validate_component(
        self,
        comp: dict[str, Any],
    ) -> list[A2uiErrorDetail]:
        """Validates a single component dictionary payload against the catalog schema."""
        active_config = self.config
        allow_unknown = active_config.allow_unknown_elements if active_config else False

        errors: list[A2uiErrorDetail] = []
        if not isinstance(comp, dict):
            errors.append(
                A2uiErrorDetail(
                    path="components",
                    code="type_mismatch",
                    message="Component must be an object",
                )
            )
            return errors

        comp_id = comp.get("id")
        comp_type = comp.get("component") or comp.get("type")

        target_comp = None
        target_cat = self.catalog

        c = (
            target_cat.get_component(comp_type)
            if isinstance(comp_type, str) and hasattr(target_cat, "get_component")
            else None
        )
        if c is None and isinstance(comp_type, str):
            cat_schema = getattr(target_cat, "catalog_schema", {}) or {}
            comps_dict = (
                cat_schema.get("components", {}) if isinstance(cat_schema, dict) else {}
            )
            if isinstance(comps_dict, dict) and comp_type in comps_dict:
                c = comps_dict[comp_type]

        if c is not None:
            target_comp = c

        if target_comp is None:
            if not allow_unknown:
                errors.append(
                    A2uiErrorDetail(
                        path=f"components.{comp_id}.component",
                        code="unrecognized_component",
                        message=f"Unrecognized component type '{comp_type}'",
                    )
                )
            return errors

        model_cls = (
            getattr(target_comp, "schema", None)
            if isinstance(getattr(target_comp, "schema", None), type)
            and issubclass(getattr(target_comp, "schema"), BaseModel)
            else getattr(target_comp, "model_class", None)
        )

        if (
            model_cls
            and isinstance(model_cls, type)
            and issubclass(model_cls, BaseModel)
        ):
            self._validate_model_component(
                model_cls, comp, comp_id, allow_unknown, errors
            )
        elif isinstance(getattr(target_comp, "schema", None), dict) or isinstance(
            target_comp, dict
        ):
            self._validate_dict_component(
                target_comp, target_cat, comp, comp_id, allow_unknown, errors
            )
        else:
            raise A2uiCatalogError(
                f"No schema defined for component '{comp_type}' in catalog."
            )

        self._validate_nested_functions(comp_id or "unknown", comp, "", errors)
        return errors

    def _validate_model_component(
        self,
        model_cls: Type[BaseModel],
        comp: dict[str, Any],
        comp_id: str | None,
        allow_unknown: bool,
        errors: list[A2uiErrorDetail],
    ) -> None:
        """Validates a component payload against a Pydantic BaseModel schema."""
        try:
            model_cls.model_validate(comp)
        except ValidationError as e:
            for err in e.errors():
                loc_parts = [str(x) for x in err.get("loc", [])]
                path_str = ".".join(loc_parts)
                err_type = err.get("type", "")
                if err_type == "missing":
                    code = "missing_field"
                    msg = (
                        f"'{path_str}' is a required property"
                        if path_str
                        else "Missing required field"
                    )
                    # Match jsonschema error path behavior for missing property
                    path_str = ""
                elif err_type == "extra_forbidden":
                    code = "extra_field"
                    msg = "Additional properties are not allowed"
                elif "type" in err_type or "parsing" in err_type:
                    code = "type_mismatch"
                    msg = err.get("msg", "Type mismatch")
                else:
                    code = "invalid_value"
                    msg = err.get("msg", "Validation failed")

                if allow_unknown and code == "extra_field":
                    continue

                errors.append(
                    A2uiErrorDetail(
                        path=f"components.{comp_id or 'unknown'}.{path_str}"
                        if path_str
                        else f"components.{comp_id or 'unknown'}",
                        code=code,
                        message=msg,
                    )
                )

    def _validate_dict_component(
        self,
        target_comp: Any,
        target_cat: Any,
        comp: dict[str, Any],
        comp_id: str | None,
        allow_unknown: bool,
        errors: list[A2uiErrorDetail],
    ) -> None:
        """Validates a component against a JSON Schema dict definition."""
        comp_schema = (
            target_comp.schema
            if hasattr(target_comp, "schema") and isinstance(target_comp.schema, dict)
            else target_comp
            if isinstance(target_comp, dict)
            else {}
        )
        if not comp_schema:
            return

        base_schema = (
            getattr(target_cat, "catalog_schema", {}) or {} if target_cat else {}
        )
        defs = base_schema.get("$defs", {}) if isinstance(base_schema, dict) else {}
        full_schema = {
            "$schema": JSON_SCHEMA_DRAFT_2020_12,
            "$defs": {**defs, **comp_schema.get("$defs", {})},
            **{k: v for k, v in comp_schema.items() if k != "$defs"},
        }
        try:
            validator = Draft202012Validator(full_schema)
            props = dict(comp)
            req_fields = (
                validator.schema.get("required", [])
                if isinstance(validator.schema, dict)
                else []
            )
            if (
                not _schema_has_property(validator.schema, "id")
                and "id" not in req_fields
            ):
                props.pop("id", None)
            if (
                not _schema_has_property(validator.schema, "component")
                and "component" not in req_fields
            ):
                props.pop("component", None)
            schema_errors = sorted(validator.iter_errors(props), key=lambda e: e.path)
            for err in schema_errors:
                err_code = self._map_json_schema_error_code(err.validator)
                if allow_unknown and err_code == "extra_field":
                    continue
                path_str = ".".join(str(p) for p in err.path)
                errors.append(
                    A2uiErrorDetail(
                        path=f"components.{comp_id or 'unknown'}.{path_str}"
                        if path_str
                        else f"components.{comp_id or 'unknown'}",
                        code=err_code,
                        message=err.message,
                    )
                )
        except Exception:
            pass

    def _validate_nested_functions(
        self,
        comp_id: str,
        val: Any,
        path: str,
        errors: list[A2uiErrorDetail],
    ) -> None:
        """Recursively validates nested function calls within component properties."""
        if isinstance(val, dict):
            fn_name = val.get("call") or val.get("function")
            if fn_name and isinstance(fn_name, str):
                fn_args = val.get("args")
                args_dict = fn_args if isinstance(fn_args, dict) else {}
                try:
                    self.validate_function(fn_name, args_dict)
                except A2uiValidationError as e:
                    if e.details:
                        errors.extend(e.details)
                    else:
                        errors.append(
                            A2uiErrorDetail(
                                path=f"components.{comp_id}.{path}"
                                if path
                                else f"components.{comp_id}",
                                code="invalid_function_call",
                                message=str(e),
                            )
                        )
            for k, v in val.items():
                if k not in ("id", "component"):
                    child_path = f"{path}.{k}" if path else k
                    self._validate_nested_functions(comp_id, v, child_path, errors)
        elif isinstance(val, list):
            for idx, item in enumerate(val):
                child_path = f"{path}.{idx}"
                self._validate_nested_functions(comp_id, item, child_path, errors)

    def validate_function(
        self,
        name: str,
        args: dict[str, Any],
    ) -> None:
        """Validates function call parameters against catalog function schema definitions."""
        active_config = self.config
        allow_unknown = active_config.allow_unknown_elements if active_config else False

        fn_def, fn_schema, base_schema = self._find_function_definition(name)

        if fn_def is None and fn_schema is None:
            if not allow_unknown:
                raise A2uiValidationError(
                    f"Unrecognized function '{name}'",
                    details=[
                        A2uiErrorDetail(
                            path=f"functions.{name}",
                            code="unrecognized_function",
                            message=f"Unrecognized function '{name}'",
                        )
                    ],
                )
            return

        model_cls = (
            getattr(fn_def, "schema", None)
            or getattr(fn_def, "model_class", None)
            or getattr(fn_def, "parameters", None)
            if fn_def is not None
            else None
        )
        if isinstance(model_cls, type) and issubclass(model_cls, BaseModel):
            self._validate_model_function(model_cls, name, args)
        elif isinstance(fn_schema, dict):
            self._validate_dict_function(
                fn_schema, base_schema, name, args, allow_unknown
            )

    def _find_function_definition(
        self,
        name: str,
    ) -> tuple[Any | None, dict[str, Any] | None, dict[str, Any]]:
        """Finds function definition, schema, and base catalog schema in the registered catalog."""
        fn_def = None
        fn_schema = None
        base_schema: dict[str, Any] = {}
        cat = self.catalog
        if hasattr(cat, "get_function"):
            comp_fn = cat.get_function(name)
            if comp_fn:
                fn_def = comp_fn
                base_schema = getattr(cat, "catalog_schema", {}) or {}
                if hasattr(comp_fn, "schema") and isinstance(comp_fn.schema, dict):
                    fn_schema = comp_fn.schema
        if fn_def is None:
            cat_schema = getattr(cat, "catalog_schema", {}) or {}
            funcs_schema = cat_schema.get("functions", {})
            if isinstance(funcs_schema, dict) and name in funcs_schema:
                fn_schema = funcs_schema[name]
                base_schema = cat_schema
        return fn_def, fn_schema, base_schema

    def _validate_model_function(
        self,
        model_cls: Type[BaseModel],
        name: str,
        args: dict[str, Any],
    ) -> None:
        """Validates function arguments against a Pydantic BaseModel schema."""
        try:
            model_cls.model_validate(args or {})
        except ValidationError as e:
            fn_errors = []
            for err in e.errors():
                loc_parts = [str(x) for x in err.get("loc", [])]
                path_str = ".".join(loc_parts)
                err_type = err.get("type", "")
                if err_type == "missing":
                    code = "missing_field"
                elif err_type == "extra_forbidden":
                    code = "extra_field"
                elif "type" in err_type or "parsing" in err_type:
                    code = "type_mismatch"
                else:
                    code = "invalid_value"
                fn_errors.append(
                    A2uiErrorDetail(
                        path=f"functions.{name}.{path_str}"
                        if path_str
                        else f"functions.{name}",
                        code=code,
                        message=err.get("msg", "Validation failed"),
                    )
                )
            if fn_errors:
                summary = "\n".join(f"{e.path}: {e.message}" for e in fn_errors)
                raise A2uiValidationError(summary, details=fn_errors)

    def _validate_dict_function(
        self,
        fn_schema: dict[str, Any],
        base_schema: dict[str, Any],
        name: str,
        args: dict[str, Any],
        allow_unknown: bool,
    ) -> None:
        """Validates function arguments against a JSON Schema dict definition."""
        param_schema = None
        defs = base_schema.get("$defs", {}) if isinstance(base_schema, dict) else {}
        if "parameters" in fn_schema and isinstance(fn_schema["parameters"], dict):
            param_schema = {
                "$schema": JSON_SCHEMA_DRAFT_2020_12,
                "$defs": defs,
                "type": "object",
                "properties": fn_schema["parameters"],
            }
            if "required" in fn_schema and isinstance(fn_schema["required"], list):
                param_schema["required"] = fn_schema["required"]
            if "additionalProperties" in fn_schema:
                param_schema["additionalProperties"] = fn_schema["additionalProperties"]
        elif (
            "properties" in fn_schema
            and isinstance(fn_schema["properties"], dict)
            and "args" in fn_schema["properties"]
            and isinstance(fn_schema["properties"]["args"], dict)
        ):
            param_schema = {
                "$schema": JSON_SCHEMA_DRAFT_2020_12,
                "$defs": defs,
                **fn_schema["properties"]["args"],
            }
        elif "properties" in fn_schema and isinstance(fn_schema["properties"], dict):
            param_schema = {
                "$schema": JSON_SCHEMA_DRAFT_2020_12,
                "$defs": defs,
                "type": "object",
                **fn_schema,
            }

        if param_schema:
            try:
                fn_validator = Draft202012Validator(param_schema)
                schema_errors = sorted(
                    fn_validator.iter_errors(args or {}), key=lambda e: e.path
                )
                errors = []
                for err in schema_errors:
                    err_code = self._map_json_schema_error_code(err.validator)
                    if allow_unknown and err_code == "extra_field":
                        continue
                    path_str = ".".join(str(p) for p in err.path)
                    errors.append(
                        A2uiErrorDetail(
                            path=f"functions.{name}.{path_str}"
                            if path_str
                            else f"functions.{name}",
                            code=err_code,
                            message=err.message,
                        )
                    )
                if errors:
                    summary = "\n".join(f"{e.path}: {e.message}" for e in errors)
                    raise A2uiValidationError(summary, details=errors)
            except A2uiValidationError:
                raise
            except Exception:
                pass

    def validate_theme(self, theme: dict[str, Any]) -> None:
        """Validates a theme configuration dictionary against the catalog theme schema."""
        if not isinstance(theme, dict):
            raise A2uiValidationError(
                "Theme payload must be an object",
                details=[
                    A2uiErrorDetail(
                        path="theme",
                        code="type_mismatch",
                        message="Theme payload must be an object",
                    )
                ],
            )
        base_schema = getattr(self.catalog, "catalog_schema", {}) or {}
        defs: dict[str, Any] = (
            base_schema.get("$defs", {}) if isinstance(base_schema, dict) else {}
        )
        theme_schema = getattr(self.catalog, "theme_schema", None) or (
            base_schema.get("properties", {}) if isinstance(base_schema, dict) else {}
        ).get("theme")

        if theme_schema:
            full_theme_schema = {
                "$schema": JSON_SCHEMA_DRAFT_2020_12,
                "$defs": defs,
                **theme_schema,
            }
            try:
                theme_validator = Draft202012Validator(full_theme_schema)
                schema_errors = sorted(
                    theme_validator.iter_errors(theme), key=lambda e: e.path
                )
                if schema_errors:
                    details = [
                        A2uiErrorDetail(
                            path=".".join(str(p) for p in err.path) or "theme",
                            code=self._map_json_schema_error_code(err.validator),
                            message=err.message,
                        )
                        for err in schema_errors
                    ]
                    summary = "\n".join(f"{e.path}: {e.message}" for e in details)
                    raise A2uiValidationError(summary, details=details)
            except A2uiValidationError:
                raise
            except Exception:
                pass

    def _map_json_schema_error_code(self, validator_name: str) -> str:
        if validator_name in ("required", "minProperties"):
            return "missing_field"
        if validator_name in ("additionalProperties", "unevaluatedProperties"):
            return "extra_field"
        if validator_name in ("type", "format", "pattern", "enum"):
            return "type_mismatch"
        return "invalid_value"
