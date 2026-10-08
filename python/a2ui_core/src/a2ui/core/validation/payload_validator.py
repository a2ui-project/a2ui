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

from __future__ import annotations

from collections.abc import Callable
import copy
import functools
from typing import (
    Any,
    Final,
    Type,
)

import jsonschema.exceptions
from pydantic import BaseModel, ConfigDict, ValidationError
import referencing.exceptions

from ..catalog import Catalog, is_system_function_name, system_functions_for
from ..catalog.catalog import CatalogApi
from ..common.semver import is_at_least_version, to_protocol_version
from ..common.uax31 import is_valid_uax31_identifier
from ..exceptions import A2uiCatalogError, A2uiErrorDetail, A2uiValidationError
from ..processing.format_pydantic_error import format_validation_error
from ..schema import ProtocolVersion
from ..schema.common_types_schema import get_common_types_catalog_defs
from .schema_validator import SchemaValidator


class ValidationConfig(BaseModel):
    """Configuration options for A2UI payload and component validation."""

    model_config = ConfigDict(frozen=True)

    root_id: str = "root"
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


def _is_unknown_property_error(err: jsonschema.exceptions.ValidationError) -> bool:
    """Returns whether a schema error reports an unknown property.

    Those are the errors that `allow_unknown_elements` tolerates. A key
    rejected by `patternProperties` (e.g. an `Extensions` key that is not a
    UAX #31 identifier) breaks a key format rather than naming an unknown
    property, so it is not one of them.
    """
    if err.validator not in ("additionalProperties", "unevaluatedProperties"):
        return False
    return not (isinstance(err.schema, dict) and "patternProperties" in err.schema)


# Component keys that belong to the component message rather than to the
# component's own properties.
_BASE_COMPONENT_ENVELOPE_KEYS: Final[tuple[str, ...]] = ("id", "component")
# From v1.0 the spec's `ComponentCommon` also lets every component name its
# catalog and carry extension metadata.
_V10_COMPONENT_ENVELOPE_KEYS: Final[tuple[str, ...]] = (
    *_BASE_COMPONENT_ENVELOPE_KEYS,
    "catalogId",
    "metadata",
)


def _component_envelope_keys(protocol_version: Any) -> tuple[str, ...]:
    """Returns the component envelope keys of a protocol version.

    A component schema that doesn't declare an envelope key is validated
    without it.
    """
    if protocol_version and is_at_least_version(protocol_version, ProtocolVersion.V1_0):
        return _V10_COMPONENT_ENVELOPE_KEYS
    return _BASE_COMPONENT_ENVELOPE_KEYS


@functools.cache
def _function_call_envelope(protocol_version: ProtocolVersion) -> dict[str, Any]:
    """Returns the envelope-only `FunctionCall` def of a protocol version.

    It checks `@call`, `args` and `catalogId` and rejects other keys, but not
    which function is called or its args.
    """
    envelope: dict[str, Any] = get_common_types_catalog_defs(protocol_version)[
        "FunctionCall"
    ]
    return envelope


def rebase_function_error_details(
    error: A2uiValidationError,
    fn_name: str,
    call_path: str,
    fallback_code: str = "invalid_function_call",
) -> list[A2uiErrorDetail]:
    """Moves the details of a function call error to the call's location.

    `PayloadValidator.validate_function` reports paths relative to the
    function, as `functions.<name>` or `functions.<name>.<arg>...`. For a call
    held in a component, those become `<call_path>` and
    `<call_path>.args.<arg>...`, so the error says which component and
    property hold the call.

    Args:
        error: The error raised for the call.
        fn_name: The name of the called function.
        call_path: The call's location, e.g. `components.t1.text`.
        fallback_code: The code to use if the error has no details.

    Returns:
        The rebased error details.
    """
    fn_prefix = f"functions.{fn_name}"
    details = error.details or [
        A2uiErrorDetail(path=fn_prefix, code=fallback_code, message=str(error))
    ]
    rebased: list[A2uiErrorDetail] = []
    for detail in details:
        if detail.path == fn_prefix:
            detail_path = call_path
        elif detail.path.startswith(f"{fn_prefix}."):
            detail_path = f"{call_path}.args{detail.path[len(fn_prefix):]}"
        else:
            detail_path = f"{call_path}.{detail.path}"
        rebased.append(
            A2uiErrorDetail(path=detail_path, code=detail.code, message=detail.message)
        )
    return rebased


def nested_call_runs_in_catalog(
    call_catalog_id: Any, catalog_id: str | None, *, catalog_is_default: bool
) -> bool:
    """Returns whether a v1.0 nested call runs in a component's catalog.

    A call runs in the catalog it names, or else in the surface default
    catalog. So a call that names none runs in the component's catalog only
    when that catalog is the surface default.

    Args:
        call_catalog_id: The `catalogId` the call names, or None.
        catalog_id: The ID of the component's catalog.
        catalog_is_default: Whether the component's catalog is the surface
            default catalog.
    """
    if call_catalog_id is None:
        return catalog_is_default
    return bool(call_catalog_id == catalog_id)


class PayloadValidator:
    """Validates A2UI payloads against catalog JSON schema definitions."""

    def __init__(
        self,
        catalog: CatalogApi,
        config: ValidationConfig | None = None,
    ) -> None:
        """Initializes the validator.

        Args:
            catalog: The catalog that defines the components being validated.
            config: Optional validation settings.
        """
        self.catalog: CatalogApi = catalog
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

        self._validate_nested_functions(
            comp_id or "unknown", comp.get("catalogId"), comp, "", errors
        )
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
        """Validates a component payload against a Pydantic BaseModel schema.

        From v1.0, the `catalogId` and `metadata` envelope keys are left out
        when the model has no field for them. `id` and `component` are passed
        through as before.
        """
        props = dict(comp)
        ver = getattr(self.catalog, "protocol_version", None)
        declared: set[str] = set()
        for field_name, field in model_cls.model_fields.items():
            declared.add(field_name)
            if field.alias:
                declared.add(field.alias)
            if isinstance(field.validation_alias, str):
                declared.add(field.validation_alias)
        self._strip_envelope_keys(
            props,
            tuple(
                k
                for k in _component_envelope_keys(ver)
                if k not in _BASE_COMPONENT_ENVELOPE_KEYS
            ),
            lambda key: key in declared,
            comp_id,
            errors,
        )
        try:
            model_cls.model_validate(props)
        except ValidationError as e:
            component_errors = format_validation_error(
                e,
                path_prefix=f"components.{comp_id or 'unknown'}",
                allow_unknown_extra=allow_unknown,
                match_jsonschema_missing_path=True,
            )
            errors.extend(component_errors)

    @staticmethod
    def _strip_envelope_keys(
        props: dict[str, Any],
        keys: tuple[str, ...],
        is_declared: Callable[[str], bool],
        comp_id: str | None,
        errors: list[A2uiErrorDetail],
    ) -> None:
        """Removes the envelope keys a component schema doesn't declare.

        Envelope keys (see `_component_envelope_keys`) belong to the component
        message, not to the component's own properties, so a schema that
        doesn't declare one must not see it. A `catalogId` that is removed is
        still checked to be a string, since the schema can't check it.

        Args:
            props: The component's keys, modified in place.
            keys: The envelope keys to consider.
            is_declared: Returns whether the schema declares or requires a key.
            comp_id: The ID of the component being validated.
            errors: Collects the errors found.
        """
        for key in keys:
            if key not in props or is_declared(key):
                continue
            value = props.pop(key)
            if key == "catalogId" and not isinstance(value, str):
                errors.append(
                    A2uiErrorDetail(
                        path=f"components.{comp_id or 'unknown'}.catalogId",
                        code="type_mismatch",
                        message="'catalogId' must be a string",
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
        if isinstance(base_schema, dict):
            if "functions" in base_schema and "functions" not in full_schema:
                full_schema["functions"] = base_schema["functions"]
            if "components" in base_schema and "components" not in full_schema:
                full_schema["components"] = base_schema["components"]
        ver = getattr(self.catalog, "protocol_version", None)
        if ver and is_at_least_version(ver, ProtocolVersion.V1_0):
            # The published v1.0 `FunctionCall` ties a call's function and args
            # to this catalog's functions, whatever catalog the call names. A
            # call runs in the catalog it names, or else the surface default,
            # so only its envelope is checked here; `_validate_nested_functions`
            # (and `MessageProcessor`) check it against the right catalog.
            full_schema["$defs"]["FunctionCall"] = _function_call_envelope(
                to_protocol_version(ver)
            )
        try:
            validator = SchemaValidator(full_schema)
            props = dict(comp)
            req_fields = (
                validator.schema.get("required", [])
                if isinstance(validator.schema, dict)
                else []
            )
            self._strip_envelope_keys(
                props,
                _component_envelope_keys(ver),
                lambda key: _schema_has_property(validator.schema, key)
                or key in req_fields,
                comp_id,
                errors,
            )
            schema_errors = sorted(validator.iter_errors(props), key=lambda e: e.path)
            for err in schema_errors:
                err_code = self._map_json_schema_error_code(err.validator)
                if allow_unknown and _is_unknown_property_error(err):
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
        comp_catalog_id: Any,
        val: Any,
        path: str,
        errors: list[A2uiErrorDetail],
    ) -> None:
        """Recursively validates nested function calls.

        From v1.0, a call to a reserved `@` system function (such as `@index`)
        belongs to no catalog: it must not name a `catalogId`, and it is
        checked against the system function definition. Any other call is
        fully checked against this catalog when it runs here (see
        `nested_call_runs_in_catalog`): when it names this catalog, or names no
        `catalogId` in a component that names none either. A component with
        no `catalogId` is taken to be in the surface default catalog, where
        calls that name none run. Otherwise the call runs in a catalog this
        validator can't see, so only its function and argument identifiers are
        checked; `MessageProcessor` resolves such a call's catalog and checks
        it there. An empty `catalogId` names a catalog too, and a non-string
        `catalogId` is a type error.

        Before v1.0, a call's `catalogId` is ignored, as it is at runtime, and
        every call is checked against this catalog.

        Errors are reported at the call's location in the component, e.g.
        `components.t1.text.args.value`.

        Args:
            comp_id: The ID of the component being validated.
            comp_catalog_id: The `catalogId` the component names, or None.
            val: The value to walk.
            path: The value's path in the component.
            errors: Collects the errors found.
        """
        ver = getattr(self.catalog, "protocol_version", None)
        at_least_v10 = bool(ver and is_at_least_version(ver, ProtocolVersion.V1_0))
        if isinstance(val, dict):
            call_path = (
                f"components.{comp_id}.{path}" if path else f"components.{comp_id}"
            )
            if at_least_v10:
                from ..resolution.data_context import validate_reserved_directives

                try:
                    validate_reserved_directives(val.keys(), ver)
                except A2uiValidationError as e:
                    errors.append(
                        A2uiErrorDetail(
                            path=call_path,
                            code=getattr(e, "code", "INVALID_RESERVED_KEY"),
                            message=str(e),
                        )
                    )
                fn_name = val.get("@call")
            else:
                fn_name = val.get("call") or val.get("function")
            # From v1.0 any string name is checked, so an empty one is
            # reported as an invalid identifier rather than skipped.
            if isinstance(fn_name, str) and (at_least_v10 or fn_name):
                self._validate_nested_call(
                    fn_name, val, call_path, comp_catalog_id, at_least_v10, ver, errors
                )
            for k, v in val.items():
                if k not in ("id", "component"):
                    child_path = f"{path}.{k}" if path else k
                    self._validate_nested_functions(
                        comp_id, comp_catalog_id, v, child_path, errors
                    )
        elif isinstance(val, list):
            for idx, item in enumerate(val):
                child_path = f"{path}.{idx}"
                self._validate_nested_functions(
                    comp_id, comp_catalog_id, item, child_path, errors
                )

    def _validate_nested_call(
        self,
        fn_name: str,
        call: dict[str, Any],
        call_path: str,
        comp_catalog_id: Any,
        at_least_v10: bool,
        protocol_version: Any,
        errors: list[A2uiErrorDetail],
    ) -> None:
        """Validates one nested call; see `_validate_nested_functions`."""
        fn_args = call.get("args")
        if at_least_v10 and is_system_function_name(fn_name):
            if "catalogId" in call:
                errors.append(
                    A2uiErrorDetail(
                        path=f"{call_path}.catalogId",
                        code="extra_field",
                        message=(
                            f"System function '{fn_name}' belongs to no catalog and"
                            " must not name a catalogId"
                        ),
                    )
                )
            self._validate_system_function(
                fn_name, fn_args, protocol_version, call_path, errors
            )
            return

        if at_least_v10:
            cat_id = call.get("catalogId")
            if cat_id is not None and not isinstance(cat_id, str):
                errors.append(
                    A2uiErrorDetail(
                        path=f"{call_path}.catalogId",
                        code="type_mismatch",
                        message="'catalogId' must be a string",
                    )
                )
                full_check = False
            else:
                full_check = nested_call_runs_in_catalog(
                    cat_id,
                    getattr(self.catalog, "catalog_id", None),
                    catalog_is_default=comp_catalog_id is None,
                )
        else:
            # Before v1.0 a call's catalogId is ignored: the call runs in the
            # surface catalog, so it is checked against this catalog.
            full_check = True

        try:
            if full_check:
                self.validate_function(fn_name, fn_args)
            else:
                self._validate_function_identifiers(fn_name, fn_args)
        except A2uiValidationError as e:
            errors.extend(
                rebase_function_error_details(
                    e,
                    fn_name,
                    call_path,
                    "invalid_function_call" if full_check else "invalid_identifier",
                )
            )

    def _validate_system_function(
        self,
        fn_name: str,
        fn_args: Any,
        protocol_version: Any,
        call_path: str,
        errors: list[A2uiErrorDetail],
    ) -> None:
        """Validates a v1.0 call to a reserved `@` system function.

        A system function belongs to no catalog, so the call is checked against
        the system function definition and never goes through catalog
        resolution. Its args are still walked by the caller.
        """
        try:
            validate_system_function(
                fn_name, fn_args, protocol_version, config=self.config
            )
        except A2uiValidationError as e:
            errors.extend(
                rebase_function_error_details(
                    e, fn_name, call_path, "invalid_function_call"
                )
            )

    def _validate_function_identifiers(self, name: str, args: Any) -> None:
        """Validates function name and argument identifiers against UAX #31 for v1.0+."""
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

        self._validate_function_identifiers(name, norm_args)

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
            fn_def = system_functions_for(ver).get(name)
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
            fn_validator = SchemaValidator(param_schema)
            schema_errors = sorted(
                fn_validator.iter_errors(args or {}), key=lambda e: e.path
            )
            errors = []
            for err in schema_errors:
                err_code = self._map_json_schema_error_code(err.validator)
                if allow_unknown and _is_unknown_property_error(err):
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
                theme_validator = SchemaValidator(full_theme_schema)
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


def validate_system_function(
    name: str,
    args: dict[str, Any] | None,
    protocol_version: ProtocolVersion | str,
    config: ValidationConfig | None = None,
) -> dict[str, Any]:
    """Validates a call to a reserved `@` system function, such as `@index`.

    A system function belongs to no catalog and is available across all of
    them, so the call is checked against the system function definition of
    `protocol_version` rather than against a resolved catalog.

    Raises:
        A2uiValidationError: If the function is unknown to the protocol
            version or its arguments are invalid.
    """
    # An empty catalog declares no functions, so the lookup falls through to
    # the system functions of its protocol version.
    no_catalog = Catalog(catalog_id="", protocol_version=protocol_version)
    return PayloadValidator(no_catalog, config=config).validate_function(name, args)
