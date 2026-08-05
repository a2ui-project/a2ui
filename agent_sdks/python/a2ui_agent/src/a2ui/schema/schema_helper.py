# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Utility for parsing A2UI component and function catalogs.

Provides dynamic schema crawling to identify component properties, logical function
signatures, and requirements directly from standard catalog JSON schemas.
"""

from typing import Any, Optional, Union

try:
    from a2ui.core.catalog import Catalog
except ImportError:
    Catalog = Any  # type: ignore

from a2ui.schema.catalog import A2uiCatalog


def _sort_component_properties(
    props: dict[str, Any], reqs: list[str], is_checkable: bool
) -> tuple[list[str], list[str]]:
    """Sorts component properties deterministically in a catalog-agnostic manner.

    Ordering Strategy:
    1. Filter out structural protocol properties ('component', 'id').
    2. Separate remaining properties into required and optional sets.
    3. Sort required properties alphabetically.
    4. Sort optional properties alphabetically (excluding 'checks').
    5. Combine sorted required properties, sorted optional properties, and append 'checks' at the end if checkable or defined.
    """
    prop_dict = dict(props)
    has_checks = is_checkable or ("checks" in prop_dict)
    req_set = {str(r) for r in reqs if str(r) not in ["component", "id"]}
    all_prop_keys = [k for k in prop_dict if k not in ["component", "id", "checks"]]

    req_props = sorted([k for k in all_prop_keys if k in req_set])
    opt_props = sorted([k for k in all_prop_keys if k not in req_set])

    result = req_props + opt_props
    if has_checks:
        result.append("checks")

    return result, sorted(list(req_set))


def _sort_function_properties(
    props: dict[str, Any], reqs: list[str]
) -> tuple[list[str], list[str]]:
    """Sorts function argument properties deterministically in a catalog-agnostic manner."""
    req_set = {str(r) for r in reqs if str(r) not in ["component", "id"]}
    fn_prop_keys = list(props.keys())

    req_props = sorted([k for k in fn_prop_keys if k in req_set])
    opt_props = sorted([k for k in fn_prop_keys if k not in req_set])

    return req_props + opt_props, sorted(list(req_set))


class CatalogSchemaHelper:
    """Dynamic schema crawler for A2UI catalogs.

    Resolves component and function properties in deterministic sorted order
    (required properties first alphabetically, followed by optional properties alphabetically)
    to support positional parameter mapping for compact generative notations.

    Attributes:
        catalog: The parsed catalog JSON dictionary.
        components: A dictionary mapping component names to their catalog schemas.
        functions: A dictionary mapping function names to their catalog schemas.
    """

    def __init__(
        self,
        catalog: Union[Catalog[Any, Any], A2uiCatalog],
    ):
        """Initializes the helper with a Catalog or an A2uiCatalog.

        Args:
            catalog: A Catalog or an A2uiCatalog.
        """
        if isinstance(catalog, A2uiCatalog):
            self.catalog_model = catalog.core_catalog
        elif isinstance(catalog, Catalog):
            self.catalog_model = catalog
        else:
            raise TypeError(f"Unsupported catalog type: {type(catalog)}")

        self.catalog = self.catalog_model.catalog_schema or {}
        self.components = {
            name: comp.schema for name, comp in self.catalog_model.components.items()
        }
        self.functions = {
            name: fn.schema for name, fn in self.catalog_model.functions.items()
        }
        self.component_properties: dict[str, list[str]] = {}
        self.component_required: dict[str, list[str]] = {}
        self.component_is_checkable: dict[str, bool] = {}
        self.component_property_enums: dict[tuple[str, str], list[str]] = {}
        self.function_properties: dict[str, list[str]] = {}
        self.function_required: dict[str, list[str]] = {}
        self._load_mappings()

    def _load_mappings(self) -> None:
        """Crawls the component and function schemas to build internal mappings."""
        for name, schema in self.components.items():
            props: dict[str, Any] = {}
            reqs: list[str] = []
            is_checkable = False

            # Crawl allOf and root schema for properties
            sub_schemas = [schema]
            if (
                isinstance(schema, dict)
                and "allOf" in schema
                and isinstance(schema["allOf"], list)
            ):
                sub_schemas.extend(schema["allOf"])

            for sub in sub_schemas:
                if not isinstance(sub, dict):
                    continue
                if "$ref" in sub and isinstance(sub["$ref"], str):
                    ref = sub["$ref"]
                    if "Checkable" in ref:
                        is_checkable = True
                if "properties" in sub and isinstance(sub["properties"], dict):
                    props.update(sub["properties"])
                    for pk, pv in sub["properties"].items():

                        def _find_enum(s: Any) -> Optional[list[str]]:
                            if isinstance(s, dict):
                                if "enum" in s and isinstance(s["enum"], list):
                                    return [str(x) for x in s["enum"]]
                                for k in ("oneOf", "anyOf", "allOf"):
                                    if k in s and isinstance(s[k], list):
                                        for sub_s in s[k]:
                                            res = _find_enum(sub_s)
                                            if res:
                                                return res
                            return None

                        enum_val = _find_enum(pv)
                        if enum_val:
                            self.component_property_enums[(name, pk)] = enum_val
                if "required" in sub and isinstance(sub["required"], list):
                    reqs.extend([str(r) for r in sub["required"]])

            ordered_keys, reqs_clean = _sort_component_properties(
                props, reqs, is_checkable
            )

            self.component_properties[name] = ordered_keys
            self.component_required[name] = reqs_clean
            self.component_is_checkable[name] = is_checkable

        for name, schema in self.functions.items():
            if not isinstance(schema, dict):
                continue
            args_obj = schema.get("properties", {})
            if isinstance(args_obj, dict):
                args_props = args_obj.get("args", {})
                if isinstance(args_props, dict):
                    props_dict = args_props.get("properties", {})
                    reqs_raw = args_props.get("required", [])
                    if isinstance(props_dict, dict):
                        reqs_list = (
                            [str(r) for r in reqs_raw]
                            if isinstance(reqs_raw, list)
                            else []
                        )
                        fn_ordered_props, fn_reqs_clean = _sort_function_properties(
                            props_dict, reqs_list
                        )
                        self.function_properties[name] = fn_ordered_props
                        self.function_required[name] = fn_reqs_clean

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
    ) -> Optional[dict[str, Any]]:
        """Retrieves the JSON schema for a specific function argument property."""
        fn_schema = self.functions.get(fn_name, {})
        if not isinstance(fn_schema, dict):
            return None
        props_obj = fn_schema.get("properties", {})
        if not isinstance(props_obj, dict):
            return None
        args_obj = props_obj.get("args", {})
        if not isinstance(args_obj, dict):
            return None
        arg_props = args_obj.get("properties", {})
        if not isinstance(arg_props, dict):
            return None
        res = arg_props.get(prop_name)
        return res if isinstance(res, dict) else None

    def get_property_enum(
        self, component_name: str, property_name: str
    ) -> Optional[list[str]]:
        """Returns the list of allowed enum values for a component property, or None."""
        return self.component_property_enums.get((component_name, property_name))

    def get_component_description(self, name: str) -> Optional[str]:
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

    def get_function_description(self, name: str) -> Optional[str]:
        """Retrieves the description of the function from its catalog schema."""
        schema = self.functions.get(name)
        if not schema or not isinstance(schema, dict):
            return None
        desc = schema.get("description")
        return desc if isinstance(desc, str) else None

    def get_property_schema(
        self, component_name: str, property_name: str
    ) -> Optional[dict[str, Any]]:
        """Crawls all sub-schemas of a component to retrieve a property's schema definition."""
        schema = self.components.get(component_name)
        if not schema or not isinstance(schema, dict):
            return None

        sub_schemas = [schema]
        if "allOf" in schema and isinstance(schema["allOf"], list):
            sub_schemas.extend(schema["allOf"])

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

    def get_property_type(
        self, component_name: str, property_name: str
    ) -> Optional[str]:
        """Resolves the semantic type (ChildList, Child, Action) of a component property from schema $ref."""
        p_schema = self.get_property_schema(component_name, property_name)
        if not p_schema:
            return None

        def _crawl_ref(s: Any) -> Optional[str]:
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
