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

"""Unit tests for A2UI Atom inference format compiler and decompiler."""

from pathlib import Path
import unittest
from typing import Any, Dict
from a2ui.inference_formats.experimental.atom.compiler import AtomCompiler
from a2ui.inference_formats.experimental.atom.decompiler import AtomDecompiler

REPO_ROOT = Path(__file__).resolve().parents[4]


class MockCatalog:

    def __init__(self):
        self.id = "basic"

    def get_components(self):
        return {
            "Card": {
                "properties": {
                    "child": {"type": "string"},
                    "children": {"type": "array"},
                }
            },
            "Column": {
                "properties": {
                    "children": {"type": "array"},
                    "align": {"type": "string"},
                }
            },
            "Row": {
                "properties": {
                    "children": {"type": "array"},
                    "justify": {"type": "string"},
                    "align": {"type": "string"},
                }
            },
            "Text": {
                "properties": {
                    "text": {"type": "string"},
                    "variant": {"type": "string"},
                }
            },
            "Icon": {"properties": {"name": {"type": "string"}}},
            "Button": {
                "properties": {
                    "child": {"type": "string"},
                    "action": {"type": "object"},
                }
            },
        }


class TestAtomFormat(unittest.TestCase):

    def setUp(self):
        self.catalog = MockCatalog()
        self.compiler = AtomCompiler(self.catalog)
        self.decompiler = AtomDecompiler(self.catalog)

    def test_compile_notification_card(self):
        text = """(data $/icon "check" $/title "Enable notification")
(Card
  (Column :align "center"
    (Icon $/icon)
    (Text $/title)
    (Row :justify "center"
      (Button :action (Event "accept") (Text "Yes")))))"""

        compiled = self.compiler.compile(text)
        self.assertIn("createSurface", compiled)
        surface = compiled["createSurface"]
        self.assertEqual(surface["dataModel"]["icon"], "check")
        self.assertEqual(surface["dataModel"]["title"], "Enable notification")

        comps = surface["components"]
        self.assertGreater(len(comps), 0)
        self.assertEqual(comps[0]["component"], "Card")

    def test_compile_auto_healing_missing_parens(self):
        # Truncated S-expression missing trailing parens at EOF
        text = """(Card (Column (Text "Hello World"""
        compiled = self.compiler.compile(text)
        self.assertIn("createSurface", compiled)
        comps = compiled["createSurface"]["components"]
        self.assertGreater(len(comps), 0)
        self.assertEqual(comps[0]["component"], "Card")

    def test_compile_delete_surface(self):
        text = '(deleteSurface "dashboard-1")'
        compiled = self.compiler.compile(text)
        self.assertIn("deleteSurface", compiled)
        self.assertEqual(compiled["deleteSurface"]["surfaceId"], "dashboard-1")

    def test_compile_call_function(self):
        text = '(callFunction "openUrl" :url "https://example.com")'
        compiled = self.compiler.compile(text)
        self.assertIn("callFunction", compiled)
        self.assertEqual(compiled["callFunction"]["call"], "openUrl")
        self.assertEqual(compiled["callFunction"]["args"]["url"], "https://example.com")

    def test_decompile_round_trip(self):
        original = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "main",
                "catalogId": "basic",
                "dataModel": {"title": "Welcome"},
                "components": [
                    {"id": "node_0", "component": "Card", "child": "node_1"},
                    {"id": "node_1", "component": "Text", "text": "Hello"},
                ],
            },
        }
        decompiled_text = self.decompiler.decompile(original)
        self.assertIn('(data $/title "Welcome")', decompiled_text)
        self.assertIn("(Card", decompiled_text)
        self.assertIn('(Text :text "Hello")', decompiled_text)

    def test_regression_data_model_brackets_and_empty_arrays(self):
        """Regression test: (data $/rating [] $/likes [] $/comments "") must compile empty arrays cleanly."""
        text_data_only = '(data $/rating [] $/likes [] $/comments "")'
        compiled_data = self.compiler.compile(text_data_only)
        self.assertIn("updateDataModel", compiled_data)
        self.assertEqual(
            compiled_data["updateDataModel"]["value"],
            {"rating": [], "likes": [], "comments": ""},
        )

        text_with_card = (
            '(data $/rating [] $/likes [] $/comments "") (Card (Text "Hello"))'
        )
        compiled_surface = self.compiler.compile(text_with_card)
        self.assertIn("createSurface", compiled_surface)
        self.assertEqual(
            compiled_surface["createSurface"]["dataModel"],
            {"rating": [], "likes": [], "comments": ""},
        )

    def test_regression_action_event_object_structure(self):
        """Regression test: Button action events must emit action: {"event": {"name": "event_name", "context": {...}}}."""
        text = (
            '(Card (Button :action (Event "generate_dog" :name $/gen/name) (Text'
            ' "Submit")))'
        )
        compiled = self.compiler.compile(text)
        comps = compiled["createSurface"]["components"]
        btn = next(c for c in comps if c["component"] == "Button")
        self.assertEqual(
            btn["action"],
            {
                "event": {
                    "name": "generate_dog",
                    "context": {"name": {"path": "/gen/name"}},
                }
            },
        )

    def test_regression_unwrap_create_surface_macro_expression(self):
        """Regression test: Outer (createSurface "main" ...) macro forms must not create invalid component nodes."""
        text = '(createSurface "main" (Column (Text "Hello World")))'
        compiled = self.compiler.compile(text)
        comps = compiled["createSurface"]["components"]
        comp_types = [c["component"] for c in comps]
        self.assertNotIn("createSurface", comp_types)
        self.assertIn("Column", comp_types)
        self.assertIn("Text", comp_types)

    def test_compile_empty_text_raises_value_error(self):
        """Negative test: Empty input text should raise ValueError."""
        with self.assertRaises(ValueError):
            self.compiler.compile("")

    def test_compile_helper_functions(self):
        """Test formatting helper functions formatString, formatDate, formatCurrency."""
        text = '(Card (Text :text (formatString "Hello %s" $/name)))'
        compiled = self.compiler.compile(text)
        comps = compiled["createSurface"]["components"]
        txt = next(c for c in comps if c["component"] == "Text")
        self.assertEqual(
            txt["text"],
            {
                "call": "formatString",
                "args": {"value": "Hello %s", "arg_1": {"path": "/name"}},
            },
        )

    def test_compile_list_template_expression(self):
        """Test List component with template child expression."""
        text = "(List (template :item item (Text item/title)))"
        compiled = self.compiler.compile(text)
        comps = compiled["createSurface"]["components"]
        lst = next(c for c in comps if c["component"] == "List")
        self.assertIn("template", lst)
        self.assertIn("componentId", lst["template"])

    def test_atom_format_and_parser_integration(self):
        """Integration test for AtomFormat, AtomParser, and sentinel tag unwrapping."""
        from a2ui.inference_formats.experimental.atom import AtomFormat

        fmt = AtomFormat(catalog=self.catalog, surface_id="main")
        parser = fmt.parser

        # Test has_format_content
        raw_text = '<a2ui>(Card (Text "Hello"))</a2ui>'
        self.assertTrue(parser.has_format_content(raw_text, complete=True))
        self.assertFalse(parser.has_format_content("no tags", complete=True))

        # Test unwrap
        parts = parser.unwrap(raw_text)
        self.assertEqual(len(parts), 1)

        # Test compile
        compiled = parser.compile('(Card (Text "Hello"))')
        self.assertEqual(len(compiled), 1)
        self.assertIn("createSurface", compiled[0])

        # Test wrap_decompiled_blocks
        wrapped = parser.wrap_decompiled_blocks(['(Card (Text "Hello"))'])
        self.assertIn("<a2ui>", wrapped)
        self.assertIn("</a2ui>", wrapped)

    def test_atom_parser_compilation_error(self):
        """Negative test: Invalid syntax in AtomParser should raise A2uiCompilationError."""
        from a2ui.inference_formats.experimental.atom import AtomFormat
        from a2ui.parser.errors import A2uiCompilationError

        fmt = AtomFormat(catalog=self.catalog)
        with self.assertRaises(A2uiCompilationError):
            # Non-string format_content causes compilation error in compiler
            fmt.parser.compile(12345)  # type: ignore

    def test_atom_prompt_generator(self):
        """Test AtomPromptGenerator generation of catalog prompt rules and component signatures."""
        from a2ui.inference_formats.experimental.atom import AtomFormat
        from a2ui.schema.catalog import CatalogConfig
        from a2ui.inference_formats.transport import TransportFormat

        cat_path = str(REPO_ROOT / "specification/v1_0/catalogs/basic/catalog.json")
        cat_cfg = CatalogConfig.from_path("basic_catalog", cat_path)
        transport_format = TransportFormat(
            version="1.0", catalogs=[cat_cfg], experiments={"version_1_0"}
        )
        cat = transport_format.get_selected_catalog()

        fmt = AtomFormat(catalog=cat, examples_path="/tmp/examples")
        self.assertEqual(fmt.examples_path, "/tmp/examples")
        prompt_gen = fmt.prompt_generator
        prompt = prompt_gen.generate(
            role_description="You are a helpful UI generator.",
            workflow_description="Follow standard A2UI guidelines.",
        )
        self.assertIn("You are a helpful UI generator.", prompt)
        self.assertIn("Follow standard A2UI guidelines.", prompt)
        self.assertIn(
            "Output the user interface using compact A2UI Atom S-Expression notation.",
            prompt,
        )
        self.assertIn("<a2ui>", prompt)
        self.assertIn("Component Catalog Signatures", prompt)
        self.assertIn("- (Card", prompt)
        self.assertIn("- (Column", prompt)

    def test_compiler_positional_properties_with_real_catalog(self):
        """Test positional property mapping in AtomCompiler with real catalog schema helper."""
        from a2ui.inference_formats.experimental.atom import AtomCompiler
        from a2ui.schema.catalog import CatalogConfig
        from a2ui.inference_formats.transport import TransportFormat

        cat_path = str(REPO_ROOT / "specification/v1_0/catalogs/basic/catalog.json")
        cat_cfg = CatalogConfig.from_path("basic_catalog", cat_path)
        transport_format = TransportFormat(
            version="1.0", catalogs=[cat_cfg], experiments={"version_1_0"}
        )
        cat = transport_format.get_selected_catalog()

        compiler = AtomCompiler(catalog=cat)
        text = '(Card (Column (Text "Positional Text Property")))'
        compiled = compiler.compile(text)
        comps = compiled["createSurface"]["components"]
        txt = next(c for c in comps if c["component"] == "Text")
        self.assertEqual(txt["text"], "Positional Text Property")

    def test_decompile_standalone_operations(self):
        """Test decompilation of deleteSurface and callFunction payloads."""
        del_payload = {"version": "v1.0", "deleteSurface": {"surfaceId": "surf1"}}
        self.assertEqual(
            self.decompiler.decompile(del_payload), '(deleteSurface "surf1")'
        )

        call_payload = {
            "version": "v1.0",
            "callFunction": {"call": "openUrl", "args": {"url": "https://a2ui.org"}},
        }
        self.assertEqual(
            self.decompiler.decompile(call_payload),
            '(callFunction "openUrl" :url "https://a2ui.org")',
        )

    def test_format_missing_catalog_raises_value_error(self):
        """Test AtomFormat without catalog raises ValueError on ensure_catalog."""
        from a2ui.inference_formats.experimental.atom import AtomFormat

        fmt = AtomFormat()
        with self.assertRaises(ValueError):
            _ = fmt.parser

    def test_decompile_update_data_model(self):
        """Test decompilation of updateDataModel payload with primitives."""
        payload = {
            "version": "v1.0",
            "updateDataModel": {"value": {"score": 100, "active": True, "note": None}},
        }
        decompiled = self.decompiler.decompile(payload)
        self.assertIn("(data $/score 100 $/active true $/note null)", decompiled)

    def test_decompile_multiple_children_and_events(self):
        """Test decompilation of multiple children and event action objects."""
        payload = {
            "version": "v1.0",
            "createSurface": {
                "components": [
                    {"id": "root", "component": "Column", "children": ["c1", "c2"]},
                    {"id": "c1", "component": "Text", "text": {"path": "title"}},
                    {
                        "id": "c2",
                        "component": "Button",
                        "action": {"event": {"name": "submit"}},
                        "child": "c1",
                    },
                ]
            },
        }
        decompiled = self.decompiler.decompile(payload)
        self.assertIn("(Column", decompiled)
        self.assertIn("$/title", decompiled)
        self.assertIn('(Event "submit")', decompiled)

    def test_compiler_primitives_and_relative_paths(self):
        """Test compilation of boolean, null, number literals and relative path bindings."""
        text = (
            "(Card (Text :text $title :count 42 :ratio 3.14 :visible true :disabled"
            " false :extra null))"
        )
        compiled = self.compiler.compile(text)
        comps = compiled["createSurface"]["components"]
        txt = next(c for c in comps if c["component"] == "Text")
        self.assertEqual(txt["text"], {"path": "/title"})
        self.assertEqual(txt["count"], 42)
        self.assertEqual(txt["ratio"], 3.14)
        self.assertEqual(txt["visible"], True)
        self.assertEqual(txt["disabled"], False)
        self.assertEqual(txt["extra"], None)

    def test_compiler_tagged_children_list(self):
        """Test compilation of explicit :children [ (Text "A") (Text "B") ] attribute."""
        text = '(Column :children [ (Text "A") (Text "B") ])'
        compiled = self.compiler.compile(text)
        comps = compiled["createSurface"]["components"]
        col = next(c for c in comps if c["component"] == "Column")
        self.assertEqual(len(col["children"]), 2)

    def test_function_signatures_and_enum_helpers(self):
        """Test function signature generation and enum schema helpers in prompt generator."""
        from a2ui.inference_formats.experimental.atom import AtomFormat
        from a2ui.inference_formats.experimental.atom.prompt_generator import _get_schema_enum
        from a2ui.schema.catalog import CatalogConfig
        from a2ui.inference_formats.transport import TransportFormat

        cat_path = str(REPO_ROOT / "specification/v1_0/catalogs/basic/catalog.json")
        cat_cfg = CatalogConfig.from_path("basic_catalog", cat_path)
        transport_format = TransportFormat(
            version="1.0", catalogs=[cat_cfg], experiments={"version_1_0"}
        )
        cat = transport_format.get_selected_catalog()

        fmt = AtomFormat(catalog=cat)
        func_sigs = fmt.prompt_generator.generate_function_signatures()
        self.assertIsInstance(func_sigs, str)

        # Test _get_schema_enum helper
        enum_schema = {"oneOf": [{"enum": ["a", "b"]}]}
        self.assertEqual(_get_schema_enum(enum_schema), ["a", "b"])

    def test_decompile_multiple_root_nodes(self):
        """Test decompilation when components list has multiple root nodes."""
        payload = {
            "version": "v1.0",
            "createSurface": {
                "components": [
                    {"id": "node_0", "component": "Text", "text": "First"},
                    {"id": "node_1", "component": "Text", "text": "Second"},
                ]
            },
        }
        decompiled = self.decompiler.decompile(payload)
        self.assertIn('(Text :text "First")', decompiled)

    def test_compiler_schema_expects_single_child_and_helpers(self):
        """Test _schema_expects_single_child and formatDate/formatCurrency helpers."""
        from a2ui.inference_formats.experimental.atom import AtomCompiler
        from a2ui.schema.catalog import CatalogConfig
        from a2ui.inference_formats.transport import TransportFormat

        cat_path = str(REPO_ROOT / "specification/v1_0/catalogs/basic/catalog.json")
        cat_cfg = CatalogConfig.from_path("basic_catalog", cat_path)
        transport_format = TransportFormat(
            version="1.0", catalogs=[cat_cfg], experiments={"version_1_0"}
        )
        cat = transport_format.get_selected_catalog()

        compiler = AtomCompiler(catalog=cat)
        self.assertTrue(compiler._schema_expects_single_child("Card"))
        self.assertFalse(compiler._schema_expects_single_child("Column"))

        # Test formatDate and formatCurrency
        text = (
            "(Card (Text :text (formatDate $/created_at) :amount (formatCurrency"
            " 99.99)))"
        )
        compiled = compiler.compile(text)
        comps = compiled["createSurface"]["components"]
        txt = next(c for c in comps if c["component"] == "Text")
        self.assertEqual(
            txt["text"],
            {"call": "formatDate", "args": {"value": {"path": "/created_at"}}},
        )
        self.assertEqual(
            txt["amount"], {"call": "formatCurrency", "args": {"value": 99.99}}
        )

    def test_direct_enum_schema_helper(self):
        """Test _get_schema_enum with direct dict enum."""
        from a2ui.inference_formats.experimental.atom.prompt_generator import _get_schema_enum

        self.assertEqual(_get_schema_enum({"enum": ["opt1", "opt2"]}), ["opt1", "opt2"])
        self.assertIsNone(_get_schema_enum("not_a_dict"))

    def test_accept_adjacency_list_string_child_ids(self):
        """Fault-tolerance test: Allow string child ID references in Column."""
        text_tagged_string_id = '(Column :children ["node_1"])'
        compiled = self.compiler.compile(text_tagged_string_id)
        comps = compiled["createSurface"]["components"]
        col = next(c for c in comps if c["component"] == "Column")
        self.assertEqual(col["children"], ["node_1"])

    def test_complex_deeply_nested_tree(self):
        """Positive test: Verify 6+ level deeply nested tree compilation and schema integrity."""
        text = """
(Card
  (Column :align "stretch"
    (Row :justify "spaceBetween"
      (Text "Header Title")
      (Icon "star"))
    (Card
      (Column
        (Text "Nested Level 4")
        (Row
          (Button :action (Event "submit" :name $/user/name)
            (Text "Confirm")))))))
"""
        compiled = self.compiler.compile(text)
        self.assertIn("createSurface", compiled)
        comps = compiled["createSurface"]["components"]
        # Verify 11 total component nodes created cleanly in tree topology
        self.assertEqual(len(comps), 11)

        # Verify root component is Card
        root = next(c for c in comps if c["id"] == "root")
        self.assertEqual(root["component"], "Card")

        # Verify deep child Action event object
        btn = next(c for c in comps if c["component"] == "Button")
        self.assertEqual(
            btn["action"],
            {"event": {"name": "submit", "context": {"name": {"path": "/user/name"}}}},
        )

    def test_unknown_component_type_raises_value_error(self):
        """Negative test: Ensure unknown component types raise a descriptive ValueError instead of substituting UI."""
        with self.assertRaises(ValueError) as ctx:
            self.compiler.compile('(UnknownCustomComponent (Text "Label"))')
        self.assertIn(
            "Unknown component type 'UnknownCustomComponent'", str(ctx.exception)
        )
        self.assertIn("Available components in catalog are:", str(ctx.exception))

    def test_fuzzed_synthetic_catalog_agnosticism(self):
        """Verify 100% catalog agnosticism using a fuzzed synthetic catalog with non-standard names."""
        from a2ui.inference_formats.experimental.atom import AtomCompiler, AtomDecompiler
        from a2ui.schema.catalog import CatalogConfig, A2uiCatalog
        from a2ui.core.catalog import Catalog

        # Synthetic catalog definitions with non-standard names
        synthetic_components = {
            "CustomContainerX": {
                "type": "object",
                "properties": {
                    "component": {"const": "CustomContainerX"},
                    "sub_nodes": {
                        "$ref": (
                            "https://a2ui.org/specification/v1_0/common_types.json#/$defs/ChildList"
                        )
                    },
                },
                "required": ["component"],
            },
            "CustomSlotCardY": {
                "type": "object",
                "properties": {
                    "component": {"const": "CustomSlotCardY"},
                    "slot_node": {
                        "$ref": (
                            "https://a2ui.org/specification/v1_0/common_types.json#/$defs/Child"
                        )
                    },
                },
                "required": ["component"],
            },
            "CustomWidgetZ": {
                "type": "object",
                "properties": {
                    "component": {"const": "CustomWidgetZ"},
                    "label_text": {
                        "$ref": (
                            "https://a2ui.org/specification/v1_0/common_types.json#/$defs/DynamicString"
                        )
                    },
                    "press_handler": {
                        "$ref": (
                            "https://a2ui.org/specification/v1_0/common_types.json#/$defs/Action"
                        )
                    },
                },
                "required": ["component", "label_text"],
            },
        }

        cat = A2uiCatalog(
            version="1.0",
            name="custom_fuzzed_catalog",
            s2c_schema={},
            common_types_schema={},
            catalog_schema={
                "catalogId": "https://a2ui.org/custom_fuzzed_catalog",
                "components": synthetic_components,
            },
        )
        compiler = AtomCompiler(catalog=cat)
        decompiler = AtomDecompiler(catalog=cat)

        # 1. Compile S-expression with synthetic components & non-standard property names
        atom_src = (
            "(CustomSlotCardY :slot_node (CustomContainerX :sub_nodes [(CustomWidgetZ"
            ' :label_text "Hello Synthetic" :press_handler (Event "on_synthetic_click"'
            " :data $/user/id))]))"
        )
        compiled = compiler.compile(atom_src)

        self.assertIn("createSurface", compiled)
        comps = compiled["createSurface"]["components"]
        comp_types = [c["component"] for c in comps]
        self.assertIn("CustomSlotCardY", comp_types)
        self.assertIn("CustomContainerX", comp_types)
        self.assertIn("CustomWidgetZ", comp_types)

        # 2. Decompile back to S-expression and verify round-trip integrity
        decompiled = decompiler.decompile(compiled)
        self.assertIn("(CustomSlotCardY", decompiled)
        self.assertIn("(CustomContainerX", decompiled)
        self.assertIn('(CustomWidgetZ :label_text "Hello Synthetic"', decompiled)

    def test_compile_child_list_template_property_assignment(self):
        """Test standard v1.0 Catalog List component dynamic template assignment to children property."""
        from a2ui.schema.catalog import CatalogConfig
        from a2ui.inference_formats.transport import TransportFormat

        cat_path = str(REPO_ROOT / "specification/v1_0/catalogs/basic/catalog.json")
        cat_cfg = CatalogConfig.from_path("basic_catalog", cat_path)
        transport_format = TransportFormat(
            version="1.0", catalogs=[cat_cfg], experiments={"version_1_0"}
        )
        cat = transport_format.get_selected_catalog()

        compiler = AtomCompiler(catalog=cat)
        text = '(List :items $/products :template (template item (Card (Text "Item"))))'
        compiled = compiler.compile(text)

        comps = compiled["createSurface"]["components"]
        lst = next(c for c in comps if c["component"] == "List")
        self.assertIn("children", lst)
        self.assertIsInstance(lst["children"], dict)
        self.assertIn("componentId", lst["children"])
        self.assertEqual(lst["children"]["path"], "/products")
        self.assertNotIn("items", lst)
        self.assertNotIn("template", lst)

    def test_synthetic_catalog_child_list_template_assignment(self):
        """Test catalog-agnostic ChildList template assignment with custom non-standard property name 'sub_nodes'."""
        from a2ui.schema.catalog import A2uiCatalog

        synthetic_components = {
            "CustomContainerX": {
                "type": "object",
                "properties": {
                    "component": {"const": "CustomContainerX"},
                    "sub_nodes": {
                        "$ref": (
                            "https://a2ui.org/specification/v1_0/common_types.json#/$defs/ChildList"
                        )
                    },
                },
                "required": ["component", "sub_nodes"],
            },
            "CustomWidgetZ": {
                "type": "object",
                "properties": {
                    "component": {"const": "CustomWidgetZ"},
                    "label_text": {"type": "string"},
                },
                "required": ["component"],
            },
        }
        cat = A2uiCatalog(
            version="1.0",
            name="custom_fuzzed_catalog",
            s2c_schema={},
            common_types_schema={},
            catalog_schema={
                "catalogId": "https://a2ui.org/custom_fuzzed_catalog",
                "components": synthetic_components,
            },
        )
        compiler = AtomCompiler(catalog=cat)
        atom_src = (
            "(CustomContainerX :items $/catalog_items (template (CustomWidgetZ"
            " :label_text $/title)))"
        )
        compiled = compiler.compile(atom_src)

        comps = compiled["createSurface"]["components"]
        container = next(c for c in comps if c["component"] == "CustomContainerX")
        self.assertIn("sub_nodes", container)
        self.assertIsInstance(container["sub_nodes"], dict)
        self.assertEqual(container["sub_nodes"]["path"], "/catalog_items")
        self.assertNotIn("items", container)
        self.assertNotIn("template", container)


if __name__ == "__main__":
    unittest.main()
