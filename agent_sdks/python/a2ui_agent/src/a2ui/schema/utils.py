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

"""Utilities for A2UI Schema manipulation."""

import json
import logging
import os
import importlib.resources
from typing import Any, Dict

from .constants import A2UI_ASSET_PACKAGE, SPECIFICATION_DIR, ENCODING
from .catalog_provider import FileSystemCatalogProvider


def find_repo_root(start_path: str) -> str | None:
  """Finds the repository root by looking for the 'specification' directory."""
  current = os.path.abspath(start_path)
  while True:
    if os.path.isdir(os.path.join(current, SPECIFICATION_DIR)):
      return current
    parent = os.path.dirname(current)
    if parent == current:
      return None
    current = parent


def load_from_bundled_resource(
    version: str,
    resource_key: str,
    spec_map: Dict[str, Dict[str, str]],
) -> Dict[str, Any]:
  """Loads a schema resource from bundled package resources."""
  spec_map = spec_map.get(version)
  if not spec_map:
    raise ValueError(f"Unknown A2UI version: {version}")

  if resource_key not in spec_map:
    return None

  rel_path = spec_map[resource_key]
  filename = os.path.basename(rel_path)

  # 1. Try to load from the bundled package resources.
  try:
    traversable = importlib.resources.files(A2UI_ASSET_PACKAGE)
    traversable = traversable.joinpath(version).joinpath(filename)
    with traversable.open("r", encoding=ENCODING) as f:
      return json.load(f)
  except Exception as e:
    logging.debug("Could not load '%s' from package resources: %s", filename, e)

  # 2. Fallback to local assets
  # This handles cases where assets might be present in src but not installed
  try:
    # The assets are located at a2ui/assets/<version>/<filename>
    # This file is at a2ui/inference/schema/manager.py
    # So, we need to go up 3 directories to 'a2ui', then down to 'assets'
    potential_path = os.path.abspath(
        os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "assets",
            version,
            filename,
        )
    )
    if os.path.exists(potential_path):
      provider = FileSystemCatalogProvider(potential_path)
      return provider.load()
  except Exception as e:
    logging.debug("Could not load schema '%s' from local assets: %s", filename, e)

  # 3. Fallback: Source Repository (specification/...)
  # This handles cases where we are running directly from source tree
  # And assets are not yet copied to src/a2ui/assets
  # manager.py is at a2a_agents/python/a2ui_agent/src/a2ui/inference/schema/manager.py
  # Dynamically find repo root by looking for "specification" directory
  try:
    repo_root = find_repo_root(os.path.dirname(__file__))
    if repo_root:
      source_path = os.path.join(repo_root, rel_path)
      if os.path.exists(source_path):
        provider = FileSystemCatalogProvider(source_path)
        return provider.load()
  except Exception as e:
    logging.debug("Could not load schema from source repo: %s", e)

  raise IOError(f"Could not load schema {filename} for version {version}")


# LLM is instructed to generate a list of messages, so we wrap the bundled schema in an array.
def wrap_as_json_array(a2ui_schema: dict[str, Any]) -> dict[str, Any]:
  """Wraps the A2UI schema in an array object to support multiple parts.

  Args:
      a2ui_schema: The A2UI schema to wrap.

  Returns:
      The wrapped A2UI schema object.

  Raises:
      ValueError: If the A2UI schema is empty.
  """
  if not a2ui_schema:
    raise ValueError("A2UI schema is empty")
  return {"type": "array", "items": a2ui_schema}


def deep_update(d: dict, u: dict) -> dict:
  """Recursively update a dict with another dict."""
  for k, v in u.items():
    if isinstance(v, dict):
      d[k] = deep_update(d.get(k, {}), v)
    else:
      d[k] = v
  return d
