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

from collections.abc import Callable, Mapping
import copy
import functools
import re
from typing import (
    Any,
    Final,
    Type,
)

import jsonschema.exceptions
from pydantic import BaseModel, ConfigDict, ValidationError
import referencing.exceptions

from ..catalog import (
    Catalog,
    get_custom_envelope_properties,
    get_declared_component_properties,
    is_component_checkable,
    is_system_function_name,
    system_functions_for,
)
from ..catalog.catalog import CatalogApi
from ..common.metadata import validate_metadata
from ..common.semver import is_at_least_version, to_protocol_version
from ..common.uax31 import is_valid_uax31_identifier
from ..exceptions import A2uiCatalogError, A2uiErrorDetail, A2uiValidationError
from ..processing.format_pydantic_error import format_validation_error, to_json_pointer
from ..schema import ProtocolVersion
from ..schema.common_types_schema import get_common_types_catalog_defs
from ..schema.v1_0 import common_types as v1_0_common_types
from .schema_validator import SchemaValidator


class ValidationConfig(BaseModel):
    """Configuration options for A2UI payload and component validation."""

    model_config = ConfigDict(frozen=True)

    root_id: str = "root"
    allow_orphan_components: bool = False
    allow_dangling_references: bool = False
    allow_missing_root: bool = False
    # Whether to allow components and functions that the resolved catalog does
    # not define. A renderer that uses agent-side functions must either set
    # this or declare those functions, without implementations, in the catalog
    # the calls resolve to. Otherwise validation rejects the calls before they
    # can be routed to the agent with `callAgentFunction`.
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
    # A schema can combine several combiners (e.g. `allOf` and `oneOf`), so
    # every branch of each is checked.
    return any(
        _schema_has_property(sub, prop_name)
        for combiner in ("allOf", "anyOf", "oneOf")
        if isinstance(schema.get(combiner), list)
        for sub in schema[combiner]
    )


def _is_unknown_property_error(
    err: jsonschema.exceptions.ValidationError,
) -> bool:
    """Returns whether a schema error reports an unknown property.

    Those are the errors that `allow_unknown_elements` tolerates. A key
    rejected by `patternProperties` (e.g. an `Extensions` key that is not a
    UAX #31 identifier) breaks a key format rather than naming an unknown
    property, so it is not one of them.
    """
    if err.validator not in ("additionalProperties", "unevaluatedProperties"):
        return False
    return not (isinstance(err.schema, dict) and "patternProperties" in err.schema)


def _resolved_entry_schema(catalog: Any, kind: str, entry: Any) -> Any:
    """Returns an entry's schema with the catalog's local references resolved.

    A catalog keeps each authored schema as its document writes it, with
    references to its own `$defs` and to other specification documents;
    `Catalog.resolved_component_schema` and `resolved_function_schema` resolve
    them. Other catalogs give the entry's schema as it is.

    Args:
        catalog: The catalog that defines the entry.
        kind: `"component"` or `"function"`.
        entry: The component or function.
    """
    resolve = getattr(catalog, f"resolved_{kind}_schema", None)
    name = getattr(entry, "name", None)
    if callable(resolve) and isinstance(name, str):
        resolved = resolve(name)
        if isinstance(resolved, dict):
            return resolved
    return entry.schema


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
def _function_call_envelope(
    protocol_version: ProtocolVersion,
) -> dict[str, Any]:
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


def _non_object_args_error(name: str) -> A2uiValidationError:
    """Returns the error for a call whose `args` is not an object."""
    message = f"Function arguments for '{name}' must be an object/dictionary"
    return A2uiValidationError(
        message,
        details=[
            A2uiErrorDetail(
                path=f"functions.{name}", code="type_mismatch", message=message
            )
        ],
    )


def check_renderer_may_call(catalog: CatalogApi, name: str) -> None:
    """Raises if the renderer may not call a catalog function itself.

    A call held in a component (a property binding, a check or an action) is
    made by the renderer. A function whose `allowedCallers` is `agentOnly`
    runs only for an agent's `callRendererFunction`, so it can't be bound
    into a component. `DataContext` refuses such a call when it is evaluated,
    with the same message.

    `allowedCallers` is a v1.0 feature, so a catalog before v1.0 restricts
    no binding.

    Args:
        catalog: The catalog the call runs in.
        name: The called function.

    Raises:
        A2uiValidationError: If the v1.0+ catalog declares the function
            `agentOnly`. Its detail is at `functions.<name>`, which
            `rebase_function_error_details` moves to the call's location.
    """
    ver = getattr(catalog, "protocol_version", None)
    if not (ver and is_at_least_version(ver, ProtocolVersion.V1_0)):
        return
    if hasattr(catalog, "get_function"):
        fn = catalog.get_function(name)
    else:
        fn = getattr(catalog, "functions", {}).get(name)
    if getattr(fn, "allowed_callers", None) != "agentOnly":
        return
    message = (
        f"Function '{name}' cannot be called by renderer (allowedCallers is agentOnly)."
    )
    raise A2uiValidationError(
        message,
        details=[
            A2uiErrorDetail(
                path=f"functions.{name}",
                code="invalid_function_call",
                message=message,
            )
        ],
    )


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
        *,
        component_index: int | None = None,
        surface_id: str | None = None,
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
                    surface_id=surface_id,
                )
            )
            raise A2uiValidationError(
                "Component must be an object",
                details=errors,
                path="/components",
                surface_id=surface_id,
            )

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
                        surface_id=surface_id,
                    )
                )

        if comp_type and isinstance(comp_type, str):
            ver = getattr(self.catalog, "protocol_version", None)
            if (
                ver
                and is_at_least_version(ver, ProtocolVersion.V1_0)
                and not is_valid_uax31_identifier(comp_type)
            ):
                errors.append(
                    A2uiErrorDetail(
                        path=f"components.{comp_id}.component",
                        code="invalid_identifier",
                        message=(
                            f"Component type '{comp_type}' must be a valid UAX"
                            " #31 identifier"
                        ),
                        surface_id=surface_id,
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
            cat_schema = getattr(target_cat, "validation_schema", {}) or {}
            comps_dict = (
                cat_schema.get("components", {}) if isinstance(cat_schema, dict) else {}
            )
            if isinstance(comps_dict, dict) and comp_type in comps_dict:
                c = comps_dict[comp_type]

        if c is not None:
            target_comp = c

        ver = getattr(self.catalog, "protocol_version", None)
        at_least_v10 = bool(ver and is_at_least_version(ver, ProtocolVersion.V1_0))
        custom_props = (
            get_custom_envelope_properties(self.catalog, comp_type)
            if at_least_v10 and isinstance(comp_type, str)
            else frozenset()
        )
        if at_least_v10:
            if "@catalogId" in comp:
                comp_catalog_id = comp.get("@catalogId")
                proto_cat_key: str | None = "@catalogId"
            elif "catalogId" in comp and "catalogId" not in custom_props:
                comp_catalog_id = comp.get("catalogId")
                proto_cat_key = "catalogId"
            else:
                comp_catalog_id = None
                proto_cat_key = None
        else:
            comp_catalog_id = None
            proto_cat_key = None

        if target_comp is None:
            if not allow_unknown:
                errors.append(
                    A2uiErrorDetail(
                        path=f"components.{comp_id}.component",
                        code="unrecognized_component",
                        message=f"Unrecognized component type '{comp_type}'",
                        surface_id=surface_id,
                    )
                )
            # The component's properties can't be checked without its schema,
            # but the function calls in them still run, so they are checked
            # all the same. `MessageProcessor` relies on this for the calls
            # it leaves to component validation.
            self._validate_nested_functions(
                comp_id or "unknown",
                comp_catalog_id,
                comp,
                "",
                errors,
                custom_props,
            )
            if errors:
                self._raise_component_validation_errors(
                    errors, comp_id, component_index, surface_id
                )
            return

        comp_for_schema = dict(comp)
        if not at_least_v10:
            declared_props = (
                get_declared_component_properties(self.catalog, comp_type)
                if isinstance(comp_type, str)
                else frozenset()
            )
            for at_key in (
                "@metadata",
                "@catalogId",
                "@accessibility",
                "@checks",
            ):
                if at_key in comp and at_key not in declared_props:
                    comp_for_schema.pop(at_key, None)
                    if not allow_unknown:
                        errors.append(
                            A2uiErrorDetail(
                                path=f"components.{comp_id or 'unknown'}.{at_key}",
                                code="extra_field",
                                message=(
                                    "Additional properties are not allowed"
                                    f" ('{at_key}' was unexpected)"
                                ),
                                surface_id=surface_id,
                            )
                        )
        else:
            is_checkable = (
                is_component_checkable(self.catalog, comp_type)
                if isinstance(comp_type, str)
                else False
            )
            for bare_key, at_key in (
                ("metadata", "@metadata"),
                ("catalogId", "@catalogId"),
                ("accessibility", "@accessibility"),
                ("checks", "@checks"),
            ):
                if at_key in comp and bare_key in comp and bare_key not in custom_props:
                    errors.append(
                        A2uiErrorDetail(
                            path=f"components.{comp_id or 'unknown'}.{at_key}",
                            code="conflicting_properties",
                            message=(
                                f"Component '{comp_id}' cannot specify both"
                                f" '{at_key}' and legacy '{bare_key}'."
                            ),
                            surface_id=surface_id,
                        )
                    )

            if proto_cat_key is not None and not isinstance(comp_catalog_id, str):
                errors.append(
                    A2uiErrorDetail(
                        path=f"components.{comp_id or 'unknown'}.{proto_cat_key}",
                        code="type_mismatch",
                        message=f"'{proto_cat_key}' must be a string",
                        surface_id=surface_id,
                    )
                )

            proto_meta_key = (
                "@metadata"
                if "@metadata" in comp
                else (
                    "metadata"
                    if "metadata" in comp and "metadata" not in custom_props
                    else None
                )
            )
            if proto_meta_key is not None:
                proto_meta_val = comp[proto_meta_key]
                if proto_meta_val is None:
                    errors.append(
                        A2uiErrorDetail(
                            path=f"components.{comp_id or 'unknown'}.{proto_meta_key}",
                            code="type_mismatch",
                            message=f"'{proto_meta_key}' must be an object",
                            surface_id=surface_id,
                        )
                    )
                else:
                    try:
                        validate_metadata(
                            proto_meta_val,
                            context=f"component '{comp_id or 'unknown'}' metadata",
                        )
                    except A2uiValidationError as e:
                        meta_err_path = (
                            f"components.{comp_id or 'unknown'}.{proto_meta_key}.extensions"
                            if ".extensions" in str(e)
                            else f"components.{comp_id or 'unknown'}.{proto_meta_key}"
                        )
                        errors.append(
                            A2uiErrorDetail(
                                path=meta_err_path,
                                code="invalid_metadata",
                                message=str(e),
                                surface_id=surface_id,
                            )
                        )

            proto_a11y_key = (
                "@accessibility"
                if "@accessibility" in comp
                else (
                    "accessibility"
                    if "accessibility" in comp and "accessibility" not in custom_props
                    else None
                )
            )
            if proto_a11y_key is not None:
                try:
                    v1_0_common_types.AccessibilityAttributes.model_validate(
                        comp[proto_a11y_key]
                    )
                except ValidationError as e:
                    a11y_errs = format_validation_error(
                        e,
                        path_prefix=(
                            f"components.{comp_id or 'unknown'}.{proto_a11y_key}"
                        ),
                        allow_unknown_extra=allow_unknown,
                        match_jsonschema_missing_path=True,
                    )
                    errors.extend(a11y_errs)

            proto_checks_key = (
                "@checks"
                if "@checks" in comp
                else (
                    "checks"
                    if "checks" in comp and "checks" not in custom_props
                    else None
                )
            )
            if proto_checks_key is not None:
                if not is_checkable:
                    if not allow_unknown:
                        errors.append(
                            A2uiErrorDetail(
                                path=(
                                    f"components.{comp_id or 'unknown'}.{proto_checks_key}"
                                ),
                                code="extra_field",
                                message=(
                                    "Additional properties are not allowed"
                                    f" ('{proto_checks_key}' was unexpected)"
                                ),
                                surface_id=surface_id,
                            )
                        )
                else:
                    try:
                        v1_0_common_types.Checkable.model_validate(
                            {"checks": comp[proto_checks_key]}
                        )
                    except ValidationError as e:
                        check_errs = format_validation_error(
                            e,
                            path_prefix=f"components.{comp_id or 'unknown'}",
                            allow_unknown_extra=allow_unknown,
                            match_jsonschema_missing_path=True,
                        )
                        for d in check_errs:
                            if proto_checks_key == "@checks":
                                prefix = f"components.{comp_id or 'unknown'}.checks"
                                if d.path == prefix:
                                    d = A2uiErrorDetail(
                                        path=(
                                            f"components.{comp_id or 'unknown'}.@checks"
                                        ),
                                        code=d.code,
                                        message=d.message,
                                        surface_id=d.surface_id,
                                    )
                                elif d.path.startswith(f"{prefix}."):
                                    d = A2uiErrorDetail(
                                        path=(
                                            f"components.{comp_id or 'unknown'}.@checks"
                                            f"{d.path[len(prefix):]}"
                                        ),
                                        code=d.code,
                                        message=d.message,
                                        surface_id=d.surface_id,
                                    )
                            errors.append(d)

            for at_key in (
                "@metadata",
                "@catalogId",
                "@accessibility",
                "@checks",
            ):
                comp_for_schema.pop(at_key, None)
            for bare_key in (
                "metadata",
                "catalogId",
                "accessibility",
                "checks",
            ):
                if bare_key not in custom_props:
                    comp_for_schema.pop(bare_key, None)

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
                model_cls, comp_for_schema, comp_id, allow_unknown, errors
            )
        elif isinstance(getattr(target_comp, "schema", None), dict) or isinstance(
            target_comp, dict
        ):
            self._validate_dict_component(
                target_comp,
                target_cat,
                comp_for_schema,
                comp_id,
                allow_unknown,
                errors,
            )
        else:
            raise A2uiCatalogError(
                f"No schema defined for component '{comp_type}' in catalog.",
                surface_id=surface_id,
            )

        self._validate_nested_functions(
            comp_id or "unknown",
            comp_catalog_id,
            comp,
            "",
            errors,
            custom_props,
        )
        if errors:
            self._raise_component_validation_errors(
                errors, comp_id, component_index, surface_id
            )

    @classmethod
    def _raise_component_validation_errors(
        cls,
        errors: list[A2uiErrorDetail],
        comp_id: str | None,
        component_index: int | None,
        surface_id: str | None,
    ) -> None:
        """Attaches surface_id to component validation details and raises A2uiValidationError."""
        if surface_id is not None:
            errors = [
                A2uiErrorDetail(
                    path=d.path,
                    code=d.code,
                    message=d.message,
                    surface_id=d.surface_id or surface_id,
                )
                for d in errors
            ]
        summary = "\n".join(f"{detail.path}: {detail.message}" for detail in errors)
        raise A2uiValidationError(
            summary,
            details=errors,
            path=cls._resolve_component_error_path(errors[0], comp_id, component_index),
            surface_id=surface_id,
        )

    @staticmethod
    def _extract_detail_error_path(detail: A2uiErrorDetail | str) -> str:
        """Extracts the dot-separated path from a detail, appending missing or extra field names."""
        if isinstance(detail, str):
            return detail
        detail_path = detail.path
        pattern = (
            r"^'([^']+)' is a required property"
            if detail.code == "missing_field"
            else (
                r"\('([^']+)' was unexpected\)"
                if detail.code == "extra_field"
                else None
            )
        )
        if pattern:
            match = re.search(pattern, detail.message)
            if match:
                prop = match.group(1)
                return f"{detail_path}.{prop}" if detail_path else prop
        return detail_path

    @classmethod
    def _resolve_component_error_path(
        cls,
        detail: A2uiErrorDetail | str,
        comp_id: str | None,
        component_index: int | None,
    ) -> str:
        """Converts a detail path like 'components.root.text' into a JSON Pointer '/components/0/text'."""
        detail_path = cls._extract_detail_error_path(detail)
        comp_key = str(comp_id) if comp_id else "unknown"
        prefix = f"components.{comp_key}"
        if component_index is not None:
            if detail_path == prefix:
                return f"/components/{component_index}"
            if detail_path.startswith(f"{prefix}."):
                rest = detail_path[len(prefix) + 1 :]
                return to_json_pointer(f"components.{component_index}.{rest}")
        return to_json_pointer(detail_path)

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
            _resolved_entry_schema(target_cat, "component", target_comp)
            if hasattr(target_comp, "schema") and isinstance(target_comp.schema, dict)
            else target_comp
            if isinstance(target_comp, dict)
            else {}
        )
        if not comp_schema:
            return

        base_schema = (
            getattr(target_cat, "validation_schema", {}) or {} if target_cat else {}
        )
        defs = (
            dict(base_schema.get("$defs", {})) if isinstance(base_schema, dict) else {}
        )
        raw_ver = getattr(target_cat, "protocol_version", None) if target_cat else None
        if raw_ver:
            p_ver = to_protocol_version(raw_ver)
            if p_ver is ProtocolVersion.V0_8:
                p_ver = ProtocolVersion.V0_9
            flat_common_defs = get_common_types_catalog_defs(p_ver)
            for mixin_name in ("ComponentCommon", "Checkable"):
                if mixin_name not in defs and mixin_name in flat_common_defs:
                    defs[mixin_name] = flat_common_defs[mixin_name]
        cat_id = getattr(target_cat, "catalog_id", None)
        if "anyFunction" in defs and isinstance(cat_id, str) and cat_id:
            any_fn = defs["anyFunction"]
            declared = (
                list(any_fn["oneOf"])
                if isinstance(any_fn, dict) and isinstance(any_fn.get("oneOf"), list)
                else []
            )
            defs["anyFunction"] = {
                "oneOf": [
                    *declared,
                    {
                        "type": "object",
                        "properties": {
                            "catalogId": {"not": {"const": cat_id}},
                            "args": {"type": "object"},
                        },
                        "required": ["catalogId"],
                    },
                ]
            }
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
        custom_props: frozenset[str] = frozenset(),
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
        `catalogId` is a type error. A call held in a component is a renderer
        call, so a fully checked call may not call an `agentOnly` function
        (see `check_renderer_may_call`).

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
            custom_props: Custom component properties overriding v1.0 mixin names.
        """
        ver = getattr(self.catalog, "protocol_version", None)
        at_least_v10 = bool(ver and is_at_least_version(ver, ProtocolVersion.V1_0))
        if isinstance(val, dict):
            call_path = (
                f"components.{comp_id}.{path}" if path else f"components.{comp_id}"
            )
            if at_least_v10:
                from ..resolution.data_context import validate_reserved_directives

                keys_to_check = (
                    [
                        k
                        for k in val.keys()
                        if k
                        not in (
                            "@metadata",
                            "@catalogId",
                            "@accessibility",
                            "@checks",
                        )
                    ]
                    if path == ""
                    else val.keys()
                )
                try:
                    validate_reserved_directives(keys_to_check, ver)
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
                if k in ("id", "component"):
                    continue
                if path == "" and at_least_v10:
                    if k in ("@catalogId", "@metadata"):
                        continue
                    if k == "catalogId" and "catalogId" not in custom_props:
                        continue
                    if k == "metadata" and "metadata" not in custom_props:
                        continue
                child_path = f"{path}.{k}" if path else k
                self._validate_nested_functions(
                    comp_id,
                    comp_catalog_id,
                    v,
                    child_path,
                    errors,
                    custom_props,
                )
        elif isinstance(val, list):
            for idx, item in enumerate(val):
                child_path = f"{path}.{idx}"
                self._validate_nested_functions(
                    comp_id,
                    comp_catalog_id,
                    item,
                    child_path,
                    errors,
                    custom_props,
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
                check_renderer_may_call(self.catalog, fn_name)
                self.validate_function(fn_name, fn_args)
            else:
                self.validate_function_identifiers(fn_name, fn_args)
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

    def validate_function_identifiers(self, name: str, args: Any) -> None:
        """Validates a v1.0+ call's envelope without its catalog.

        The function name and argument names must be UAX #31 identifiers, and
        `args`, when present, must be an object.

        Internal: `DataContext` uses it to check a routed call's arguments
        before they resolve. It is not part of the public API.
        """
        ver = getattr(self.catalog, "protocol_version", None)
        if not (ver and is_at_least_version(ver, ProtocolVersion.V1_0)):
            return

        if not is_valid_uax31_identifier(name, allow_leading_at=True):
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
        # The call envelope types `args` as an object, whatever catalog the
        # call runs in.
        if args is not None and not isinstance(args, dict):
            raise _non_object_args_error(name)
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
            raise _non_object_args_error(name)

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

        self.validate_function_identifiers(name, norm_args)

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
                base_schema = getattr(cat, "validation_schema", {}) or {}
                if hasattr(comp_fn, "schema") and isinstance(comp_fn.schema, dict):
                    fn_schema = _resolved_entry_schema(cat, "function", comp_fn)
        if fn_def is None:
            cat_schema = getattr(cat, "validation_schema", {}) or {}
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

    _PARAM_SCHEMA_KEYWORDS = frozenset({
        "properties",
        "$ref",
        "allOf",
        "anyOf",
        "oneOf",
        "not",
        "type",
        "required",
        "additionalProperties",
        "unevaluatedProperties",
        "minProperties",
        "maxProperties",
        "dependentRequired",
        "dependentSchemas",
        "patternProperties",
        "propertyNames",
        "if",
        "const",
        "enum",
    })

    def _extract_raw_param_schema(
        self,
        fn_schema: dict[str, Any],
        defs: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Derives the parameter sub-schema from pre-1.0 (`parameters`) or document (`properties.args`) function definitions."""
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
        if isinstance(props, dict) and ("@call" in props or "call" in props):
            if "args" in props and isinstance(props["args"], dict):
                args_schema = props["args"]
                args_defs = (
                    args_schema["$defs"]
                    if isinstance(args_schema.get("$defs"), dict)
                    else {}
                )
                return {
                    "$schema": JSON_SCHEMA_DRAFT_2020_12,
                    **args_schema,
                    "$defs": {**defs, **args_defs},
                }
            return None

        if (
            "args" in fn_schema
            and isinstance(fn_schema["args"], dict)
            and not isinstance(props, dict)
        ):
            args_schema = fn_schema["args"]
            args_defs = (
                args_schema["$defs"]
                if isinstance(args_schema.get("$defs"), dict)
                else {}
            )
            return {
                "$schema": JSON_SCHEMA_DRAFT_2020_12,
                **args_schema,
                "$defs": {**defs, **args_defs},
            }

        if any(key in fn_schema for key in self._PARAM_SCHEMA_KEYWORDS):
            default_type: dict[str, Any] = (
                {"type": "object"}
                if "type" not in fn_schema
                and "$ref" not in fn_schema
                and not any(
                    key in fn_schema for key in ("allOf", "anyOf", "oneOf", "not")
                )
                else {}
            )
            return {
                "$schema": JSON_SCHEMA_DRAFT_2020_12,
                **default_type,
                **fn_schema,
                "$defs": defs,
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
        """Constructs a JSON Schema object for function parameter validation.

        From v1.0 a call nested in the arguments is checked against its
        envelope only, as in `_validate_dict_component`: it runs in the catalog
        it names, or else the surface default, not necessarily this one, so
        the caller's nested-call walk checks it against that catalog.
        """
        defs = dict(self._extract_schema_defs(fn_schema, base_schema))
        ver = getattr(self.catalog, "protocol_version", None)
        if ver and is_at_least_version(ver, ProtocolVersion.V1_0):
            defs["FunctionCall"] = _function_call_envelope(to_protocol_version(ver))
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

        param_defs = (
            param_schema["$defs"]
            if isinstance(param_schema.get("$defs"), Mapping)
            else {}
        )
        _apply_object_defaults(validated_args, param_schema, param_defs)

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
        base_schema = getattr(self.catalog, "validation_schema", {}) or {}
        defs: dict[str, Any] = (
            base_schema.get("$defs", {}) if isinstance(base_schema, dict) else {}
        )
        theme_schema = (
            getattr(self.catalog, "resolved_theme_schema", None)
            or getattr(self.catalog, "theme_schema", None)
        ) or (
            base_schema.get("properties", {}) if isinstance(base_schema, dict) else {}
        ).get(
            "theme"
        )

        if theme_schema:
            theme_defs = (
                theme_schema["$defs"]
                if isinstance(theme_schema, dict)
                and isinstance(theme_schema.get("$defs"), dict)
                else {}
            )
            full_theme_schema = {
                "$schema": JSON_SCHEMA_DRAFT_2020_12,
                **theme_schema,
                "$defs": {**defs, **theme_defs},
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
                    self._raise_theme_schema_errors(schema_errors)
            except A2uiValidationError:
                raise
            except referencing.exceptions.Unresolvable as ref_err:
                detail = A2uiErrorDetail(
                    path="theme",
                    code="invalid_reference",
                    message=str(ref_err),
                )
                raise A2uiValidationError(str(ref_err), details=[detail]) from ref_err

    def _raise_theme_schema_errors(self, schema_errors: list[Any]) -> None:
        details = [
            A2uiErrorDetail(
                path=".".join(str(p) for p in err.path) or "theme",
                code=self._map_json_schema_error_code(err.validator),
                message=err.message,
            )
            for err in schema_errors
        ]
        first_prop = details[0].path
        err_ptr = (
            "/theme"
            if first_prop == "theme"
            else f"/theme/{to_json_pointer(first_prop).lstrip('/')}"
        )
        summary = "\n".join(f"{detail.path}: {detail.message}" for detail in details)
        raise A2uiValidationError(summary, details=details, path=err_ptr)

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


def _resolve_local_def(ref: str, defs: Mapping[str, Any]) -> Mapping[str, Any] | None:
    """Resolves a `#/$defs/...` JSON Pointer against `defs`."""
    if not ref.startswith("#/$defs/"):
        return None
    parts = ref[len("#/$defs/") :].split("/")
    def_name = parts[0].replace("~1", "/").replace("~0", "~")
    curr: Any = defs.get(def_name)
    for part in parts[1:]:
        key = part.replace("~1", "/").replace("~0", "~")
        if isinstance(curr, Mapping) and key in curr:
            curr = curr[key]
        else:
            return None
    return curr if isinstance(curr, Mapping) else None


def _extract_property_default(
    prop_spec: Mapping[str, Any],
    defs: Mapping[str, Any],
    visited: set[str] | None = None,
) -> tuple[bool, Any]:
    """Finds a `default` keyword on `prop_spec` or its `$ref`/`allOf` targets."""
    if "default" in prop_spec:
        return True, prop_spec["default"]
    seen = set() if visited is None else set(visited)
    ref = prop_spec.get("$ref")
    if isinstance(ref, str) and ref not in seen:
        seen.add(ref)
        resolved = _resolve_local_def(ref, defs)
        if resolved is not None:
            has_default, value = _extract_property_default(resolved, defs, seen)
            if has_default:
                return True, value
    all_of = prop_spec.get("allOf")
    if isinstance(all_of, list):
        for branch in all_of:
            if isinstance(branch, Mapping):
                has_default, value = _extract_property_default(branch, defs, seen)
                if has_default:
                    return True, value
    return False, None


def _apply_object_defaults(
    target: dict[str, Any],
    schema: Mapping[str, Any],
    defs: Mapping[str, Any],
    visited: set[str] | None = None,
) -> None:
    """Populates missing defaulted properties across `properties`, `$ref`, and `allOf`."""
    seen = set() if visited is None else set(visited)
    ref = schema.get("$ref")
    if isinstance(ref, str) and ref not in seen:
        seen.add(ref)
        resolved = _resolve_local_def(ref, defs)
        if resolved is not None:
            _apply_object_defaults(target, resolved, defs, seen)
    all_of = schema.get("allOf")
    if isinstance(all_of, list):
        for branch in all_of:
            if isinstance(branch, Mapping):
                _apply_object_defaults(target, branch, defs, seen)
    props = schema.get("properties")
    if isinstance(props, Mapping):
        for prop_name, prop_spec in props.items():
            if not isinstance(prop_spec, Mapping):
                continue
            if prop_name not in target:
                has_default, default_val = _extract_property_default(prop_spec, defs)
                if has_default:
                    target[prop_name] = copy.deepcopy(default_val)
            if isinstance(target.get(prop_name), dict):
                _apply_object_defaults(target[prop_name], prop_spec, defs)
