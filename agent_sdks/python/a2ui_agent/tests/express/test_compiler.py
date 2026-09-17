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

"""Unit tests focusing on the A2UI Express Compiler and Prompt Generator."""

import json
import os
import unittest

from a2ui.core.catalog import Catalog
from a2ui.schema.catalog import A2uiCatalog, CatalogConfig
from a2ui.inference_formats.experimental.express.prompt_generator import ExpressPromptGenerator
from a2ui.inference_formats.experimental.express.compiler import ExpressCompiler
from a2ui.inference_formats.experimental.express.schema_helper import CatalogSchemaHelper
from a2ui.inference_formats.experimental.express.parser import ExpressParser
from a2ui.inference_formats.experimental.express.errors import (
    ExpressUnknownPropertyError,
    ExpressDuplicatePropertyError,
    ExpressInvalidParamError,
    ExpressDuplicateParamError,
    ExpressForbiddenDatabindingError,
    ExpressUndefinedRootError,
)

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
        with open(self.catalog_path, "r", encoding="utf-8") as f:
            catalog_dict = json.load(f)
        self.catalog = Catalog.from_json(catalog_dict, spec_version="0.9.1")
        self.helper = CatalogSchemaHelper(self.catalog)

    def test_prompt_generator(self):
        """Verifies prompt signature compiler loads catalog components correctly."""
        from a2ui.inference_formats.experimental.express.format import ExpressFormat

        fmt = ExpressFormat(catalog=self.catalog)
        prompt = fmt.prompt_generator.generate(role_description="", include_schema=True)
        self.assertIn("Text(", prompt)
        self.assertIn("Column(", prompt)
        self.assertIn("required(", prompt)
        self.assertIn("regex(", prompt)

    # Basic, formatting, action, standalone function, map/event inlining, skipped args,
    # and deleteSurface/dataModel compilation tests have been converted to conformance tests
    # in conformance/inference_formats/express/compile.yaml.

    def test_compiler_robustness_and_edge_cases(self):
        """Verifies tokenizer errors, string parsing with '=' chars, and boolean schemas."""
        compiler = ExpressCompiler(self.catalog)

        # 1. Test tokenizer syntax error on unrecognized character
        with self.assertRaises(SyntaxError):
            compiler.compile("root = Column(@rep)")

        # 2. Test string containing '=' character inside assignment value
        dsl_with_equals = 'welcome = Text("Hello = World")\nroot = Column([welcome])'
        envelope = compiler.compile(dsl_with_equals)[0]
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
            from a2ui.inference_formats.experimental.express.format import ExpressFormat

            fmt = ExpressFormat(catalog=self.catalog)
            fmt.prompt_generator.helper = self.helper
            prompt = fmt.prompt_generator.generate(
                role_description="", include_schema=True
            )
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
        event_envelope_dict = compiler.compile(event_dsl_dict)[0]
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
        dollar_envelope = compiler.compile(dollar_dsl)[0]
        text_comp = next(
            c
            for c in dollar_envelope["createSurface"]["components"]
            if c["id"] == "root"
        )
        self.assertEqual(text_comp["text"], {"path": ""})

        # 9. Verify nested check compilation and active value path injection
        nested_check_dsl = """root = TextField("Label", $/form/email, "placeholder", "shortText", ?and([?required, ?email]))"""
        nested_check_envelope = compiler.compile(nested_check_dsl)[0]
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
                        {
                            "call": "required",
                            "args": {"value": {"path": "/form/email"}},
                        },
                        {"call": "email", "args": {"value": {"path": "/form/email"}}},
                    ]
                },
            },
        )

        # 10. Verify inline component constructor unrolling
        inline_dsl = """root = Row([Text("Soup"), Text("$8")])"""
        inline_envelope = compiler.compile(inline_dsl)[0]
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
        comment_envelope = compiler.compile(comment_dsl)[0]
        comment_comps = comment_envelope["createSurface"]["components"]
        self.assertEqual(len(comment_comps), 2)

    def test_compiler_concurrency(self):
        """Verifies that ExpressCompiler is thread-safe and supports concurrent compilation."""
        import threading

        compiler = ExpressCompiler(self.catalog)
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
                res = compiler.compile(dsl, surface_id="test_surf")[0]
                components = res["createSurface"]["components"]
                child = next((c for c in components if c["id"] == expected_id), None)
                self.assertIsNotNone(child)
                self.assertEqual(child["id"], expected_id)
            except Exception as e:
                errors.append(e)

        threads = []
        for _ in range(5):
            threads.append(
                threading.Thread(target=compile_worker, args=(dsl_1, "text1"))
            )
            threads.append(
                threading.Thread(target=compile_worker, args=(dsl_2, "button2"))
            )

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(errors, [], f"Concurrency errors encountered: {errors}")

    def test_v10_validator_gating(self):
        """Verifies that A2uiValidator gates v1.0 validation behind flags."""
        from a2ui.inference_formats.direct_json.format import DirectJsonFormat
        from a2ui.validation.validator import A2uiValidator
        from a2ui.core import A2uiCatalogError

        catalog_config = CatalogConfig.from_path("basic_catalog", self.catalog_path)
        direct_json_format = DirectJsonFormat(version="1.0", catalogs=[catalog_config])
        catalog = direct_json_format.get_selected_catalog()

        from unittest.mock import patch
        import os

        # By default, version 1.0 is disabled
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(A2uiCatalogError) as context:
                A2uiValidator(catalog)
        self.assertIn("A2UI v1.0 validation is experimental", str(context.exception))

        # It can be enabled by passing 'version_1_0' in experiments
        validator = A2uiValidator(catalog, experiments={"version_1_0"})
        self.assertEqual(validator.version, "1.0")

    def test_polymorphic_catalog_initialization(self):
        """Verifies compiler, decompiler, prompt generator, and parser with polymorphic catalogs."""
        # 1. Load raw dict
        with open(self.catalog_path, "r", encoding="utf-8") as f:
            catalog_dict = json.load(f)

        # 2. Construct Catalog model
        core_catalog = Catalog.from_json(catalog_dict, spec_version="0.9.1")

        # 3. Construct A2uiCatalog model
        a2ui_catalog = A2uiCatalog(
            version="0.9.1",
            name="basic_catalog",
            s2c_schema={},
            common_types_schema={},
            catalog_schema=catalog_dict,
        )

        dsl = """root = Column([repField, valueField])
repField = TextField("Representative", $/form/rep, "Enter name")
valueField = TextField("Deal Value", $/form/value, "0.00", "number", ?required)"""

        expected_components_count = 3

        # Test with each polymorphic input
        for cat_input in [core_catalog, a2ui_catalog]:
            # Compiler
            compiler = ExpressCompiler(cat_input)
            envelope = compiler.compile(dsl, surface_id="test_surf")[0]
            self.assertEqual(
                len(envelope["createSurface"]["components"]), expected_components_count
            )

            # Decompiler
            decompiler = ExpressParser(cat_input)
            decompiled_dsl = decompiler.decompile(envelope)
            self.assertIn("repField = TextField(", decompiled_dsl)

            # Prompt Generator
            from a2ui.inference_formats.experimental.express.format import ExpressFormat

            fmt = ExpressFormat(catalog=cat_input)
            prompt = fmt.prompt_generator.generate(
                role_description="", include_schema=True
            )
            self.assertIn("TextField(", prompt)

            # Parser
            response = f"<a2ui>\n{dsl}\n</a2ui>"
            parts = ExpressParser(cat_input, surface_id="test_surf").parse_response(
                response
            )
            self.assertEqual(len(parts), 1)
            self.assertIsNotNone(parts[0].a2ui_json)

    def test_catalog_schema_helper_initialization_errors(self):
        """Verifies that CatalogSchemaHelper raises correct errors for invalid initialization inputs."""
        # 1. None inputs raise ValueError
        # None or unsupported type raises TypeError
        with self.assertRaises(TypeError):
            CatalogSchemaHelper(None)

        with self.assertRaises(TypeError) as context:
            CatalogSchemaHelper(123)
        self.assertIn("Unsupported catalog type", str(context.exception))

        # Passing string path should now raise TypeError
        with self.assertRaises(TypeError) as context:
            CatalogSchemaHelper(self.catalog_path)
        self.assertIn("Unsupported catalog type", str(context.exception))

    def test_express_extended_coverage(self):
        """Test _set_nested_path, set!/data statements, deleteSurface, callFunction, and schema helper get_property_type."""
        from a2ui.inference_formats.experimental.express.compiler import _set_nested_path

        # 1. _set_nested_path with $ and relative paths
        d = {}
        _set_nested_path(d, "$user/name", "Alice")
        _set_nested_path(d, "config/theme", "dark")
        _set_nested_path(d, "$", "ignored")
        self.assertEqual(d["user"]["name"], "Alice")
        self.assertEqual(d["config"]["theme"], "dark")
        self.assertNotIn("", d)
        self.assertNotIn("$", d)

        # 2. set! and data statements compilation
        compiler = ExpressCompiler(self.catalog)
        dsl_data = """set $/user/age = 30
data $/items = ["a", "b"]
root = Text("Hello")"""
        envelope = compiler.compile(dsl_data)[0]
        dm = envelope["createSurface"]["dataModel"]
        self.assertEqual(dm["user"]["age"], 30)
        self.assertEqual(dm["items"], ["a", "b"])

        # 3. deleteSurface compilation
        dsl_del = 'deleteSurface("s1")'
        env_del = compiler.compile(dsl_del)[0]
        self.assertEqual(env_del["deleteSurface"]["surfaceId"], "s1")

        # 4. standalone function call compilation
        dsl_call = 'openUrl("https://example.com")'
        env_call = compiler.compile(dsl_call)[0]
        self.assertEqual(env_call["callFunction"]["call"], "openUrl")

    def test_custom_exception_types(self):
        """Verifies specific ExpressCompilerError subclasses are raised for invalid DSL constructs."""
        compiler = ExpressCompiler(self.catalog)

        # 1. Unknown component property
        with self.assertRaises(ExpressUnknownPropertyError) as ctx:
            compiler.compile('root = Text(text="Hi", nonExistentProp="bad")')
        self.assertEqual(ctx.exception.comp_name, "Text")
        self.assertEqual(ctx.exception.prop_name, "nonExistentProp")
        self.assertIn("nonExistentProp", str(ctx.exception))

        # 2. Duplicate component property
        with self.assertRaises(ExpressDuplicatePropertyError) as ctx:
            compiler.compile('root = Text("Positional", text="KeywordDuplicate")')
        self.assertEqual(ctx.exception.comp_name, "Text")
        self.assertEqual(ctx.exception.prop_name, "text")

        # 3. Invalid function parameter
        with self.assertRaises(ExpressInvalidParamError) as ctx:
            compiler.compile(
                'root = Button("Click", action=openUrl("https://example.com",'
                " unknownParam=123))"
            )
        self.assertEqual(ctx.exception.fn_name, "openUrl")
        self.assertEqual(ctx.exception.param_name, "unknownParam")

        # 4. Duplicate function parameter
        with self.assertRaises(ExpressDuplicateParamError) as ctx:
            compiler.compile(
                'root = Button("Click", action=openUrl("https://example.com",'
                ' url="https://duplicate.com"))'
            )
        self.assertEqual(ctx.exception.fn_name, "openUrl")
        self.assertEqual(ctx.exception.param_name, "url")

        # 5. Missing root definition
        with self.assertRaises(ExpressUndefinedRootError) as ctx:
            compiler.compile('some_var = Text("Hello")')
        self.assertEqual(ctx.exception.root_target, "root")


if __name__ == "__main__":
    unittest.main()
