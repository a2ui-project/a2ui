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

"""Component reference map and schema analysis for A2UI catalogs.

Precomputes single-child, list-child, and nested child slot specifications from
component schemas to enable O(1) reference lookups during validation and tree traversal.
"""

from __future__ import annotations

import types
from typing import (
    Any,
    Final,
    Iterator,
    Optional,
    Union,
    get_args,
    get_origin,
)
from pydantic import BaseModel
from ..schema.common_types import (
    ComponentReference,
    SingleReference,
    ListReference,
    TemplateChildList,
)

# Reference property keys and schema type identifiers
COMPONENT_ID_KEY: Final[str] = "componentId"
CHILD_KEY: Final[str] = "child"
CHILDREN_KEY: Final[str] = "children"

COMPONENT_ID_TYPE: Final[str] = "ComponentId"
CHILD_TYPE: Final[str] = "Child"
CHILD_LIST_TYPE: Final[str] = "ChildList"


def _is_single_child_ref(ref: str) -> bool:
    """Checks if a $ref URI points to a single child reference definition (ComponentId or Child)."""
    if not isinstance(ref, str):
        return False
    return ref.endswith(f"/{COMPONENT_ID_TYPE}") or ref.endswith(f"/{CHILD_TYPE}")


def _is_child_list_ref(ref: str) -> bool:
    """Checks if a $ref URI points to a ChildList reference definition."""
    if not isinstance(ref, str):
        return False
    return ref.endswith(f"/{CHILD_LIST_TYPE}")


def extract_child_refs_from_val(val: Any) -> Iterator[tuple[str, str]]:
    """Recursively extracts referenced child component IDs and their relative sub-paths from a value.

    Args:
        val: The property value to inspect, which may be a single component ID string,
            a SingleReference, a TemplateChildList, a list of child references/objects,
            or a dictionary with nested child slots.

    Yields:
        Tuples of (referenced_component_id, relative_sub_path), where:
        - referenced_component_id is the non-empty string ID of the referenced component.
        - relative_sub_path is the relative property path inside `val` where the reference was
          found (e.g. "" for direct values, "componentId" for templates, "[0]" for arrays,
          or "[0].child" for nested arrays of objects).
    """
    if not val:
        return
    if isinstance(val, SingleReference):
        if str(val):
            yield str(val), ""
    elif isinstance(val, TemplateChildList):
        if isinstance(val.component_id, str) and val.component_id:
            yield str(val.component_id), COMPONENT_ID_KEY
    elif isinstance(val, str):
        if val:
            yield val, ""
    elif isinstance(val, list):
        for idx, item in enumerate(val):
            for ref_id, sub_path in extract_child_refs_from_val(item):
                yield ref_id, f"[{idx}]{'.' + sub_path if sub_path else ''}"
    elif isinstance(val, dict):
        if (
            COMPONENT_ID_KEY in val
            and isinstance(val[COMPONENT_ID_KEY], str)
            and val[COMPONENT_ID_KEY]
        ):
            yield val[COMPONENT_ID_KEY], COMPONENT_ID_KEY
        elif CHILD_KEY in val and isinstance(val[CHILD_KEY], str) and val[CHILD_KEY]:
            yield val[CHILD_KEY], CHILD_KEY
        else:
            for sub_k, sub_v in val.items():
                for ref_id, sub_path in extract_child_refs_from_val(sub_v):
                    yield ref_id, f"{sub_k}{'.' + sub_path if sub_path else ''}"


def _is_pydantic_single_ref(typ: Any) -> bool:
    if typ is None:
        return False
    if isinstance(typ, type) and issubclass(typ, SingleReference):
        return True
    origin = get_origin(typ)
    if origin is Union or origin is types.UnionType:
        return any(_is_pydantic_single_ref(arg) for arg in get_args(typ))
    return False


def _is_pydantic_list_ref(typ: Any) -> tuple[bool, set[str]]:
    if typ is None:
        return False, set()
    if isinstance(typ, type) and issubclass(typ, (ListReference, TemplateChildList)):
        return True, set()
    origin = get_origin(typ)
    if origin is list:
        args = get_args(typ)
        if args:
            elem = args[0]
            if isinstance(elem, type):
                if issubclass(elem, SingleReference):
                    return True, set()
                if issubclass(elem, BaseModel):
                    nested = set()
                    for f_name, f_info in elem.model_fields.items():
                        alias = f_info.alias or f_name
                        if _is_pydantic_single_ref(f_info.annotation):
                            nested.add(alias)
                    if nested:
                        return True, nested
    if origin is Union or origin is types.UnionType:
        for arg in get_args(typ):
            is_l, nested = _is_pydantic_list_ref(arg)
            if is_l:
                return True, nested
    return False, set()


def _is_single_child_json_schema(schema: Any) -> bool:
    if not isinstance(schema, dict):
        return False
    ref = schema.get("$ref", "")
    if isinstance(ref, str) and _is_single_child_ref(ref):
        return True
    for comb in ("allOf", "oneOf", "anyOf"):
        if comb in schema and isinstance(schema[comb], list):
            if any(_is_single_child_json_schema(sub) for sub in schema[comb]):
                return True
    return False


def _is_child_list_json_schema(schema: Any) -> bool:
    if not isinstance(schema, dict):
        return False
    ref = schema.get("$ref", "")
    if isinstance(ref, str) and _is_child_list_ref(ref):
        return True
    for comb in ("allOf", "oneOf", "anyOf"):
        if comb in schema and isinstance(schema[comb], list):
            if any(_is_child_list_json_schema(sub) for sub in schema[comb]):
                return True
    return False


def _resolve_schema_ref(
    ref: str,
    local_schema: dict[str, Any],
    catalog_schema: dict[str, Any] | None,
    visited: set[str] | None = None,
) -> dict[str, Any] | None:
    """Resolves an internal JSON Pointer reference (`#/path/to/def`) within the local or catalog schema.

    Args:
        ref: The JSON pointer URI string starting with `#/` (e.g. `#/$defs/TabItem` or `#/components/MyCard`).
        local_schema: The current component schema containing potential local `$defs`.
        catalog_schema: The enclosing catalog schema containing shared root `$defs` or component definitions.
        visited: A set of already visited reference URIs to prevent circular reference cycles.

    Returns:
        The resolved sub-schema dictionary if successfully located, or None if the reference cannot be resolved.
    """
    if not isinstance(ref, str) or not ref.startswith("#/"):
        return None
    visited = visited or set()
    if ref in visited:
        return None
    visited.add(ref)

    parts = ref.split("/")[1:]
    if parts[0] == "$defs":
        local_defs = local_schema.get("$defs", {})
        cur = local_defs
        for p in parts[1:]:
            if isinstance(cur, dict):
                cur = cur.get(p)
            else:
                cur = None
                break
        if isinstance(cur, dict):
            return cur

    if catalog_schema:
        cur = catalog_schema
        for p in parts:
            if isinstance(cur, dict):
                cur = cur.get(p)
            else:
                cur = None
                break
        if isinstance(cur, dict):
            return cur
    return None


class ComponentRefSpec:
    """Stores pre-analyzed child reference field metadata for a component."""

    def __init__(
        self,
        single_refs: set[str] | None = None,
        list_refs: set[str] | None = None,
        nested_refs: dict[str, set[str]] | None = None,
    ):
        self.single_refs: set[str] = set(single_refs or set())
        self.list_refs: set[str] = set(list_refs or set())
        self.nested_refs: dict[str, set[str]] = dict(nested_refs or {})

    def __eq__(self, other: Any) -> bool:
        if not isinstance(other, ComponentRefSpec):
            return False
        return (
            self.single_refs == other.single_refs
            and self.list_refs == other.list_refs
            and self.nested_refs == other.nested_refs
        )

    def __repr__(self) -> str:
        return (
            f"ComponentRefSpec(single_refs={self.single_refs!r}, "
            f"list_refs={self.list_refs!r}, nested_refs={self.nested_refs!r})"
        )

    def is_child_prop(self, key: str) -> bool:
        """Returns True if the given property key is a configured child reference."""
        return key in self.single_refs or key in self.list_refs

    def extract_child_references(
        self, props: dict[str, Any]
    ) -> Iterator[tuple[str, str]]:
        """Extracts (component_id, property_path) pairs from properties according to this spec."""
        if not isinstance(props, dict):
            return

        for key in self.single_refs:
            if key in props:
                val = props[key]
                for ref_id, sub_path in extract_child_refs_from_val(val):
                    full_path = f"{key}.{sub_path}" if sub_path else key
                    yield ref_id, full_path

        for key in self.list_refs:
            if key in props:
                val = props[key]
                if isinstance(val, list):
                    nested_keys = self.nested_refs.get(key)
                    for idx, item in enumerate(val):
                        if isinstance(item, str):
                            if item:
                                yield item, f"{key}[{idx}]"
                        elif isinstance(item, dict):
                            if (
                                COMPONENT_ID_KEY in item
                                and isinstance(item[COMPONENT_ID_KEY], str)
                                and item[COMPONENT_ID_KEY]
                            ):
                                yield item[
                                    COMPONENT_ID_KEY
                                ], f"{key}[{idx}].{COMPONENT_ID_KEY}"
                            elif nested_keys:
                                for sub_k in nested_keys:
                                    if (
                                        sub_k in item
                                        and isinstance(item[sub_k], str)
                                        and item[sub_k]
                                    ):
                                        yield item[sub_k], f"{key}[{idx}].{sub_k}"
                            else:
                                for ref_id, sub_path in extract_child_refs_from_val(
                                    item
                                ):
                                    yield (
                                        ref_id,
                                        f"{key}[{idx}].{sub_path}"
                                        if sub_path
                                        else f"{key}[{idx}]",
                                    )
                        elif isinstance(item, ComponentReference):
                            for ref_id, sub_path in extract_child_refs_from_val(item):
                                yield (
                                    ref_id,
                                    f"{key}[{idx}].{sub_path}"
                                    if sub_path
                                    else f"{key}[{idx}]",
                                )
                elif isinstance(val, str):
                    if val:
                        yield val, key
                elif isinstance(val, dict):
                    if (
                        COMPONENT_ID_KEY in val
                        and isinstance(val[COMPONENT_ID_KEY], str)
                        and val[COMPONENT_ID_KEY]
                    ):
                        yield val[COMPONENT_ID_KEY], f"{key}.{COMPONENT_ID_KEY}"
                    else:
                        for ref_id, sub_path in extract_child_refs_from_val(val):
                            yield ref_id, f"{key}.{sub_path}" if sub_path else key
                elif isinstance(val, ComponentReference):
                    for ref_id, sub_path in extract_child_refs_from_val(val):
                        yield ref_id, f"{key}.{sub_path}" if sub_path else key


def analyze_child_ref_schema(
    schema: Any, catalog_schema: dict[str, Any] | None = None
) -> ComponentRefSpec:
    """Analyzes a component's Pydantic model or JSON Schema strictly per A2UI protocol ($ref / SingleReference / ListReference)."""
    single_refs: set[str] = set()
    list_refs: set[str] = set()
    nested_refs: dict[str, set[str]] = {}

    if not schema:
        return ComponentRefSpec(single_refs, list_refs, nested_refs)

    # 1. Pydantic BaseModel
    if isinstance(schema, type) and issubclass(schema, BaseModel):
        for field_name, field_info in schema.model_fields.items():
            if field_name in ("id", "component"):
                continue
            prop_key = field_info.alias or field_name
            if _is_pydantic_single_ref(field_info.annotation):
                single_refs.add(prop_key)
            else:
                is_l, nested = _is_pydantic_list_ref(field_info.annotation)
                if is_l:
                    list_refs.add(prop_key)
                    if nested:
                        nested_refs[prop_key] = nested

        return ComponentRefSpec(single_refs, list_refs, nested_refs)

    # 2. JSON Schema Dict
    if isinstance(schema, dict):

        def inspect_schema(sub_s: dict[str, Any]) -> None:
            if not isinstance(sub_s, dict):
                return

            for comb in ("allOf", "anyOf", "oneOf"):
                if comb in sub_s and isinstance(sub_s[comb], list):
                    for branch in sub_s[comb]:
                        inspect_schema(branch)

            if "$ref" in sub_s:
                resolved = _resolve_schema_ref(sub_s["$ref"], schema, catalog_schema)
                if resolved:
                    inspect_schema(resolved)

            if "properties" in sub_s and isinstance(sub_s["properties"], dict):
                for prop_name, prop_schema in sub_s["properties"].items():
                    if prop_name in ("id", "component"):
                        continue

                    if _is_single_child_json_schema(prop_schema):
                        single_refs.add(prop_name)
                        continue

                    if _is_child_list_json_schema(prop_schema):
                        list_refs.add(prop_name)
                        continue

                    target_schema = prop_schema
                    if isinstance(target_schema, dict) and "$ref" in target_schema:
                        resolved = _resolve_schema_ref(
                            target_schema["$ref"], schema, catalog_schema
                        )
                        if resolved:
                            target_schema = resolved

                    if isinstance(target_schema, dict):
                        if (
                            target_schema.get("type") == "array"
                            or "items" in target_schema
                        ):
                            items = target_schema.get("items")
                            if isinstance(items, dict):
                                if "$ref" in items:
                                    resolved_items = _resolve_schema_ref(
                                        items["$ref"], schema, catalog_schema
                                    )
                                    if resolved_items:
                                        items = resolved_items

                                if _is_single_child_json_schema(
                                    items
                                ) or _is_child_list_json_schema(items):
                                    list_refs.add(prop_name)
                                    continue
                                elif "properties" in items and isinstance(
                                    items["properties"], dict
                                ):
                                    for sub_k, sub_schema in items[
                                        "properties"
                                    ].items():
                                        if _is_single_child_json_schema(sub_schema):
                                            list_refs.add(prop_name)
                                            nested_refs.setdefault(
                                                prop_name, set()
                                            ).add(sub_k)

        inspect_schema(schema)
        return ComponentRefSpec(single_refs, list_refs, nested_refs)

    return ComponentRefSpec(single_refs, list_refs, nested_refs)


def build_component_ref_map(catalog: Any) -> dict[str, ComponentRefSpec]:
    """Builds a mapping from component name to ComponentRefSpec for all components in the catalog."""
    ref_map: dict[str, ComponentRefSpec] = {}
    if not catalog or not hasattr(catalog, "components"):
        return ref_map

    catalog_schema = getattr(catalog, "catalog_schema", None) or getattr(
        catalog, "schema", None
    )
    comps = catalog.components
    comp_list = comps.values() if isinstance(comps, dict) else comps
    for comp in comp_list:
        name = getattr(comp, "name", None)
        if not name:
            continue
        target = getattr(comp, "model_class", None) or getattr(comp, "schema", None)
        ref_map[name] = analyze_child_ref_schema(target, catalog_schema=catalog_schema)
    return ref_map
