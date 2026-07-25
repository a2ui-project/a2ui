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

"""Unit tests focusing on the A2UI Elemental Decompiler."""

import json
import os
import unittest

from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog
from a2ui.inference_formats.experimental.elemental.parser import ElementalParser

SPEC_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..", "..", "specification", "v1_0"
    )
)
CATALOG_PATH = os.path.join(SPEC_DIR, "catalogs", "basic", "catalog.json")


class TestElementalParser(unittest.TestCase):
    """Test suite covering the Elemental decompiler and value formatting."""

    def setUp(self):
        """Initializes standard test paths and schema helpers."""
        self.catalog_path = CATALOG_PATH
        with open(self.catalog_path, "r", encoding="utf-8") as f:
            catalog_dict = json.load(f)
        self.catalog = Catalog.from_json(catalog_dict, spec_version="0.9.1")

    def test_decompile_delete_surface(self):
        decompiler = ElementalParser(self.catalog)
        envelope = {
            "version": "v1.0",
            "deleteSurface": {"surfaceId": "dashboard-surface-1"},
        }
        html_output = decompiler.decompile(envelope)
        self.assertEqual(
            html_output, '<ui-delete-surface surface-id="dashboard-surface-1" />'
        )

    def test_decompile_call_function(self):
        decompiler = ElementalParser(self.catalog)
        envelope = {
            "version": "v1.0",
            "functionCallId": "call_1",
            "wantResponse": True,
            "callFunction": {
                "call": "openUrl",
                "args": {"url": "https://example.com"},
            },
        }
        html_output = decompiler.decompile(envelope)
        self.assertEqual(
            html_output,
            '<ui-call-function id="call_1" name="openUrl" url="https://example.com"'
            ' want-response="{true}" />',
        )

    def test_decompile_update_data_model(self):
        decompiler = ElementalParser(self.catalog)
        envelope = {
            "version": "v1.0",
            "updateDataModel": {
                "surfaceId": "my-surf",
                "value": {"foo": "bar", "num": 42},
            },
        }
        html_output = decompiler.decompile(envelope)
        expected = (
            '<body id="my-surf">\n'
            '  <script type="application/json">\n'
            "    {\n"
            '      "foo": "bar",\n'
            '      "num": 42\n'
            "    }\n"
            "  </script>\n"
            "</body>"
        )
        self.assertEqual(html_output, expected)

    def test_decompile_create_surface_basic(self):
        decompiler = ElementalParser(self.catalog)
        envelope = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "test-surf",
                "catalogId": "https://a2ui.org/catalog.json",
                "dataModel": {"title": "Hello World"},
                "components": [
                    {
                        "id": "comp_0",
                        "component": "Card",
                        "weight": 4,
                        "child": "comp_1",
                    },
                    {
                        "id": "comp_1",
                        "component": "Text",
                        "text": {"path": "/title"},
                    },
                ],
            },
        }
        html_output = decompiler.decompile(envelope)
        expected = (
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
        self.assertEqual(html_output, expected)

    def test_decompile_omits_default_catalog_link(self):
        decompiler = ElementalParser(self.catalog)
        envelope = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "test-surf",
                "catalogId": (
                    "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
                ),
                "dataModel": {"title": "Hello World"},
                "components": [
                    {
                        "id": "comp_0",
                        "component": "Card",
                        "weight": 4,
                        "child": "comp_1",
                    },
                    {
                        "id": "comp_1",
                        "component": "Text",
                        "text": {"path": "/title"},
                    },
                ],
            },
        }
        html_output = decompiler.decompile(envelope)
        expected = (
            '<body id="test-surf">\n'
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
        self.assertEqual(html_output, expected)

    def test_decompile_options_contraction(self):
        # ChoicePicker is the dropdown component in the basic catalog
        decompiler = ElementalParser(self.catalog)
        envelope = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "test-surf",
                "components": [{
                    "id": "picker_1",
                    "component": "ChoicePicker",
                    "options": [
                        {"label": "Red", "value": "Red"},
                        {"label": "Blue", "value": "Blue"},
                    ],
                }],
            },
        }
        html_output = decompiler.decompile(envelope)
        self.assertIn("options=\"{['Red', 'Blue']}\"", html_output)

    def test_decompile_complex_slot_property(self):
        # Test script slot using ChoicePicker options (where label and value differ in case)
        decompiler = ElementalParser(self.catalog)
        envelope = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "test-surf",
                "components": [{
                    "id": "picker_1",
                    "component": "ChoicePicker",
                    "options": [
                        {"label": "Red", "value": "red"},
                        {"label": "Blue", "value": "blue"},
                    ],
                }],
            },
        }
        html_output = decompiler.decompile(envelope)
        self.assertIn('<script type="application/json" slot="options">', html_output)
        self.assertIn('"label": "Red"', html_output)
        self.assertIn('"value": "red"', html_output)

    def test_decompile_actions_and_events(self):
        decompiler = ElementalParser(self.catalog)
        envelope = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "test-surf",
                "components": [
                    {
                        "id": "btn_1",
                        "component": "Button",
                        "action": {
                            "event": {
                                "name": "submit",
                                "context": {"id": 123},
                            }
                        },
                        "child": "text_1",
                    },
                    {
                        "id": "text_1",
                        "component": "Text",
                        "text": "Submit",
                    },
                ],
            },
        }
        html_output = decompiler.decompile(envelope)
        self.assertIn("onclick=\"{Event('submit', {id: 123})}\"", html_output)

    def test_decompile_checks_with_implicit_value(self):
        # TextField is the input component in the basic catalog
        decompiler = ElementalParser(self.catalog)
        envelope = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "test-surf",
                "components": [{
                    "id": "input_1",
                    "component": "TextField",
                    "value": {"path": "/dob"},
                    "checks": [{
                        "condition": {
                            "call": "required",
                            "args": {"value": {"path": "/dob"}},
                        }
                    }],
                }],
            },
        }
        html_output = decompiler.decompile(envelope)
        # The 'value' argument in 'required' should be omitted because it matches the component's value path
        self.assertIn('checks="{[required()]}"', html_output)

    def test_decompile_checks_with_custom_message(self):
        decompiler = ElementalParser(self.catalog)
        envelope = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "test-surf",
                "components": [{
                    "id": "input_1",
                    "component": "TextField",
                    "value": {"path": "/dob"},
                    "checks": [{
                        "condition": {
                            "call": "required",
                            "args": {"value": {"path": "/dob"}},
                        },
                        "message": "DOB is required",
                    }],
                }],
            },
        }
        html_output = decompiler.decompile(envelope)
        self.assertIn(
            "checks=\"{[required(message: 'DOB is required')]}\"", html_output
        )

    def test_decompile_list_with_template(self):
        decompiler = ElementalParser(self.catalog)
        envelope = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "test-surf",
                "components": [
                    {
                        "id": "list_1",
                        "component": "List",
                        "children": {
                            "path": "/items",
                            "componentId": "item_text",
                        },
                    },
                    {
                        "id": "item_text",
                        "component": "Text",
                        "text": {"path": "name"},
                    },
                ],
            },
        }
        html_output = decompiler.decompile(envelope)
        expected_list = (
            '  <ui-list id="list_1" path="{$/items}">\n'
            "    <template>\n"
            '      <ui-text id="item_text" text="{$name}" />\n'
            "    </template>\n"
            "  </ui-list>"
        )
        self.assertIn(expected_list, html_output)

    def test_decompile_custom_template_property(self):
        catalog = A2uiCatalog(
            version="1.0",
            name="custom_catalog",
            experiments={"version_1_0"},
            s2c_schema={},
            common_types_schema={},
            catalog_schema={
                "catalogId": "https://a2ui.org/custom_catalog",
                "components": {
                    "CustomList": {"properties": {"template": {"type": "string"}}},
                    "Text": {"properties": {"text": {"type": "string"}}},
                },
            },
        )
        decompiler = ElementalParser(catalog)
        envelope = {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "test-surf",
                "components": [
                    {"id": "list_1", "component": "CustomList", "template": "item_1"},
                    {"id": "item_1", "component": "Text", "text": "Hello"},
                ],
            },
        }
        html_output = decompiler.decompile(envelope)
        self.assertIn("<template>", html_output)
        self.assertIn('<ui-text id="item_1"', html_output)

    def test_decompile_named_slots(self):
        catalog = A2uiCatalog(
            version="1.0",
            name="custom_catalog",
            experiments={"version_1_0"},
            s2c_schema={},
            common_types_schema={},
            catalog_schema={
                "catalogId": "https://a2ui.org/custom_catalog",
                "components": {
                    "CustomCard": {
                        "properties": {
                            "leading": {"$ref": "#/definitions/ComponentId"},
                            "trailing": {
                                "type": "array",
                                "items": {"$ref": "#/definitions/ComponentId"},
                            },
                        }
                    },
                    "Text": {"properties": {"text": {"type": "string"}}},
                },
                "definitions": {"ComponentId": {"type": "string"}},
            },
        )
        decompiler = ElementalParser(catalog)
        envelope = {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "test-surf",
                "components": [
                    {
                        "id": "card_1",
                        "component": "CustomCard",
                        "leading": "item_1",
                        "trailing": ["item_2"],
                    },
                    {"id": "item_1", "component": "Text", "text": "Leading Item"},
                    {"id": "item_2", "component": "Text", "text": "Trailing Item"},
                ],
            },
        }
        html_output = decompiler.decompile(envelope)
        self.assertIn('slot="leading"', html_output)
        self.assertIn('slot="trailing"', html_output)

    def test_decompile_boolean_and_null_attributes(self):
        decompiler = ElementalParser(self.catalog)
        envelope = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "test-surf",
                "components": [{
                    "id": "comp_1",
                    "component": "TextField",
                    "disabled": True,
                    "required": False,
                    "placeholder": None,
                }],
            },
        }
        html_output = decompiler.decompile(envelope)
        self.assertIn('disabled="{true}"', html_output)
        self.assertIn('required="{false}"', html_output)
        self.assertIn('placeholder="{null}"', html_output)

    def test_decompile_checks_with_positional_args(self):
        decompiler = ElementalParser(self.catalog)
        envelope = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "test-surf",
                "components": [{
                    "id": "input_1",
                    "component": "TextField",
                    "value": {"path": "/dob"},
                    "checks": [
                        {
                            "condition": {
                                "call": "required",
                                "args": [{"path": "/dob"}],
                            }
                        }
                    ],
                }],
            },
        }
        html_output = decompiler.decompile(envelope)
        self.assertIn('checks="{[required()]}"', html_output)

    def test_decompile_dict_expressions_and_function_calls(self):
        decompiler = ElementalParser(self.catalog)
        envelope = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "test-surf",
                "components": [
                    {
                        "id": "btn_1",
                        "component": "Button",
                        "action": {
                            "functionCall": {
                                "call": "openUrl",
                                "args": {"url": "https://example.com"},
                            }
                        },
                        "child": "text_1",
                    },
                    {
                        "id": "text_1",
                        "component": "Text",
                        "text": {"foo": "bar", "num": 123},
                    },
                ],
            },
        }
        html_output = decompiler.decompile(envelope)
        self.assertIn("onclick=\"{openUrl(url: 'https://example.com')}\"", html_output)
        self.assertIn('<script type="application/json" slot="text">', html_output)
        self.assertIn('"foo": "bar"', html_output)

    def test_decompile_multiple_actions_prefixing(self):
        catalog = A2uiCatalog(
            version="1.0",
            name="custom_catalog",
            experiments={"version_1_0"},
            s2c_schema={},
            common_types_schema={},
            catalog_schema={
                "catalogId": "https://a2ui.org/custom_catalog",
                "components": {
                    "MultiActionButton": {
                        "properties": {
                            "onPress": {"$ref": "#/definitions/Action"},
                            "ongoing": {"$ref": "#/definitions/Action"},
                        }
                    }
                },
            },
        )
        decompiler = ElementalParser(catalog)
        envelope = {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "test-surf",
                "components": [{
                    "id": "btn_1",
                    "component": "MultiActionButton",
                    "onPress": {
                        "event": {
                            "name": "press",
                        }
                    },
                    "ongoing": {
                        "event": {
                            "name": "going",
                        }
                    },
                }],
            },
        }
        html_output = decompiler.decompile(envelope)
        self.assertIn("on-press=\"{Event('press')}\"", html_output)
        self.assertIn("on-ongoing=\"{Event('going')}\"", html_output)

    def test_decompile_call_and_dict_expressions(self):
        """Test decompilation of call objects and arbitrary dict expressions in Elemental format."""
        decompiler = ElementalParser(self.catalog)
        envelope = {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "test-surf",
                "components": [{
                    "id": "txt_1",
                    "component": "Text",
                    "text": {
                        "call": "formatDate",
                        "args": {"value": {"path": "created_at"}},
                    },
                    "custom_dict": {"key_one": "val1", "key with space": "val2"},
                }],
            },
        }
        html_output = decompiler.decompile(envelope)
        self.assertIn("formatDate", html_output)
        self.assertIn("key_one", html_output)

    def test_decompile_contracted_options(self):
        """Test decompilation of contractable options list where label equals value."""
        decompiler = ElementalParser(self.catalog)
        envelope = {
            "version": "1.0",
            "createSurface": {
                "surfaceId": "test-surf",
                "components": [{
                    "id": "picker_1",
                    "component": "ChoicePicker",
                    "options": [
                        {"label": "opt1", "value": "opt1"},
                        {"label": "opt2", "value": "opt2"},
                    ],
                }],
            },
        }
        html_output = decompiler.decompile(envelope)
        self.assertIn("options", html_output)


if __name__ == "__main__":
    unittest.main()
