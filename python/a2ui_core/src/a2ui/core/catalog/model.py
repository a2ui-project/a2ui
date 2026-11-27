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

"""Canonical in-memory catalog model for A2UI.

Defines the immutable, schema-library-independent intermediate representation
shared across validation, reactive binding, reference analysis, inference
formats, and document codecs (Catalog Documents, JSON Schema, Pydantic models).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Final, Literal, TypeAlias

from .functions import AllowedCallers, FunctionReturnType

CATALOG_DOCUMENT_FORMAT_VERSION: Final[str] = "1.0"

_ENVELOPE_MIXIN_CANDIDATE_KEYS: Final[frozenset[str]] = frozenset(
    {"metadata", "catalogId", "accessibility", "checks"}
)


class _UnsetType:
    """Sentinel type distinguishing an omitted default from an explicit `None`."""

    __slots__ = ()

    def __repr__(self) -> str:
        return "UNSET"


UNSET: Final[_UnsetType] = _UnsetType()

EnumValue: TypeAlias = str | int | float | bool
EnumValueType: TypeAlias = Literal["string", "number", "boolean"]
ConstValue: TypeAlias = str | int | float | bool | None


@dataclass(frozen=True, slots=True)
class StringType:
    """String value type, optionally dynamic with format/pattern/length bounds."""

    dynamic: bool = False
    format: str | tuple[str, ...] | None = None
    pattern: str | None = None
    min_length: int | None = None
    max_length: int | None = None
    default: str | None = None
    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["string"] = field(default="string", init=False)


@dataclass(frozen=True, slots=True)
class NumberType:
    """Floating-point or numeric value type, optionally dynamic with bounds."""

    dynamic: bool = False
    min: float | None = None
    max: float | None = None
    default: float | None = None
    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["number"] = field(default="number", init=False)


@dataclass(frozen=True, slots=True)
class IntegerType:
    """Integer value type, optionally dynamic with inclusive bounds."""

    dynamic: bool = False
    min: int | None = None
    max: int | None = None
    default: int | None = None
    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["integer"] = field(default="integer", init=False)


@dataclass(frozen=True, slots=True)
class BooleanType:
    """Boolean value type, optionally dynamic (coerces ValidationResult in v1.0)."""

    dynamic: bool = False
    default: bool | None = None
    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["boolean"] = field(default="boolean", init=False)


@dataclass(frozen=True, slots=True)
class EnumType:
    """Closed enumeration of literal values, optionally dynamic."""

    values: tuple[EnumValue, ...]
    value_type: EnumValueType = "string"
    dynamic: bool = False
    default: EnumValue | None = None
    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["enum"] = field(default="enum", init=False)


@dataclass(frozen=True, slots=True)
class ConstType:
    """Exact required literal value (typically a tagged-union discriminator)."""

    value: ConstValue
    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["const"] = field(default="const", init=False)


@dataclass(frozen=True, slots=True)
class AnyType:
    """Unconstrained value type (`dynamic=True, nullable=False` maps to DynamicValue)."""

    dynamic: bool = False
    nullable: bool = False
    default: Any = UNSET
    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["any"] = field(default="any", init=False)


@dataclass(frozen=True, slots=True)
class DataBindingType:
    """Explicit data-model JSON Pointer binding (`@path` in v1.0, `path` pre-1.0)."""

    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["dataBinding"] = field(default="dataBinding", init=False)


@dataclass(frozen=True, slots=True)
class FunctionCallType:
    """Explicit catalog or system function call (`@call` in v1.0, `call` pre-1.0)."""

    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["functionCall"] = field(default="functionCall", init=False)


@dataclass(frozen=True, slots=True)
class RefType:
    """Reference to a catalog-local leaf data type declared in `CatalogModel.types`."""

    ref: str
    default: Any = UNSET
    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["ref"] = field(default="ref", init=False)


@dataclass(frozen=True, slots=True)
class ChildType:
    """Component-only reference to a single child component ID."""

    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["child"] = field(default="child", init=False)


@dataclass(frozen=True, slots=True)
class ChildListType:
    """Component-only static list or data-driven template of child component IDs."""

    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["childList"] = field(default="childList", init=False)


@dataclass(frozen=True, slots=True)
class ActionType:
    """Component-only interaction handler (agent event or function call)."""

    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["action"] = field(default="action", init=False)


@dataclass(frozen=True, slots=True)
class CheckRuleType:
    """Component-only validation check rule (`condition` + `message`)."""

    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["checkRule"] = field(default="checkRule", init=False)


@dataclass(frozen=True, slots=True)
class AccessibilityType:
    """Component-only accessibility attributes container."""

    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["accessibility"] = field(default="accessibility", init=False)


@dataclass(frozen=True, slots=True)
class RawJsonSchemaType:
    """In-memory legacy escape hatch for untranslatable JSON Schema fragments.

    Never emitted by `serialize_catalog_document`. Preserves full backward
    compatibility when loading exotic legacy JSON Schema catalogs.
    """

    schema: Mapping[str, Any]
    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["rawJsonSchema"] = field(default="rawJsonSchema", init=False)


@dataclass(frozen=True, slots=True)
class ObjectType:
    """Structured object or map type with ordered named properties."""

    dynamic: bool = False
    properties: tuple[ParameterDefinition, ...] = ()
    additional_properties: bool | TypeDefinition = False
    at_least_one_of: tuple[tuple[str, ...], ...] = ()
    default: Mapping[str, Any] | None = None
    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["object"] = field(default="object", init=False)

    def get_property(self, name: str) -> ParameterDefinition | None:
        """Returns the declared property named `name`, or None."""
        for prop in self.properties:
            if prop.name == name:
                return prop
        return None


@dataclass(frozen=True, slots=True)
class ArrayType:
    """Array type with optional item type and cardinality constraints."""

    dynamic: bool = False
    items: TypeDefinition | None = None
    min_items: int | None = None
    max_items: int | None = None
    unique_items: bool = False
    default: tuple[Any, ...] | None = None
    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["array"] = field(default="array", init=False)


@dataclass(frozen=True, slots=True)
class UnionType:
    """Union of two or more alternative types (`oneOf` when exclusive, else `anyOf`)."""

    variants: tuple[TypeDefinition, ...]
    exclusive: bool = True
    dynamic: bool = False
    default: Any = UNSET
    description: str | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    type: Literal["union"] = field(default="union", init=False)


DataTypeDefinition: TypeAlias = (
    StringType
    | NumberType
    | IntegerType
    | BooleanType
    | EnumType
    | ConstType
    | AnyType
    | DataBindingType
    | FunctionCallType
    | RefType
    | ObjectType
    | ArrayType
    | UnionType
    | RawJsonSchemaType
)

ComponentOnlyTypeDefinition: TypeAlias = (
    ChildType | ChildListType | ActionType | CheckRuleType | AccessibilityType
)

TypeDefinition: TypeAlias = DataTypeDefinition | ComponentOnlyTypeDefinition


@dataclass(frozen=True, slots=True)
class VoidReturnType:
    """Structured `void` return type carrying an optional description."""

    description: str | None = None
    type: Literal["void"] = field(default="void", init=False)


@dataclass(frozen=True, slots=True)
class ValidationResultReturnType:
    """Structured `validationResult` return type carrying an optional description."""

    description: str | None = None
    type: Literal["validationResult"] = field(default="validationResult", init=False)


FunctionReturnShorthand: TypeAlias = Literal[
    "string",
    "number",
    "integer",
    "boolean",
    "array",
    "object",
    "validationResult",
    "any",
    "void",
]

FunctionReturnDefinition: TypeAlias = (
    FunctionReturnShorthand
    | VoidReturnType
    | ValidationResultReturnType
    | DataTypeDefinition
)


@dataclass(frozen=True, slots=True)
class ParameterDefinition:
    """A named, ordered parameter or object property definition."""

    name: str
    type: TypeDefinition
    required: bool = False

    @property
    def description(self) -> str | None:
        return self.type.description

    @property
    def deprecated(self) -> bool:
        return self.type.deprecated

    @property
    def deprecated_reason(self) -> str | None:
        return self.type.deprecated_reason


@dataclass(frozen=True, slots=True)
class SurfacePropertiesDefinition:
    """Schema for surface-level data properties (maps to v0.9 `theme`)."""

    description: str | None = None
    properties: tuple[ParameterDefinition, ...] = ()
    additional_properties: bool | TypeDefinition = False
    raw_schema: Mapping[str, Any] | None = None

    def get_property(self, name: str) -> ParameterDefinition | None:
        """Returns the declared surface property named `name`, or None."""
        for prop in self.properties:
            if prop.name == name:
                return prop
        return None


@dataclass(frozen=True, slots=True)
class ComponentDefinition:
    """Canonical definition of a UI component's contract and metadata."""

    name: str
    description: str | None = None
    checkable: bool = False
    parameters: tuple[ParameterDefinition, ...] = ()
    at_least_one_of: tuple[tuple[str, ...], ...] = ()
    allowed_parents: tuple[str, ...] | None = None
    allowed_children: tuple[str, ...] | None = None
    metadata: Mapping[str, Any] | None = None
    deprecated: bool = False
    deprecated_reason: str | None = None
    additional_properties: bool | TypeDefinition = False
    raw_schema: Mapping[str, Any] | None = None

    @property
    def custom_envelope_properties(self) -> frozenset[str]:
        """Bare envelope mixin names declared as ordinary component parameters."""
        return frozenset(
            p.name for p in self.parameters if p.name in _ENVELOPE_MIXIN_CANDIDATE_KEYS
        )

    def get_parameter(self, name: str) -> ParameterDefinition | None:
        """Returns the declared parameter named `name`, or None."""
        for param in self.parameters:
            if param.name == name:
                return param
        return None


@dataclass(frozen=True, slots=True)
class FunctionDefinition:
    """Canonical definition of a catalog function's signature and permissions."""

    name: str
    return_type: FunctionReturnDefinition = "any"
    description: str | None = None
    allowed_callers: AllowedCallers = "rendererOnly"
    requires_user_activation: bool = False
    parameters: tuple[ParameterDefinition, ...] = ()
    at_least_one_of: tuple[tuple[str, ...], ...] = ()
    additional_parameters: bool | TypeDefinition = False
    deprecated: bool = False
    deprecated_reason: str | None = None
    raw_args_schema: Mapping[str, Any] | None = None

    def get_parameter(self, name: str) -> ParameterDefinition | None:
        """Returns the declared parameter named `name`, or None."""
        for param in self.parameters:
            if param.name == name:
                return param
        return None


@dataclass(frozen=True, slots=True)
class CatalogModel:
    """Canonical in-memory representation of an A2UI catalog."""

    catalog_id: str
    protocol_version: str = "1.0"
    format_version: str = CATALOG_DOCUMENT_FORMAT_VERSION
    schema_uri: str | None = None
    title: str | None = None
    description: str | None = None
    instructions: str | None = None
    metadata: Mapping[str, Any] | None = None
    types: Mapping[str, DataTypeDefinition] = field(default_factory=dict)
    surface_properties: SurfacePropertiesDefinition | None = None
    components: tuple[ComponentDefinition, ...] = ()
    functions: tuple[FunctionDefinition, ...] = ()

    def get_component(self, name: str) -> ComponentDefinition | None:
        """Returns the component definition named `name`, or None."""
        for comp in self.components:
            if comp.name == name:
                return comp
        return None

    def get_function(self, name: str) -> FunctionDefinition | None:
        """Returns the function definition named `name`, or None."""
        for fn in self.functions:
            if fn.name == name:
                return fn
        return None

    def get_type(self, name: str) -> DataTypeDefinition | None:
        """Returns the catalog-local leaf type named `name`, or None."""
        return self.types.get(name)

    def component_map(self) -> dict[str, ComponentDefinition]:
        """Returns components keyed by name in declaration order."""
        return {c.name: c for c in self.components}

    def function_map(self) -> dict[str, FunctionDefinition]:
        """Returns functions keyed by name in declaration order."""
        return {f.name: f for f in self.functions}


def is_ui_type(type_def: TypeDefinition) -> bool:
    """Returns whether `type_def` is directly a component-only UI type."""
    return isinstance(
        type_def,
        (ChildType, ChildListType, ActionType, CheckRuleType, AccessibilityType),
    )


def contains_ui_type(type_def: TypeDefinition) -> bool:
    """Returns whether `type_def` or any nested child uses a component-only UI type."""
    if is_ui_type(type_def):
        return True
    if isinstance(type_def, ObjectType):
        if any(contains_ui_type(p.type) for p in type_def.properties):
            return True
        if not isinstance(type_def.additional_properties, bool):
            return contains_ui_type(type_def.additional_properties)
        return False
    if isinstance(type_def, ArrayType):
        return type_def.items is not None and contains_ui_type(type_def.items)
    if isinstance(type_def, UnionType):
        return any(contains_ui_type(v) for v in type_def.variants)
    return False


def resolve_type_ref(
    type_def: TypeDefinition,
    types: Mapping[str, DataTypeDefinition] | None,
) -> TypeDefinition:
    """Follows `RefType` chains in `types` until reaching a concrete type."""
    if not types:
        return type_def
    visited: set[str] = set()
    current: TypeDefinition = type_def
    while isinstance(current, RefType):
        if current.ref in visited or current.ref not in types:
            return current
        visited.add(current.ref)
        current = types[current.ref]
    return current


def _type_has_raw_json_schema(
    type_def: TypeDefinition,
    types: Mapping[str, DataTypeDefinition] | None,
    visited: set[str],
) -> bool:
    if isinstance(type_def, RawJsonSchemaType):
        return True
    if isinstance(type_def, RefType):
        if types and type_def.ref in types and type_def.ref not in visited:
            visited.add(type_def.ref)
            return _type_has_raw_json_schema(types[type_def.ref], types, visited)
        return False
    if isinstance(type_def, ObjectType):
        if any(
            _type_has_raw_json_schema(p.type, types, visited)
            for p in type_def.properties
        ):
            return True
        if not isinstance(type_def.additional_properties, bool):
            return _type_has_raw_json_schema(
                type_def.additional_properties, types, visited
            )
        return False
    if isinstance(type_def, ArrayType):
        return type_def.items is not None and _type_has_raw_json_schema(
            type_def.items, types, visited
        )
    if isinstance(type_def, UnionType):
        return any(
            _type_has_raw_json_schema(v, types, visited) for v in type_def.variants
        )
    return False


def has_raw_json_schema(
    node: (
        CatalogModel
        | ComponentDefinition
        | FunctionDefinition
        | SurfacePropertiesDefinition
        | TypeDefinition
    ),
    types: Mapping[str, DataTypeDefinition] | None = None,
) -> bool:
    """Returns whether `node` contains any legacy raw JSON Schema fallback."""
    visited: set[str] = set()
    if isinstance(node, CatalogModel):
        t_map = node.types
        if any(_type_has_raw_json_schema(t, t_map, visited) for t in t_map.values()):
            return True
        if node.surface_properties is not None and has_raw_json_schema(
            node.surface_properties, t_map
        ):
            return True
        return any(has_raw_json_schema(c, t_map) for c in node.components) or any(
            has_raw_json_schema(f, t_map) for f in node.functions
        )
    if isinstance(node, ComponentDefinition):
        if node.raw_schema is not None:
            return True
        if any(
            _type_has_raw_json_schema(p.type, types, visited) for p in node.parameters
        ):
            return True
        if not isinstance(node.additional_properties, bool):
            return _type_has_raw_json_schema(node.additional_properties, types, visited)
        return False
    if isinstance(node, FunctionDefinition):
        if node.raw_args_schema is not None:
            return True
        if any(
            _type_has_raw_json_schema(p.type, types, visited) for p in node.parameters
        ):
            return True
        if not isinstance(node.additional_parameters, bool):
            return _type_has_raw_json_schema(node.additional_parameters, types, visited)
        return False
    if isinstance(node, SurfacePropertiesDefinition):
        if node.raw_schema is not None:
            return True
        if any(
            _type_has_raw_json_schema(p.type, types, visited) for p in node.properties
        ):
            return True
        if not isinstance(node.additional_properties, bool):
            return _type_has_raw_json_schema(node.additional_properties, types, visited)
        return False
    return _type_has_raw_json_schema(node, types, visited)


def function_return_category(
    return_type: FunctionReturnDefinition,
    types: Mapping[str, DataTypeDefinition] | None = None,
) -> FunctionReturnType:
    """Maps a `FunctionReturnDefinition` to its v1.0 wire return-type category."""
    if isinstance(return_type, str):
        if return_type == "integer":
            return "number"
        return return_type
    if isinstance(return_type, VoidReturnType):
        return "void"
    if isinstance(return_type, ValidationResultReturnType):
        return "validationResult"
    resolved = resolve_type_ref(return_type, types)
    if isinstance(resolved, StringType):
        return "string"
    if isinstance(resolved, (NumberType, IntegerType)):
        return "number"
    if isinstance(resolved, BooleanType):
        return "boolean"
    if isinstance(resolved, EnumType):
        return resolved.value_type
    if isinstance(resolved, ConstType):
        if isinstance(resolved.value, bool):
            return "boolean"
        if isinstance(resolved.value, (int, float)):
            return "number"
        if isinstance(resolved.value, str):
            return "string"
        return "any"
    if isinstance(resolved, ArrayType):
        return "array"
    if isinstance(resolved, ObjectType):
        return "object"
    return "any"


__all__ = [
    "AccessibilityType",
    "ActionType",
    "AnyType",
    "ArrayType",
    "BooleanType",
    "CATALOG_DOCUMENT_FORMAT_VERSION",
    "CatalogModel",
    "CheckRuleType",
    "ChildListType",
    "ChildType",
    "ComponentDefinition",
    "ComponentOnlyTypeDefinition",
    "ConstType",
    "ConstValue",
    "DataBindingType",
    "DataTypeDefinition",
    "EnumType",
    "EnumValue",
    "EnumValueType",
    "FunctionCallType",
    "FunctionDefinition",
    "FunctionReturnDefinition",
    "FunctionReturnShorthand",
    "IntegerType",
    "NumberType",
    "ObjectType",
    "ParameterDefinition",
    "RawJsonSchemaType",
    "RefType",
    "StringType",
    "SurfacePropertiesDefinition",
    "TypeDefinition",
    "UNSET",
    "UnionType",
    "ValidationResultReturnType",
    "VoidReturnType",
    "contains_ui_type",
    "function_return_category",
    "has_raw_json_schema",
    "is_ui_type",
    "resolve_type_ref",
]
