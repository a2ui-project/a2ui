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

import json
import os
from pathlib import Path

import pytest

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.processor import CatalogConfig
from a2ui.schema import VERSION_0_9
from a2ui.utils import validate_payload


ROOT_DIR = Path(__file__).parent.parent.parent.parent.parent  # a2ui root
SAMPLES_DIR = ROOT_DIR / "samples" / "agent" / "adk"

SAMPLE_CONFIGS = [
    {
        "name": "custom-components-example",
        "path": SAMPLES_DIR / "custom-components-example",
        "catalogs": [
            (
                lambda: CatalogConfig.from_path(
                    catalog_path="inline_catalog_0.9.json",
                    protocol_version=VERSION_0_9,
                ),
                f"examples/{VERSION_0_9}",
            ),
            (
                lambda: CatalogConfig(BasicCatalog(VERSION_0_9)),
                None,
            ),
        ],
        "validate": True,
    },
    {
        "name": "restaurant_finder",
        "path": SAMPLES_DIR / "restaurant_finder",
        "catalogs": [(
            lambda: CatalogConfig(BasicCatalog(VERSION_0_9)),
            "examples/0.9",
        )],
        "validate": True,
    },
]


@pytest.mark.parametrize("config", SAMPLE_CONFIGS)
def test_sample_examples_validation(config):
    """Validates that all examples for a given sample pass A2UI validation."""
    do_validate = config.get("validate", True)
    sample_path = config["path"]
    os.chdir(
        sample_path
    )  # Change to sample dir to resolve relative catalog paths if any

    loaded_entries = [
        (factory().transformed_catalog, examples_path)
        for factory, examples_path in config["catalogs"]
    ]
    sample_catalogs = [catalog for catalog, _ in loaded_entries]

    # Iterate through each catalog and validate its examples
    for catalog, examples_path in loaded_entries:
        if not examples_path:
            continue

        # An example may create surfaces on any of the sample's catalogs.
        catalogs = [
            catalog,
            *(c for c in sample_catalogs if c is not catalog),
        ]

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
                            validate_payload(catalogs, content)
                    except Exception as e:
                        pytest.fail(
                            f"Validation failed for {full_path} in sample"
                            f" {config['name']}: {e}"
                        )
