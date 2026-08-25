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
    List,
    Optional,
    Set,
    Tuple,
    Union,
    get_args,
    get_origin,
    TYPE_CHECKING,
)

from pydantic import BaseModel, ConfigDict
from jsonschema import Draft202012Validator
from ..exceptions import A2uiValidationError, A2uiErrorDetail
from ..catalog import Catalog
from ..catalog.catalog import TComponent, TFunction


class A2uiValidatorError(A2uiValidationError):
    """Exception raised when an A2UI Catalog payload validation fails."""


class ValidationConfig(BaseModel):
    """Configuration options for A2UI payload and component validation."""

    model_config = ConfigDict(frozen=True)

    allow_orphan_components: bool = False
    allow_dangling_references: bool = False
    allow_missing_root: bool = False
    allow_unknown_elements: bool = False
    target_version: Optional[str] = None


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


class CatalogSchemaValidator:
    """Validates component properties and themes against catalog JSON schema definitions."""

    def __init__(
        self,
        catalog: Catalog[TComponent, TFunction],
        common_types_schema: Optional[Dict[str, Any]] = None,
        config: Optional[ValidationConfig] = None,
    ) -> None:
        self.catalog = catalog
        self.common_types_schema = common_types_schema or {}
        self.config = config
        self._validators: Dict[str, Draft202012Validator] = {}
        self._theme_validator: Optional[Draft202012Validator] = None
        self._initialize_validators()

    def _initialize_validators(self) -> None:
        """Initializes jsonschema Draft202012Validator instances for each component and theme."""
        base_schema = getattr(self.catalog, "catalog_schema", {}) or {}
        defs = base_schema.get("$defs", {}) if isinstance(base_schema, dict) else {}
        comps = getattr(self.catalog, "components", {}) or {}
        for name, comp in comps.items():
            if hasattr(comp, "schema") and comp.schema:
                comp_schema = comp.schema
            elif isinstance(comp, dict):
                comp_schema = comp
            else:
                comp_schema = {}

            # Create a standalone schema for validation including $defs
            full_schema = {
                "$schema": JSON_SCHEMA_DRAFT_2020_12,
                "$defs": {**defs, **comp_schema.get("$defs", {})},
                **{k: v for k, v in comp_schema.items() if k != "$defs"},
            }

            try:
                self._validators[name] = Draft202012Validator(full_schema)
            except Exception as e:
                # Fallback if schema initialization fails
                pass

        theme_schema = base_schema.get("properties", {}).get("theme")
        if theme_schema:
            full_theme_schema = {
                "$schema": JSON_SCHEMA_DRAFT_2020_12,
                "$defs": defs,
                **theme_schema,
            }
            try:
                self._theme_validator = Draft202012Validator(full_theme_schema)
            except Exception:
                pass

    def validate_components(
        self,
        components: List[Dict[str, Any]],
        config: Optional[ValidationConfig] = None,
    ) -> None:
        """Validates a list of component data dictionaries against their catalog schema definitions."""
        active_config = config if config is not None else self.config
        allow_unknown = active_config.allow_unknown_elements if active_config else False

        errors = []
        for comp in components:
            if not isinstance(comp, dict):
                errors.append(
                    A2uiErrorDetail(
                        path="components",
                        code="type_mismatch",
                        message="Component must be an object",
                    )
                )
                continue

            comp_id = comp.get("id")
            comp_type = comp.get("component")

            if not comp_id or not isinstance(comp_id, str):
                errors.append(
                    A2uiErrorDetail(
                        path="components.id",
                        code="missing_field",
                        message="Component must have a string 'id'",
                    )
                )
            if not comp_type or not isinstance(comp_type, str):
                errors.append(
                    A2uiErrorDetail(
                        path=f"components.{comp_id or 'unknown'}.component",
                        code="missing_field",
                        message="Component must have a string 'component' type",
                    )
                )
                continue

            validator = self._validators.get(comp_type)
            if not validator:
                if not allow_unknown and self._validators:
                    errors.append(
                        A2uiErrorDetail(
                            path=f"components.{comp_id}.component",
                            code="unrecognized_component",
                            message=f"Unrecognized component type '{comp_type}'",
                        )
                    )
                continue

            props = dict(comp)
            if comp_id is not None and "id" not in props:
                props["id"] = comp_id
            if not _schema_has_property(validator.schema, "id"):
                props.pop("id", None)
            if not _schema_has_property(validator.schema, "component"):
                props.pop("component", None)
            schema_errors = sorted(validator.iter_errors(props), key=lambda e: e.path)
            for err in schema_errors:
                err_code = self._map_json_schema_error_code(err.validator)
                if allow_unknown and err_code == "extra_field":
                    continue
                path_str = ".".join(str(p) for p in err.path)
                errors.append(
                    A2uiErrorDetail(
                        path=f"components.{comp_id}.{path_str}"
                        if path_str
                        else f"components.{comp_id}",
                        code=err_code,
                        message=err.message,
                    )
                )

        if errors:
            summary = "\n".join(f"{e.path}: {e.message}" for e in errors)
            raise A2uiValidationError(summary, details=errors)

    def validate_function(
        self,
        name: str,
        args: Dict[str, Any],
        config: Optional[ValidationConfig] = None,
    ) -> None:
        """Validates function call parameters against catalog function schema definitions."""
        active_config = config if config is not None else self.config
        allow_unknown = active_config.allow_unknown_elements if active_config else False

        fn_def = None
        if hasattr(self.catalog, "functions") and isinstance(
            self.catalog.functions, dict
        ):
            fn_def = self.catalog.functions.get(name)

        base_schema = getattr(self.catalog, "catalog_schema", {}) or {}
        funcs_schema = base_schema.get("functions", {})
        fn_schema = funcs_schema.get(name) if isinstance(funcs_schema, dict) else None

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

        param_schema = None
        defs = base_schema.get("$defs", {})
        if isinstance(fn_schema, dict):
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
                    param_schema["additionalProperties"] = fn_schema[
                        "additionalProperties"
                    ]
            elif "properties" in fn_schema and isinstance(
                fn_schema["properties"], dict
            ):
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

    def validate_theme(self, theme: Dict[str, Any]) -> None:
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
        if self._theme_validator:
            schema_errors = sorted(
                self._theme_validator.iter_errors(theme), key=lambda e: e.path
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

    def _map_json_schema_error_code(self, validator_name: str) -> str:
        if validator_name in ("required", "minProperties"):
            return "missing_field"
        if validator_name in ("additionalProperties", "unevaluatedProperties"):
            return "extra_field"
        if validator_name in ("type", "format", "pattern", "enum"):
            return "type_mismatch"
        return "invalid_value"

    @classmethod
    def from_catalog(
        cls,
        catalog: Any,
        common_types_schema: Optional[Dict[str, Any]] = None,
        config: Optional[ValidationConfig] = None,
    ) -> "CatalogSchemaValidator":
        if isinstance(catalog, CatalogSchemaValidator):
            if config is not None and catalog.config != config:
                catalog.config = config
            return catalog
        return cls(catalog, common_types_schema=common_types_schema, config=config)
