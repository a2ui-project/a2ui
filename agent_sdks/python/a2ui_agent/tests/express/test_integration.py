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

"""End-to-end integration and round-trip verification tests for A2UI Express."""

import os
import glob
import json
import unittest
from typing import Any

os.environ["A2UI_EXPRESS_ENABLED"] = "true"

from a2ui.experimental.express.compiler import ExpressCompiler
from a2ui.experimental.express.decompiler import ExpressDecompiler
from a2ui.experimental.express.parser import parse_express_response
from a2ui.experimental.express.schema_helper import CatalogSchemaHelper

SPEC_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..", "..", "specification", "v1_0"
    )
)
CATALOG_PATH = os.path.join(SPEC_DIR, "catalogs", "basic", "catalog.json")
EXAMPLES_DIR = os.path.join(SPEC_DIR, "catalogs", "basic", "examples")


class TestExpressIntegration(unittest.TestCase):
  """End-to-end integration test suite validating compiler, decompiler, and parser loop."""

  def setUp(self):
    """Initializes standard test paths and schema helpers."""
    self.catalog_path = CATALOG_PATH
    self.helper = CatalogSchemaHelper(self.catalog_path)

  def test_round_trip_examples(self):
    """Runs a semantically rigorous round-trip test on real catalog examples."""
    compiler = ExpressCompiler(self.catalog_path)
    decompiler = ExpressDecompiler(self.catalog_path)

    example_files = glob.glob(os.path.join(EXAMPLES_DIR, "*.json"))
    self.assertTrue(
        len(example_files) > 0, "No example files found to run round-trip tests."
    )

    tested_count = 0
    for ex_file in sorted(example_files)[:5]:
      with open(ex_file, "r", encoding="utf-8") as f:
        ex_data = json.load(f)

      messages = ex_data.get("messages", [])
      components_list = None
      surface_id = "test_surf"
      catalog_id = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"

      for msg in messages:
        if "updateComponents" in msg:
          components_list = msg["updateComponents"].get("components", [])
          surface_id = msg["updateComponents"].get("surfaceId", surface_id)
          break

      if not components_list:
        continue

      tested_count += 1

      original_envelope = {
          "version": "v1.0",
          "createSurface": {
              "surfaceId": surface_id,
              "catalogId": catalog_id,
              "components": components_list,
          },
      }

      dsl = decompiler.decompile(original_envelope)
      compiled_envelope = compiler.compile(
          dsl, surface_id=surface_id, catalog_id=catalog_id
      )

      orig_comps = sorted(
          original_envelope["createSurface"]["components"], key=lambda x: x["id"]
      )
      comp_comps = sorted(
          compiled_envelope["createSurface"]["components"], key=lambda x: x["id"]
      )

      self.assertEqual(len(orig_comps), len(comp_comps))

      for idx, orig in enumerate(orig_comps):
        comp = comp_comps[idx]
        self.assertEqual(orig["id"], comp["id"])
        self.assertEqual(orig["component"], comp["component"])

        for key, orig_v in orig.items():
          if key in ["component", "id", "checks"]:
            continue
          self.assertIn(key, comp)
          comp_v = comp[key]

          if (
              isinstance(orig_v, dict)
              and "call" in orig_v
              and "returnType" not in orig_v
          ):
            if isinstance(comp_v, dict) and comp_v.get("call") == orig_v["call"]:
              comp_v = {k2: v2 for k2, v2 in comp_v.items() if k2 != "returnType"}
          self.assertEqual(orig_v, comp_v)

  def test_examples_conversions_match(self):
    """Verifies that all human-authored .a2ui examples compile to match their JSON counterparts."""
    compiler = ExpressCompiler(self.catalog_path)

    a2ui_dir = os.path.join(SPEC_DIR, "..", "proposals", "express", "examples")
    a2ui_files = glob.glob(os.path.join(a2ui_dir, "*.a2ui"))
    self.assertEqual(
        len(a2ui_files), 36, f"Expected 36 a2ui files, found {len(a2ui_files)}"
    )

    for a2ui_file in sorted(a2ui_files):
      base_name = os.path.basename(a2ui_file)
      json_name = base_name.replace(".a2ui", ".json")
      json_file = os.path.join(EXAMPLES_DIR, json_name)
      self.assertTrue(
          os.path.exists(json_file), f"JSON counterpart {json_name} does not exist"
      )

      with open(a2ui_file, "r", encoding="utf-8") as f:
        dsl_content = f.read()

      with open(json_file, "r", encoding="utf-8") as f:
        json_data = json.load(f)

      messages = json_data.get("messages", [])
      surface_id = "main"
      expected_components = []

      for msg in messages:
        if "createSurface" in msg:
          surface_id = msg["createSurface"].get("surfaceId", surface_id)
          if "components" in msg["createSurface"]:
            expected_components = msg["createSurface"]["components"]
        if "updateComponents" in msg:
          expected_components = msg["updateComponents"].get("components", [])

      compiled_envelope = compiler.compile(dsl_content, surface_id=surface_id)

      def normalize_value(val: Any) -> Any:
        if isinstance(val, dict):
          if "event" in val and isinstance(val["event"], dict):
            evt = val["event"]
            if "context" in evt and not evt["context"]:
              val["event"] = {k: v for k, v in evt.items() if k != "context"}
          return {k: normalize_value(v) for k, v in val.items() if k != "returnType"}
        if isinstance(val, list):
          return [normalize_value(item) for item in val]
        return val

      if "deleteSurface" in compiled_envelope:
        expected_msg = next((m for m in messages if "deleteSurface" in m), None)
        self.assertIsNotNone(expected_msg)
        self.assertEqual(
            expected_msg["deleteSurface"], compiled_envelope["deleteSurface"]
        )
        continue

      if "callFunction" in compiled_envelope:
        expected_msg = next((m for m in messages if "callFunction" in m), None)
        self.assertIsNotNone(expected_msg)
        self.assertEqual(
            expected_msg["callFunction"]["call"],
            compiled_envelope["callFunction"]["call"],
        )
        self.assertEqual(
            normalize_value(expected_msg["callFunction"].get("args", {})),
            normalize_value(compiled_envelope["callFunction"].get("args", {})),
        )
        continue

      if "updateDataModel" in compiled_envelope:
        expected_msg = next(
            (m for m in messages if "updateDataModel" in m or "updateData" in m), None
        )
        self.assertIsNotNone(expected_msg)
        expected_val = (
            expected_msg.get("updateDataModel", {}).get("value", {})
            if "updateDataModel" in expected_msg
            else expected_msg.get("updateData", {}).get("data", {})
        )
        self.assertEqual(
            normalize_value(expected_val),
            normalize_value(compiled_envelope["updateDataModel"].get("value", {})),
        )
        continue

      compiled_components = compiled_envelope["createSurface"]["components"]
      self.assertEqual(len(compiled_components), len(expected_components))

      expected_sorted = sorted(expected_components, key=lambda x: x["id"])
      compiled_sorted = sorted(compiled_components, key=lambda x: x["id"])

      for idx, expected in enumerate(expected_sorted):
        compiled = compiled_sorted[idx]
        self.assertEqual(expected["id"], compiled["id"])
        self.assertEqual(expected["component"], compiled["component"])

        for key, exp_val in expected.items():
          if key in ["id", "component"]:
            continue
          self.assertIn(key, compiled)
          comp_val = normalize_value(compiled[key])
          exp_val = normalize_value(exp_val)
          self.assertEqual(exp_val, comp_val)

  def test_data_model_compilation_and_decompilation(self):
    """Validates compiling and decompiling shared data model assignments in the DSL."""
    compiler = ExpressCompiler(self.catalog_path)
    decompiler = ExpressDecompiler(self.catalog_path)

    dsl = """$/icon = "check"
$/title = "Enable notification"
$/user/firstName = "Alice"
$/user/age = 30
root = Card(main_column)
main_column = Column([icon, title], _, "center")
icon = Icon($/icon)
title = Text($/title, "body")"""

    envelope = compiler.compile(dsl, surface_id="test_data_surf")
    self.assertEqual(envelope["version"], "v1.0")
    create_surface = envelope["createSurface"]

    data_model = create_surface["dataModel"]
    self.assertEqual(data_model["icon"], "check")
    self.assertEqual(data_model["title"], "Enable notification")
    self.assertEqual(data_model["user"]["firstName"], "Alice")
    self.assertEqual(data_model["user"]["age"], 30)

    decompiled_dsl = decompiler.decompile(envelope)
    self.assertIn('$/icon = "check"', decompiled_dsl)
    self.assertIn('$/title = "Enable notification"', decompiled_dsl)
    self.assertIn("$/user/age = 30", decompiled_dsl)
    self.assertIn('$/user/firstName = "Alice"', decompiled_dsl)

    compiled_envelope_2 = compiler.compile(decompiled_dsl, surface_id="test_data_surf")
    self.assertEqual(compiled_envelope_2["createSurface"]["dataModel"], data_model)

  def test_parser_robustness_and_event_variable_resolution(self):
    """Regression tests for parser fallbacks, empty text parts, and event variable resolution."""
    compiler = ExpressCompiler(self.catalog_path)

    # 1. Event name and context variable resolution
    dsl_event_var = """
    root = Button("Click", _, Event(MY_EVENT, MY_CONTEXT))
    MY_EVENT = "my_custom_click"
    MY_CONTEXT = {userId: 123, "active": true}
    """
    res = compiler.compile(dsl_event_var)
    btn = res["createSurface"]["components"][0]
    self.assertEqual(btn["action"]["event"]["name"], "my_custom_click")
    self.assertEqual(btn["action"]["event"]["context"]["userId"], 123)
    self.assertEqual(btn["action"]["event"]["context"]["active"], True)

    # 2. Conversational parser robustness (no sentinels)
    conversational_content = (
        "Hello there! I am a conversational response without any UI tags."
    )
    parts = parse_express_response(conversational_content, self.catalog_path)
    self.assertEqual(len(parts), 1)
    self.assertEqual(parts[0].text, conversational_content)
    self.assertIsNone(parts[0].a2ui_json)

    # 3. Empty text part omission
    ui_only_content = '<a2ui>root = Text("Hello")</a2ui>'
    parts_ui = parse_express_response(ui_only_content, self.catalog_path)
    self.assertEqual(len(parts_ui), 1)
    self.assertIsNone(parts_ui[0].text)
    self.assertIsNotNone(parts_ui[0].a2ui_json)

  def test_template_validation_and_decompiler_quoted_keys(self):
    """Regression tests for template path validation, decompiler dictionary key quoting, and check message string formatting."""
    compiler = ExpressCompiler(self.catalog_path)
    decompiler = ExpressDecompiler(self.catalog_path)

    # 1. Test template path validation in compiler
    dsl_invalid_template = (
        'root = List(_template("invalid_string_no_dollar", itemTemplate))\nitemTemplate'
        " = Text($/val)"
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
        'root = Tabs([{title: "Overview", "user-id-hyphen": 123, "session token space":'
        ' "abc", valid_id: true}])',
        decompiled_dsl,
    )

    compiled_back = compiler.compile(decompiled_dsl, surface_id="main")
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
    compiler = ExpressCompiler(self.catalog_path)
    decompiler = ExpressDecompiler(self.catalog_path)

    # 1. Regression test: Sentinel tag on the same line as a statement
    dsl_sentinel = '<a2ui>root = Column([text1])\ntext1 = Text("Hello")\n</a2ui>'
    res = compiler.compile(dsl_sentinel)
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
    res_multiline = compiler.compile(dsl_multiline)
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
    parts = parse_express_response(truncated_response, self.catalog_path)
    self.assertEqual(len(parts), 1)
    self.assertEqual(parts[0].text, "Here is the partial UI:")
    self.assertIsNotNone(parts[0].a2ui_json)

    compiled_components = parts[0].a2ui_json[0]["createSurface"]["components"]
    self.assertEqual(len(compiled_components), 2)
    self.assertEqual(compiled_components[0]["id"], "root")
    self.assertEqual(compiled_components[1]["id"], "text1")
    self.assertFalse(any(c["id"] == "btn" for c in compiled_components))


if __name__ == "__main__":
  unittest.main()
