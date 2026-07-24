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

"""Unit tests focusing on the A2UI Elemental Prompt Generator."""

import json
import os
import tempfile
import unittest
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import VERSION_1_0
from a2ui.inference_formats.experimental.elemental.format import ElementalFormat


class TestElementalPromptGenerator(unittest.TestCase):
    """Test suite covering Elemental prompt generation, type mappings, and example pruning."""

    def setUp(self):
        # Rich catalog testing all mapping branches of _map_schema_to_ts_type
        self.catalog = A2uiCatalog(
            version=VERSION_1_0,
            name="rich_catalog",
            experiments={"version_1_0"},
            s2c_schema={
                "$id": (
                    "https://a2ui.org/specification/v1_0/json/agent_to_renderer.json"
                ),
                "$schema": "https://json-schema.org/draft/2020-12/schema",
            },
            common_types_schema={},
            catalog_schema={
                "catalogId": "https://a2ui.org/rich_catalog",
                "components": {
                    "Text": {
                        "properties": {"text": {"type": "string", "positionalIndex": 0}}
                    },
                    "RichComponent": {
                        "properties": {
                            "checks": {"type": "array", "items": {"type": "string"}},
                            "refComponent": {"$ref": "#/definitions/ComponentId"},
                            "refChildList": {"$ref": "#/definitions/ChildList"},
                            "refAction": {"$ref": "#/definitions/Action"},
                            "refString": {"$ref": "#/definitions/DynamicString"},
                            "refNumber": {"$ref": "#/definitions/DynamicNumber"},
                            "refBoolean": {"$ref": "#/definitions/DynamicBoolean"},
                            "nestedObj": {
                                "type": "object",
                                "properties": {"path": {"type": "string"}},
                            },
                            "unionType": {
                                "oneOf": [{"type": "string"}, {"type": "number"}]
                            },
                            "enumType": {
                                "type": "string",
                                "enum": ["option1", "option2"],
                            },
                            "primitiveArray": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            "objectArray": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "id": {"type": "string"},
                                        "val": {"type": "number"},
                                    },
                                    "required": ["id"],
                                },
                            },
                            "plainObject": {
                                "type": "object",
                                "properties": {
                                    "name": {"type": "string"},
                                    "age": {"type": "number"},
                                },
                                "required": ["name"],
                            },
                            "genericObject": {"type": "object"},
                        }
                    },
                },
                "functions": {
                    "openUrl": {
                        "properties": {
                            "args": {
                                "properties": {
                                    "url": {"type": "string", "positionalIndex": 0}
                                }
                            }
                        }
                    },
                    "someFunc": {
                        "description": "A dummy function description.",
                        "properties": {
                            "args": {
                                "properties": {
                                    "arg1": {"type": "string", "positionalIndex": 0}
                                }
                            }
                        },
                    },
                },
                "definitions": {
                    "ComponentId": {"type": "string"},
                    "ChildList": {"type": "array", "items": {"type": "string"}},
                    "Action": {"type": "object"},
                    "DynamicString": {"type": "string"},
                    "DynamicNumber": {"type": "number"},
                    "DynamicBoolean": {"type": "boolean"},
                },
            },
        )
        self.tmp_dir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp_dir.cleanup()

    def test_elemental_prompt_generator_property(self):
        elemental_format = ElementalFormat(catalog=self.catalog)
        generator = elemental_format.prompt_generator

        prompt = generator.generate(
            role_description="You are an HTML generator.",
            workflow_description="Please output Elemental HTML.",
            include_schema=True,
        )
        self.assertIn("You are an HTML generator.", prompt)
        self.assertIn("Please output Elemental HTML.", prompt)
        self.assertIn("# A2UI Elemental Output Contract", prompt)
        self.assertIn("interface Text {", prompt)

    def test_catalog_description_before_generate(self):
        elemental_format = ElementalFormat(catalog=self.catalog)
        generator = elemental_format.prompt_generator
        desc = generator.catalog_description(include_schema=True)
        self.assertIn("interface Text {", desc)

    def test_catalog_description_no_schema(self):
        """Verifies catalog_description returns an empty string when include_schema is False."""
        fmt = ElementalFormat(catalog=self.catalog)
        generator = fmt.prompt_generator
        desc = generator.catalog_description(include_schema=False)
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
        generator = fmt.prompt_generator

        desc = generator.catalog_description(include_schema=True)

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
        generator = fmt.prompt_generator

        desc = generator.catalog_description(include_schema=True)

        self.assertIn("## Catalog Instructions", desc)
        self.assertIn("```html", desc)
        self.assertIn('<ui-text id="root" text="Hello List" />', desc)
        self.assertNotIn("```json", desc)

    def test_elemental_ts_type_mapping(self):
        elemental_format = ElementalFormat(catalog=self.catalog)
        generator = elemental_format.prompt_generator

        prompt = generator.generate(
            role_description="Test role",
            include_schema=True,
        )

        # Check checks property maps to FunctionCall[]
        self.assertIn("checks?: FunctionCall[]", prompt)
        # Check $ref mappings
        self.assertIn("refComponent?: A2UIElement", prompt)
        self.assertIn("refChildList?: A2UIElement[]", prompt)
        self.assertIn("onClick?: Action", prompt)
        self.assertIn("refString?: string | DataBinding", prompt)
        self.assertIn("refNumber?: number | DataBinding", prompt)
        self.assertIn("refBoolean?: boolean | DataBinding", prompt)
        # Check nested object properties
        self.assertIn("nestedObj?: DataBinding", prompt)
        # Check union type mapping
        self.assertIn("unionType?: string | number", prompt)
        # Check enum type mapping
        self.assertIn("enumType?: 'option1' | 'option2'", prompt)
        # Check primitive array mapping
        self.assertIn("primitiveArray?: string[]", prompt)
        # Check object array mapping
        self.assertIn("objectArray?: Array<{id: string; val?: number}>", prompt)
        # Check plain object mapping
        self.assertIn("plainObject?: {name: string; age?: number}", prompt)
        # Check generic object mapping
        self.assertIn("genericObject?: Record<string, any>", prompt)

    def test_allowed_components_pruning(self):
        elemental_format = ElementalFormat(catalog=self.catalog)
        generator = elemental_format.prompt_generator

        # Only allow Text component, which should prune RichComponent
        prompt = generator.generate(
            role_description="Test role",
            include_schema=True,
            allowed_components=["Text"],
        )
        self.assertNotIn("interface RichComponent", prompt)
        self.assertIn("interface Text", prompt)

    def test_elemental_include_examples_transformation(self):
        example_payload = {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "welcome",
                "components": [
                    {"id": "root", "component": "RichComponent", "refString": "hello"}
                ],
            },
        }
        md_content = (
            f"Some markdown text.\n\n```json\n{json.dumps(example_payload)}\n```\n"
        )
        md_file_path = os.path.join(self.tmp_dir.name, "examples.md")
        with open(md_file_path, "w", encoding="utf-8") as f:
            f.write(md_content)

        elemental_format = ElementalFormat(
            catalog=self.catalog, examples_path=md_file_path
        )
        generator = elemental_format.prompt_generator

        prompt = generator.generate(
            role_description="Test role",
            include_schema=True,
            include_examples=True,
            validate_examples=False,
        )

        self.assertIn("### Examples:", prompt)
        self.assertIn('<ui-rich-component id="root" ref-string="hello" />', prompt)

    def test_elemental_examples_validation(self):
        example_payload = {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "welcome",
                "components": [
                    {"id": "root", "component": "RichComponent", "refString": "hello"}
                ],
            },
        }
        json_file_path = os.path.join(self.tmp_dir.name, "example_1.json")
        with open(json_file_path, "w", encoding="utf-8") as f:
            json.dump(example_payload, f)

        elemental_format = ElementalFormat(
            catalog=self.catalog, examples_path=self.tmp_dir.name
        )
        generator = elemental_format.prompt_generator

        prompt = generator.generate(
            role_description="Test role",
            include_schema=True,
            include_examples=True,
            validate_examples=True,
        )

        self.assertIn("### Examples:", prompt)
        self.assertIn("---BEGIN example_1---", prompt)


if __name__ == "__main__":
    unittest.main()
