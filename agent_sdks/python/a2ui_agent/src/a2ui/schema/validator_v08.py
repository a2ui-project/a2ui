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

import copy
import logging
import re
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Set, Tuple, Union, Iterator

from jsonschema import Draft202012Validator
from a2ui.core.validating.validator import ValidationConfig, STRICT_VALIDATION
from a2ui.core.validating.integrity_checker import (
    validate_component_integrity as core_validate_component_integrity,
    validate_recursion_and_paths as core_validate_recursion_and_paths,
)
from a2ui.core.validating.topology_analyzer import analyze_topology as core_analyze_topology

from .utils import wrap_as_json_array

if TYPE_CHECKING:
  from .catalog import A2uiCatalog

from .constants import (
    BASE_SCHEMA_URL,
    CATALOG_COMPONENTS_KEY,
    CATALOG_ID_KEY,
    CATALOG_STYLES_KEY,
    VERSION_0_8,
)

# A2UI relaxed path pattern (extends RFC 6901 to support relative paths)
RELAXED_PATH_PATTERN = re.compile(
    r"^(?:(?:\/(?:[^~\/]|~[01])*)*|(?:[^~\/]|~[01])+(?:\/(?:[^~\/]|~[01])*)*)$"
)

# Recursion Limits
MAX_GLOBAL_DEPTH = 50
MAX_FUNC_CALL_DEPTH = 5

# Constants
COMPONENTS = "components"
ID = "id"
ROOT = "root"
PATH = "path"
FUNCTION_CALL = "functionCall"
CALL = "call"
ARGS = "args"

DEFAULT_SINGLE_REF_FIELDS = {
    "child",
    "contentChild",
    "entryPointChild",
}

DEFAULT_LIST_REF_FIELDS = {"children", "explicitList", "template", "tabs"}


def _inject_additional_properties(
    schema: Dict[str, Any],
    source_properties: Dict[str, Any],
    mapping: Dict[str, str] = None,
) -> Tuple[Dict[str, Any], Set[str]]:
  """
  Recursively injects properties from source_properties into nodes with additionalProperties=True and sets additionalProperties=False.

  Args:
      schema: The target schema to traverse and patch.
      source_properties: A dictionary of top-level property groups (e.g., "components", "styles") from the source schema.

  Returns:
      A tuple containing:
      - The patched schema.
      - A set of keys from source_properties that were injected.
  """
  injected_keys = set()

  def recursive_inject(obj):
    if isinstance(obj, dict):
      new_obj = {}
      for k, v in obj.items():
        # If this node has additionalProperties=True, we inject the source properties
        if isinstance(v, dict) and v.get("additionalProperties") is True:
          if k in source_properties:
            injected_keys.add(k)
            new_node = dict(v)
            new_node["additionalProperties"] = False
            new_node["properties"] = {
                **new_node.get("properties", {}),
                **source_properties[k],
            }
            new_obj[k] = new_node
          else:  # No matching source group, keep as is but recurse children
            new_obj[k] = recursive_inject(v)
        else:  # Not a node with additionalProperties, recurse children
          new_obj[k] = recursive_inject(v)
      return new_obj
    elif isinstance(obj, list):
      return [recursive_inject(i) for i in obj]
    return obj

  return recursive_inject(schema), injected_keys


def _find_root_id(
    messages: List[Dict[str, Any]], surface_id: Optional[str] = None
) -> Optional[str]:
  """
  Finds the root id from a list of A2UI messages for a given surface.
  - For v0.8, the root id is in the beginRendering message.
  """
  for message in messages:
    if not isinstance(message, dict):
      continue
    if "beginRendering" in message:
      if surface_id and message["beginRendering"].get("surfaceId") != surface_id:
        continue
      return message["beginRendering"].get(ROOT, ROOT)
  return None


def extract_component_required_fields(
    catalog: A2uiCatalog,
) -> Dict[str, Set[str]]:
  """
  Parses the catalog/schema to identify which component properties are required.
  Returns a map: { component_name: set_of_required_fields }
  """
  req_map = {}

  all_components = catalog.catalog_schema.get(COMPONENTS, {})

  for comp_name, comp_schema in all_components.items():
    required_fields = set()

    def extract_from_props(cs: Dict[str, Any]):
      if not isinstance(cs, dict):
        return

      if "required" in cs and isinstance(cs["required"], list):
        required_fields.update(req for req in cs["required"] if req != "component")

    extract_from_props(comp_schema)

    if required_fields:
      req_map[comp_name] = required_fields

  return req_map


def extract_component_ref_fields(
    catalog: A2uiCatalog,
) -> Dict[str, tuple[Set[str], Set[str]]]:
  """
  Parses the catalog/schema to identify which component properties reference other components.
  Returns a map: { component_name: (set_of_single_ref_fields, set_of_list_ref_fields) }
  """
  ref_map = {}

  all_components = catalog.catalog_schema.get(COMPONENTS, {})

  for comp_name, comp_schema in all_components.items():
    single_refs = set()
    list_refs = set()

    def extract_from_props(cs: Dict[str, Any]):
      if not isinstance(cs, dict):
        return
      props = cs.get("properties", {})
      for prop_name, prop_schema in props.items():
        if prop_name in DEFAULT_SINGLE_REF_FIELDS:
          single_refs.add(prop_name)
        elif prop_name in DEFAULT_LIST_REF_FIELDS:
          list_refs.add(prop_name)
        extract_from_props(prop_schema)

      if "items" in cs:
        extract_from_props(cs["items"])

    extract_from_props(comp_schema)

    if single_refs or list_refs:
      ref_map[comp_name] = (single_refs, list_refs)

  return ref_map


class LegacyA2uiValidatorV08:
  """Validates legacy v0.8 payloads against the schema."""

  def __init__(self, catalog: A2uiCatalog):
    self._catalog = catalog
    self.version = VERSION_0_8
    self._validator = self._build_0_8_validator()

  def _bundle_0_8_schemas(self) -> Dict[str, Any]:
    if not self._catalog.s2c_schema:
      return {}

    bundled = copy.deepcopy(self._catalog.s2c_schema)

    # Prepare catalog components and styles for injection
    source_properties = {}
    catalog_schema = self._catalog.catalog_schema
    if catalog_schema:
      if CATALOG_COMPONENTS_KEY in catalog_schema:
        source_properties["component"] = catalog_schema[CATALOG_COMPONENTS_KEY]
      if CATALOG_STYLES_KEY in catalog_schema:
        source_properties[CATALOG_STYLES_KEY] = catalog_schema[CATALOG_STYLES_KEY]

    bundled, _ = _inject_additional_properties(bundled, source_properties)
    return bundled

  def _build_0_8_validator(self) -> Draft202012Validator:
    bundled_schema = self._bundle_0_8_schemas()
    full_schema = wrap_as_json_array(bundled_schema)
    return Draft202012Validator(full_schema)

  def validate(
      self,
      a2ui_json: Union[Dict[str, Any], List[Any]],
      root_id: Optional[str] = None,
      config: ValidationConfig = STRICT_VALIDATION,
  ) -> None:
    messages = a2ui_json if isinstance(a2ui_json, list) else [a2ui_json]

    errors = list(self._validator.iter_errors(messages))
    if errors:
      error = errors[0]
      msg = f"Validation failed: {error.message}"
      if error.context:
        msg += "\nContext failures:"
        for sub_error in error.context:
          msg += f"\n  - {sub_error.message}"
      raise ValueError(msg)

    has_begin = any(isinstance(m, dict) and "beginRendering" in m for m in messages)
    if not has_begin and not config.allow_missing_root:
      config = config.model_copy(update={"allow_missing_root": True})

    for message in messages:
      if not isinstance(message, dict):
        continue

      components = None
      surface_id = None
      if "surfaceUpdate" in message:
        components = message["surfaceUpdate"].get(COMPONENTS)
        surface_id = message["surfaceUpdate"].get("surfaceId")

      if components:
        ref_map = extract_component_ref_fields(self._catalog)
        root_id = _find_root_id(messages, surface_id)
        core_validate_component_integrity(
            components,
            ref_map,
            root_id=root_id,
            allow_dangling_references=config.allow_dangling_references,
            allow_missing_root=config.allow_missing_root,
        )
        core_analyze_topology(
            components,
            ref_map,
            root_id=root_id,
            allow_orphan_components=config.allow_orphan_components,
            allow_missing_root=config.allow_missing_root,
        )

      core_validate_recursion_and_paths(message)
