# Copyright 2026 Google LLC
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

from typing import Any, Dict, List, Optional, Set, Tuple
from ..schema.constants import CATALOG_COMPONENTS_KEY
from .catalog import CatalogApi


class JsonCatalog(CatalogApi):
    """A Catalog subclass representing JSON-based catalog specifications.

    This is specifically designed for server-side inference prompt building and
    dynamic validation checks where concrete component Pydantic model classes are
    not pre-compiled or loaded.
    """

    def __init__(
        self,
        spec_version: str,
        catalog_schema: Dict[str, Any],
        catalog_id: Optional[str] = None,
        common_types_schema: Optional[Dict[str, Any]] = None,
    ):
        if not catalog_id:
            catalog_id = catalog_schema.get("catalogId")
        if not catalog_id:
            raise ValueError("catalog_id must be provided or exist in catalog_schema.")
        super().__init__(
            spec_version=spec_version,
            catalog_id=catalog_id,
        )
        self.catalog_schema = catalog_schema
        self.common_types_schema = common_types_schema

    def get_component_schema(self, comp_type: str) -> Optional[Dict[str, Any]]:
        """Retrieves the raw JSON schema representing a component's properties."""
        components = self.catalog_schema.get("components", {})
        return components.get(comp_type)

    def get_function_schema(self, func_name: str) -> Optional[Dict[str, Any]]:
        """Retrieves the raw JSON schema representing a function's arguments and returnType."""
        functions = self.catalog_schema.get("functions", {})
        return functions.get(func_name)

    def get_theme_schema(self) -> Optional[Dict[str, Any]]:
        return self.catalog_schema.get("theme")

    def extract_ref_fields(self) -> Dict[str, Tuple[Set[str], Set[str]]]:
        """
        Parses the catalog/schema to identify which component properties reference other components.
        Returns a map: { component_name: (set_of_single_ref_fields, set_of_list_ref_fields) }
        """

        all_components = self.catalog_schema.get(CATALOG_COMPONENTS_KEY, {})

        # Helper to check if a property schema looks like a ComponentId reference
        def is_component_id_ref(prop_schema: Dict[str, Any]) -> bool:
            if not isinstance(prop_schema, dict):
                return False
            ref = prop_schema.get("$ref", "")
            if isinstance(ref, str) and ref.endswith("$defs/ComponentId"):
                return True

            # Check oneOf/anyOf for refs
            for key in ["oneOf", "anyOf", "allOf"]:
                if key in prop_schema:
                    for sub in prop_schema[key]:
                        if is_component_id_ref(sub):
                            return True
            return False

        def is_child_list_ref(prop_schema: Dict[str, Any]) -> bool:
            if not isinstance(prop_schema, dict):
                return False
            ref = prop_schema.get("$ref", "")
            if isinstance(ref, str) and ref.endswith("$defs/ChildList"):
                return True

            # Check oneOf/anyOf for refs
            for key in ["oneOf", "anyOf", "allOf"]:
                if key in prop_schema:
                    for sub in prop_schema[key]:
                        if is_child_list_ref(sub):
                            return True
            return False

        def resolve_ref(schema: Any, visited: Optional[Set[str]] = None) -> Any:
            if not isinstance(schema, dict) or "$ref" not in schema:
                return schema
            visited = visited or set()
            ref = schema.get("$ref", "")
            if (
                not isinstance(ref, str)
                or not ref.startswith("#/")
                or ref in visited
                or ref.endswith("/ComponentId")
                or ref.endswith("/ChildList")
            ):
                return schema
            visited.add(ref)

            parts = ref.split("/")[1:]
            cur = self.catalog_schema
            for p in parts:
                if isinstance(cur, dict):
                    cur = cur.get(p, {})
                else:
                    return schema
            if isinstance(cur, dict) and cur:
                return resolve_ref(cur, visited)
            return schema

        ref_map = {}
        for comp_name, comp_schema in all_components.items():
            single_refs = set()
            list_refs = set()

            def extract_from_props(comp_schema: Dict[str, Any]):
                if not isinstance(comp_schema, dict):
                    return
                props = comp_schema.get("properties", {})
                for prop_name, prop_schema in props.items():
                    resolved_prop = resolve_ref(prop_schema)
                    if is_component_id_ref(resolved_prop):
                        single_refs.add(prop_name)
                    elif is_child_list_ref(resolved_prop):
                        list_refs.add(prop_name)
                    else:
                        if (
                            resolved_prop.get("type") == "array"
                            and "items" in resolved_prop
                        ):
                            items = resolve_ref(resolved_prop["items"])
                            if isinstance(items, dict):
                                if is_component_id_ref(items) or is_child_list_ref(
                                    items
                                ):
                                    list_refs.add(prop_name)
                                elif "properties" in items:
                                    for sub_schema in items["properties"].values():
                                        resolved_sub = resolve_ref(sub_schema)
                                        if is_component_id_ref(
                                            resolved_sub
                                        ) or is_child_list_ref(resolved_sub):
                                            list_refs.add(prop_name)
                                            break

                for key in ["allOf", "oneOf", "anyOf"]:
                    if key in comp_schema:
                        for sub in comp_schema[key]:
                            extract_from_props(sub)

            extract_from_props(comp_schema)

            if single_refs or list_refs:
                ref_map[comp_name] = (single_refs, list_refs)

        return ref_map
