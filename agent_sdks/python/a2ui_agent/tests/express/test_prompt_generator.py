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

"""Unit tests focusing on the A2UI Express Prompt Generator."""

import json
import os
import tempfile
import unittest
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import VERSION_1_0
from a2ui.inference_formats.experimental.express.format import ExpressFormat


class TestExpressPromptGenerator(unittest.TestCase):
    """Test suite covering Express prompt generation, examples pruning, and validation."""

    def setUp(self):
        self.catalog = A2uiCatalog(
            version=VERSION_1_0,
            name="test_catalog",
            experiments={"version_1_0"},
            s2c_schema={
                "$id": (
                    "https://a2ui.org/specification/v1_0/json/agent_to_renderer.json"
                ),
                "$schema": "https://json-schema.org/draft/2020-12/schema",
            },
            common_types_schema={},
            catalog_schema={
                "catalogId": "https://a2ui.org/test_catalog",
                "components": {
                    "Text": {
                        "properties": {"text": {"type": "string", "positionalIndex": 0}}
                    }
                },
                "functions": {
                    "openUrl": {
                        "properties": {"url": {"type": "string", "positionalIndex": 0}}
                    }
                },
            },
        )
        self.tmp_dir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_express_prompt_generator_property(self):
        express_format = ExpressFormat(catalog=self.catalog)
        generator = express_format.prompt_generator

        prompt = generator.generate(
            role_description="You are a helpful assistant.",
            workflow_description="Please adhere to constraints.",
            include_schema=True,
        )
        self.assertIn("You are a helpful assistant.", prompt)
        self.assertIn("Please adhere to constraints.", prompt)
        self.assertIn("# A2UI Express Output Contract", prompt)
        self.assertIn("Text(", prompt)

    def test_catalog_description_before_generate(self):
        express_format = ExpressFormat(catalog=self.catalog)
        generator = express_format.prompt_generator
        desc = generator.catalog_description(include_schema=True)
        self.assertIn("Text(", desc)

    def test_express_allowed_components_pruning(self):
        express_format = ExpressFormat(catalog=self.catalog)
        generator = express_format.prompt_generator

        # Only allow other component tags, Text should be pruned out
        prompt = generator.generate(
            role_description="Test role",
            include_schema=True,
            allowed_components=["Button"],
        )
        self.assertNotIn("Text(", prompt)

    def test_express_include_examples_transformation(self):
        # Write a markdown file containing a JSON block wrapped in backticks
        example_payload = {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "welcome",
                "components": [
                    {"id": "root", "component": "Text", "text": "Hello World"}
                ],
            },
        }
        md_content = (
            f"Some markdown text.\n\n```json\n{json.dumps(example_payload)}\n```\n"
        )
        md_file_path = os.path.join(self.tmp_dir.name, "examples.md")
        with open(md_file_path, "w", encoding="utf-8") as f:
            f.write(md_content)

        # Initialize ExpressFormat with examples.md path
        express_format = ExpressFormat(catalog=self.catalog, examples_path=md_file_path)
        generator = express_format.prompt_generator

        prompt = generator.generate(
            role_description="Test role",
            workflow_description="Custom workflow instructions",
            ui_description="Custom UI rules",
            include_schema=True,
            include_examples=True,
            validate_examples=False,
        )

        # Verify workflow_description and ui_description are included
        self.assertIn("Custom workflow instructions", prompt)
        self.assertIn("Custom UI rules", prompt)

        # Verify examples are included and decompiled
        self.assertIn("### Examples:", prompt)
        self.assertIn('root = Text("Hello World")', prompt)

    def test_express_examples_validation(self):
        # Write a valid standard A2UI JSON example file
        example_payload = {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "welcome",
                "components": [
                    {"id": "root", "component": "Text", "text": "Hello World"}
                ],
            },
        }
        json_file_path = os.path.join(self.tmp_dir.name, "example_1.json")
        with open(json_file_path, "w", encoding="utf-8") as f:
            json.dump(example_payload, f)

        # Initialize ExpressFormat with directory path
        express_format = ExpressFormat(
            catalog=self.catalog, examples_path=self.tmp_dir.name
        )
        generator = express_format.prompt_generator

        prompt = generator.generate(
            role_description="Test role",
            include_schema=True,
            include_examples=True,
            validate_examples=True,
        )

        self.assertIn("### Examples:", prompt)

    def test_express_transform_examples_edge_cases(self):
        """Test transform_examples with JSON array blocks, non-A2UI JSON, and invalid JSON."""
        express_format = ExpressFormat(catalog=self.catalog)
        generator = express_format.prompt_generator

        # 1. JSON array block
        array_md = (
            '```json\n[{"version": "1.0", "deleteSurface": {"surfaceId": "s1"}}]\n```'
        )
        trans_array = generator.transform_examples(array_md)
        self.assertIn('deleteSurface("s1")', trans_array)

        # 2. Non-A2UI JSON block
        non_a2ui_md = '```json\n{"foo": "bar"}\n```'
        self.assertEqual(generator.transform_examples(non_a2ui_md), non_a2ui_md)

        # 3. Invalid JSON block
        invalid_md = "```json\n{invalid}\n```"
        self.assertEqual(generator.transform_examples(invalid_md), invalid_md)

        # 4. catalog=None
        generator.catalog = None
        self.assertEqual(generator.transform_examples("raw text"), "raw text")

    def test_express_signatures_with_object_properties(self):
        """Test component signatures generation for object properties with map keys."""
        cat_map_obj = A2uiCatalog(
            version=VERSION_1_0,
            name="map_catalog",
            experiments={"version_1_0"},
            s2c_schema={},
            common_types_schema={},
            catalog_schema={
                "catalogId": "https://a2ui.org/map_catalog",
                "components": {
                    "MapComp": {
                        "properties": {
                            "config": {
                                "type": "object",
                                "properties": {
                                    "key1": {
                                        "type": "string",
                                        "description": "Key 1 desc",
                                    },
                                },
                            }
                        }
                    }
                },
            },
        )
        fmt = ExpressFormat(catalog=cat_map_obj)
        sigs = fmt.prompt_generator.generate_component_signatures()
        self.assertIn("MapComp", sigs)
        self.assertIn("Map with keys:", sigs)


if __name__ == "__main__":
    unittest.main()
