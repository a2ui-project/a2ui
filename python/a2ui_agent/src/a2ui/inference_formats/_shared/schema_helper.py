# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Catalog schema inspector shared by the compact inference formats.

Reads component and function signatures directly from the canonical
`CatalogModel` without serializing catalogs to JSON Schema on the canonical
path, handling legacy `RawJsonSchemaType` properties locally per field.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping
from dataclasses import replace
import re
from typing import Any, Literal

from a2ui.core import (
    A2uiCatalogError,
    AccessibilityType,
    ActionType,
    AnyType,
    ArrayType,
    BooleanType,
    Catalog,
    CatalogApi,
    CatalogModel,
    CheckRuleType,
    ChildListType,
    ChildType,
    ComponentDefinition,
    ConstType,
    DataBindingType,
    EnumType,
    FunctionCallType,
    FunctionDefinition,
    IntegerType,
    NumberType,
    ObjectType,
    ParameterDefinition,
    RefType,
    StringType,
    TypeDefinition,
    UnionType,
    get_common_types_schema_map,
    inline_local_refs,
    to_protocol_version,
)
from a2ui.core.catalog import (
    DataTypeDefinition,
    RawJsonSchemaType,
    component_definition_from_json_schema,
    component_definition_to_json_schema,
    function_definition_from_json_schema,
    function_definition_to_json_schema,
    resolve_type_ref_with_visited,
    type_definition_from_json_schema,
    type_definition_to_json_schema,
)
from a2ui.core.common import is_at_least_version
from a2ui.core.schema import ProtocolVersion

_COMMON_DEF_RE = re.compile(r"(?:^|/)common_types\.json#/(?:\$defs|definitions)/(\w+)$")
_LOCAL_DEF_RE = re.compile(r"^#/(?:\$defs|definitions)/(\w+)$")

_NON_STRUCTURED_TYPES = (
    DataBindingType,
    FunctionCallType,
    ActionType,
    ChildType,
    ChildListType,
    CheckRuleType,
    AccessibilityType,
)


def _load_common_def_names() -> frozenset[str]:
    names: set[str] = {"ComponentCommon", "ComponentCommonMetadata", "Checkable"}
    for ver in (ProtocolVersion.V0_9, ProtocolVersion.V1_0):
        schema_map = get_common_types_schema_map(ver)
        defs = schema_map.get("$defs") or schema_map.get("definitions")
        if isinstance(defs, dict):
            names.update(str(k) for k in defs.keys())
    return frozenset(names)


_PRESERVED_COMMON_DEF_NAMES: frozenset[str] = _load_common_def_names()


def common_def_name(ref: Any) -> str | None:
    """Returns the common type a `$ref` names, or None if it is not one."""
    if not isinstance(ref, str):
        return None
    m = _COMMON_DEF_RE.search(ref)
    if m:
        return m.group(1)
    local_m = _LOCAL_DEF_RE.match(ref)
    if local_m and local_m.group(1) in _PRESERVED_COMMON_DEF_NAMES:
        return local_m.group(1)
    return None


def is_common_def_ref(ref: Any) -> bool:
    """Returns whether `ref` points to a protocol common type definition."""
    return common_def_name(ref) is not None


def combinator_subschemas(
    s: dict[str, Any],
    keys: tuple[str, ...] = ("oneOf", "anyOf", "allOf"),
) -> list[Any]:
    """Returns all sub-schemas under the given combinator keys."""
    result: list[Any] = []
    for k in keys:
        subs = s.get(k)
        if isinstance(subs, list):
            result.extend(subs)
    return result


def _is_object_or_ref_schema(sub: Any) -> bool:
    return isinstance(sub, dict) and (
        "$ref" in sub
        or sub.get("type") == "object"
        or isinstance(sub.get("properties"), dict)
        or any(k in sub for k in ("allOf", "oneOf", "anyOf"))
    )


def _is_flattened_action(schema: dict[str, Any]) -> bool:
    if schema.get("type") not in (None, "object"):
        return False
    props = schema.get("properties")
    reqs = schema.get("required")
    if not isinstance(props, dict) or not isinstance(reqs, list):
        return False
    keys = set(props)
    if keys not in ({"event"}, {"functionCall"}):
        return False
    key = next(iter(keys))
    return key in reqs and _is_object_or_ref_schema(props[key])


def is_action_slot(schema: Any, visited: set[int] | None = None) -> bool:
    """Checks whether a property JSON schema is an Action slot."""
    if not isinstance(schema, dict):
        return False
    visited = visited if visited is not None else set()
    obj_id = id(schema)
    if obj_id in visited:
        return False
    visited.add(obj_id)
    if common_def_name(schema.get("$ref")) == "Action" or _is_flattened_action(schema):
        return True
    return any(
        is_action_slot(sub, visited)
        for sub in combinator_subschemas(schema, ("allOf", "oneOf", "anyOf"))
    )


def _find_enum(s: Any, visited: set[int] | None = None) -> list[Any] | None:
    if not isinstance(s, dict):
        return None
    visited = visited if visited is not None else set()
    obj_id = id(s)
    if obj_id in visited:
        return None
    visited.add(obj_id)
    enum = s.get("enum")
    if isinstance(enum, list):
        return enum
    for sub_s in combinator_subschemas(s):
        res = _find_enum(sub_s, visited)
        if res:
            return res
    return None


def system_function_schemas(common_types: Any) -> dict[str, dict[str, Any]]:
    """Returns the system functions that a common types schema defines."""
    if not isinstance(common_types, dict):
        return {}
    defs = common_types.get("$defs") or common_types.get("definitions")
    if not isinstance(defs, dict):
        return {}
    found: dict[str, dict[str, Any]] = {}
    for schema in defs.values():
        if not isinstance(schema, dict):
            continue
        props = schema.get("properties")
        call = props.get("@call") if isinstance(props, dict) else None
        name = call.get("const") if isinstance(call, dict) else None
        if isinstance(name, str) and name.startswith("@"):
            found[name] = schema
    return found


def _ordered_component_sub_schemas(
    comp_schema: dict[str, Any],
) -> list[dict[str, Any]]:
    """Returns deduplicated component sub-schemas in `allOf`-first declaration order."""
    ordered: list[dict[str, Any]] = []
    seen: set[int] = set()

    def _collect(s: Any) -> None:
        if not isinstance(s, dict):
            return
        obj_id = id(s)
        if obj_id in seen:
            return
        seen.add(obj_id)
        for sub in combinator_subschemas(s, ("allOf",)):
            _collect(sub)
        ordered.append(s)

    _collect(comp_schema)
    return ordered


def _semantic_ref_type(ref: Any) -> str | None:
    if not isinstance(ref, str):
        return None
    if "ChildList" in ref:
        return "ChildList"
    if "Child" in ref or "ComponentId" in ref:
        return "Child"
    if "Action" in ref:
        return "Action"
    return None


def _crawl_raw_semantic_kind(s: Any, visited: set[int] | None = None) -> str | None:
    if not isinstance(s, dict):
        return None
    visited = visited if visited is not None else set()
    if id(s) in visited:
        return None
    visited.add(id(s))
    direct = _semantic_ref_type(s.get("$ref"))
    if direct is not None:
        return direct
    if _is_flattened_action(s):
        return "Action"
    for sub_s in combinator_subschemas(s):
        res = _crawl_raw_semantic_kind(sub_s, visited)
        if res is not None:
            return res
    return None


def _raw_schema_allows_databinding(
    s: Any, path_key: str, visited: set[int] | None = None
) -> bool:
    if not isinstance(s, dict):
        return False
    visited = visited if visited is not None else set()
    if id(s) in visited:
        return False
    visited.add(id(s))
    ref = s.get("$ref")
    if isinstance(ref, str) and (
        "DataBinding" in ref or "Dynamic" in ref or "ChildList" in ref
    ):
        return True
    props = s.get("properties")
    reqs = s.get("required")
    if (
        s.get("type") in (None, "object")
        and isinstance(props, dict)
        and isinstance(reqs, list)
        and (
            (set(props) == {path_key} and path_key in reqs)
            or (
                set(props) == {"componentId", "path"}
                and {"componentId", "path"} <= set(reqs)
            )
        )
    ):
        return True
    return any(
        _raw_schema_allows_databinding(sub, path_key, visited)
        for sub in combinator_subschemas(s)
    )


class _LazySchemaMap(Mapping[str, dict[str, Any]]):
    """Mapping proxy whose membership and iteration never synthesize JSON Schema."""

    def __init__(
        self,
        keys: Mapping[str, Any],
        loader: Callable[[str], dict[str, Any]],
    ) -> None:
        self._keys = keys
        self._loader = loader
        self._cache: dict[str, dict[str, Any]] = {}

    def __getitem__(self, key: str) -> dict[str, Any]:
        if key not in self._keys:
            raise KeyError(key)
        cached = self._cache.get(key)
        if cached is None:
            cached = self._loader(key)
            self._cache[key] = cached
        return cached

    def __iter__(self) -> Iterator[str]:
        return iter(self._keys)

    def __len__(self) -> int:
        return len(self._keys)

    def __contains__(self, key: object) -> bool:
        return key in self._keys


class CatalogSchemaHelper:
    """Catalog inspector shared by the compact inference formats.

    Backs every component and function on `CatalogModel` (`ComponentDefinition`
    and `FunctionDefinition`) so canonical catalogs never serialize through
    `catalog.to_json()` or `inline_local_refs()`. Legacy `RawJsonSchemaType`
    properties are handled per-property inside `type_*` methods.
    """

    def __init__(
        self,
        catalog: CatalogApi,
        protocol_version: str | ProtocolVersion | None = None,
    ):
        if not isinstance(catalog, Catalog):
            raise TypeError(f"Unsupported catalog type: {type(catalog)}")
        self.catalog_model = catalog
        self.model: CatalogModel = catalog.model
        self.types: Mapping[str, DataTypeDefinition] = self.model.types
        self._catalog_json_cache: dict[str, Any] | None = None
        self._components_override: Mapping[str, dict[str, Any]] | None = None
        self._functions_override: Mapping[str, dict[str, Any]] | None = None

        try:
            pv = to_protocol_version(protocol_version or catalog.protocol_version)
            self.common_types: dict[str, Any] = get_common_types_schema_map(pv)
            self.common_types_loaded: bool = True
            self.protocol_version: ProtocolVersion | None = pv
            self.at_least_v10: bool = is_at_least_version(pv, ProtocolVersion.V1_0)
        except (A2uiCatalogError, ValueError):
            self.common_types = {}
            self.common_types_loaded = False
            self.protocol_version = None
            self.at_least_v10 = True
        self.path_key: str = "@path" if self.at_least_v10 else "path"
        self.call_key: str = "@call" if self.at_least_v10 else "call"

        self._component_defs: dict[str, ComponentDefinition] = {}
        for comp_def in self.model.components:
            if comp_def.raw_schema is not None:
                # Re-parse the inlined schema so cross-component `$ref` mixins
                # (e.g. `#/components/Base`) are resolved into `parameters`.
                raw_comps = self.catalog.get("components", {})
                inlined = (
                    raw_comps.get(comp_def.name)
                    if isinstance(raw_comps, Mapping)
                    else None
                )
                if isinstance(inlined, Mapping):
                    comp_def = component_definition_from_json_schema(
                        comp_def.name,
                        inlined,
                        local_defs=(
                            self.catalog.get("$defs")
                            if isinstance(self.catalog.get("$defs"), Mapping)
                            else None
                        ),
                        leaf_type_names=frozenset(self.types),
                        allowed_parents=comp_def.allowed_parents,
                        allowed_children=comp_def.allowed_children,
                        metadata=comp_def.metadata,
                        at_least_v10=self.at_least_v10,
                    )
            self._component_defs[comp_def.name] = comp_def

        self._function_defs: dict[str, FunctionDefinition] = {}
        for fn_def in self.model.functions:
            if fn_def.raw_args_schema is not None:
                raw_fns = self.catalog.get("functions", {})
                inlined_fn = (
                    raw_fns.get(fn_def.name) if isinstance(raw_fns, Mapping) else None
                )
                if isinstance(inlined_fn, Mapping):
                    fn_def = function_definition_from_json_schema(
                        fn_def.name,
                        inlined_fn,
                        return_type=fn_def.return_type,
                        allowed_callers=fn_def.allowed_callers,
                        requires_user_activation=fn_def.requires_user_activation,
                        description=fn_def.description,
                        local_defs=(
                            self.catalog.get("$defs")
                            if isinstance(self.catalog.get("$defs"), Mapping)
                            else None
                        ),
                        leaf_type_names=frozenset(self.types),
                        at_least_v10=self.at_least_v10,
                    )
            self._function_defs[fn_def.name] = fn_def

        self.system_functions = system_function_schemas(self.common_types)
        self._system_function_defs: dict[str, FunctionDefinition] = {
            name: function_definition_from_json_schema(
                name, schema, at_least_v10=self.at_least_v10
            )
            for name, schema in self.system_functions.items()
        }
        self._components_proxy: _LazySchemaMap = _LazySchemaMap(
            self._component_defs, self._load_component_schema
        )
        self._functions_proxy: _LazySchemaMap = _LazySchemaMap(
            self._function_defs, self._load_function_schema
        )
        self.component_properties: dict[str, list[str]] = {}
        self.component_required: dict[str, list[str]] = {}
        self.component_is_checkable: dict[str, bool] = {}
        self.component_custom_envelope: dict[str, frozenset[str]] = {}
        self.component_property_enums: dict[tuple[str, str], list[Any]] = {}
        self.function_properties: dict[str, list[str]] = {}
        self.function_required: dict[str, list[str]] = {}
        self._load_mappings()

    @property
    def instructions(self) -> str:
        """Returns catalog-level Markdown instructions, or empty string."""
        if self._catalog_json_cache is not None:
            val = self._catalog_json_cache.get("instructions")
            return val if isinstance(val, str) else ""
        return self.model.instructions or ""

    @property
    def catalog(self) -> dict[str, Any]:
        """Lazily returns the inlined JSON Schema catalog document."""
        if self._catalog_json_cache is None:
            catalog_schema = dict(self.catalog_model.to_json() or {})
            self._catalog_json_cache = inline_local_refs(catalog_schema, catalog_schema)
        return self._catalog_json_cache

    @catalog.setter
    def catalog(self, value: dict[str, Any]) -> None:
        self._catalog_json_cache = value

    @property
    def components(self) -> Mapping[str, dict[str, Any]]:
        """Mapping from component names to their catalog JSON schemas."""
        if self._components_override is not None:
            return self._components_override
        return self._components_proxy

    @components.setter
    def components(self, value: Mapping[str, dict[str, Any]]) -> None:
        self._components_override = value

    @property
    def functions(self) -> Mapping[str, dict[str, Any]]:
        """Mapping from function names to their catalog JSON schemas."""
        if self._functions_override is not None:
            return self._functions_override
        return self._functions_proxy

    @functions.setter
    def functions(self, value: Mapping[str, dict[str, Any]]) -> None:
        self._functions_override = value

    def _load_component_schema(self, name: str) -> dict[str, Any]:
        if not self.catalog_model._from_catalog_document:
            raw_comps = self.catalog.get("components", {})
            if isinstance(raw_comps, Mapping):
                raw_comp = raw_comps.get(name)
                if isinstance(raw_comp, dict):
                    return raw_comp
        comp_def = self._component_defs[name]
        if comp_def.raw_schema is None:
            return component_definition_to_json_schema(
                comp_def, at_least_v10=self.at_least_v10
            )
        return dict(comp_def.raw_schema)

    def _load_function_schema(self, name: str) -> dict[str, Any]:
        if not self.catalog_model._from_catalog_document:
            raw_fns = self.catalog.get("functions", {})
            if isinstance(raw_fns, Mapping):
                raw_fn = raw_fns.get(name)
                if isinstance(raw_fn, dict):
                    return raw_fn
        fn_def = self._function_defs[name]
        if fn_def.raw_args_schema is None:
            return function_definition_to_json_schema(
                fn_def, at_least_v10=self.at_least_v10, types=self.types
            )
        return {}

    def property_is_legacy_component_id(
        self, component_name: str, property_name: str
    ) -> bool:
        """Returns whether a `ChildType` property originates from a legacy `ComponentId` ref."""
        if not self.at_least_v10:
            return True
        if self.catalog_model._from_catalog_document:
            return False
        comp_api = self.catalog_model.components.get(component_name)
        raw_schema = comp_api.schema if comp_api is not None else None
        if not isinstance(raw_schema, Mapping):
            return False
        prop_schema: Any = None
        for sub in _ordered_component_sub_schemas(dict(raw_schema)):
            props = sub.get("properties")
            if isinstance(props, Mapping) and property_name in props:
                prop_schema = props[property_name]
        if not isinstance(prop_schema, Mapping):
            return False
        defs = self.catalog_model.defs
        visited: set[str] = set()
        current: Any = prop_schema
        while isinstance(current, Mapping):
            ref = current.get("$ref")
            if not isinstance(ref, str):
                return False
            if "ComponentId" in ref:
                return True
            local_m = _LOCAL_DEF_RE.match(ref)
            if (
                local_m
                and isinstance(defs, Mapping)
                and local_m.group(1) not in visited
            ):
                visited.add(local_m.group(1))
                current = defs.get(local_m.group(1))
                continue
            return False
        return False

    def _load_mappings(self) -> None:
        """Populates component and function lookup tables directly from `CatalogModel`."""
        self.component_properties = {}
        self.component_required = {}
        self.component_is_checkable = {}
        self.component_custom_envelope = {}
        self.component_property_enums = {}

        for name, comp_def in self._component_defs.items():
            custom_envelope = comp_def.custom_envelope_properties
            is_checkable = comp_def.checkable
            ordered_keys = [p.name for p in comp_def.parameters]
            reqs = ["component", *(p.name for p in comp_def.parameters if p.required)]

            for param in comp_def.parameters:
                enum_val = self.type_enum_values(param.type)
                if enum_val:
                    self.component_property_enums[(name, param.name)] = enum_val

            if is_checkable and "checks" not in custom_envelope:
                ordered_keys.append("checks")

            self.component_properties[name] = ordered_keys
            self.component_required[name] = reqs
            self.component_is_checkable[name] = is_checkable
            self.component_custom_envelope[name] = custom_envelope

        self.function_properties = {
            name: [p.name for p in fn_def.parameters]
            for name, fn_def in self._function_defs.items()
        }
        self.function_required = {
            name: [p.name for p in fn_def.parameters if p.required]
            for name, fn_def in self._function_defs.items()
        }
        self._system_function_properties: dict[str, list[str]] = {
            name: [p.name for p in fn_def.parameters]
            for name, fn_def in self._system_function_defs.items()
        }
        self._system_function_required: dict[str, list[str]] = {
            name: [p.name for p in fn_def.parameters if p.required]
            for name, fn_def in self._system_function_defs.items()
        }

    def resolve_type_with_visited(
        self,
        type_def: TypeDefinition,
        visited_refs: frozenset[str] = frozenset(),
    ) -> tuple[TypeDefinition, frozenset[str], bool]:
        """Follows local `RefType` chains with cycle tracking, preserving outer description."""
        outer_desc = type_def.description if isinstance(type_def, RefType) else None
        resolved, next_visited, hit_cycle = resolve_type_ref_with_visited(
            type_def, self.types, visited_refs
        )
        if not hit_cycle and outer_desc is not None and resolved.description is None:
            resolved = replace(resolved, description=outer_desc)
        return resolved, next_visited, hit_cycle

    def resolve_type(self, type_def: TypeDefinition) -> TypeDefinition:
        """Resolves any local `RefType` chain against `self.types`, preserving description."""
        resolved, _, _ = self.resolve_type_with_visited(type_def)
        return resolved

    def _inline_type_refs(
        self, type_def: TypeDefinition, visited: frozenset[str] = frozenset()
    ) -> TypeDefinition:
        if isinstance(type_def, RefType):
            if type_def.ref in visited or type_def.ref not in self.types:
                return type_def
            target = self._inline_type_refs(
                self.types[type_def.ref], visited | {type_def.ref}
            )
            if type_def.description is not None and target.description is None:
                return replace(target, description=type_def.description)
            return target
        if isinstance(type_def, ArrayType) and type_def.items is not None:
            return replace(
                type_def, items=self._inline_type_refs(type_def.items, visited)
            )
        if isinstance(type_def, ObjectType):
            new_props = tuple(
                replace(p, type=self._inline_type_refs(p.type, visited))
                for p in type_def.properties
            )
            new_ap = (
                self._inline_type_refs(type_def.additional_properties, visited)
                if not isinstance(type_def.additional_properties, bool)
                else type_def.additional_properties
            )
            return replace(type_def, properties=new_props, additional_properties=new_ap)
        if isinstance(type_def, UnionType):
            return replace(
                type_def,
                variants=tuple(
                    self._inline_type_refs(v, visited) for v in type_def.variants
                ),
            )
        return type_def

    def get_component_definition(self, name: str) -> ComponentDefinition | None:
        """Returns the `ComponentDefinition` for `name`."""
        return self._component_defs.get(name)

    def get_function_definition(self, name: str) -> FunctionDefinition | None:
        """Returns the `FunctionDefinition` for a catalog or system function."""
        return self._function_defs.get(name) or self._system_function_defs.get(name)

    def get_parameter_definition(
        self, component_name: str, property_name: str
    ) -> ParameterDefinition | None:
        """Returns the `ParameterDefinition` for a component property."""
        comp_def = self.get_component_definition(component_name)
        return comp_def.get_parameter(property_name) if comp_def is not None else None

    def get_parameter_type(
        self, component_name: str, property_name: str
    ) -> TypeDefinition | None:
        """Returns the `TypeDefinition` for a component property (including `checks`)."""
        comp_def = self.get_component_definition(component_name)
        if comp_def is None:
            return None
        param = comp_def.get_parameter(property_name)
        if param is not None:
            return param.type
        if (
            property_name == "checks"
            and comp_def.checkable
            and "checks" not in comp_def.custom_envelope_properties
        ):
            return ArrayType(items=CheckRuleType())
        return None

    def get_function_parameter_definition(
        self, fn_name: str, prop_name: str
    ) -> ParameterDefinition | None:
        """Returns the `ParameterDefinition` for a function argument."""
        fn_def = self.get_function_definition(fn_name)
        return fn_def.get_parameter(prop_name) if fn_def is not None else None

    def get_function_parameter_type(
        self, fn_name: str, prop_name: str
    ) -> TypeDefinition | None:
        """Returns the `TypeDefinition` for a function argument."""
        param = self.get_function_parameter_definition(fn_name, prop_name)
        return param.type if param is not None else None

    def type_semantic_kind(
        self,
        type_def: TypeDefinition | None,
        visited_refs: frozenset[str] = frozenset(),
    ) -> str | None:
        """Returns 'ChildList', 'Child', or 'Action' for a `TypeDefinition`, or None."""
        if type_def is None:
            return None
        resolved, next_visited, hit_cycle = self.resolve_type_with_visited(
            type_def, visited_refs
        )
        if hit_cycle:
            return None
        if isinstance(resolved, ChildListType):
            return "ChildList"
        if isinstance(resolved, ChildType):
            return "Child"
        if isinstance(resolved, ActionType):
            return "Action"
        if isinstance(resolved, RawJsonSchemaType):
            return _crawl_raw_semantic_kind(dict(resolved.schema))
        if isinstance(resolved, UnionType):
            for variant in resolved.variants:
                kind = self.type_semantic_kind(variant, next_visited)
                if kind is not None:
                    return kind
        return None

    def type_allows_databinding(
        self,
        type_def: TypeDefinition | None,
        visited_refs: frozenset[str] = frozenset(),
    ) -> bool:
        """Returns whether a `TypeDefinition` accepts a data-binding expression."""
        if type_def is None:
            return False
        resolved, next_visited, hit_cycle = self.resolve_type_with_visited(
            type_def, visited_refs
        )
        if hit_cycle:
            return False
        if isinstance(resolved, (DataBindingType, ChildListType)):
            return True
        if isinstance(
            resolved,
            (
                StringType,
                NumberType,
                IntegerType,
                BooleanType,
                EnumType,
                AnyType,
                ArrayType,
                ObjectType,
            ),
        ):
            return bool(resolved.dynamic)
        if isinstance(resolved, UnionType):
            if resolved.dynamic:
                return True
            return any(
                self.type_allows_databinding(v, next_visited) for v in resolved.variants
            )
        if isinstance(resolved, RawJsonSchemaType):
            return _raw_schema_allows_databinding(dict(resolved.schema), self.path_key)
        return False

    def type_is_action(
        self,
        type_def: TypeDefinition | None,
        visited_refs: frozenset[str] = frozenset(),
    ) -> bool:
        """Returns whether a `TypeDefinition` represents an Action slot."""
        if type_def is None:
            return False
        resolved, next_visited, hit_cycle = self.resolve_type_with_visited(
            type_def, visited_refs
        )
        if hit_cycle:
            return False
        if isinstance(resolved, ActionType):
            return True
        if isinstance(resolved, RawJsonSchemaType):
            return is_action_slot(dict(resolved.schema))
        if isinstance(resolved, UnionType):
            return any(self.type_is_action(v, next_visited) for v in resolved.variants)
        return False

    def type_accepts_number(
        self,
        type_def: TypeDefinition | None,
        visited_refs: frozenset[str] = frozenset(),
    ) -> bool:
        """Returns whether a `TypeDefinition` accepts a numeric literal."""
        if type_def is None:
            return False
        resolved, next_visited, hit_cycle = self.resolve_type_with_visited(
            type_def, visited_refs
        )
        if hit_cycle:
            return False
        if isinstance(resolved, (NumberType, IntegerType, AnyType)):
            return True
        if isinstance(resolved, ConstType):
            return isinstance(resolved.value, (int, float)) and not isinstance(
                resolved.value, bool
            )
        if isinstance(resolved, EnumType):
            return any(
                isinstance(v, (int, float)) and not isinstance(v, bool)
                for v in resolved.values
            )
        if isinstance(resolved, UnionType):
            return any(
                self.type_accepts_number(v, next_visited) for v in resolved.variants
            )
        if isinstance(resolved, RawJsonSchemaType):
            return self.accepts_number(dict(resolved.schema))
        return False

    def type_enum_values(
        self,
        type_def: TypeDefinition | None,
        visited_refs: frozenset[str] = frozenset(),
    ) -> list[Any] | None:
        """Returns the first enum value list declared in `type_def`, or None."""
        if type_def is None:
            return None
        resolved, next_visited, hit_cycle = self.resolve_type_with_visited(
            type_def, visited_refs
        )
        if hit_cycle:
            return None
        if isinstance(resolved, EnumType):
            return list(resolved.values)
        if isinstance(resolved, RawJsonSchemaType):
            return _find_enum(dict(resolved.schema))
        if isinstance(resolved, UnionType):
            for variant in resolved.variants:
                vals = self.type_enum_values(variant, next_visited)
                if vals:
                    return vals
        return None

    def type_expects_option_objects(
        self,
        type_def: TypeDefinition | None,
        visited_refs: frozenset[str] = frozenset(),
    ) -> bool:
        """Returns whether `type_def` is an array of objects with `label` and `value`."""
        if type_def is None:
            return False
        resolved, next_visited, hit_cycle = self.resolve_type_with_visited(
            type_def, visited_refs
        )
        if hit_cycle:
            return False
        if isinstance(resolved, ArrayType) and resolved.items is not None:
            return self._type_has_label_value(resolved.items, next_visited)
        if isinstance(resolved, UnionType):
            return any(
                self.type_expects_option_objects(v, next_visited)
                for v in resolved.variants
            )
        if isinstance(resolved, RawJsonSchemaType):
            items = self.resolve_item_schema(dict(resolved.schema))
            if isinstance(items, dict):
                props = items.get("properties")
                return isinstance(props, dict) and "label" in props and "value" in props
        return False

    def _type_has_label_value(
        self,
        type_def: TypeDefinition,
        visited_refs: frozenset[str] = frozenset(),
    ) -> bool:
        resolved, next_visited, hit_cycle = self.resolve_type_with_visited(
            type_def, visited_refs
        )
        if hit_cycle:
            return False
        if isinstance(resolved, ObjectType):
            names = {p.name for p in resolved.properties}
            return "label" in names and "value" in names
        if isinstance(resolved, UnionType):
            return any(
                self._type_has_label_value(v, next_visited) for v in resolved.variants
            )
        if isinstance(resolved, RawJsonSchemaType):
            props = resolved.schema.get("properties")
            return isinstance(props, Mapping) and "label" in props and "value" in props
        return False

    def type_accepts_components(
        self,
        type_def: TypeDefinition | None,
        visited_refs: frozenset[str] = frozenset(),
    ) -> bool:
        """Returns whether `type_def` accepts component ID references (or lists of them)."""
        if type_def is None:
            return False
        resolved, next_visited, hit_cycle = self.resolve_type_with_visited(
            type_def, visited_refs
        )
        if hit_cycle:
            return False
        if isinstance(resolved, (ChildType, ChildListType)):
            return True
        if isinstance(resolved, ArrayType) and resolved.items is not None:
            return self.type_accepts_components(resolved.items, next_visited)
        if isinstance(resolved, UnionType):
            return any(
                self.type_accepts_components(v, next_visited) for v in resolved.variants
            )
        if isinstance(resolved, RawJsonSchemaType):
            return _crawl_raw_semantic_kind(dict(resolved.schema)) in (
                "Child",
                "ChildList",
            )
        return False

    def type_primitive_kind(
        self,
        type_def: TypeDefinition | None,
        visited_refs: frozenset[str] = frozenset(),
    ) -> str | None:
        """Returns the primitive JSON kind for `type_def`, or None."""
        if type_def is None:
            return None
        resolved, next_visited, hit_cycle = self.resolve_type_with_visited(
            type_def, visited_refs
        )
        if hit_cycle:
            return None
        if isinstance(resolved, BooleanType):
            return "boolean"
        if isinstance(resolved, IntegerType):
            return "integer"
        if isinstance(resolved, NumberType):
            return "number"
        if isinstance(resolved, StringType):
            return "string"
        if isinstance(resolved, EnumType):
            return resolved.value_type
        if isinstance(resolved, ArrayType):
            return "array"
        if isinstance(resolved, ObjectType):
            return "object"
        if isinstance(resolved, UnionType):
            for variant in resolved.variants:
                kind = self.type_primitive_kind(variant, next_visited)
                if kind is not None:
                    return kind
        if isinstance(resolved, RawJsonSchemaType):
            st = resolved.schema.get("type")
            if isinstance(st, str) and st != "null":
                return st
            if isinstance(st, list):
                for item in st:
                    if isinstance(item, str) and item != "null":
                        return item
        return None

    def _object_properties_of(
        self,
        type_def: TypeDefinition | None,
        visited_refs: frozenset[str] = frozenset(),
    ) -> dict[str, TypeDefinition] | None:
        if type_def is None:
            return None
        resolved, next_visited, hit_cycle = self.resolve_type_with_visited(
            type_def, visited_refs
        )
        if hit_cycle or isinstance(resolved, _NON_STRUCTURED_TYPES):
            return None
        if isinstance(resolved, ObjectType) and resolved.properties:
            return {p.name: p.type for p in resolved.properties}
        if isinstance(resolved, UnionType):
            for variant in resolved.variants:
                props = self._object_properties_of(variant, next_visited)
                if props:
                    return props
        if isinstance(resolved, RawJsonSchemaType):
            raw_props = resolved.schema.get("properties")
            if isinstance(raw_props, Mapping) and raw_props:
                return {
                    str(k): type_definition_from_json_schema(
                        v,
                        at_least_v10=self.at_least_v10,
                    )
                    for k, v in raw_props.items()
                    if isinstance(v, Mapping)
                }
        return None

    def type_structured_properties(
        self,
        type_def: TypeDefinition | None,
        visited_refs: frozenset[str] = frozenset(),
    ) -> tuple[Literal["object", "array"], dict[str, TypeDefinition]] | None:
        """Returns `('object' | 'array', {key: TypeDefinition})` for structured properties."""
        if type_def is None:
            return None
        resolved, next_visited, hit_cycle = self.resolve_type_with_visited(
            type_def, visited_refs
        )
        if hit_cycle or isinstance(resolved, _NON_STRUCTURED_TYPES):
            return None
        if isinstance(resolved, ObjectType) and resolved.properties:
            return ("object", {p.name: p.type for p in resolved.properties})
        if isinstance(resolved, ArrayType) and resolved.items is not None:
            item_props = self._object_properties_of(resolved.items, next_visited)
            if item_props:
                return ("array", item_props)
        if isinstance(resolved, UnionType):
            for variant in resolved.variants:
                found = self.type_structured_properties(variant, next_visited)
                if found is not None:
                    return found
        if isinstance(resolved, RawJsonSchemaType):
            raw = dict(resolved.schema)
            item_s = self.resolve_item_schema(raw)
            if isinstance(item_s, dict) and isinstance(item_s.get("properties"), dict):
                return (
                    "array",
                    {
                        str(k): type_definition_from_json_schema(
                            v, at_least_v10=self.at_least_v10
                        )
                        for k, v in item_s["properties"].items()
                        if isinstance(v, Mapping)
                    },
                )
            obj_props = self._object_properties_of(resolved, next_visited)
            if obj_props:
                return ("object", obj_props)
        return None

    def type_object_list_keys(
        self,
        type_def: TypeDefinition | None,
        visited_refs: frozenset[str] = frozenset(),
    ) -> tuple[list[str], list[str]] | None:
        """Returns `(child_keys, other_keys)` for a non-dynamic array of objects holding a `Child`."""
        if type_def is None:
            return None
        resolved, next_visited, hit_cycle = self.resolve_type_with_visited(
            type_def, visited_refs
        )
        if hit_cycle:
            return None
        props: dict[str, TypeDefinition] | None = None
        if (
            isinstance(resolved, ArrayType)
            and not resolved.dynamic
            and resolved.items is not None
        ):
            items, item_visited, item_cycle = self.resolve_type_with_visited(
                resolved.items, next_visited
            )
            if not item_cycle and isinstance(items, ObjectType) and items.properties:
                props = {p.name: p.type for p in items.properties}
                next_visited = item_visited
        elif isinstance(resolved, RawJsonSchemaType):
            raw_items = (
                resolved.schema.get("items")
                if resolved.schema.get("type") == "array"
                else None
            )
            if isinstance(raw_items, Mapping) and isinstance(
                raw_items.get("properties"), Mapping
            ):
                props = {
                    str(k): type_definition_from_json_schema(
                        v, at_least_v10=self.at_least_v10
                    )
                    for k, v in raw_items["properties"].items()
                    if isinstance(v, Mapping)
                }
        if not props:
            return None
        child_keys = [
            k
            for k, sub_type in props.items()
            if self.type_semantic_kind(sub_type, next_visited) == "Child"
        ]
        if not child_keys:
            return None
        other_keys = [k for k in props if k not in child_keys]
        return child_keys, other_keys

    def resolve_item_type(
        self,
        type_def: TypeDefinition | None,
        visited_refs: frozenset[str] = frozenset(),
    ) -> TypeDefinition | None:
        """Resolves the item `TypeDefinition` of an `ArrayType` (or union containing one)."""
        if type_def is None:
            return None
        resolved, next_visited, hit_cycle = self.resolve_type_with_visited(
            type_def, visited_refs
        )
        if hit_cycle:
            return None
        if isinstance(resolved, ArrayType):
            return resolved.items
        if isinstance(resolved, UnionType):
            for variant in resolved.variants:
                found = self.resolve_item_type(variant, next_visited)
                if found is not None:
                    return found
        if isinstance(resolved, RawJsonSchemaType):
            item_s = self.resolve_item_schema(dict(resolved.schema))
            if isinstance(item_s, Mapping):
                return type_definition_from_json_schema(
                    item_s, at_least_v10=self.at_least_v10
                )
        return None

    def resolve_property_type(
        self,
        type_def: TypeDefinition | None,
        prop_name: str,
        visited_refs: frozenset[str] = frozenset(),
    ) -> TypeDefinition | None:
        """Resolves the `TypeDefinition` of a property inside an `ObjectType`."""
        if type_def is None:
            return None
        resolved, next_visited, hit_cycle = self.resolve_type_with_visited(
            type_def, visited_refs
        )
        if hit_cycle:
            return None
        if isinstance(resolved, ObjectType):
            param = resolved.get_property(prop_name)
            if param is not None:
                return param.type
            if not isinstance(resolved.additional_properties, bool):
                return resolved.additional_properties
            return None
        if isinstance(resolved, UnionType):
            for variant in resolved.variants:
                found = self.resolve_property_type(variant, prop_name, next_visited)
                if found is not None:
                    return found
        if isinstance(resolved, RawJsonSchemaType):
            prop_s = self.resolve_property_schema(dict(resolved.schema), prop_name)
            if isinstance(prop_s, Mapping):
                return type_definition_from_json_schema(
                    prop_s, at_least_v10=self.at_least_v10
                )
        return None

    def property_allows_databinding(
        self, component_name: str, property_name: str
    ) -> bool:
        return self.type_allows_databinding(
            self.get_parameter_type(component_name, property_name)
        )

    def property_is_action(self, component_name: str, property_name: str) -> bool:
        return self.type_is_action(
            self.get_parameter_type(component_name, property_name)
        )

    def property_accepts_number(self, component_name: str, property_name: str) -> bool:
        return self.type_accepts_number(
            self.get_parameter_type(component_name, property_name)
        )

    def property_expects_option_objects(
        self, component_name: str, property_name: str
    ) -> bool:
        return self.type_expects_option_objects(
            self.get_parameter_type(component_name, property_name)
        )

    def property_accepts_components(
        self, component_name: str, property_name: str
    ) -> bool:
        return self.type_accepts_components(
            self.get_parameter_type(component_name, property_name)
        )

    def property_primitive_kind(
        self, component_name: str, property_name: str
    ) -> str | None:
        return self.type_primitive_kind(
            self.get_parameter_type(component_name, property_name)
        )

    def get_property_description(
        self, component_name: str, property_name: str
    ) -> str | None:
        p_type = self.get_parameter_type(component_name, property_name)
        if p_type is None:
            return None
        if p_type.description is not None:
            return p_type.description
        return (
            self.resolve_type(p_type).description
            if isinstance(p_type, RefType)
            else None
        )

    def get_function_property_description(
        self, fn_name: str, prop_name: str
    ) -> str | None:
        p_type = self.get_function_parameter_type(fn_name, prop_name)
        if p_type is None:
            return None
        if p_type.description is not None:
            return p_type.description
        return (
            self.resolve_type(p_type).description
            if isinstance(p_type, RefType)
            else None
        )

    def function_allows_extra_args(self, fn_name: str) -> bool:
        fn_def = self.get_function_definition(fn_name)
        if fn_def is not None:
            return fn_def.additional_parameters is not False
        return True

    def _function_schema(self, name: str) -> Any:
        schema = self.functions.get(name)
        return schema if schema is not None else self.system_functions.get(name)

    def get_component_properties(self, name: str) -> list[str]:
        return self.component_properties.get(name, [])

    def get_component_required(self, name: str) -> list[str]:
        return self.component_required.get(name, [])

    def is_checkable(self, name: str) -> bool:
        return self.component_is_checkable.get(name, False)

    def get_custom_envelope_properties(self, name: str) -> frozenset[str]:
        return self.component_custom_envelope.get(name, frozenset())

    def get_function_properties(self, name: str) -> list[str]:
        if name in self.function_properties:
            return self.function_properties[name]
        return self._system_function_properties.get(name, [])

    def get_function_required(self, name: str) -> list[str]:
        if name in self.function_required:
            return self.function_required[name]
        return self._system_function_required.get(name, [])

    def get_function_property_schema(
        self, fn_name: str, prop_name: str
    ) -> dict[str, Any] | None:
        """Retrieves the JSON schema for a specific function argument property."""
        if self._functions_override is None:
            p_type = self.get_function_parameter_type(fn_name, prop_name)
            if p_type is not None:
                return type_definition_to_json_schema(
                    self._inline_type_refs(p_type),
                    at_least_v10=self.at_least_v10,
                )
        fn_schema = self._function_schema(fn_name)
        if not isinstance(fn_schema, dict):
            return None
        for sub in [fn_schema, *combinator_subschemas(fn_schema, ("allOf",))]:
            if isinstance(sub, dict) and isinstance(sub.get("properties"), dict):
                args_obj = sub["properties"].get("args", {})
                if isinstance(args_obj, dict) and isinstance(
                    args_obj.get("properties"), dict
                ):
                    res = args_obj["properties"].get(prop_name)
                    if isinstance(res, dict):
                        return res
        return None

    def get_property_enum(
        self, component_name: str, property_name: str
    ) -> list[Any] | None:
        return self.component_property_enums.get((component_name, property_name))

    def get_component_description(self, name: str) -> str | None:
        if self._components_override is None and name in self._component_defs:
            return self._component_defs[name].description
        schema = self.components.get(name)
        if not isinstance(schema, dict):
            return None
        desc = schema.get("description")
        if isinstance(desc, str):
            return desc
        for sub in combinator_subschemas(schema, ("allOf",)):
            if isinstance(sub, dict) and isinstance(sub.get("description"), str):
                return str(sub["description"])
        return None

    def get_function_description(self, name: str) -> str | None:
        if self._functions_override is None:
            fn_def = self.get_function_definition(name)
            if fn_def is not None:
                return fn_def.description
        schema = self._function_schema(name)
        if isinstance(schema, dict) and isinstance(schema.get("description"), str):
            return str(schema["description"])
        return None

    def get_property_schema(
        self, component_name: str, property_name: str
    ) -> dict[str, Any] | None:
        """Retrieves a property's JSON schema definition (synthesized lazily)."""
        if self._components_override is None:
            p_type = self.get_parameter_type(component_name, property_name)
            if p_type is not None:
                return type_definition_to_json_schema(
                    self._inline_type_refs(p_type),
                    at_least_v10=self.at_least_v10,
                )
        schema = self.components.get(component_name)
        if not isinstance(schema, dict):
            return None
        own_props = schema.get("properties")
        if isinstance(own_props, dict) and isinstance(
            own_props.get(property_name), dict
        ):
            return dict(own_props[property_name])
        return None

    def get_property_type(self, component_name: str, property_name: str) -> str | None:
        """Resolves the semantic type ('ChildList', 'Child', 'Action') of a component property."""
        if self._components_override is None:
            return self.type_semantic_kind(
                self.get_parameter_type(component_name, property_name)
            )
        return _crawl_raw_semantic_kind(
            self.get_property_schema(component_name, property_name)
        )

    def _lookup_common_def(self, def_name: str) -> Any:
        defs = self.common_types.get("$defs") or self.common_types.get("definitions")
        return defs.get(def_name) if isinstance(defs, dict) else None

    def _resolve_json_pointer(self, root: dict[str, Any], pointer: str) -> Any:
        if not pointer.startswith("#/"):
            return None
        current: Any = root
        for part in pointer[2:].split("/"):
            if not isinstance(current, dict):
                return None
            current = current.get(part.replace("~1", "/").replace("~0", "~"))
        return current

    def accepts_number(self, schema: Any) -> bool:
        """Checks whether a raw JSON property schema accepts a numeric value."""
        visited: set[int] = set()

        def _check(s: Any, in_common_types: bool) -> bool:
            if not isinstance(s, dict) or id(s) in visited:
                return False
            visited.add(id(s))
            s_type = s.get("type")
            if s_type in ("number", "integer") or (
                isinstance(s_type, list)
                and any(t in ("number", "integer") for t in s_type)
            ):
                return True
            const_val = s.get("const")
            if isinstance(const_val, (int, float)) and not isinstance(const_val, bool):
                return True
            enum_val = s.get("enum")
            if isinstance(enum_val, list) and any(
                isinstance(v, (int, float)) and not isinstance(v, bool)
                for v in enum_val
            ):
                return True
            ref = s.get("$ref")
            if isinstance(ref, str):
                m = _COMMON_DEF_RE.search(ref)
                if m:
                    resolved = self._lookup_common_def(m.group(1))
                    if resolved is None or _check(resolved, True):
                        return True
                elif in_common_types and (
                    ref.startswith("#/$defs/") or ref.startswith("#/definitions/")
                ):
                    name = ref[8:] if ref.startswith("#/$defs/") else ref[14:]
                    resolved = self._lookup_common_def(name)
                    if resolved is None or _check(resolved, True):
                        return True
                elif ref.startswith("#/") or ref.startswith("catalog.json#/"):
                    ptr = ref if ref.startswith("#/") else ref[12:]
                    resolved = self._resolve_json_pointer(self.catalog, ptr)
                    if resolved is None or _check(resolved, False):
                        return True
                else:
                    return True
            if any(_check(sub, in_common_types) for sub in combinator_subschemas(s)):
                return True
            type_keys = {
                "type",
                "const",
                "enum",
                "$ref",
                "allOf",
                "oneOf",
                "anyOf",
                "properties",
                "items",
                "prefixItems",
                "not",
            }
            return not any(k in s for k in type_keys)

        return _check(schema, False)

    def resolve_item_schema(self, schema: Any) -> dict[str, Any] | None:
        return self._resolve_at(schema, None)

    def resolve_property_schema(self, schema: Any, name: str) -> dict[str, Any] | None:
        return self._resolve_at(schema, name)

    def _resolve_at(self, schema: Any, prop: str | None) -> dict[str, Any] | None:
        visited: set[int] = set()

        def _resolve(s: Any, in_common_types: bool) -> dict[str, Any] | None:
            if not isinstance(s, dict) or id(s) in visited:
                return None
            visited.add(id(s))
            if prop is None:
                items = s.get("items")
                if isinstance(items, dict):
                    return items
            else:
                props = s.get("properties")
                declared = props.get(prop) if isinstance(props, dict) else None
                if isinstance(declared, dict):
                    return declared
                additional = s.get("additionalProperties")
                if isinstance(additional, dict):
                    return additional
            ref = s.get("$ref")
            if isinstance(ref, str):
                def_name = common_def_name(ref)
                if def_name:
                    found = _resolve(self._lookup_common_def(def_name), True)
                elif in_common_types and (
                    ref.startswith("#/$defs/") or ref.startswith("#/definitions/")
                ):
                    name = ref[8:] if ref.startswith("#/$defs/") else ref[14:]
                    found = _resolve(self._lookup_common_def(name), True)
                elif ref.startswith("#/"):
                    found = _resolve(
                        self._resolve_json_pointer(self.catalog, ref), False
                    )
                else:
                    found = None
                if found:
                    return found
            for sub in combinator_subschemas(s):
                found = _resolve(sub, in_common_types)
                if found:
                    return found
            return None

        return _resolve(schema, False)
