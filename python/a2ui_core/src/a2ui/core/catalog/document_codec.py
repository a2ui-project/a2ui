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

"""Parser, validator, and serializer for the decoupled A2UI Catalog Document format."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
import copy
import re
from typing import Any, Final, cast

from ..common.metadata import clone_metadata
from ..common.regex_subset import compile_guarded
from ..common.semver import to_canonical_version
from ..common.uax31 import is_valid_uax31_identifier
from ..exceptions import A2uiCatalogError, A2uiExpressionError
from ..schema import ProtocolVersion
from .functions import AllowedCallers
from .model import (
    AccessibilityType,
    ActionType,
    AnyType,
    ArrayType,
    BooleanType,
    CATALOG_DOCUMENT_FORMAT_VERSION,
    CatalogModel,
    CheckRuleType,
    ChildListType,
    ChildType,
    ComponentDefinition,
    ConstType,
    ConstValue,
    DataBindingType,
    DataTypeDefinition,
    EnumType,
    EnumValue,
    EnumValueType,
    FunctionCallType,
    FunctionDefinition,
    FunctionReturnDefinition,
    FunctionReturnShorthand,
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
    ValidationResultReturnType,
    VoidReturnType,
    contains_ui_type,
    is_json_int,
    is_json_number,
    iter_child_types,
)

CATALOG_DOCUMENT_SCHEMA_URI: Final[str] = (
    "https://a2ui.org/specification/proposals/catalog_schema/catalog_schema.json"
)

_SEMVER_RE: Final[re.Pattern[str]] = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?"
    r"(?:-((?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)"
    r"(?:\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    r"(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?\Z"
)

_ROOT_KEYS: Final[frozenset[str]] = frozenset({
    "$schema",
    "formatVersion",
    "catalogId",
    "protocolVersion",
    "title",
    "description",
    "instructions",
    "metadata",
    "types",
    "surfaceProperties",
    "components",
    "functions",
})

_COMPONENT_KEYS: Final[frozenset[str]] = frozenset({
    "name",
    "description",
    "checkable",
    "parameters",
    "atLeastOneOf",
    "allowedParents",
    "allowedChildren",
    "metadata",
    "deprecated",
    "deprecatedReason",
})

_FUNCTION_KEYS: Final[frozenset[str]] = frozenset({
    "name",
    "description",
    "returnType",
    "allowedCallers",
    "requiresUserActivation",
    "parameters",
    "atLeastOneOf",
    "additionalParameters",
    "deprecated",
    "deprecatedReason",
})

_SURFACE_PROPERTIES_KEYS: Final[frozenset[str]] = frozenset({
    "description",
    "properties",
    "additionalProperties",
})

_BASE_TYPE_KEYS: Final[frozenset[str]] = frozenset({
    "type",
    "description",
    "deprecated",
    "deprecatedReason",
})

_PARAM_IDENTITY_KEYS: Final[frozenset[str]] = frozenset({"name", "required"})
_RESERVED_COMPONENT_PARAM_NAMES: Final[frozenset[str]] = frozenset({"id", "component"})

_ALLOWED_CALLERS: Final[frozenset[str]] = frozenset(
    {"rendererOnly", "agentOnly", "rendererOrAgent"}
)

_RETURN_SHORTHANDS: Final[frozenset[str]] = frozenset({
    "string",
    "number",
    "integer",
    "boolean",
    "array",
    "object",
    "validationResult",
    "any",
    "void",
})

_ENUM_VALUE_TYPES: Final[frozenset[str]] = frozenset({"string", "number", "boolean"})

_UI_TYPE_NAMES: Final[frozenset[str]] = frozenset(
    {"child", "childList", "action", "checkRule", "accessibility"}
)

_MARKER_TYPE_CLS: Final[dict[str, type[TypeDefinition]]] = {
    "dataBinding": DataBindingType,
    "functionCall": FunctionCallType,
    "child": ChildType,
    "childList": ChildListType,
    "action": ActionType,
    "checkRule": CheckRuleType,
    "accessibility": AccessibilityType,
}

_TYPE_KEYS_BY_KIND: Final[dict[str, frozenset[str]]] = {
    "string": (
        _BASE_TYPE_KEYS
        | {"dynamic", "format", "pattern", "minLength", "maxLength", "default"}
    ),
    "number": _BASE_TYPE_KEYS | {"dynamic", "min", "max", "default"},
    "integer": _BASE_TYPE_KEYS | {"dynamic", "min", "max", "default"},
    "boolean": _BASE_TYPE_KEYS | {"dynamic", "default"},
    "enum": _BASE_TYPE_KEYS | {"dynamic", "valueType", "values", "default"},
    "const": _BASE_TYPE_KEYS | {"value"},
    "any": _BASE_TYPE_KEYS | {"dynamic", "nullable", "default"},
    "ref": _BASE_TYPE_KEYS | {"ref", "default"},
    "object": (
        _BASE_TYPE_KEYS
        | {"dynamic", "properties", "additionalProperties", "atLeastOneOf", "default"}
    ),
    "array": (
        _BASE_TYPE_KEYS
        | {"dynamic", "items", "minItems", "maxItems", "uniqueItems", "default"}
    ),
    "union": _BASE_TYPE_KEYS | {"dynamic", "exclusive", "variants", "default"},
    **{k: _BASE_TYPE_KEYS for k in _MARKER_TYPE_CLS},
}


def is_catalog_document(raw: Any) -> bool:
    """Returns whether `raw` is a decoupled A2UI Catalog Document object.

    Any JSON object declaring a string `formatVersion` is recognized as a
    Catalog Document; unsupported versions are rejected by
    `parse_catalog_document` with `A2uiCatalogError`.
    """
    return isinstance(raw, Mapping) and isinstance(raw.get("formatVersion"), str)


def _check_allowed_keys(
    obj: Mapping[str, Any], allowed: frozenset[str], path: str
) -> None:
    unknown = sorted(str(k) for k in obj if k not in allowed)
    if unknown:
        joined = ", ".join(repr(k) for k in unknown)
        raise A2uiCatalogError(f"{path}: unexpected property(ies): {joined}")


def _opt_str(obj: Mapping[str, Any], key: str, path: str) -> str | None:
    if key not in obj:
        return None
    val = obj[key]
    if not isinstance(val, str):
        raise A2uiCatalogError(f"{path}.{key} must be a string.")
    return val


def _opt_bool(
    obj: Mapping[str, Any], key: str, path: str, *, default: bool = False
) -> bool:
    if key not in obj:
        return default
    val = obj[key]
    if not isinstance(val, bool):
        raise A2uiCatalogError(f"{path}.{key} must be a boolean.")
    return val


def _opt_int(
    obj: Mapping[str, Any], key: str, path: str, *, non_negative: bool = False
) -> int | None:
    if key not in obj:
        return None
    val = obj[key]
    if not is_json_int(val) or (non_negative and val < 0):
        kind = "a non-negative integer" if non_negative else "an integer"
        raise A2uiCatalogError(f"{path}.{key} must be {kind}.")
    return int(val)


def _opt_number(obj: Mapping[str, Any], key: str, path: str) -> float | None:
    if key not in obj:
        return None
    val = obj[key]
    if not is_json_number(val):
        raise A2uiCatalogError(f"{path}.{key} must be a finite number.")
    return float(val) if isinstance(val, float) else val


def _require_uax31(value: Any, context: str) -> str:
    if not isinstance(value, str) or not is_valid_uax31_identifier(value):
        raise A2uiCatalogError(f"Invalid UAX #31 {context}: {value!r}")
    return value


def _validate_pattern(pattern: str, path: str) -> None:
    try:
        compile_guarded(pattern)
    except A2uiExpressionError as err:
        raise A2uiCatalogError(
            f"{path}.pattern: invalid or unsafe regex pattern: {err}"
        ) from err


def _check_bounds(
    lo: int | float | None,
    hi: int | float | None,
    lo_name: str,
    hi_name: str,
    path: str,
) -> None:
    if lo is not None and hi is not None and lo > hi:
        raise A2uiCatalogError(
            f"{path}: {lo_name} ({lo}) must not exceed {hi_name} ({hi})."
        )


def _opt_metadata(obj: Mapping[str, Any], key: str, path: str) -> dict[str, Any] | None:
    if key not in obj:
        return None
    raw = obj[key]
    if not isinstance(raw, Mapping):
        raise A2uiCatalogError(f"{path}.{key} must be an object.")
    meta_path = f"{path}.{key}"
    _check_allowed_keys(raw, frozenset({"extensions"}), meta_path)
    if "extensions" not in raw:
        return {}
    extensions = raw["extensions"]
    if not isinstance(extensions, Mapping):
        raise A2uiCatalogError(f"{meta_path}.extensions must be an object.")
    for ext_key in extensions:
        _require_uax31(ext_key, f"extension key in {meta_path}.extensions")
    return clone_metadata(raw)


def _opt_unique_id_list(
    obj: Mapping[str, Any], key: str, path: str
) -> tuple[str, ...] | None:
    if key not in obj:
        return None
    raw = obj[key]
    full_path = f"{path}.{key}"
    if not isinstance(raw, list):
        raise A2uiCatalogError(f"{full_path} must be an array of identifiers.")
    seen: set[str] = set()
    result: list[str] = []
    for idx, item in enumerate(raw):
        ident = _require_uax31(item, f"identifier at {full_path}[{idx}]")
        if ident in seen:
            raise A2uiCatalogError(f"{full_path} contains duplicate entry {ident!r}.")
        seen.add(ident)
        result.append(ident)
    return tuple(result)


def _opt_at_least_one_of(
    obj: Mapping[str, Any], path: str, declared_names: set[str]
) -> tuple[tuple[str, ...], ...]:
    if "atLeastOneOf" not in obj:
        return ()
    raw = obj["atLeastOneOf"]
    if not isinstance(raw, list) or not raw:
        raise A2uiCatalogError(
            f"{path}.atLeastOneOf must be a non-empty array of identifier arrays."
        )
    groups: list[tuple[str, ...]] = []
    for idx, group in enumerate(raw):
        if not isinstance(group, list) or not group:
            raise A2uiCatalogError(
                f"{path}.atLeastOneOf[{idx}] must be a non-empty array."
            )
        seen: set[str] = set()
        names: list[str] = []
        for jdx, entry in enumerate(group):
            ident = _require_uax31(
                entry, f"identifier at {path}.atLeastOneOf[{idx}][{jdx}]"
            )
            if ident in seen:
                raise A2uiCatalogError(
                    f"{path}.atLeastOneOf[{idx}] contains duplicate entry {ident!r}."
                )
            if ident not in declared_names:
                raise A2uiCatalogError(
                    f"{path}.atLeastOneOf[{idx}] references undeclared parameter"
                    f" {ident!r}."
                )
            seen.add(ident)
            names.append(ident)
        groups.append(tuple(names))
    return tuple(groups)


def _opt_additional_type(
    obj: Mapping[str, Any], key: str, path: str, *, allow_ui_types: bool
) -> bool | TypeDefinition:
    if key not in obj:
        return False
    raw = obj[key]
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, Mapping):
        return _parse_type(
            raw,
            f"{path}.{key}",
            allow_ui_types=allow_ui_types,
            allow_param_fields=False,
        )
    raise A2uiCatalogError(f"{path}.{key} must be a boolean or type object.")


def _value_matches_enum_type(value: Any, value_type: EnumValueType) -> bool:
    if value_type == "string":
        return isinstance(value, str)
    if value_type == "boolean":
        return isinstance(value, bool)
    return is_json_number(value)


def _enum_unique_key(value: EnumValue) -> tuple[type, EnumValue]:
    if isinstance(value, bool):
        return (bool, value)
    if isinstance(value, (int, float)):
        return (float, float(value))
    return (str, value)


def _parse_string_format(
    raw: Mapping[str, Any], path: str
) -> str | tuple[str, ...] | None:
    if "format" not in raw:
        return None
    fmt_raw = raw["format"]
    if isinstance(fmt_raw, str):
        if not fmt_raw:
            raise A2uiCatalogError(f"{path}.format must be a non-empty string.")
        return fmt_raw
    if isinstance(fmt_raw, list) and fmt_raw:
        seen: set[str] = set()
        items: list[str] = []
        for idx, item in enumerate(fmt_raw):
            if not isinstance(item, str) or not item:
                raise A2uiCatalogError(
                    f"{path}.format[{idx}] must be a non-empty string."
                )
            if item in seen:
                raise A2uiCatalogError(
                    f"{path}.format contains duplicate entry {item!r}."
                )
            seen.add(item)
            items.append(item)
        return tuple(items)
    raise A2uiCatalogError(
        f"{path}.format must be a non-empty string or non-empty string array."
    )


def _parse_type(
    raw: Any,
    path: str,
    *,
    allow_ui_types: bool,
    allow_param_fields: bool,
) -> TypeDefinition:
    if not isinstance(raw, Mapping):
        raise A2uiCatalogError(f"{path} must be an object.")
    kind = raw.get("type")
    if not isinstance(kind, str) or kind not in _TYPE_KEYS_BY_KIND:
        raise A2uiCatalogError(f"{path}: unsupported or missing type {kind!r}.")
    if not allow_ui_types and kind in _UI_TYPE_NAMES:
        raise A2uiCatalogError(
            f"{path}: UI type {kind!r} is only allowed inside component parameters."
        )

    allowed_keys = _TYPE_KEYS_BY_KIND[kind]
    if allow_param_fields:
        allowed_keys = allowed_keys | _PARAM_IDENTITY_KEYS
    _check_allowed_keys(raw, allowed_keys, path)

    meta: dict[str, Any] = {
        "description": _opt_str(raw, "description", path),
        "deprecated": _opt_bool(raw, "deprecated", path),
        "deprecated_reason": _opt_str(raw, "deprecatedReason", path),
    }

    marker_cls = _MARKER_TYPE_CLS.get(kind)
    if marker_cls is not None:
        return marker_cls(**meta)

    if kind == "string":
        pattern = _opt_str(raw, "pattern", path)
        if pattern is not None:
            _validate_pattern(pattern, path)
        min_len = _opt_int(raw, "minLength", path, non_negative=True)
        max_len = _opt_int(raw, "maxLength", path, non_negative=True)
        _check_bounds(min_len, max_len, "minLength", "maxLength", path)
        return StringType(
            dynamic=_opt_bool(raw, "dynamic", path),
            format=_parse_string_format(raw, path),
            pattern=pattern,
            min_length=min_len,
            max_length=max_len,
            default=_opt_str(raw, "default", path),
            **meta,
        )

    if kind == "number":
        lo = _opt_number(raw, "min", path)
        hi = _opt_number(raw, "max", path)
        _check_bounds(lo, hi, "min", "max", path)
        return NumberType(
            dynamic=_opt_bool(raw, "dynamic", path),
            min=lo,
            max=hi,
            default=_opt_number(raw, "default", path),
            **meta,
        )

    if kind == "integer":
        lo_i = _opt_int(raw, "min", path)
        hi_i = _opt_int(raw, "max", path)
        _check_bounds(lo_i, hi_i, "min", "max", path)
        return IntegerType(
            dynamic=_opt_bool(raw, "dynamic", path),
            min=lo_i,
            max=hi_i,
            default=_opt_int(raw, "default", path),
            **meta,
        )

    if kind == "boolean":
        default_bool: bool | None = None
        if "default" in raw:
            if not isinstance(raw["default"], bool):
                raise A2uiCatalogError(f"{path}.default must be a boolean.")
            default_bool = raw["default"]
        return BooleanType(
            dynamic=_opt_bool(raw, "dynamic", path), default=default_bool, **meta
        )

    if kind == "enum":
        raw_vt = raw["valueType"] if "valueType" in raw else "string"
        if not isinstance(raw_vt, str) or raw_vt not in _ENUM_VALUE_TYPES:
            raise A2uiCatalogError(
                f"{path}.valueType must be one of 'string', 'number', 'boolean'."
            )
        value_type = cast(EnumValueType, raw_vt)
        raw_values = raw.get("values")
        if not isinstance(raw_values, list) or not raw_values:
            raise A2uiCatalogError(f"{path}.values must be a non-empty array.")
        seen_vals: set[tuple[type, EnumValue]] = set()
        values: list[EnumValue] = []
        for idx, item in enumerate(raw_values):
            if not (isinstance(item, (str, bool)) or is_json_number(item)):
                raise A2uiCatalogError(
                    f"{path}.values[{idx}] must be a string, number, or boolean."
                )
            if not _value_matches_enum_type(item, value_type):
                raise A2uiCatalogError(
                    f"{path}.values[{idx}]={item!r} does not match"
                    f" valueType={value_type!r}."
                )
            uniq = _enum_unique_key(item)
            if uniq in seen_vals:
                raise A2uiCatalogError(
                    f"{path}.values contains duplicate value {item!r}."
                )
            seen_vals.add(uniq)
            values.append(item)
        default_enum: EnumValue | None = None
        if "default" in raw:
            dv = raw["default"]
            if not (isinstance(dv, (str, bool)) or is_json_number(dv)):
                raise A2uiCatalogError(
                    f"{path}.default must be a string, number, or boolean."
                )
            if _enum_unique_key(dv) not in seen_vals:
                raise A2uiCatalogError(
                    f"{path}.default={dv!r} must be one of the declared enum values."
                )
            default_enum = dv
        return EnumType(
            values=tuple(values),
            value_type=value_type,
            dynamic=_opt_bool(raw, "dynamic", path),
            default=default_enum,
            **meta,
        )

    if kind == "const":
        if "value" not in raw:
            raise A2uiCatalogError(f"{path}.value is required for const type.")
        val = raw["value"]
        if val is not None and not (
            isinstance(val, (str, bool)) or is_json_number(val)
        ):
            raise A2uiCatalogError(
                f"{path}.value must be a string, number, boolean, or null."
            )
        return ConstType(value=cast(ConstValue, val), **meta)

    if kind == "any":
        default_any = copy.deepcopy(raw["default"]) if "default" in raw else UNSET
        return AnyType(
            dynamic=_opt_bool(raw, "dynamic", path),
            nullable=_opt_bool(raw, "nullable", path),
            default=default_any,
            **meta,
        )

    if kind == "ref":
        if "ref" not in raw:
            raise A2uiCatalogError(f"{path}.ref is required for ref type.")
        ref_name = _require_uax31(raw["ref"], f"type ref at {path}.ref")
        default_ref = copy.deepcopy(raw["default"]) if "default" in raw else UNSET
        return RefType(ref=ref_name, default=default_ref, **meta)

    if kind == "object":
        props = _opt_parameters(raw, "properties", path, allow_ui_types=allow_ui_types)
        at_least = _opt_at_least_one_of(raw, path, {p.name for p in props})
        ap = _opt_additional_type(
            raw, "additionalProperties", path, allow_ui_types=allow_ui_types
        )
        default_obj: Mapping[str, Any] | None = None
        if "default" in raw:
            if not isinstance(raw["default"], Mapping):
                raise A2uiCatalogError(f"{path}.default must be an object.")
            default_obj = copy.deepcopy(dict(raw["default"]))
        return ObjectType(
            dynamic=_opt_bool(raw, "dynamic", path),
            properties=props,
            additional_properties=ap,
            at_least_one_of=at_least,
            default=default_obj,
            **meta,
        )

    if kind == "array":
        items: TypeDefinition | None = None
        if "items" in raw:
            items = _parse_type(
                raw["items"],
                f"{path}.items",
                allow_ui_types=allow_ui_types,
                allow_param_fields=False,
            )
        min_items = _opt_int(raw, "minItems", path, non_negative=True)
        max_items = _opt_int(raw, "maxItems", path, non_negative=True)
        _check_bounds(min_items, max_items, "minItems", "maxItems", path)
        default_arr: tuple[Any, ...] | None = None
        if "default" in raw:
            if not isinstance(raw["default"], list):
                raise A2uiCatalogError(f"{path}.default must be an array.")
            default_arr = tuple(copy.deepcopy(raw["default"]))
        return ArrayType(
            dynamic=_opt_bool(raw, "dynamic", path),
            items=items,
            min_items=min_items,
            max_items=max_items,
            unique_items=_opt_bool(raw, "uniqueItems", path),
            default=default_arr,
            **meta,
        )

    # kind == "union"
    raw_variants = raw.get("variants")
    if not isinstance(raw_variants, list) or len(raw_variants) < 2:
        raise A2uiCatalogError(
            f"{path}.variants must be an array of at least 2 type variants."
        )
    variants = tuple(
        _parse_type(
            v,
            f"{path}.variants[{idx}]",
            allow_ui_types=allow_ui_types,
            allow_param_fields=False,
        )
        for idx, v in enumerate(raw_variants)
    )
    default_u = copy.deepcopy(raw["default"]) if "default" in raw else UNSET
    return UnionType(
        variants=variants,
        exclusive=_opt_bool(raw, "exclusive", path, default=True),
        dynamic=_opt_bool(raw, "dynamic", path),
        default=default_u,
        **meta,
    )


def _opt_parameters(
    obj: Mapping[str, Any],
    key: str,
    parent_path: str,
    *,
    allow_ui_types: bool,
    forbid_reserved_component_names: bool = False,
) -> tuple[ParameterDefinition, ...]:
    if key not in obj:
        return ()
    raw = obj[key]
    path = f"{parent_path}.{key}"
    if not isinstance(raw, list):
        raise A2uiCatalogError(f"{path} must be an array of parameter objects.")
    seen: set[str] = set()
    params: list[ParameterDefinition] = []
    for idx, item in enumerate(raw):
        item_path = f"{path}[{idx}]"
        if not isinstance(item, Mapping):
            raise A2uiCatalogError(f"{item_path} must be an object.")
        if "name" not in item:
            raise A2uiCatalogError(f"{item_path} is missing required 'name'.")
        name = _require_uax31(item["name"], f"parameter identifier at {item_path}")
        if forbid_reserved_component_names and name in _RESERVED_COMPONENT_PARAM_NAMES:
            raise A2uiCatalogError(
                f"{path}: parameter name {name!r} is reserved for the component"
                " envelope."
            )
        if name in seen:
            raise A2uiCatalogError(f"{path} contains duplicate parameter {name!r}.")
        seen.add(name)
        required = _opt_bool(item, "required", item_path)
        param_type = _parse_type(
            item,
            f"{path}.{name}",
            allow_ui_types=allow_ui_types,
            allow_param_fields=True,
        )
        params.append(
            ParameterDefinition(name=name, type=param_type, required=required)
        )
    return tuple(params)


def _parse_return_type(raw: Any, path: str) -> FunctionReturnDefinition:
    if isinstance(raw, str):
        if raw not in _RETURN_SHORTHANDS:
            raise A2uiCatalogError(f"{path}: unsupported returnType shorthand {raw!r}.")
        return cast(FunctionReturnShorthand, raw)
    if isinstance(raw, Mapping):
        kind = raw.get("type")
        if kind == "void":
            _check_allowed_keys(raw, frozenset({"type", "description"}), path)
            return VoidReturnType(description=_opt_str(raw, "description", path))
        if kind == "validationResult":
            _check_allowed_keys(raw, frozenset({"type", "description"}), path)
            return ValidationResultReturnType(
                description=_opt_str(raw, "description", path)
            )
        parsed = _parse_type(raw, path, allow_ui_types=False, allow_param_fields=False)
        return cast(DataTypeDefinition, parsed)
    raise A2uiCatalogError(
        f"{path} must be a returnType shorthand string or a DataType object."
    )


def _iter_unguarded_refs(type_def: TypeDefinition) -> Iterator[str]:
    """Yields `RefType` targets reachable without crossing an `ObjectType` or `ArrayType`.

    Cycles that cross an `ObjectType` or `ArrayType` represent valid structural
    recursion (for example `TreeNode -> Object(children=Array(Ref(TreeNode)))`).
    Cycles that stay within `RefType` / `UnionType` are unguarded alias cycles
    and are rejected.
    """
    if isinstance(type_def, RefType):
        yield type_def.ref
    elif isinstance(type_def, UnionType):
        for variant in type_def.variants:
            yield from _iter_unguarded_refs(variant)


def _validate_type_semantics(
    type_def: TypeDefinition,
    path: str,
    *,
    defined_types: Mapping[str, DataTypeDefinition],
    allow_ui_types: bool,
) -> None:
    if not allow_ui_types and contains_ui_type(type_def):
        raise A2uiCatalogError(
            f"{path}: UI types are only allowed inside component parameters."
        )
    if isinstance(type_def, RefType):
        if type_def.ref not in defined_types:
            raise A2uiCatalogError(
                f"{path}: unresolved local type ref {type_def.ref!r}."
            )
        return
    if isinstance(type_def, StringType):
        if type_def.pattern is not None:
            _validate_pattern(type_def.pattern, path)
        if type_def.min_length is not None and type_def.min_length < 0:
            raise A2uiCatalogError(f"{path}.minLength must be non-negative.")
        if type_def.max_length is not None and type_def.max_length < 0:
            raise A2uiCatalogError(f"{path}.maxLength must be non-negative.")
        _check_bounds(
            type_def.min_length, type_def.max_length, "minLength", "maxLength", path
        )
        return
    if isinstance(type_def, (NumberType, IntegerType)):
        _check_bounds(type_def.min, type_def.max, "min", "max", path)
        return
    if isinstance(type_def, EnumType):
        if not type_def.values:
            raise A2uiCatalogError(f"{path}.values must be non-empty.")
        seen: set[tuple[type, EnumValue]] = set()
        for idx, item in enumerate(type_def.values):
            if not _value_matches_enum_type(item, type_def.value_type):
                raise A2uiCatalogError(
                    f"{path}.values[{idx}]={item!r} does not match"
                    f" valueType={type_def.value_type!r}."
                )
            key = _enum_unique_key(item)
            if key in seen:
                raise A2uiCatalogError(
                    f"{path}.values contains duplicate value {item!r}."
                )
            seen.add(key)
        if (
            type_def.default is not None
            and _enum_unique_key(type_def.default) not in seen
        ):
            raise A2uiCatalogError(
                f"{path}.default={type_def.default!r} must be one of the declared"
                " enum values."
            )
        return
    if isinstance(type_def, ArrayType):
        if type_def.min_items is not None and type_def.min_items < 0:
            raise A2uiCatalogError(f"{path}.minItems must be non-negative.")
        if type_def.max_items is not None and type_def.max_items < 0:
            raise A2uiCatalogError(f"{path}.maxItems must be non-negative.")
        _check_bounds(
            type_def.min_items, type_def.max_items, "minItems", "maxItems", path
        )
    elif isinstance(type_def, UnionType):
        if len(type_def.variants) < 2:
            raise A2uiCatalogError(
                f"{path}.variants must contain at least 2 type variants."
            )
    elif isinstance(type_def, ObjectType):
        _validate_parameter_tuple(
            type_def.properties,
            f"{path}.properties",
            defined_types=defined_types,
            allow_ui_types=allow_ui_types,
        )
        _validate_at_least_one_of_groups(
            type_def.at_least_one_of, path, {p.name for p in type_def.properties}
        )
        if not isinstance(type_def.additional_properties, bool):
            _validate_type_semantics(
                type_def.additional_properties,
                f"{path}.additionalProperties",
                defined_types=defined_types,
                allow_ui_types=allow_ui_types,
            )
        return

    for child in iter_child_types(type_def):
        _validate_type_semantics(
            child, path, defined_types=defined_types, allow_ui_types=allow_ui_types
        )


def _validate_parameter_tuple(
    params: tuple[ParameterDefinition, ...],
    path: str,
    *,
    defined_types: Mapping[str, DataTypeDefinition],
    allow_ui_types: bool,
    forbid_reserved_component_names: bool = False,
) -> None:
    seen: set[str] = set()
    for p in params:
        _require_uax31(p.name, f"parameter identifier at {path}")
        if (
            forbid_reserved_component_names
            and p.name in _RESERVED_COMPONENT_PARAM_NAMES
        ):
            raise A2uiCatalogError(
                f"{path}: parameter name {p.name!r} is reserved for the component"
                " envelope."
            )
        if p.name in seen:
            raise A2uiCatalogError(f"{path} contains duplicate parameter {p.name!r}.")
        seen.add(p.name)
        _validate_type_semantics(
            p.type,
            f"{path}.{p.name}",
            defined_types=defined_types,
            allow_ui_types=allow_ui_types,
        )


def _validate_at_least_one_of_groups(
    groups: tuple[tuple[str, ...], ...], path: str, declared: set[str]
) -> None:
    for idx, group in enumerate(groups):
        if not group:
            raise A2uiCatalogError(
                f"{path}.atLeastOneOf[{idx}] must be a non-empty array."
            )
        seen: set[str] = set()
        for name in group:
            _require_uax31(name, f"identifier at {path}.atLeastOneOf[{idx}]")
            if name in seen:
                raise A2uiCatalogError(
                    f"{path}.atLeastOneOf[{idx}] contains duplicate entry {name!r}."
                )
            if name not in declared:
                raise A2uiCatalogError(
                    f"{path}.atLeastOneOf[{idx}] references undeclared parameter"
                    f" {name!r}."
                )
            seen.add(name)


def validate_catalog_model(model: CatalogModel) -> None:
    """Validates all structural and semantic invariants of a `CatalogModel`.

    Enforces identifier rules, reserved names, unique declarations, UI-type
    placement, local `RefType` resolution, and linear $O(V + E)$ detection of
    unguarded alias cycles (while permitting structural recursion through
    `ObjectType` and `ArrayType`).
    """
    if not isinstance(model.catalog_id, str) or not model.catalog_id:
        raise A2uiCatalogError("catalog_id must be a non-empty string.")

    defined = model.types
    for t_name, t_def in defined.items():
        _require_uax31(t_name, "type identifier in catalog.types")
        _validate_type_semantics(
            t_def,
            f"types.{t_name}",
            defined_types=defined,
            allow_ui_types=False,
        )

    # 3-color DFS (0=unvisited, 1=visiting, 2=done) for O(V + E) alias cycle check.
    color: dict[str, int] = {}
    stack: list[str] = []

    def _dfs_alias(name: str) -> None:
        state = color.get(name, 0)
        if state == 2:
            return
        if state == 1:
            start = stack.index(name)
            cycle = " -> ".join([*stack[start:], name])
            raise A2uiCatalogError(f"Circular local type ref in types: {cycle}")
        color[name] = 1
        stack.append(name)
        for target in _iter_unguarded_refs(defined[name]):
            if target in defined:
                _dfs_alias(target)
        stack.pop()
        color[name] = 2

    for t_name in defined:
        if color.get(t_name, 0) == 0:
            _dfs_alias(t_name)

    if model.surface_properties is not None:
        sp = model.surface_properties
        _validate_parameter_tuple(
            sp.properties,
            "surfaceProperties.properties",
            defined_types=defined,
            allow_ui_types=False,
        )
        if not isinstance(sp.additional_properties, bool):
            _validate_type_semantics(
                sp.additional_properties,
                "surfaceProperties.additionalProperties",
                defined_types=defined,
                allow_ui_types=False,
            )

    seen_comps: set[str] = set()
    for comp in model.components:
        _require_uax31(comp.name, "component identifier")
        if comp.name == "Surface":
            raise A2uiCatalogError(
                "Component name 'Surface' is reserved and forbidden."
            )
        if comp.name in seen_comps:
            raise A2uiCatalogError(f"Duplicate component name {comp.name!r}.")
        seen_comps.add(comp.name)
        c_scope = f"components.{comp.name}"
        _validate_parameter_tuple(
            comp.parameters,
            f"{c_scope}.parameters",
            defined_types=defined,
            allow_ui_types=True,
            forbid_reserved_component_names=True,
        )
        _validate_at_least_one_of_groups(
            comp.at_least_one_of, c_scope, {p.name for p in comp.parameters}
        )
        if not isinstance(comp.additional_properties, bool):
            _validate_type_semantics(
                comp.additional_properties,
                f"{c_scope}.additionalProperties",
                defined_types=defined,
                allow_ui_types=True,
            )

    seen_fns: set[str] = set()
    for fn in model.functions:
        if isinstance(fn.name, str) and fn.name.startswith("@"):
            raise A2uiCatalogError(
                f"Function name {fn.name!r} cannot start with '@'; '@' is"
                " reserved for protocol system functions."
            )
        _require_uax31(fn.name, "function identifier")
        if fn.name in seen_fns:
            raise A2uiCatalogError(f"Duplicate function name {fn.name!r}.")
        seen_fns.add(fn.name)
        if fn.requires_user_activation and fn.allowed_callers != "rendererOnly":
            raise A2uiCatalogError(
                f"Function '{fn.name}' declares requiresUserActivation=true with"
                f" allowedCallers='{fn.allowed_callers}'; requiresUserActivation=true"
                " requires allowedCallers='rendererOnly'."
            )
        f_scope = f"functions.{fn.name}"
        if not isinstance(
            fn.return_type, (str, VoidReturnType, ValidationResultReturnType)
        ):
            _validate_type_semantics(
                fn.return_type,
                f"{f_scope}.returnType",
                defined_types=defined,
                allow_ui_types=False,
            )
        _validate_parameter_tuple(
            fn.parameters,
            f"{f_scope}.parameters",
            defined_types=defined,
            allow_ui_types=False,
        )
        _validate_at_least_one_of_groups(
            fn.at_least_one_of, f_scope, {p.name for p in fn.parameters}
        )
        if not isinstance(fn.additional_parameters, bool):
            _validate_type_semantics(
                fn.additional_parameters,
                f"{f_scope}.additionalParameters",
                defined_types=defined,
                allow_ui_types=False,
            )


def parse_catalog_document(
    document: Mapping[str, Any],
    *,
    protocol_version: ProtocolVersion | str | None = None,
    catalog_id: str | None = None,
) -> CatalogModel:
    """Parses and strictly validates a Catalog Document (`formatVersion: "1.0"`).

    Raises:
        A2uiCatalogError: If the document violates any schema or semantic rule.
    """
    if not isinstance(document, Mapping):
        raise A2uiCatalogError("Catalog document must be a JSON object.")
    _check_allowed_keys(document, _ROOT_KEYS, "catalog")

    fmt_ver = document.get("formatVersion")
    if fmt_ver != CATALOG_DOCUMENT_FORMAT_VERSION:
        raise A2uiCatalogError(
            f"Unsupported catalog formatVersion {fmt_ver!r}; expected"
            f" {CATALOG_DOCUMENT_FORMAT_VERSION!r}."
        )

    raw_catalog_id = document.get("catalogId")
    if not isinstance(raw_catalog_id, str) or not raw_catalog_id:
        raise A2uiCatalogError(
            "Catalog document 'catalogId' must be a non-empty string."
        )
    resolved_catalog_id = catalog_id if catalog_id is not None else raw_catalog_id
    if not resolved_catalog_id:
        raise A2uiCatalogError("catalog_id must be a non-empty string.")

    raw_protocol_version: str | None = None
    if "protocolVersion" in document:
        pv_val = document["protocolVersion"]
        if not isinstance(pv_val, str) or not _SEMVER_RE.match(pv_val):
            raise A2uiCatalogError(
                "Catalog document 'protocolVersion' must be a valid SemVer string,"
                f" got {pv_val!r}."
            )
        raw_protocol_version = pv_val

    if protocol_version is not None:
        raw_override = (
            protocol_version.value
            if isinstance(protocol_version, ProtocolVersion)
            else str(protocol_version)
        )
        resolved_pv = to_canonical_version(raw_override) or raw_override
    else:
        resolved_pv = raw_protocol_version or "1.0"

    types_map: dict[str, DataTypeDefinition] = {}
    if "types" in document:
        raw_types = document["types"]
        if not isinstance(raw_types, Mapping):
            raise A2uiCatalogError("catalog.types must be an object.")
        for type_name, type_raw in raw_types.items():
            ident = _require_uax31(type_name, "type identifier in catalog.types")
            parsed_t = _parse_type(
                type_raw,
                f"types.{ident}",
                allow_ui_types=False,
                allow_param_fields=False,
            )
            types_map[ident] = cast(DataTypeDefinition, parsed_t)

    surface_props: SurfacePropertiesDefinition | None = None
    if "surfaceProperties" in document:
        raw_sp = document["surfaceProperties"]
        if not isinstance(raw_sp, Mapping):
            raise A2uiCatalogError("catalog.surfaceProperties must be an object.")
        _check_allowed_keys(raw_sp, _SURFACE_PROPERTIES_KEYS, "surfaceProperties")
        surface_props = SurfacePropertiesDefinition(
            description=_opt_str(raw_sp, "description", "surfaceProperties"),
            properties=_opt_parameters(
                raw_sp, "properties", "surfaceProperties", allow_ui_types=False
            ),
            additional_properties=_opt_additional_type(
                raw_sp,
                "additionalProperties",
                "surfaceProperties",
                allow_ui_types=False,
            ),
        )

    components: list[ComponentDefinition] = []
    if "components" in document:
        raw_components = document["components"]
        if not isinstance(raw_components, list):
            raise A2uiCatalogError("catalog.components must be an array.")
        seen_comps: set[str] = set()
        for idx, raw_comp in enumerate(raw_components):
            c_path = f"components[{idx}]"
            if not isinstance(raw_comp, Mapping):
                raise A2uiCatalogError(f"{c_path} must be an object.")
            _check_allowed_keys(raw_comp, _COMPONENT_KEYS, c_path)
            if "name" not in raw_comp:
                raise A2uiCatalogError(f"{c_path} is missing required 'name'.")
            c_name = _require_uax31(
                raw_comp["name"], f"component identifier at {c_path}"
            )
            if c_name == "Surface":
                raise A2uiCatalogError(
                    "Component name 'Surface' is reserved and forbidden."
                )
            if c_name in seen_comps:
                raise A2uiCatalogError(f"Duplicate component name {c_name!r}.")
            seen_comps.add(c_name)
            c_scope = f"components.{c_name}"
            params = _opt_parameters(
                raw_comp,
                "parameters",
                c_scope,
                allow_ui_types=True,
                forbid_reserved_component_names=True,
            )
            components.append(
                ComponentDefinition(
                    name=c_name,
                    description=_opt_str(raw_comp, "description", c_scope),
                    checkable=_opt_bool(raw_comp, "checkable", c_scope),
                    parameters=params,
                    at_least_one_of=_opt_at_least_one_of(
                        raw_comp, c_scope, {p.name for p in params}
                    ),
                    allowed_parents=_opt_unique_id_list(
                        raw_comp, "allowedParents", c_scope
                    ),
                    allowed_children=_opt_unique_id_list(
                        raw_comp, "allowedChildren", c_scope
                    ),
                    metadata=_opt_metadata(raw_comp, "metadata", c_scope),
                    deprecated=_opt_bool(raw_comp, "deprecated", c_scope),
                    deprecated_reason=_opt_str(raw_comp, "deprecatedReason", c_scope),
                )
            )

    functions: list[FunctionDefinition] = []
    if "functions" in document:
        raw_functions = document["functions"]
        if not isinstance(raw_functions, list):
            raise A2uiCatalogError("catalog.functions must be an array.")
        seen_fns: set[str] = set()
        for idx, raw_fn in enumerate(raw_functions):
            f_path = f"functions[{idx}]"
            if not isinstance(raw_fn, Mapping):
                raise A2uiCatalogError(f"{f_path} must be an object.")
            _check_allowed_keys(raw_fn, _FUNCTION_KEYS, f_path)
            if "name" not in raw_fn:
                raise A2uiCatalogError(f"{f_path} is missing required 'name'.")
            raw_fn_name = raw_fn["name"]
            if isinstance(raw_fn_name, str) and raw_fn_name.startswith("@"):
                raise A2uiCatalogError(
                    f"Function name {raw_fn_name!r} cannot start with '@'; '@' is"
                    " reserved for protocol system functions."
                )
            f_name = _require_uax31(raw_fn_name, f"function identifier at {f_path}")
            if f_name in seen_fns:
                raise A2uiCatalogError(f"Duplicate function name {f_name!r}.")
            seen_fns.add(f_name)
            f_scope = f"functions.{f_name}"
            if "returnType" not in raw_fn:
                raise A2uiCatalogError(f"{f_scope} is missing required 'returnType'.")
            ret_type = _parse_return_type(raw_fn["returnType"], f"{f_scope}.returnType")
            raw_callers = (
                raw_fn["allowedCallers"]
                if "allowedCallers" in raw_fn
                else "rendererOnly"
            )
            if not isinstance(raw_callers, str) or raw_callers not in _ALLOWED_CALLERS:
                raise A2uiCatalogError(
                    f"{f_scope}.allowedCallers must be one of 'rendererOnly',"
                    f" 'agentOnly', 'rendererOrAgent', got {raw_callers!r}."
                )
            allowed_callers = cast(AllowedCallers, raw_callers)
            requires_ua = _opt_bool(raw_fn, "requiresUserActivation", f_scope)
            if requires_ua and allowed_callers != "rendererOnly":
                raise A2uiCatalogError(
                    f"Function '{f_name}' declares requiresUserActivation=true with"
                    f" allowedCallers='{allowed_callers}'; requiresUserActivation=true"
                    " requires allowedCallers='rendererOnly'."
                )
            params = _opt_parameters(
                raw_fn, "parameters", f_scope, allow_ui_types=False
            )
            functions.append(
                FunctionDefinition(
                    name=f_name,
                    return_type=ret_type,
                    description=_opt_str(raw_fn, "description", f_scope),
                    allowed_callers=allowed_callers,
                    requires_user_activation=requires_ua,
                    parameters=params,
                    at_least_one_of=_opt_at_least_one_of(
                        raw_fn, f_scope, {p.name for p in params}
                    ),
                    additional_parameters=_opt_additional_type(
                        raw_fn, "additionalParameters", f_scope, allow_ui_types=False
                    ),
                    deprecated=_opt_bool(raw_fn, "deprecated", f_scope),
                    deprecated_reason=_opt_str(raw_fn, "deprecatedReason", f_scope),
                )
            )

    model = CatalogModel(
        catalog_id=resolved_catalog_id,
        protocol_version=resolved_pv,
        format_version=CATALOG_DOCUMENT_FORMAT_VERSION,
        schema_uri=_opt_str(document, "$schema", "catalog"),
        title=_opt_str(document, "title", "catalog"),
        description=_opt_str(document, "description", "catalog"),
        instructions=_opt_str(document, "instructions", "catalog"),
        metadata=_opt_metadata(document, "metadata", "catalog"),
        types=types_map,
        surface_properties=surface_props,
        components=tuple(components),
        functions=tuple(functions),
    )
    validate_catalog_model(model)
    return model


def _set_if(out: dict[str, Any], key: str, value: Any) -> None:
    if value is not None:
        out[key] = value


def _set_if_true(out: dict[str, Any], key: str, flag: bool) -> None:
    if flag:
        out[key] = True


def _serialize_additional_type(
    ap: bool | TypeDefinition, *, path: str
) -> bool | dict[str, Any]:
    if isinstance(ap, bool):
        return ap
    return _serialize_type(ap, path=path)


def _serialize_type(type_def: TypeDefinition, *, path: str) -> dict[str, Any]:
    if isinstance(type_def, RawJsonSchemaType):
        raise A2uiCatalogError(
            f"{path}: cannot serialize legacy RawJsonSchemaType into a Catalog"
            " Document."
        )
    out: dict[str, Any] = {"type": type_def.type}
    if isinstance(type_def, StringType):
        _set_if_true(out, "dynamic", type_def.dynamic)
        if type_def.format is not None:
            out["format"] = (
                list(type_def.format)
                if isinstance(type_def.format, tuple)
                else type_def.format
            )
        _set_if(out, "pattern", type_def.pattern)
        _set_if(out, "minLength", type_def.min_length)
        _set_if(out, "maxLength", type_def.max_length)
        _set_if(out, "default", type_def.default)
    elif isinstance(type_def, (NumberType, IntegerType)):
        _set_if_true(out, "dynamic", type_def.dynamic)
        _set_if(out, "min", type_def.min)
        _set_if(out, "max", type_def.max)
        _set_if(out, "default", type_def.default)
    elif isinstance(type_def, BooleanType):
        _set_if_true(out, "dynamic", type_def.dynamic)
        _set_if(out, "default", type_def.default)
    elif isinstance(type_def, EnumType):
        _set_if_true(out, "dynamic", type_def.dynamic)
        if type_def.value_type != "string":
            out["valueType"] = type_def.value_type
        out["values"] = list(type_def.values)
        _set_if(out, "default", type_def.default)
    elif isinstance(type_def, ConstType):
        out["value"] = type_def.value
    elif isinstance(type_def, AnyType):
        _set_if_true(out, "dynamic", type_def.dynamic)
        _set_if_true(out, "nullable", type_def.nullable)
        if type_def.default is not UNSET:
            out["default"] = copy.deepcopy(type_def.default)
    elif isinstance(type_def, RefType):
        out["ref"] = type_def.ref
        if type_def.default is not UNSET:
            out["default"] = copy.deepcopy(type_def.default)
    elif isinstance(type_def, ObjectType):
        _set_if_true(out, "dynamic", type_def.dynamic)
        if type_def.properties:
            out["properties"] = [
                _serialize_parameter(p, path=f"{path}.{p.name}")
                for p in type_def.properties
            ]
        if type_def.additional_properties is not False:
            out["additionalProperties"] = _serialize_additional_type(
                type_def.additional_properties,
                path=f"{path}.additionalProperties",
            )
        if type_def.at_least_one_of:
            out["atLeastOneOf"] = [list(g) for g in type_def.at_least_one_of]
        if type_def.default is not None:
            out["default"] = copy.deepcopy(dict(type_def.default))
    elif isinstance(type_def, ArrayType):
        _set_if_true(out, "dynamic", type_def.dynamic)
        if type_def.items is not None:
            out["items"] = _serialize_type(type_def.items, path=f"{path}.items")
        _set_if(out, "minItems", type_def.min_items)
        _set_if(out, "maxItems", type_def.max_items)
        _set_if_true(out, "uniqueItems", type_def.unique_items)
        if type_def.default is not None:
            out["default"] = copy.deepcopy(list(type_def.default))
    elif isinstance(type_def, UnionType):
        _set_if_true(out, "dynamic", type_def.dynamic)
        if not type_def.exclusive:
            out["exclusive"] = False
        out["variants"] = [
            _serialize_type(v, path=f"{path}.variants[{idx}]")
            for idx, v in enumerate(type_def.variants)
        ]
        if type_def.default is not UNSET:
            out["default"] = copy.deepcopy(type_def.default)

    _set_if(out, "description", type_def.description)
    _set_if_true(out, "deprecated", type_def.deprecated)
    _set_if(out, "deprecatedReason", type_def.deprecated_reason)
    return out


def _serialize_parameter(param: ParameterDefinition, *, path: str) -> dict[str, Any]:
    type_dict = _serialize_type(param.type, path=path)
    out: dict[str, Any] = {"name": param.name, "type": type_dict.pop("type")}
    _set_if_true(out, "required", param.required)
    out.update(type_dict)
    return out


def _serialize_return_type(return_type: FunctionReturnDefinition, *, path: str) -> Any:
    if isinstance(return_type, str):
        return return_type
    if isinstance(return_type, VoidReturnType):
        if return_type.description is None:
            return "void"
        return {"type": "void", "description": return_type.description}
    if isinstance(return_type, ValidationResultReturnType):
        if return_type.description is None:
            return "validationResult"
        return {
            "type": "validationResult",
            "description": return_type.description,
        }
    return _serialize_type(return_type, path=path)


def serialize_catalog_document(
    model: CatalogModel,
    *,
    include_schema: bool = False,
) -> dict[str, Any]:
    """Serializes a `CatalogModel` into a canonical Catalog Document dictionary."""
    doc: dict[str, Any] = {}
    if model.schema_uri is not None:
        doc["$schema"] = model.schema_uri
    elif include_schema:
        doc["$schema"] = CATALOG_DOCUMENT_SCHEMA_URI
    doc["formatVersion"] = model.format_version or CATALOG_DOCUMENT_FORMAT_VERSION
    doc["catalogId"] = model.catalog_id
    canonical_pv = (
        to_canonical_version(model.protocol_version) or model.protocol_version
    )
    if canonical_pv:
        doc["protocolVersion"] = canonical_pv
    _set_if(doc, "title", model.title)
    _set_if(doc, "description", model.description)
    _set_if(doc, "instructions", model.instructions)
    if model.metadata is not None:
        doc["metadata"] = clone_metadata(model.metadata)
    if model.types:
        doc["types"] = {
            name: _serialize_type(t_def, path=f"types.{name}")
            for name, t_def in model.types.items()
        }
    if model.surface_properties is not None:
        sp = model.surface_properties
        if sp.raw_schema is not None:
            raise A2uiCatalogError(
                "surfaceProperties: cannot serialize legacy raw JSON Schema into"
                " a Catalog Document."
            )
        sp_doc: dict[str, Any] = {}
        _set_if(sp_doc, "description", sp.description)
        if sp.properties:
            sp_doc["properties"] = [
                _serialize_parameter(p, path=f"surfaceProperties.{p.name}")
                for p in sp.properties
            ]
        if sp.additional_properties is not False:
            sp_doc["additionalProperties"] = _serialize_additional_type(
                sp.additional_properties,
                path="surfaceProperties.additionalProperties",
            )
        doc["surfaceProperties"] = sp_doc

    if model.components:
        comp_docs: list[dict[str, Any]] = []
        for comp in model.components:
            if comp.raw_schema is not None:
                raise A2uiCatalogError(
                    f"components.{comp.name}: cannot serialize legacy raw JSON"
                    " Schema into a Catalog Document."
                )
            if not isinstance(comp.additional_properties, bool):
                raise A2uiCatalogError(
                    f"components.{comp.name}: typed additionalProperties is not"
                    " representable in Catalog Document formatVersion '1.0'."
                )
            c_doc: dict[str, Any] = {"name": comp.name}
            _set_if(c_doc, "description", comp.description)
            _set_if_true(c_doc, "checkable", comp.checkable)
            if comp.parameters:
                c_doc["parameters"] = [
                    _serialize_parameter(p, path=f"components.{comp.name}.{p.name}")
                    for p in comp.parameters
                ]
            if comp.at_least_one_of:
                c_doc["atLeastOneOf"] = [list(g) for g in comp.at_least_one_of]
            if comp.allowed_parents is not None:
                c_doc["allowedParents"] = list(comp.allowed_parents)
            if comp.allowed_children is not None:
                c_doc["allowedChildren"] = list(comp.allowed_children)
            if comp.metadata is not None:
                c_doc["metadata"] = clone_metadata(comp.metadata)
            _set_if_true(c_doc, "deprecated", comp.deprecated)
            _set_if(c_doc, "deprecatedReason", comp.deprecated_reason)
            comp_docs.append(c_doc)
        doc["components"] = comp_docs

    if model.functions:
        fn_docs: list[dict[str, Any]] = []
        for fn in model.functions:
            if fn.raw_args_schema is not None:
                raise A2uiCatalogError(
                    f"functions.{fn.name}: cannot serialize legacy raw JSON"
                    " Schema into a Catalog Document."
                )
            f_doc: dict[str, Any] = {"name": fn.name}
            _set_if(f_doc, "description", fn.description)
            f_doc["returnType"] = _serialize_return_type(
                fn.return_type, path=f"functions.{fn.name}.returnType"
            )
            if fn.allowed_callers != "rendererOnly":
                f_doc["allowedCallers"] = fn.allowed_callers
            _set_if_true(f_doc, "requiresUserActivation", fn.requires_user_activation)
            if fn.parameters:
                f_doc["parameters"] = [
                    _serialize_parameter(p, path=f"functions.{fn.name}.{p.name}")
                    for p in fn.parameters
                ]
            if fn.at_least_one_of:
                f_doc["atLeastOneOf"] = [list(g) for g in fn.at_least_one_of]
            if fn.additional_parameters is not False:
                f_doc["additionalParameters"] = _serialize_additional_type(
                    fn.additional_parameters,
                    path=f"functions.{fn.name}.additionalParameters",
                )
            _set_if_true(f_doc, "deprecated", fn.deprecated)
            _set_if(f_doc, "deprecatedReason", fn.deprecated_reason)
            fn_docs.append(f_doc)
        doc["functions"] = fn_docs

    return doc


__all__ = [
    "CATALOG_DOCUMENT_SCHEMA_URI",
    "is_catalog_document",
    "parse_catalog_document",
    "serialize_catalog_document",
    "validate_catalog_model",
]
