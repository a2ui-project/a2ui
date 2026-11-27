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

"""Native payload validator over canonical `CatalogModel` definitions.

Validates component payloads, function arguments, and surface properties
directly against `ComponentDefinition`, `FunctionDefinition`, and
`SurfacePropertiesDefinition` without building a `jsonschema` Draft 2020-12
validator.
"""

from __future__ import annotations

from collections.abc import Mapping
import copy
import datetime
import json
import math
import re
from typing import Any, Final

from ..catalog.model import (
    AccessibilityType,
    ActionType,
    AnyType,
    ArrayType,
    BooleanType,
    CheckRuleType,
    ChildListType,
    ChildType,
    ComponentDefinition,
    ConstType,
    DataBindingType,
    DataTypeDefinition,
    EnumType,
    FunctionCallType,
    FunctionDefinition,
    IntegerType,
    NumberType,
    ObjectType,
    ParameterDefinition,
    RawJsonSchemaType,
    RefType,
    StringType,
    SurfacePropertiesDefinition,
    TypeDefinition,
    UNSET,
    UnionType,
    resolve_type_ref,
)
from ..common.semver import is_at_least_version
from ..exceptions import A2uiErrorDetail
from ..schema import ProtocolVersion
from .schema_validator import _ecma_search, _is_valid_uri

_DATE_RE: Final[re.Pattern[str]] = re.compile(r"^\d{4}-\d{2}-\d{2}\Z")
_TIME_RE: Final[re.Pattern[str]] = re.compile(
    r"^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?\Z"
)
_DATETIME_RE: Final[re.Pattern[str]] = re.compile(
    r"^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})\Z"
)
_EMAIL_RE: Final[re.Pattern[str]] = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+\Z")

_V09_RETURN_TYPES: Final[frozenset[str]] = frozenset(
    {"string", "number", "boolean", "array", "object", "any", "void"}
)
_A11Y_LIVE_VALUES: Final[frozenset[str]] = frozenset({"off", "polite", "assertive"})


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _exact_json_equal(a: Any, b: Any) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    return type(a) is type(b) and bool(a == b)


def _check_string_format(fmt: str, value: str) -> bool:
    if fmt == "uri":
        return _is_valid_uri(value)
    if fmt == "date":
        if not _DATE_RE.match(value):
            return False
        try:
            datetime.date.fromisoformat(value)
            return True
        except ValueError:
            return False
    if fmt == "time":
        if not _TIME_RE.match(value):
            return False
        base = value.rstrip("Zz")
        for sep in ("+", "-"):
            if sep in base:
                base = base.split(sep, 1)[0]
        try:
            datetime.time.fromisoformat(base)
            return True
        except ValueError:
            return False
    if fmt == "date-time":
        if not _DATETIME_RE.match(value):
            return False
        iso = value[:-1] + "+00:00" if value[-1] in ("Z", "z") else value
        try:
            datetime.datetime.fromisoformat(iso)
            return True
        except ValueError:
            return False
    if fmt == "email":
        return _EMAIL_RE.match(value) is not None
    # Unknown format strings are non-blocking per JSON Schema annotation rules.
    return True


def _is_valid_data_binding(value: Any, *, at_least_v10: bool) -> bool:
    if not isinstance(value, dict):
        return False
    path_key = "@path" if at_least_v10 else "path"
    return set(value.keys()) == {path_key} and isinstance(value[path_key], str)


def _is_valid_function_call_envelope(value: Any, *, at_least_v10: bool) -> bool:
    if not isinstance(value, dict):
        return False
    if at_least_v10:
        if "@call" not in value or not isinstance(value["@call"], str):
            return False
        if not set(value.keys()) <= {"@call", "args", "catalogId"}:
            return False
        if "args" in value and not isinstance(value["args"], dict):
            return False
        if "catalogId" in value and not isinstance(value["catalogId"], str):
            return False
        return True
    if "call" not in value or not isinstance(value["call"], str):
        return False
    if not set(value.keys()) <= {"call", "args", "returnType"}:
        return False
    if "args" in value:
        if not isinstance(value["args"], dict):
            return False
        if any(v is None for v in value["args"].values()):
            return False
    if "returnType" in value and value["returnType"] not in _V09_RETURN_TYPES:
        return False
    return True


def _is_valid_literal_object(value: dict[str, Any], *, at_least_v10: bool) -> bool:
    if not at_least_v10:
        return True
    for k in value:
        if k in ("@path", "@call"):
            return False
        if isinstance(k, str) and k.startswith("@") and not k.startswith("@@"):
            return False
    return True


def _join_path(prefix: str, segment: str | int) -> str:
    return f"{prefix}.{segment}" if prefix else str(segment)


def _validate_data_binding(
    value: Any, path: str, *, at_least_v10: bool, errors: list[A2uiErrorDetail]
) -> None:
    if not _is_valid_data_binding(value, at_least_v10=at_least_v10):
        key = "@path" if at_least_v10 else "path"
        errors.append(
            A2uiErrorDetail(
                path=path,
                code="type_mismatch",
                message=f"Expected a DataBinding object with string '{key}'",
            )
        )


def _validate_function_call(
    value: Any, path: str, *, at_least_v10: bool, errors: list[A2uiErrorDetail]
) -> None:
    if not _is_valid_function_call_envelope(value, at_least_v10=at_least_v10):
        key = "@call" if at_least_v10 else "call"
        errors.append(
            A2uiErrorDetail(
                path=path,
                code="type_mismatch",
                message=f"Expected a FunctionCall object with string '{key}'",
            )
        )


def _validate_object_members(
    value: dict[str, Any],
    *,
    properties: tuple[ParameterDefinition, ...],
    additional_properties: bool | TypeDefinition,
    at_least_one_of: tuple[tuple[str, ...], ...],
    path: str,
    at_least_v10: bool,
    types: Mapping[str, DataTypeDefinition] | None,
    allow_unknown: bool,
    errors: list[A2uiErrorDetail],
) -> None:
    prop_map = {p.name: p for p in properties}

    for param in properties:
        if param.required and param.name not in value:
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="missing_field",
                    message=f"'{param.name}' is a required property",
                )
            )

    for group in at_least_one_of:
        if not any(name in value and value[name] is not None for name in group):
            joined = ", ".join(repr(n) for n in group)
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="invalid_value",
                    message=f"At least one of {joined} must be provided",
                )
            )

    for key, val in value.items():
        if key in prop_map:
            _validate_type(
                prop_map[key].type,
                val,
                _join_path(path, key),
                at_least_v10=at_least_v10,
                types=types,
                allow_unknown=allow_unknown,
                errors=errors,
            )
        elif additional_properties is False:
            if not allow_unknown:
                errors.append(
                    A2uiErrorDetail(
                        path=path,
                        code="extra_field",
                        message=(
                            "Additional properties are not allowed"
                            f" ('{key}' was unexpected)"
                        ),
                    )
                )
        elif not isinstance(additional_properties, bool):
            _validate_type(
                additional_properties,
                val,
                _join_path(path, key),
                at_least_v10=at_least_v10,
                types=types,
                allow_unknown=allow_unknown,
                errors=errors,
            )


def _validate_action(
    value: Any,
    path: str,
    *,
    at_least_v10: bool,
    types: Mapping[str, DataTypeDefinition] | None,
    allow_unknown: bool,
    errors: list[A2uiErrorDetail],
) -> None:
    if not isinstance(value, dict):
        errors.append(
            A2uiErrorDetail(
                path=path,
                code="type_mismatch",
                message="Action must be an object",
            )
        )
        return
    keys = set(value.keys())
    if keys == {"event"}:
        ev = value["event"]
        if not isinstance(ev, dict):
            errors.append(
                A2uiErrorDetail(
                    path=_join_path(path, "event"),
                    code="type_mismatch",
                    message="Action 'event' must be an object",
                )
            )
            return
        ev_params: list[ParameterDefinition] = [
            ParameterDefinition("name", StringType(), required=True),
            ParameterDefinition(
                "context",
                ObjectType(additional_properties=AnyType(dynamic=True, nullable=False)),
            ),
        ]
        if at_least_v10:
            ev_params.append(
                ParameterDefinition("userMessage", StringType(dynamic=True))
            )
        _validate_object_members(
            ev,
            properties=tuple(ev_params),
            additional_properties=False,
            at_least_one_of=(),
            path=_join_path(path, "event"),
            at_least_v10=at_least_v10,
            types=types,
            allow_unknown=allow_unknown,
            errors=errors,
        )
        return
    if keys == {"functionCall"}:
        _validate_function_call(
            value["functionCall"],
            _join_path(path, "functionCall"),
            at_least_v10=at_least_v10,
            errors=errors,
        )
        return
    errors.append(
        A2uiErrorDetail(
            path=path,
            code="invalid_value",
            message="Action must contain exactly one of 'event' or 'functionCall'",
        )
    )


def _validate_check_rule(
    value: Any,
    path: str,
    *,
    at_least_v10: bool,
    types: Mapping[str, DataTypeDefinition] | None,
    allow_unknown: bool,
    errors: list[A2uiErrorDetail],
) -> None:
    if not isinstance(value, dict):
        errors.append(
            A2uiErrorDetail(
                path=path,
                code="type_mismatch",
                message="CheckRule must be an object",
            )
        )
        return
    cond_type: TypeDefinition = (
        UnionType(variants=(DataBindingType(), FunctionCallType()))
        if at_least_v10
        else BooleanType(dynamic=True)
    )
    params = (
        ParameterDefinition("condition", cond_type, required=True),
        ParameterDefinition("message", StringType(), required=not at_least_v10),
    )
    _validate_object_members(
        value,
        properties=params,
        additional_properties=False,
        at_least_one_of=(),
        path=path,
        at_least_v10=at_least_v10,
        types=types,
        allow_unknown=allow_unknown,
        errors=errors,
    )


def _validate_accessibility(
    value: Any,
    path: str,
    *,
    at_least_v10: bool,
    types: Mapping[str, DataTypeDefinition] | None,
    allow_unknown: bool,
    errors: list[A2uiErrorDetail],
) -> None:
    if not isinstance(value, dict):
        errors.append(
            A2uiErrorDetail(
                path=path,
                code="type_mismatch",
                message="AccessibilityAttributes must be an object",
            )
        )
        return
    params: list[ParameterDefinition] = [
        ParameterDefinition("label", StringType(dynamic=True)),
        ParameterDefinition("description", StringType(dynamic=True)),
    ]
    if at_least_v10:
        params.append(
            ParameterDefinition(
                "live",
                EnumType(values=tuple(sorted(_A11Y_LIVE_VALUES))),
            )
        )
        params.append(ParameterDefinition("hidden", BooleanType(dynamic=True)))
    _validate_object_members(
        value,
        properties=tuple(params),
        additional_properties=not at_least_v10,
        at_least_one_of=(),
        path=path,
        at_least_v10=at_least_v10,
        types=types,
        allow_unknown=allow_unknown,
        errors=errors,
    )


def _validate_type(
    type_def: TypeDefinition,
    value: Any,
    path: str,
    *,
    at_least_v10: bool,
    types: Mapping[str, DataTypeDefinition] | None,
    allow_unknown: bool,
    errors: list[A2uiErrorDetail],
) -> None:
    resolved = resolve_type_ref(type_def, types)

    if isinstance(resolved, RawJsonSchemaType):
        return

    if isinstance(resolved, DataBindingType):
        _validate_data_binding(value, path, at_least_v10=at_least_v10, errors=errors)
        return

    if isinstance(resolved, FunctionCallType):
        _validate_function_call(value, path, at_least_v10=at_least_v10, errors=errors)
        return

    if isinstance(resolved, ChildType):
        if not isinstance(value, str):
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="type_mismatch",
                    message=f"{value!r} is not of type 'string'",
                )
            )
        return

    if isinstance(resolved, ChildListType):
        if isinstance(value, list):
            for idx, item in enumerate(value):
                if not isinstance(item, str):
                    errors.append(
                        A2uiErrorDetail(
                            path=_join_path(path, idx),
                            code="type_mismatch",
                            message=f"{item!r} is not of type 'string'",
                        )
                    )
            return
        if isinstance(value, dict):
            if (
                set(value.keys()) == {"path", "componentId"}
                and isinstance(value["path"], str)
                and isinstance(value["componentId"], str)
            ):
                return
        errors.append(
            A2uiErrorDetail(
                path=path,
                code="invalid_value",
                message=(
                    "ChildList must be an array of component ID strings or a"
                    " template object with 'path' and 'componentId'"
                ),
            )
        )
        return

    if isinstance(resolved, ActionType):
        _validate_action(
            value,
            path,
            at_least_v10=at_least_v10,
            types=types,
            allow_unknown=allow_unknown,
            errors=errors,
        )
        return

    if isinstance(resolved, CheckRuleType):
        _validate_check_rule(
            value,
            path,
            at_least_v10=at_least_v10,
            types=types,
            allow_unknown=allow_unknown,
            errors=errors,
        )
        return

    if isinstance(resolved, AccessibilityType):
        _validate_accessibility(
            value,
            path,
            at_least_v10=at_least_v10,
            types=types,
            allow_unknown=allow_unknown,
            errors=errors,
        )
        return

    if isinstance(resolved, ConstType):
        if not _exact_json_equal(value, resolved.value):
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="invalid_value",
                    message=f"{resolved.value!r} was expected, got {value!r}",
                )
            )
        return

    if isinstance(resolved, AnyType):
        if value is None:
            if not resolved.nullable:
                errors.append(
                    A2uiErrorDetail(
                        path=path,
                        code="type_mismatch",
                        message="Value must not be null",
                    )
                )
            return
        if resolved.dynamic and not resolved.nullable:
            if isinstance(value, dict):
                if _is_valid_data_binding(
                    value, at_least_v10=at_least_v10
                ) or _is_valid_function_call_envelope(value, at_least_v10=at_least_v10):
                    return
                if not _is_valid_literal_object(value, at_least_v10=at_least_v10):
                    errors.append(
                        A2uiErrorDetail(
                            path=path,
                            code="invalid_value",
                            message=(
                                "DynamicValue object is neither a valid"
                                " DataBinding/FunctionCall nor a literal object"
                            ),
                        )
                    )
            elif isinstance(value, float) and not math.isfinite(value):
                errors.append(
                    A2uiErrorDetail(
                        path=path,
                        code="type_mismatch",
                        message=f"{value!r} is not a finite number",
                    )
                )
        return

    # Dynamic types accept a valid DataBinding or FunctionCall in place of a literal.
    if getattr(resolved, "dynamic", False) and isinstance(value, dict):
        if _is_valid_data_binding(
            value, at_least_v10=at_least_v10
        ) or _is_valid_function_call_envelope(value, at_least_v10=at_least_v10):
            return
        call_key = "@call" if at_least_v10 else "call"
        path_key = "@path" if at_least_v10 else "path"
        if (call_key in value or path_key in value) and (
            at_least_v10 or not isinstance(resolved, ObjectType)
        ):
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="invalid_value",
                    message=(
                        f"Invalid dynamic binding or function call envelope: {value!r}"
                    ),
                )
            )
            return

    if isinstance(resolved, StringType):
        if not isinstance(value, str):
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="type_mismatch",
                    message=f"{value!r} is not of type 'string'",
                )
            )
            return
        if resolved.min_length is not None and len(value) < resolved.min_length:
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="invalid_value",
                    message=(
                        f"{value!r} is shorter than minimum length"
                        f" {resolved.min_length}"
                    ),
                )
            )
        if resolved.max_length is not None and len(value) > resolved.max_length:
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="invalid_value",
                    message=(
                        f"{value!r} is longer than maximum length {resolved.max_length}"
                    ),
                )
            )
        if resolved.pattern is not None and not _ecma_search(resolved.pattern, value):
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="type_mismatch",
                    message=f"{value!r} does not match {resolved.pattern!r}",
                )
            )
        if resolved.format is not None:
            formats = (
                (resolved.format,)
                if isinstance(resolved.format, str)
                else resolved.format
            )
            if not any(_check_string_format(fmt, value) for fmt in formats):
                fmt_label = formats[0] if len(formats) == 1 else " or ".join(formats)
                errors.append(
                    A2uiErrorDetail(
                        path=path,
                        code="type_mismatch",
                        message=f"{value!r} is not a valid {fmt_label}",
                    )
                )
        return

    if isinstance(resolved, NumberType):
        if not _is_number(value):
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="type_mismatch",
                    message=f"{value!r} is not of type 'number'",
                )
            )
            return
        if resolved.min is not None and value < resolved.min:
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="invalid_value",
                    message=f"{value!r} is less than the minimum of {resolved.min}",
                )
            )
        if resolved.max is not None and value > resolved.max:
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="invalid_value",
                    message=f"{value!r} is greater than the maximum of {resolved.max}",
                )
            )
        return

    if isinstance(resolved, IntegerType):
        if not _is_int(value):
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="type_mismatch",
                    message=f"{value!r} is not of type 'integer'",
                )
            )
            return
        if resolved.min is not None and value < resolved.min:
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="invalid_value",
                    message=f"{value!r} is less than the minimum of {resolved.min}",
                )
            )
        if resolved.max is not None and value > resolved.max:
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="invalid_value",
                    message=f"{value!r} is greater than the maximum of {resolved.max}",
                )
            )
        return

    if isinstance(resolved, BooleanType):
        if not isinstance(value, bool):
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="type_mismatch",
                    message=f"{value!r} is not of type 'boolean'",
                )
            )
        return

    if isinstance(resolved, EnumType):
        if not any(_exact_json_equal(value, allowed) for allowed in resolved.values):
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="type_mismatch",
                    message=f"{value!r} is not one of {list(resolved.values)!r}",
                )
            )
        return

    if isinstance(resolved, ArrayType):
        if not isinstance(value, list):
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="type_mismatch",
                    message=f"{value!r} is not of type 'array'",
                )
            )
            return
        if resolved.min_items is not None and len(value) < resolved.min_items:
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="invalid_value",
                    message=(
                        f"Array has {len(value)} item(s), minimum is"
                        f" {resolved.min_items}"
                    ),
                )
            )
        if resolved.max_items is not None and len(value) > resolved.max_items:
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="invalid_value",
                    message=(
                        f"Array has {len(value)} item(s), maximum is"
                        f" {resolved.max_items}"
                    ),
                )
            )
        if resolved.unique_items:
            seen_items: set[str] = set()
            for item in value:
                try:
                    encoded = json.dumps(item, sort_keys=True)
                except TypeError:
                    encoded = repr(item)
                if encoded in seen_items:
                    errors.append(
                        A2uiErrorDetail(
                            path=path,
                            code="invalid_value",
                            message="Array contains non-unique elements",
                        )
                    )
                    break
                seen_items.add(encoded)
        if resolved.items is not None:
            for idx, item in enumerate(value):
                _validate_type(
                    resolved.items,
                    item,
                    _join_path(path, idx),
                    at_least_v10=at_least_v10,
                    types=types,
                    allow_unknown=allow_unknown,
                    errors=errors,
                )
        return

    if isinstance(resolved, ObjectType):
        if not isinstance(value, dict):
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="type_mismatch",
                    message=f"{value!r} is not of type 'object'",
                )
            )
            return
        _validate_object_members(
            value,
            properties=resolved.properties,
            additional_properties=resolved.additional_properties,
            at_least_one_of=resolved.at_least_one_of,
            path=path,
            at_least_v10=at_least_v10,
            types=types,
            allow_unknown=allow_unknown,
            errors=errors,
        )
        return

    if isinstance(resolved, UnionType):
        matches = 0
        for variant in resolved.variants:
            sub_errors: list[A2uiErrorDetail] = []
            _validate_type(
                variant,
                value,
                path,
                at_least_v10=at_least_v10,
                types=types,
                allow_unknown=allow_unknown,
                errors=sub_errors,
            )
            if not sub_errors:
                matches += 1
        if resolved.exclusive:
            if matches != 1:
                errors.append(
                    A2uiErrorDetail(
                        path=path,
                        code="invalid_value",
                        message=(
                            f"{value!r} matched {matches} variants of exclusive"
                            " union (expected exactly 1)"
                        ),
                    )
                )
        elif matches < 1:
            errors.append(
                A2uiErrorDetail(
                    path=path,
                    code="invalid_value",
                    message=f"{value!r} did not match any variant of union",
                )
            )


def _extract_default(
    type_def: TypeDefinition,
    types: Mapping[str, DataTypeDefinition] | None,
) -> tuple[bool, Any]:
    if isinstance(type_def, RefType):
        if type_def.default is not UNSET:
            return True, copy.deepcopy(type_def.default)
        resolved = resolve_type_ref(type_def, types)
        if resolved is not type_def:
            return _extract_default(resolved, types)
        return False, None
    if isinstance(type_def, (AnyType, UnionType)):
        if type_def.default is not UNSET:
            return True, copy.deepcopy(type_def.default)
        return False, None
    if isinstance(type_def, ArrayType):
        if type_def.default is not None:
            return True, copy.deepcopy(list(type_def.default))
        return False, None
    if isinstance(type_def, ObjectType):
        if type_def.default is not None:
            return True, copy.deepcopy(dict(type_def.default))
        return False, None
    if isinstance(
        type_def, (StringType, NumberType, IntegerType, BooleanType, EnumType)
    ):
        if type_def.default is not None:
            return True, copy.deepcopy(type_def.default)
    return False, None


def _apply_defaults_to_object(
    target: dict[str, Any],
    properties: tuple[ParameterDefinition, ...],
    types: Mapping[str, DataTypeDefinition] | None,
) -> None:
    for param in properties:
        if param.name not in target:
            has_default, val = _extract_default(param.type, types)
            if has_default:
                target[param.name] = val
        resolved = resolve_type_ref(param.type, types)
        if isinstance(resolved, ObjectType) and isinstance(
            target.get(param.name), dict
        ):
            _apply_defaults_to_object(target[param.name], resolved.properties, types)


def validate_component_against_definition(
    comp_def: ComponentDefinition,
    comp: Mapping[str, Any],
    *,
    comp_id: str | None,
    protocol_version: ProtocolVersion | str | None,
    types: Mapping[str, DataTypeDefinition] | None = None,
    allow_unknown: bool = False,
) -> list[A2uiErrorDetail]:
    """Validates a component payload against a canonical `ComponentDefinition`."""
    at_least_v10 = bool(
        protocol_version and is_at_least_version(protocol_version, ProtocolVersion.V1_0)
    )
    prefix = f"components.{comp_id or 'unknown'}"
    errors: list[A2uiErrorDetail] = []

    props = dict(comp)
    # Strip envelope fields handled by PayloadValidator / MessageProcessor.
    for key in ("id", "component"):
        props.pop(key, None)
    if at_least_v10:
        custom = comp_def.custom_envelope_properties
        for key in ("catalogId", "metadata", "accessibility", "checks"):
            if key in props and key not in custom:
                val = props.pop(key)
                if key == "catalogId" and not isinstance(val, str):
                    errors.append(
                        A2uiErrorDetail(
                            path=f"{prefix}.catalogId",
                            code="type_mismatch",
                            message="'catalogId' must be a string",
                        )
                    )
    else:
        # Pre-1.0 envelope mixins (`accessibility` on all components, `checks` on checkable).
        if "accessibility" in props and comp_def.get_parameter("accessibility") is None:
            _validate_accessibility(
                props.pop("accessibility"),
                f"{prefix}.accessibility",
                at_least_v10=False,
                types=types,
                allow_unknown=allow_unknown,
                errors=errors,
            )
        if (
            comp_def.checkable
            and "checks" in props
            and comp_def.get_parameter("checks") is None
        ):
            checks_val = props.pop("checks")
            _validate_type(
                ArrayType(items=CheckRuleType()),
                checks_val,
                f"{prefix}.checks",
                at_least_v10=False,
                types=types,
                allow_unknown=allow_unknown,
                errors=errors,
            )

    _validate_object_members(
        props,
        properties=comp_def.parameters,
        additional_properties=comp_def.additional_properties,
        at_least_one_of=comp_def.at_least_one_of,
        path=prefix,
        at_least_v10=at_least_v10,
        types=types,
        allow_unknown=allow_unknown,
        errors=errors,
    )
    return errors


def validate_function_against_definition(
    fn_def: FunctionDefinition,
    args: Mapping[str, Any],
    *,
    fn_name: str,
    protocol_version: ProtocolVersion | str | None,
    types: Mapping[str, DataTypeDefinition] | None = None,
    allow_unknown: bool = False,
) -> tuple[dict[str, Any], list[A2uiErrorDetail]]:
    """Validates function arguments against a canonical `FunctionDefinition`."""
    at_least_v10 = bool(
        protocol_version and is_at_least_version(protocol_version, ProtocolVersion.V1_0)
    )
    prefix = f"functions.{fn_name}"
    validated = dict(args)
    errors: list[A2uiErrorDetail] = []

    _validate_object_members(
        validated,
        properties=fn_def.parameters,
        additional_properties=fn_def.additional_parameters,
        at_least_one_of=fn_def.at_least_one_of,
        path=prefix,
        at_least_v10=at_least_v10,
        types=types,
        allow_unknown=allow_unknown,
        errors=errors,
    )
    if not errors:
        _apply_defaults_to_object(validated, fn_def.parameters, types)
    return validated, errors


def validate_surface_properties_against_definition(
    surface_props: SurfacePropertiesDefinition,
    theme: Mapping[str, Any],
    *,
    protocol_version: ProtocolVersion | str | None,
    types: Mapping[str, DataTypeDefinition] | None = None,
) -> list[A2uiErrorDetail]:
    """Validates surface theme/properties against `SurfacePropertiesDefinition`."""
    at_least_v10 = bool(
        protocol_version and is_at_least_version(protocol_version, ProtocolVersion.V1_0)
    )
    errors: list[A2uiErrorDetail] = []
    _validate_object_members(
        dict(theme),
        properties=surface_props.properties,
        additional_properties=surface_props.additional_properties,
        at_least_one_of=(),
        path="",
        at_least_v10=at_least_v10,
        types=types,
        allow_unknown=False,
        errors=errors,
    )
    return [
        A2uiErrorDetail(
            path=d.path or "theme",
            code=d.code,
            message=d.message,
            surface_id=d.surface_id,
        )
        for d in errors
    ]


__all__ = [
    "validate_component_against_definition",
    "validate_function_against_definition",
    "validate_surface_properties_against_definition",
]
