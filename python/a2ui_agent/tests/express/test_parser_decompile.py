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

"""Unit tests focusing on the Python A2UI Express Decompiler.

Data-driven input/output decompilation behavior is comprehensively covered by
the platform-agnostic conformance suite in `conformance/agent/express/decompiler.yaml`
(run via `tests/conformance/test_conformance.py`).

These unit tests specifically cover Python language-specific aspects that
conformance suites leave to the SDK implementation:
- String quoting, multi-line formatting, and raw string escaping choices
- Internal schema-driven child reference helper reflection
- Tag detection (`has_format_content`) and tag unwrapping
"""

import json
import os
import unittest

from a2ui.core import Catalog
from a2ui.inference_formats import to_message_dicts
from a2ui.inference_formats.express import (
    ExpressCompiler,
    ExpressParser,
    ExpressValidationError,
)
from a2ui.inference_formats.express.decompiler import _decompile_number

from ..repo_paths import find_repo_root

REPO_ROOT = find_repo_root(os.path.dirname(__file__)) or ""
CATALOGS_DIR = os.path.join(REPO_ROOT, "catalogs", "basic")
CATALOG_PATH = os.path.join(CATALOGS_DIR, "v1", "catalog.json")


class TestExpressParser(unittest.TestCase):
    """Test suite covering the Express decompiler and value formatting."""

    def setUp(self):
        """Initializes standard test paths and schema helpers."""
        self.catalog_path = CATALOG_PATH
        with open(self.catalog_path, "r", encoding="utf-8") as f:
            catalog_dict = json.load(f)
        self.catalog = Catalog.from_json(catalog_dict, protocol_version="1.0")

    def test_string_quoting_and_escaping(self):
        """Verifies parsing, compilation, and decompilation of various string quoting forms."""
        compiler = ExpressCompiler([self.catalog])
        decompiler = ExpressParser([self.catalog])

        def get_compiled_text(dsl_body: str) -> str:
            dsl = f"root = Column([t1])\nt1 = Text({dsl_body})"
            res = to_message_dicts(compiler.compile(dsl))[0]
            return res["createSurface"]["components"][1]["text"]

        # 1. Standard Single-Quoted Strings & Escaping
        self.assertEqual(get_compiled_text('"hello"'), "hello")
        self.assertEqual(get_compiled_text('"hello \\"world\\""'), 'hello "world"')
        self.assertEqual(get_compiled_text('"hello \\n world"'), "hello \n world")
        self.assertEqual(get_compiled_text('"hello \\t world"'), "hello \t world")
        self.assertEqual(get_compiled_text('"hello \\\\ world"'), "hello \\ world")
        self.assertEqual(get_compiled_text('"hello \\x world"'), "hello \\x world")

        # 2. Standard Triple-Quoted Strings
        self.assertEqual(get_compiled_text('"""hello"""'), "hello")
        self.assertEqual(get_compiled_text('"""hello\nworld"""'), "hello\nworld")
        self.assertEqual(
            get_compiled_text('"""hello \\"world\\" """'), 'hello "world" '
        )

        # 3. Raw Strings (Single Quoted)
        self.assertEqual(get_compiled_text('r"hello\\nworld"'), "hello\\nworld")
        self.assertEqual(
            get_compiled_text('r"C:\\path\\to\\file"'), "C:\\path\\to\\file"
        )

        # 4. Raw Strings (Triple Quoted)
        self.assertEqual(get_compiled_text('r"""hello\\nworld"""'), "hello\\nworld")
        self.assertEqual(get_compiled_text('r"""hello "world" """'), 'hello "world" ')

        # 5. Decompiler Formatting Choices
        envelope_quote = compiler.compile('root = Text("hello \\"world\\"")')
        decompiled_quote = decompiler.decompile(envelope_quote)
        self.assertIn('root = Text("hello \\"world\\"")', decompiled_quote)

        envelope_nl = compiler.compile('root = Text("hello \\n world")')
        decompiled_nl = decompiler.decompile(envelope_nl)
        self.assertIn('root = Text("""hello \n world""")', decompiled_nl)

        envelope_cr = compiler.compile('root = Text("hello \\r \\"")')
        decompiled_cr = decompiler.decompile(envelope_cr)
        self.assertIn('root = Text("hello \\r \\"")', decompiled_cr)

        envelope_raw = compiler.compile('root = Text("C:\\\\path\\\\to\\\\file")')
        decompiled_raw = decompiler.decompile(envelope_raw)
        self.assertIn('root = Text(r"C:\\path\\to\\file")', decompiled_raw)

        # 6. Additional Edge Cases
        self.assertEqual(get_compiled_text('""'), "")
        self.assertEqual(get_compiled_text('""""""'), "")
        self.assertEqual(get_compiled_text('r""'), "")
        self.assertEqual(get_compiled_text('r""""""'), "")

        # Raw string ending in a backslash
        self.assertEqual(get_compiled_text('r"hello\\"'), "hello\\")
        self.assertEqual(get_compiled_text('r"""hello\\"""'), "hello\\")

        # Uppercase R prefix
        self.assertEqual(get_compiled_text('R"hello\\nworld"'), "hello\\nworld")
        self.assertEqual(get_compiled_text('R"""hello\\nworld"""'), "hello\\nworld")

        # Standard string ending in a backslash (unterminated quote syntax error)
        with self.assertRaises(SyntaxError):
            compiler.compile('root = Text("hello\\")')

        # Standard string with unescaped nested quote
        with self.assertRaises(ValueError):
            compiler.compile('root = Text("hello "world"")')

        # Unescaped nested parentheses in multi-line strings
        self.assertEqual(
            get_compiled_text('"""hello ) world\nline 2"""'),
            "hello ) world\nline 2",
        )

        # 7. Streaming Compatibility and Tolerance (is_final=False)
        incomplete_dsl = '$/foo = 123\n$/bar = """unclosed string...\n'
        with self.assertRaises(SyntaxError):
            compiler.compile(incomplete_dsl)

        res_partial = to_message_dicts(compiler.compile(incomplete_dsl, is_final=False))
        self.assertEqual(
            res_partial,
            [{
                "version": "1.0",
                "updateDataModel": {
                    "surfaceId": "default_surface",
                    "path": "/foo",
                    "value": 123,
                },
            }],
        )

    def test_schema_driven_child_reference_helper(self):
        """Verify that _is_component_reference_property correctly inspects JSON schema structures."""
        from a2ui.inference_formats.express.decompiler import (
            _is_component_reference_property,
        )

        # Case A: Direct ref to ComponentId
        direct_ref = {
            "$ref": (
                "https://a2ui.org/specification/v1_0/common_types.json#/$defs/ComponentId"
            )
        }
        self.assertTrue(_is_component_reference_property(direct_ref))

        # Case B: Array of ComponentId refs
        array_ref = {
            "type": "array",
            "items": {
                "$ref": (
                    "https://a2ui.org/specification/v1_0/common_types.json#/$defs/ComponentId"
                )
            },
        }
        self.assertTrue(_is_component_reference_property(array_ref))

        # Case C: Direct ref to ChildList
        child_list_ref = {
            "$ref": (
                "https://a2ui.org/specification/v1_0/common_types.json#/$defs/ChildList"
            )
        }
        self.assertTrue(_is_component_reference_property(child_list_ref))

        # Case D: Nested inside oneOf/anyOf/allOf
        nested_ref = {
            "oneOf": [
                {"type": "string"},
                {
                    "$ref": (
                        "https://a2ui.org/specification/v1_0/common_types.json#/$defs/ComponentId"
                    )
                },
            ]
        }
        self.assertTrue(_is_component_reference_property(nested_ref))

        # Case E: Non-ref static type
        static_type = {"type": "string"}
        self.assertFalse(_is_component_reference_property(static_type))

    def test_has_format_content_and_unwrap_tags(self):
        """Test has_format_content checks and unwrap tag tokenization."""
        parser = ExpressParser([self.catalog])
        self.assertTrue(
            parser.has_format_content("<a2ui>root = Text('Hi')</a2ui>", complete=True)
        )
        self.assertFalse(
            parser.has_format_content("<a2ui>root = Text('Hi')", complete=True)
        )
        self.assertTrue(
            parser.has_format_content("<a2ui>root = Text('Hi')", complete=False)
        )

        content = "Intro\n<a2ui>\nroot = Text('Hi')\n</a2ui>\nOutro"
        parts = parser.unwrap(content)
        self.assertEqual(len(parts), 3)
        self.assertEqual(parts[0].part.text, "Intro")
        self.assertIn("root = Text('Hi')", parts[1].part.a2ui_raw)
        self.assertEqual(parts[2].part.text, "Outro")

    def test_number_spelling_matches_ecmascript(self):
        """Verifies numbers are written as ECMAScript `Number.prototype.toString` spells them."""
        cases = [
            (1e-7, "1e-7"),
            (1.5e-5, "0.000015"),
            (1e16, "10000000000000000.0"),
            (1e21, "1e+21"),
            (1.5e300, "1.5e+300"),
            (123456.789, "123456.789"),
            (3.0, "3.0"),
            (-0.0, "-0.0"),
            (7, "7"),
        ]
        for value, expected in cases:
            with self.subTest(value=value):
                self.assertEqual(_decompile_number(value), expected)

    def test_non_finite_numbers_have_no_notation(self):
        """Verifies infinite and NaN values raise ExpressValidationError."""
        for value in [float("inf"), float("-inf"), float("nan")]:
            with self.subTest(value=value):
                with self.assertRaises(ExpressValidationError):
                    _decompile_number(value)

    def test_decompiled_numbers_round_trip(self):
        """Verifies a decompiled exponent-form double compiles back to the same value."""
        compiler = ExpressCompiler([self.catalog])
        decompiler = ExpressParser([self.catalog])
        dsl = 'root = Column([t], weight=1e-7)\nt = Text("Hi")'
        decompiled = decompiler.decompile(compiler.compile(dsl))
        self.assertIn("1e-7)", decompiled)
        messages = to_message_dicts(compiler.compile(decompiled))
        comps = {c["id"]: c for c in messages[0]["createSurface"]["components"]}
        self.assertEqual(comps["root"]["weight"], 1e-7)


class TestExpressDecompileEventAndNestedActions(unittest.TestCase):
    """Covers writing `Event` keyword arguments and nested action slots back out."""

    def setUp(self):
        self.catalog = Catalog.from_json(
            {
                "catalogId": "test/links",
                "components": {
                    "Links": {
                        "type": "object",
                        "properties": {
                            "component": {"const": "Links"},
                            "items": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "label": {"type": "string"},
                                        "action": {
                                            "$ref": "common_types.json#/$defs/Action"
                                        },
                                    },
                                    "required": ["label", "action"],
                                },
                            },
                        },
                        "required": ["component", "items"],
                    },
                },
                "functions": {
                    "openUrl": {
                        "type": "object",
                        "returnType": "void",
                        "properties": {
                            "@call": {"const": "openUrl"},
                            "args": {
                                "type": "object",
                                "properties": {"url": {"type": "string"}},
                                "required": ["url"],
                            },
                        },
                        "required": ["@call", "args"],
                    },
                },
            },
            protocol_version="1.0",
        )
        self.compiler = ExpressCompiler([self.catalog], version="1.0")
        self.decompiler = ExpressParser([self.catalog])

    def _round_trip(self, dsl: str) -> str:
        """Decompiles the compiled DSL and checks the text compiles back the same."""
        compiled = self.compiler.compile(dsl)
        decompiled = self.decompiler.decompile(compiled)
        self.assertEqual(
            to_message_dicts(self.compiler.compile(decompiled)),
            to_message_dicts(compiled),
        )
        return decompiled

    def test_event_user_message_is_written_as_keyword(self):
        decompiled = self._round_trip(
            'root = Links([{label: "Reply", action: Event("reply",'
            ' userMessage="Now")}])'
        )
        self.assertIn('Event("reply", userMessage="Now")', decompiled)

    def test_event_user_message_binding_follows_context(self):
        decompiled = self._round_trip(
            'root = Links([{label: "Reply", action: Event("reply", {threadId:'
            ' "t1"}, userMessage=$/draft/message)}])'
        )
        self.assertIn(
            'Event("reply", {threadId: "t1"}, userMessage=$/draft/message)',
            decompiled,
        )

    def test_event_user_message_function_call_round_trips(self):
        decompiled = self._round_trip(
            'root = Links([{label: "Reply", action: Event("reply",'
            ' userMessage=openUrl("https://a2ui.org"))}])'
        )
        self.assertIn(
            'Event("reply", userMessage=openUrl("https://a2ui.org"))', decompiled
        )

    def test_event_with_user_message_is_a_map_literal_before_v1(self):
        """v0.9 has no userMessage and its compiler rejects `userMessage=`, so the object stays data."""
        catalog = Catalog.from_json(
            {
                "catalogId": "test/v09",
                "components": {
                    "Card": {
                        "type": "object",
                        "properties": {
                            "component": {"const": "Card"},
                            "child": {"type": "object"},
                        },
                        "required": ["component", "child"],
                    }
                },
            },
            protocol_version="0.9",
        )
        decompiled = ExpressParser([catalog], version="v0.9").decompile([{
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "s1",
                "components": [{
                    "id": "root",
                    "component": "Card",
                    "child": {"event": {"name": "go", "userMessage": "hi"}},
                }],
            },
        }])
        self.assertNotIn("Event(", decompiled)
        self.assertIn("{event: {name:", decompiled)

    def test_function_call_in_list_item_action_slot_is_written_as_a_call(self):
        decompiled = self._round_trip(
            'root = Links([{label: "Docs", action: openUrl("https://a2ui.org")}])'
        )
        self.assertIn(
            'root = Links([{label: "Docs", action: openUrl("https://a2ui.org")}])',
            decompiled,
        )


if __name__ == "__main__":
    unittest.main()
