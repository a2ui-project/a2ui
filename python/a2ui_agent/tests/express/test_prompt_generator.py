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

"""Unit tests focusing on the A2UI Express Prompt Generator."""

import json
import os
import tempfile
import unittest

from a2ui.core import Catalog
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats.express import ExpressFormat


class TestExpressPromptGenerator(unittest.TestCase):
    """Test suite covering Express prompt generation, examples pruning, and validation."""

    def setUp(self):
        self.catalog = Catalog.from_json(
            protocol_version=ProtocolVersion.V1_0,
            catalog_id="https://a2ui.org/test_catalog",
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
        express_format = ExpressFormat([self.catalog])
        generator = express_format.prompt_generator

        prompt = generator.generate()
        self.assertIn("# A2UI Express DSL Output Contract", prompt)
        self.assertIn("Text(", prompt)

    def test_catalog_description_before_generate(self):
        express_format = ExpressFormat([self.catalog])
        generator = express_format.prompt_generator
        desc = generator.generate_catalog_instructions(include_schema=True)
        self.assertIn("Text(", desc)

    def test_express_allowed_components_pruning(self):
        from a2ui.catalog_transformers import ComponentPruningTransformer

        pruned_catalog = ComponentPruningTransformer(["Button"]).transform(self.catalog)
        express_format = ExpressFormat([pruned_catalog])
        generator = express_format.prompt_generator

        # Only allow other component tags, Text should be pruned out
        prompt = generator.generate()
        self.assertNotIn("Text(", prompt)

    def test_express_include_examples_transformation(self):
        from a2ui.inference_formats import to_message_models

        example_payload = {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "welcome",
                "catalogId": self.catalog.catalog_id,
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

        express_format = ExpressFormat(
            [self.catalog], examples=[to_message_models([example_payload])]
        )
        generator = express_format.prompt_generator

        prompt = generator.generate()

        # Verify examples are included and decompiled
        self.assertIn("### Examples:", prompt)
        self.assertIn('root = Text("Hello World")', prompt)

        # Also verify transform_examples on markdown content
        transformed = generator.transform_examples(md_content)
        self.assertIn('root = Text("Hello World")', transformed)

    def test_express_examples_validation(self):
        from a2ui.inference_formats import to_message_models
        from a2ui.utils import load_examples

        # Write a valid standard A2UI JSON example file
        example_payload = {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "welcome",
                "catalogId": self.catalog.catalog_id,
                "components": [
                    {"id": "root", "component": "Text", "text": "Hello World"}
                ],
            },
        }
        json_file_path = os.path.join(self.tmp_dir.name, "example_1.json")
        with open(json_file_path, "w", encoding="utf-8") as f:
            json.dump(example_payload, f)

        loaded_md = load_examples([self.catalog], self.tmp_dir.name, validate=True)
        express_format = ExpressFormat(
            [self.catalog], examples=[to_message_models([example_payload])]
        )
        generator = express_format.prompt_generator

        prompt = generator.generate()

        self.assertIn("### Examples:", prompt)
        self.assertIn("---BEGIN example_1---", generator.transform_examples(loaded_md))

    def test_express_transform_examples_edge_cases(self):
        """Test transform_examples with JSON array blocks, non-A2UI JSON, and invalid JSON."""
        express_format = ExpressFormat([self.catalog])
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

    def test_express_signatures_with_object_properties(self):
        """Test component signatures generation for object properties with map keys."""
        cat_map_obj = Catalog.from_json(
            protocol_version=ProtocolVersion.V1_0,
            catalog_id="https://a2ui.org/map_catalog",
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
        fmt = ExpressFormat([cat_map_obj])
        sigs = fmt.prompt_generator._generate_component_signatures()
        self.assertIn("MapComp", sigs)
        self.assertIn("Map with keys:", sigs)

    def test_express_schema_helper_methods(self):
        from a2ui.inference_formats._shared import (
            CatalogSchemaHelper as ExpressCatalogSchemaHelper,
        )

        cat = Catalog.from_json(
            protocol_version=ProtocolVersion.V1_0,
            catalog_id="test",
            catalog_schema={
                "catalogId": "test",
                "components": {
                    "Button": {
                        "description": "Button component",
                        "properties": {
                            "label": {"type": "string"},
                            "action": {"$ref": "common_types.json#/$defs/Action"},
                            "children": {"$ref": "common_types.json#/$defs/ChildList"},
                            "child": {"$ref": "common_types.json#/$defs/Child"},
                        },
                    },
                    "Card": {
                        "properties": {
                            "content": {
                                "oneOf": [
                                    {"$ref": "common_types.json#/$defs/ChildList"}
                                ]
                            }
                        }
                    },
                },
                "functions": {
                    "openUrl": {
                        "description": "Opens URL",
                        "properties": {
                            "args": {"properties": {"url": {"type": "string"}}}
                        },
                    }
                },
            },
        )
        helper = ExpressCatalogSchemaHelper(cat)
        self.assertEqual(helper.get_component_description("Button"), "Button component")
        self.assertEqual(helper.get_function_description("openUrl"), "Opens URL")
        self.assertEqual(helper.get_property_type("Button", "action"), "Action")
        self.assertEqual(helper.get_property_type("Button", "children"), "ChildList")
        self.assertEqual(helper.get_property_type("Button", "child"), "Child")
        self.assertEqual(helper.get_property_type("Card", "content"), "ChildList")
        self.assertEqual(
            helper.get_function_property_schema("openUrl", "url"),
            {"type": "string"},
        )

    def test_express_standalone_call_rule_lists_only_agent_callable_functions(self):
        cat = Catalog.from_json(
            protocol_version=ProtocolVersion.V1_0,
            catalog_id="conformance/allowed_callers",
            catalog_schema={
                "catalogId": "conformance/allowed_callers",
                "protocolVersion": "1.0",
                "components": {
                    "Text": {
                        "properties": {
                            "component": {"const": "Text"},
                            "text": {"type": "string"},
                        },
                        "required": ["component", "text"],
                    }
                },
                "functions": {
                    "notifyAgent": {
                        "returnType": "void",
                        "allowedCallers": "agentOnly",
                        "properties": {
                            "@call": {"const": "notifyAgent"},
                            "args": {"type": "object", "properties": {}},
                        },
                    },
                    "showToast": {
                        "returnType": "void",
                        "allowedCallers": "rendererOrAgent",
                        "properties": {
                            "@call": {"const": "showToast"},
                            "args": {"type": "object", "properties": {}},
                        },
                    },
                    "formatValue": {
                        "returnType": "string",
                        "properties": {
                            "@call": {"const": "formatValue"},
                            "args": {"type": "object", "properties": {}},
                        },
                    },
                    "launch": {
                        "returnType": "void",
                        "allowedCallers": "rendererOnly",
                        "requiresUserActivation": True,
                        "properties": {
                            "@call": {"const": "launch"},
                            "args": {"type": "object", "properties": {}},
                        },
                    },
                },
            },
        )
        generator = ExpressFormat([cat]).prompt_generator
        rules = generator.generate_base_rules()
        self.assertIn(
            "Only these functions can be called this way: `notifyAgent`, `showToast`.",
            rules,
        )
        self.assertNotIn("`formatValue`", rules)
        self.assertNotIn("`launch`", rules)
        filtered = generator.generate_base_rules(
            allowed_messages=["createSurface", "updateComponents"]
        )
        self.assertNotIn("Only these functions can be called this way", filtered)

    def test_express_multi_catalog_rules_renumber_sequentially_with_callable_functions(
        self,
    ):
        import re

        cat_a = Catalog.from_json(
            protocol_version=ProtocolVersion.V1_0,
            catalog_id="test/cat_a",
            catalog_schema={
                "catalogId": "test/cat_a",
                "protocolVersion": "1.0",
                "components": {
                    "Text": {
                        "properties": {
                            "component": {"const": "Text"},
                            "text": {"type": "string"},
                        },
                        "required": ["component", "text"],
                    }
                },
                "functions": {
                    "showToast": {
                        "returnType": "void",
                        "allowedCallers": "rendererOrAgent",
                        "properties": {
                            "@call": {"const": "showToast"},
                            "args": {"type": "object", "properties": {}},
                        },
                    }
                },
            },
        )
        cat_b = Catalog.from_json(
            protocol_version=ProtocolVersion.V1_0,
            catalog_id="test/cat_b",
            catalog_schema={
                "catalogId": "test/cat_b",
                "protocolVersion": "1.0",
                "components": {
                    "Badge": {
                        "properties": {
                            "component": {"const": "Badge"},
                            "label": {"type": "string"},
                        },
                        "required": ["component", "label"],
                    }
                },
                "functions": {},
            },
        )
        generator = ExpressFormat([cat_a, cat_b]).prompt_generator
        rules = generator.generate_base_rules()
        numbers = [int(m) for m in re.findall(r"(?m)^(\d+)\. ", rules)]
        self.assertEqual(numbers, list(range(1, len(numbers) + 1)))
        self.assertIn("## Multiple Catalogs", rules)
        self.assertIn(
            "Only these functions can be called this way: `showToast`.", rules
        )

        filtered = generator.generate_base_rules(
            allowed_messages=["createSurface", "updateComponents"]
        )
        filtered_numbers = [int(m) for m in re.findall(r"(?m)^(\d+)\. ", filtered)]
        self.assertEqual(filtered_numbers, list(range(1, len(filtered_numbers) + 1)))
        self.assertIn("## Multiple Catalogs", filtered)
        self.assertNotIn("Only these functions can be called this way", filtered)
        self.assertNotIn("deleteSurface(", filtered)

    def test_express_signatures_with_one_of_and_any_of_unions(self):
        """Introspects oneOf and anyOf unions for object and array-of-objects property details."""
        cat = Catalog.from_json(
            protocol_version=ProtocolVersion.V1_0,
            catalog_id="https://example.com/charts.json",
            catalog_schema={
                "catalogId": "https://example.com/charts.json",
                "protocolVersion": "1.0",
                "components": {
                    "LineChart": {
                        "type": "object",
                        "description": "Renders a line chart.",
                        "properties": {
                            "component": {"const": "LineChart"},
                            "series": {
                                "description": (
                                    "Array of data series, where each series"
                                    " represents a package or metric line."
                                ),
                                "oneOf": [
                                    {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "name": {
                                                    "type": "string",
                                                    "description": "Name of the series",
                                                },
                                                "color": {
                                                    "type": "string",
                                                    "description": "Hex color code",
                                                },
                                                "data": {
                                                    "type": "array",
                                                    "description": (
                                                        "Points along the line"
                                                    ),
                                                    "items": {
                                                        "type": "object",
                                                        "properties": {
                                                            "date": {"type": "string"},
                                                            "value": {"type": "number"},
                                                        },
                                                        "required": ["value"],
                                                    },
                                                },
                                            },
                                            "required": ["name", "data"],
                                        },
                                    },
                                    {
                                        "$ref": "common_types.json#/$defs/DataBinding",
                                    },
                                ],
                            },
                            "points": {
                                "anyOf": [
                                    {
                                        "$ref": "common_types.json#/$defs/DataBinding",
                                    },
                                    {
                                        "type": "array",
                                        "items": {
                                            "$ref": "#/$defs/PointItem",
                                        },
                                    },
                                ],
                            },
                            "config": {
                                "description": "Chart configuration object.",
                                "oneOf": [
                                    {
                                        "type": "object",
                                        "properties": {
                                            "showLegend": {
                                                "type": "boolean",
                                                "description": (
                                                    "Whether to show the legend"
                                                ),
                                            },
                                            "yAxisLabel": {"type": "string"},
                                        },
                                    },
                                    {
                                        "$ref": "common_types.json#/$defs/DataBinding",
                                    },
                                ],
                            },
                            "center": {
                                "anyOf": [
                                    {
                                        "type": "object",
                                        "properties": {
                                            "lat": {"type": "number"},
                                            "lng": {"type": "number"},
                                        },
                                    },
                                    {
                                        "$ref": "common_types.json#/$defs/DataBinding",
                                    },
                                ],
                            },
                        },
                        "required": ["component", "series"],
                    },
                },
                "$defs": {
                    "PointItem": {
                        "type": "object",
                        "properties": {
                            "x": {"type": "number", "description": "X coordinate"},
                            "y": {"type": "number", "description": "Y coordinate"},
                        },
                        "required": ["x", "y"],
                    },
                },
            },
        )

        instructions = ExpressFormat(
            [cat]
        ).prompt_generator.generate_catalog_instructions(catalog=cat)
        self.assertIn(
            "• LineChart(series, points?, config?, center?)\n"
            "  - Description: Renders a line chart.\n"
            "  - series: Array of data series, where each series represents a"
            " package or metric line.\n"
            "    List of maps keys:\n"
            "    * name - Name of the series\n"
            "    * color - Hex color code\n"
            "    * data - Points along the line\n"
            "  - points: List of maps with keys:\n"
            "    * x - X coordinate\n"
            "    * y - Y coordinate\n"
            "  - config: Chart configuration object.\n"
            "    Map keys:\n"
            "    * showLegend - Whether to show the legend\n"
            "    * yAxisLabel\n"
            "  - center: Map with keys:\n"
            "    * lat\n"
            "    * lng",
            instructions,
        )

    def test_express_signatures_with_flattened_envelopes_and_all_of(self):
        """Handles locally flattened wire envelopes, allOf composition, local enum $defs, and local $ref aliases."""
        cat = Catalog.from_json(
            protocol_version=ProtocolVersion.V1_0,
            catalog_id="https://example.com/flattened.json",
            catalog_schema={
                "catalogId": "https://example.com/flattened.json",
                "protocolVersion": "1.0",
                "components": {
                    "CompositeWidget": {
                        "type": "object",
                        "description": (
                            "Widget exercising flattened common_types and allOf"
                            " schemas."
                        ),
                        "properties": {
                            "component": {"const": "CompositeWidget"},
                            "title": {
                                "description": "Display title.",
                                "$ref": "#/$defs/common_types_DynamicString",
                            },
                            "iconName": {
                                "description": "Icon identifier.",
                                "oneOf": [
                                    {"$ref": "#/$defs/StandardIconEnum"},
                                    {
                                        "type": "object",
                                        "properties": {
                                            "svgPath": {"type": "string"},
                                        },
                                    },
                                ],
                            },
                            "settings": {
                                "description": "Merged settings object.",
                                "allOf": [
                                    {"$ref": "#/$defs/BaseSettings"},
                                    {
                                        "type": "object",
                                        "properties": {
                                            "theme": {
                                                "type": "string",
                                                "description": "Color theme",
                                            },
                                        },
                                    },
                                ],
                            },
                            "rows": {
                                "type": "array",
                                "items": {
                                    "allOf": [
                                        {"$ref": "#/$defs/BaseRow"},
                                        {
                                            "properties": {
                                                "badge": {
                                                    "type": "string",
                                                    "description": "Optional row badge",
                                                },
                                            },
                                        },
                                    ],
                                },
                            },
                            "onTap": {
                                "$ref": "#/$defs/LocalActionAlias",
                            },
                            "content": {
                                "$ref": "#/$defs/LocalChildAlias",
                            },
                        },
                        "required": ["component", "title"],
                    },
                },
                "$defs": {
                    "common_types_DataBinding": {
                        "type": "object",
                        "properties": {
                            "@path": {"type": "string"},
                        },
                        "required": ["@path"],
                    },
                    "common_types_FunctionCall": {
                        "type": "object",
                        "properties": {
                            "@call": {"type": "string"},
                            "args": {"type": "object"},
                            "returnType": {"type": "string"},
                        },
                        "required": ["@call"],
                    },
                    "common_types_DynamicString": {
                        "oneOf": [
                            {"$ref": "#/$defs/common_types_DataBinding"},
                            {
                                "allOf": [
                                    {"$ref": "#/$defs/common_types_FunctionCall"},
                                    {"properties": {"returnType": {"const": "string"}}},
                                ],
                            },
                            {
                                "allOf": [
                                    {"$ref": "common_types.json#/$defs/FunctionCall"},
                                    {"properties": {"returnType": {"const": "string"}}},
                                ],
                            },
                            {"type": "string"},
                        ],
                    },
                    "StandardIconEnum": {
                        "type": "string",
                        "enum": ["home", "search", "settings"],
                    },
                    "BaseSettings": {
                        "type": "object",
                        "properties": {
                            "compact": {
                                "type": "boolean",
                                "description": "Use compact spacing",
                            },
                        },
                    },
                    "BaseRow": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string", "description": "Row identifier"},
                        },
                    },
                    "LocalActionAlias": {
                        "$ref": "common_types.json#/$defs/Action",
                    },
                    "LocalChildAlias": {
                        "$ref": "common_types.json#/$defs/ComponentId",
                    },
                },
            },
        )

        instructions = ExpressFormat(
            [cat]
        ).prompt_generator.generate_catalog_instructions(catalog=cat)
        self.assertIn(
            "• CompositeWidget(title, iconName? (static), settings? (static),"
            " rows? (static), onTap? (static), content? (component ID))\n"
            "  - Description: Widget exercising flattened common_types and allOf"
            " schemas.\n"
            "  - title: Display title.\n"
            "  - iconName: Icon identifier. Must be one of: 'home', 'search',"
            " 'settings'\n"
            "  - settings: Merged settings object.\n"
            "    Map keys:\n"
            "    * compact - Use compact spacing\n"
            "    * theme - Color theme\n"
            "  - rows: List of maps with keys:\n"
            "    * id - Row identifier\n"
            "    * badge - Optional row badge",
            instructions,
        )
        self.assertNotIn("@path", instructions)
        self.assertNotIn("@call", instructions)
        self.assertNotIn("returnType", instructions)
        self.assertNotIn("svgPath", instructions)

    def test_cyclic_one_of_schema_terminates_without_recursion_error(self):
        """Ensures cyclic oneOf/anyOf/allOf schemas terminate without RecursionError."""
        from a2ui.inference_formats._shared import (
            CatalogSchemaHelper,
            is_action_slot,
        )
        from a2ui.inference_formats.express.prompt_generator import (
            _get_schema_enum,
            _resolve_object_properties,
            _resolve_structured_property,
            _schema_allows_databinding,
        )

        cat = Catalog.from_json(
            protocol_version=ProtocolVersion.V1_0,
            catalog_id="https://example.com/cyclic.json",
            catalog_schema={
                "catalogId": "https://example.com/cyclic.json",
                "protocolVersion": "1.0",
                "components": {
                    "TreeWidget": {
                        "type": "object",
                        "properties": {
                            "component": {"const": "TreeWidget"},
                            "node": {"$ref": "#/$defs/TreeNode"},
                        },
                        "required": ["component", "node"],
                    }
                },
                "$defs": {
                    "TreeNode": {
                        "oneOf": [
                            {"$ref": "#/$defs/TreeNode"},
                            {
                                "type": "object",
                                "properties": {
                                    "label": {"type": "string"},
                                },
                            },
                        ]
                    }
                },
            },
        )
        helper = CatalogSchemaHelper(cat)
        # Mutate the in-memory property schema to create an actual Python dict cycle
        cyclic_schema = helper.components["TreeWidget"]["properties"]["node"]
        cyclic_schema["oneOf"].insert(0, cyclic_schema)

        self.assertIsNone(helper.get_property_type("TreeWidget", "node"))
        self.assertFalse(is_action_slot(cyclic_schema))
        self.assertFalse(_schema_allows_databinding(cyclic_schema))
        self.assertIsNone(_get_schema_enum(cyclic_schema))
        self.assertEqual(
            _resolve_object_properties(cyclic_schema),
            {"label": {"type": "string"}},
        )
        self.assertEqual(
            _resolve_structured_property(cyclic_schema),
            ("object", {"label": {"type": "string"}}),
        )
        instructions = ExpressFormat(
            [cat]
        ).prompt_generator.generate_catalog_instructions(catalog=cat)
        self.assertIn("TreeWidget(node (static))", instructions)
        self.assertIn("* label", instructions)


if __name__ == "__main__":
    unittest.main()
