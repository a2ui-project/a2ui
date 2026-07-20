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

"""End-to-end integration and round-trip verification tests for A2UI Elemental Parser."""

import unittest
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import VERSION_0_9
from a2ui.inference_formats.experimental.elemental.parser import ElementalParser
from a2ui.parser.errors import A2uiCompilationError


class TestElementalIntegration(unittest.TestCase):
    """End-to-end integration test suite validating ElementalParser."""

    def setUp(self):
        """Initializes a standard test catalog."""
        self.catalog = A2uiCatalog(
            version=VERSION_0_9,
            name="test_catalog",
            s2c_schema={},
            common_types_schema={},
            catalog_schema={
                "catalogId": "https://a2ui.org/test_catalog",
                "components": {
                    "Column": {
                        "properties": {
                            "children": {
                                "type": "array",
                                "items": {"type": "object"},
                                "positionalIndex": 0,
                            }
                        }
                    },
                    "Text": {
                        "properties": {"text": {"type": "string", "positionalIndex": 0}}
                    },
                },
                "functions": {},
            },
        )

    def test_elemental_parser_happy_path(self):
        """Verifies parsing of a complete Elemental HTML block."""
        content = (
            "Here is the UI:\n"
            "<a2ui>\n"
            '  <body id="welcome">\n'
            "    <ui-Column>\n"
            '      <ui-Text text="Hello" />\n'
            "    </ui-Column>\n"
            "  </body>\n"
            "</a2ui>"
        )

        parts = ElementalParser(self.catalog).parse_response(content)
        self.assertEqual(len(parts), 1)
        self.assertEqual(parts[0].text, "Here is the UI:")
        self.assertIsNotNone(parts[0].a2ui_json)

        compiled_components = parts[0].a2ui_json[0]["createSurface"]["components"]
        self.assertEqual(len(compiled_components), 2)
        self.assertEqual(compiled_components[0]["id"], "comp_1")
        self.assertEqual(compiled_components[1]["id"], "comp_2")
        self.assertEqual(compiled_components[1]["text"], "Hello")

    def test_elemental_parser_preserves_custom_surface_id(self):
        """Verifies parsing preserves surface ID defined on `<a2ui>` start tag attributes."""
        content = (
            "Here is the UI:\n"
            "<a2ui>\n"
            '  <body id="my-custom-surface-id">\n'
            "    <ui-Column>\n"
            '      <ui-Text text="Hello" />\n'
            "    </ui-Column>\n"
            "  </body>\n"
            "</a2ui>"
        )

        parts = ElementalParser(self.catalog).parse_response(content)
        self.assertEqual(len(parts), 1)
        self.assertEqual(parts[0].text, "Here is the UI:")
        self.assertIsNotNone(parts[0].a2ui_json)

        create_surface = parts[0].a2ui_json[0]["createSurface"]
        self.assertEqual(create_surface["surfaceId"], "my-custom-surface-id")
        self.assertEqual(len(create_surface["components"]), 2)

    def test_elemental_parser_unclosed_tag_parsing(self):
        """Verify parser unclosed tag auto-closing and compilation with is_final=False."""
        truncated_response = (
            'Conversational preamble:\n<a2ui>\n  <body id="welcome">\n    <ui-Column>\n'
            '      <ui-Text text="Hello"'
        )

        parts = ElementalParser(self.catalog).parse_response(truncated_response)
        self.assertEqual(len(parts), 1)
        self.assertEqual(parts[0].text, "Conversational preamble:")
        self.assertIsNotNone(parts[0].a2ui_json)

        compiled_components = parts[0].a2ui_json[0]["createSurface"]["components"]
        # Column and Text should both be parsed. Text is closed gracefully.
        self.assertEqual(len(compiled_components), 2)
        self.assertEqual(compiled_components[0]["id"], "comp_1")
        self.assertEqual(compiled_components[1]["id"], "comp_2")
        self.assertEqual(compiled_components[1]["text"], "Hello")

    def test_elemental_parser_compilation_error_handling(self):
        """Verify that parsing invalid Elemental HTML raises A2uiCompilationError."""
        # Test component validation error (e.g. component not in catalog)
        invalid_response = (
            "Preceding conversation text.\n"
            "<a2ui>\n"
            '  <body id="welcome">\n'
            "    <ui-UnknownComponent>Text</ui-UnknownComponent>\n"
            "  </body>\n"
            "</a2ui>"
        )

        with self.assertRaises(A2uiCompilationError) as ctx:
            ElementalParser(self.catalog).parse_response(invalid_response)

        exc = ctx.exception
        self.assertEqual(len(exc.partial_results), 0)
        self.assertIn("UnknownComponent", exc.raw_content)

        # Test multi-block scenario where first compiles and second fails
        multi_response = (
            "First block:\n"
            "<a2ui>\n"
            '  <body id="welcome">\n'
            "    <ui-Text>First</ui-Text>\n"
            "  </body>\n"
            "</a2ui>\n"
            "Second block:\n"
            "<a2ui>\n"
            '  <body id="welcome">\n'
            "    <ui-UnknownComponent>Second</ui-UnknownComponent>\n"
            "  </body>\n"
            "</a2ui>"
        )

        with self.assertRaises(A2uiCompilationError) as ctx:
            ElementalParser(self.catalog).parse_response(multi_response)

        exc_multi = ctx.exception
        self.assertEqual(len(exc_multi.partial_results), 1)
        self.assertEqual(exc_multi.partial_results[0].text, "First block:")
        self.assertIsNotNone(exc_multi.partial_results[0].a2ui_json)
        self.assertIn("UnknownComponent", exc_multi.raw_content)


if __name__ == "__main__":
    unittest.main()
