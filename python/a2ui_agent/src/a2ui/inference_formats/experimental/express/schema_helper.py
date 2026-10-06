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

"""Utility for parsing A2UI component and function catalogs.

Provides dynamic schema crawling to identify component properties, logical function
signatures, and requirements directly from standard catalog JSON schemas.
"""

from typing import Any

from a2ui.core import CatalogApi
from a2ui.schema.schema_helper import (
    CatalogSchemaHelper as _BaseCatalogSchemaHelper,
)


class CatalogSchemaHelper(_BaseCatalogSchemaHelper):
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
        super().__init__(catalog)

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
            sub_schemas = []
            if "allOf" in schema:
                specific = []
                common = []
                for sub in schema["allOf"]:
                    if (
                        isinstance(sub, dict)
                        and "properties" in sub
                        and "component" in sub["properties"]
                    ):
                        specific.append(sub)
                    else:
                        common.append(sub)
                sub_schemas.extend(specific)
                sub_schemas.extend(common)
            sub_schemas.append(schema)

            for sub in sub_schemas:
                if not isinstance(sub, dict):
                    continue
                if "$ref" in sub:
                    ref = sub["$ref"]
                    if "Checkable" in ref:
                        is_checkable = True
                if "properties" in sub:
                    props.update(sub["properties"])
                    for pk, pv in sub["properties"].items():

                        def _find_enum(s):
                            if isinstance(s, dict):
                                if "enum" in s:
                                    return s["enum"]
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
                if "required" in sub:
                    reqs.extend(sub["required"])

            # Filter out structural properties component and id
            ordered_keys = []
            for k in props:
                if k not in ["component", "id"]:
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
