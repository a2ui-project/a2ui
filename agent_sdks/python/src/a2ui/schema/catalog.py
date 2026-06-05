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

import collections
import copy
import glob
import json
import logging
import os
from dataclasses import dataclass, field, replace
from typing import Any, Dict, List, Optional, TYPE_CHECKING
from urllib.parse import urlparse

from .catalog_provider import A2uiCatalogProvider, FileSystemCatalogProvider
from .constants import (
    A2UI_SCHEMA_BLOCK_START,
    A2UI_SCHEMA_BLOCK_END,
    CATALOG_COMPONENTS_KEY,
    CATALOG_ID_KEY,
    VERSION_0_8,
    ENCODING,
)


@dataclass
class CatalogConfig:
  """
  Configuration for a catalog of components.

  A catalog consists of a provider that knows how to load the schema,
  and optionally a path or glob pattern to examples.

  Attributes:
    name: The name of the catalog.
    provider: The provider to use to load the catalog schema.
    examples_path: The path or glob pattern to the examples.
  """

  name: str
  provider: A2uiCatalogProvider
  examples_path: Optional[str] = None

  @classmethod
  def from_path(
      cls, name: str, catalog_path: str, examples_path: Optional[str] = None
  ) -> "CatalogConfig":
    """Returns a CatalogConfig that loads from a local path or 'file://' URI."""
    parsed = urlparse(catalog_path)
    if not parsed.scheme or parsed.scheme == "file":
      catalog_provider = FileSystemCatalogProvider(parsed.path)
    elif parsed.scheme in ["http", "https"]:
      raise NotImplementedError("HTTP support is coming soon.")
    else:
      raise ValueError(f"Unsupported catalog URL scheme: {catalog_path}")

    return cls(
        name=name,
        provider=catalog_provider,
        examples_path=resolve_examples_path(examples_path),
    )


def resolve_examples_path(path: Optional[str]) -> Optional[str]:
  if path:
    parsed = urlparse(path)
    if not parsed.scheme or parsed.scheme == "file":
      return parsed.path
    else:
      raise ValueError(f"Unsupported examples URL scheme: {path}")
  return None


def _collect_refs(obj: Any) -> set[str]:
  """Recursively collects all $ref values from a JSON object."""
  refs = set()
  if isinstance(obj, dict):
    for k, v in obj.items():
      if k == "$ref" and isinstance(v, str):
        refs.add(v)
      else:
        refs.update(_collect_refs(v))
  elif isinstance(obj, list):
    for item in obj:
      refs.update(_collect_refs(item))
  return refs


def _prune_defs_by_reachability(
    defs: Dict[str, Any],
    root_def_names: List[str],
    internal_ref_prefix: str = "#/$defs/",
) -> Dict[str, Any]:
  """Prunes definitions not reachable from the provided roots.

  Args:
    defs: The dictionary of definitions to prune.
    root_def_names: The names of the definitions to start the traversal from.
    internal_ref_prefix: The prefix used for internal references.

  Returns:
    A new dictionary containing only reachable definitions.
  """
  visited_defs = set()
  refs_queue = collections.deque(root_def_names)

  while refs_queue:
    def_name = refs_queue.popleft()
    if def_name in defs and def_name not in visited_defs:
      visited_defs.add(def_name)

      internal_refs = _collect_refs(defs[def_name])
      for ref in internal_refs:
        if ref.startswith(internal_ref_prefix):
          refs_queue.append(ref.split(internal_ref_prefix)[-1])

  return {k: v for k, v in defs.items() if k in visited_defs}


@dataclass(frozen=True)
class A2uiCatalog:
  """Represents a processed component catalog with its schema.

  Attributes:
    version: The version of the catalog.
    name: The name of the catalog.
    s2c_schema: The server-to-client schema.
    common_types_schema: The common types schema.
    catalog_schema: The catalog schema.
  """

  version: str
  name: str
  s2c_schema: Dict[str, Any]
  common_types_schema: Dict[str, Any]
  catalog_schema: Dict[str, Any]

  @property
  def catalog_id(self) -> str:
    if CATALOG_ID_KEY not in self.catalog_schema:
      raise ValueError(f"Catalog '{self.name}' missing catalogId")
    return self.catalog_schema[CATALOG_ID_KEY]

  @property
  def validator(self) -> "A2uiValidator":
    from .validator import A2uiValidator

    return A2uiValidator(self)

  def _with_pruned_components(self, allowed_components: List[str]) -> "A2uiCatalog":
    """Returns a new catalog with only allowed components.

    Args:
      allowed_components: List of component names to include.

    Returns:
      A copy of the catalog with only allowed components.
    """

    if not allowed_components:
      return self

    schema_copy = copy.deepcopy(self.catalog_schema)

    if CATALOG_COMPONENTS_KEY in schema_copy and isinstance(
        schema_copy[CATALOG_COMPONENTS_KEY], dict
    ):
      all_comps = schema_copy[CATALOG_COMPONENTS_KEY]
      schema_copy[CATALOG_COMPONENTS_KEY] = {
          k: v for k, v in all_comps.items() if k in allowed_components
      }

    # Filter anyComponent oneOf if it exists
    # Path: $defs -> anyComponent -> oneOf
    if "$defs" in schema_copy and "anyComponent" in schema_copy["$defs"]:
      any_comp = schema_copy["$defs"]["anyComponent"]
      if "oneOf" in any_comp and isinstance(any_comp["oneOf"], list):
        filtered_one_of = []
        for item in any_comp["oneOf"]:
          if "$ref" in item:
            ref = item["$ref"]
            if ref.startswith(f"#/{CATALOG_COMPONENTS_KEY}/"):
              comp_name = ref.split("/")[-1]
              if comp_name in allowed_components:
                filtered_one_of.append(item)
            else:
              logging.warning(f"Skipping unknown ref format: {ref}")
          else:
            logging.warning(f"Skipping non-ref item in anyComponent oneOf: {item}")

        any_comp["oneOf"] = filtered_one_of

    return replace(self, catalog_schema=schema_copy)

  def _with_pruned_messages(self, allowed_messages: List[str]) -> "A2uiCatalog":
    """Returns a new catalog with only allowed messages.

    Args:
      allowed_messages: List of message names to include in s2c_schema.

    Returns:
      A copy of the catalog with only allowed messages.
    """
    if not allowed_messages:
      return self

    s2c_schema_copy = copy.deepcopy(self.s2c_schema)

    if self.version == VERSION_0_8:
      # 0.8 style: Messages are in root properties.
      if "properties" in s2c_schema_copy and isinstance(
          s2c_schema_copy["properties"], dict
      ):
        s2c_schema_copy["properties"] = _prune_defs_by_reachability(
            defs=s2c_schema_copy["properties"],
            root_def_names=allowed_messages,
            internal_ref_prefix="#/properties/",
        )
    else:
      # 0.9+ style: Messages are in $defs and referenced via oneOf.
      if "oneOf" in s2c_schema_copy and isinstance(s2c_schema_copy["oneOf"], list):
        s2c_schema_copy["oneOf"] = [
            item
            for item in s2c_schema_copy["oneOf"]
            if "$ref" in item
            and item["$ref"].startswith("#/$defs/")
            and item["$ref"].split("/")[-1] in allowed_messages
        ]

      if "$defs" in s2c_schema_copy and isinstance(s2c_schema_copy["$defs"], dict):
        s2c_schema_copy["$defs"] = _prune_defs_by_reachability(
            defs=s2c_schema_copy["$defs"],
            root_def_names=allowed_messages,
            internal_ref_prefix="#/$defs/",
        )

    return replace(self, s2c_schema=s2c_schema_copy)

  def with_pruning(
      self,
      allowed_components: Optional[List[str]] = None,
      allowed_messages: Optional[List[str]] = None,
  ) -> "A2uiCatalog":
    """Returns a new catalog with pruned components and messages.

    Args:
      allowed_components: List of component names to include.
      allowed_messages: List of message names to include in s2c_schema.

    Returns:
      A copy of the catalog with pruned components and messages.
    """
    catalog = self
    if allowed_components:
      catalog = catalog._with_pruned_components(allowed_components)

    if allowed_messages:
      catalog = catalog._with_pruned_messages(allowed_messages)

    return catalog._with_pruned_common_types()

  def _with_pruned_common_types(self) -> "A2uiCatalog":
    """Returns a new catalog with unused common types pruned from the schema."""
    if not self.common_types_schema or "$defs" not in self.common_types_schema:
      return self

    # Initialize roots with ONLY refs targeting common_types.json from external schemas
    external_refs = _collect_refs(self.catalog_schema)
    external_refs.update(_collect_refs(self.s2c_schema))

    root_common_types = []
    for ref in external_refs:
      if "common_types.json#/$defs/" in ref:
        root_common_types.append(ref.split("#/$defs/")[-1])

    new_common_types_schema = copy.deepcopy(self.common_types_schema)
    new_common_types_schema["$defs"] = _prune_defs_by_reachability(
        defs=new_common_types_schema["$defs"],
        root_def_names=root_common_types,
    )

    return replace(self, common_types_schema=new_common_types_schema)

  def render_as_llm_instructions(self) -> str:
    """Renders the catalog and schema as LLM instructions."""
    all_schemas = []
    all_schemas.append(A2UI_SCHEMA_BLOCK_START)

    server_client_str = (
        json.dumps(self.s2c_schema, separators=(",", ":")) if self.s2c_schema else "{}"
    )
    all_schemas.append(f"### Server To Client Schema:\n{server_client_str}")

    if (
        self.common_types_schema
        and "$defs" in self.common_types_schema
        and self.common_types_schema["$defs"]
    ):
      common_str = json.dumps(self.common_types_schema, separators=(",", ":"))
      all_schemas.append(f"### Common Types Schema:\n{common_str}")

    catalog_str = json.dumps(self.catalog_schema, separators=(",", ":"))
    all_schemas.append(f"### Catalog Schema:\n{catalog_str}")

    all_schemas.append(A2UI_SCHEMA_BLOCK_END)

    return "\n\n".join(all_schemas)

  def load_examples(self, path: Optional[str], validate: bool = False) -> str:
    """Loads and validates examples from a directory or a glob pattern."""
    if not path:
      return ""

    # If it's a directory, support backward compatibility by appending /*.json
    if os.path.isdir(path):
      pattern = os.path.join(path, "*.json")
    else:
      pattern = path

    # Use glob to find files
    matched_files = glob.glob(pattern, recursive=True)

    if not matched_files:
      if not os.path.isdir(path) and not any(c in path for c in "*?[]"):
        logging.warning(
            f"Example path {path} is neither a directory nor a valid glob pattern"
        )
      return ""

    # Sort for determinism
    matched_files.sort()

    merged_examples = []
    for full_path in matched_files:
      if not os.path.isfile(full_path):
        continue
      basename = os.path.splitext(os.path.basename(full_path))[0]
      with open(full_path, "r", encoding=ENCODING) as f:
        content = f.read()

      if validate:
        self._validate_example(full_path, content)

      merged_examples.append(f"---BEGIN {basename}---\n{content}\n---END {basename}---")

    if not merged_examples:
      return ""
    return "\n\n".join(merged_examples)

  def _validate_example(self, full_path: str, content: str) -> None:
    try:
      json_data = json.loads(content)
      self.validator.validate(json_data)
    except Exception as e:
      raise ValueError(f"Failed to validate example {full_path}: {e}") from e
