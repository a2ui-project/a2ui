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

from typing import (
    Any,
    Final,
    Generic,
    Type,
    cast,
)

import copy
from pydantic import BaseModel, ConfigDict, ValidationError
from jsonschema import Draft202012Validator
import jsonschema.exceptions
import referencing.exceptions
from ..exceptions import A2uiValidationError, A2uiErrorDetail, A2uiCatalogError
from ..catalog.catalog import Catalog, TComponent, TFunction
from ..processing.format_pydantic_error import format_validation_error
from ..schema import ProtocolVersion
from ..common.semver import is_at_least_version


class ValidationConfig(BaseModel):
    """Configuration options for A2UI payload and component validation."""

    model_config = ConfigDict(frozen=True)

    allow_orphan_components: bool = False
    allow_dangling_references: bool = False
    allow_missing_root: bool = False
    allow_unknown_elements: bool = False
    allowed_messages: list[str] | None = None
    max_depth: int | None = None


# Presets for validation configuration
STRICT_VALIDATION = ValidationConfig()
RELAXED_VALIDATION = ValidationConfig(
    allow_orphan_components=True,
    allow_dangling_references=True,
    allow_missing_root=True,
    allow_unknown_elements=True,
)

MAX_FUNCTION_CALL_ARGS: Final[int] = 1_000

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

    def validate_component(
        self,
        comp: dict[str, Any],
    ) -> None:
        """Validates a single component dictionary payload against the catalog schema.

        Raises:
            A2uiValidationError: If the component fails validation against catalog schemas.
            A2uiCatalogError: If no schema is defined for the component type in the catalog.
        """
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
            raise A2uiValidationError("Component must be an object", details=errors)

        comp_id = comp.get("id")
        comp_type = comp.get("component")

        if comp_id and isinstance(comp_id, str):
            from ..catalog.catalog import is_valid_uax31_identifier

            ver = getattr(self.catalog, "protocol_version", None)
            if (
                ver
                and is_at_least_version(ver, ProtocolVersion.V1_0)
                and not is_valid_uax31_identifier(comp_id)
            ):
                errors.append(
                    A2uiErrorDetail(
                        path=f"components.{comp_id}.id",
                        code="invalid_identifier",
                        message=(
                            f"Component id '{comp_id}' must be a valid UAX #31"
                            " identifier"
                        ),
                    )
                )

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
            if errors:
                summary = "\n".join(
                    f"{detail.path}: {detail.message}" for detail in errors
                )
                raise A2uiValidationError(summary, details=errors)
            return

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
        if errors:
            summary = "\n".join(f"{detail.path}: {detail.message}" for detail in errors)
            raise A2uiValidationError(summary, details=errors)

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
            component_errors = format_validation_error(
                e,
                path_prefix=f"components.{comp_id or 'unknown'}",
                allow_unknown_extra=allow_unknown,
                match_jsonschema_missing_path=True,
            )
            errors.extend(component_errors)

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
        if isinstance(base_schema, dict):
            if "functions" in base_schema and "functions" not in full_schema:
                full_schema["functions"] = base_schema["functions"]
            if "components" in base_schema and "components" not in full_schema:
                full_schema["components"] = base_schema["components"]
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
        except referencing.exceptions.Unresolvable as ref_err:
            errors.append(
                A2uiErrorDetail(
                    path=f"components.{comp_id or 'unknown'}",
                    code="invalid_reference",
                    message=str(ref_err),
                )
            )

    def _validate_nested_functions(
        self,
        comp_id: str,
        val: Any,
        path: str,
        errors: list[A2uiErrorDetail],
    ) -> None:
        """Recursively validates nested function calls declared by this catalog.

        A call that names a different `catalogId` is skipped here: this validator
        is scoped to a single catalog, and the call is checked at resolution time
        against the catalog that actually runs it.
        """
        if isinstance(val, dict):
            fn_name = val.get("call") or val.get("function")
            cat_id = val.get("catalogId")
            targets_this_catalog = not cat_id or cat_id == getattr(
                self.catalog, "catalog_id", None
            )
            if fn_name and isinstance(fn_name, str):
                fn_args = val.get("args")
                if targets_this_catalog:
                    try:
                        self.validate_function(fn_name, fn_args)
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
                else:
                    try:
                        self._validate_function_identifiers(fn_name, fn_args)
                    except A2uiValidationError as e:
                        if e.details:
                            errors.extend(e.details)
                        else:
                            errors.append(
                                A2uiErrorDetail(
                                    path=f"components.{comp_id}.{path}"
                                    if path
                                    else f"components.{comp_id}",
                                    code="invalid_identifier",
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

    def _validate_function_identifiers(self, name: str, args: Any) -> None:
        """Validates function name and argument identifiers against UAX #31 for v1.0+."""
        from ..catalog.catalog import is_valid_uax31_identifier

        ver = getattr(self.catalog, "protocol_version", None)
        if not (ver and is_at_least_version(ver, ProtocolVersion.V1_0)):
            return

        if not is_valid_uax31_identifier(name):
            raise A2uiValidationError(
                f"Function name '{name}' must be a valid UAX #31 identifier",
                details=[
                    A2uiErrorDetail(
                        path=f"functions.{name}",
                        code="invalid_identifier",
                        message=(
                            f"Function name '{name}' must be a valid UAX #31 identifier"
                        ),
                    )
                ],
            )
        if isinstance(args, dict):
            for arg_name in args:
                if not isinstance(arg_name, str) or not is_valid_uax31_identifier(
                    arg_name
                ):
                    raise A2uiValidationError(
                        f"Function argument '{arg_name}' in function '{name}' must"
                        " be a valid UAX #31 identifier",
                        details=[
                            A2uiErrorDetail(
                                path=f"functions.{name}.{arg_name}",
                                code="invalid_identifier",
                                message=(
                                    f"Function argument '{arg_name}' in function"
                                    f" '{name}' must be a valid UAX #31 identifier"
                                ),
                            )
                        ],
                    )

    def validate_function(
        self,
        name: str,
        args: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Validates function call parameters against catalog function schema definitions."""
        active_config = self.config
        allow_unknown = active_config.allow_unknown_elements if active_config else False

        if args is None:
            norm_args: dict[str, Any] = {}
        elif isinstance(args, dict):
            norm_args = dict(args)
        else:
            raise A2uiValidationError(
                f"Function arguments for '{name}' must be an object/dictionary",
                details=[
                    A2uiErrorDetail(
                        path=f"functions.{name}",
                        code="type_mismatch",
                        message=(
                            f"Function arguments for '{name}' must be an"
                            " object/dictionary"
                        ),
                    )
                ],
            )

        self._validate_function_identifiers(name, norm_args)

        if len(norm_args) > MAX_FUNCTION_CALL_ARGS:
            raise A2uiValidationError(
                f"Function call '{name}' exceeds maximum allowed arguments count"
                f" ({MAX_FUNCTION_CALL_ARGS})",
                details=[
                    A2uiErrorDetail(
                        path=f"functions.{name}",
                        code="too_many_arguments",
                        message=(
                            f"Function call '{name}' exceeds maximum allowed"
                            f" arguments count ({MAX_FUNCTION_CALL_ARGS})"
                        ),
                    )
                ],
            )

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
            return dict(norm_args)

        model_cls = (
            getattr(fn_def, "schema", None)
            or getattr(fn_def, "model_class", None)
            or getattr(fn_def, "parameters", None)
            if fn_def is not None
            else None
        )
        if isinstance(model_cls, type) and issubclass(model_cls, BaseModel):
            return self._validate_model_function(model_cls, name, norm_args)
        elif isinstance(fn_schema, dict):
            return self._validate_dict_function(
                fn_schema, base_schema, name, norm_args, allow_unknown
            )
        return dict(norm_args)

    def _find_function_definition(
        self,
        name: str,
    ) -> tuple[Any | None, dict[str, Any] | None, dict[str, Any]]:
        """Finds function definition, schema, and base catalog schema in the registered catalog."""
        fn_def: Any = None
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
        if fn_def is None and name.startswith("@"):
            ver = getattr(self.catalog, "protocol_version", None)
            if (
                name == "@index"
                and ver
                and is_at_least_version(ver, ProtocolVersion.V1_0)
            ):
                from ..basic_catalog.v1_0.function_impls import IndexImplementation

                fn_def = IndexImplementation
        return fn_def, fn_schema, base_schema

    def _validate_model_function(
        self,
        model_cls: Type[BaseModel],
        name: str,
        args: dict[str, Any],
    ) -> dict[str, Any]:
        """Validates function arguments against a Pydantic BaseModel schema."""
        try:
            validated = model_cls.model_validate(args or {})
            return validated.model_dump(by_alias=True)
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
            summary = "\n".join(f"{e.path}: {e.message}" for e in fn_errors)
            raise A2uiValidationError(summary, details=fn_errors)

    def _extract_schema_defs(
        self,
        fn_schema: dict[str, Any],
        base_schema: dict[str, Any],
    ) -> dict[str, Any]:
        """Combines $defs from base catalog schema and function schema."""
        base_defs = (
            base_schema.get("$defs", {}) if isinstance(base_schema, dict) else {}
        )
        fn_defs = fn_schema.get("$defs", {}) if isinstance(fn_schema, dict) else {}
        return {**base_defs, **fn_defs}

    def _extract_raw_param_schema(
        self,
        fn_schema: dict[str, Any],
        defs: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Derives the parameter sub-schema from standard or legacy function definitions."""
        if "parameters" in fn_schema and isinstance(fn_schema["parameters"], dict):
            schema: dict[str, Any] = {
                "$schema": JSON_SCHEMA_DRAFT_2020_12,
                "$defs": defs,
                "type": "object",
                "properties": fn_schema["parameters"],
            }
            if "required" in fn_schema and isinstance(fn_schema["required"], list):
                schema["required"] = fn_schema["required"]
            if "additionalProperties" in fn_schema:
                schema["additionalProperties"] = fn_schema["additionalProperties"]
            return schema

        props = fn_schema.get("properties")
        if isinstance(props, dict):
            if "args" in props and isinstance(props["args"], dict):
                return {
                    "$schema": JSON_SCHEMA_DRAFT_2020_12,
                    "$defs": defs,
                    **props["args"],
                }
            return {
                "$schema": JSON_SCHEMA_DRAFT_2020_12,
                "$defs": defs,
                "type": "object",
                **fn_schema,
            }

        return None

    def _attach_catalog_context(
        self,
        param_schema: dict[str, Any] | None,
        base_schema: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Injects root catalog functions and components for self-referential schemas."""
        if not param_schema or not isinstance(base_schema, dict):
            return param_schema

        for key in ("functions", "components"):
            if key in base_schema and key not in param_schema:
                param_schema[key] = base_schema[key]

        return param_schema

    def _build_param_schema(
        self,
        fn_schema: dict[str, Any],
        base_schema: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Constructs a JSON Schema object for function parameter validation."""
        defs = self._extract_schema_defs(fn_schema, base_schema)
        raw_schema = self._extract_raw_param_schema(fn_schema, defs)
        return self._attach_catalog_context(raw_schema, base_schema)

    def _validate_dict_function(
        self,
        fn_schema: dict[str, Any],
        base_schema: dict[str, Any],
        name: str,
        args: dict[str, Any],
        allow_unknown: bool,
    ) -> dict[str, Any]:
        """Validates function arguments against a JSON Schema dict definition."""
        param_schema = self._build_param_schema(fn_schema, base_schema)
        validated_args = dict(args or {})
        if not param_schema:
            return validated_args

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
                summary = "\n".join(
                    f"{detail.path}: {detail.message}" for detail in errors
                )
                raise A2uiValidationError(summary, details=errors)
        except A2uiValidationError:
            raise
        except referencing.exceptions.Unresolvable as ref_err:
            detail = A2uiErrorDetail(
                path=f"functions.{name}",
                code="invalid_reference",
                message=str(ref_err),
            )
            raise A2uiValidationError(str(ref_err), details=[detail]) from ref_err

        if isinstance(param_schema.get("properties"), dict):
            for prop_name, prop_spec in param_schema["properties"].items():
                if (
                    isinstance(prop_spec, dict)
                    and "default" in prop_spec
                    and prop_name not in validated_args
                ):
                    validated_args[prop_name] = copy.deepcopy(prop_spec["default"])

        return validated_args

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
            if isinstance(base_schema, dict):
                if "functions" in base_schema and "functions" not in full_theme_schema:
                    full_theme_schema["functions"] = base_schema["functions"]
                if (
                    "components" in base_schema
                    and "components" not in full_theme_schema
                ):
                    full_theme_schema["components"] = base_schema["components"]
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
                    summary = "\n".join(
                        f"{detail.path}: {detail.message}" for detail in details
                    )
                    raise A2uiValidationError(summary, details=details)
            except A2uiValidationError:
                raise
            except referencing.exceptions.Unresolvable as ref_err:
                detail = A2uiErrorDetail(
                    path="theme",
                    code="invalid_reference",
                    message=str(ref_err),
                )
                raise A2uiValidationError(str(ref_err), details=[detail]) from ref_err

    def _map_json_schema_error_code(self, validator_name: str) -> str:
        if validator_name in ("required", "minProperties"):
            return "missing_field"
        if validator_name in ("additionalProperties", "unevaluatedProperties"):
            return "extra_field"
        if validator_name in ("type", "format", "pattern", "enum"):
            return "type_mismatch"
        return "invalid_value"
