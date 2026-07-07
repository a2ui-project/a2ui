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
    html_input = '<a2ui-delete-surface surface-id="dashboard-surface-1" />'
    result = self.compiler.compile(html_input)
    expected = {
        "version": "v1.0",
        "deleteSurface": {"surfaceId": "dashboard-surface-1"},
    }
    self.assertEqual(result, expected)

  def test_compile_call_function(self):
    html_input = (
        '<a2ui-call-function id="call_1" name="openUrl" url="https://example.com"'
        ' want-response="{true}" />'
    )
    result = self.compiler.compile(html_input)
    expected = {
        "version": "v1.0",
        "functionCallId": "call_1",
        "callFunction": {
            "call": "openUrl",
            "args": {"url": "https://example.com"},
            "wantResponse": True,
        },
    }
    self.assertEqual(result, expected)

  def test_compile_update_data_model(self):
    html_input = (
        '<body id="my-surf">\n'
        '  <script type="application/json">\n'
        '    {\n'
        '      "foo": "bar",\n'
        '      "num": 42\n'
        '    }\n'
        '  </script>\n'
        '</body>'
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
        '    {\n'
        '      "title": "Hello World"\n'
        '    }\n'
        '  </script>\n'
        '  <a2ui-card id="comp_0" weight="{4}">\n'
        '    <a2ui-text id="comp_1">{$/title}</a2ui-text>\n'
        '  </a2ui-card>\n'
        '</body>'
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
    
    self.assertEqual(comp_card["id"], "root")
    self.assertEqual(comp_card["component"], "Card")
    self.assertEqual(comp_card["weight"], 4)
    self.assertEqual(comp_card["child"], "comp_1")

  def test_compile_options_expansion(self):
    # ChoicePicker is the dropdown component in the basic catalog
    html_input = (
        '<body id="test-surf">\n'
        '  <a2ui-choice-picker id="picker_1" options="{[\'Red\', \'Blue\']}" />\n'
        '</body>'
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
        ]
    )

  def test_compile_complex_slot_property(self):
    # Test script slot using ChoicePicker options (where label and value differ in case)
    html_input = (
        '<body id="test-surf">\n'
        '  <a2ui-choice-picker id="picker_1">\n'
        '    <script type="application/json" slot="options">\n'
        '      [\n'
        '        {"label": "Red", "value": "red"},\n'
        '        {"label": "Blue", "value": "blue"}\n'
        '      ]\n'
        '    </script>\n'
        '  </a2ui-choice-picker>\n'
        '</body>'
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
        ]
    )

  def test_compile_actions_and_events(self):
    html_input = (
        '<body id="test-surf">\n'
        '  <a2ui-button id="btn_1" onclick="{Event(\'submit\', {id: 123})}">\n'
        '    <a2ui-text id="text_1">Submit</a2ui-text>\n'
        '  </a2ui-button>\n'
        '</body>'
    )
    result = self.compiler.compile(html_input)
    components = result["createSurface"]["components"]
    self.assertEqual(len(components), 2)
    btn = components[1]
    self.assertEqual(btn["id"], "root")
    self.assertEqual(
        btn["action"],
        {
            "event": {
                "name": "submit",
                "context": {"id": 123},
            }
        }
    )

  def test_compile_checks_with_implicit_value(self):
    # TextField is the input component in the basic catalog
    html_input = (
        '<body id="test-surf">\n'
        '  <a2ui-text-field id="input_1" value="{$/dob}" checks="{[required()]}" />\n'
        '</body>'
    )
    result = self.compiler.compile(html_input)
    components = result["createSurface"]["components"]
    self.assertEqual(len(components), 1)
    text_field = components[0]
    self.assertEqual(text_field["id"], "root")
    self.assertEqual(text_field["value"], {"path": "/dob"})
    self.assertEqual(
        text_field["checks"],
        [
            {
                "condition": {
                    "call": "required",
                    "args": {"value": {"path": "/dob"}},
                },
                "message": "Invalid input"
            }
        ]
    )

  def test_compile_list_with_template(self):
    html_input = (
        '<body id="test-surf">\n'
        '  <a2ui-list id="list_1" path="{$/items}">\n'
        '    <template>\n'
        '      <a2ui-text id="item_text">{$name}</a2ui-text>\n'
        '    </template>\n'
        '  </a2ui-list>\n'
        '</body>'
    )
    result = self.compiler.compile(html_input)
    components = result["createSurface"]["components"]
    self.assertEqual(len(components), 2)
    item_text = components[0]
    lst = components[1]
    
    self.assertEqual(item_text["id"], "item_text")
    self.assertEqual(item_text["text"], {"path": "name"})
    
    self.assertEqual(lst["id"], "root")
    self.assertEqual(
        lst["children"],
        {
            "path": "/items",
            "componentId": "item_text",
        }
    )
    self.assertNotIn("path", lst)
    self.assertNotIn("template", lst)


if __name__ == "__main__":
  unittest.main()
