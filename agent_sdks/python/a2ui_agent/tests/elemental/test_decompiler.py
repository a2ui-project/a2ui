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

os.environ["A2UI_EXPRESS_ENABLED"] = "true"

from a2ui.core.catalog import Catalog
from a2ui.experimental.elemental.decompiler import ElementalDecompiler

SPEC_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..", "..", "specification", "v1_0"
    )
)
CATALOG_PATH = os.path.join(SPEC_DIR, "catalogs", "basic", "catalog.json")


class TestElementalDecompiler(unittest.TestCase):
    """Test suite covering the Elemental decompiler and value formatting."""

    def setUp(self):
        """Initializes standard test paths and schema helpers."""
        self.catalog_path = CATALOG_PATH
        with open(self.catalog_path, "r", encoding="utf-8") as f:
            catalog_dict = json.load(f)
        self.catalog = Catalog.from_json(catalog_dict, spec_version="0.9.1")

    def test_decompile_delete_surface(self):
        decompiler = ElementalDecompiler(self.catalog)
        envelope = {
            "version": "v1.0",
            "deleteSurface": {"surfaceId": "dashboard-surface-1"},
        }
        html_output = decompiler.decompile(envelope)
        self.assertEqual(
            html_output, '<ui-delete-surface surface-id="dashboard-surface-1" />'
        )

    def test_decompile_call_function(self):
        decompiler = ElementalDecompiler(self.catalog)
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
        decompiler = ElementalDecompiler(self.catalog)
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
        decompiler = ElementalDecompiler(self.catalog)
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
        decompiler = ElementalDecompiler(self.catalog)
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
        decompiler = ElementalDecompiler(self.catalog)
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
        decompiler = ElementalDecompiler(self.catalog)
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
        decompiler = ElementalDecompiler(self.catalog)
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
        decompiler = ElementalDecompiler(self.catalog)
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
        decompiler = ElementalDecompiler(self.catalog)
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
        decompiler = ElementalDecompiler(self.catalog)
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


if __name__ == "__main__":
    unittest.main()
