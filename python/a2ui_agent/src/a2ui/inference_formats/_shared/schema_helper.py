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
    """Returns component sub-schemas with specific definitions before common mixins."""
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
        self.catalog = inline_local_refs(
            catalog_schema, catalog_schema, peers=catalog.peer_catalogs
        )
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
            props = {}
            reqs = []
            is_checkable = False

            # Crawl allOf and root schema for properties.
            # Prioritize specific component definition schemas over common mixins
            # (such as CatalogComponentCommon which contains 'weight') so positional
            # argument order is consistent across protocol versions.
            sub_schemas = _ordered_component_sub_schemas(schema)

            for sub in sub_schemas:
                if not isinstance(sub, dict):
                    continue
                if "$ref" in sub:
                    ref = sub["$ref"]
                    if "Checkable" in ref:
                        is_checkable = True
                if "properties" in sub and isinstance(sub["properties"], dict):
                    for pk, pv in sub["properties"].items():
                        if pk not in props:
                            props[pk] = pv
                            enum_val = _find_enum(pv)
                            if enum_val:
                                self.component_property_enums[(name, pk)] = enum_val
                if "required" in sub and isinstance(sub["required"], list):
                    for r in sub["required"]:
                        if r not in reqs:
                            reqs.append(r)

            # Filter out structural properties component, id, and catalogId
            ordered_keys = []
            for k in props:
                if k not in ["component", "id", "catalogId"]:
                    ordered_keys.append(k)

            # If it's checkable, add checks at the end
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
        """Crawls all sub-schemas of a component to retrieve a property's schema definition."""
        schema = self.components.get(component_name)
        if not schema or not isinstance(schema, dict):
            return None

        sub_schemas = _ordered_component_sub_schemas(schema)

        for sub in sub_schemas:
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
