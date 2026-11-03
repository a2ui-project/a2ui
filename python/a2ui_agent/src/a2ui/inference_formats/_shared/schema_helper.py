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

import re
from typing import Any

from a2ui.core import (
    A2uiCatalogError,
    Catalog,
    CatalogApi,
    get_common_types_schema_map,
    inline_local_refs,
    to_protocol_version,
)

_COMMON_DEF_RE = re.compile(r"(?:^|/)common_types\.json#/(?:\$defs|definitions)/(\w+)$")


def _common_def_name(ref: Any) -> str | None:
    """Returns the common type a `$ref` names, or None if it is not one."""
    if not isinstance(ref, str):
        return None
    m = _COMMON_DEF_RE.search(ref)
    return m.group(1) if m else None


def is_action_slot(schema: Any) -> bool:
    """Checks whether a property schema is an Action slot.

    A property is an action slot when its schema references the common `Action`
    def, directly or through `oneOf`/`anyOf`/`allOf`.

    Args:
        schema: The property JSON schema to inspect.

    Returns:
        True if the schema references the common `Action` type.
    """
    if not isinstance(schema, dict):
        return False
    if _common_def_name(schema.get("$ref")) == "Action":
        return True
    for key in ("allOf", "oneOf", "anyOf"):
        subs = schema.get(key)
        if isinstance(subs, list) and any(is_action_slot(sub) for sub in subs):
            return True
    return False


def _find_enum(s: Any) -> list[Any] | None:
    """Returns the first `enum` list found in a schema or its combinators."""
    if isinstance(s, dict):
        enum = s.get("enum")
        if isinstance(enum, list):
            return enum
        for k in ("oneOf", "anyOf", "allOf"):
            if k in s and isinstance(s[k], list):
                for sub_s in s[k]:
                    res = _find_enum(sub_s)
                    if res:
                        return res
    return None


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

    def _visit(node: Any, is_root: bool = False) -> None:
        if not isinstance(node, dict):
            return
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


class CatalogSchemaHelper:
    """Dynamic schema crawler for A2UI catalogs.

    Resolves component and function properties in strict schema definition order
    to support positional parameter mapping for compact generative notations.

    Attributes:
        catalog: The parsed catalog JSON dictionary.
        components: A dictionary mapping component names to their catalog schemas.
        functions: A dictionary mapping function names to their catalog schemas.
    """

    def __init__(
        self,
        catalog: CatalogApi,
    ):
        """Initializes the helper with a Catalog.

        Args:
            catalog: A Catalog instance.
        """
        if not isinstance(catalog, Catalog):
            raise TypeError(f"Unsupported catalog type: {type(catalog)}")
        self.catalog_model = catalog

        # Both model-backed and loaded catalogs keep their local `$defs` (such
        # as `CatalogComponentCommon`) in `to_json()`, while `validation_schema`
        # flattens `allOf` mixins. Inlining local refs on `to_json()` lets the
        # crawler read both kinds of catalog the same way while references to
        # common types, such as `Checkable`, stay intact.
        catalog_schema = dict(catalog.to_json() or {})
        self.catalog = inline_local_refs(catalog_schema, catalog_schema)
        try:
            self.common_types: dict[str, Any] = get_common_types_schema_map(
                to_protocol_version(catalog.protocol_version)
            )
            self.common_types_loaded: bool = True
        except (A2uiCatalogError, ValueError):
            self.common_types = {}
            self.common_types_loaded = False
        self.components = dict(self.catalog.get("components", {}))
        self.functions = dict(self.catalog.get("functions", {}))
        self.component_properties: dict[str, list[str]] = {}
        self.component_required: dict[str, list[str]] = {}
        self.component_is_checkable: dict[str, bool] = {}
        self.component_property_enums: dict[tuple[str, str], list[str]] = {}
        self.function_properties: dict[str, list[str]] = {}
        self.function_required: dict[str, list[str]] = {}
        self._load_mappings()

    def _load_mappings(self) -> None:
        """Crawls the component and function schemas to build internal mappings."""
        self.component_properties = {}
        self.component_required = {}
        self.component_is_checkable = {}
        self.component_property_enums = {}

        for name, schema in self.components.items():
            props: dict[str, Any] = {}
            reqs: list[str] = []
            is_checkable = False

            # Crawl the root schema and its nested allOf for properties.
            # Prioritize specific component definition schemas over common mixins
            # (such as CatalogComponentCommon which contains 'weight') so positional
            # argument order is consistent across protocol versions. A property
            # keeps the position of its first occurrence; its schema comes from
            # `get_property_schema`, where the component's own definition wins.
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

            # Filter out structural properties component, id, and catalogId,
            # and checks, which a checkable component lists last.
            excluded = {"component", "id", "catalogId"}
            if is_checkable:
                excluded.add("checks")
            ordered_keys = [k for k in props if k not in excluded]

            # The enum comes from the definition that wins for the property:
            # the component's own one over an `allOf` sub-schema, so an
            # inherited enum does not outlive an own definition without one.
            for k in ordered_keys:
                enum_val = _find_enum(self.get_property_schema(name, k))
                if enum_val:
                    self.component_property_enums[(name, k)] = enum_val

            # If it's checkable, add checks at the end, once, even when the
            # component also defines it itself.
            if is_checkable:
                ordered_keys.append("checks")

            self.component_properties[name] = ordered_keys
            self.component_required[name] = reqs
            self.component_is_checkable[name] = is_checkable

        self.function_properties = {}
        self.function_required = {}

        for name, schema in self.functions.items():
            sub_schemas = [schema]
            if "allOf" in schema:
                sub_schemas.extend(schema["allOf"])

            props = {}
            reqs = []
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
            self.function_properties[name] = list(props.keys())
            self.function_required[name] = reqs

    def get_component_properties(self, name: str) -> list[str]:
        """Returns the ordered properties of the specified component."""
        return self.component_properties.get(name, [])

    def get_component_required(self, name: str) -> list[str]:
        """Returns the list of required properties for the specified component."""
        return self.component_required.get(name, [])

    def is_checkable(self, name: str) -> bool:
        """Returns whether the specified component supports client-side checks."""
        return self.component_is_checkable.get(name, False)

    def get_function_properties(self, name: str) -> list[str]:
        """Returns the ordered properties of the specified function's arguments."""
        return self.function_properties.get(name, [])

    def get_function_required(self, name: str) -> list[str]:
        """Returns the list of required argument properties for the function."""
        return self.function_required.get(name, [])

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
        fn_schema = self.functions.get(fn_name, {})
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
    ) -> list[str] | None:
        """Returns the list of allowed enum values for a component property, or None."""
        return self.component_property_enums.get((component_name, property_name))

    def get_component_description(self, name: str) -> str | None:
        """Retrieves the description of the component from its catalog schema."""
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
        """Retrieves the description of the function from its catalog schema."""
        schema = self.functions.get(name)
        if not schema or not isinstance(schema, dict):
            return None
        desc = schema.get("description")
        return desc if isinstance(desc, str) else None

    def get_property_schema(
        self, component_name: str, property_name: str
    ) -> dict[str, Any] | None:
        """Crawls all sub-schemas of a component to retrieve a property's schema definition.

        The component's own definition wins over its `allOf` sub-schemas, which
        are searched, including nested ones, in the same order that
        `get_component_properties` lists their properties.
        """
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
        """Resolves the semantic type (ChildList, Child, Action) of a component property from schema $ref."""
        p_schema = self.get_property_schema(component_name, property_name)
        if not p_schema:
            return None

        def _crawl_ref(s: Any) -> str | None:
            if isinstance(s, dict):
                if "$ref" in s and isinstance(s["$ref"], str):
                    ref = s["$ref"]
                    if "ChildList" in ref:
                        return "ChildList"
                    if "Child" in ref or "ComponentId" in ref:
                        return "Child"
                    if "Action" in ref:
                        return "Action"
                for k in ("oneOf", "anyOf", "allOf"):
                    if k in s and isinstance(s[k], list):
                        for sub_s in s[k]:
                            res = _crawl_ref(sub_s)
                            if res:
                                return res
            return None

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
                def_name = _common_def_name(ref)
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
