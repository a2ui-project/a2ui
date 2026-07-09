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

os.environ["A2UI_EXPRESS_ENABLED"] = "true"

from a2ui.core.catalog import Catalog
from a2ui.experimental.elemental.compiler import ElementalCompiler

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
            " \"<html><body><script>console.log('hello');</script></body></html>\"\n   "
            ' }\n  </script>\n  <ui-text id="text1" text="{$/embedded_html}"'
            " />\n</body>"
        )
        result = self.compiler.compile(html_input)
        self.assertEqual(
            result["createSurface"]["dataModel"]["embedded_html"],
            "<html><body><script>console.log('hello');</script></body></html>",
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


if __name__ == "__main__":
    unittest.main()
