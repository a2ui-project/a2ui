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

import json
import os
import unittest
from a2ui.core.catalog import Catalog
from a2ui.inference_formats.experimental.express.compiler import ExpressCompiler


class TestVersionCompliance(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        spec_dir = os.path.abspath(
            os.path.join(
                os.path.dirname(__file__),
                "..",
                "..",
                "..",
                "..",
                "..",
                "specification",
                "v0_9",
            )
        )
        catalog_path = os.path.join(spec_dir, "catalogs", "basic", "catalog.json")
        with open(catalog_path, "r", encoding="utf-8") as f:
            catalog_dict = json.load(f)
        cls.catalog = Catalog.from_json(catalog_dict, spec_version="0.9.1")

    def test_compile_v1_0_unified(self):
        compiler = ExpressCompiler(self.catalog, version="v1.0")
        dsl = """
        root = Column([txt])
        txt = Text("Hello World")
        $/user/name = "Alice"
        """
        res = compiler.compile(dsl, surface_id="surf_v1")
        self.assertIsInstance(res, list)
        self.assertEqual(len(res), 1)
        envelope = res[0]
        self.assertEqual(envelope["version"], "v1.0")
        self.assertIn("createSurface", envelope)
        self.assertIn("components", envelope["createSurface"])
        self.assertIn("dataModel", envelope["createSurface"])

    def test_compile_v0_9_multi_message(self):
        compiler = ExpressCompiler(self.catalog, version="v0.9")
        dsl = """
        root = Column([txt])
        txt = Text("Hello World")
        $/user/name = "Alice"
        """
        res = compiler.compile(dsl, surface_id="surf_v09")
        self.assertIsInstance(res, list)
        self.assertEqual(len(res), 3)

        # Message 1: createSurface
        self.assertEqual(res[0]["version"], "v0.9")
        self.assertIn("createSurface", res[0])
        self.assertNotIn("components", res[0]["createSurface"])

        # Message 2: updateComponents
        self.assertEqual(res[1]["version"], "v0.9")
        self.assertIn("updateComponents", res[1])

        # Message 3: updateDataModel
        self.assertEqual(res[2]["version"], "v0.9")
        self.assertIn("updateDataModel", res[2])

    def test_compile_v0_9_1_target(self):
        compiler = ExpressCompiler(self.catalog, version="v0.9.1")
        dsl = """
        root = Text("Hi")
        """
        res = compiler.compile(dsl, surface_id="surf_v091")
        self.assertIsInstance(res, list)
        self.assertEqual(len(res), 2)
        self.assertEqual(res[0]["version"], "v0.9.1")
        self.assertEqual(res[1]["version"], "v0.9.1")

    def test_v0_9_standalone_function_call_error(self):
        compiler = ExpressCompiler(self.catalog, version="v0.9")
        dsl = 'openUrl("https://example.com")'
        with self.assertRaises(ValueError) as cm:
            compiler.compile(dsl)
        self.assertIn(
            "Standalone function calls are not supported in A2UI v0.9",
            str(cm.exception),
        )


if __name__ == "__main__":
    unittest.main()
