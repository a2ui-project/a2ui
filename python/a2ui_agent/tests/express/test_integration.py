# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""End-to-end integration and round-trip verification tests for A2UI Express."""

import os
import glob
import json
import unittest
from typing import Any

from a2ui.core.catalog import Catalog
from a2ui.inference_formats.experimental.express.compiler import ExpressCompiler
from a2ui.inference_formats.experimental.express.parser import ExpressParser
from a2ui.inference_formats.experimental.express.schema_helper import (
    CatalogSchemaHelper,
)

from a2ui.schema.utils import (
    find_repo_root,
    get_spec_dir,
)

REPO_ROOT = find_repo_root(os.path.dirname(__file__)) or ""
SPEC_DIR = get_spec_dir("v1_0")
CATALOGS_DIR = os.path.join(REPO_ROOT, "catalogs", "basic")
CATALOG_PATH = os.path.join(CATALOGS_DIR, "v1", "catalog.json")
EXAMPLES_DIR = os.path.join(CATALOGS_DIR, "v1", "examples")


class TestExpressIntegration(unittest.TestCase):
    """End-to-end integration test suite validating compiler, decompiler, and parser loop."""

    def setUp(self):
        """Initializes standard test paths and schema helpers."""
        self.catalog_path = CATALOG_PATH
        with open(self.catalog_path, "r", encoding="utf-8") as f:
            catalog_dict = json.load(f)
        self.catalog = Catalog.from_json(catalog_dict, protocol_version="0.9.1")
        self.helper = CatalogSchemaHelper(self.catalog)

    def test_parser_robustness_and_event_variable_resolution(self):
        """Regression tests for parser fallbacks, empty text parts, and event variable resolution."""
        compiler = ExpressCompiler(self.catalog)

        # 1. Event name and context variable resolution
        dsl_event_var = """
    root = Button("Click", _, Event(MY_EVENT, MY_CONTEXT))
    MY_EVENT = "my_custom_click"
    MY_CONTEXT = {userId: 123, "active": true}
    """
        res = compiler.compile(dsl_event_var)[0]
        btn = res["createSurface"]["components"][0]
        self.assertEqual(btn["action"]["event"]["name"], "my_custom_click")
        self.assertEqual(btn["action"]["event"]["context"]["userId"], 123)
        self.assertEqual(btn["action"]["event"]["context"]["active"], True)

        # 2. Conversational parser robustness (no sentinels)
        conversational_content = (
            "Hello there! I am a conversational response without any UI tags."
        )
        parts = ExpressParser(self.catalog).parse_response(conversational_content)
        self.assertEqual(len(parts), 1)
        self.assertEqual(parts[0].text, conversational_content)
        self.assertIsNone(parts[0].a2ui_json)

        # 3. Empty text part omission
        ui_only_content = '<a2ui>root = Text("Hello")</a2ui>'
        parts_ui = ExpressParser(self.catalog).parse_response(ui_only_content)
        self.assertEqual(len(parts_ui), 1)
        self.assertEqual(parts_ui[0].text, "")
        self.assertIsNotNone(parts_ui[0].a2ui_json)

    def test_template_validation_and_decompiler_quoted_keys(self):
        """Regression tests for template path validation, decompiler dictionary key quoting, and check message string formatting."""
        compiler = ExpressCompiler(self.catalog)
        decompiler = ExpressParser(self.catalog)

        # 1. Test template path validation in compiler
        dsl_invalid_template = (
            'root = List(_template("invalid_string_no_dollar",'
            " itemTemplate))\nitemTemplate = Text($/val)"
        )
        with self.assertRaises(ValueError) as context:
            compiler.compile(dsl_invalid_template)
        self.assertIn("must be a dynamic data binding path", str(context.exception))

        # 2. Test dictionary keys quoting in decompiler
        wire_json_dict = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "main",
                "catalogId": (
                    "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
                ),
                "components": [{
                    "id": "root",
                    "component": "Tabs",
                    "tabs": [{
                        "title": "Overview",
                        "user-id-hyphen": 123,
                        "session token space": "abc",
                        "valid_id": True,
                    }],
                }],
            },
        }
        decompiled_dsl = decompiler.decompile(wire_json_dict)
        self.assertIn(
            'root = Tabs([{title: "Overview", "user-id-hyphen": 123, "session token'
            ' space": "abc", valid_id: true}])',
            decompiled_dsl,
        )

        compiled_back = compiler.compile(decompiled_dsl, surface_id="main")[0]
        compiled_tabs = compiled_back["createSurface"]["components"][0]["tabs"]
        self.assertEqual(len(compiled_tabs), 1)
        self.assertEqual(compiled_tabs[0]["user-id-hyphen"], 123)

        # 3. Test check message formatting with unified string decompiler (supports multiline)
        multiline_msg_envelope = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "main",
                "components": [{
                    "id": "root",
                    "component": "TextField",
                    "label": "Name",
                    "value": {"path": "/name"},
                    "checks": [{
                        "condition": {
                            "call": "required",
                            "args": {"value": {"path": "/name"}},
                        },
                        "message": "First Line\nSecond Line",
                    }],
                }],
            },
        }
        decompiled_msg = decompiler.decompile(multiline_msg_envelope)
        self.assertIn('"""First Line\nSecond Line"""', decompiled_msg)

    def test_sentinel_spacing_literal_matching_multiline_strings_and_boolean_allof_schemas(
        self,
    ):
        """Regression tests for sentinel spacing, literal string matching, multiline string preservation, and boolean allOf schemas."""
        compiler = ExpressCompiler(self.catalog)
        decompiler = ExpressParser(self.catalog)

        # 1. Regression test: Sentinel tag on the same line as a statement
        dsl_sentinel = '<a2ui>root = Column([text1])\ntext1 = Text("Hello")\n</a2ui>'
        res = compiler.compile(dsl_sentinel)[0]
        self.assertIn("createSurface", res)
        components = res["createSurface"]["components"]
        self.assertEqual(len(components), 2)

        # 2. Regression test: Decompiler string literals matching component IDs but not references
        wire_json = {
            "createSurface": {
                "surfaceId": "test_surf",
                "components": [
                    {"id": "root", "component": "Column", "children": ["text1"]},
                    {"id": "text1", "component": "Text", "text": "text1"},
                ],
            }
        }
        decompiled_dsl = decompiler.decompile(wire_json)
        self.assertIn('text1 = Text("text1")', decompiled_dsl)

        # 3. Regression test: Preserve empty lines in multi-line strings
        dsl_multiline = """
root = Column([text1])
text1 = Text("# Heading 1

This is bold.

- Item 1")
"""
        res_multiline = compiler.compile(dsl_multiline)[0]
        compiled_text = res_multiline["createSurface"]["components"][1]["text"]
        self.assertEqual(compiled_text, "# Heading 1\n\nThis is bold.\n\n- Item 1")

    def test_parser_unclosed_tag_parsing(self):
        """Verify parser unclosed tag auto-closing and compilation with is_final=False."""
        truncated_response = (
            "Here is the partial UI:\n"
            "<a2ui>\n"
            "root = Column([text1])\n"
            'text1 = Text("Hello")\n'
            'btn = Button("Cli'
        )
        parts = ExpressParser(self.catalog).parse_response(truncated_response)
        self.assertEqual(len(parts), 1)
        self.assertEqual(parts[0].text, "Here is the partial UI:")
        self.assertIsNotNone(parts[0].a2ui_json)

        compiled_components = parts[0].a2ui_json[0]["createSurface"]["components"]
        self.assertEqual(len(compiled_components), 2)
        self.assertEqual(compiled_components[0]["id"], "root")
        self.assertEqual(compiled_components[1]["id"], "text1")
        self.assertFalse(any(c["id"] == "btn" for c in compiled_components))

    def test_parser_compilation_error_handling(self):
        """Verify that parsing invalid Express syntax raises A2uiCompilationError with error details."""
        from a2ui.parser.errors import A2uiCompilationError

        invalid_response = (
            "Preceding conversation text.\n"
            "<a2ui>\n"
            "root = Column([text1])\n"
            'text1 = Text("Hello")\n'
            "MY_BAD_SYNTAX = {\n"
            "</a2ui>"
        )

        with self.assertRaises(A2uiCompilationError) as ctx:
            ExpressParser(self.catalog).parse_response(invalid_response)

        exc = ctx.exception
        self.assertIn("Syntax error", str(exc))
        self.assertEqual(len(exc.partial_results), 0)
        self.assertIn("MY_BAD_SYNTAX", exc.raw_content)
        self.assertIsNotNone(exc.line)

        # Test multi-block scenario where first compiles and second fails
        multi_response = (
            "First part text.\n"
            "<a2ui>\n"
            'root = Text("First")\n'
            "</a2ui>\n"
            "Second part text.\n"
            "<a2ui>\n"
            "MY_BAD_SYNTAX = {\n"
            "</a2ui>"
        )

        with self.assertRaises(A2uiCompilationError) as ctx:
            ExpressParser(self.catalog).parse_response(multi_response)

        exc_multi = ctx.exception
        self.assertEqual(len(exc_multi.partial_results), 1)
        self.assertEqual(exc_multi.partial_results[0].text, "First part text.")
        self.assertIsNotNone(exc_multi.partial_results[0].a2ui_json)
        self.assertIn("MY_BAD_SYNTAX", exc_multi.raw_content)


if __name__ == "__main__":
    unittest.main()
