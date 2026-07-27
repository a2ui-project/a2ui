# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Unit tests focusing on the A2UI Elemental Compiler."""

import json
import os
import unittest
from a2ui.core.catalog import Catalog
from a2ui.inference_formats.experimental.elemental.compiler import (
    ElementalCompiler,
    _is_action_property,
    _has_label_value,
    _schema_expects_option_objects,
    _get_enum_values,
    _escape_nested_script_tags,
)

SPEC_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..", "..", "specification", "v1_0"
    )
)
CATALOG_PATH = os.path.join(SPEC_DIR, "catalogs", "basic", "catalog.json")


class TestElementalCompiler(unittest.TestCase):
    """Test suite covering the Elemental compiler and parsing logic."""

    def setUp(self):
        """Initializes standard test paths and schema helpers."""
        self.catalog_path = CATALOG_PATH
        with open(self.catalog_path, "r", encoding="utf-8") as f:
            catalog_dict = json.load(f)
        self.catalog = Catalog.from_json(catalog_dict, spec_version="0.9.1")
        self.compiler = ElementalCompiler(self.catalog)

    def test_compile_delete_surface(self):
        html_input = '<ui-delete-surface surface-id="dashboard-surface-1" />'
        result = self.compiler.compile(html_input)
        expected = {
            "version": "v1.0",
            "deleteSurface": {"surfaceId": "dashboard-surface-1"},
        }
        self.assertEqual(result, expected)

    def test_compile_call_function(self):
        html_input = (
            '<ui-call-function id="call_1" name="openUrl" url="https://example.com"'
            ' want-response="{true}" />'
        )
        result = self.compiler.compile(html_input)
        expected = {
            "version": "v1.0",
            "functionCallId": "call_1",
            "wantResponse": True,
            "callFunction": {
                "call": "openUrl",
                "args": {"url": "https://example.com"},
            },
        }
        self.assertEqual(result, expected)

    def test_compile_update_data_model(self):
        html_input = (
            '<body id="my-surf">\n'
            '  <script type="application/json">\n'
            "    {\n"
            '      "foo": "bar",\n'
            '      "num": 42\n'
            "    }\n"
            "  </script>\n"
            "</body>"
        )
        result = self.compiler.compile(html_input)
        expected = {
            "version": "v1.0",
            "updateDataModel": {
                "surfaceId": "my-surf",
                "path": "/",
                "value": {"foo": "bar", "num": 42},
            },
        }
        self.assertEqual(result, expected)

    def test_compile_create_surface_basic(self):
        html_input = (
            '<body id="test-surf">\n'
            '  <link rel="catalog" href="https://a2ui.org/catalog.json">\n'
            '  <script type="application/json">\n'
            "    {\n"
            '      "title": "Hello World"\n'
            "    }\n"
            "  </script>\n"
            '  <ui-card id="comp_0" weight="{4}">\n'
            '    <ui-text id="comp_1" text="{$/title}" />\n'
            "  </ui-card>\n"
            "</body>"
        )
        result = self.compiler.compile(html_input)
        self.assertEqual(result["version"], "v1.0")
        create_op = result["createSurface"]
        self.assertEqual(create_op["surfaceId"], "test-surf")
        self.assertEqual(create_op["catalogId"], "https://a2ui.org/catalog.json")
        self.assertEqual(create_op["dataModel"], {"title": "Hello World"})

        components = create_op["components"]
        self.assertEqual(len(components), 2)

        comp_text = components[0]
        comp_card = components[1]

        self.assertEqual(comp_text["id"], "comp_1")
        self.assertEqual(comp_text["component"], "Text")
        self.assertEqual(comp_text["text"], {"path": "/title"})

        self.assertEqual(comp_card["id"], "comp_0")
        self.assertEqual(comp_card["component"], "Card")
        self.assertEqual(comp_card["weight"], 4)
        self.assertEqual(comp_card["child"], "comp_1")

    def test_compile_options_expansion(self):
        # ChoicePicker is the dropdown component in the basic catalog
        html_input = (
            '<body id="test-surf">\n'
            "  <ui-choice-picker id=\"picker_1\" options=\"{['Red', 'Blue']}\" />\n"
            "</body>"
        )
        result = self.compiler.compile(html_input)
        components = result["createSurface"]["components"]
        self.assertEqual(len(components), 1)
        picker = components[0]
        self.assertEqual(
            picker["options"],
            [
                {"label": "Red", "value": "Red"},
                {"label": "Blue", "value": "Blue"},
            ],
        )

    def test_compile_complex_slot_property(self):
        # Test script slot using ChoicePicker options (where label and value differ in case)
        html_input = (
            '<body id="test-surf">\n'
            '  <ui-choice-picker id="picker_1">\n'
            '    <script type="application/json" slot="options">\n'
            "      [\n"
            '        {"label": "Red", "value": "red"},\n'
            '        {"label": "Blue", "value": "blue"}\n'
            "      ]\n"
            "    </script>\n"
            "  </ui-choice-picker>\n"
            "</body>"
        )
        result = self.compiler.compile(html_input)
        components = result["createSurface"]["components"]
        self.assertEqual(len(components), 1)
        picker = components[0]
        self.assertEqual(
            picker["options"],
            [
                {"label": "Red", "value": "red"},
                {"label": "Blue", "value": "blue"},
            ],
        )

    def test_compile_actions_and_events(self):
        html_input = (
            '<body id="test-surf">\n'
            '  <ui-button id="btn_1" onclick="{Event(\'submit\', {id: 123})}">\n'
            '    <ui-text id="text_1" text="Submit" />\n'
            "  </ui-button>\n"
            "</body>"
        )
        result = self.compiler.compile(html_input)
        components = result["createSurface"]["components"]
        self.assertEqual(len(components), 2)
        btn = components[1]
        self.assertEqual(btn["id"], "btn_1")
        self.assertEqual(
            btn["action"],
            {
                "event": {
                    "name": "submit",
                    "context": {"id": 123},
                }
            },
        )

    def test_compile_checks_with_implicit_value(self):
        # TextField is the input component in the basic catalog
        html_input = (
            '<body id="test-surf">\n  <ui-text-field id="input_1" value="{$/dob}"'
            ' checks="{[required()]}" />\n</body>'
        )
        result = self.compiler.compile(html_input)
        components = result["createSurface"]["components"]
        self.assertEqual(len(components), 1)
        text_field = components[0]
        self.assertEqual(text_field["id"], "input_1")
        self.assertEqual(text_field["value"], {"path": "/dob"})
        self.assertEqual(
            text_field["checks"],
            [{
                "condition": {
                    "call": "required",
                    "args": {"value": {"path": "/dob"}},
                },
                "message": "Invalid input",
            }],
        )

    def test_compile_checks_with_custom_message(self):
        html_input = (
            '<body id="test-surf">\n  <ui-text-field id="input_1" value="{$/dob}"'
            " checks=\"{[required(message: 'DOB is required')]}\" />\n</body>"
        )
        result = self.compiler.compile(html_input)
        components = result["createSurface"]["components"]
        text_field = components[0]
        self.assertEqual(
            text_field["checks"],
            [{
                "condition": {
                    "call": "required",
                    "args": {"value": {"path": "/dob"}},
                },
                "message": "DOB is required",
            }],
        )

    def test_compile_checks_with_condition_custom_message(self):
        html_input = (
            '<body id="test-surf">\n  <ui-text-field id="input_1" value="{$/dob}"'
            " checks=\"{[{condition: required(message: 'DOB is required')}]}\""
            " />\n</body>"
        )
        result = self.compiler.compile(html_input)
        components = result["createSurface"]["components"]
        text_field = components[0]
        self.assertEqual(
            text_field["checks"],
            [{
                "condition": {
                    "call": "required",
                    "args": {"value": {"path": "/dob"}},
                },
                "message": "DOB is required",
            }],
        )

    def test_compile_checks_mixed_positional_named_error(self):
        html_input = (
            '<body id="test-surf">\n  <ui-text-field id="input_1" value="{$/dob}"'
            " checks=\"{[required(1, message: 'DOB is required')]}\" />\n</body>"
        )
        with self.assertRaises(ValueError):
            self.compiler.compile(html_input)

    def test_compile_list_with_template(self):
        html_input = (
            '<body id="test-surf">\n'
            '  <ui-list id="list_1" path="{$/items}">\n'
            "    <template>\n"
            '      <ui-text id="item_text" text="{$name}" />\n'
            "    </template>\n"
            "  </ui-list>\n"
            "</body>"
        )
        result = self.compiler.compile(html_input)
        components = result["createSurface"]["components"]
        self.assertEqual(len(components), 2)
        item_text = components[0]
        lst = components[1]

        self.assertEqual(item_text["id"], "item_text")
        self.assertEqual(item_text["text"], {"path": "name"})

        self.assertEqual(lst["id"], "list_1")
        self.assertEqual(
            lst["children"],
            {
                "path": "/items",
                "componentId": "item_text",
            },
        )

    def test_compile_nested_script_tags(self):
        html_input = (
            '<body id="test-surf">\n  <script type="application/json">\n    {\n     '
            ' "embedded_html":'
            " \"<html><a2ui><body><script>console.log('hello');</script></body></a2ui></html>\"\n"
            '    }\n  </script>\n  <ui-text id="text1" text="{$/embedded_html}"'
            " />\n</body>"
        )
        result = self.compiler.compile(html_input)
        self.assertEqual(
            result["createSurface"]["dataModel"]["embedded_html"],
            "<html><a2ui><body><script>console.log('hello');</script></body></a2ui></html>",
        )

    def test_compile_unknown_html_tag_raises_error(self):
        html_input = (
            '<body id="test-surf">\n'
            '  <ui-card id="card_1">\n'
            "    <div>\n"
            '      <ui-text id="text_1" text="Hello" />\n'
            "    </div>\n"
            "  </ui-card>\n"
            "</body>"
        )
        with self.assertRaises(ValueError) as ctx:
            self.compiler.compile(html_input)
        self.assertIn("Invalid element tag 'div'", str(ctx.exception))

    def test_compile_invalid_root_tag_raises_error(self):
        html_input = (
            '<ui-card id="card_1">\n  <ui-text id="text_1" text="Hello" />\n</ui-card>'
        )
        with self.assertRaises(ValueError) as ctx:
            self.compiler.compile(html_input)
        self.assertIn("A2UI Elemental document must have a <body>", str(ctx.exception))

    def test_compile_case_insensitive_enum_matching(self):
        # 'align' on Column expects 'center', 'start', 'end'. Test passing 'CENTER' or 'Center'
        html_input = (
            '<body id="test-surf">\n'
            '  <ui-column id="col_1" align="CENTER">\n'
            '    <ui-text id="text_1" text="Hello" />\n'
            "  </ui-column>\n"
            "</body>"
        )
        result = self.compiler.compile(html_input)
        components = result["createSurface"]["components"]
        col = components[1]
        self.assertEqual(col["align"], "center")

    def test_compile_invalid_enum_raises_error(self):
        html_input = (
            '<body id="test-surf">\n'
            '  <ui-column id="col_1" align="invalid_alignment">\n'
            '    <ui-text id="text_1" text="Hello" />\n'
            "  </ui-column>\n"
            "</body>"
        )
        with self.assertRaises(ValueError) as ctx:
            self.compiler.compile(html_input)
        self.assertIn("has invalid enum value 'invalid_alignment'", str(ctx.exception))

    def test_compile_unclosed_leaf_tag_autoclose(self):
        # text_1 is a leaf component inside col_1. It is unclosed.
        # text_2 is a sibling leaf component.
        html_input = (
            '<body id="test-surf">\n'
            '  <ui-card id="card_1">\n'
            '    <ui-column id="col_1">\n'
            '      <ui-text id="text_1" text="Text 1">\n'
            '      <ui-text id="text_2" text="Text 2" />\n'
            "    </ui-column>\n"
            "  </ui-card>\n"
            "</body>"
        )
        result = self.compiler.compile(html_input)
        components = result["createSurface"]["components"]
        # We should have 4 components: text_1, text_2, col_1, card_1
        self.assertEqual(len(components), 4)

        text_1 = next(c for c in components if c["id"] == "text_1")
        text_2 = next(c for c in components if c["id"] == "text_2")
        col_1 = next(c for c in components if c["id"] == "col_1")

        self.assertEqual(text_1["text"], "Text 1")
        self.assertEqual(text_2["text"], "Text 2")
        self.assertEqual(col_1["children"], ["text_1", "text_2"])

    def test_compile_component_with_slots(self):
        # Modal is not a standard container tag but has slot properties (trigger, content)
        html_input = (
            '<body id="test-surf">\n'
            '  <ui-modal id="delete_modal">\n'
            '    <ui-button id="delete_trigger_btn" slot="trigger">\n'
            '      <ui-text id="delete_trigger_text" text="Delete Account" />\n'
            "    </ui-button>\n"
            '    <ui-column id="delete_confirmation_col" slot="content">\n'
            '      <ui-text id="confirm_title" text="# Confirm Account Deletion" />\n'
            "    </ui-column>\n"
            "  </ui-modal>\n"
            "</body>"
        )
        result = self.compiler.compile(html_input)
        components = result["createSurface"]["components"]

        # Verify that trigger and content are correctly slotted as IDs on the Modal component
        modal = next(c for c in components if c["id"] == "delete_modal")
        self.assertEqual(modal["trigger"], "delete_trigger_btn")
        self.assertEqual(modal["content"], "delete_confirmation_col")

    def test_compile_kebab_case_enum_matching(self):
        # 'justify' on Row expects 'spaceBetween'. Test passing 'space-between'
        html_input = (
            '<body id="test-surf">\n'
            '  <ui-row id="row_1" justify="space-between">\n'
            '    <ui-text id="text_1" text="Hello" />\n'
            "  </ui-row>\n"
            "</body>"
        )
        result = self.compiler.compile(html_input)
        components = result["createSurface"]["components"]
        row = components[1]
        self.assertEqual(row["justify"], "spaceBetween")

    def test_compile_bracket_indexing(self):
        html_input = (
            '<body id="test-surf">\n'
            '  <ui-image id="img_1" url="{$/product/thumbs[0]}" />\n'
            "</body>"
        )
        result = self.compiler.compile(html_input)
        components = result["createSurface"]["components"]
        img = components[0]
        self.assertEqual(img["url"], {"path": "/product/thumbs/0"})

    def test_compile_button_fallback_action(self):
        html_input = (
            '<body id="test-surf">\n'
            '  <ui-button id="btn_1" variant="primary">\n'
            '    <ui-text id="txt_1" text="Submit" />\n'
            "  </ui-button>\n"
            "</body>"
        )
        result = self.compiler.compile(html_input)
        components = result["createSurface"]["components"]
        btn = next(c for c in components if c["id"] == "btn_1")
        self.assertIn("action", btn)
        self.assertEqual(
            btn["action"],
            {
                "event": {
                    "name": "btn_1_clicked",
                    "context": {"component": "Button", "property": "action"},
                }
            },
        )

    def test_compile_list_template_path(self):
        html_input = (
            '<body id="test-surf">\n'
            '  <ui-list id="lst_1">\n'
            '    <template path="{$/items}">\n'
            '      <ui-text id="txt_1" text="{$name}" />\n'
            "    </template>\n"
            "  </ui-list>\n"
            "</body>"
        )
        result = self.compiler.compile(html_input)
        components = result["createSurface"]["components"]
        lst = next(c for c in components if c["id"] == "lst_1")
        self.assertEqual(lst["children"], {"path": "/items", "componentId": "txt_1"})

    def test_resolve_action_property_name_case_insensitive_multiple(self):
        original_get_property_schema = self.compiler.helper.get_property_schema
        try:
            self.compiler.helper.get_property_schema = lambda comp, prop: (
                {"type": "object", "$ref": "#/definitions/Action"}
                if prop in ["onSubmit", "onClick"]
                else None
            )

            # 1. Exact match onSubmit
            res1 = self.compiler._resolve_action_property_name(
                "onSubmit", "TestComponent", ["onSubmit", "onClick"]
            )
            self.assertEqual(res1, "onSubmit")

            # 2. Case-insensitive onClick vs onClick
            res2 = self.compiler._resolve_action_property_name(
                "onclick", "TestComponent", ["onSubmit", "onClick"]
            )
            self.assertEqual(res2, "onClick")

            # 3. Exact match onClick
            res3 = self.compiler._resolve_action_property_name(
                "onClick", "TestComponent", ["onSubmit", "onClick"]
            )
            self.assertEqual(res3, "onClick")
        finally:
            self.compiler.helper.get_property_schema = original_get_property_schema

    def test_is_action_property_edge_cases(self):
        # 1. Non-dict input
        self.assertFalse(_is_action_property(None))
        self.assertFalse(_is_action_property("string"))
        # 2. oneOf/anyOf/allOf recursive match
        schema = {"oneOf": [{"type": "string"}, {"$ref": "#/definitions/Action"}]}
        self.assertTrue(_is_action_property(schema))
        schema_none = {"anyOf": [{"type": "string"}]}
        self.assertFalse(_is_action_property(schema_none))

    def test_has_label_value_edge_cases(self):
        # 1. Non-dict input
        self.assertFalse(_has_label_value(None))
        # 2. allOf/oneOf/anyOf matching options
        schema = {"oneOf": [{"properties": {"label": {}, "value": {}}}]}
        self.assertTrue(_has_label_value(schema))

    def test_schema_expects_option_objects_edge_cases(self):
        # 1. Non-dict input
        self.assertFalse(_schema_expects_option_objects(None))
        # 2. oneOf/anyOf/allOf recursive match
        schema = {"oneOf": [{"items": {"properties": {"label": {}, "value": {}}}}]}
        self.assertTrue(_schema_expects_option_objects(schema))

    def test_get_enum_values_edge_cases(self):
        # 1. Non-dict input
        self.assertIsNone(_get_enum_values(None))
        # 2. recursive enum lookup
        schema = {"oneOf": [{"enum": [1, 2, 3]}]}
        self.assertEqual(_get_enum_values(schema), [1, 2, 3])

    def test_escape_nested_script_tags_edge_cases(self):
        # 1. Unclosed script tag
        self.assertEqual(
            _escape_nested_script_tags("<script type='application/json'"),
            "<script type='application/json'",
        )
        # 2. Backslash and escape sequence inside JSON string properties
        html = '<script type="application/json">{"code": "foo\\\\\\"bar"}</script>'
        self.assertEqual(_escape_nested_script_tags(html), html)
        # 3. script closing tag in JSON string
        html_with_nested = (
            '<script type="application/json">{"html": "</script>"}</script>'
        )
        expected = '<script type="application/json">{"html": "<\\/script>"}</script>'
        self.assertEqual(_escape_nested_script_tags(html_with_nested), expected)

    def test_compiler_extended_coverage(self):
        """Test event dict kwargs, positional function args, and on-handler mappings."""
        # 1. Event with dict kwargs in expression parser
        html_dict_event = (
            '<body><ui-button id="b1" onclick="{Event(\'click_evt\', {id:'
            ' 123})}">Click</ui-button></body>'
        )
        result_dict = self.compiler.compile(html_dict_event)
        comps = result_dict["createSurface"]["components"]
        btn = next(c for c in comps if c["id"] == "b1")
        self.assertEqual(
            btn["action"], {"event": {"name": "click_evt", "context": {"id": 123}}}
        )

        # 2. Function calls with positional args and action functions
        html_fn = (
            '<body><ui-text id="t1" text="{formatDate(user.created, \'YYYY-MM-DD\')}"'
            " /></body>"
        )
        result_fn = self.compiler.compile(html_fn)
        comps_fn = result_fn["createSurface"]["components"]
        txt = next(c for c in comps_fn if c["id"] == "t1")
        self.assertIn("text", txt)

        # 3. Action function call
        html_act_fn = (
            '<body><ui-button id="b2"'
            " onclick=\"{openUrl('https://a2ui.org')}\">Link</ui-button></body>"
        )
        result_act_fn = self.compiler.compile(html_act_fn)
        comps_act = result_act_fn["createSurface"]["components"]
        btn2 = next(c for c in comps_act if c["id"] == "b2")
        self.assertEqual(btn2["action"]["functionCall"]["call"], "openUrl")

        # 4. On-handler mapping to action
        html_on = (
            '<body><ui-button id="b3"'
            " on-click=\"event('submit')\">Submit</ui-button></body>"
        )
        result_on = self.compiler.compile(html_on)
        comps_on = result_on["createSurface"]["components"]
        btn3 = next(c for c in comps_on if c["id"] == "b3")

    def test_expression_parser_object_literals(self):
        """Test expression parser object literals with string keys, commas, and syntax errors."""
        from a2ui.inference_formats.experimental.elemental.expression_parser import ElementalExpressionParser, Scanner

        ep = ElementalExpressionParser()

        # 1. String keys and trailing commas
        scanner1 = Scanner("{'k1': 'v1', \"k2\": 2,}")
        res1 = ep.parse_object_literal(scanner1, 0)
        self.assertEqual(res1, {"k1": "v1", "k2": 2})

        # 2. Syntax errors
        with self.assertRaises(ValueError):
            ep.parse_object_literal(Scanner("{'key'}"), 0)

        with self.assertRaises(ValueError):
            ep.parse_object_literal(Scanner("{key 123}"), 0)

        with self.assertRaises(ValueError):
            ep.parse_object_literal(Scanner("{key: 123"), 0)

    def test_compiler_slots_and_errors(self):
        """Test script slots with invalid JSON and explicit child slots matching array properties."""
        # 1. Script slot invalid JSON
        html_bad_json = (
            '<body><ui-button id="b1"><script type="application/json"'
            ' slot="action">{bad_json}</script></ui-button></body>'
        )
        with self.assertRaises(ValueError):
            self.compiler.compile(html_bad_json)

        # 2. Child slot matching array property
        html_array_slot = (
            '<body><ui-card id="c1"><ui-button id="b1"'
            ' slot="child">B1</ui-button></ui-card></body>'
        )
        res = self.compiler.compile(html_array_slot)
        comps = res["createSurface"]["components"]
        card = next(c for c in comps if c["id"] == "c1")
        self.assertEqual(card.get("child"), "b1")

    def test_compiler_schema_helpers_recursive(self):
        """Test recursive branches of _property_schema_accepts_components and option helpers."""
        from a2ui.inference_formats.experimental.elemental.compiler import (
            _property_schema_accepts_components,
            _schema_expects_option_objects,
            _has_label_value,
        )

        s_items = {"items": {"$ref": "#/definitions/ComponentId"}}
        self.assertTrue(_property_schema_accepts_components(s_items))

        s_oneof = {"oneOf": [{"$ref": "#/definitions/ComponentId"}]}
        self.assertTrue(_property_schema_accepts_components(s_oneof))

        s_opt_all = {"allOf": [{"items": {"properties": {"label": {}, "value": {}}}}]}
        self.assertTrue(_schema_expects_option_objects(s_opt_all))

        s_lbl_all = {"allOf": [{"properties": {"label": {}, "value": {}}}]}
        self.assertTrue(_has_label_value(s_lbl_all))

    def test_compiler_and_decompiler_edge_branches(self):
        """Test streaming compile, dataModel script tags, and component ref schema helpers."""
        from a2ui.inference_formats.experimental.elemental.decompiler import _is_component_reference_property

        # 1. _is_component_reference_property with oneOf
        s_oneof = {"oneOf": [{"$ref": "#/definitions/ComponentId"}]}
        self.assertTrue(_is_component_reference_property(s_oneof))

        # 2. is_final=False streaming compilation
        html_stream = '<body><ui-button id="b1" text="Click" /></body>'
        res_stream = self.compiler.compile(html_stream, is_final=False)
        self.assertIn("createSurface", res_stream)

        # 3. dataModel script in body
        html_dm = (
            '<body><script type="application/json">{"user": "Alice"}</script><ui-text'
            ' id="t1" text="Hi" /></body>'
        )
        res_dm = self.compiler.compile(html_dm)
        self.assertEqual(res_dm["createSurface"]["dataModel"], {"user": "Alice"})

    def test_compiler_checks_transformation(self):
        """Test transformation of validation checks in elemental compiler."""
        html_checks = (
            '<body><ui-text-field id="tf1" value="hello" checks="{[required(\'Field'
            " required'), {condition: min(5), message: 'Too short'}]}\" /></body>"
        )
        res = self.compiler.compile(html_checks)
        comps = res["createSurface"]["components"]
        tf = next(c for c in comps if c["id"] == "tf1")
        self.assertEqual(len(tf["checks"]), 2)
        self.assertIn("condition", tf["checks"][0])

    def test_compiler_template_errors(self):
        """Test error cases for <template> tags in elemental compiler."""
        # 1. Missing path attribute
        html_no_path = (
            '<body><ui-card id="c1"><template><ui-text id="t1" text="Item"'
            " /></template></ui-card></body>"
        )
        with self.assertRaises(ValueError):
            self.compiler.compile(html_no_path)

        # 2. Path attribute not a dynamic binding
        html_bad_path = (
            '<body><ui-card id="c1" path="static_string"><template><ui-text id="t1"'
            ' text="Item" /></template></ui-card></body>'
        )
        with self.assertRaises(ValueError):
            self.compiler.compile(html_bad_path)

    def test_compiler_template_script_slots(self):
        """Test script slots inside template nodes and raw action string expressions."""
        # 1. Script slot inside template node
        html_tmpl_script = (
            "<body>"
            '<ui-card id="c1" path="{items}">'
            '<template><ui-text id="t1" text="item" /></template>'
            '<script type="application/json" slot="action">{"event": "click"}</script>'
            "</ui-card>"
            "</body>"
        )
        res1 = self.compiler.compile(html_tmpl_script)
        comps1 = res1["createSurface"]["components"]
        card = next(c for c in comps1 if c["id"] == "c1")
        self.assertEqual(card["action"], {"event": "click"})

        # 2. Raw action string without outer braces
        html_raw_act = '<body><ui-button id="b2" action="Event(\'press\')" /></body>'
        res2 = self.compiler.compile(html_raw_act)
        comps2 = res2["createSurface"]["components"]
        btn = next(c for c in comps2 if c["id"] == "b2")
        self.assertEqual(btn["action"], "Event('press')")

    def test_resolve_action_property_name_direct(self):
        """Test _resolve_action_property_name with various on-handler casing variations."""
        props = ["action", "click", "on_press"]
        self.assertEqual(
            self.compiler._resolve_action_property_name("on-click", "Button", props),
            "on-click",
        )
        self.assertEqual(
            self.compiler._resolve_action_property_name("onclick", "Button", props),
            "action",
        )

    def test_compiler_event_dict_args(self):
        """Test event function call with dict args."""
        html_evt_dict = (
            '<body><ui-button id="b4" onclick="event({name: \'ev1\', context: {x:'
            ' 99}})" /></body>'
        )
        res_evt = self.compiler.compile(html_evt_dict)
        comps_evt = res_evt["createSurface"]["components"]
        btn4 = next(c for c in comps_evt if c["id"] == "b4")
        self.assertEqual(btn4["action"], "event({name: 'ev1', context: {x: 99}})")


if __name__ == "__main__":
    unittest.main()
