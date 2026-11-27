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

"""Bidirectional adapter between A2UI JSON Schema catalogs and `CatalogModel`."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import copy
from dataclasses import replace
import math
import re
from typing import Any, Final, cast

from ..common.metadata import clone_metadata
from ..common.semver import is_at_least_version, to_canonical_version
from ..common.uax31 import is_valid_uax31_identifier
from ..exceptions import A2uiCatalogError
from ..schema import ProtocolVersion
from ..schema._json_schema import CATALOG_DEF_MARKER
from .functions import AllowedCallers, FunctionReturnType
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
    contains_ui_type,
    function_return_category,
)

_JSON_SCHEMA_DIALECT: Final[str] = "https://json-schema.org/draft/2020-12/schema"

_COMMON_REF_RE: Final[re.Pattern[str]] = re.compile(
    r"(?:^|/)common_types\.json#/(?:\$defs|definitions)/([^/]+)\Z"
)
_LOCAL_DEF_RE: Final[re.Pattern[str]] = re.compile(
    r"^#/(?:\$defs|definitions)/([^/]+)\Z"
)

_STANDARD_MIXIN_DEFS: Final[frozenset[str]] = frozenset({
    "ComponentCommon",
    "Checkable",
    "ComponentCommonMetadata",
})

_STRUCTURAL_DEFS: Final[frozenset[str]] = frozenset({
    "anyComponent",
    "anyFunction",
    "theme",
    "ComponentCommon",
    "Checkable",
    "ComponentCommonMetadata",
})

_COMMON_TYPE_NAMES: Final[frozenset[str]] = frozenset({
    "DynamicString",
    "DynamicNumber",
    "DynamicBoolean",
    "DynamicStringList",
    "DynamicValue",
    "DataBinding",
    "FunctionCall",
    "Child",
    "ComponentId",
    "ChildList",
    "Action",
    "CheckRule",
    "AccessibilityAttributes",
    "CallId",
    "Extensions",
})

_AT_ENVELOPE_KEYS: Final[frozenset[str]] = frozenset(
    {"@metadata", "@catalogId", "@accessibility", "@checks"}
)

_STANDARD_CATALOG_ID_DESCRIPTION: Final[str] = (
    "The catalog ID for this component, overriding any surface-level default catalogId."
)

_UNTRANSLATABLE_KEYWORDS: Final[frozenset[str]] = frozenset({
    "patternProperties",
    "propertyNames",
    "not",
    "if",
    "then",
    "else",
    "dependentRequired",
    "dependentSchemas",
    "minProperties",
    "maxProperties",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "prefixItems",
    "contains",
    "minContains",
    "maxContains",
    "unevaluatedItems",
    "contentMediaType",
    "contentEncoding",
})

_TYPE_KEYWORDS: Final[frozenset[str]] = frozenset({
    "type",
    "const",
    "enum",
    "$ref",
    "allOf",
    "oneOf",
    "anyOf",
    "not",
    "properties",
    "additionalProperties",
    "items",
    "prefixItems",
})


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
    )


def _extract_common_ref_name(ref: str, local_defs: Mapping[str, Any]) -> str | None:
    del local_defs  # Protocol common types win even when bundled into local `$defs`.
    m = _COMMON_REF_RE.search(ref)
    if m:
        return m.group(1)
    lm = _LOCAL_DEF_RE.match(ref)
    if lm:
        name = lm.group(1)
        if name in _COMMON_TYPE_NAMES:
            return name
    return None


def _extract_local_def_name(ref: str) -> str | None:
    lm = _LOCAL_DEF_RE.match(ref)
    if lm:
        return lm.group(1)
    if "#/$defs/" in ref:
        doc_part, _, frag = ref.partition("#/$defs/")
        if not doc_part or doc_part == "catalog.json":
            return frag.split("/", 1)[0]
    return None


def _is_standard_mixin_property(
    key: str, prop_schema: Any, *, has_inline_id: bool = False
) -> bool:
    """Returns whether a bare envelope property schema matches the standard mixin."""
    if not isinstance(prop_schema, Mapping):
        return False
    ref = prop_schema.get("$ref")
    if key == "checks":
        if isinstance(ref, str) and ref.endswith("/Checkable"):
            return True
        items = prop_schema.get("items")
        return (
            isinstance(items, Mapping)
            and isinstance(items.get("$ref"), str)
            and items["$ref"].endswith("/CheckRule")
        )
    if key == "accessibility":
        return isinstance(ref, str) and ref.endswith("/AccessibilityAttributes")
    if key == "metadata":
        if isinstance(ref, str) and ref.endswith("/ComponentCommonMetadata"):
            return True
        props = prop_schema.get("properties")
        return (
            has_inline_id
            and prop_schema.get("type") == "object"
            and isinstance(props, Mapping)
            and set(props) == {"extensions"}
        )
    if key == "catalogId":
        return has_inline_id and prop_schema.get("type") == "string"
    return False


def _is_object_or_ref_branch(sub: Any) -> bool:
    if not isinstance(sub, Mapping):
        return False
    return (
        "$ref" in sub
        or sub.get("type") == "object"
        or isinstance(sub.get("properties"), Mapping)
        or any(k in sub for k in ("allOf", "oneOf", "anyOf"))
    )


def _is_flattened_action_branch(branch: Any) -> bool:
    if not isinstance(branch, Mapping):
        return False
    if branch.get("type") not in (None, "object"):
        return False
    props = branch.get("properties")
    reqs = branch.get("required")
    if not isinstance(props, Mapping) or not isinstance(reqs, list):
        return False
    keys = set(props)
    if keys not in ({"event"}, {"functionCall"}):
        return False
    key = next(iter(keys))
    return key in reqs and _is_object_or_ref_branch(props[key])


def _is_data_binding_schema(
    branch: Any,
    local_defs: Mapping[str, Any],
    *,
    at_least_v10: bool = True,
) -> bool:
    if not isinstance(branch, Mapping):
        return False
    ref = branch.get("$ref")
    if (
        isinstance(ref, str)
        and _extract_common_ref_name(ref, local_defs) == "DataBinding"
    ):
        return True
    if branch.get("type") not in (None, "object"):
        return False
    props = branch.get("properties")
    reqs = branch.get("required")
    if isinstance(props, Mapping) and isinstance(reqs, list):
        path_key = "@path" if at_least_v10 else "path"
        if set(props) == {path_key} and path_key in reqs:
            return True
    return False


def _is_function_call_schema(branch: Any, local_defs: Mapping[str, Any]) -> bool:
    if not isinstance(branch, Mapping):
        return False
    ref = branch.get("$ref")
    if (
        isinstance(ref, str)
        and _extract_common_ref_name(ref, local_defs) == "FunctionCall"
    ):
        return True
    all_of = branch.get("allOf")
    if isinstance(all_of, list) and any(
        _is_function_call_schema(sub, local_defs) for sub in all_of
    ):
        return True
    props = branch.get("properties")
    reqs = branch.get("required")
    if isinstance(props, Mapping) and isinstance(reqs, list):
        if "@call" in props and "@call" in reqs:
            return True
        if (
            "call" in props
            and "call" in reqs
            and bool(set(props) & {"args", "returnType"})
        ):
            return True
    return False


def _extract_if_then_string_formats(
    branch: Mapping[str, Any],
) -> str | tuple[str, ...] | None:
    """Recognizes `{if: {type: 'string'}, then: {format | oneOf: [{format: ...}]}}`."""
    allowed = {"if", "then"}
    if not set(branch.keys()) <= allowed:
        return None
    if_node = branch.get("if")
    then_node = branch.get("then")
    if if_node != {"type": "string"} or not isinstance(then_node, Mapping):
        return None
    if set(then_node.keys()) == {"format"} and isinstance(then_node["format"], str):
        return then_node["format"]
    one_of = then_node.get("oneOf")
    if set(then_node.keys()) == {"oneOf"} and isinstance(one_of, list) and one_of:
        formats: list[str] = []
        for item in one_of:
            if (
                isinstance(item, Mapping)
                and set(item.keys()) == {"format"}
                and isinstance(item["format"], str)
            ):
                formats.append(item["format"])
            else:
                return None
        return formats[0] if len(formats) == 1 else tuple(formats)
    return None


def _extract_at_least_one_of_branch(
    any_of: Any,
) -> tuple[str, ...] | None:
    """Recognizes `anyOf: [{required: [a]}, {required: [b]}]` -> `('a', 'b')`."""
    if not isinstance(any_of, list) or not any_of:
        return None
    names: list[str] = []
    for item in any_of:
        if (
            not isinstance(item, Mapping)
            or set(item.keys()) != {"required"}
            or not isinstance(item["required"], list)
            or len(item["required"]) != 1
            or not isinstance(item["required"][0], str)
        ):
            return None
        name = item["required"][0]
        if name not in names:
            names.append(name)
    return tuple(names) if names else None


def _apply_common_metadata(
    type_def: TypeDefinition,
    *,
    description: str | None,
    deprecated: bool,
    deprecated_reason: str | None,
    default_val: Any = UNSET,
) -> TypeDefinition:
    updates: dict[str, Any] = {}
    if description is not None and type_def.description is None:
        updates["description"] = description
    if deprecated and not type_def.deprecated:
        updates["deprecated"] = True
    if deprecated_reason is not None and type_def.deprecated_reason is None:
        updates["deprecated_reason"] = deprecated_reason
    if default_val is not UNSET:
        if isinstance(type_def, StringType) and isinstance(default_val, str):
            updates["default"] = default_val
        elif isinstance(type_def, NumberType) and _is_number(default_val):
            updates["default"] = default_val
        elif isinstance(type_def, IntegerType) and _is_int(default_val):
            updates["default"] = default_val
        elif isinstance(type_def, BooleanType) and isinstance(default_val, bool):
            updates["default"] = default_val
        elif isinstance(type_def, EnumType) and (
            isinstance(default_val, (str, bool)) or _is_number(default_val)
        ):
            updates["default"] = default_val
        elif isinstance(type_def, (AnyType, RefType, UnionType)):
            updates["default"] = copy.deepcopy(default_val)
        elif isinstance(type_def, ObjectType) and isinstance(default_val, Mapping):
            updates["default"] = copy.deepcopy(dict(default_val))
        elif isinstance(type_def, ArrayType) and isinstance(default_val, list):
            updates["default"] = tuple(copy.deepcopy(default_val))
    return replace(type_def, **updates) if updates else type_def


def _make_dynamic(type_def: TypeDefinition) -> TypeDefinition | None:
    """Returns a dynamic variant of `type_def`, or None if `type_def` has no `dynamic` flag."""
    if isinstance(
        type_def,
        (
            StringType,
            NumberType,
            IntegerType,
            BooleanType,
            EnumType,
            AnyType,
            ObjectType,
            ArrayType,
            UnionType,
        ),
    ):
        return replace(type_def, dynamic=True)
    return None


def _common_type_from_name(name: str, *, allow_ui_types: bool) -> TypeDefinition | None:
    if name == "DynamicString":
        return StringType(dynamic=True)
    if name == "DynamicNumber":
        return NumberType(dynamic=True)
    if name == "DynamicBoolean":
        return BooleanType(dynamic=True)
    if name == "DynamicStringList":
        return ArrayType(items=StringType(), dynamic=True)
    if name == "DynamicValue":
        return AnyType(dynamic=True, nullable=False)
    if name == "DataBinding":
        return DataBindingType()
    if name == "FunctionCall":
        return FunctionCallType()
    if name in ("Child", "ComponentId"):
        return ChildType() if allow_ui_types else StringType()
    if name == "ChildList":
        return ChildListType() if allow_ui_types else ArrayType(items=StringType())
    if name == "Action":
        return ActionType() if allow_ui_types else None
    if name == "CheckRule":
        return CheckRuleType() if allow_ui_types else None
    if name == "AccessibilityAttributes":
        return AccessibilityType() if allow_ui_types else None
    if name == "CallId":
        return StringType()
    if name == "Extensions":
        return ObjectType(additional_properties=AnyType(dynamic=True, nullable=True))
    return None


def _infer_enum_value_type(values: Sequence[EnumValue]) -> EnumValueType:
    if values and all(isinstance(v, bool) for v in values):
        return "boolean"
    if values and all(_is_number(v) for v in values):
        return "number"
    return "string"


def _schema_for_primitive_type(
    kind: str,
    schema: Mapping[str, Any],
    *,
    local_defs: Mapping[str, Any],
    leaf_type_names: frozenset[str],
    allow_ui_types: bool,
    at_least_v10: bool = True,
    visited: frozenset[str],
) -> TypeDefinition:
    if kind == "string":
        fmt = schema.get("format")
        return StringType(
            format=fmt if isinstance(fmt, str) and fmt else None,
            pattern=schema["pattern"]
            if isinstance(schema.get("pattern"), str)
            else None,
            min_length=schema["minLength"]
            if _is_int(schema.get("minLength"))
            else None,
            max_length=schema["maxLength"]
            if _is_int(schema.get("maxLength"))
            else None,
            default=schema["default"]
            if isinstance(schema.get("default"), str)
            else None,
        )
    if kind == "number":
        return NumberType(
            min=schema["minimum"] if _is_number(schema.get("minimum")) else None,
            max=schema["maximum"] if _is_number(schema.get("maximum")) else None,
            default=schema["default"] if _is_number(schema.get("default")) else None,
        )
    if kind == "integer":
        return IntegerType(
            min=schema["minimum"] if _is_int(schema.get("minimum")) else None,
            max=schema["maximum"] if _is_int(schema.get("maximum")) else None,
            default=schema["default"] if _is_int(schema.get("default")) else None,
        )
    if kind == "boolean":
        return BooleanType(
            default=schema["default"]
            if isinstance(schema.get("default"), bool)
            else None,
        )
    if kind == "null":
        return ConstType(value=None)
    if kind == "array":
        raw_items = schema.get("items")
        items: TypeDefinition | None = None
        if isinstance(raw_items, Mapping):
            items = type_definition_from_json_schema(
                raw_items,
                local_defs=local_defs,
                leaf_type_names=leaf_type_names,
                allow_ui_types=allow_ui_types,
                at_least_v10=at_least_v10,
                visited=visited,
            )
        elif raw_items is False:
            return RawJsonSchemaType(schema=copy.deepcopy(dict(schema)))
        default_arr = (
            tuple(copy.deepcopy(schema["default"]))
            if isinstance(schema.get("default"), list)
            else None
        )
        return ArrayType(
            items=items,
            min_items=schema["minItems"] if _is_int(schema.get("minItems")) else None,
            max_items=schema["maxItems"] if _is_int(schema.get("maxItems")) else None,
            unique_items=bool(schema.get("uniqueItems", False)),
            default=default_arr,
        )
    if kind == "object":
        return _object_type_from_json_schema(
            schema,
            local_defs=local_defs,
            leaf_type_names=leaf_type_names,
            allow_ui_types=allow_ui_types,
            at_least_v10=at_least_v10,
            visited=visited,
        )
    return RawJsonSchemaType(schema=copy.deepcopy(dict(schema)))


def _object_type_from_json_schema(
    schema: Mapping[str, Any],
    *,
    local_defs: Mapping[str, Any],
    leaf_type_names: frozenset[str],
    allow_ui_types: bool,
    at_least_v10: bool = True,
    visited: frozenset[str],
) -> TypeDefinition:
    if allow_ui_types and _is_flattened_action_branch(schema):
        return ActionType()
    if _is_data_binding_schema(schema, local_defs, at_least_v10=at_least_v10):
        return DataBindingType()
    raw_props = schema.get("properties")
    req_set = (
        set(schema["required"]) if isinstance(schema.get("required"), list) else set()
    )
    params: list[ParameterDefinition] = []
    if isinstance(raw_props, Mapping):
        for p_name, p_schema in raw_props.items():
            if isinstance(p_schema, Mapping):
                p_type = type_definition_from_json_schema(
                    p_schema,
                    local_defs=local_defs,
                    leaf_type_names=leaf_type_names,
                    allow_ui_types=allow_ui_types,
                    at_least_v10=at_least_v10,
                    visited=visited,
                )
            elif p_schema is True:
                p_type = AnyType(dynamic=True, nullable=True)
            else:
                p_type = RawJsonSchemaType(schema={"not": {}})
            params.append(
                ParameterDefinition(
                    name=str(p_name), type=p_type, required=p_name in req_set
                )
            )

    at_least_groups: list[tuple[str, ...]] = []
    if "anyOf" in schema:
        grp = _extract_at_least_one_of_branch(schema["anyOf"])
        if grp is None:
            return RawJsonSchemaType(schema=copy.deepcopy(dict(schema)))
        at_least_groups.append(grp)

    ap: bool | TypeDefinition
    raw_ap = schema.get("additionalProperties")
    raw_up = schema.get("unevaluatedProperties")
    if raw_ap is False or raw_up is False:
        ap = False
    elif raw_ap is True:
        ap = True
    elif isinstance(raw_ap, Mapping):
        ap = type_definition_from_json_schema(
            raw_ap,
            local_defs=local_defs,
            leaf_type_names=leaf_type_names,
            allow_ui_types=allow_ui_types,
            at_least_v10=at_least_v10,
            visited=visited,
        )
    elif raw_ap is None and raw_up is None:
        # In JSON Schema, omitting additionalProperties permits extra keys.
        ap = True
    else:
        return RawJsonSchemaType(schema=copy.deepcopy(dict(schema)))

    default_obj = (
        copy.deepcopy(dict(schema["default"]))
        if isinstance(schema.get("default"), Mapping)
        else None
    )
    return ObjectType(
        properties=tuple(params),
        additional_properties=ap,
        at_least_one_of=tuple(at_least_groups),
        default=default_obj,
    )


def type_definition_from_json_schema(
    schema: Mapping[str, Any],
    *,
    local_defs: Mapping[str, Any] = {},
    leaf_type_names: frozenset[str] = frozenset(),
    allow_ui_types: bool = True,
    at_least_v10: bool = True,
    visited: frozenset[str] = frozenset(),
) -> TypeDefinition:
    """Translates a JSON Schema fragment into a canonical `TypeDefinition`."""
    description = (
        schema["description"] if isinstance(schema.get("description"), str) else None
    )
    deprecated = bool(schema.get("deprecated", False))
    deprecated_reason = (
        schema["x-deprecated-reason"]
        if isinstance(schema.get("x-deprecated-reason"), str)
        else None
    )
    default_val = schema["default"] if "default" in schema else UNSET

    # Preserve catalog-local leaf type references previously inlined with marker.
    marker = schema.get(CATALOG_DEF_MARKER)
    if isinstance(marker, str) and marker in leaf_type_names:
        # Only attach override description if it differs from the leaf type's own.
        leaf_raw = local_defs.get(marker)
        leaf_desc = (
            leaf_raw.get("description") if isinstance(leaf_raw, Mapping) else None
        )
        ref_desc = description if description != leaf_desc else None
        return RefType(
            ref=marker,
            default=copy.deepcopy(default_val) if default_val is not UNSET else UNSET,
            description=ref_desc,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    # Check for untranslatable JSON Schema keywords (except recognized allOf if/then).
    if any(k in schema for k in _UNTRANSLATABLE_KEYWORDS):
        return RawJsonSchemaType(
            schema=copy.deepcopy(dict(schema)),
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    # $ref handling.
    ref = schema.get("$ref")
    if isinstance(ref, str):
        common_name = _extract_common_ref_name(ref, local_defs)
        if common_name is not None:
            common_t = _common_type_from_name(
                common_name, allow_ui_types=allow_ui_types
            )
            if common_t is not None:
                return _apply_common_metadata(
                    common_t,
                    description=description,
                    deprecated=deprecated,
                    deprecated_reason=deprecated_reason,
                    default_val=default_val,
                )
        local_name = _extract_local_def_name(ref)
        if local_name is not None:
            if local_name in leaf_type_names:
                return RefType(
                    ref=local_name,
                    default=(
                        copy.deepcopy(default_val)
                        if default_val is not UNSET
                        else UNSET
                    ),
                    description=description,
                    deprecated=deprecated,
                    deprecated_reason=deprecated_reason,
                )
            if local_name in local_defs and local_name not in visited:
                target = local_defs[local_name]
                if isinstance(target, Mapping):
                    resolved = type_definition_from_json_schema(
                        target,
                        local_defs=local_defs,
                        leaf_type_names=leaf_type_names,
                        allow_ui_types=allow_ui_types,
                        visited=visited | {local_name},
                    )
                    return _apply_common_metadata(
                        resolved,
                        description=description,
                        deprecated=deprecated,
                        deprecated_reason=deprecated_reason,
                        default_val=default_val,
                    )
        return RawJsonSchemaType(
            schema=copy.deepcopy(dict(schema)),
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    # allOf handling (constrained DynamicString like DateTimeInput.min/max, or single wrapper).
    all_of = schema.get("allOf")
    if isinstance(all_of, list) and all_of:
        if len(all_of) == 2 and all(isinstance(b, Mapping) for b in all_of):
            b0, b1 = all_of[0], all_of[1]
            fmt_constraint = _extract_if_then_string_formats(b1)
            if fmt_constraint is not None:
                base_t = type_definition_from_json_schema(
                    b0,
                    local_defs=local_defs,
                    leaf_type_names=leaf_type_names,
                    allow_ui_types=allow_ui_types,
                    visited=visited,
                )
                if isinstance(base_t, StringType):
                    return _apply_common_metadata(
                        replace(base_t, format=fmt_constraint),
                        description=description,
                        deprecated=deprecated,
                        deprecated_reason=deprecated_reason,
                        default_val=default_val,
                    )
        if len(all_of) == 1 and isinstance(all_of[0], Mapping):
            inner = type_definition_from_json_schema(
                all_of[0],
                local_defs=local_defs,
                leaf_type_names=leaf_type_names,
                allow_ui_types=allow_ui_types,
                visited=visited,
            )
            return _apply_common_metadata(
                inner,
                description=description,
                deprecated=deprecated,
                deprecated_reason=deprecated_reason,
                default_val=default_val,
            )
        # Try merging allOf of pure object schemas.
        if all(isinstance(b, Mapping) for b in all_of):
            merged_props: dict[str, ParameterDefinition] = {}
            merged_at_least: list[tuple[str, ...]] = []
            ap_closed = False
            can_merge = True
            for branch in all_of:
                bt = type_definition_from_json_schema(
                    branch,
                    local_defs=local_defs,
                    leaf_type_names=leaf_type_names,
                    allow_ui_types=allow_ui_types,
                    visited=visited,
                )
                if isinstance(bt, ObjectType):
                    for p in bt.properties:
                        merged_props[p.name] = p
                    merged_at_least.extend(bt.at_least_one_of)
                    if bt.additional_properties is False:
                        ap_closed = True
                else:
                    can_merge = False
                    break
            if can_merge and merged_props:
                return _apply_common_metadata(
                    ObjectType(
                        properties=tuple(merged_props.values()),
                        additional_properties=False
                        if (
                            ap_closed
                            or schema.get("additionalProperties") is False
                            or schema.get("unevaluatedProperties") is False
                        )
                        else True,
                        at_least_one_of=tuple(merged_at_least),
                    ),
                    description=description,
                    deprecated=deprecated,
                    deprecated_reason=deprecated_reason,
                    default_val=default_val,
                )
        return RawJsonSchemaType(
            schema=copy.deepcopy(dict(schema)),
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    # oneOf / anyOf handling.
    for comb_key, exclusive in (("oneOf", True), ("anyOf", False)):
        branches = schema.get(comb_key)
        if isinstance(branches, list) and branches:
            # Skip anyOf if this is actually an object schema with required-anyOf.
            if comb_key == "anyOf" and (
                schema.get("type") == "object" or "properties" in schema
            ):
                break
            if allow_ui_types and all(_is_flattened_action_branch(b) for b in branches):
                return _apply_common_metadata(
                    ActionType(),
                    description=description,
                    deprecated=deprecated,
                    deprecated_reason=deprecated_reason,
                    default_val=default_val,
                )
            has_db = any(
                _is_data_binding_schema(b, local_defs, at_least_v10=at_least_v10)
                for b in branches
            )
            has_fc = any(_is_function_call_schema(b, local_defs) for b in branches)
            if has_db and has_fc:
                non_dyn = [
                    b
                    for b in branches
                    if not _is_data_binding_schema(
                        b, local_defs, at_least_v10=at_least_v10
                    )
                    and not _is_function_call_schema(b, local_defs)
                ]
                if len(non_dyn) == 1 and isinstance(non_dyn[0], Mapping):
                    base_t = type_definition_from_json_schema(
                        non_dyn[0],
                        local_defs=local_defs,
                        leaf_type_names=leaf_type_names,
                        allow_ui_types=allow_ui_types,
                        at_least_v10=at_least_v10,
                        visited=visited,
                    )
                    dyn_t = _make_dynamic(base_t)
                    if dyn_t is not None:
                        return _apply_common_metadata(
                            dyn_t,
                            description=description,
                            deprecated=deprecated,
                            deprecated_reason=deprecated_reason,
                            default_val=default_val,
                        )
                elif len(non_dyn) >= 2 and all(isinstance(b, Mapping) for b in non_dyn):
                    variants = tuple(
                        type_definition_from_json_schema(
                            b,
                            local_defs=local_defs,
                            leaf_type_names=leaf_type_names,
                            allow_ui_types=allow_ui_types,
                            at_least_v10=at_least_v10,
                            visited=visited,
                        )
                        for b in non_dyn
                    )
                    return _apply_common_metadata(
                        UnionType(variants=variants, exclusive=exclusive, dynamic=True),
                        description=description,
                        deprecated=deprecated,
                        deprecated_reason=deprecated_reason,
                        default_val=default_val,
                    )
            if len(branches) >= 2 and all(isinstance(b, Mapping) for b in branches):
                variants = tuple(
                    type_definition_from_json_schema(
                        b,
                        local_defs=local_defs,
                        leaf_type_names=leaf_type_names,
                        allow_ui_types=allow_ui_types,
                        at_least_v10=at_least_v10,
                        visited=visited,
                    )
                    for b in branches
                )
                return _apply_common_metadata(
                    UnionType(variants=variants, exclusive=exclusive),
                    description=description,
                    deprecated=deprecated,
                    deprecated_reason=deprecated_reason,
                    default_val=default_val,
                )
            if len(branches) == 1 and isinstance(branches[0], Mapping):
                inner = type_definition_from_json_schema(
                    branches[0],
                    local_defs=local_defs,
                    leaf_type_names=leaf_type_names,
                    allow_ui_types=allow_ui_types,
                    visited=visited,
                )
                return _apply_common_metadata(
                    inner,
                    description=description,
                    deprecated=deprecated,
                    deprecated_reason=deprecated_reason,
                    default_val=default_val,
                )
            return RawJsonSchemaType(
                schema=copy.deepcopy(dict(schema)),
                description=description,
                deprecated=deprecated,
                deprecated_reason=deprecated_reason,
            )

    # const handling.
    if "const" in schema:
        val = schema["const"]
        if val is None or isinstance(val, (str, bool)) or _is_number(val):
            return ConstType(
                value=cast(ConstValue, val),
                description=description,
                deprecated=deprecated,
                deprecated_reason=deprecated_reason,
            )
        return RawJsonSchemaType(
            schema=copy.deepcopy(dict(schema)),
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    # enum handling.
    if isinstance(schema.get("enum"), list) and schema["enum"]:
        raw_enum = schema["enum"]
        if all(isinstance(v, (str, bool)) or _is_number(v) for v in raw_enum):
            vals = tuple(cast(list[EnumValue], raw_enum))
            raw_type = schema.get("type")
            vt: EnumValueType = (
                cast(EnumValueType, raw_type)
                if raw_type in ("string", "number", "boolean")
                else _infer_enum_value_type(vals)
            )
            return _apply_common_metadata(
                EnumType(values=vals, value_type=vt),
                description=description,
                deprecated=deprecated,
                deprecated_reason=deprecated_reason,
                default_val=default_val,
            )
        return RawJsonSchemaType(
            schema=copy.deepcopy(dict(schema)),
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    # Multi-type array (e.g. {"type": ["boolean", "object"]}).
    s_type = schema.get("type")
    if isinstance(s_type, list) and s_type:
        if len(s_type) == 1 and isinstance(s_type[0], str):
            base = _schema_for_primitive_type(
                s_type[0],
                schema,
                local_defs=local_defs,
                leaf_type_names=leaf_type_names,
                allow_ui_types=allow_ui_types,
                at_least_v10=at_least_v10,
                visited=visited,
            )
            return _apply_common_metadata(
                base,
                description=description,
                deprecated=deprecated,
                deprecated_reason=deprecated_reason,
                default_val=default_val,
            )
        if all(isinstance(t, str) for t in s_type):
            variants = tuple(
                _schema_for_primitive_type(
                    t,
                    schema,
                    local_defs=local_defs,
                    leaf_type_names=leaf_type_names,
                    allow_ui_types=allow_ui_types,
                    at_least_v10=at_least_v10,
                    visited=visited,
                )
                for t in s_type
            )
            return _apply_common_metadata(
                UnionType(variants=variants, exclusive=True),
                description=description,
                deprecated=deprecated,
                deprecated_reason=deprecated_reason,
                default_val=default_val,
            )

    if isinstance(s_type, str):
        base = _schema_for_primitive_type(
            s_type,
            schema,
            local_defs=local_defs,
            leaf_type_names=leaf_type_names,
            allow_ui_types=allow_ui_types,
            at_least_v10=at_least_v10,
            visited=visited,
        )
        return _apply_common_metadata(
            base,
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
            default_val=default_val,
        )

    # Implicit object or array schema (properties / items without explicit type).
    if "properties" in schema or "additionalProperties" in schema:
        base = _object_type_from_json_schema(
            schema,
            local_defs=local_defs,
            leaf_type_names=leaf_type_names,
            allow_ui_types=allow_ui_types,
            at_least_v10=at_least_v10,
            visited=visited,
        )
        return _apply_common_metadata(
            base,
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
            default_val=default_val,
        )

    if "items" in schema:
        base = _schema_for_primitive_type(
            "array",
            schema,
            local_defs=local_defs,
            leaf_type_names=leaf_type_names,
            allow_ui_types=allow_ui_types,
            at_least_v10=at_least_v10,
            visited=visited,
        )
        return _apply_common_metadata(
            base,
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
            default_val=default_val,
        )

    # Unconstrained `{}` (possibly with description/default) -> dynamic nullable any.
    if not any(k in schema for k in _TYPE_KEYWORDS):
        return AnyType(
            dynamic=True,
            nullable=True,
            default=copy.deepcopy(default_val) if default_val is not UNSET else UNSET,
            description=description,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    return RawJsonSchemaType(
        schema=copy.deepcopy(dict(schema)),
        description=description,
        deprecated=deprecated,
        deprecated_reason=deprecated_reason,
    )


def _collect_component_all_of_branches(
    schema: Mapping[str, Any],
    local_defs: Mapping[str, Any],
    visited: set[str],
    used_mixins: set[str],
) -> tuple[
    list[Mapping[str, Any]],
    list[Mapping[str, Any]],
    bool,
    bool,
]:
    """Splits a component schema into `(specific_branches, mixin_branches, is_checkable, has_untranslatable)`."""
    specific: list[Mapping[str, Any]] = []
    mixins: list[Mapping[str, Any]] = []
    is_checkable = False
    has_untranslatable = False

    if any(k in schema for k in _UNTRANSLATABLE_KEYWORDS) or "oneOf" in schema:
        has_untranslatable = True

    ref = schema.get("$ref")
    if isinstance(ref, str):
        common = _extract_common_ref_name(ref, local_defs)
        if common == "Checkable":
            return specific, mixins, True, has_untranslatable
        if common in ("ComponentCommon", "ComponentCommonMetadata"):
            return specific, mixins, False, has_untranslatable
        local_name = _extract_local_def_name(ref)
        if (
            local_name is not None
            and local_name in local_defs
            and local_name not in visited
        ):
            visited.add(local_name)
            used_mixins.add(local_name)
            target = local_defs[local_name]
            if isinstance(target, Mapping):
                s_spec, s_mix, s_chk, s_raw = _collect_component_all_of_branches(
                    target, local_defs, visited, used_mixins
                )
                specific.extend(s_spec)
                mixins.extend(s_mix)
                is_checkable = is_checkable or s_chk
                has_untranslatable = has_untranslatable or s_raw
            return specific, mixins, is_checkable, has_untranslatable
        has_untranslatable = True

    all_of = schema.get("allOf")
    if isinstance(all_of, list):
        for sub in all_of:
            if not isinstance(sub, Mapping):
                has_untranslatable = True
                continue
            s_spec, s_mix, s_chk, s_raw = _collect_component_all_of_branches(
                sub, local_defs, visited, used_mixins
            )
            specific.extend(s_spec)
            mixins.extend(s_mix)
            is_checkable = is_checkable or s_chk
            has_untranslatable = has_untranslatable or s_raw

    props = schema.get("properties")
    if isinstance(props, Mapping) or "required" in schema or "anyOf" in schema:
        if isinstance(props, Mapping) and "component" in props:
            specific.append(schema)
        else:
            mixins.append(schema)

    return specific, mixins, is_checkable, has_untranslatable


def component_definition_from_json_schema(
    name: str,
    schema: Mapping[str, Any],
    *,
    local_defs: Mapping[str, Any] = {},
    leaf_type_names: frozenset[str] = frozenset(),
    allowed_parents: Sequence[str] | None = None,
    allowed_children: Sequence[str] | None = None,
    metadata: Mapping[str, Any] | None = None,
    used_mixins: set[str] | None = None,
    at_least_v10: bool = True,
) -> ComponentDefinition:
    """Translates a component JSON Schema dict into a `ComponentDefinition`."""
    mixins_tracker = used_mixins if used_mixins is not None else set()
    specific, mixins, is_checkable, has_untranslatable = (
        _collect_component_all_of_branches(schema, local_defs, set(), mixins_tracker)
    )
    ordered_branches = [*specific, *mixins]

    description: str | None = (
        schema["description"] if isinstance(schema.get("description"), str) else None
    )
    if description is None:
        for branch in ordered_branches:
            if isinstance(branch.get("description"), str):
                description = branch["description"]
                break

    deprecated = bool(schema.get("deprecated", False))
    deprecated_reason = (
        schema["x-deprecated-reason"]
        if isinstance(schema.get("x-deprecated-reason"), str)
        else None
    )

    required_names: set[str] = set()
    prop_schemas: dict[str, Mapping[str, Any]] = {}
    at_least_groups: list[tuple[str, ...]] = []
    explicit_ap: bool | TypeDefinition = False
    saw_closure = "unevaluatedProperties" in schema or "additionalProperties" in schema
    root_closure = (
        schema["unevaluatedProperties"]
        if "unevaluatedProperties" in schema
        else schema.get("additionalProperties")
    )
    if root_closure is True:
        explicit_ap = True
    elif isinstance(root_closure, Mapping):
        explicit_ap = type_definition_from_json_schema(
            root_closure,
            local_defs=local_defs,
            leaf_type_names=leaf_type_names,
            allow_ui_types=True,
            at_least_v10=at_least_v10,
        )

    for branch in ordered_branches:
        if "anyOf" in branch:
            grp = _extract_at_least_one_of_branch(branch["anyOf"])
            if grp is not None:
                if grp not in at_least_groups:
                    at_least_groups.append(grp)
            else:
                has_untranslatable = True

        raw_reqs = branch.get("required")
        if isinstance(raw_reqs, list):
            for r in raw_reqs:
                if isinstance(r, str):
                    required_names.add(r)

        if "unevaluatedProperties" in branch or "additionalProperties" in branch:
            saw_closure = True
        raw_ap = (
            branch["unevaluatedProperties"]
            if "unevaluatedProperties" in branch
            else branch.get("additionalProperties")
        )
        if raw_ap is True:
            explicit_ap = True
        elif raw_ap is False:
            explicit_ap = False
        elif isinstance(raw_ap, Mapping):
            explicit_ap = type_definition_from_json_schema(
                raw_ap,
                local_defs=local_defs,
                leaf_type_names=leaf_type_names,
                allow_ui_types=True,
                at_least_v10=at_least_v10,
            )

        raw_props = branch.get("properties")
        if isinstance(raw_props, Mapping):
            has_inline_id = "id" in raw_props
            for prop_name, prop_val in raw_props.items():
                if prop_name in ("id", "component"):
                    continue
                if prop_name == "@checks":
                    is_checkable = True
                    continue
                if prop_name in _AT_ENVELOPE_KEYS:
                    continue
                if prop_name == "checks" and _is_standard_mixin_property(
                    "checks", prop_val, has_inline_id=has_inline_id
                ):
                    is_checkable = True
                    continue
                if prop_name in ("catalogId", "metadata", "accessibility") and (
                    _is_standard_mixin_property(
                        prop_name, prop_val, has_inline_id=has_inline_id
                    )
                ):
                    continue
                if prop_name not in prop_schemas or branch is schema:
                    if isinstance(prop_val, Mapping):
                        prop_schemas[prop_name] = prop_val
                    elif prop_val is True:
                        prop_schemas[prop_name] = {}
                    else:
                        has_untranslatable = True

    if not saw_closure and at_least_v10:
        explicit_ap = True

    params: list[ParameterDefinition] = []
    for p_name, p_schema in prop_schemas.items():
        p_type = type_definition_from_json_schema(
            p_schema,
            local_defs=local_defs,
            leaf_type_names=leaf_type_names,
            allow_ui_types=True,
            at_least_v10=at_least_v10,
        )
        params.append(
            ParameterDefinition(
                name=p_name,
                type=p_type,
                required=p_name in required_names,
            )
        )

    eff_parents = (
        tuple(allowed_parents)
        if allowed_parents is not None
        else (
            tuple(schema["allowedParents"])
            if isinstance(schema.get("allowedParents"), list)
            else None
        )
    )
    eff_children = (
        tuple(allowed_children)
        if allowed_children is not None
        else (
            tuple(schema["allowedChildren"])
            if isinstance(schema.get("allowedChildren"), list)
            else None
        )
    )
    eff_meta = (
        clone_metadata(metadata)
        if metadata is not None
        else (
            clone_metadata(schema["metadata"])
            if isinstance(schema.get("metadata"), Mapping)
            else None
        )
    )

    return ComponentDefinition(
        name=name,
        description=description,
        checkable=is_checkable,
        parameters=tuple(params),
        at_least_one_of=tuple(at_least_groups),
        allowed_parents=eff_parents,
        allowed_children=eff_children,
        metadata=eff_meta,
        deprecated=deprecated,
        deprecated_reason=deprecated_reason,
        additional_properties=explicit_ap,
        raw_schema=copy.deepcopy(dict(schema)) if has_untranslatable else None,
    )


def _declared_return_type_from_schema(
    schema: Mapping[str, Any] | None,
) -> FunctionReturnType:
    if not isinstance(schema, Mapping):
        return "any"
    top = schema.get("returnType")
    if isinstance(top, str) and top in (
        "string",
        "number",
        "boolean",
        "array",
        "object",
        "validationResult",
        "any",
        "void",
    ):
        return cast(FunctionReturnType, top)
    props = schema.get("properties")
    if isinstance(props, Mapping):
        rt = props.get("returnType")
        if isinstance(rt, Mapping):
            const_rt = rt.get("const")
            if isinstance(const_rt, str) and const_rt in (
                "string",
                "number",
                "boolean",
                "array",
                "object",
                "validationResult",
                "any",
                "void",
            ):
                return cast(FunctionReturnType, const_rt)
    return "any"


def _extract_args_schema_from_function_schema(
    schema: Mapping[str, Any],
) -> tuple[Mapping[str, Any] | None, Mapping[str, Any]]:
    """Extracts `(args_schema, merged_fn_defs)` from any of the 4 JSON Schema function shapes."""
    fn_defs: dict[str, Any] = {}
    if isinstance(schema.get("$defs"), Mapping):
        fn_defs.update(schema["$defs"])

    if isinstance(schema.get("parameters"), Mapping):
        synth: dict[str, Any] = {
            "type": "object",
            "properties": dict(schema["parameters"]),
        }
        if isinstance(schema.get("required"), list):
            synth["required"] = list(schema["required"])
        if "additionalProperties" in schema:
            synth["additionalProperties"] = schema["additionalProperties"]
        else:
            synth["additionalProperties"] = False
        return synth, fn_defs

    props = schema.get("properties")
    if isinstance(props, Mapping) and (
        "@call" in props
        or "call" in props
        or (
            set(props.keys()) <= {"args", "returnType", "catalogId", "@catalogId"}
            and isinstance(props.get("args"), Mapping)
            and isinstance(props["args"].get("properties"), Mapping)
        )
    ):
        args_obj = props.get("args")
        if isinstance(args_obj, Mapping):
            if isinstance(args_obj.get("$defs"), Mapping):
                fn_defs.update(args_obj["$defs"])
            return args_obj, fn_defs
        # Function declares `@call` with no `args` property -> accepts open/no args.
        return None, fn_defs

    if isinstance(schema.get("args"), Mapping) and not isinstance(props, Mapping):
        args_obj = schema["args"]
        if isinstance(args_obj.get("$defs"), Mapping):
            fn_defs.update(args_obj["$defs"])
        return args_obj, fn_defs

    # Raw args object schema (or empty `{}`).
    return schema, fn_defs


def function_definition_from_json_schema(
    name: str,
    schema: Mapping[str, Any] | None,
    *,
    return_type: FunctionReturnDefinition | None = None,
    allowed_callers: AllowedCallers | None = None,
    requires_user_activation: bool | None = None,
    description: str | None = None,
    local_defs: Mapping[str, Any] = {},
    leaf_type_names: frozenset[str] = frozenset(),
    at_least_v10: bool = True,
) -> FunctionDefinition:
    """Translates a function JSON Schema dict into a `FunctionDefinition`."""
    eff_return: FunctionReturnDefinition = (
        return_type
        if return_type is not None
        else _declared_return_type_from_schema(schema)
    )
    eff_callers: AllowedCallers = allowed_callers or (
        cast(AllowedCallers, schema["allowedCallers"])
        if isinstance(schema, Mapping)
        and schema.get("allowedCallers")
        in ("rendererOnly", "agentOnly", "rendererOrAgent")
        else "rendererOnly"
    )
    eff_ua = (
        bool(requires_user_activation)
        if requires_user_activation is not None
        else bool(schema.get("requiresUserActivation", False))
        if isinstance(schema, Mapping)
        else False
    )
    eff_desc = (
        description
        if description is not None
        else (
            schema["description"]
            if isinstance(schema, Mapping)
            and isinstance(schema.get("description"), str)
            else None
        )
    )
    deprecated = (
        bool(schema.get("deprecated", False)) if isinstance(schema, Mapping) else False
    )
    deprecated_reason = (
        schema["x-deprecated-reason"]
        if isinstance(schema, Mapping)
        and isinstance(schema.get("x-deprecated-reason"), str)
        else None
    )

    if schema is None or not isinstance(schema, Mapping) or not schema:
        return FunctionDefinition(
            name=name,
            return_type=eff_return,
            description=eff_desc,
            allowed_callers=eff_callers,
            requires_user_activation=eff_ua,
            additional_parameters=True,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    args_schema, fn_defs = _extract_args_schema_from_function_schema(schema)
    if args_schema is None or not args_schema:
        return FunctionDefinition(
            name=name,
            return_type=eff_return,
            description=eff_desc,
            allowed_callers=eff_callers,
            requires_user_activation=eff_ua,
            additional_parameters=True,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    combined_defs = {**local_defs, **fn_defs}
    args_type = type_definition_from_json_schema(
        args_schema,
        local_defs=combined_defs,
        leaf_type_names=leaf_type_names,
        allow_ui_types=False,
        at_least_v10=at_least_v10,
    )
    if isinstance(args_type, ObjectType):
        return FunctionDefinition(
            name=name,
            return_type=eff_return,
            description=eff_desc,
            allowed_callers=eff_callers,
            requires_user_activation=eff_ua,
            parameters=args_type.properties,
            at_least_one_of=args_type.at_least_one_of,
            additional_parameters=args_type.additional_properties,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )
    if isinstance(args_type, AnyType):
        return FunctionDefinition(
            name=name,
            return_type=eff_return,
            description=eff_desc,
            allowed_callers=eff_callers,
            requires_user_activation=eff_ua,
            additional_parameters=True,
            deprecated=deprecated,
            deprecated_reason=deprecated_reason,
        )

    return FunctionDefinition(
        name=name,
        return_type=eff_return,
        description=eff_desc,
        allowed_callers=eff_callers,
        requires_user_activation=eff_ua,
        deprecated=deprecated,
        deprecated_reason=deprecated_reason,
        raw_args_schema=copy.deepcopy(dict(args_schema)),
    )


def surface_properties_from_json_schema(
    theme_schema: Mapping[str, Any] | None,
    *,
    local_defs: Mapping[str, Any] = {},
    leaf_type_names: frozenset[str] = frozenset(),
) -> SurfacePropertiesDefinition | None:
    """Translates a catalog `theme` / `styles` schema into `SurfacePropertiesDefinition`."""
    if not isinstance(theme_schema, Mapping) or not theme_schema:
        return None
    obj_t = type_definition_from_json_schema(
        theme_schema,
        local_defs=local_defs,
        leaf_type_names=leaf_type_names,
        allow_ui_types=False,
    )
    if isinstance(obj_t, ObjectType):
        return SurfacePropertiesDefinition(
            description=obj_t.description,
            properties=obj_t.properties,
            additional_properties=obj_t.additional_properties,
        )
    return SurfacePropertiesDefinition(
        description=(
            theme_schema["description"]
            if isinstance(theme_schema.get("description"), str)
            else None
        ),
        raw_schema=copy.deepcopy(dict(theme_schema)),
    )


def extract_leaf_types_from_defs(
    defs: Mapping[str, Any],
    *,
    excluded_names: frozenset[str] = frozenset(),
    at_least_v10: bool = True,
) -> dict[str, DataTypeDefinition]:
    """Translates non-structural, non-mixin catalog `$defs` into `CatalogModel.types`."""
    candidate_names = frozenset(
        name
        for name, val in defs.items()
        if isinstance(name, str)
        and isinstance(val, Mapping)
        and name not in _STRUCTURAL_DEFS
        and name not in _COMMON_TYPE_NAMES
        and name not in excluded_names
        and is_valid_uax31_identifier(name)
    )
    leaf_types: dict[str, DataTypeDefinition] = {}
    for name in defs:
        if name not in candidate_names:
            continue
        parsed = type_definition_from_json_schema(
            defs[name],
            local_defs=defs,
            leaf_type_names=candidate_names - {name},
            allow_ui_types=False,
            at_least_v10=at_least_v10,
            visited=frozenset({name}),
        )
        if not contains_ui_type(parsed):
            leaf_types[name] = cast(DataTypeDefinition, parsed)
    return leaf_types


def from_json_schema(
    catalog_schema: Mapping[str, Any],
    *,
    protocol_version: ProtocolVersion | str | None = None,
    catalog_id: str | None = None,
) -> CatalogModel:
    """Translates a legacy v0.8/v0.9/v0.9.1/v1.0 JSON Schema catalog into `CatalogModel`."""
    resolved_id = catalog_id or catalog_schema.get("catalogId")
    if not isinstance(resolved_id, str) or not resolved_id:
        raise A2uiCatalogError(
            "catalog_id must be provided or exist in catalog schema."
        )

    raw_ver = catalog_schema.get("protocolVersion")
    declared_ver = raw_ver if isinstance(raw_ver, str) else None
    raw_pv = protocol_version or declared_ver or "0.9"
    pv_str = raw_pv.value if isinstance(raw_pv, ProtocolVersion) else str(raw_pv)
    canonical_pv = to_canonical_version(pv_str) or pv_str

    raw_defs = catalog_schema.get("$defs")
    defs_map: dict[str, Any] = dict(raw_defs) if isinstance(raw_defs, Mapping) else {}

    # First pass: discover which local `$defs` are used as component `allOf` mixins
    # (e.g. v0.9 `CatalogComponentCommon`), so they are inlined rather than emitted
    # as standalone `types` entries.
    used_mixins: set[str] = set()
    raw_components = catalog_schema.get("components")
    if isinstance(raw_components, Mapping):
        for comp_schema in raw_components.values():
            if isinstance(comp_schema, Mapping):
                _collect_component_all_of_branches(
                    comp_schema, defs_map, set(), used_mixins
                )

    at_least_v10 = is_at_least_version(canonical_pv, ProtocolVersion.V1_0)
    leaf_types = extract_leaf_types_from_defs(
        defs_map,
        excluded_names=frozenset(used_mixins),
        at_least_v10=at_least_v10,
    )
    leaf_type_names = frozenset(leaf_types.keys())

    components: list[ComponentDefinition] = []
    if isinstance(raw_components, Mapping):
        for comp_name, comp_schema in raw_components.items():
            if isinstance(comp_schema, Mapping):
                components.append(
                    component_definition_from_json_schema(
                        str(comp_name),
                        comp_schema,
                        local_defs=defs_map,
                        leaf_type_names=leaf_type_names,
                        at_least_v10=at_least_v10,
                    )
                )

    functions: list[FunctionDefinition] = []
    raw_functions = catalog_schema.get("functions")
    if isinstance(raw_functions, Mapping):
        for fn_name, fn_schema in raw_functions.items():
            if isinstance(fn_schema, Mapping):
                functions.append(
                    function_definition_from_json_schema(
                        str(fn_name),
                        fn_schema,
                        local_defs=defs_map,
                        leaf_type_names=leaf_type_names,
                        at_least_v10=at_least_v10,
                    )
                )
    elif isinstance(raw_functions, list):
        for entry in raw_functions:
            if isinstance(entry, Mapping) and isinstance(entry.get("name"), str):
                fn_name = entry["name"]
                rest = {k: v for k, v in entry.items() if k != "name"}
                functions.append(
                    function_definition_from_json_schema(
                        fn_name,
                        rest,
                        local_defs=defs_map,
                        leaf_type_names=leaf_type_names,
                        at_least_v10=at_least_v10,
                    )
                )

    theme_raw: Mapping[str, Any] | None = None
    if isinstance(catalog_schema.get("theme"), Mapping):
        theme_raw = catalog_schema["theme"]
    elif isinstance(catalog_schema.get("styles"), Mapping):
        styles = catalog_schema["styles"]
        if styles and "properties" not in styles and styles.get("type") != "object":
            theme_raw = {"type": "object", "properties": dict(styles)}
        else:
            theme_raw = styles
    elif isinstance(defs_map.get("theme"), Mapping):
        theme_raw = defs_map["theme"]

    surface_props = surface_properties_from_json_schema(
        theme_raw,
        local_defs=defs_map,
        leaf_type_names=leaf_type_names,
    )

    def _str_or_none(key: str) -> str | None:
        v = catalog_schema.get(key)
        return v if isinstance(v, str) else None

    cat_meta = (
        clone_metadata(catalog_schema["metadata"])
        if isinstance(catalog_schema.get("metadata"), Mapping)
        else None
    )

    return CatalogModel(
        catalog_id=resolved_id,
        protocol_version=canonical_pv,
        format_version=CATALOG_DOCUMENT_FORMAT_VERSION,
        title=_str_or_none("title"),
        description=_str_or_none("description"),
        instructions=_str_or_none("instructions"),
        metadata=cat_meta,
        types=leaf_types,
        surface_properties=surface_props,
        components=tuple(components),
        functions=tuple(functions),
    )


# ==============================================================================
# Outbound: CatalogModel -> JSON Schema
# ==============================================================================


def _common_ref(name: str, common_types_uri: str) -> str:
    return f"{common_types_uri}#/$defs/{name}"


def _attach_json_schema_meta(
    node: dict[str, Any], type_def: TypeDefinition
) -> dict[str, Any]:
    if type_def.description is not None:
        node["description"] = type_def.description
    if type_def.deprecated:
        node["deprecated"] = True
    if type_def.deprecated_reason is not None:
        node["x-deprecated-reason"] = type_def.deprecated_reason
    return node


def _wrap_dynamic_one_of(
    literal_schema: dict[str, Any],
    common_types_uri: str,
) -> dict[str, Any]:
    return {
        "oneOf": [
            literal_schema,
            {"$ref": _common_ref("DataBinding", common_types_uri)},
            {"$ref": _common_ref("FunctionCall", common_types_uri)},
        ]
    }


def _emit_at_least_one_of(
    groups: tuple[tuple[str, ...], ...],
) -> dict[str, Any]:
    if not groups:
        return {}
    if len(groups) == 1:
        return {"anyOf": [{"required": [name]} for name in groups[0]]}
    return {
        "allOf": [{"anyOf": [{"required": [name]} for name in grp]} for grp in groups]
    }


def type_definition_to_json_schema(
    type_def: TypeDefinition,
    *,
    at_least_v10: bool = True,
    common_types_uri: str = "common_types.json",
) -> dict[str, Any]:
    """Synthesizes a JSON Schema Draft 2020-12 fragment from a `TypeDefinition`."""
    if isinstance(type_def, RawJsonSchemaType):
        return copy.deepcopy(dict(type_def.schema))

    if isinstance(type_def, StringType):
        has_constraints = (
            type_def.format is not None
            or type_def.pattern is not None
            or type_def.min_length is not None
            or type_def.max_length is not None
        )
        if type_def.dynamic and not has_constraints:
            node: dict[str, Any] = {
                "$ref": _common_ref("DynamicString", common_types_uri)
            }
        elif (
            type_def.dynamic
            and isinstance(type_def.format, tuple)
            and type_def.pattern is None
            and type_def.min_length is None
            and type_def.max_length is None
        ):
            node = {
                "allOf": [
                    {"$ref": _common_ref("DynamicString", common_types_uri)},
                    {
                        "if": {"type": "string"},
                        "then": {"oneOf": [{"format": fmt} for fmt in type_def.format]},
                    },
                ]
            }
        else:
            lit: dict[str, Any] = {"type": "string"}
            if isinstance(type_def.format, str):
                lit["format"] = type_def.format
            elif isinstance(type_def.format, tuple):
                lit["oneOf"] = [{"format": fmt} for fmt in type_def.format]
            if type_def.pattern is not None:
                lit["pattern"] = type_def.pattern
            if type_def.min_length is not None:
                lit["minLength"] = type_def.min_length
            if type_def.max_length is not None:
                lit["maxLength"] = type_def.max_length
            node = (
                _wrap_dynamic_one_of(lit, common_types_uri) if type_def.dynamic else lit
            )
        if type_def.default is not None:
            node["default"] = type_def.default
        return _attach_json_schema_meta(node, type_def)

    if isinstance(type_def, NumberType):
        has_bounds = type_def.min is not None or type_def.max is not None
        if type_def.dynamic and not has_bounds:
            node = {"$ref": _common_ref("DynamicNumber", common_types_uri)}
        else:
            lit = {"type": "number"}
            if type_def.min is not None:
                lit["minimum"] = type_def.min
            if type_def.max is not None:
                lit["maximum"] = type_def.max
            node = (
                _wrap_dynamic_one_of(lit, common_types_uri) if type_def.dynamic else lit
            )
        if type_def.default is not None:
            node["default"] = type_def.default
        return _attach_json_schema_meta(node, type_def)

    if isinstance(type_def, IntegerType):
        lit = {"type": "integer"}
        if type_def.min is not None:
            lit["minimum"] = type_def.min
        if type_def.max is not None:
            lit["maximum"] = type_def.max
        node = _wrap_dynamic_one_of(lit, common_types_uri) if type_def.dynamic else lit
        if type_def.default is not None:
            node["default"] = type_def.default
        return _attach_json_schema_meta(node, type_def)

    if isinstance(type_def, BooleanType):
        if type_def.dynamic:
            node = {"$ref": _common_ref("DynamicBoolean", common_types_uri)}
        else:
            node = {"type": "boolean"}
        if type_def.default is not None:
            node["default"] = type_def.default
        return _attach_json_schema_meta(node, type_def)

    if isinstance(type_def, EnumType):
        lit = {"type": type_def.value_type, "enum": list(type_def.values)}
        node = _wrap_dynamic_one_of(lit, common_types_uri) if type_def.dynamic else lit
        if type_def.default is not None:
            node["default"] = type_def.default
        return _attach_json_schema_meta(node, type_def)

    if isinstance(type_def, ConstType):
        node = {"const": type_def.value}
        return _attach_json_schema_meta(node, type_def)

    if isinstance(type_def, AnyType):
        if type_def.dynamic and not type_def.nullable:
            node = {"$ref": _common_ref("DynamicValue", common_types_uri)}
        else:
            node = {}
        if type_def.default is not UNSET:
            node["default"] = copy.deepcopy(type_def.default)
        return _attach_json_schema_meta(node, type_def)

    if isinstance(type_def, DataBindingType):
        return _attach_json_schema_meta(
            {"$ref": _common_ref("DataBinding", common_types_uri)}, type_def
        )

    if isinstance(type_def, FunctionCallType):
        return _attach_json_schema_meta(
            {"$ref": _common_ref("FunctionCall", common_types_uri)}, type_def
        )

    if isinstance(type_def, RefType):
        node = {"$ref": f"#/$defs/{type_def.ref}"}
        if type_def.default is not UNSET:
            node["default"] = copy.deepcopy(type_def.default)
        return _attach_json_schema_meta(node, type_def)

    if isinstance(type_def, ChildType):
        ref_name = "Child" if at_least_v10 else "ComponentId"
        return _attach_json_schema_meta(
            {"$ref": _common_ref(ref_name, common_types_uri)}, type_def
        )

    if isinstance(type_def, ChildListType):
        return _attach_json_schema_meta(
            {"$ref": _common_ref("ChildList", common_types_uri)}, type_def
        )

    if isinstance(type_def, ActionType):
        return _attach_json_schema_meta(
            {"$ref": _common_ref("Action", common_types_uri)}, type_def
        )

    if isinstance(type_def, CheckRuleType):
        return _attach_json_schema_meta(
            {"$ref": _common_ref("CheckRule", common_types_uri)}, type_def
        )

    if isinstance(type_def, AccessibilityType):
        return _attach_json_schema_meta(
            {"$ref": _common_ref("AccessibilityAttributes", common_types_uri)},
            type_def,
        )

    if isinstance(type_def, ArrayType):
        is_plain_dynamic_str_list = (
            type_def.dynamic
            and isinstance(type_def.items, StringType)
            and not type_def.items.dynamic
            and type_def.items.format is None
            and type_def.items.pattern is None
            and type_def.items.min_length is None
            and type_def.items.max_length is None
            and type_def.min_items is None
            and type_def.max_items is None
            and not type_def.unique_items
        )
        if is_plain_dynamic_str_list:
            node = {"$ref": _common_ref("DynamicStringList", common_types_uri)}
        else:
            lit = {"type": "array"}
            if type_def.items is not None:
                lit["items"] = type_definition_to_json_schema(
                    type_def.items,
                    at_least_v10=at_least_v10,
                    common_types_uri=common_types_uri,
                )
            if type_def.min_items is not None:
                lit["minItems"] = type_def.min_items
            if type_def.max_items is not None:
                lit["maxItems"] = type_def.max_items
            if type_def.unique_items:
                lit["uniqueItems"] = True
            node = (
                _wrap_dynamic_one_of(lit, common_types_uri) if type_def.dynamic else lit
            )
        if type_def.default is not None:
            node["default"] = copy.deepcopy(list(type_def.default))
        return _attach_json_schema_meta(node, type_def)

    if isinstance(type_def, ObjectType):
        lit = {"type": "object"}
        if type_def.properties:
            lit["properties"] = {
                p.name: type_definition_to_json_schema(
                    p.type,
                    at_least_v10=at_least_v10,
                    common_types_uri=common_types_uri,
                )
                for p in type_def.properties
            }
            reqs = [p.name for p in type_def.properties if p.required]
            if reqs:
                lit["required"] = reqs
        if type_def.at_least_one_of:
            lit.update(_emit_at_least_one_of(type_def.at_least_one_of))
        if isinstance(type_def.additional_properties, bool):
            lit["additionalProperties"] = type_def.additional_properties
        else:
            lit["additionalProperties"] = type_definition_to_json_schema(
                type_def.additional_properties,
                at_least_v10=at_least_v10,
                common_types_uri=common_types_uri,
            )
        node = _wrap_dynamic_one_of(lit, common_types_uri) if type_def.dynamic else lit
        if type_def.default is not None:
            node["default"] = copy.deepcopy(dict(type_def.default))
        return _attach_json_schema_meta(node, type_def)

    # UnionType
    comb_key = "oneOf" if type_def.exclusive else "anyOf"
    variants = [
        type_definition_to_json_schema(
            v, at_least_v10=at_least_v10, common_types_uri=common_types_uri
        )
        for v in type_def.variants
    ]
    if type_def.dynamic:
        variants.append({"$ref": _common_ref("DataBinding", common_types_uri)})
        variants.append({"$ref": _common_ref("FunctionCall", common_types_uri)})
    node = {comb_key: variants}
    if type_def.default is not UNSET:
        node["default"] = copy.deepcopy(type_def.default)
    return _attach_json_schema_meta(node, type_def)


def component_definition_to_json_schema(
    comp_def: ComponentDefinition,
    *,
    at_least_v10: bool = True,
    common_types_uri: str = "common_types.json",
) -> dict[str, Any]:
    """Synthesizes a component JSON Schema dict from a `ComponentDefinition`."""
    if comp_def.raw_schema is not None:
        return copy.deepcopy(dict(comp_def.raw_schema))

    props: dict[str, Any] = {"component": {"const": comp_def.name}}
    reqs: list[str] = ["component"]
    for param in comp_def.parameters:
        props[param.name] = type_definition_to_json_schema(
            param.type,
            at_least_v10=at_least_v10,
            common_types_uri=common_types_uri,
        )
        if param.required:
            reqs.append(param.name)

    body: dict[str, Any] = {
        "type": "object",
        "properties": props,
        "required": reqs,
    }
    if comp_def.at_least_one_of:
        body.update(_emit_at_least_one_of(comp_def.at_least_one_of))
    if comp_def.additional_properties is True:
        body["additionalProperties"] = True
    elif not isinstance(comp_def.additional_properties, bool):
        body["additionalProperties"] = type_definition_to_json_schema(
            comp_def.additional_properties,
            at_least_v10=at_least_v10,
            common_types_uri=common_types_uri,
        )

    if at_least_v10:
        if comp_def.checkable:
            schema: dict[str, Any] = {
                "type": "object",
                "allOf": [
                    {"$ref": _common_ref("Checkable", common_types_uri)},
                    body,
                ],
            }
        else:
            schema = body
    else:
        all_of: list[dict[str, Any]] = [
            {"$ref": _common_ref("ComponentCommon", common_types_uri)}
        ]
        if comp_def.checkable:
            all_of.append({"$ref": _common_ref("Checkable", common_types_uri)})
        all_of.append(body)
        schema = {
            "type": "object",
            "allOf": all_of,
            "unevaluatedProperties": False,
        }

    if comp_def.description is not None:
        schema["description"] = comp_def.description
    if comp_def.allowed_parents is not None:
        schema["allowedParents"] = list(comp_def.allowed_parents)
    if comp_def.allowed_children is not None:
        schema["allowedChildren"] = list(comp_def.allowed_children)
    if comp_def.metadata is not None:
        schema["metadata"] = clone_metadata(comp_def.metadata)
    if comp_def.deprecated:
        schema["deprecated"] = True
    if comp_def.deprecated_reason is not None:
        schema["x-deprecated-reason"] = comp_def.deprecated_reason
    return schema


def function_definition_to_json_schema(
    fn_def: FunctionDefinition,
    *,
    at_least_v10: bool = True,
    common_types_uri: str = "common_types.json",
) -> dict[str, Any]:
    """Synthesizes a function call JSON Schema dict from a `FunctionDefinition`."""
    ret_cat = function_return_category(fn_def.return_type)
    call_key = "@call" if at_least_v10 else "call"

    if fn_def.raw_args_schema is not None:
        args_schema = copy.deepcopy(dict(fn_def.raw_args_schema))
    else:
        args_schema = {"type": "object"}
        if fn_def.parameters:
            args_schema["properties"] = {
                p.name: type_definition_to_json_schema(
                    p.type,
                    at_least_v10=at_least_v10,
                    common_types_uri=common_types_uri,
                )
                for p in fn_def.parameters
            }
            reqs = [p.name for p in fn_def.parameters if p.required]
            if reqs:
                args_schema["required"] = reqs
        if fn_def.at_least_one_of:
            args_schema.update(_emit_at_least_one_of(fn_def.at_least_one_of))
        if fn_def.additional_parameters is False:
            args_schema["unevaluatedProperties"] = False
        elif fn_def.additional_parameters is True:
            args_schema["additionalProperties"] = True
        else:
            args_schema["additionalProperties"] = type_definition_to_json_schema(
                fn_def.additional_parameters,
                at_least_v10=at_least_v10,
                common_types_uri=common_types_uri,
            )

    props: dict[str, Any] = {
        call_key: {"const": fn_def.name},
        "args": args_schema,
    }
    schema: dict[str, Any] = {"type": "object"}
    if fn_def.description is not None:
        schema["description"] = fn_def.description
    if at_least_v10:
        schema["returnType"] = ret_cat
        if fn_def.allowed_callers != "rendererOnly":
            schema["allowedCallers"] = fn_def.allowed_callers
        if fn_def.requires_user_activation:
            schema["requiresUserActivation"] = True
    else:
        props["returnType"] = {"const": ret_cat}
    schema["properties"] = props
    req_call = [call_key]
    if fn_def.parameters or fn_def.at_least_one_of or at_least_v10:
        if (
            at_least_v10
            or any(p.required for p in fn_def.parameters)
            or fn_def.at_least_one_of
        ):
            req_call.append("args")
    schema["required"] = req_call
    if not at_least_v10:
        schema["unevaluatedProperties"] = False
    if fn_def.deprecated:
        schema["deprecated"] = True
    if fn_def.deprecated_reason is not None:
        schema["x-deprecated-reason"] = fn_def.deprecated_reason
    return schema


def surface_properties_to_json_schema(
    surface_props: SurfacePropertiesDefinition,
    *,
    at_least_v10: bool = True,
    common_types_uri: str = "common_types.json",
) -> dict[str, Any]:
    """Synthesizes a JSON Schema object for `SurfacePropertiesDefinition`."""
    if surface_props.raw_schema is not None:
        return copy.deepcopy(dict(surface_props.raw_schema))
    schema: dict[str, Any] = {"type": "object"}
    if surface_props.description is not None:
        schema["description"] = surface_props.description
    if surface_props.properties:
        schema["properties"] = {
            p.name: type_definition_to_json_schema(
                p.type,
                at_least_v10=at_least_v10,
                common_types_uri=common_types_uri,
            )
            for p in surface_props.properties
        }
        reqs = [p.name for p in surface_props.properties if p.required]
        if reqs:
            schema["required"] = reqs
    if isinstance(surface_props.additional_properties, bool):
        schema["additionalProperties"] = surface_props.additional_properties
    else:
        schema["additionalProperties"] = type_definition_to_json_schema(
            surface_props.additional_properties,
            at_least_v10=at_least_v10,
            common_types_uri=common_types_uri,
        )
    return schema


def to_json_schema(
    model: CatalogModel,
    *,
    protocol_version: ProtocolVersion | str | None = None,
    common_types_uri: str = "common_types.json",
) -> dict[str, Any]:
    """Synthesizes a spec-compliant JSON Schema catalog document from `CatalogModel`."""
    raw_pv = protocol_version or model.protocol_version or "1.0"
    pv_str = raw_pv.value if isinstance(raw_pv, ProtocolVersion) else str(raw_pv)
    canonical_pv = to_canonical_version(pv_str) or pv_str
    at_least_v10 = is_at_least_version(canonical_pv, ProtocolVersion.V1_0)

    doc: dict[str, Any] = {
        "$schema": _JSON_SCHEMA_DIALECT,
        "$id": model.catalog_id,
        "protocolVersion": canonical_pv,
    }
    if model.title is not None:
        doc["title"] = model.title
    if model.description is not None:
        doc["description"] = model.description
    doc["catalogId"] = model.catalog_id
    if model.instructions is not None:
        doc["instructions"] = model.instructions
    if model.metadata is not None:
        doc["metadata"] = clone_metadata(model.metadata)

    if model.components:
        doc["components"] = {
            comp.name: component_definition_to_json_schema(
                comp,
                at_least_v10=at_least_v10,
                common_types_uri=common_types_uri,
            )
            for comp in model.components
        }

    if model.functions:
        doc["functions"] = {
            fn.name: function_definition_to_json_schema(
                fn,
                at_least_v10=at_least_v10,
                common_types_uri=common_types_uri,
            )
            for fn in model.functions
        }

    defs: dict[str, Any] = {}
    if model.surface_properties is not None:
        theme_doc = surface_properties_to_json_schema(
            model.surface_properties,
            at_least_v10=at_least_v10,
            common_types_uri=common_types_uri,
        )
        if at_least_v10:
            doc["theme"] = theme_doc
        else:
            defs["theme"] = theme_doc

    if model.components:
        defs["anyComponent"] = {
            "oneOf": [{"$ref": f"#/components/{c.name}"} for c in model.components],
            "discriminator": {"propertyName": "component"},
        }
    else:
        defs["anyComponent"] = {"not": {}}

    if model.functions:
        defs["anyFunction"] = {
            "oneOf": [{"$ref": f"#/functions/{f.name}"} for f in model.functions]
        }
    else:
        defs["anyFunction"] = {"not": {}}

    for type_name, type_def in model.types.items():
        defs[type_name] = type_definition_to_json_schema(
            type_def,
            at_least_v10=at_least_v10,
            common_types_uri=common_types_uri,
        )

    doc["$defs"] = defs
    return doc


__all__ = [
    "component_definition_from_json_schema",
    "component_definition_to_json_schema",
    "extract_leaf_types_from_defs",
    "from_json_schema",
    "function_definition_from_json_schema",
    "function_definition_to_json_schema",
    "surface_properties_from_json_schema",
    "surface_properties_to_json_schema",
    "to_json_schema",
    "type_definition_from_json_schema",
    "type_definition_to_json_schema",
]
