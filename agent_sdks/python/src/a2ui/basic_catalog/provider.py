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

from typing import Any, Dict, Optional

from ..schema.catalog import CatalogConfig, resolve_examples_path
from ..schema.catalog_provider import A2uiCatalogProvider
from ..schema.utils import load_from_bundled_resource
from ..schema.constants import BASE_SCHEMA_URL, CATALOG_ID_KEY, CATALOG_SCHEMA_KEY
from .constants import BASIC_CATALOG_NAME, BASIC_CATALOG_PATHS


class BundledCatalogProvider(A2uiCatalogProvider):
  """Loads schemas from bundled package resources with fallbacks."""

  def __init__(self, version: str):
    self.version = version

  def load(self) -> Dict[str, Any]:
    # Use load_from_bundled_resource but with the specialized basic catalog paths
    resource = load_from_bundled_resource(
        self.version, CATALOG_SCHEMA_KEY, BASIC_CATALOG_PATHS
    )

    # Post-load processing for catalogs
    if CATALOG_ID_KEY not in resource:
      spec_map = BASIC_CATALOG_PATHS.get(self.version)
      if spec_map and CATALOG_SCHEMA_KEY in spec_map:
        rel_path = spec_map[CATALOG_SCHEMA_KEY]
        # Strip the `json/` part from the catalog file path for the ID.
        catalog_file = rel_path.replace("/json/", "/")
        resource[CATALOG_ID_KEY] = BASE_SCHEMA_URL + catalog_file

    if "$schema" not in resource:
      resource["$schema"] = "https://json-schema.org/draft/2020-12/schema"

    return resource


class BasicCatalog:
  """Helper for accessing the basic A2UI catalog."""

  @staticmethod
  def get_config(version: str, examples_path: Optional[str] = None) -> CatalogConfig:
    """Returns a CatalogConfig for the basic bundled catalog."""
    return CatalogConfig(
        name=BASIC_CATALOG_NAME,
        provider=BundledCatalogProvider(version),
        examples_path=resolve_examples_path(examples_path),
    )

  @staticmethod
  def get_catalog_id(version: str) -> str:
    """Returns the basic catalog ID based on the specification version."""
    if version not in BASIC_CATALOG_PATHS:
      raise ValueError(f"Unsupported version: {version}")
    rel_path = BASIC_CATALOG_PATHS[version][CATALOG_SCHEMA_KEY]
    catalog_file = rel_path.replace("/json/", "/")
    return f"{BASE_SCHEMA_URL}{catalog_file}"
