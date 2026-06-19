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

"""Unit tests for the A2UI Express pipeline.

Validates prompt generation, DSL compilation, wire JSON decompilation, and runs
comprehensive semantic round-trip checks on standard v1.0 catalog examples.
"""

import os
from typing import Any

os.environ["A2UI_EXPRESS_ENABLED"] = "true"
import json
import glob
import unittest
from a2ui.experimental.express.prompt_generator import ExpressPromptGenerator
from a2ui.experimental.express.compiler import ExpressCompiler
from a2ui.experimental.express.decompiler import ExpressDecompiler
from a2ui.experimental.express.schema_helper import CatalogSchemaHelper

SPEC_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..", "..", "specification", "v1_0"
    )
)
CATALOG_PATH = os.path.join(SPEC_DIR, "catalogs", "basic", "catalog.json")
EXAMPLES_DIR = os.path.join(SPEC_DIR, "catalogs", "basic", "examples")


class TestExpressPipeline(unittest.TestCase):
  """Test suite covering A2UI Express parser, compiler, and decompiler."""

  def setUp(self):
    """Initializes standard test paths and schema helpers."""
    self.catalog_path = CATALOG_PATH
    self.helper = CatalogSchemaHelper(self.catalog_path)

  def test_prompt_generator(self):
    """Verifies prompt signature compiler loads catalog components correctly."""
    generator = ExpressPromptGenerator(self.catalog_path)
    prompt = generator.generate_prompt()
    self.assertIn("Text(", prompt)
    self.assertIn("Column(", prompt)
    self.assertIn("required(", prompt)
    self.assertIn("regex(", prompt)

  def test_compilation_and_decompilation_basic(self):
    """Validates parsing and mapping basic components and validations."""
    compiler = ExpressCompiler(self.catalog_path)
    decompiler = ExpressDecompiler(self.catalog_path)

    dsl = """root = Column([repField, valueField])
repField = TextField("Representative", $/form/rep, "Enter name")
valueField = TextField("Deal Value", $/form/value, "0.00", "number", ?required)"""

    envelope = compiler.compile(dsl, surface_id="test_surf")
    self.assertEqual(envelope["version"], "v1.0")
    self.assertEqual(envelope["createSurface"]["surfaceId"], "test_surf")

    components = envelope["createSurface"]["components"]
    self.assertEqual(len(components), 3)

    # Verify adjacency list structures
    root_comp = next(c for c in components if c["id"] == "root")
    self.assertEqual(root_comp["component"], "Column")
    self.assertEqual(root_comp["children"], ["repField", "valueField"])

    rep_comp = next(c for c in components if c["id"] == "repField")
    self.assertEqual(rep_comp["component"], "TextField")
    self.assertEqual(rep_comp["label"], "Representative")
    self.assertEqual(rep_comp["value"], {"path": "/form/rep"})
    self.assertEqual(rep_comp["placeholder"], "Enter name")

    val_comp = next(c for c in components if c["id"] == "valueField")
    self.assertEqual(val_comp["component"], "TextField")
    self.assertEqual(val_comp["label"], "Deal Value")
    self.assertEqual(val_comp["value"], {"path": "/form/value"})
    self.assertEqual(val_comp["placeholder"], "0.00")
    self.assertEqual(val_comp["variant"], "number")
    # Verify implicit path validation injection
    self.assertEqual(
        val_comp["checks"],
        [{
            "condition": {
                "call": "required",
                "args": {"value": {"path": "/form/value"}},
            },
            "message": "Required check failed",
        }],
    )

    # Verify decompile
    decompiled_dsl = decompiler.decompile(envelope)
    self.assertTrue(decompiled_dsl.startswith("<a2ui>\n"))
    self.assertTrue(decompiled_dsl.endswith("\n</a2ui>"))
    self.assertIn("root = Column([repField, valueField])", decompiled_dsl)
    self.assertIn(
        'repField = TextField("Representative", $/form/rep, "Enter name")',
        decompiled_dsl,
    )
    self.assertIn(
        'valueField = TextField("Deal Value", $/form/value, "0.00", "number",'
        " ?required)",
        decompiled_dsl,
    )

  def test_format_string_and_actions(self):
    """Validates compilation of string interpolation and interactive actions."""
    compiler = ExpressCompiler(self.catalog_path)
    decompiler = ExpressDecompiler(self.catalog_path)

    dsl = """root = Column([welcome, saveButton])
welcome = Text(formatString("Welcome, ${/user/name}!"))
saveButton = Button(saveLabel, "primary", Event("submitDeal", {rep: $/form/rep}))
saveLabel = Text("Save")"""

    envelope = compiler.compile(dsl)
    components = envelope["createSurface"]["components"]

    welcome_comp = next(c for c in components if c["id"] == "welcome")
    self.assertEqual(
        welcome_comp["text"],
        {
            "call": "formatString",
            "args": {"value": "Welcome, ${/user/name}!"},
        },
    )

    button_comp = next(c for c in components if c["id"] == "saveButton")
    self.assertEqual(button_comp["variant"], "primary")
    self.assertEqual(
        button_comp["action"],
        {"event": {"name": "submitDeal", "context": {"rep": {"path": "/form/rep"}}}},
    )

    decompiled_dsl = decompiler.decompile(envelope)
    self.assertIn(
        'welcome = Text(formatString("Welcome, ${/user/name}!"))', decompiled_dsl
    )
    self.assertIn(
        'saveButton = Button(saveLabel, "primary", Event("submitDeal", {rep:'
        " $/form/rep}))",
        decompiled_dsl,
    )

  def test_standalone_function_call(self):
    """Validates compilation of standalone function calls into CallFunctionMessages."""
    compiler = ExpressCompiler(self.catalog_path)
    decompiler = ExpressDecompiler(self.catalog_path)

    dsl = """openUrl("https://example.com")"""
    envelope = compiler.compile(dsl)

    self.assertEqual(envelope["version"], "v1.0")
    self.assertIn("callFunction", envelope)
    self.assertIn("functionCallId", envelope)
    self.assertEqual(envelope["callFunction"]["call"], "openUrl")
    self.assertEqual(envelope["callFunction"]["args"], {"url": "https://example.com"})

    # Verify decompilation
    decompiled_dsl = decompiler.decompile(envelope)
    self.assertIn('openUrl("https://example.com")', decompiled_dsl)

  def test_map_variable_inlining(self):
    """Validates compiling variable assignments holding map literals and inlining them."""
    compiler = ExpressCompiler(self.catalog_path)
    decompiler = ExpressDecompiler(self.catalog_path)

    dsl = """root = Tabs([tab1])
tab1 = {title: "Overview", child: contentCol}
contentCol = Column([])"""

    envelope = compiler.compile(dsl)
    components = envelope["createSurface"]["components"]

    tabs_comp = next(c for c in components if c["id"] == "root")
    self.assertEqual(tabs_comp["component"], "Tabs")
    self.assertEqual(tabs_comp["tabs"], [{"title": "Overview", "child": "contentCol"}])

    # Verify decompilation back to inline map literals
    decompiled_dsl = decompiler.decompile(envelope)
    self.assertIn(
        'root = Tabs([{title: "Overview", child: contentCol}])', decompiled_dsl
    )

  def test_event_and_list_variable_inlining(self):
    """Validates that Event helper assignments and custom list arrays assigned to variables inline correctly."""
    compiler = ExpressCompiler(self.catalog_path)

    dsl = """root = Column([btn1, btn2])
btn1 = Button(btn1Label, "primary", myAction)
btn1Label = Text("Save")
btn2 = Button(btn2Label, "outline", closeAction)
btn2Label = Text("Cancel")
myAction = Event("submit", {val: "42"})
closeAction = Event("close")"""

    envelope = compiler.compile(dsl)
    components = envelope["createSurface"]["components"]

    btn1 = next(c for c in components if c["id"] == "btn1")
    self.assertEqual(
        btn1["action"], {"event": {"name": "submit", "context": {"val": "42"}}}
    )

    btn2 = next(c for c in components if c["id"] == "btn2")
    self.assertEqual(btn2["action"], {"event": {"name": "close", "context": {}}})

  def test_round_trip_examples(self):
    """Runs a semantically rigorous round-trip test on real catalog examples."""
    compiler = ExpressCompiler(self.catalog_path)
    decompiler = ExpressDecompiler(self.catalog_path)

    example_files = glob.glob(os.path.join(EXAMPLES_DIR, "*.json"))
    self.assertTrue(
        len(example_files) > 0, "No example files found to run round-trip tests."
    )

    # We test a robust selection of examples covering different components and actions
    tested_count = 0
    for ex_file in sorted(example_files)[:5]:  # Run first 5 complex examples
      with open(ex_file, "r", encoding="utf-8") as f:
        ex_data = json.load(f)

      # Extract components from updateComponents message
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

      # Wrap into standard createSurface payload
      original_envelope = {
          "version": "v1.0",
          "createSurface": {
              "surfaceId": surface_id,
              "catalogId": catalog_id,
              "components": components_list,
          },
      }

      # Round trip: Decompile -> Compile -> Compare
      dsl = decompiler.decompile(original_envelope)
      compiled_envelope = compiler.compile(
          dsl, surface_id=surface_id, catalog_id=catalog_id
      )

      # Semantically normalize lists for exact matching
      orig_comps = sorted(
          original_envelope["createSurface"]["components"], key=lambda x: x["id"]
      )
      comp_comps = sorted(
          compiled_envelope["createSurface"]["components"], key=lambda x: x["id"]
      )

      if len(orig_comps) != len(comp_comps):
        print(
            f"Length mismatch for {os.path.basename(ex_file)}: "
            f"Orig: {len(orig_comps)}, Comp: {len(comp_comps)}"
        )
        print(f"Orig IDs: {[x['id'] for x in orig_comps]}")
        print(f"Comp IDs: {[x['id'] for x in comp_comps]}")
        self.assertEqual(len(orig_comps), len(comp_comps))

      for idx, orig in enumerate(orig_comps):
        comp = comp_comps[idx]
        if orig["id"] != comp["id"] or orig["component"] != comp["component"]:
          print(f"Mismatch in component index {idx} for {os.path.basename(ex_file)}")
          print(f"Orig: {orig}")
          print(f"Comp: {comp}")
          self.assertEqual(orig["id"], comp["id"])
          self.assertEqual(orig["component"], comp["component"])

        # Verify non-default mapped values match semantically
        for k, orig_v in orig.items():
          if k in ["component", "id"]:
            continue
          if k == "checks":
            continue
          if k not in comp:
            print(
                f"Missing property '{k}' in compiled component "
                f"{orig['id']} for {os.path.basename(ex_file)}"
            )
            print(f"Orig: {orig}")
            print(f"Comp: {comp}")
            self.assertIn(k, comp)
          comp_v = comp[k]
          # Normalize function call returnType omission in legacy examples
          if (
              isinstance(orig_v, dict)
              and "call" in orig_v
              and "returnType" not in orig_v
          ):
            if isinstance(comp_v, dict) and comp_v.get("call") == orig_v["call"]:
              comp_v = {k2: v2 for k2, v2 in comp_v.items() if k2 != "returnType"}
          if orig_v != comp_v:
            print(
                f"Value mismatch for property '{k}' in component "
                f"{orig['id']} for {os.path.basename(ex_file)}"
            )
            print(f"Orig: {orig_v}")
            print(f"Comp: {comp_v}")
            self.assertEqual(orig_v, comp_v)

    print(
        "\nSuccessfully completed round-trip validation across "
        f"{tested_count} standard catalog examples."
    )

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
title = Text($/title, "h3")"""

    envelope = compiler.compile(dsl, surface_id="test_data_surf")
    self.assertEqual(envelope["version"], "v1.0")
    create_surface = envelope["createSurface"]
    self.assertEqual(create_surface["surfaceId"], "test_data_surf")

    # Verify compiled dataModel dict structures
    data_model = create_surface["dataModel"]
    self.assertEqual(data_model["icon"], "check")
    self.assertEqual(data_model["title"], "Enable notification")
    self.assertEqual(data_model["user"]["firstName"], "Alice")
    self.assertEqual(data_model["user"]["age"], 30)

    # Verify decompiled dataModel DSL output
    decompiled_dsl = decompiler.decompile(envelope)
    self.assertIn('$/icon = "check"', decompiled_dsl)
    self.assertIn('$/title = "Enable notification"', decompiled_dsl)
    self.assertIn("$/user/age = 30", decompiled_dsl)
    self.assertIn('$/user/firstName = "Alice"', decompiled_dsl)
    self.assertIn("root = Card(main_column)", decompiled_dsl)

    # Round-trip check
    compiled_envelope_2 = compiler.compile(decompiled_dsl, surface_id="test_data_surf")
    self.assertEqual(compiled_envelope_2["createSurface"]["dataModel"], data_model)

  def test_skipped_and_omitted_arguments(self):
    """Validates skipped (_) and trailing omitted positional arguments compile and decompile correctly."""
    compiler = ExpressCompiler(self.catalog_path)
    decompiler = ExpressDecompiler(self.catalog_path)

    dsl = """root = Column([btn1, btn2])
btn1 = Button(btn1_label, _, Event("click"))
btn1_label = Text("Click")
btn2 = Button(btn2_label)
btn2_label = Text("Submit")"""

    envelope = compiler.compile(dsl)
    components = envelope["createSurface"]["components"]

    btn1_comp = next(c for c in components if c["id"] == "btn1")
    self.assertNotIn("variant", btn1_comp)
    self.assertEqual(btn1_comp["action"], {"event": {"name": "click", "context": {}}})

    btn2_comp = next(c for c in components if c["id"] == "btn2")
    self.assertEqual(btn2_comp["child"], "btn2_label")
    self.assertNotIn("variant", btn2_comp)
    self.assertNotIn("action", btn2_comp)

    decompiled_dsl = decompiler.decompile(envelope)
    self.assertIn('btn1 = Button(btn1_label, _, Event("click"))', decompiled_dsl)
    self.assertIn("btn2 = Button(btn2_label)", decompiled_dsl)
    # Ensure no nulls are decompiled
    self.assertNotIn("null", decompiled_dsl)

  def test_delete_surface_and_template_and_rootless_data(self):
    """Validates standalone deleteSurface, _template helper, and rootless updateDataModel."""
    compiler = ExpressCompiler(self.catalog_path)
    decompiler = ExpressDecompiler(self.catalog_path)

    # 1. Test deleteSurface parsing/compiling/decompiling
    delete_dsl = 'deleteSurface("my-surface-123")'
    del_envelope = compiler.compile(delete_dsl)
    self.assertEqual(
        del_envelope,
        {"version": "v1.0", "deleteSurface": {"surfaceId": "my-surface-123"}},
    )
    self.assertEqual(
        decompiler.decompile(del_envelope).strip(), f"<a2ui>\n{delete_dsl}\n</a2ui>"
    )

    # 2. Test rootless updateDataModel parsing/compiling/decompiling
    data_dsl = """$/form/firstName = "Alice"
$/form/lastName = "Smith"
$/age = 25"""
    data_envelope = compiler.compile(data_dsl, surface_id="data-surf")
    self.assertEqual(
        data_envelope,
        {
            "version": "v1.0",
            "updateDataModel": {
                "surfaceId": "data-surf",
                "path": "/",
                "value": {
                    "form": {"firstName": "Alice", "lastName": "Smith"},
                    "age": 25,
                },
            },
        },
    )
    self.assertIn('$/form/firstName = "Alice"', decompiler.decompile(data_envelope))

    # 3. Test _template helper list compilation
    list_dsl = """root = Card(breedList)
        breedList = List(_template($/breeds, breedTemplate))
        breedTemplate = Image($url)
        $/breeds = [{"url": "https://example.com/poodle.jpg"}]"""
    list_envelope = compiler.compile(list_dsl)
    components = list_envelope["createSurface"]["components"]

    # Assert breedList component children path mapping
    list_comp = next(c for c in components if c["id"] == "breedList")
    self.assertEqual(
        list_comp["children"], {"path": "/breeds", "componentId": "breedTemplate"}
    )

    # Assert breedTemplate image url data binding path mapping
    template_comp = next(c for c in components if c["id"] == "breedTemplate")
    self.assertEqual(template_comp["url"], {"path": "url"})

    # Assert dataModel contains the list of objects with url keys
    self.assertEqual(
        list_envelope["createSurface"]["dataModel"]["breeds"],
        [{"url": "https://example.com/poodle.jpg"}],
    )

    self.assertIn(
        "breedList = List(_template($/breeds, breedTemplate))",
        decompiler.decompile(list_envelope),
    )

    # 4. Test map literal parsing and nested array of maps
    map_dsl = """$/form/data = [{"id": 1, "meta": {"name": "Alice"}}]"""
    map_envelope = compiler.compile(map_dsl)
    self.assertEqual(
        map_envelope["updateDataModel"]["value"]["form"]["data"],
        [{"id": 1, "meta": {"name": "Alice"}}],
    )

  def test_compiler_robustness_and_edge_cases(self):
    """Verifies tokenizer errors, string parsing with '=' chars, and boolean schemas."""
    compiler = ExpressCompiler(self.catalog_path)

    # 1. Test tokenizer syntax error on unrecognized character
    with self.assertRaises(SyntaxError):
      compiler.compile("root = Column(@rep)")

    # 2. Test string containing '=' character inside assignment value
    dsl_with_equals = 'welcome = Text("Hello = World")\nroot = Column([welcome])'
    envelope = compiler.compile(dsl_with_equals)
    welcome_comp = next(
        c for c in envelope["createSurface"]["components"] if c["id"] == "welcome"
    )
    self.assertEqual(welcome_comp["text"], "Hello = World")

    # 3. Test prompt generator with boolean schemas safety check
    # We mock schema helper to return a boolean schema for a property
    original_get_property_schema = self.helper.get_property_schema

    def mock_get_property_schema(comp_name, prop_name):
      if comp_name == "Button" and prop_name == "disabled":
        return False  # boolean schema
      return original_get_property_schema(comp_name, prop_name)

    self.helper.get_property_schema = mock_get_property_schema
    try:
      generator = ExpressPromptGenerator(self.catalog_path)
      # Override the internal helper with our mocked helper
      generator.helper = self.helper
      prompt = generator.generate_prompt()
      # Should compile without throwing AttributeError on boolean schema check
      self.assertIsNotNone(prompt)
    finally:
      self.helper.get_property_schema = original_get_property_schema

    # 4. Verify ValueError on parser expression failures
    with self.assertRaises(ValueError):
      compiler.compile("root = Column(repField)\nrepField = TextField(,)")

    # 5. Verify ValueError on template helper with missing args
    with self.assertRaises(ValueError):
      compiler.compile("root = List(_template($/path))")

    # 6. Verify Event helper compilation with both dictionary and list of dictionaries context layouts
    event_dsl_dict = 'root = Button("Submit", _, Event("click", {"source": "btn"}))'
    event_envelope_dict = compiler.compile(event_dsl_dict)
    btn_comp_dict = next(
        c
        for c in event_envelope_dict["createSurface"]["components"]
        if c["id"] == "root"
    )
    self.assertEqual(btn_comp_dict["action"]["event"]["context"]["source"], "btn")

    event_dsl_list = (
        'root = Button("Submit", _, Event("click", [{"source": "btn_list"}]))'
    )
    event_envelope_list = compiler.compile(event_dsl_list)
    btn_comp_list = next(
        c
        for c in event_envelope_list["createSurface"]["components"]
        if c["id"] == "root"
    )
    self.assertEqual(btn_comp_list["action"]["event"]["context"]["source"], "btn_list")

    # 7. Verify allOf boolean schema safety checks in CatalogSchemaHelper
    # We dynamically inject a boolean schema into helper.components["Button"]["allOf"]
    original_components = self.helper.components.copy()
    try:
      self.helper.components["Button"] = {
          "allOf": [True, {"properties": {"test_prop": {"type": "string"}}}]
      }
      # Should return None for missing prop without raising TypeError
      self.assertIsNone(self.helper.get_property_schema("Button", "non_existent"))
      # Should return the correct schema for test_prop
      self.assertEqual(
          self.helper.get_property_schema("Button", "test_prop"),
          {"type": "string"},
      )
    finally:
      self.helper.components = original_components

    # 8. Verify bare $ path compilation (resolves to {"path": ""})
    dollar_dsl = """root = Text($)"""
    dollar_envelope = compiler.compile(dollar_dsl)
    text_comp = next(
        c for c in dollar_envelope["createSurface"]["components"] if c["id"] == "root"
    )
    self.assertEqual(text_comp["text"], {"path": ""})

    # 9. Verify nested check compilation and active value path injection
    nested_check_dsl = """root = TextField("Label", $/form/email, "placeholder", "shortText", ?and([?required, ?email]))"""
    nested_check_envelope = compiler.compile(nested_check_dsl)
    textfield_comp = next(
        c
        for c in nested_check_envelope["createSurface"]["components"]
        if c["id"] == "root"
    )
    checks = textfield_comp["checks"]
    self.assertEqual(len(checks), 1)
    self.assertEqual(checks[0]["message"], "And check failed")
    self.assertEqual(
        checks[0]["condition"],
        {
            "call": "and",
            "args": {
                "values": [
                    {"call": "required", "args": {"value": {"path": "/form/email"}}},
                    {"call": "email", "args": {"value": {"path": "/form/email"}}},
                ]
            },
        },
    )

    # 10. Verify inline component constructor unrolling
    inline_dsl = """root = Row([Text("Soup"), Text("$8")])"""
    inline_envelope = compiler.compile(inline_dsl)
    comps = inline_envelope["createSurface"]["components"]
    self.assertEqual(len(comps), 3)

    row_comp = next(c for c in comps if c["id"] == "root")
    self.assertEqual(row_comp["component"], "Row")
    self.assertEqual(row_comp["children"], ["_inline_1", "_inline_2"])

    text1 = next(c for c in comps if c["id"] == "_inline_1")
    self.assertEqual(text1["component"], "Text")
    self.assertEqual(text1["text"], "Soup")

    text2 = next(c for c in comps if c["id"] == "_inline_2")
    self.assertEqual(text2["component"], "Text")
    self.assertEqual(text2["text"], "$8")

    # 11. Verify comment line skipping (# and //)
    comment_dsl = """
    # This is a comment at the top
    root = Row([btn]) # Inline comment here
    // Another comment block
    btn = Button("Submit") // Inline comment 2
    """
    comment_envelope = compiler.compile(comment_dsl)
    comment_comps = comment_envelope["createSurface"]["components"]
    self.assertEqual(len(comment_comps), 2)

  def test_decompiler_coverage_boost(self):
    """Boosts coverage of ExpressDecompiler by hitting uncovered paths."""
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

      # Compile the DSL content
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
        self.assertIsNotNone(
            expected_msg, f"Expected deleteSurface message for {base_name}"
        )
        self.assertEqual(
            expected_msg["deleteSurface"], compiled_envelope["deleteSurface"]
        )
        continue

      if "callFunction" in compiled_envelope:
        expected_msg = next((m for m in messages if "callFunction" in m), None)
        self.assertIsNotNone(
            expected_msg, f"Expected callFunction message for {base_name}"
        )
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
        self.assertIsNotNone(
            expected_msg,
            f"Expected updateDataModel or updateData message for {base_name}",
        )
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

      # Compare components lists semantically
      self.assertEqual(
          len(compiled_components),
          len(expected_components),
          f"Component count mismatch in {base_name}: compiled"
          f" {len(compiled_components)}, expected {len(expected_components)}",
      )

      # Sort both lists by ID for order-independent comparison
      expected_sorted = sorted(expected_components, key=lambda x: x["id"])
      compiled_sorted = sorted(compiled_components, key=lambda x: x["id"])

      for idx, expected in enumerate(expected_sorted):
        compiled = compiled_sorted[idx]
        self.assertEqual(
            expected["id"],
            compiled["id"],
            f"Component ID mismatch in {base_name} at index {idx}: expected"
            f" {expected['id']}, got {compiled['id']}",
        )
        self.assertEqual(
            expected["component"],
            compiled["component"],
            f"Component type mismatch in {base_name} for ID {expected['id']}: expected"
            f" {expected['component']}, got {compiled['component']}",
        )

        # Compare properties semantically
        for key, exp_val in expected.items():
          if key in ["id", "component"]:
            continue
          self.assertIn(
              key,
              compiled,
              f"Missing property '{key}' in compiled component {expected['id']} of"
              f" {base_name}",
          )

          comp_val = normalize_value(compiled[key])
          exp_val = normalize_value(exp_val)
          self.assertEqual(
              exp_val,
              comp_val,
              f"Value mismatch for property '{key}' in component {expected['id']} of"
              f" {base_name}: expected {exp_val}, got {comp_val}",
          )

  def test_v10_validator_gating(self):
    """Verifies that A2uiValidator gates v1.0 validation behind flags."""
    from a2ui.schema.catalog import CatalogConfig
    from a2ui.schema.manager import A2uiSchemaManager
    from a2ui.schema.validator import A2uiValidator

    catalog_config = CatalogConfig.from_path("basic_catalog", self.catalog_path)
    manager = A2uiSchemaManager(version="1.0", catalogs=[catalog_config])
    catalog = manager.get_selected_catalog()

    # Save original environment
    orig_express = os.environ.get("A2UI_EXPRESS_ENABLED")
    orig_v1_0 = os.environ.get("A2UI_VERSION_1_0")

    # Clear both environment variables
    if "A2UI_EXPRESS_ENABLED" in os.environ:
      del os.environ["A2UI_EXPRESS_ENABLED"]
    if "A2UI_VERSION_1_0" in os.environ:
      del os.environ["A2UI_VERSION_1_0"]

    try:
      # Instantiating the validator when neither flag is set should raise ValueError
      with self.assertRaises(ValueError) as context:
        A2uiValidator(catalog)
      self.assertIn("A2UI v1.0 validation is experimental", str(context.exception))

      # Instantiating with A2UI_VERSION_1_0=true should succeed
      os.environ["A2UI_VERSION_1_0"] = "true"
      validator = A2uiValidator(catalog)
      self.assertEqual(validator.version, "1.0")

      # Clear A2UI_VERSION_1_0
      del os.environ["A2UI_VERSION_1_0"]

      # Instantiating with A2UI_EXPRESS_ENABLED=true should succeed (auto-enablement)
      os.environ["A2UI_EXPRESS_ENABLED"] = "true"
      validator = A2uiValidator(catalog)
      self.assertEqual(validator.version, "1.0")

    finally:
      # Restore original environment
      if orig_express is not None:
        os.environ["A2UI_EXPRESS_ENABLED"] = orig_express
      elif "A2UI_EXPRESS_ENABLED" in os.environ:
        del os.environ["A2UI_EXPRESS_ENABLED"]

      if orig_v1_0 is not None:
        os.environ["A2UI_VERSION_1_0"] = orig_v1_0
      elif "A2UI_VERSION_1_0" in os.environ:
        del os.environ["A2UI_VERSION_1_0"]

  def test_compiler_concurrency(self):
    """Verifies that ExpressCompiler is thread-safe and supports concurrent compilation."""
    import threading
    from a2ui.experimental.express.compiler import ExpressCompiler

    compiler = ExpressCompiler(self.catalog_path)
    errors = []

    # Two distinct compilations running in parallel threads on the same instance
    dsl_1 = """
root = Column([text1])
text1 = Text("Hello Thread 1")
"""
    dsl_2 = """
root = Column([button2])
button2 = Button(btnLabel)
btnLabel = Text("Click Thread 2")
"""

    def compile_worker(dsl: str, expected_id: str):
      try:
        res = compiler.compile(dsl, surface_id="test_surf")
        components = res["createSurface"]["components"]
        # Find the specific expected child component in the flat components list
        child = next((c for c in components if c["id"] == expected_id), None)
        self.assertIsNotNone(child)
        self.assertEqual(child["id"], expected_id)
      except Exception as e:
        errors.append(e)

    threads = []
    # Start 10 parallel threads to increase probability of interleaving conflicts
    for i in range(5):
      threads.append(threading.Thread(target=compile_worker, args=(dsl_1, "text1")))
      threads.append(threading.Thread(target=compile_worker, args=(dsl_2, "button2")))

    for t in threads:
      t.start()
    for t in threads:
      t.join()

    self.assertEqual(errors, [], f"Concurrency errors encountered: {errors}")

  def test_pr_fixes_regression(self):
    """Regression tests for sentinel spacing, decompiler string refs, empty lines."""
    from a2ui.experimental.express.compiler import ExpressCompiler
    from a2ui.experimental.express.decompiler import ExpressDecompiler
    from a2ui.experimental.express.schema_helper import CatalogSchemaHelper

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

    # 4. Regression test: Boolean schemas inside allOf in CatalogSchemaHelper
    helper = CatalogSchemaHelper(self.catalog_path)
    self.assertIsNotNone(helper.components)

  def test_string_quoting_and_escaping(self):
    """Verifies parsing, compilation, and decompilation of various string quoting forms."""
    compiler = ExpressCompiler(self.catalog_path)
    decompiler = ExpressDecompiler(self.catalog_path)

    # Helper to compile and retrieve a Text component's value
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
    # Unsupported escape sequence is treated as literal
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
    # Standard string with quotes -> triple-quoted decompiled output
    envelope_quote = compiler.compile('root = Text("hello \\"world\\"")')
    decompiled_quote = decompiler.decompile(envelope_quote)
    self.assertIn('root = Text("""hello "world"""")', decompiled_quote)

    # Standard string with newline -> triple-quoted decompiled output
    envelope_nl = compiler.compile('root = Text("hello \\n world")')
    decompiled_nl = decompiler.decompile(envelope_nl)
    self.assertIn('root = Text("""hello \n world""")', decompiled_nl)

    # Standard string with backslashes but no quotes/newlines -> raw single-quoted output
    envelope_raw = compiler.compile('root = Text("C:\\\\path\\\\to\\\\file")')
    decompiled_raw = decompiler.decompile(envelope_raw)
    self.assertIn('root = Text(r"C:\\path\\to\\file")', decompiled_raw)

    # 6. Additional Edge Cases
    # Empty strings
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

    # Literal double escape vs single escape in standard string
    self.assertEqual(get_compiled_text('"hello \\\\n world"'), "hello \\n world")

    # Standard string ending in a backslash (unterminated quote syntax error)
    with self.assertRaises(SyntaxError):
      compiler.compile('root = Text("hello\\")')

    # Standard string with unescaped nested quote (should raise ValueError wrapping parser error)
    with self.assertRaises(ValueError):
      compiler.compile('root = Text("hello "world"")')

    # Raw single-quoted string with unescaped nested quote (should raise ValueError wrapping parser error)
    with self.assertRaises(ValueError):
      compiler.compile('root = Text(r"hello "world"")')

    # Triple-quoted raw string with nested triple-quotes (should raise SyntaxError due to early termination and unexpected characters)
    with self.assertRaises(SyntaxError):
      compiler.compile('root = Text(r"""hello """world""")')

    # 7. Unescaped nested parentheses in multi-line strings
    self.assertEqual(
        get_compiled_text('"""hello ) world\nline 2"""'), "hello ) world\nline 2"
    )

    # 8. Streaming Compatibility and Tolerance (is_final=False)
    # Standalone model updates with a trailing incomplete string
    incomplete_dsl = '$/foo = 123\n$/bar = """unclosed string...\n'
    # Default (is_final=True) should raise SyntaxError
    with self.assertRaises(SyntaxError):
      compiler.compile(incomplete_dsl)

    # is_final=False should compile $/foo and discard the incomplete $/bar
    res_partial = compiler.compile(incomplete_dsl, is_final=False)
    self.assertEqual(res_partial["updateDataModel"]["value"]["foo"], 123)
    self.assertNotIn("bar", res_partial["updateDataModel"]["value"])

    # Early parser errors in completed statements should still raise ValueError even when is_final=False
    invalid_dsl_early = '$/foo = Event("save", {rep})\n$/bar = """unclosed string...\n'
    with self.assertRaises(ValueError):
      compiler.compile(invalid_dsl_early, is_final=False)

    # Standalone model updates with a trailing unbalanced structure (brackets/parentheses)
    incomplete_dsl_brackets = "$/foo = 123\n$/bar = Column([\n"
    # Default (is_final=True) should raise SyntaxError due to unbalanced symbols
    with self.assertRaises(SyntaxError):
      compiler.compile(incomplete_dsl_brackets)

    # is_final=False should compile $/foo and discard the unbalanced $/bar
    res_partial_brackets = compiler.compile(incomplete_dsl_brackets, is_final=False)
    self.assertEqual(res_partial_brackets["updateDataModel"]["value"]["foo"], 123)
    self.assertNotIn("bar", res_partial_brackets["updateDataModel"]["value"])


if __name__ == "__main__":
  unittest.main()
