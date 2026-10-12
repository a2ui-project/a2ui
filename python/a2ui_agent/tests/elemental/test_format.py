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

"""Unit tests focusing on the ElementalFormat strategy class."""

import json
import os
import unittest

from a2ui.core import A2uiCatalogError, Catalog
from a2ui.inference_formats.experimental.elemental import ElementalFormat
from a2ui.schema.utils import find_repo_root, get_spec_dir

REPO_ROOT = find_repo_root(os.path.dirname(__file__)) or ""
SPEC_DIR = get_spec_dir("v1_0")
CATALOG_PATH = os.path.join(REPO_ROOT, "catalogs", "basic", "v1", "catalog.json")


class TestElementalFormat(unittest.TestCase):
    """Test suite covering the ElementalFormat configuration and description generation."""

    def setUp(self):
        with open(CATALOG_PATH, "r", encoding="utf-8") as f:
            catalog_dict = json.load(f)
        self.catalog = Catalog.from_json(catalog_dict, protocol_version="0.9.1")

    def test_format_without_catalog_is_an_error(self):
        """Verifies that a format needs at least one catalog."""
        with self.assertRaisesRegex(A2uiCatalogError, "At least one catalog"):
            ElementalFormat([])


if __name__ == "__main__":
    unittest.main()
