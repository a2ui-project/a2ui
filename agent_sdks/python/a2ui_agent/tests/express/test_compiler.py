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

"""Unit tests focusing on the A2UI Express Compiler and Prompt Generator."""

import os
import unittest

os.environ["A2UI_EXPRESS_ENABLED"] = "true"

from a2ui.experimental.express.prompt_generator import ExpressPromptGenerator
from a2ui.experimental.express.compiler import ExpressCompiler
from a2ui.experimental.express.schema_helper import CatalogSchemaHelper

SPEC_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..", "..", "specification", "v1_0"
    )
)
CATALOG_PATH = os.path.join(SPEC_DIR, "catalogs", "basic", "catalog.json")


class TestExpressCompiler(unittest.TestCase):
  """Test suite covering the Express compiler, prompt generation, and schema parsing."""

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

  def test_compilation_basic(self):
    """Validates parsing and compiling basic components and validations."""
    compiler = ExpressCompiler(self.catalog_path)
    dsl = """root = Column([repField, valueField])
repField = TextField("Representative", $/form/rep, "Enter name")
valueField = TextField("Deal Value", $/form/value, "0.00", "number", ?required)"""

    envelope = compiler.compile(dsl, surface_id="test_surf")
    self.assertEqual(envelope["version"], "v1.0")
    self.assertEqual(envelope["createSurface"]["surfaceId"], "test_surf")

    components = envelope["createSurface"]["components"]
    self.assertEqual(len(components), 3)

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

  def test_format_string_and_actions(self):
    """Validates compilation of string interpolation and interactive actions."""
    compiler = ExpressCompiler(self.catalog_path)
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

  def test_standalone_function_call(self):
    """Validates compilation of standalone function calls into CallFunctionMessages."""
    compiler = ExpressCompiler(self.catalog_path)
    dsl = """openUrl("https://example.com")"""
    envelope = compiler.compile(dsl)

    self.assertEqual(envelope["version"], "v1.0")
    self.assertIn("callFunction", envelope)
    self.assertEqual(envelope["callFunction"]["call"], "openUrl")
    self.assertEqual(envelope["callFunction"]["args"], {"url": "https://example.com"})

  def test_map_variable_inlining(self):
    """Validates compiling variable assignments holding map literals and inlining them."""
    compiler = ExpressCompiler(self.catalog_path)
    dsl = """root = Tabs([tab1])
tab1 = {title: "Overview", child: contentCol}
contentCol = Column([])"""

    envelope = compiler.compile(dsl)
    components = envelope["createSurface"]["components"]

    tabs_comp = next(c for c in components if c["id"] == "root")
    self.assertEqual(tabs_comp["component"], "Tabs")
    self.assertEqual(tabs_comp["tabs"], [{"title": "Overview", "child": "contentCol"}])

  def test_event_and_list_variable_inlining(self):
    """Validates that Event helper assignments and custom list arrays assigned to variables inline correctly."""
    compiler = ExpressCompiler(self.catalog_path)
    dsl = """root = Column([btn1, btn2])
btn1 = Button(btn1Label, "primary", myAction)
btn1Label = Text("Save")
btn2 = Button(btn2Label, "borderless", closeAction)
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

  def test_skipped_and_omitted_arguments(self):
    """Validates skipped (_) and trailing omitted positional arguments compile correctly."""
    compiler = ExpressCompiler(self.catalog_path)
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

  def test_delete_surface_and_template_and_rootless_data(self):
    """Validates standalone deleteSurface, _template helper, and rootless updateDataModel."""
    compiler = ExpressCompiler(self.catalog_path)

    # 1. Test deleteSurface
    delete_dsl = 'deleteSurface("my-surface-123")'
    del_envelope = compiler.compile(delete_dsl)
    self.assertEqual(
        del_envelope,
        {"version": "v1.0", "deleteSurface": {"surfaceId": "my-surface-123"}},
    )

    # 2. Test rootless updateDataModel
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

    # 3. Test _template helper list
    list_dsl = """root = Card(breedList)
breedList = List(_template($/breeds, breedTemplate))
breedTemplate = Image($url)
$/breeds = [{"url": "https://example.com/poodle.jpg"}]"""
    list_envelope = compiler.compile(list_dsl)
    components = list_envelope["createSurface"]["components"]

    list_comp = next(c for c in components if c["id"] == "breedList")
    self.assertEqual(
        list_comp["children"], {"path": "/breeds", "componentId": "breedTemplate"}
    )

    template_comp = next(c for c in components if c["id"] == "breedTemplate")
    self.assertEqual(template_comp["url"], {"path": "url"})

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
    original_get_property_schema = self.helper.get_property_schema

    def mock_get_property_schema(comp_name, prop_name):
      if comp_name == "Button" and prop_name == "disabled":
        return False
      return original_get_property_schema(comp_name, prop_name)

    self.helper.get_property_schema = mock_get_property_schema
    try:
      generator = ExpressPromptGenerator(self.catalog_path)
      generator.helper = self.helper
      prompt = generator.generate_prompt()
      self.assertIsNotNone(prompt)
    finally:
      self.helper.get_property_schema = original_get_property_schema

    # 4. Verify ValueError on parser expression failures
    with self.assertRaises(ValueError):
      compiler.compile("root = Column(repField)\nrepField = TextField(,)")

    # 5. Verify ValueError on template helper with missing args
    with self.assertRaises(ValueError):
      compiler.compile("root = List(_template($/path))")

    # 6. Verify Event helper compilation context layouts
    event_dsl_dict = 'root = Button("Submit", _, Event("click", {"source": "btn"}))'
    event_envelope_dict = compiler.compile(event_dsl_dict)
    btn_comp_dict = next(
        c
        for c in event_envelope_dict["createSurface"]["components"]
        if c["id"] == "root"
    )
    self.assertEqual(btn_comp_dict["action"]["event"]["context"]["source"], "btn")

    # 7. Verify allOf boolean schema safety checks in CatalogSchemaHelper
    original_components = self.helper.components.copy()
    try:
      self.helper.components["Button"] = {
          "allOf": [True, {"properties": {"test_prop": {"type": "string"}}}]
      }
      self.assertIsNone(self.helper.get_property_schema("Button", "non_existent"))
      self.assertEqual(
          self.helper.get_property_schema("Button", "test_prop"),
          {"type": "string"},
      )
    finally:
      self.helper.components = original_components

    # 8. Verify bare $ path compilation
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

    # 11. Verify comment line skipping (#, // and /* */)
    comment_dsl = """
    # This is a comment at the top
    /* Multi-line block comment
       that spans multiple lines */
    root = Row([btn]) /* Inline block comment */ # Inline comment here
    // Another comment block
    btn = Button("Submit") // Inline comment 2
    """
    comment_envelope = compiler.compile(comment_dsl)
    comment_comps = comment_envelope["createSurface"]["components"]
    self.assertEqual(len(comment_comps), 2)

  def test_compiler_custom_validation_messages_and_fallback_functions(self):
    """Targeted tests covering custom validation error messages and unregistered fallback function compilation."""
    compiler = ExpressCompiler(self.catalog_path)

    # 1. Test check with custom error message breaking the positional property mapping loop
    dsl_check_msg = (
        'root = TextField("Label", $/val, ?numeric(1, 10, "Custom range error'
        ' message"))'
    )
    res = compiler.compile(dsl_check_msg)
    checks = res["createSurface"]["components"][0]["checks"]
    self.assertEqual(len(checks), 1)
    self.assertEqual(checks[0]["condition"]["call"], "numeric")
    self.assertEqual(checks[0]["condition"]["args"]["min"], 1)
    self.assertEqual(checks[0]["condition"]["args"]["max"], 10)
    self.assertEqual(checks[0]["message"], "Custom range error message")

    # 2. Test unregistered function call fallback
    dsl_fallback_fn = 'root = TextField("Label", my_unregistered_func(1, 2))'
    res_fallback = compiler.compile(dsl_fallback_fn)
    tf = res_fallback["createSurface"]["components"][0]
    self.assertEqual(tf["value"]["call"], "my_unregistered_func")
    self.assertEqual(tf["value"]["args"], [1, 2])

  def test_compiler_concurrency(self):
    """Verifies that ExpressCompiler is thread-safe and supports concurrent compilation."""
    import threading

    compiler = ExpressCompiler(self.catalog_path)
    errors = []

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
        child = next((c for c in components if c["id"] == expected_id), None)
        self.assertIsNotNone(child)
        self.assertEqual(child["id"], expected_id)
      except Exception as e:
        errors.append(e)

    threads = []
    for _ in range(5):
      threads.append(threading.Thread(target=compile_worker, args=(dsl_1, "text1")))
      threads.append(threading.Thread(target=compile_worker, args=(dsl_2, "button2")))

    for t in threads:
      t.start()
    for t in threads:
      t.join()

    self.assertEqual(errors, [], f"Concurrency errors encountered: {errors}")

  def test_v10_validator_gating(self):
    """Verifies that A2uiValidator gates v1.0 validation behind flags."""
    from a2ui.schema.catalog import CatalogConfig
    from a2ui.schema.manager import A2uiSchemaManager
    from a2ui.schema.validator import A2uiValidator

    catalog_config = CatalogConfig.from_path("basic_catalog", self.catalog_path)
    manager = A2uiSchemaManager(version="1.0", catalogs=[catalog_config])
    catalog = manager.get_selected_catalog()

    orig_express = os.environ.get("A2UI_EXPRESS_ENABLED")
    orig_v1_0 = os.environ.get("A2UI_VERSION_1_0")

    if "A2UI_EXPRESS_ENABLED" in os.environ:
      del os.environ["A2UI_EXPRESS_ENABLED"]
    if "A2UI_VERSION_1_0" in os.environ:
      del os.environ["A2UI_VERSION_1_0"]

    try:
      with self.assertRaises(ValueError) as context:
        A2uiValidator(catalog)
      self.assertIn("A2UI v1.0 validation is experimental", str(context.exception))

      os.environ["A2UI_VERSION_1_0"] = "true"
      validator = A2uiValidator(catalog)
      self.assertEqual(validator.version, "1.0")

      del os.environ["A2UI_VERSION_1_0"]

      os.environ["A2UI_EXPRESS_ENABLED"] = "true"
      validator = A2uiValidator(catalog)
      self.assertEqual(validator.version, "1.0")

    finally:
      if orig_express is not None:
        os.environ["A2UI_EXPRESS_ENABLED"] = orig_express
      elif "A2UI_EXPRESS_ENABLED" in os.environ:
        del os.environ["A2UI_EXPRESS_ENABLED"]

      if orig_v1_0 is not None:
        os.environ["A2UI_VERSION_1_0"] = orig_v1_0
      elif "A2UI_VERSION_1_0" in os.environ:
        del os.environ["A2UI_VERSION_1_0"]

  def test_semicolons_and_trailing_commas_and_line_continuation(self):
    """Verifies that optional semicolons, trailing commas, and line continuations compile correctly."""
    compiler = ExpressCompiler(self.catalog_path)

    # 1. Test optional semicolons at the end of statements
    semicolon_dsl = """
    root = Column([btn1]);
    btn1 = Button("Click Me");
    """
    envelope = compiler.compile(semicolon_dsl)
    self.assertEqual(len(envelope["createSurface"]["components"]), 2)

    # 2. Test trailing commas in lists, maps, component calls, and checks
    trailing_comma_dsl = """
    root = Column([btn1, btn2,],);
    btn1 = Button("Label", "primary", myAction,);
    btn2 = TextField("Input", $/val, "placeholder", _, ?numeric(1, 10,),);
    myAction = Event("click", {a: 1, b: 2,},);
    """
    envelope2 = compiler.compile(trailing_comma_dsl)
    components = envelope2["createSurface"]["components"]
    self.assertEqual(len(components), 3)

    # 3. Test line continuation where newlines are completely insignificant
    continuation_dsl = """
    root
      =
      Column
      (
        [
          btn1
        ]
      )
    btn1 = Text("Hello World")
    """
    envelope3 = compiler.compile(continuation_dsl)
    self.assertEqual(len(envelope3["createSurface"]["components"]), 2)

  def test_strict_enum_validation(self):
    """Verifies that the compiler raises a ValueError when an invalid enum option is passed."""
    compiler = ExpressCompiler(self.catalog_path)
    invalid_dsl = 'root = Button("Click", "invalid_variant")'
    with self.assertRaises(ValueError) as context:
      compiler.compile(invalid_dsl)
    self.assertIn(
        "is not a valid enum choice for property 'variant'", str(context.exception)
    )

  def test_nested_databinding_validation(self):
    """Verifies that the compiler recursively blocks nested data bindings on static properties."""
    compiler = ExpressCompiler(self.catalog_path)

    # 1. Direct databinding (should fail)
    invalid_dsl1 = 'root = Button("Click", $/some/path)'
    with self.assertRaises(ValueError) as context:
      compiler.compile(invalid_dsl1)
    self.assertIn("does not support dynamic data bindings", str(context.exception))

    # 2. Nested inside list (should fail)
    invalid_dsl2 = 'root = Button("Click", [$/some/path])'
    with self.assertRaises(ValueError) as context:
      compiler.compile(invalid_dsl2)
    self.assertIn("does not support dynamic data bindings", str(context.exception))

    # 3. Deeply nested inside dict inside list (should fail)
    invalid_dsl3 = 'root = Button("Click", [{label: "Click", value: $/some/path}])'
    with self.assertRaises(ValueError) as context:
      compiler.compile(invalid_dsl3)
    self.assertIn("does not support dynamic data bindings", str(context.exception))

    # 4. Valid Event action containing databinding (should succeed)
    valid_dsl = 'root = Button("Click", "primary", Event("click", {rep: $/some/path}))'
    envelope = compiler.compile(valid_dsl)
    self.assertEqual(len(envelope["createSurface"]["components"]), 1)


if __name__ == "__main__":
  unittest.main()
