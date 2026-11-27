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

"""Direct Pydantic BaseModel to canonical `CatalogModel` adapter.

Introspects Python type annotations and Pydantic v2 `model_fields` directly to
produce `ComponentDefinition`, `FunctionDefinition`, and
`SurfacePropertiesDefinition` without round-tripping through JSON Schema.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import copy
from dataclasses import replace
import enum
import inspect
import types
from typing import (
    Annotated,
    Any,
    Final,
    Literal,
    Union,
    cast,
    get_args,
    get_origin,
)

from annotated_types import Ge, Le, MaxLen, MinLen
from pydantic import BaseModel
from pydantic.fields import FieldInfo
from pydantic.types import StringConstraints
from pydantic_core import PydanticUndefined
from typing_extensions import TypeAliasType

from ..common.metadata import clone_metadata
from ..schema._json_schema import CatalogDef, SchemaKeywords, SpecAllOf
from ..schema.common_types import (
    ListReference,
    SingleReference,
    TemplateChildList,
)
from .functions import AllowedCallers
from .json_schema_adapter import (
    _extract_at_least_one_of_branch,
    _extract_if_then_string_formats,
    _infer_enum_value_type,
    _make_dynamic,
)
from .model import (
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
    ConstValue,
    DataBindingType,
    DataTypeDefinition,
    EnumType,
    EnumValue,
    FunctionCallType,
    FunctionDefinition,
    FunctionReturnDefinition,
    IntegerType,
    NumberType,
    ObjectType,
    ParameterDefinition,
    RefType,
    StringType,
    SurfacePropertiesDefinition,
    TypeDefinition,
    UnionType,
    contains_ui_type,
    is_json_int,
    is_json_number,
)

_ENVELOPE_BASE_NAMES: Final[frozenset[str]] = frozenset(
    {"ComponentCommon", "Checkable"}
)
_AT_ENVELOPE_KEYS: Final[frozenset[str]] = frozenset(
    {"@metadata", "@catalogId", "@accessibility", "@checks"}
)
_ACTION_WRAPPER_NAMES: Final[tuple[str, ...]] = (
    "ActionEventWrapper",
    "ActionFunctionCallWrapper",
)


def _is_model_named(tp: Any, names: str | tuple[str, ...]) -> bool:
    if not (isinstance(tp, type) and issubclass(tp, BaseModel)):
        return False
    return tp.__name__ == names if isinstance(names, str) else tp.__name__ in names


def _own_docstring(model_cls: type[BaseModel]) -> str | None:
    raw_doc = model_cls.__dict__.get("__doc__")
    return (
        inspect.cleandoc(raw_doc)
        if isinstance(raw_doc, str) and raw_doc.strip()
        else None
    )


def _unwrap_annotated_and_aliases(
    annotation: Any,
) -> tuple[Any, list[Any], str | None]:
    """Unwraps `TypeAliasType` and `Annotated`, returning `(inner, metadata, alias_name)`."""
    metadata: list[Any] = []
    alias_name: str | None = None
    current = annotation
    while True:
        if isinstance(current, TypeAliasType):
            if alias_name is None:
                alias_name = current.__name__
            current = current.__value__
        elif get_origin(current) is Annotated:
            args = get_args(current)
            if args:
                current = args[0]
                metadata.extend(args[1:])
            else:
                break
        else:
            break
    return current, metadata, alias_name


def _collect_field_info(
    fi: FieldInfo, info: dict[str, Any], extra_meta: list[Any]
) -> None:
    if fi.description is not None and "description" not in info:
        info["description"] = fi.description
    if fi.deprecated:
        info["deprecated"] = True
        if isinstance(fi.deprecated, str):
            info["deprecated_reason"] = fi.deprecated
    extra = fi.json_schema_extra
    if isinstance(extra, Mapping):
        if "default" in extra and "default" not in info:
            info["default"] = extra["default"]
        if isinstance(extra.get("format"), str):
            info["format"] = extra["format"]
    elif isinstance(extra, SchemaKeywords):
        extra_meta.append(extra)
    if (
        fi.default is not PydanticUndefined
        and fi.default is not None
        and "default" not in info
    ):
        info["default"] = fi.default
    extra_meta.extend(fi.metadata)


def _collect_constraint_item(item: Any, info: dict[str, Any]) -> None:
    if isinstance(item, Ge):
        info["min"] = item.ge
    elif isinstance(item, Le):
        info["max"] = item.le
    elif isinstance(item, MinLen):
        info["min_length"] = item.min_length
    elif isinstance(item, MaxLen):
        info["max_length"] = item.max_length
    elif isinstance(item, StringConstraints):
        if item.pattern is not None:
            info["pattern"] = item.pattern
        if item.min_length is not None:
            info["min_length"] = item.min_length
        if item.max_length is not None:
            info["max_length"] = item.max_length
    elif isinstance(item, SchemaKeywords):
        kw = item.keywords
        if isinstance(kw.get("format"), str):
            info["format"] = kw["format"]
        if isinstance(kw.get("pattern"), str):
            info["pattern"] = kw["pattern"]
        if is_json_int(kw.get("minLength")):
            info["min_length"] = kw["minLength"]
        if is_json_int(kw.get("maxLength")):
            info["max_length"] = kw["maxLength"]
        for src, dst in (
            ("minimum", "min"),
            ("maximum", "max"),
            ("minItems", "min_items"),
            ("maxItems", "max_items"),
        ):
            if src in kw:
                info[dst] = kw[src]
    elif isinstance(item, SpecAllOf):
        for branch in item.schemas:
            if isinstance(branch, Mapping):
                fmt = _extract_if_then_string_formats(branch)
                if fmt is not None:
                    info["format"] = fmt


def _extract_field_constraints(
    metadata: Sequence[Any], field_info: FieldInfo | None = None
) -> dict[str, Any]:
    """Collects typed constraints, descriptions, formats, and CatalogDef markers."""
    info: dict[str, Any] = {}
    queue: list[Any] = list(metadata)
    if field_info is not None:
        _collect_field_info(field_info, info, queue)

    idx = 0
    while idx < len(queue):
        item = queue[idx]
        idx += 1
        if isinstance(item, CatalogDef):
            info["catalog_def"] = item.name
        elif isinstance(item, FieldInfo):
            _collect_field_info(item, info, queue)
        else:
            _collect_constraint_item(item, info)
    return info


def _apply_constraints(
    type_def: TypeDefinition, constraints: Mapping[str, Any]
) -> TypeDefinition:
    updates: dict[str, Any] = {}
    if "description" in constraints and type_def.description is None:
        updates["description"] = constraints["description"]
    if constraints.get("deprecated"):
        updates["deprecated"] = True
    if "deprecated_reason" in constraints:
        updates["deprecated_reason"] = constraints["deprecated_reason"]

    default = constraints.get("default")
    if isinstance(type_def, StringType):
        for key in ("format", "pattern", "min_length", "max_length"):
            if key in constraints and getattr(type_def, key) is None:
                updates[key] = constraints[key]
        if isinstance(default, str):
            updates["default"] = default
    elif isinstance(type_def, NumberType):
        for key in ("min", "max"):
            if key in constraints and getattr(type_def, key) is None:
                updates[key] = constraints[key]
        if is_json_number(default):
            updates["default"] = default
    elif isinstance(type_def, IntegerType):
        for key in ("min", "max"):
            if key in constraints and getattr(type_def, key) is None:
                updates[key] = int(constraints[key])
        if is_json_int(default):
            updates["default"] = default
    elif isinstance(type_def, BooleanType):
        if isinstance(default, bool):
            updates["default"] = default
    elif isinstance(type_def, EnumType):
        if default is not None:
            updates["default"] = default
    elif isinstance(type_def, ArrayType):
        if type_def.min_items is None:
            if "min_items" in constraints:
                updates["min_items"] = constraints["min_items"]
            elif "min_length" in constraints:
                updates["min_items"] = constraints["min_length"]
        if type_def.max_items is None:
            if "max_items" in constraints:
                updates["max_items"] = constraints["max_items"]
            elif "max_length" in constraints:
                updates["max_items"] = constraints["max_length"]
        if isinstance(default, (list, tuple)):
            updates["default"] = tuple(copy.deepcopy(default))
    elif isinstance(type_def, ObjectType):
        if isinstance(default, Mapping):
            updates["default"] = copy.deepcopy(dict(default))
    elif isinstance(type_def, (AnyType, RefType, UnionType)):
        if "default" in constraints:
            updates["default"] = copy.deepcopy(default)

    return replace(type_def, **updates) if updates else type_def


def _is_dynamic_value_branches(branches: Sequence[Any]) -> bool:
    """Recognizes the v0.9/v1.0 `DynamicValue` literal branches (`str|float|int|bool|list|dict`)."""
    primitives: set[type] = set()
    for b in branches:
        inner, _, _ = _unwrap_annotated_and_aliases(b)
        origin = get_origin(inner)
        if inner in (str, int, float, bool):
            primitives.add(inner)
        elif origin is list:
            primitives.add(list)
        elif origin is dict or inner is dict:
            primitives.add(dict)
        else:
            return False
    return {str, bool, list} <= primitives and bool(primitives & {int, float})


def type_definition_from_annotation(
    annotation: Any,
    *,
    field_info: FieldInfo | None = None,
    allow_ui_types: bool = True,
    extracted_types: dict[str, DataTypeDefinition] | None = None,
    visited_models: frozenset[type[BaseModel]] = frozenset(),
) -> TypeDefinition:
    """Converts a Python/Pydantic type annotation into a canonical `TypeDefinition`."""
    inner, meta, alias_name = _unwrap_annotated_and_aliases(annotation)
    constraints = _extract_field_constraints(meta, field_info)

    # Strip Optional (`T | None`) at top level while preserving nested Annotated metadata.
    origin = get_origin(inner)
    if origin is Union or origin is types.UnionType:
        raw_args = get_args(inner)
        non_none = [a for a in raw_args if a is not type(None)]
        if len(non_none) < len(raw_args):
            if len(non_none) == 1:
                sub_inner, sub_meta, sub_alias = _unwrap_annotated_and_aliases(
                    non_none[0]
                )
                merged_meta = [*sub_meta, *meta]
                inner, meta = sub_inner, merged_meta
                alias_name = alias_name or sub_alias
                constraints = _extract_field_constraints(merged_meta, field_info)
            else:
                inner = cast(Any, Union)[tuple(non_none)]

    # Handle CatalogDef("Weight") leaf type marker.
    catalog_def_name = constraints.get("catalog_def")
    if isinstance(catalog_def_name, str) and extracted_types is not None:
        leaf_constraints = {k: v for k, v in constraints.items() if k != "catalog_def"}
        leaf_type = _apply_constraints(
            _convert_core_annotation(
                inner,
                alias_name=alias_name,
                allow_ui_types=False,
                extracted_types=extracted_types,
                visited_models=visited_models,
            ),
            leaf_constraints,
        )
        if not contains_ui_type(leaf_type):
            if catalog_def_name not in extracted_types:
                extracted_types[catalog_def_name] = cast(DataTypeDefinition, leaf_type)
            ref_desc = (
                field_info.description
                if field_info is not None
                and field_info.description is not None
                and field_info.description
                != extracted_types[catalog_def_name].description
                else None
            )
            return RefType(
                ref=catalog_def_name,
                description=ref_desc,
                deprecated=bool(constraints.get("deprecated", False)),
                deprecated_reason=constraints.get("deprecated_reason"),
            )

    core = _convert_core_annotation(
        inner,
        alias_name=alias_name,
        allow_ui_types=allow_ui_types,
        extracted_types=extracted_types,
        visited_models=visited_models,
    )
    return _apply_constraints(core, constraints)


def _convert_core_annotation(
    inner: Any,
    *,
    alias_name: str | None,
    allow_ui_types: bool,
    extracted_types: dict[str, DataTypeDefinition] | None,
    visited_models: frozenset[type[BaseModel]],
) -> TypeDefinition:
    if alias_name == "Action" and allow_ui_types:
        return ActionType()
    if alias_name == "ChildList" and allow_ui_types:
        return ChildListType()
    if alias_name in ("Child", "ComponentId") and allow_ui_types:
        return ChildType()
    if alias_name == "Extensions":
        return ObjectType(additional_properties=AnyType(dynamic=True, nullable=True))

    if inner in (Any, object):
        return AnyType(dynamic=True, nullable=True)
    if inner is bool:
        return BooleanType()
    if inner is int:
        return IntegerType()
    if inner is float:
        return NumberType()
    if inner is str:
        return StringType()

    if isinstance(inner, type):
        if issubclass(inner, SingleReference):
            return ChildType() if allow_ui_types else StringType()
        if issubclass(inner, (ListReference, TemplateChildList)):
            return ChildListType() if allow_ui_types else ArrayType(items=StringType())
        if _is_model_named(inner, "DataBinding"):
            return DataBindingType()
        if _is_model_named(inner, "FunctionCall"):
            return FunctionCallType()
        if _is_model_named(inner, "AccessibilityAttributes") and allow_ui_types:
            return AccessibilityType()
        if _is_model_named(inner, "CheckRule") and allow_ui_types:
            return CheckRuleType()
        if issubclass(inner, enum.Enum):
            vals = tuple(cast(EnumValue, m.value) for m in inner)
            return EnumType(values=vals, value_type=_infer_enum_value_type(vals))
        if issubclass(inner, BaseModel):
            return _object_type_from_model(
                inner,
                allow_ui_types=allow_ui_types,
                extracted_types=extracted_types,
                visited_models=visited_models,
            )

    origin = get_origin(inner)
    args = get_args(inner)

    if origin is Literal:
        if len(args) == 1:
            return ConstType(value=cast(ConstValue, args[0]))
        vals = tuple(cast(EnumValue, v) for v in args)
        return EnumType(values=vals, value_type=_infer_enum_value_type(vals))

    if origin is tuple:
        if not args:
            return ArrayType()
        if len(args) == 1 and args[0] == ():
            return ArrayType(min_items=0, max_items=0)
        if len(args) == 2 and args[1] is Ellipsis:
            return ArrayType(
                items=type_definition_from_annotation(
                    args[0],
                    allow_ui_types=allow_ui_types,
                    extracted_types=extracted_types,
                    visited_models=visited_models,
                )
            )
        elem_types = [
            type_definition_from_annotation(
                a,
                allow_ui_types=allow_ui_types,
                extracted_types=extracted_types,
                visited_models=visited_models,
            )
            for a in args
        ]
        unique_elems: list[TypeDefinition] = []
        for et in elem_types:
            if et not in unique_elems:
                unique_elems.append(et)
        item_t: TypeDefinition = (
            unique_elems[0]
            if len(unique_elems) == 1
            else UnionType(variants=tuple(unique_elems), exclusive=False)
        )
        return ArrayType(items=item_t, min_items=len(args), max_items=len(args))

    if origin in (list, Sequence):
        if args:
            return ArrayType(
                items=type_definition_from_annotation(
                    args[0],
                    allow_ui_types=allow_ui_types,
                    extracted_types=extracted_types,
                    visited_models=visited_models,
                )
            )
        return ArrayType()

    if origin in (dict, Mapping):
        if len(args) == 2:
            val_type = type_definition_from_annotation(
                args[1],
                allow_ui_types=allow_ui_types,
                extracted_types=extracted_types,
                visited_models=visited_models,
            )
            if isinstance(val_type, AnyType) and val_type.nullable and val_type.dynamic:
                return ObjectType(additional_properties=True)
            return ObjectType(additional_properties=val_type)
        return ObjectType(additional_properties=True)

    if origin is Union or origin is types.UnionType:
        return _convert_union_annotation(
            args,
            allow_ui_types=allow_ui_types,
            extracted_types=extracted_types,
            visited_models=visited_models,
        )

    return AnyType(dynamic=True, nullable=True)


def _convert_union_annotation(
    args: tuple[Any, ...],
    *,
    allow_ui_types: bool,
    extracted_types: dict[str, DataTypeDefinition] | None,
    visited_models: frozenset[type[BaseModel]],
) -> TypeDefinition:
    non_none = [a for a in args if a is not type(None)]
    if not non_none:
        return ConstType(value=None)
    if len(non_none) == 1:
        return type_definition_from_annotation(
            non_none[0],
            allow_ui_types=allow_ui_types,
            extracted_types=extracted_types,
            visited_models=visited_models,
        )

    unwrapped_members = [_unwrap_annotated_and_aliases(a)[0] for a in non_none]

    if allow_ui_types and all(
        _is_model_named(m, _ACTION_WRAPPER_NAMES) for m in unwrapped_members
    ):
        return ActionType()

    if allow_ui_types and any(
        isinstance(m, type) and issubclass(m, (ListReference, TemplateChildList))
        for m in unwrapped_members
    ):
        return ChildListType()

    has_db = any(_is_model_named(m, "DataBinding") for m in unwrapped_members)
    has_fc = any(_is_model_named(m, "FunctionCall") for m in unwrapped_members)
    if has_db and has_fc:
        literal_branches = [
            raw
            for raw, unwrapped in zip(non_none, unwrapped_members)
            if not _is_model_named(unwrapped, ("DataBinding", "FunctionCall"))
        ]
        if _is_dynamic_value_branches(literal_branches):
            return AnyType(dynamic=True, nullable=False)
        if {_unwrap_annotated_and_aliases(b)[0] for b in literal_branches} == {
            int,
            float,
        }:
            return NumberType(dynamic=True)
        if len(literal_branches) == 1:
            dyn_t = _make_dynamic(
                type_definition_from_annotation(
                    literal_branches[0],
                    allow_ui_types=allow_ui_types,
                    extracted_types=extracted_types,
                    visited_models=visited_models,
                )
            )
            if dyn_t is not None:
                return dyn_t

    if set(unwrapped_members) == {int, float}:
        return NumberType()

    return UnionType(
        variants=tuple(
            type_definition_from_annotation(
                a,
                allow_ui_types=allow_ui_types,
                extracted_types=extracted_types,
                visited_models=visited_models,
            )
            for a in non_none
        ),
        exclusive=True,
    )


def _extract_model_at_least_one_of(
    model_cls: type[BaseModel],
) -> tuple[tuple[str, ...], ...]:
    extra = model_cls.model_config.get("json_schema_extra")
    kw = (
        extra.keywords
        if isinstance(extra, SchemaKeywords)
        else (extra if isinstance(extra, Mapping) else None)
    )
    if kw is not None and "anyOf" in kw:
        grp = _extract_at_least_one_of_branch(kw["anyOf"])
        if grp is not None:
            return (grp,)
    return ()


def _model_additional_properties(model_cls: type[BaseModel]) -> bool:
    extra_mode = model_cls.model_config.get("extra")
    if extra_mode == "allow":
        return True
    if extra_mode == "forbid":
        return False
    schema_extra = model_cls.model_config.get("json_schema_extra")
    if isinstance(schema_extra, SchemaKeywords):
        if (
            schema_extra.keywords.get("unevaluatedProperties") is False
            or schema_extra.keywords.get("additionalProperties") is False
        ):
            return False
    return True


def _object_type_from_model(
    model_cls: type[BaseModel],
    *,
    allow_ui_types: bool,
    extracted_types: dict[str, DataTypeDefinition] | None,
    visited_models: frozenset[type[BaseModel]],
) -> ObjectType:
    if model_cls in visited_models:
        return ObjectType(additional_properties=True)
    next_visited = visited_models | {model_cls}
    params = tuple(
        ParameterDefinition(
            name=field_info.alias or field_name,
            type=type_definition_from_annotation(
                field_info.annotation,
                field_info=field_info,
                allow_ui_types=allow_ui_types,
                extracted_types=extracted_types,
                visited_models=next_visited,
            ),
            required=field_info.is_required(),
        )
        for field_name, field_info in model_cls.model_fields.items()
    )
    return ObjectType(
        properties=params,
        additional_properties=_model_additional_properties(model_cls),
        at_least_one_of=_extract_model_at_least_one_of(model_cls),
        description=_own_docstring(model_cls),
    )


def _is_inherited_envelope_field(
    model_cls: type[BaseModel], field_name: str, field_info: FieldInfo
) -> bool:
    wire_name = field_info.alias or field_name
    if wire_name in ("id", "component") or wire_name in _AT_ENVELOPE_KEYS:
        return True
    for base in model_cls.__mro__[1:]:
        if base.__name__ in _ENVELOPE_BASE_NAMES:
            base_fields = getattr(base, "model_fields", {})
            if (
                field_name in base_fields
                and base_fields[field_name].annotation == field_info.annotation
            ):
                return True
    return False


def _ordered_component_fields(
    model_cls: type[BaseModel],
) -> list[tuple[str, FieldInfo]]:
    """Orders component's own declared fields before inherited catalog-mixin fields."""
    own_annotations = set(getattr(model_cls, "__annotations__", ()))
    own: list[tuple[str, FieldInfo]] = []
    inherited: list[tuple[str, FieldInfo]] = []
    for field_name, field_info in model_cls.model_fields.items():
        if _is_inherited_envelope_field(model_cls, field_name, field_info):
            continue
        (own if field_name in own_annotations else inherited).append(
            (field_name, field_info)
        )
    return [*own, *inherited]


def component_definition_from_model(
    model_cls: type[BaseModel],
    *,
    name: str | None = None,
    allowed_parents: Sequence[str] | None = None,
    allowed_children: Sequence[str] | None = None,
    metadata: Mapping[str, Any] | None = None,
    extracted_types: dict[str, DataTypeDefinition] | None = None,
) -> ComponentDefinition:
    """Extracts a canonical `ComponentDefinition` directly from a Pydantic `BaseModel`."""
    comp_name = name
    if comp_name is None:
        if "component" in model_cls.model_fields:
            default = model_cls.model_fields["component"].default
            if default is not None and default is not PydanticUndefined:
                comp_name = str(default)
        if comp_name is None:
            raw_name = model_cls.__name__
            comp_name = raw_name[:-9] if raw_name.endswith("Component") else raw_name

    is_checkable = any(
        base.__name__ == "Checkable" for base in model_cls.__mro__
    ) or any((fi.alias or fn) == "@checks" for fn, fi in model_cls.model_fields.items())
    params = tuple(
        ParameterDefinition(
            name=field_info.alias or field_name,
            type=type_definition_from_annotation(
                field_info.annotation,
                field_info=field_info,
                allow_ui_types=True,
                extracted_types=extracted_types,
                visited_models=frozenset({model_cls}),
            ),
            required=field_info.is_required(),
        )
        for field_name, field_info in _ordered_component_fields(model_cls)
    )
    return ComponentDefinition(
        name=comp_name,
        description=_own_docstring(model_cls),
        checkable=is_checkable,
        parameters=params,
        at_least_one_of=_extract_model_at_least_one_of(model_cls),
        allowed_parents=(
            tuple(allowed_parents) if allowed_parents is not None else None
        ),
        allowed_children=(
            tuple(allowed_children) if allowed_children is not None else None
        ),
        metadata=clone_metadata(metadata) if metadata is not None else None,
        additional_properties=_model_additional_properties(model_cls),
    )


def function_definition_from_model(
    name: str,
    model_cls: type[BaseModel],
    *,
    return_type: FunctionReturnDefinition = "any",
    allowed_callers: AllowedCallers = "rendererOnly",
    requires_user_activation: bool = False,
    description: str | None = None,
    extracted_types: dict[str, DataTypeDefinition] | None = None,
) -> FunctionDefinition:
    """Extracts a canonical `FunctionDefinition` directly from a Pydantic args `BaseModel`."""
    obj_t = _object_type_from_model(
        model_cls,
        allow_ui_types=False,
        extracted_types=extracted_types,
        visited_models=frozenset(),
    )
    return FunctionDefinition(
        name=name,
        return_type=return_type,
        description=description if description is not None else obj_t.description,
        allowed_callers=allowed_callers,
        requires_user_activation=requires_user_activation,
        parameters=obj_t.properties,
        at_least_one_of=obj_t.at_least_one_of,
        additional_parameters=obj_t.additional_properties,
    )


def surface_properties_from_model(
    model_cls: type[BaseModel],
    *,
    extracted_types: dict[str, DataTypeDefinition] | None = None,
) -> SurfacePropertiesDefinition:
    """Extracts `SurfacePropertiesDefinition` directly from a Pydantic theme `BaseModel`."""
    obj_t = _object_type_from_model(
        model_cls,
        allow_ui_types=False,
        extracted_types=extracted_types,
        visited_models=frozenset(),
    )
    return SurfacePropertiesDefinition(
        description=obj_t.description,
        properties=obj_t.properties,
        additional_properties=obj_t.additional_properties,
    )


__all__ = [
    "component_definition_from_model",
    "function_definition_from_model",
    "surface_properties_from_model",
    "type_definition_from_annotation",
]
