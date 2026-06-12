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

import os
import json
from pathlib import Path
from typing import Dict, Any
import pytest

from a2ui.schema.constants import VERSION_0_9
from a2ui.schema.manager import A2uiSchemaManager, CatalogConfig
from a2ui.basic_catalog.provider import BasicCatalog
from a2ui.schema.common_modifiers import remove_strict_validation
from a2ui.schema.catalog_provider import A2uiCatalogProvider


ROOT_DIR = Path(__file__).parent.parent.parent.parent.parent  # a2ui root
SAMPLES_DIR = ROOT_DIR / "samples" / "agent" / "adk"

SAMPLE_CONFIGS = [
    {
        "name": "custom-components-example",
        "path": SAMPLES_DIR / "custom-components-example",
        "catalogs": [
            CatalogConfig.from_path(
                name="custom-components-example_inline_catalog",
                catalog_path="inline_catalog_0.9.json",
                examples_path=f"examples/{VERSION_0_9}",
            ),
            BasicCatalog.get_config(
                version=VERSION_0_9,
            ),
        ],
        "schema_modifiers": [remove_strict_validation],
        "validate": True,
    },
    {
        "name": "restaurant_finder",
        "path": SAMPLES_DIR / "restaurant_finder",
        "catalogs": [
            BasicCatalog.get_config(
                version=VERSION_0_9,
                examples_path="examples/0.9",
            )
        ],
        "schema_modifiers": [remove_strict_validation],
        "validate": True,
    },
    {
        "name": "rizzcharts",
        "path": SAMPLES_DIR / "rizzcharts",
        "catalogs": [
            CatalogConfig.from_path(
                name="rizzcharts",
                catalog_path="catalog_schemas/0.9/rizzcharts_catalog_definition.json",
                examples_path="examples/rizzcharts_catalog/0.9",
            ),
            BasicCatalog.get_config(
                version=VERSION_0_9,
                examples_path="examples/standard_catalog/0.9",
            ),
        ],
        "schema_modifiers": [remove_strict_validation],
        "validate": True,
    },
]


@pytest.mark.parametrize("config", SAMPLE_CONFIGS)
def test_sample_examples_validation(config):
  """Validates that all examples for a given sample pass A2UI validation."""
  do_validate = config.get("validate", True)
  sample_path = config["path"]
  os.chdir(sample_path)  # Change to sample dir to resolve relative catalog paths if any

  manager = A2uiSchemaManager(
      VERSION_0_9,
      catalogs=config["catalogs"],
      accepts_inline_catalogs=True,
      schema_modifiers=config["schema_modifiers"],
  )

  # Iterate through each catalog and validate its examples
  for catalog in manager._supported_catalogs:
    examples_path = manager._catalog_example_paths.get(catalog.catalog_id)
    if not examples_path:
      continue

    # manager.load_examples(catalog, validate=True) returns a combined string.
    # It internally calls _validate_example which logs warnings on failure.
    # To strictly fail the test, we want to capture those failures or re-implement.

    path = Path(examples_path)
    if not path.is_absolute():
      path = sample_path / path

    assert (
        path.is_dir()
    ), f"Examples directory not found: {path} for sample {config['name']}"

    for filename in os.listdir(path):
      if filename.endswith(".json"):
        full_path = path / filename
        with open(full_path, "r", encoding="utf-8") as f:
          content = json.load(f)
          try:
            if do_validate:
              catalog.validator.validate(content)
          except Exception as e:
            pytest.fail(
                f"Validation failed for {full_path} in sample {config['name']}: {e}"
            )
