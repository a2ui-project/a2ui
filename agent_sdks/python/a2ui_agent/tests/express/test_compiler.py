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

"""Unit tests focusing on the Python A2UI Express Compiler.

Data-driven input/output compilation behavior is comprehensively covered by the
platform-agnostic conformance suite in `conformance/agent/express/compiler.yaml`
(run via `tests/conformance/test_conformance.py`).

These unit tests specifically cover Python language-specific aspects that
conformance suites leave to the SDK implementation:
- Multi-threaded execution and compiler thread safety
- Custom Python exception hierarchies and error properties (e.g. ExpressCompilerError subclasses)
- Catalog polymorphism (accepting Catalog models, A2uiCatalog instances, and raw dictionaries)
- Python schema helper initialization validation and feature flag gating
"""

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

CATALOGS_DIR = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "..", "..", "catalogs", "basic"
    )
)
CATALOG_PATH = os.path.join(CATALOGS_DIR, "v1", "catalog.json")


class TestExpressCompiler(unittest.TestCase):
    """Test suite covering the Express compiler, prompt generation, and schema parsing."""

    def setUp(self):
        """Initializes standard test paths and schema helpers."""
        self.catalog_path = CATALOG_PATH
        with open(self.catalog_path, "r", encoding="utf-8") as f:
            catalog_dict = json.load(f)
        self.catalog = Catalog.from_json(catalog_dict, spec_version="0.9.1")
        self.helper = CatalogSchemaHelper(self.catalog)

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
