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

"""Parser and serializer for the decoupled A2UI Catalog Document format."""

from __future__ import annotations

from collections.abc import Mapping
import copy
import math
import re
from typing import Any, Final, cast

from ..common.metadata import clone_metadata
from ..common.semver import to_canonical_version
from ..common.uax31 import is_valid_uax31_identifier
from ..exceptions import A2uiCatalogError
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
    "dataBinding": _BASE_TYPE_KEYS,
    "functionCall": _BASE_TYPE_KEYS,
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
    "child": _BASE_TYPE_KEYS,
    "childList": _BASE_TYPE_KEYS,
    "action": _BASE_TYPE_KEYS,
    "checkRule": _BASE_TYPE_KEYS,
    "accessibility": _BASE_TYPE_KEYS,
}


def is_catalog_document(raw: Any) -> bool:
    """Returns whether `raw` is a decoupled A2UI Catalog Document object.

    Any JSON object declaring a string `formatVersion` is recognized as a
    Catalog Document; unsupported versions are rejected by
    `parse_catalog_document` with `A2uiCatalogError`.
    """
    return isinstance(raw, Mapping) and isinstance(raw.get("formatVersion"), str)


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


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


def _opt_non_neg_int(obj: Mapping[str, Any], key: str, path: str) -> int | None:
    if key not in obj:
        return None
    val = obj[key]
    if not _is_int(val) or val < 0:
        raise A2uiCatalogError(f"{path}.{key} must be a non-negative integer.")
    return int(val)


def _opt_int(obj: Mapping[str, Any], key: str, path: str) -> int | None:
    if key not in obj:
        return None
    val = obj[key]
    if not _is_int(val):
        raise A2uiCatalogError(f"{path}.{key} must be an integer.")
    return int(val)


def _opt_number(obj: Mapping[str, Any], key: str, path: str) -> float | None:
    if key not in obj:
        return None
    val = obj[key]
    if not _is_number(val):
        raise A2uiCatalogError(f"{path}.{key} must be a finite number.")
    return float(val) if isinstance(val, float) else val


def _require_uax31(value: Any, context: str) -> str:
    if not isinstance(value, str) or not is_valid_uax31_identifier(value):
        raise A2uiCatalogError(f"Invalid UAX #31 {context}: {value!r}")
    return value


def _parse_metadata(raw: Any, path: str) -> dict[str, Any] | None:
    if raw is None:
        return None
    if not isinstance(raw, Mapping):
        raise A2uiCatalogError(f"{path} must be an object.")
    _check_allowed_keys(raw, frozenset({"extensions"}), path)
    if "extensions" not in raw:
        return {}
    extensions = raw["extensions"]
    if not isinstance(extensions, Mapping):
        raise A2uiCatalogError(f"{path}.extensions must be an object.")
    for ext_key in extensions:
        _require_uax31(ext_key, f"extension key in {path}.extensions")
    return clone_metadata(raw)


def _parse_unique_id_list(raw: Any, path: str) -> tuple[str, ...] | None:
    if raw is None:
        return None
    if not isinstance(raw, list):
        raise A2uiCatalogError(f"{path} must be an array of identifiers.")
    seen: set[str] = set()
    result: list[str] = []
    for idx, item in enumerate(raw):
        ident = _require_uax31(item, f"identifier at {path}[{idx}]")
        if ident in seen:
            raise A2uiCatalogError(f"{path} contains duplicate entry {ident!r}.")
        seen.add(ident)
        result.append(ident)
    return tuple(result)


def _parse_at_least_one_of(
    raw: Any, path: str, declared_names: set[str]
) -> tuple[tuple[str, ...], ...]:
    if raw is None:
        return ()
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


def _value_matches_enum_type(value: Any, value_type: EnumValueType) -> bool:
    if value_type == "string":
        return isinstance(value, str)
    if value_type == "boolean":
        return isinstance(value, bool)
    return _is_number(value)


def _enum_unique_key(value: EnumValue) -> tuple[type, EnumValue]:
    if isinstance(value, bool):
        return (bool, value)
    if isinstance(value, (int, float)):
        return (float, float(value))
    return (str, value)


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

    description = _opt_str(raw, "description", path)
    deprecated = _opt_bool(raw, "deprecated", path)
    deprecated_reason = _opt_str(raw, "deprecatedReason", path)

    if kind == "string":
        fmt_raw = raw.get("format")
        fmt: str | tuple[str, ...] | None = None
        if fmt_raw is not None:
            if isinstance(fmt_raw, str):
                if not fmt_raw:
                    raise A2uiCatalogError(f"{path}.format must be a non-empty string.")
                fmt = fmt_raw
            elif isinstance(fmt_raw, list) and fmt_raw:
                seen_fmt: set[str] = set()
                fmt_items: list[str] = []
                for idx, item in enumerate(fmt_raw):
                    if not isinstance(item, str) or not item:
                        raise A2uiCatalogError(
                            f"{path}.format[{idx}] must be a non-empty string."
                        )
                    if item in seen_fmt:
                        raise A2uiCatalogError(
                            f"{path}.format contains duplicate entry {item!r}."
                        )
                    seen_fmt.add(item)
                    fmt_items.append(item)
                fmt = tuple(fmt_items)
            else:
                raise A2uiCatalogError(
                    f"{path}.format must be a non-empty string or non-empty string"
                    " array."
                )
        return StringType(
            dynamic=_opt_bool(raw, "dynamic", path),
            format=fmt,
            pattern=_opt_str(raw, "pattern", path),
            min_length=_opt_non_neg_int(raw, "minLength", path),
            max_length=_opt_non_neg_int(raw, "maxLength", path),
            default=_opt_str(raw, "default", path),
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    if kind == "number":
        return NumberType(
            dynamic=_opt_bool(raw, "dynamic", path),
            min=_opt_number(raw, "min", path),
            max=_opt_number(raw, "max", path),
            default=_opt_number(raw, "default", path),
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    if kind == "integer":
        return IntegerType(
            dynamic=_opt_bool(raw, "dynamic", path),
            min=_opt_int(raw, "min", path),
            max=_opt_int(raw, "max", path),
            default=_opt_int(raw, "default", path),
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    if kind == "boolean":
        default_bool: bool | None = None
        if "default" in raw:
            if not isinstance(raw["default"], bool):
                raise A2uiCatalogError(f"{path}.default must be a boolean.")
            default_bool = raw["default"]
        return BooleanType(
            dynamic=_opt_bool(raw, "dynamic", path),
            default=default_bool,
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    if kind == "enum":
        raw_vt = raw.get("valueType", "string")
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
            if not (isinstance(item, (str, bool)) or _is_number(item)):
                raise A2uiCatalogError(
                    f"{path}.values[{idx}] must be a string, number, or boolean."
                )
            if "valueType" in raw and not _value_matches_enum_type(item, value_type):
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
            if not (isinstance(dv, (str, bool)) or _is_number(dv)):
                raise A2uiCatalogError(
                    f"{path}.default must be a string, number, or boolean."
                )
            default_enum = dv
        return EnumType(
            values=tuple(values),
            value_type=value_type,
            dynamic=_opt_bool(raw, "dynamic", path),
            default=default_enum,
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    if kind == "const":
        if "value" not in raw:
            raise A2uiCatalogError(f"{path}.value is required for const type.")
        val = raw["value"]
        if val is not None and not (isinstance(val, (str, bool)) or _is_number(val)):
            raise A2uiCatalogError(
                f"{path}.value must be a string, number, boolean, or null."
            )
        return ConstType(
            value=cast(ConstValue, val),
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    if kind == "any":
        default_any = copy.deepcopy(raw["default"]) if "default" in raw else UNSET
        return AnyType(
            dynamic=_opt_bool(raw, "dynamic", path),
            nullable=_opt_bool(raw, "nullable", path),
            default=default_any,
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    if kind == "dataBinding":
        return DataBindingType(
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    if kind == "functionCall":
        return FunctionCallType(
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    if kind == "ref":
        if "ref" not in raw:
            raise A2uiCatalogError(f"{path}.ref is required for ref type.")
        ref_name = _require_uax31(raw["ref"], f"type ref at {path}.ref")
        default_ref = copy.deepcopy(raw["default"]) if "default" in raw else UNSET
        return RefType(
            ref=ref_name,
            default=default_ref,
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    if kind == "object":
        props = _parse_parameters(
            raw.get("properties"), f"{path}.properties", allow_ui_types=allow_ui_types
        )
        prop_names = {p.name for p in props}
        at_least_one_of = _parse_at_least_one_of(
            raw.get("atLeastOneOf"), path, prop_names
        )
        ap_raw = raw.get("additionalProperties", False)
        ap: bool | TypeDefinition
        if isinstance(ap_raw, bool):
            ap = ap_raw
        elif isinstance(ap_raw, Mapping):
            ap = _parse_type(
                ap_raw,
                f"{path}.additionalProperties",
                allow_ui_types=allow_ui_types,
                allow_param_fields=False,
            )
        else:
            raise A2uiCatalogError(
                f"{path}.additionalProperties must be a boolean or type object."
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
            at_least_one_of=at_least_one_of,
            default=default_obj,
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
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
        default_arr: tuple[Any, ...] | None = None
        if "default" in raw:
            if not isinstance(raw["default"], list):
                raise A2uiCatalogError(f"{path}.default must be an array.")
            default_arr = tuple(copy.deepcopy(raw["default"]))
        return ArrayType(
            dynamic=_opt_bool(raw, "dynamic", path),
            items=items,
            min_items=_opt_non_neg_int(raw, "minItems", path),
            max_items=_opt_non_neg_int(raw, "maxItems", path),
            unique_items=_opt_bool(raw, "uniqueItems", path),
            default=default_arr,
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    if kind == "union":
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
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    if kind == "child":
        return ChildType(
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )
    if kind == "childList":
        return ChildListType(
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )
    if kind == "action":
        return ActionType(
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )
    if kind == "checkRule":
        return CheckRuleType(
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )
    return AccessibilityType(
        description=description,
        deprecated=deprecated,
        deprecated_reason=deprecated_reason,
    )


def _parse_parameters(
    raw: Any, path: str, *, allow_ui_types: bool
) -> tuple[ParameterDefinition, ...]:
    if raw is None:
        return ()
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


def _validate_local_refs(model: CatalogModel) -> None:
    """Ensures every `RefType` resolves to `model.types` and `types` is acyclic."""
    defined = model.types

    def _walk(type_def: TypeDefinition, path: str) -> None:
        if isinstance(type_def, RefType):
            if type_def.ref not in defined:
                raise A2uiCatalogError(
                    f"{path}: unresolved local type ref {type_def.ref!r}."
                )
        elif isinstance(type_def, ObjectType):
            for prop in type_def.properties:
                _walk(prop.type, f"{path}.{prop.name}")
            if not isinstance(type_def.additional_properties, bool):
                _walk(type_def.additional_properties, f"{path}.additionalProperties")
        elif isinstance(type_def, ArrayType):
            if type_def.items is not None:
                _walk(type_def.items, f"{path}.items")
        elif isinstance(type_def, UnionType):
            for idx, variant in enumerate(type_def.variants):
                _walk(variant, f"{path}.variants[{idx}]")

    def _check_cycles(name: str, stack: list[str]) -> None:
        if name in stack:
            cycle = " -> ".join([*stack, name])
            raise A2uiCatalogError(f"Circular local type ref in types: {cycle}")
        type_def = defined[name]
        next_stack = [*stack, name]

        def _visit(t: TypeDefinition) -> None:
            if isinstance(t, RefType):
                if t.ref in defined:
                    _check_cycles(t.ref, next_stack)
            elif isinstance(t, ObjectType):
                for p in t.properties:
                    _visit(p.type)
                if not isinstance(t.additional_properties, bool):
                    _visit(t.additional_properties)
            elif isinstance(t, ArrayType) and t.items is not None:
                _visit(t.items)
            elif isinstance(t, UnionType):
                for v in t.variants:
                    _visit(v)

        _visit(type_def)

    for t_name, t_def in defined.items():
        _walk(t_def, f"types.{t_name}")
    for t_name in defined:
        _check_cycles(t_name, [])

    if model.surface_properties is not None:
        for prop in model.surface_properties.properties:
            _walk(prop.type, f"surfaceProperties.{prop.name}")
        if not isinstance(model.surface_properties.additional_properties, bool):
            _walk(
                model.surface_properties.additional_properties,
                "surfaceProperties.additionalProperties",
            )

    for comp in model.components:
        for param in comp.parameters:
            _walk(param.type, f"components.{comp.name}.{param.name}")

    for fn in model.functions:
        if not isinstance(
            fn.return_type, (str, VoidReturnType, ValidationResultReturnType)
        ):
            _walk(fn.return_type, f"functions.{fn.name}.returnType")
        for param in fn.parameters:
            _walk(param.type, f"functions.{fn.name}.{param.name}")
        if not isinstance(fn.additional_parameters, bool):
            _walk(
                fn.additional_parameters,
                f"functions.{fn.name}.additionalParameters",
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

    raw_protocol_version = document.get("protocolVersion")
    if raw_protocol_version is not None:
        if not isinstance(raw_protocol_version, str) or not _SEMVER_RE.match(
            raw_protocol_version
        ):
            raise A2uiCatalogError(
                "Catalog document 'protocolVersion' must be a valid SemVer string,"
                f" got {raw_protocol_version!r}."
            )
    if protocol_version is not None:
        raw_override = (
            protocol_version.value
            if isinstance(protocol_version, ProtocolVersion)
            else str(protocol_version)
        )
        resolved_pv = to_canonical_version(raw_override) or raw_override
    else:
        resolved_pv = raw_protocol_version or "1.0"

    schema_uri = _opt_str(document, "$schema", "catalog")
    title = _opt_str(document, "title", "catalog")
    description = _opt_str(document, "description", "catalog")
    instructions = _opt_str(document, "instructions", "catalog")
    metadata = _parse_metadata(document.get("metadata"), "catalog.metadata")

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
        sp_props = _parse_parameters(
            raw_sp.get("properties"),
            "surfaceProperties.properties",
            allow_ui_types=False,
        )
        sp_ap_raw = raw_sp.get("additionalProperties", False)
        sp_ap: bool | TypeDefinition
        if isinstance(sp_ap_raw, bool):
            sp_ap = sp_ap_raw
        elif isinstance(sp_ap_raw, Mapping):
            sp_ap = _parse_type(
                sp_ap_raw,
                "surfaceProperties.additionalProperties",
                allow_ui_types=False,
                allow_param_fields=False,
            )
        else:
            raise A2uiCatalogError(
                "surfaceProperties.additionalProperties must be a boolean or type"
                " object."
            )
        surface_props = SurfacePropertiesDefinition(
            description=_opt_str(raw_sp, "description", "surfaceProperties"),
            properties=sp_props,
            additional_properties=sp_ap,
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
            params = _parse_parameters(
                raw_comp.get("parameters"),
                f"{c_scope}.parameters",
                allow_ui_types=True,
            )
            at_least = _parse_at_least_one_of(
                raw_comp.get("atLeastOneOf"), c_scope, {p.name for p in params}
            )
            components.append(
                ComponentDefinition(
                    name=c_name,
                    description=_opt_str(raw_comp, "description", c_scope),
                    checkable=_opt_bool(raw_comp, "checkable", c_scope),
                    parameters=params,
                    at_least_one_of=at_least,
                    allowed_parents=_parse_unique_id_list(
                        raw_comp.get("allowedParents"), f"{c_scope}.allowedParents"
                    ),
                    allowed_children=_parse_unique_id_list(
                        raw_comp.get("allowedChildren"), f"{c_scope}.allowedChildren"
                    ),
                    metadata=_parse_metadata(
                        raw_comp.get("metadata"), f"{c_scope}.metadata"
                    ),
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
            raw_callers = raw_fn.get("allowedCallers", "rendererOnly")
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
            params = _parse_parameters(
                raw_fn.get("parameters"),
                f"{f_scope}.parameters",
                allow_ui_types=False,
            )
            at_least = _parse_at_least_one_of(
                raw_fn.get("atLeastOneOf"), f_scope, {p.name for p in params}
            )
            ap_raw = raw_fn.get("additionalParameters", False)
            ap: bool | TypeDefinition
            if isinstance(ap_raw, bool):
                ap = ap_raw
            elif isinstance(ap_raw, Mapping):
                ap = _parse_type(
                    ap_raw,
                    f"{f_scope}.additionalParameters",
                    allow_ui_types=False,
                    allow_param_fields=False,
                )
            else:
                raise A2uiCatalogError(
                    f"{f_scope}.additionalParameters must be a boolean or DataType"
                    " object."
                )
            functions.append(
                FunctionDefinition(
                    name=f_name,
                    return_type=ret_type,
                    description=_opt_str(raw_fn, "description", f_scope),
                    allowed_callers=allowed_callers,
                    requires_user_activation=requires_ua,
                    parameters=params,
                    at_least_one_of=at_least,
                    additional_parameters=ap,
                    deprecated=_opt_bool(raw_fn, "deprecated", f_scope),
                    deprecated_reason=_opt_str(raw_fn, "deprecatedReason", f_scope),
                )
            )

    model = CatalogModel(
        catalog_id=resolved_catalog_id,
        protocol_version=resolved_pv,
        format_version=CATALOG_DOCUMENT_FORMAT_VERSION,
        schema_uri=schema_uri,
        title=title,
        description=description,
        instructions=instructions,
        metadata=metadata,
        types=types_map,
        surface_properties=surface_props,
        components=tuple(components),
        functions=tuple(functions),
    )
    _validate_local_refs(model)
    return model


def _serialize_type(type_def: TypeDefinition, *, path: str) -> dict[str, Any]:
    if isinstance(type_def, RawJsonSchemaType):
        raise A2uiCatalogError(
            f"{path}: cannot serialize legacy RawJsonSchemaType into a Catalog"
            " Document."
        )
    out: dict[str, Any] = {"type": type_def.type}
    if isinstance(type_def, StringType):
        if type_def.dynamic:
            out["dynamic"] = True
        if type_def.format is not None:
            out["format"] = (
                list(type_def.format)
                if isinstance(type_def.format, tuple)
                else type_def.format
            )
        if type_def.pattern is not None:
            out["pattern"] = type_def.pattern
        if type_def.min_length is not None:
            out["minLength"] = type_def.min_length
        if type_def.max_length is not None:
            out["maxLength"] = type_def.max_length
        if type_def.default is not None:
            out["default"] = type_def.default
    elif isinstance(type_def, NumberType):
        if type_def.dynamic:
            out["dynamic"] = True
        if type_def.min is not None:
            out["min"] = type_def.min
        if type_def.max is not None:
            out["max"] = type_def.max
        if type_def.default is not None:
            out["default"] = type_def.default
    elif isinstance(type_def, IntegerType):
        if type_def.dynamic:
            out["dynamic"] = True
        if type_def.min is not None:
            out["min"] = type_def.min
        if type_def.max is not None:
            out["max"] = type_def.max
        if type_def.default is not None:
            out["default"] = type_def.default
    elif isinstance(type_def, BooleanType):
        if type_def.dynamic:
            out["dynamic"] = True
        if type_def.default is not None:
            out["default"] = type_def.default
    elif isinstance(type_def, EnumType):
        if type_def.dynamic:
            out["dynamic"] = True
        if type_def.value_type != "string":
            out["valueType"] = type_def.value_type
        out["values"] = list(type_def.values)
        if type_def.default is not None:
            out["default"] = type_def.default
    elif isinstance(type_def, ConstType):
        out["value"] = type_def.value
    elif isinstance(type_def, AnyType):
        if type_def.dynamic:
            out["dynamic"] = True
        if type_def.nullable:
            out["nullable"] = True
        if type_def.default is not UNSET:
            out["default"] = copy.deepcopy(type_def.default)
    elif isinstance(type_def, RefType):
        out["ref"] = type_def.ref
        if type_def.default is not UNSET:
            out["default"] = copy.deepcopy(type_def.default)
    elif isinstance(type_def, ObjectType):
        if type_def.dynamic:
            out["dynamic"] = True
        if type_def.properties:
            out["properties"] = [
                _serialize_parameter(p, path=f"{path}.{p.name}")
                for p in type_def.properties
            ]
        if type_def.additional_properties is not False:
            out["additionalProperties"] = (
                True
                if type_def.additional_properties is True
                else _serialize_type(
                    type_def.additional_properties,
                    path=f"{path}.additionalProperties",
                )
            )
        if type_def.at_least_one_of:
            out["atLeastOneOf"] = [list(g) for g in type_def.at_least_one_of]
        if type_def.default is not None:
            out["default"] = copy.deepcopy(dict(type_def.default))
    elif isinstance(type_def, ArrayType):
        if type_def.dynamic:
            out["dynamic"] = True
        if type_def.items is not None:
            out["items"] = _serialize_type(type_def.items, path=f"{path}.items")
        if type_def.min_items is not None:
            out["minItems"] = type_def.min_items
        if type_def.max_items is not None:
            out["maxItems"] = type_def.max_items
        if type_def.unique_items:
            out["uniqueItems"] = True
        if type_def.default is not None:
            out["default"] = copy.deepcopy(list(type_def.default))
    elif isinstance(type_def, UnionType):
        if type_def.dynamic:
            out["dynamic"] = True
        if not type_def.exclusive:
            out["exclusive"] = False
        out["variants"] = [
            _serialize_type(v, path=f"{path}.variants[{idx}]")
            for idx, v in enumerate(type_def.variants)
        ]
        if type_def.default is not UNSET:
            out["default"] = copy.deepcopy(type_def.default)

    if type_def.description is not None:
        out["description"] = type_def.description
    if type_def.deprecated:
        out["deprecated"] = True
    if type_def.deprecated_reason is not None:
        out["deprecatedReason"] = type_def.deprecated_reason
    return out


def _serialize_parameter(param: ParameterDefinition, *, path: str) -> dict[str, Any]:
    type_dict = _serialize_type(param.type, path=path)
    out: dict[str, Any] = {"name": param.name, "type": type_dict.pop("type")}
    if param.required:
        out["required"] = True
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
    if model.title is not None:
        doc["title"] = model.title
    if model.description is not None:
        doc["description"] = model.description
    if model.instructions is not None:
        doc["instructions"] = model.instructions
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
        if sp.description is not None:
            sp_doc["description"] = sp.description
        if sp.properties:
            sp_doc["properties"] = [
                _serialize_parameter(p, path=f"surfaceProperties.{p.name}")
                for p in sp.properties
            ]
        if sp.additional_properties is not False:
            sp_doc["additionalProperties"] = (
                True
                if sp.additional_properties is True
                else _serialize_type(
                    sp.additional_properties,
                    path="surfaceProperties.additionalProperties",
                )
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
            c_doc: dict[str, Any] = {"name": comp.name}
            if comp.description is not None:
                c_doc["description"] = comp.description
            if comp.checkable:
                c_doc["checkable"] = True
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
            if comp.deprecated:
                c_doc["deprecated"] = True
            if comp.deprecated_reason is not None:
                c_doc["deprecatedReason"] = comp.deprecated_reason
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
            if fn.description is not None:
                f_doc["description"] = fn.description
            f_doc["returnType"] = _serialize_return_type(
                fn.return_type, path=f"functions.{fn.name}.returnType"
            )
            if fn.allowed_callers != "rendererOnly":
                f_doc["allowedCallers"] = fn.allowed_callers
            if fn.requires_user_activation:
                f_doc["requiresUserActivation"] = True
            if fn.parameters:
                f_doc["parameters"] = [
                    _serialize_parameter(p, path=f"functions.{fn.name}.{p.name}")
                    for p in fn.parameters
                ]
            if fn.at_least_one_of:
                f_doc["atLeastOneOf"] = [list(g) for g in fn.at_least_one_of]
            if fn.additional_parameters is not False:
                f_doc["additionalParameters"] = (
                    True
                    if fn.additional_parameters is True
                    else _serialize_type(
                        fn.additional_parameters,
                        path=f"functions.{fn.name}.additionalParameters",
                    )
                )
            if fn.deprecated:
                f_doc["deprecated"] = True
            if fn.deprecated_reason is not None:
                f_doc["deprecatedReason"] = fn.deprecated_reason
            fn_docs.append(f_doc)
        doc["functions"] = fn_docs

    return doc


__all__ = [
    "CATALOG_DOCUMENT_SCHEMA_URI",
    "is_catalog_document",
    "parse_catalog_document",
    "serialize_catalog_document",
]
