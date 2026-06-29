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

"""Unit tests focusing on the A2UI Express Decompiler."""

import os
import unittest

os.environ["A2UI_EXPRESS_ENABLED"] = "true"

from a2ui.experimental.express.compiler import ExpressCompiler
from a2ui.experimental.express.decompiler import ExpressDecompiler

SPEC_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..", "..", "specification", "v1_0"
    )
)
CATALOG_PATH = os.path.join(SPEC_DIR, "catalogs", "basic", "catalog.json")


class TestExpressDecompiler(unittest.TestCase):
  """Test suite covering the Express decompiler and value formatting."""

  def setUp(self):
    """Initializes standard test paths and schema helpers."""
    self.catalog_path = CATALOG_PATH

  def test_decompiler_rpc_actions_functional_expressions_and_custom_checks(self):
    """Verifies decompilation of custom RPC calls, local action mappings, dynamic functional expressions, and custom checks."""
    decompiler = ExpressDecompiler(self.catalog_path)

    # 1. callFunction with custom function not in catalog
    rpc_envelope = {
        "version": "v1.0",
        "callFunction": {"call": "myCustomRPC", "args": {"argA": "hello", "argB": 42}},
    }
    decompiled_rpc = decompiler.decompile(rpc_envelope)
    self.assertIn('myCustomRPC("hello", 42)', decompiled_rpc)

    # 2. Local action decompilation with functionCall in action property
    action_envelope = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "test_surf",
            "components": [
                {
                    "id": "root",
                    "component": "Button",
                    "child": "btnText",
                    "action": {
                        "functionCall": {
                            "call": "openUrl",
                            "args": {"url": "https://example.com"},
                        }
                    },
                },
                {"id": "btnText", "component": "Text", "text": "Click me"},
            ],
        },
    }
    decompiled_action = decompiler.decompile(action_envelope)
    self.assertIn(
        'root = Button(btnText, _, openUrl("https://example.com"))', decompiled_action
    )

    # 3. Dynamic functional expression decompilation with call
    func_expr_envelope = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "test_surf",
            "components": [{
                "id": "root",
                "component": "Text",
                "text": {
                    "call": "length",
                    "args": {"value": {"path": "/name"}, "min": 5},
                },
            }],
        },
    }
    decompiled_func = decompiler.decompile(func_expr_envelope)
    self.assertIn("root = Text(length($/name, 5))", decompiled_func)

    # 4. Check decompilation with custom message
    custom_msg_envelope = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "test_surf",
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
                    "message": "Name is required!",
                }],
            }],
        },
    }
    decompiled_msg = decompiler.decompile(custom_msg_envelope)
    self.assertIn(
        'root = TextField("Name", $/name, ?required("Name is required!"))',
        decompiled_msg,
    )

  def test_string_quoting_and_escaping(self):
    """Verifies parsing, compilation, and decompilation of various string quoting forms."""
    compiler = ExpressCompiler(self.catalog_path)
    decompiler = ExpressDecompiler(self.catalog_path)

    def get_compiled_text(dsl_body: str) -> str:
      dsl = f"root = Column([t1])\nt1 = Text({dsl_body})"
      res = compiler.compile(dsl)
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
    self.assertEqual(get_compiled_text('"""hello \\"world\\" """'), 'hello "world" ')

    # 3. Raw Strings (Single Quoted)
    self.assertEqual(get_compiled_text('r"hello\\nworld"'), "hello\\nworld")
    self.assertEqual(get_compiled_text('r"C:\\path\\to\\file"'), "C:\\path\\to\\file")

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
        get_compiled_text('"""hello ) world\nline 2"""'), "hello ) world\nline 2"
    )

    # 7. Streaming Compatibility and Tolerance (is_final=False)
    incomplete_dsl = '$/foo = 123\n$/bar = """unclosed string...\n'
    with self.assertRaises(SyntaxError):
      compiler.compile(incomplete_dsl)

    res_partial = compiler.compile(incomplete_dsl, is_final=False)
    self.assertEqual(res_partial["updateDataModel"]["value"]["foo"], 123)
    self.assertNotIn("bar", res_partial["updateDataModel"]["value"])

  def test_schema_driven_child_reference_helper(self):
    """Verify that _is_component_reference_property correctly inspects JSON schema structures."""
    from a2ui.experimental.express.decompiler import _is_component_reference_property

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
        "$ref": "https://a2ui.org/specification/v1_0/common_types.json#/$defs/ChildList"
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


if __name__ == "__main__":
  unittest.main()
