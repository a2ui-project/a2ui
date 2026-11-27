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

"""Catalog schema crawler shared by the compact inference formats.

Provides dynamic schema crawling to identify component properties, logical function
signatures, and requirements directly from standard catalog JSON schemas.
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
    component_definition_to_json_schema,
    function_definition_from_json_schema,
    function_definition_to_json_schema,
    has_raw_json_schema,
    resolve_type_ref,
    type_definition_to_json_schema,
)
from a2ui.core.common import is_at_least_version
from a2ui.core.schema import ProtocolVersion
from a2ui.utils.component_envelope import AT_ENVELOPE_MIXIN_KEYS, ENVELOPE_MIXIN_NAMES

_COMMON_DEF_RE = re.compile(r"(?:^|/)common_types\.json#/(?:\$defs|definitions)/(\w+)$")
_LOCAL_DEF_RE = re.compile(r"^#/(?:\$defs|definitions)/(\w+)$")


def _load_common_def_names() -> frozenset[str]:
    names: set[str] = {"ComponentCommon", "ComponentCommonMetadata", "Checkable"}
    for ver in (ProtocolVersion.V0_9, ProtocolVersion.V1_0):
        schema_map = get_common_types_schema_map(ver)
        defs = schema_map.get("$defs") or schema_map.get("definitions")
        if isinstance(defs, dict):
            names.update(str(k) for k in defs.keys())
    return frozenset(names)


_PRESERVED_COMMON_DEF_NAMES: frozenset[str] = _load_common_def_names()

_STANDARD_CATALOG_ID_DESCRIPTION = (
    "The catalog ID for this component, overriding any surface-level default catalogId."
)


def _is_standard_checks_schema(schema: Any) -> bool:
    """Returns whether a bare `checks` property schema is the `Checkable` mixin's."""
    if not isinstance(schema, dict):
        return False
    ref = schema.get("$ref")
    if isinstance(ref, str) and ref.endswith("/Checkable"):
        return True
    items = schema.get("items")
    return (
        isinstance(items, dict)
        and isinstance(items.get("$ref"), str)
        and items["$ref"].endswith("/CheckRule")
    )


def _is_standard_catalog_id_schema(schema: Any) -> bool:
    """Returns whether a bare `catalogId` property schema is `ComponentCommon`'s."""
    return (
        isinstance(schema, dict)
        and schema.get("description") == _STANDARD_CATALOG_ID_DESCRIPTION
    )


def common_def_name(ref: Any) -> str | None:
    """Returns the common type a `$ref` names, or None if it is not one.

    Matches both explicit `common_types.json#/$defs/<Name>` references and
    catalog-local `#/$defs/<Name>` references preserved by `inline_local_refs`.
    """
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
    """Returns whether `sub` is a schema declaring an object, `$ref`, or combinator."""
    if not isinstance(sub, dict):
        return False
    return (
        "$ref" in sub
        or sub.get("type") == "object"
        or isinstance(sub.get("properties"), dict)
        or any(k in sub for k in ("allOf", "oneOf", "anyOf"))
    )


def _is_flattened_action(schema: dict[str, Any]) -> bool:
    """Returns whether `schema` declares a flattened `Action` wire branch."""
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
    """Checks whether a property schema is an Action slot.

    A property is an action slot when its schema references the common `Action`
    def or declares a flattened `Action` branch (`{event}` or `{functionCall}`),
    directly or through `oneOf`/`anyOf`/`allOf`.

    Args:
        schema: The property JSON schema to inspect.
        visited: Seen schema object IDs for cycle and diamond-DAG deduplication.

    Returns:
        True if the schema references or matches an `Action` slot.
    """
    if not isinstance(schema, dict):
        return False
    if visited is None:
        visited = set()
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
    """Returns the first `enum` list found in a schema or its combinators."""
    if not isinstance(s, dict):
        return None
    if visited is None:
        visited = set()
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
    """Returns the system functions that a common types schema defines.

    A system function is defined by the protocol rather than by a catalog: it
    is a common types `$defs` entry whose `@call` property is a constant name
    starting with `@`, such as `@index` from v1.0. It has the same shape as a
    catalog function, so the same code reads its arguments.

    Args:
        common_types: The common types JSON schema of a protocol version.

    Returns:
        The system function schemas keyed by their `@` name, which is empty for
        a version that defines none.
    """
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


def _function_signature(schema: Any) -> tuple[list[str], list[str]]:
    """Returns a function schema's argument names in order, and the required ones."""
    sub_schemas = [schema]
    if isinstance(schema, dict) and "allOf" in schema:
        sub_schemas.extend(schema["allOf"])

    props: dict[str, Any] = {}
    reqs: list[str] = []
    for sub in sub_schemas:
        if not isinstance(sub, dict):
            continue
        if "properties" in sub:
            args_obj = sub["properties"].get("args", {})
            if isinstance(args_obj, dict):
                if "properties" in args_obj:
                    props.update(args_obj["properties"])
                if "required" in args_obj:
                    reqs.extend(args_obj["required"])
    return list(props.keys()), reqs


def _ordered_component_sub_schemas(schema: Any) -> list[dict[str, Any]]:
    """Returns component sub-schemas with specific definitions before common mixins.

    Walks the component schema and its nested `allOf` entries, including the
    `allOf` of an inlined local mixin such as a `$defs` entry that composes
    `ComponentCommon` with extra properties. A sub-schema whose `properties`
    contain `component` is specific; the others are common mixins. Within each
    group, sub-schemas keep their pre-order position, so positional argument
    order is consistent across protocol versions.
    """
    if not isinstance(schema, dict):
        return []
    specific: list[dict[str, Any]] = []
    common: list[dict[str, Any]] = []
    visited: set[int] = set()

    def _visit(node: Any, is_root: bool = False) -> None:
        if not isinstance(node, dict) or id(node) in visited:
            return
        visited.add(id(node))
        props = node.get("properties")
        is_specific = isinstance(props, dict) and "component" in props
        if is_specific:
            specific.append(node)
        elif (
            not is_root
            or isinstance(props, dict)
            or "required" in node
            or "$ref" in node
        ):
            common.append(node)
        all_of = node.get("allOf")
        if isinstance(all_of, list):
            for sub in all_of:
                _visit(sub, is_root=False)

    _visit(schema, is_root=True)
    return [*specific, *common]


def _semantic_ref_type(ref: Any) -> str | None:
    """Returns the semantic property type ('ChildList', 'Child', 'Action') for a $ref."""
    if not isinstance(ref, str):
        return None
    if "ChildList" in ref:
        return "ChildList"
    if "Child" in ref or "ComponentId" in ref:
        return "Child"
    if "Action" in ref:
        return "Action"
    return None


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
    """Dynamic catalog inspector shared by the compact inference formats.

    Reads component and function signatures directly from the canonical
    `CatalogModel` whenever the catalog has no untranslatable raw JSON Schema
    keywords, avoiding `catalog.to_json()` and `inline_local_refs()` on the
    canonical path while preserving full legacy JSON Schema fallback and
    backward-compatible attributes.

    Attributes:
        catalog_model: The underlying `Catalog` instance.
        model: The canonical `CatalogModel`.
        catalog: Lazily materialized catalog JSON Schema dictionary.
        components: Mapping of component names to their catalog JSON schemas
            (membership/iteration read `model` without synthesizing schemas).
        functions: Mapping of function names to their catalog JSON schemas
            (membership/iteration read `model` without synthesizing schemas).
        system_functions: A dictionary mapping the names of the system
            functions that the target protocol version defines, such as
            `@index`, to their common types schemas.
    """

    def __init__(
        self,
        catalog: CatalogApi,
        protocol_version: str | ProtocolVersion | None = None,
    ):
        """Initializes the helper with a Catalog.

        Args:
            catalog: A Catalog instance.
            protocol_version: The protocol version whose common types and
                system functions the helper reads. Defaults to the catalog's
                own protocol version.
        """
        if not isinstance(catalog, Catalog):
            raise TypeError(f"Unsupported catalog type: {type(catalog)}")
        self.catalog_model = catalog
        self.model: CatalogModel = catalog.model
        self.types: Mapping[str, DataTypeDefinition] = self.model.types
        self._component_defs: dict[str, ComponentDefinition] = {
            c.name: c for c in self.model.components
        }
        self._function_defs: dict[str, FunctionDefinition] = {
            f.name: f for f in self.model.functions
        }
        self._canonical_components: set[str] = {
            name
            for name, comp_def in self._component_defs.items()
            if not has_raw_json_schema(comp_def, self.types)
        }
        self._canonical_functions: set[str] = {
            name
            for name, fn_def in self._function_defs.items()
            if not has_raw_json_schema(fn_def, self.types)
        }
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
        self.system_functions = system_function_schemas(self.common_types)
        self._system_function_defs: dict[str, FunctionDefinition] = {
            name: function_definition_from_json_schema(name, schema)
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
            raw = (
                self.catalog_model.to_json_schema(
                    protocol_version=self.protocol_version.value
                    if self.protocol_version is not None
                    else None
                )
                if getattr(self.catalog_model, "_from_catalog_document", False)
                else self.catalog_model.to_json()
            )
            catalog_schema = dict(raw or {})
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

    def _effective_version_str(self) -> str:
        if self.protocol_version is not None:
            return self.protocol_version.value
        return self.catalog_model.protocol_version or "1.0"

    def _load_component_schema(self, name: str) -> dict[str, Any]:
        if name in self._canonical_components:
            return component_definition_to_json_schema(
                self._component_defs[name],
                at_least_v10=self.at_least_v10,
            )
        raw_comps = self.catalog.get("components", {})
        if isinstance(raw_comps, Mapping) and isinstance(raw_comps.get(name), dict):
            return dict(raw_comps[name])
        return {}

    def _load_function_schema(self, name: str) -> dict[str, Any]:
        if name in self._canonical_functions:
            return function_definition_to_json_schema(
                self._function_defs[name],
                at_least_v10=self.at_least_v10,
            )
        raw_fns = self.catalog.get("functions", {})
        if isinstance(raw_fns, Mapping) and isinstance(raw_fns.get(name), dict):
            return dict(raw_fns[name])
        return {}

    def _load_component_from_json_schema(
        self, name: str, schema: dict[str, Any]
    ) -> None:
        """Legacy JSON Schema crawler fallback for components with raw schema keywords."""
        props: dict[str, Any] = {}
        reqs: list[str] = []
        is_checkable = False

        for sub in _ordered_component_sub_schemas(schema):
            ref = sub.get("$ref")
            if isinstance(ref, str) and "Checkable" in ref:
                is_checkable = True
            sub_props = sub.get("properties")
            if isinstance(sub_props, dict):
                for pk, pv in sub_props.items():
                    props.setdefault(pk, pv)
            sub_reqs = sub.get("required")
            if isinstance(sub_reqs, list):
                for r in sub_reqs:
                    if r not in reqs:
                        reqs.append(r)

        if "@checks" in props or _is_standard_checks_schema(props.get("checks")):
            is_checkable = True

        custom_envelope = {k for k in ENVELOPE_MIXIN_NAMES if k in props}
        if "checks" in custom_envelope and _is_standard_checks_schema(props["checks"]):
            custom_envelope.discard("checks")
        if "catalogId" in custom_envelope and _is_standard_catalog_id_schema(
            props["catalogId"]
        ):
            custom_envelope.discard("catalogId")
        meta_schema = props.get("metadata")
        if (
            isinstance(meta_schema, dict)
            and isinstance(meta_schema.get("properties"), dict)
            and set(meta_schema["properties"]) == {"extensions"}
            and meta_schema.get("additionalProperties") is False
        ):
            custom_envelope.discard("metadata")
        a11y_schema = props.get("accessibility")
        if isinstance(a11y_schema, dict) and (
            str(a11y_schema.get("$ref", "")).endswith("/AccessibilityAttributes")
            or (
                isinstance(a11y_schema.get("properties"), dict)
                and {"label", "description"} <= set(a11y_schema["properties"])
                and a11y_schema.get("additionalProperties") is False
            )
        ):
            custom_envelope.discard("accessibility")

        excluded = {"component", "id", *AT_ENVELOPE_MIXIN_KEYS}
        excluded.update({"catalogId", "metadata", "accessibility"} - custom_envelope)
        if is_checkable and "checks" not in custom_envelope:
            excluded.add("checks")
        ordered_keys = [k for k in props if k not in excluded]

        for k in ordered_keys:
            enum_val = _find_enum(self.get_property_schema(name, k))
            if enum_val:
                self.component_property_enums[(name, k)] = enum_val

        if is_checkable and "checks" not in custom_envelope:
            ordered_keys.append("checks")

        self.component_properties[name] = ordered_keys
        self.component_required[name] = reqs
        self.component_is_checkable[name] = is_checkable
        self.component_custom_envelope[name] = frozenset(custom_envelope)

    def _load_mappings(self) -> None:
        """Populates component and function lookup tables from `CatalogModel`."""
        self.component_properties = {}
        self.component_required = {}
        self.component_is_checkable = {}
        self.component_custom_envelope = {}
        self.component_property_enums = {}

        for name, comp_def in self._component_defs.items():
            if name not in self._canonical_components:
                raw_comps = self.catalog.get("components", {})
                raw_schema = (
                    raw_comps.get(name, {}) if isinstance(raw_comps, Mapping) else {}
                )
                self._load_component_from_json_schema(name, raw_schema)
                continue

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

        self.function_properties = {}
        self.function_required = {}

        for name, fn_def in self._function_defs.items():
            if name not in self._canonical_functions:
                raw_fns = self.catalog.get("functions", {})
                raw_fn = raw_fns.get(name, {}) if isinstance(raw_fns, Mapping) else {}
                props_list, reqs = _function_signature(raw_fn)
                self.function_properties[name] = props_list
                self.function_required[name] = reqs
                continue

            self.function_properties[name] = [p.name for p in fn_def.parameters]
            self.function_required[name] = [
                p.name for p in fn_def.parameters if p.required
            ]

        self._system_function_properties: dict[str, list[str]] = {}
        self._system_function_required: dict[str, list[str]] = {}
        for name, fn_def in self._system_function_defs.items():
            self._system_function_properties[name] = [p.name for p in fn_def.parameters]
            self._system_function_required[name] = [
                p.name for p in fn_def.parameters if p.required
            ]

    def resolve_type(self, type_def: TypeDefinition) -> TypeDefinition:
        """Resolves any local `RefType` chain against `self.types`, preserving description."""
        if not isinstance(type_def, RefType):
            return type_def
        outer_desc = type_def.description
        resolved = resolve_type_ref(type_def, self.types)
        if outer_desc is not None and resolved.description is None:
            return replace(resolved, description=outer_desc)
        return resolved

    def _inline_type_refs(
        self, type_def: TypeDefinition, visited: frozenset[str] = frozenset()
    ) -> TypeDefinition:
        """Recursively resolves `RefType` nodes inside a `TypeDefinition` tree."""
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
        """Returns the canonical `ComponentDefinition` for `name`, if canonical."""
        if name in self._canonical_components:
            return self._component_defs.get(name)
        return None

    def get_function_definition(self, name: str) -> FunctionDefinition | None:
        """Returns the canonical `FunctionDefinition` for a catalog or system function."""
        if name in self._canonical_functions:
            return self._function_defs.get(name)
        return self._system_function_defs.get(name)

    def get_parameter_definition(
        self, component_name: str, property_name: str
    ) -> ParameterDefinition | None:
        """Returns the `ParameterDefinition` for a canonical component property."""
        comp_def = self.get_component_definition(component_name)
        if comp_def is None:
            return None
        return comp_def.get_parameter(property_name)

    def get_parameter_type(
        self, component_name: str, property_name: str
    ) -> TypeDefinition | None:
        """Returns the `TypeDefinition` for a canonical component property (including `checks`)."""
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
        """Returns the `ParameterDefinition` for a canonical function argument."""
        fn_def = self.get_function_definition(fn_name)
        if fn_def is None:
            return None
        return fn_def.get_parameter(prop_name)

    def get_function_parameter_type(
        self, fn_name: str, prop_name: str
    ) -> TypeDefinition | None:
        """Returns the `TypeDefinition` for a canonical function argument."""
        param = self.get_function_parameter_definition(fn_name, prop_name)
        return param.type if param is not None else None

    def type_semantic_kind(self, type_def: TypeDefinition | None) -> str | None:
        """Returns 'ChildList', 'Child', or 'Action' for a `TypeDefinition`, or None."""
        if type_def is None:
            return None
        resolved = self.resolve_type(type_def)
        if isinstance(resolved, ChildListType):
            return "ChildList"
        if isinstance(resolved, ChildType):
            return "Child"
        if isinstance(resolved, ActionType):
            return "Action"
        if isinstance(resolved, UnionType):
            for variant in resolved.variants:
                kind = self.type_semantic_kind(variant)
                if kind is not None:
                    return kind
        return None

    def type_allows_databinding(self, type_def: TypeDefinition | None) -> bool:
        """Returns whether a `TypeDefinition` accepts a data-binding expression."""
        if type_def is None:
            return False
        resolved = self.resolve_type(type_def)
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
            return any(self.type_allows_databinding(v) for v in resolved.variants)
        return False

    def type_is_action(self, type_def: TypeDefinition | None) -> bool:
        """Returns whether a `TypeDefinition` represents an Action slot."""
        if type_def is None:
            return False
        resolved = self.resolve_type(type_def)
        if isinstance(resolved, ActionType):
            return True
        if isinstance(resolved, UnionType):
            return any(self.type_is_action(v) for v in resolved.variants)
        return False

    def type_accepts_number(self, type_def: TypeDefinition | None) -> bool:
        """Returns whether a `TypeDefinition` accepts a numeric literal."""
        if type_def is None:
            return False
        resolved = self.resolve_type(type_def)
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
            return any(self.type_accepts_number(v) for v in resolved.variants)
        if isinstance(resolved, RawJsonSchemaType):
            return self.accepts_number(resolved.schema)
        return False

    def type_enum_values(self, type_def: TypeDefinition | None) -> list[Any] | None:
        """Returns the first enum value list declared in `type_def`, or None."""
        if type_def is None:
            return None
        resolved = self.resolve_type(type_def)
        if isinstance(resolved, EnumType):
            return list(resolved.values)
        if isinstance(resolved, UnionType):
            for variant in resolved.variants:
                vals = self.type_enum_values(variant)
                if vals:
                    return vals
        return None

    def type_expects_option_objects(self, type_def: TypeDefinition | None) -> bool:
        """Returns whether `type_def` is an array of objects with `label` and `value`."""
        if type_def is None:
            return False
        resolved = self.resolve_type(type_def)
        if isinstance(resolved, ArrayType) and resolved.items is not None:
            return self._type_has_label_value(resolved.items)
        if isinstance(resolved, UnionType):
            return any(self.type_expects_option_objects(v) for v in resolved.variants)
        return False

    def _type_has_label_value(self, type_def: TypeDefinition) -> bool:
        resolved = self.resolve_type(type_def)
        if isinstance(resolved, ObjectType):
            names = {p.name for p in resolved.properties}
            return "label" in names and "value" in names
        if isinstance(resolved, UnionType):
            return any(self._type_has_label_value(v) for v in resolved.variants)
        return False

    def type_accepts_components(self, type_def: TypeDefinition | None) -> bool:
        """Returns whether `type_def` accepts component ID references (or lists of them)."""
        if type_def is None:
            return False
        resolved = self.resolve_type(type_def)
        if isinstance(resolved, (ChildType, ChildListType)):
            return True
        if isinstance(resolved, ArrayType) and resolved.items is not None:
            return self.type_accepts_components(resolved.items)
        if isinstance(resolved, UnionType):
            return any(self.type_accepts_components(v) for v in resolved.variants)
        return False

    def type_primitive_kind(self, type_def: TypeDefinition | None) -> str | None:
        """Returns the primitive JSON kind ('string', 'number', 'integer', 'boolean', 'array', 'object') for `type_def`."""
        if type_def is None:
            return None
        resolved = self.resolve_type(type_def)
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
                kind = self.type_primitive_kind(variant)
                if kind is not None:
                    return kind
        return None

    def _object_properties_of(
        self, type_def: TypeDefinition | None
    ) -> dict[str, TypeDefinition] | None:
        if type_def is None:
            return None
        resolved = self.resolve_type(type_def)
        if isinstance(
            resolved,
            (
                DataBindingType,
                FunctionCallType,
                ActionType,
                ChildType,
                ChildListType,
                CheckRuleType,
                AccessibilityType,
            ),
        ):
            return None
        if isinstance(resolved, ObjectType) and resolved.properties:
            return {p.name: p.type for p in resolved.properties}
        if isinstance(resolved, UnionType):
            for variant in resolved.variants:
                props = self._object_properties_of(variant)
                if props:
                    return props
        return None

    def type_structured_properties(
        self, type_def: TypeDefinition | None
    ) -> tuple[Literal["object", "array"], dict[str, TypeDefinition]] | None:
        """Returns `('object' | 'array', {key: TypeDefinition})` for structured properties."""
        if type_def is None:
            return None
        resolved = self.resolve_type(type_def)
        if isinstance(
            resolved,
            (
                DataBindingType,
                FunctionCallType,
                ActionType,
                ChildType,
                ChildListType,
                CheckRuleType,
                AccessibilityType,
            ),
        ):
            return None
        if isinstance(resolved, ObjectType) and resolved.properties:
            return ("object", {p.name: p.type for p in resolved.properties})
        if isinstance(resolved, ArrayType) and resolved.items is not None:
            item_props = self._object_properties_of(resolved.items)
            if item_props:
                return ("array", item_props)
        if isinstance(resolved, UnionType):
            for variant in resolved.variants:
                found = self.type_structured_properties(variant)
                if found is not None:
                    return found
        return None

    def resolve_item_type(
        self, type_def: TypeDefinition | None
    ) -> TypeDefinition | None:
        """Resolves the item `TypeDefinition` of an `ArrayType` (or union containing one)."""
        if type_def is None:
            return None
        resolved = self.resolve_type(type_def)
        if isinstance(resolved, ArrayType):
            return resolved.items
        if isinstance(resolved, UnionType):
            for variant in resolved.variants:
                found = self.resolve_item_type(variant)
                if found is not None:
                    return found
        return None

    def resolve_property_type(
        self, type_def: TypeDefinition | None, prop_name: str
    ) -> TypeDefinition | None:
        """Resolves the `TypeDefinition` of a property inside an `ObjectType`."""
        if type_def is None:
            return None
        resolved = self.resolve_type(type_def)
        if isinstance(resolved, ObjectType):
            param = resolved.get_property(prop_name)
            if param is not None:
                return param.type
            if not isinstance(resolved.additional_properties, bool):
                return resolved.additional_properties
            return None
        if isinstance(resolved, UnionType):
            for variant in resolved.variants:
                found = self.resolve_property_type(variant, prop_name)
                if found is not None:
                    return found
        return None

    def property_allows_databinding(
        self, component_name: str, property_name: str
    ) -> bool:
        """Returns whether a component property allows data binding."""
        p_type = self.get_parameter_type(component_name, property_name)
        if p_type is not None:
            return self.type_allows_databinding(p_type)
        p_schema = self.get_property_schema(component_name, property_name)
        if not isinstance(p_schema, dict):
            return False
        ref = p_schema.get("$ref")
        if isinstance(ref, str) and (
            "DataBinding" in ref or "Dynamic" in ref or "ChildList" in ref
        ):
            return True
        props = p_schema.get("properties")
        reqs = p_schema.get("required")
        if (
            p_schema.get("type") in (None, "object")
            and isinstance(props, dict)
            and isinstance(reqs, list)
            and (
                (set(props) == {self.path_key} and self.path_key in reqs)
                or (
                    set(props) == {"componentId", "path"}
                    and {"componentId", "path"} <= set(reqs)
                )
            )
        ):
            return True
        return False

    def property_is_action(self, component_name: str, property_name: str) -> bool:
        """Returns whether a component property is an Action slot."""
        p_type = self.get_parameter_type(component_name, property_name)
        if p_type is not None:
            return self.type_is_action(p_type)
        return is_action_slot(self.get_property_schema(component_name, property_name))

    def property_accepts_number(self, component_name: str, property_name: str) -> bool:
        """Returns whether a component property accepts a numeric literal."""
        p_type = self.get_parameter_type(component_name, property_name)
        if p_type is not None:
            return self.type_accepts_number(p_type)
        return self.accepts_number(
            self.get_property_schema(component_name, property_name)
        )

    def property_expects_option_objects(
        self, component_name: str, property_name: str
    ) -> bool:
        """Returns whether a component property expects a list of `{label, value}` objects."""
        p_type = self.get_parameter_type(component_name, property_name)
        if p_type is not None:
            return self.type_expects_option_objects(p_type)
        p_schema = self.get_property_schema(component_name, property_name)
        if not isinstance(p_schema, dict):
            return False
        items = self.resolve_item_schema(p_schema)
        if isinstance(items, dict):
            props = items.get("properties")
            if isinstance(props, dict) and "label" in props and "value" in props:
                return True
        return False

    def property_accepts_components(
        self, component_name: str, property_name: str
    ) -> bool:
        """Returns whether a component property accepts component ID references."""
        p_type = self.get_parameter_type(component_name, property_name)
        if p_type is not None:
            return self.type_accepts_components(p_type)
        return self.get_property_type(component_name, property_name) in (
            "Child",
            "ChildList",
        )

    def property_primitive_kind(
        self, component_name: str, property_name: str
    ) -> str | None:
        """Returns the primitive JSON kind for a component property, if determinable."""
        p_type = self.get_parameter_type(component_name, property_name)
        if p_type is not None:
            return self.type_primitive_kind(p_type)
        return None

    def get_property_description(
        self, component_name: str, property_name: str
    ) -> str | None:
        """Returns the description of a component property, or None."""
        p_type = self.get_parameter_type(component_name, property_name)
        if p_type is not None:
            if p_type.description is not None:
                return p_type.description
            if isinstance(p_type, RefType):
                return self.resolve_type(p_type).description
            return None
        p_schema = self.get_property_schema(component_name, property_name)
        desc = p_schema.get("description") if isinstance(p_schema, dict) else None
        return desc if isinstance(desc, str) else None

    def get_function_property_description(
        self, fn_name: str, prop_name: str
    ) -> str | None:
        """Returns the description of a function argument property, or None."""
        p_type = self.get_function_parameter_type(fn_name, prop_name)
        if p_type is not None:
            if p_type.description is not None:
                return p_type.description
            if isinstance(p_type, RefType):
                return self.resolve_type(p_type).description
            return None
        p_schema = self.get_function_property_schema(fn_name, prop_name)
        desc = p_schema.get("description") if isinstance(p_schema, dict) else None
        return desc if isinstance(desc, str) else None

    def function_allows_extra_args(self, fn_name: str) -> bool:
        """Returns whether a function accepts undeclared extra arguments."""
        fn_def = self.get_function_definition(fn_name)
        if fn_def is not None:
            return fn_def.additional_parameters is not False
        fn_schema = self._function_schema(fn_name)
        if not isinstance(fn_schema, dict):
            return True
        sub_schemas = [fn_schema, *fn_schema.get("allOf", [])]
        for sub in sub_schemas:
            if not isinstance(sub, dict) or not isinstance(sub.get("properties"), dict):
                continue
            args_schema = sub["properties"].get("args")
            if not isinstance(args_schema, dict):
                continue
            if (
                args_schema.get("additionalProperties") is False
                or args_schema.get("unevaluatedProperties") is False
            ):
                return False
        return True

    def _function_schema(self, name: str) -> Any:
        """Returns the schema of a catalog or system function, or None."""
        schema = self.functions.get(name)
        return schema if schema is not None else self.system_functions.get(name)

    def get_component_properties(self, name: str) -> list[str]:
        """Returns the ordered properties of the specified component."""
        return self.component_properties.get(name, [])

    def get_component_required(self, name: str) -> list[str]:
        """Returns the list of required properties for the specified component."""
        return self.component_required.get(name, [])

    def is_checkable(self, name: str) -> bool:
        """Returns whether the specified component supports client-side checks."""
        return self.component_is_checkable.get(name, False)

    def get_custom_envelope_properties(self, name: str) -> frozenset[str]:
        """Returns the envelope mixin names the component declares as its own properties.

        These bare names (`catalogId`, `metadata`, `accessibility`, `checks`)
        are ordinary catalog properties of the component. A v1.0 reader must
        not fall back to them when the `@`-prefixed envelope key is absent.
        """
        return self.component_custom_envelope.get(name, frozenset())

    def get_function_properties(self, name: str) -> list[str]:
        """Returns the ordered properties of a catalog or system function's arguments."""
        if name in self.function_properties:
            return self.function_properties[name]
        return self._system_function_properties.get(name, [])

    def get_function_required(self, name: str) -> list[str]:
        """Returns the required argument properties of a catalog or system function."""
        if name in self.function_required:
            return self.function_required[name]
        return self._system_function_required.get(name, [])

    def get_function_property_schema(
        self, fn_name: str, prop_name: str
    ) -> dict[str, Any] | None:
        """Retrieves the JSON schema for a specific function argument property.

        Args:
            fn_name: The catalog name of the function.
            prop_name: The argument property key.

        Returns:
            The JSON schema dictionary for the property, or None.
        """
        if self._functions_override is None:
            p_type = self.get_function_parameter_type(fn_name, prop_name)
            if p_type is not None:
                return type_definition_to_json_schema(
                    self._inline_type_refs(p_type),
                    at_least_v10=self.at_least_v10,
                )
        fn_schema = self._function_schema(fn_name)
        if not fn_schema or not isinstance(fn_schema, dict):
            return None

        sub_schemas = [fn_schema]
        if "allOf" in fn_schema and isinstance(fn_schema["allOf"], list):
            sub_schemas.extend(fn_schema["allOf"])

        for sub in sub_schemas:
            if (
                isinstance(sub, dict)
                and "properties" in sub
                and isinstance(sub["properties"], dict)
            ):
                args_obj = sub["properties"].get("args", {})
                if (
                    isinstance(args_obj, dict)
                    and "properties" in args_obj
                    and isinstance(args_obj["properties"], dict)
                    and prop_name in args_obj["properties"]
                ):
                    res = args_obj["properties"][prop_name]
                    return res if isinstance(res, dict) else None
        return None

    def get_property_enum(
        self, component_name: str, property_name: str
    ) -> list[Any] | None:
        """Returns the list of allowed enum values for a component property, or None."""
        return self.component_property_enums.get((component_name, property_name))

    def get_component_description(self, name: str) -> str | None:
        """Retrieves the description of the component from its catalog definition."""
        if self._components_override is None and name in self._canonical_components:
            return self._component_defs[name].description
        schema = self.components.get(name)
        if not schema or not isinstance(schema, dict):
            return None
        desc = schema.get("description")
        if isinstance(desc, str):
            return desc
        if "allOf" in schema and isinstance(schema["allOf"], list):
            for sub in schema["allOf"]:
                if isinstance(sub, dict) and isinstance(sub.get("description"), str):
                    return str(sub["description"])
        return None

    def get_function_description(self, name: str) -> str | None:
        """Retrieves the description of a catalog or system function."""
        if self._functions_override is None:
            fn_def = self.get_function_definition(name)
            if fn_def is not None:
                return fn_def.description
        schema = self._function_schema(name)
        if not schema or not isinstance(schema, dict):
            return None
        desc = schema.get("description")
        return desc if isinstance(desc, str) else None

    def get_property_schema(
        self, component_name: str, property_name: str
    ) -> dict[str, Any] | None:
        """Retrieves a property's JSON schema definition.

        For canonical components, synthesizes directly from the `TypeDefinition`
        without serializing the full catalog. For legacy non-canonical schemas,
        crawls all sub-schemas with the component's own definition winning over
        its `allOf` sub-schemas.
        """
        if (
            self._components_override is None
            and component_name in self._canonical_components
        ):
            p_type = self.get_parameter_type(component_name, property_name)
            if p_type is None:
                return None
            return type_definition_to_json_schema(
                self._inline_type_refs(p_type),
                at_least_v10=self.at_least_v10,
            )

        schema = self.components.get(component_name)
        if not schema or not isinstance(schema, dict):
            return None

        own_props = schema.get("properties")
        if isinstance(own_props, dict) and property_name in own_props:
            res = own_props[property_name]
            return res if isinstance(res, dict) else None

        for sub in _ordered_component_sub_schemas(schema):
            if (
                isinstance(sub, dict)
                and "properties" in sub
                and isinstance(sub["properties"], dict)
                and property_name in sub["properties"]
            ):
                res = sub["properties"][property_name]
                return res if isinstance(res, dict) else None
        return None

    def get_property_type(self, component_name: str, property_name: str) -> str | None:
        """Resolves the semantic type (ChildList, Child, Action) of a component property."""
        if (
            self._components_override is None
            and component_name in self._canonical_components
        ):
            return self.type_semantic_kind(
                self.get_parameter_type(component_name, property_name)
            )

        p_schema = self.get_property_schema(component_name, property_name)
        if not p_schema:
            return None

        def _crawl_ref(s: Any, visited: set[int] | None = None) -> str | None:
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
            return next(
                (
                    res
                    for sub_s in combinator_subschemas(s)
                    if (res := _crawl_ref(sub_s, visited)) is not None
                ),
                None,
            )

        return _crawl_ref(p_schema)

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
            unescaped = part.replace("~1", "/").replace("~0", "~")
            current = current.get(unescaped)
        return current

    def accepts_number(self, schema: Any) -> bool:
        """Checks whether a property schema accepts a numeric value by resolving $refs."""
        visited: set[int] = set()

        def _check(s: Any, in_common_types: bool) -> bool:
            if not isinstance(s, dict):
                return False
            obj_id = id(s)
            if obj_id in visited:
                return False
            visited.add(obj_id)

            s_type = s.get("type")
            if s_type in ("number", "integer"):
                return True
            if isinstance(s_type, list) and any(
                t in ("number", "integer") for t in s_type
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
                    if resolved is None:
                        return True
                    if _check(resolved, True):
                        return True
                elif in_common_types and (
                    ref.startswith("#/$defs/") or ref.startswith("#/definitions/")
                ):
                    name = ref[8:] if ref.startswith("#/$defs/") else ref[14:]
                    resolved = self._lookup_common_def(name)
                    if resolved is None:
                        return True
                    if _check(resolved, True):
                        return True
                elif ref.startswith("#/"):
                    resolved = self._resolve_json_pointer(self.catalog, ref)
                    if resolved is None:
                        return True
                    if _check(resolved, False):
                        return True
                elif ref.startswith("catalog.json#/"):
                    resolved = self._resolve_json_pointer(self.catalog, ref[12:])
                    if resolved is None:
                        return True
                    if _check(resolved, False):
                        return True
                else:
                    return True

            for key in ("allOf", "oneOf", "anyOf"):
                subs = s.get(key)
                if isinstance(subs, list):
                    for sub in subs:
                        if _check(sub, in_common_types):
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
            if not any(k in s for k in type_keys):
                return True

            return False

        return _check(schema, False)

    def resolve_item_schema(self, schema: Any) -> dict[str, Any] | None:
        """Resolves the schema of an array's items.

        Follows `$ref` (into both the common types and the catalog document),
        `allOf`, `oneOf` and `anyOf` to find the schema declared at that
        position.

        Args:
            schema: The array's JSON schema.

        Returns:
            The resolved item schema, or None if none is declared.
        """
        return self._resolve_at(schema, None)

    def resolve_property_schema(self, schema: Any, name: str) -> dict[str, Any] | None:
        """Resolves the schema of an object's property.

        Follows `$ref` (into both the common types and the catalog document),
        `allOf`, `oneOf` and `anyOf` to find the schema declared at that
        position, and falls back to `additionalProperties` when the property
        is not declared. A property named `items` is looked up as a property,
        not as the array items.

        Args:
            schema: The object's JSON schema.
            name: The property name.

        Returns:
            The resolved property schema, or None if none is declared.
        """
        return self._resolve_at(schema, name)

    def _resolve_at(self, schema: Any, prop: str | None) -> dict[str, Any] | None:
        """Resolves the schema at a property, or at the array items when `prop` is None."""
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

            for combinator in ("allOf", "oneOf", "anyOf"):
                subs = s.get(combinator)
                if isinstance(subs, list):
                    for sub in subs:
                        found = _resolve(sub, in_common_types)
                        if found:
                            return found

            return None

        return _resolve(schema, False)
