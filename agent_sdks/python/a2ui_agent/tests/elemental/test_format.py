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

"""Unit tests focusing on the ElementalFormat strategy class."""

import json
import os
import unittest
from unittest.mock import MagicMock
from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import VERSION_1_0
from a2ui.inference_formats.experimental.elemental.format import ElementalFormat
from a2ui.inference_formats.experimental.elemental.prompt_generator import (
    ElementalPromptGenerator,
)

SPEC_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..", "..", "specification", "v1_0"
    )
)
CATALOG_PATH = os.path.join(SPEC_DIR, "catalogs", "basic", "catalog.json")


class TestElementalFormat(unittest.TestCase):
    """Test suite covering the ElementalFormat configuration and description generation."""

    def setUp(self):
        with open(CATALOG_PATH, "r", encoding="utf-8") as f:
            catalog_dict = json.load(f)
        self.catalog = Catalog.from_json(catalog_dict, spec_version="0.9.1")

    def test_ensure_catalog_error(self):
        """Verifies that accessing parser, decompiler, or prompt_generator raises ValueError when catalog is missing."""
        fmt_no_catalog = ElementalFormat(catalog=None)

        with self.assertRaises(ValueError) as ctx:
            _ = fmt_no_catalog.parser
        self.assertIn("Catalog is required", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            _ = fmt_no_catalog.decompiler
        self.assertIn("Catalog is required", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            _ = fmt_no_catalog.prompt_generator
        self.assertIn("Catalog is required", str(ctx.exception))

    def test_catalog_description_no_schema(self):
        """Verifies catalog_description returns an empty string when include_schema is False."""
        fmt = ElementalFormat(catalog=self.catalog)
        desc = fmt.catalog_description(prompt_gen=MagicMock(), include_schema=False)
        self.assertEqual(desc, "")

    def test_catalog_description_initializes_helper_and_decompiles_instructions(self):
        """Verifies helper initialization and JSON instructions decompiling in catalog_description."""
        custom_catalog = A2uiCatalog(
            version=VERSION_1_0,
            name="custom_catalog",
            experiments={"version_1_0"},
            s2c_schema={},
            common_types_schema={},
            catalog_schema={
                "catalogId": "https://a2ui.org/custom_catalog",
                "instructions": (
                    "Please output components in the following format:\n"
                    "```json\n"
                    "{\n"
                    '  "version": "1.0",\n'
                    '  "createSurface": {\n'
                    '    "surfaceId": "welcome",\n'
                    '    "components": [\n'
                    "      {\n"
                    '        "id": "root",\n'
                    '        "component": "Text",\n'
                    '        "text": "Hello"\n'
                    "      }\n"
                    "    ]\n"
                    "  }\n"
                    "}\n"
                    "```"
                ),
                "components": {"Text": {"properties": {"text": {"type": "string"}}}},
            },
        )

        fmt = ElementalFormat(catalog=custom_catalog)
        prompt_gen = ElementalPromptGenerator(fmt)

        desc = fmt.catalog_description(prompt_gen=prompt_gen, include_schema=True)

        # Verify JSON block in catalog instructions is decompiled to HTML block
        self.assertIn("## Catalog Instructions", desc)
        self.assertIn("```html", desc)
        self.assertIn('<ui-text id="root" text="Hello" />', desc)
        self.assertNotIn("```json", desc)

    def test_catalog_description_initializes_helper_and_decompiles_list_instructions(
        self,
    ):
        """Verifies helper initialization and list JSON instructions decompiling in catalog_description."""
        custom_catalog = A2uiCatalog(
            version=VERSION_1_0,
            name="custom_catalog",
            experiments={"version_1_0"},
            s2c_schema={},
            common_types_schema={},
            catalog_schema={
                "catalogId": "https://a2ui.org/custom_catalog",
                "instructions": (
                    "Please output components in the following format:\n"
                    "```json\n"
                    "[\n"
                    "  {\n"
                    '    "version": "1.0",\n'
                    '    "createSurface": {\n'
                    '      "surfaceId": "welcome",\n'
                    '      "components": [\n'
                    "        {\n"
                    '          "id": "root",\n'
                    '          "component": "Text",\n'
                    '          "text": "Hello List"\n'
                    "        }\n"
                    "      ]\n"
                    "    }\n"
                    "  }\n"
                    "]\n"
                    "```"
                ),
                "components": {"Text": {"properties": {"text": {"type": "string"}}}},
            },
        )

        fmt = ElementalFormat(catalog=custom_catalog)
        prompt_gen = ElementalPromptGenerator(fmt)

        desc = fmt.catalog_description(prompt_gen=prompt_gen, include_schema=True)

        self.assertIn("## Catalog Instructions", desc)
        self.assertIn("```html", desc)
        self.assertIn('<ui-text id="root" text="Hello List" />', desc)
        self.assertNotIn("```json", desc)


if __name__ == "__main__":
    unittest.main()
