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

import json
from typing import Optional


class CatalogSchemaHelper:
  """Dynamic schema crawler for A2UI catalogs.

  Resolves component and function properties in strict schema definition order
  to support positional parameter mapping for compact generative notations.

  Attributes:
      catalog_path: The absolute filesystem path to the catalog JSON file.
      catalog: The parsed catalog JSON dictionary.
      components: A dictionary mapping component names to their catalog schemas.
      functions: A dictionary mapping function names to their catalog schemas.
  """

  def __init__(self, catalog_path: str):
    """Initializes the helper by loading and parsing the catalog file.

    Args:
        catalog_path: The absolute filesystem path to the catalog JSON file.
    """
    self.catalog_path = catalog_path
    with open(catalog_path, "r", encoding="utf-8") as f:
      self.catalog = json.load(f)
    self.components = self.catalog.get("components", {})
    self.functions = self.catalog.get("functions", {})
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

      # Crawl allOf and root schema for properties
      sub_schemas = [schema]
      if "allOf" in schema:
        sub_schemas.extend(schema["allOf"])

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
      args_obj = schema.get("properties", {}).get("args", {})
      props = args_obj.get("properties", {})
      reqs = args_obj.get("required", [])
      self.function_properties[name] = list(props.keys())
      self.function_required[name] = reqs

  def get_component_properties(self, name: str) -> list[str]:
    """Returns the ordered properties of the specified component.

    Args:
        name: The catalog name of the component.

    Returns:
        A list of property keys in their schema definition order.
    """
    return self.component_properties.get(name, [])

  def get_component_required(self, name: str) -> list[str]:
    """Returns the list of required properties for the specified component.

    Args:
        name: The catalog name of the component.

    Returns:
        A list of property keys that are required.
    """
    return self.component_required.get(name, [])

  def is_checkable(self, name: str) -> bool:
    """Returns whether the specified component supports client-side checks.

    Args:
        name: The catalog name of the component.

    Returns:
        Whether the component implements the Checkable interface.
    """
    return self.component_is_checkable.get(name, False)

  def get_function_properties(self, name: str) -> list[str]:
    """Returns the ordered properties of the specified function's arguments.

    Args:
        name: The catalog name of the function.

    Returns:
        A list of function parameter names in their schema definition order.
    """
    return self.function_properties.get(name, [])

  def get_function_required(self, name: str) -> list[str]:
    """Returns the list of required argument properties for the function.

    Args:
        name: The catalog name of the function.

    Returns:
        A list of function parameter names that are required.
    """
    return self.function_required.get(name, [])

  def get_function_property_schema(
      self, fn_name: str, prop_name: str
  ) -> Optional[dict]:
    """Retrieves the JSON schema for a specific function argument property.

    Args:
        fn_name: The catalog name of the function.
        prop_name: The argument property key.

    Returns:
        The JSON schema dictionary for the property, or None.
    """
    fn_schema = self.functions.get(fn_name, {})
    return (
        fn_schema.get("properties", {})
        .get("args", {})
        .get("properties", {})
        .get(prop_name)
    )

  def get_property_enum(
      self, component_name: str, property_name: str
  ) -> Optional[list[str]]:
    """Returns the list of allowed enum values for a component property, or None.

    Args:
        component_name: The catalog name of the component.
        property_name: The property key name.

    Returns:
        A list of allowed enum string values, or None if not restricted.
    """
    return self.component_property_enums.get((component_name, property_name))

  def get_component_description(self, name: str) -> Optional[str]:
    """Retrieves the description of the component from its catalog schema."""
    schema = self.components.get(name)
    if not schema:
      return None
    if "description" in schema:
      return schema["description"]
    if "allOf" in schema:
      for sub in schema["allOf"]:
        if isinstance(sub, dict) and "description" in sub:
          return sub["description"]
    return None

  def get_function_description(self, name: str) -> Optional[str]:
    """Retrieves the description of the function from its catalog schema."""
    schema = self.functions.get(name)
    if not schema:
      return None
    return schema.get("description")

  def get_property_schema(
      self, component_name: str, property_name: str
  ) -> Optional[dict]:
    """Crawls all sub-schemas of a component to retrieve a property's schema definition."""
    schema = self.components.get(component_name)
    if not schema:
      return None

    sub_schemas = [schema]
    if "allOf" in schema:
      sub_schemas.extend(schema["allOf"])

    for sub in sub_schemas:
      if (
          isinstance(sub, dict)
          and "properties" in sub
          and property_name in sub["properties"]
      ):
        return sub["properties"][property_name]
    return None
