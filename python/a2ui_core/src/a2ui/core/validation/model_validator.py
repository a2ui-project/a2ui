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
    is_json_number,
    resolve_type_ref_with_visited,
)
from ..common.metadata import validate_metadata
from ..common.regex_subset import compile_guarded
from ..common.semver import is_at_least_version
from ..exceptions import A2uiErrorDetail, A2uiExpressionError, A2uiValidationError
from ..schema import ProtocolVersion
from .schema_validator import _is_valid_uri

_DATE_RE: Final[re.Pattern[str]] = re.compile(r"^(\d{4})-(\d{2})-(\d{2})\Z")
_TIME_BODY: Final[str] = r"(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))"
_TIME_RE: Final[re.Pattern[str]] = re.compile(rf"^{_TIME_BODY}\Z")
_DATETIME_RE: Final[re.Pattern[str]] = re.compile(
    rf"^(\d{{4}})-(\d{{2}})-(\d{{2}})[Tt ]{_TIME_BODY}\Z"
)
_EMAIL_RE: Final[re.Pattern[str]] = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+\Z")

_V09_RETURN_TYPES: Final[frozenset[str]] = frozenset(
    {"string", "number", "boolean", "array", "object", "any", "void"}
)

_ACTION_EVENT_PARAMS_V09: Final[tuple[ParameterDefinition, ...]] = (
    ParameterDefinition("name", StringType(), required=True),
    ParameterDefinition(
        "context",
        ObjectType(additional_properties=AnyType(dynamic=True, nullable=False)),
    ),
)
_ACTION_EVENT_PARAMS_V10: Final[tuple[ParameterDefinition, ...]] = (
    *_ACTION_EVENT_PARAMS_V09,
    ParameterDefinition("userMessage", StringType(dynamic=True)),
)
_CHECK_RULE_PARAMS_V10: Final[tuple[ParameterDefinition, ...]] = (
    ParameterDefinition(
        "condition",
        UnionType(variants=(DataBindingType(), FunctionCallType())),
        required=True,
    ),
    ParameterDefinition("message", StringType(), required=False),
)
_CHECK_RULE_PARAMS_V09: Final[tuple[ParameterDefinition, ...]] = (
    ParameterDefinition("condition", BooleanType(dynamic=True), required=True),
    ParameterDefinition("message", StringType(), required=True),
)
_A11Y_PARAMS_V09: Final[tuple[ParameterDefinition, ...]] = (
    ParameterDefinition("label", StringType(dynamic=True)),
    ParameterDefinition("description", StringType(dynamic=True)),
)
_A11Y_PARAMS_V10: Final[tuple[ParameterDefinition, ...]] = (
    *_A11Y_PARAMS_V09,
    ParameterDefinition("live", EnumType(values=("assertive", "off", "polite"))),
    ParameterDefinition("hidden", BooleanType(dynamic=True)),
)
_CHECKS_ARRAY_TYPE: Final[ArrayType] = ArrayType(items=CheckRuleType())


def _err(errors: list[A2uiErrorDetail], path: str, code: str, message: str) -> None:
    errors.append(A2uiErrorDetail(path=path, code=code, message=message))


def _is_json_integer(value: Any) -> bool:
    """JSON Schema Draft 2020-12 integer check (excludes `bool`, accepts whole floats)."""
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    return isinstance(value, float) and math.isfinite(value) and value.is_integer()


def _exact_json_equal(a: Any, b: Any) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    return type(a) is type(b) and bool(a == b)


def _canonical_json_key(value: Any) -> Any:
    """Produces a hashable JSON-equality key where `1 == 1.0` and `1 != True`."""
    if value is None:
        return ("null",)
    if isinstance(value, bool):
        return ("bool", value)
    if isinstance(value, int):
        return ("num", value)
    if isinstance(value, float):
        if math.isfinite(value) and value.is_integer():
            return ("num", int(value))
        return ("num", value)
    if isinstance(value, str):
        return ("str", value)
    if isinstance(value, list):
        return ("list", tuple(_canonical_json_key(item) for item in value))
    if isinstance(value, dict):
        return (
            "dict",
            tuple(
                (k, _canonical_json_key(v))
                for k, v in sorted(value.items(), key=lambda kv: str(kv[0]))
            ),
        )
    return ("other", repr(value))


def _check_date_parts(year: str, month: str, day: str) -> bool:
    try:
        datetime.date(int(year), int(month), int(day))
        return True
    except ValueError:
        return False


def _check_time_parts(
    hh: str, mm: str, ss: str, off_hh: str | None, off_mm: str | None
) -> bool:
    if not (0 <= int(hh) <= 23 and 0 <= int(mm) <= 59 and 0 <= int(ss) <= 59):
        return False
    if off_hh is not None and off_mm is not None:
        if not (0 <= int(off_hh) <= 23 and 0 <= int(off_mm) <= 59):
            return False
    return True


def _check_string_format(fmt: str, value: str) -> bool:
    """Validates RFC 3986 URI, RFC 3339 date/time/date-time (Python 3.10+), and email."""
    if fmt == "uri":
        return _is_valid_uri(value)
    if fmt == "date":
        m = _DATE_RE.match(value)
        return m is not None and _check_date_parts(m.group(1), m.group(2), m.group(3))
    if fmt == "time":
        m = _TIME_RE.match(value)
        return m is not None and _check_time_parts(
            m.group(1), m.group(2), m.group(3), m.group(5), m.group(6)
        )
    if fmt == "date-time":
        m = _DATETIME_RE.match(value)
        return (
            m is not None
            and _check_date_parts(m.group(1), m.group(2), m.group(3))
            and _check_time_parts(
                m.group(4), m.group(5), m.group(6), m.group(8), m.group(9)
            )
        )
    if fmt == "email":
        return _EMAIL_RE.match(value) is not None
    # Unknown format strings are non-blocking per JSON Schema annotation rules.
    return True


def _is_valid_data_binding(value: Any, *, at_least_v10: bool) -> bool:
    if not isinstance(value, dict):
        return False
    path_key = "@path" if at_least_v10 else "path"
    return set(value.keys()) == {path_key} and isinstance(value[path_key], str)


def _expected_v09_return_type(type_def: TypeDefinition) -> str | None:
    if isinstance(type_def, StringType):
        return "string"
    if isinstance(type_def, (NumberType, IntegerType)):
        return "number"
    if isinstance(type_def, BooleanType):
        return "boolean"
    if isinstance(type_def, ArrayType):
        return "array"
    return None


def _is_valid_function_call_envelope(
    value: Any,
    *,
    at_least_v10: bool,
    expected_v09_return_type: str | None = None,
) -> bool:
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
    if "returnType" in value:
        rt = value["returnType"]
        if rt not in _V09_RETURN_TYPES:
            return False
        if expected_v09_return_type is not None and rt != expected_v09_return_type:
            return False
    return True


def _is_valid_literal_object(value: dict[str, Any], *, at_least_v10: bool) -> bool:
    # v0.9 DynamicValue only allows string | number | boolean | array | DataBinding | FunctionCall.
    if not at_least_v10:
        return False
    for k in value:
        if k in ("@path", "@call"):
            return False
        if isinstance(k, str) and k.startswith("@") and not k.startswith("@@"):
            return False
    return True


def _join_path(prefix: str, segment: str | int) -> str:
    return f"{prefix}.{segment}" if prefix else str(segment)


def _check_numeric_bounds(
    value: int | float,
    min_val: int | float | None,
    max_val: int | float | None,
    path: str,
    errors: list[A2uiErrorDetail],
) -> None:
    if min_val is not None and value < min_val:
        _err(
            errors,
            path,
            "invalid_value",
            f"{value!r} is less than the minimum of {min_val}",
        )
    if max_val is not None and value > max_val:
        _err(
            errors,
            path,
            "invalid_value",
            f"{value!r} is greater than the maximum of {max_val}",
        )


def _validate_data_binding(
    value: Any, path: str, *, at_least_v10: bool, errors: list[A2uiErrorDetail]
) -> None:
    if not _is_valid_data_binding(value, at_least_v10=at_least_v10):
        key = "@path" if at_least_v10 else "path"
        _err(
            errors,
            path,
            "type_mismatch",
            f"Expected a DataBinding object with string '{key}'",
        )


def _validate_function_call(
    value: Any, path: str, *, at_least_v10: bool, errors: list[A2uiErrorDetail]
) -> None:
    if not _is_valid_function_call_envelope(value, at_least_v10=at_least_v10):
        key = "@call" if at_least_v10 else "call"
        _err(
            errors,
            path,
            "type_mismatch",
            f"Expected a FunctionCall object with string '{key}'",
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
            _err(
                errors, path, "missing_field", f"'{param.name}' is a required property"
            )

    for group in at_least_one_of:
        if not any(name in value for name in group):
            joined = ", ".join(repr(n) for n in group)
            _err(
                errors,
                path,
                "invalid_value",
                f"At least one of {joined} must be provided",
            )

    for key, val in value.items():
        if key in prop_map:
            # Descending into a child value resets `visited_refs` so structural
            # recursion (`TreeNode -> Object(children=Array(Ref(TreeNode)))`)
            # validates finite JSON payloads to arbitrary depth.
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
                _err(
                    errors,
                    path,
                    "extra_field",
                    f"Additional properties are not allowed ('{key}' was unexpected)",
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
        _err(errors, path, "type_mismatch", "Action must be an object")
        return
    keys = set(value.keys())
    if keys == {"event"}:
        ev = value["event"]
        if not isinstance(ev, dict):
            _err(
                errors,
                _join_path(path, "event"),
                "type_mismatch",
                "Action 'event' must be an object",
            )
            return
        _validate_object_members(
            ev,
            properties=(
                _ACTION_EVENT_PARAMS_V10 if at_least_v10 else _ACTION_EVENT_PARAMS_V09
            ),
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
    _err(
        errors,
        path,
        "invalid_value",
        "Action must contain exactly one of 'event' or 'functionCall'",
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
        _err(errors, path, "type_mismatch", "CheckRule must be an object")
        return
    _validate_object_members(
        value,
        properties=_CHECK_RULE_PARAMS_V10 if at_least_v10 else _CHECK_RULE_PARAMS_V09,
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
        _err(errors, path, "type_mismatch", "AccessibilityAttributes must be an object")
        return
    _validate_object_members(
        value,
        properties=_A11Y_PARAMS_V10 if at_least_v10 else _A11Y_PARAMS_V09,
        additional_properties=not at_least_v10,
        at_least_one_of=(),
        path=path,
        at_least_v10=at_least_v10,
        types=types,
        allow_unknown=allow_unknown,
        errors=errors,
    )


def _validate_envelope_metadata(
    value: Any, path: str, errors: list[A2uiErrorDetail]
) -> None:
    if value is None:
        _err(errors, path, "type_mismatch", f"'{path}' must be an object")
        return
    try:
        validate_metadata(value, context=path)
    except A2uiValidationError as err:
        err_path = f"{path}.extensions" if ".extensions" in str(err) else path
        _err(errors, err_path, "invalid_metadata", str(err))


def _validate_type(
    type_def: TypeDefinition,
    value: Any,
    path: str,
    *,
    at_least_v10: bool,
    types: Mapping[str, DataTypeDefinition] | None,
    allow_unknown: bool,
    errors: list[A2uiErrorDetail],
    visited_refs: frozenset[str] = frozenset(),
) -> None:
    resolved, next_visited, hit_cycle = resolve_type_ref_with_visited(
        type_def, types, visited_refs
    )

    if hit_cycle:
        ref_label = resolved.ref if isinstance(resolved, RefType) else str(resolved)
        _err(
            errors,
            path,
            "invalid_value",
            f"Circular local type reference {ref_label!r}",
        )
        return

    if isinstance(resolved, RefType):
        _err(
            errors,
            path,
            "invalid_value",
            f"Unresolved local type reference {resolved.ref!r}",
        )
        return

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
            _err(errors, path, "type_mismatch", f"{value!r} is not of type 'string'")
        return

    if isinstance(resolved, ChildListType):
        if isinstance(value, list):
            for idx, item in enumerate(value):
                if not isinstance(item, str):
                    _err(
                        errors,
                        _join_path(path, idx),
                        "type_mismatch",
                        f"{item!r} is not of type 'string'",
                    )
            return
        if (
            isinstance(value, dict)
            and set(value.keys()) == {"path", "componentId"}
            and isinstance(value["path"], str)
            and isinstance(value["componentId"], str)
        ):
            return
        _err(
            errors,
            path,
            "invalid_value",
            "ChildList must be an array of component ID strings or a template"
            " object with 'path' and 'componentId'",
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
            _err(
                errors,
                path,
                "invalid_value",
                f"{resolved.value!r} was expected, got {value!r}",
            )
        return

    if isinstance(resolved, AnyType):
        if value is None:
            if not resolved.nullable:
                _err(errors, path, "type_mismatch", "Value must not be null")
            return
        if resolved.dynamic and not resolved.nullable:
            if isinstance(value, dict):
                if _is_valid_data_binding(
                    value, at_least_v10=at_least_v10
                ) or _is_valid_function_call_envelope(value, at_least_v10=at_least_v10):
                    return
                if not _is_valid_literal_object(value, at_least_v10=at_least_v10):
                    _err(
                        errors,
                        path,
                        "invalid_value",
                        "DynamicValue object is neither a valid"
                        " DataBinding/FunctionCall nor a permitted literal object",
                    )
            elif isinstance(value, float) and not math.isfinite(value):
                _err(
                    errors,
                    path,
                    "type_mismatch",
                    f"{value!r} is not a finite number",
                )
        return

    # Dynamic types accept a valid DataBinding or FunctionCall in place of a literal.
    if getattr(resolved, "dynamic", False) and isinstance(value, dict):
        expected_v09_rt = None if at_least_v10 else _expected_v09_return_type(resolved)
        if _is_valid_data_binding(
            value, at_least_v10=at_least_v10
        ) or _is_valid_function_call_envelope(
            value,
            at_least_v10=at_least_v10,
            expected_v09_return_type=expected_v09_rt,
        ):
            return
        call_key = "@call" if at_least_v10 else "call"
        path_key = "@path" if at_least_v10 else "path"
        if (call_key in value or path_key in value) and (
            at_least_v10 or not isinstance(resolved, ObjectType)
        ):
            _err(
                errors,
                path,
                "invalid_value",
                f"Invalid dynamic binding or function call envelope: {value!r}",
            )
            return

    if isinstance(resolved, StringType):
        if not isinstance(value, str):
            _err(errors, path, "type_mismatch", f"{value!r} is not of type 'string'")
            return
        if resolved.min_length is not None and len(value) < resolved.min_length:
            _err(
                errors,
                path,
                "invalid_value",
                f"{value!r} is shorter than minimum length {resolved.min_length}",
            )
        if resolved.max_length is not None and len(value) > resolved.max_length:
            _err(
                errors,
                path,
                "invalid_value",
                f"{value!r} is longer than maximum length {resolved.max_length}",
            )
        if resolved.pattern is not None:
            try:
                compiled = compile_guarded(resolved.pattern)
            except A2uiExpressionError:
                _err(
                    errors,
                    path,
                    "invalid_value",
                    f"Invalid or unsafe regex pattern {resolved.pattern!r}",
                )
            else:
                if compiled.search(value) is None:
                    _err(
                        errors,
                        path,
                        "type_mismatch",
                        f"{value!r} does not match {resolved.pattern!r}",
                    )
        if resolved.format is not None:
            formats = (
                (resolved.format,)
                if isinstance(resolved.format, str)
                else resolved.format
            )
            if not any(_check_string_format(fmt, value) for fmt in formats):
                fmt_label = formats[0] if len(formats) == 1 else " or ".join(formats)
                _err(
                    errors,
                    path,
                    "type_mismatch",
                    f"{value!r} is not a valid {fmt_label}",
                )
        return

    if isinstance(resolved, NumberType):
        if not is_json_number(value):
            _err(errors, path, "type_mismatch", f"{value!r} is not of type 'number'")
            return
        _check_numeric_bounds(value, resolved.min, resolved.max, path, errors)
        return

    if isinstance(resolved, IntegerType):
        if not _is_json_integer(value):
            _err(errors, path, "type_mismatch", f"{value!r} is not of type 'integer'")
            return
        _check_numeric_bounds(value, resolved.min, resolved.max, path, errors)
        return

    if isinstance(resolved, BooleanType):
        if not isinstance(value, bool):
            _err(errors, path, "type_mismatch", f"{value!r} is not of type 'boolean'")
        return

    if isinstance(resolved, EnumType):
        if not any(_exact_json_equal(value, allowed) for allowed in resolved.values):
            _err(
                errors,
                path,
                "type_mismatch",
                f"{value!r} is not one of {list(resolved.values)!r}",
            )
        return

    if isinstance(resolved, ArrayType):
        if not isinstance(value, list):
            _err(errors, path, "type_mismatch", f"{value!r} is not of type 'array'")
            return
        if resolved.min_items is not None and len(value) < resolved.min_items:
            _err(
                errors,
                path,
                "invalid_value",
                f"Array has {len(value)} item(s), minimum is {resolved.min_items}",
            )
        if resolved.max_items is not None and len(value) > resolved.max_items:
            _err(
                errors,
                path,
                "invalid_value",
                f"Array has {len(value)} item(s), maximum is {resolved.max_items}",
            )
        if resolved.unique_items:
            seen_items: set[Any] = set()
            for item in value:
                key = _canonical_json_key(item)
                if key in seen_items:
                    _err(
                        errors,
                        path,
                        "invalid_value",
                        "Array contains non-unique elements",
                    )
                    break
                seen_items.add(key)
        if resolved.items is not None:
            for idx, item in enumerate(value):
                # Reset `visited_refs` when descending into child elements.
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
            _err(errors, path, "type_mismatch", f"{value!r} is not of type 'object'")
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

    # UnionType: keep `next_visited` across same-value transitions so cyclic
    # unions (`RecUnion -> Union([Ref(RecUnion), String])`) terminate cleanly.
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
            visited_refs=next_visited,
        )
        if not sub_errors:
            matches += 1
    if resolved.exclusive:
        if matches != 1:
            _err(
                errors,
                path,
                "invalid_value",
                f"{value!r} matched {matches} variants of exclusive union"
                " (expected exactly 1)",
            )
    elif matches < 1:
        _err(
            errors,
            path,
            "invalid_value",
            f"{value!r} did not match any variant of union",
        )


def _extract_default(
    type_def: TypeDefinition,
    types: Mapping[str, DataTypeDefinition] | None,
    visited_refs: frozenset[str] = frozenset(),
) -> tuple[bool, Any]:
    if isinstance(type_def, RefType):
        if type_def.default is not UNSET:
            return True, copy.deepcopy(type_def.default)
        resolved, next_visited, hit_cycle = resolve_type_ref_with_visited(
            type_def, types, visited_refs
        )
        if not hit_cycle and resolved is not type_def:
            return _extract_default(resolved, types, next_visited)
        return False, None
    if isinstance(type_def, (AnyType, UnionType)):
        if type_def.default is not UNSET:
            return True, copy.deepcopy(type_def.default)
        return False, None
    if isinstance(type_def, ArrayType) and type_def.default is not None:
        return True, copy.deepcopy(list(type_def.default))
    if isinstance(type_def, ObjectType) and type_def.default is not None:
        return True, copy.deepcopy(dict(type_def.default))
    if (
        isinstance(
            type_def, (StringType, NumberType, IntegerType, BooleanType, EnumType)
        )
        and type_def.default is not None
    ):
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
        resolved, _, hit_cycle = resolve_type_ref_with_visited(param.type, types)
        if (
            not hit_cycle
            and isinstance(resolved, ObjectType)
            and isinstance(target.get(param.name), dict)
        ):
            _apply_defaults_to_object(target[param.name], resolved.properties, types)


def _validate_v10_component_envelopes(
    comp_def: ComponentDefinition,
    props: dict[str, Any],
    *,
    prefix: str,
    types: Mapping[str, DataTypeDefinition] | None,
    allow_unknown: bool,
    errors: list[A2uiErrorDetail],
) -> None:
    """Strips and validates v1.0 `@`-prefixed and legacy bare envelope fields."""
    custom = comp_def.custom_envelope_properties
    for bare_key, at_key in (
        ("metadata", "@metadata"),
        ("catalogId", "@catalogId"),
        ("accessibility", "@accessibility"),
        ("checks", "@checks"),
    ):
        has_at = at_key in props
        has_bare = bare_key in props and bare_key not in custom
        if has_at and has_bare:
            _err(
                errors,
                f"{prefix}.{at_key}",
                "conflicting_properties",
                f"Component cannot specify both '{at_key}' and legacy '{bare_key}'.",
            )
            props.pop(at_key, None)
            props.pop(bare_key, None)
            continue

        active_key = at_key if has_at else (bare_key if has_bare else None)
        if active_key is None:
            continue
        val = props.pop(active_key)
        field_path = f"{prefix}.{active_key}"

        if bare_key == "catalogId":
            if not isinstance(val, str):
                _err(
                    errors,
                    field_path,
                    "type_mismatch",
                    f"'{active_key}' must be a string",
                )
        elif bare_key == "metadata":
            _validate_envelope_metadata(val, field_path, errors)
        elif bare_key == "accessibility":
            _validate_accessibility(
                val,
                field_path,
                at_least_v10=True,
                types=types,
                allow_unknown=allow_unknown,
                errors=errors,
            )
        elif bare_key == "checks":
            if not comp_def.checkable:
                if not allow_unknown:
                    _err(
                        errors,
                        field_path,
                        "extra_field",
                        "Additional properties are not allowed"
                        f" ('{active_key}' was unexpected)",
                    )
            else:
                _validate_type(
                    _CHECKS_ARRAY_TYPE,
                    val,
                    field_path,
                    at_least_v10=True,
                    types=types,
                    allow_unknown=allow_unknown,
                    errors=errors,
                )


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
    props.pop("id", None)
    props.pop("component", None)
    if at_least_v10:
        _validate_v10_component_envelopes(
            comp_def,
            props,
            prefix=prefix,
            types=types,
            allow_unknown=allow_unknown,
            errors=errors,
        )
    else:
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
            _validate_type(
                _CHECKS_ARRAY_TYPE,
                props.pop("checks"),
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
