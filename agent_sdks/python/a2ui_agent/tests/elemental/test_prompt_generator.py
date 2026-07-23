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

    def test_catalog_instructions_json_decompilation(self):
        """Test catalog instructions containing JSON blocks are converted to HTML blocks."""
        cat_with_instructions = A2uiCatalog(
            version=VERSION_1_0,
            name="inst_catalog",
            experiments={"version_1_0"},
            s2c_schema={},
            common_types_schema={},
            catalog_schema={
                "catalogId": "https://a2ui.org/inst_catalog",
                "instructions": (
                    'Here is an example:\n```json\n{"version": "1.0", "createSurface":'
                    ' {"surfaceId": "main", "components": [{"id": "root", "component":'
                    ' "Text", "text": "Hi"}]}}\n```\nList'
                    ' example:\n```json\n[{"version": "1.0", "deleteSurface":'
                    ' {"surfaceId": "main"}}]\n```'
                ),
                "components": {"Text": {"properties": {"text": {"type": "string"}}}},
            },
        )
        elemental_format = ElementalFormat(catalog=cat_with_instructions)
        generator = elemental_format.prompt_generator
        generator.parser = None

        prompt = generator.generate(
            role_description="Test role",
            include_schema=True,
            include_examples=False,
        )
        self.assertIn("```html", prompt)

    def test_transform_examples_edge_cases(self):
        """Test transform_examples with JSON arrays, invalid JSON, non-A2UI JSON, and catalog=None."""
        elemental_format = ElementalFormat(catalog=self.catalog)
        generator = elemental_format.prompt_generator

        # 1. JSON array block
        array_markdown = (
            '```json\n[{"version": "1.0", "deleteSurface": {"surfaceId": "s1"}}]\n```'
        )
        transformed_array = generator.transform_examples(array_markdown)
        self.assertIn("<ui-delete-surface", transformed_array)

        # 2. Non-A2UI JSON block (should be left as is)
        non_a2ui_markdown = '```json\n{"foo": "bar"}\n```'
        transformed_non_a2ui = generator.transform_examples(non_a2ui_markdown)
        self.assertEqual(transformed_non_a2ui, non_a2ui_markdown)

        # 3. Invalid JSON block (should be left as is)
        invalid_markdown = "```json\n{invalid_json}\n```"
        transformed_invalid = generator.transform_examples(invalid_markdown)
        self.assertEqual(transformed_invalid, invalid_markdown)

        # 4. catalog=None (should return raw markdown as is)
        generator.catalog = None
        self.assertEqual(generator.transform_examples("raw text"), "raw text")

    def test_map_schema_to_ts_type_uncovered_branches(self):
        """Test _map_schema_to_ts_type for DynamicStringList, boolean, empty array, and union databinding."""
        elemental_format = ElementalFormat(catalog=self.catalog)
        generator = elemental_format.prompt_generator

        # 1. DynamicStringList ref
        t_str_list = generator._map_schema_to_ts_type(
            "Comp", "p1", {"$ref": "#/definitions/DynamicStringList"}
        )
        self.assertIn("string[]", t_str_list)

        # 2. boolean type
        t_bool = generator._map_schema_to_ts_type("Comp", "p2", {"type": "boolean"})
        self.assertEqual(t_bool, "boolean")

        # 3. array with no items
        t_arr_any = generator._map_schema_to_ts_type("Comp", "p3", {"type": "array"})
        self.assertEqual(t_arr_any, "any[]")

        # 4. union type with databinding
        t_union_db = generator._map_schema_to_ts_type(
            "Comp",
            "p4",
            {
                "oneOf": [{"type": "string"}, {"type": "number"}],
                "properties": {"path": {"type": "string"}},  # allows db
            },
        )
        self.assertEqual(t_union_db, "string | number")

    def test_schema_helpers_edge_cases(self):
        """Test _schema_allows_databinding and _is_action helper functions."""
        from a2ui.inference_formats.experimental.elemental.prompt_generator import (
            _schema_allows_databinding,
            _is_action,
        )

        self.assertFalse(_schema_allows_databinding(None))
        self.assertFalse(_schema_allows_databinding("string"))
        self.assertTrue(
            _schema_allows_databinding(
                {"oneOf": [{"$ref": "#/definitions/DynamicString"}]}
            )
        )

        self.assertFalse(_is_action(None))
        self.assertFalse(_is_action("string"))
        self.assertTrue(_is_action({"oneOf": [{"$ref": "#/definitions/Action"}]}))


if __name__ == "__main__":
    unittest.main()
