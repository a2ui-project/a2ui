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

"""Unit tests verifying Option 4 Deterministic Sort Heuristics for positional argument ordering."""

import unittest
from a2ui.core.catalog import Catalog
from a2ui.inference_formats.experimental.express.compiler import ExpressCompiler
from a2ui.inference_formats.experimental.express.schema_helper import CatalogSchemaHelper


class TestDeterministicSortHeuristics(unittest.TestCase):
    """Verifies catalog-agnostic deterministic property ordering for Express DSL."""

    def test_schema_helper_deterministic_property_sorting(self):
        """Verifies that properties are ordered: required (alphabetical) -> optional (alphabetical) -> checks."""
        mock_catalog_dict = {
            "catalogId": "mock_catalog",
            "components": {
                "CustomWidget": {
                    "required": ["zeta", "alpha"],
                    "properties": {
                        "component": {"type": "string"},
                        "id": {"type": "string"},
                        "gamma": {"type": "string"},
                        "zeta": {"type": "string"},
                        "beta": {"type": "string"},
                        "alpha": {"type": "string"},
                        "checks": {"type": "array"},
                    },
                },
                "CheckableWidget": {
                    "allOf": [{"$ref": "#/definitions/Checkable"}],
                    "required": ["label"],
                    "properties": {
                        "component": {"type": "string"},
                        "id": {"type": "string"},
                        "variant": {"type": "string"},
                        "label": {"type": "string"},
                        "value": {"type": "string"},
                        "checks": {"type": "array"},
                    },
                },
            },
            "functions": {
                "customFunc": {
                    "properties": {
                        "args": {
                            "type": "object",
                            "required": ["valB", "valA"],
                            "properties": {
                                "optY": {"type": "number"},
                                "valB": {"type": "string"},
                                "optX": {"type": "number"},
                                "valA": {"type": "string"},
                            },
                        }
                    }
                }
            },
        }

        catalog = Catalog.from_json(mock_catalog_dict, spec_version="0.9.1")
        helper = CatalogSchemaHelper(catalog)

        # CustomWidget: Required = [alpha, zeta], Optional = [beta, gamma], Checks = [checks]
        # Expected order: ['alpha', 'zeta', 'beta', 'gamma', 'checks']
        self.assertEqual(
            helper.get_component_properties("CustomWidget"),
            ["alpha", "zeta", "beta", "gamma", "checks"],
        )

        # CheckableWidget: Required = [label], Optional = [value, variant], Checks = [checks]
        # Expected order: ['label', 'value', 'variant', 'checks']
        self.assertEqual(
            helper.get_component_properties("CheckableWidget"),
            ["label", "value", "variant", "checks"],
        )

        # customFunc: Required = [valA, valB], Optional = [optX, optY]
        # Expected order: ['valA', 'valB', 'optX', 'optY']
        self.assertEqual(
            helper.get_function_properties("customFunc"),
            ["valA", "valB", "optX", "optY"],
        )

    def test_cross_language_dict_key_order_independence(self):
        """Verifies that key insertion order in JSON dictionaries does not affect positional parameter mappings."""
        schema_order_1 = {
            "catalogId": "cat1",
            "components": {
                "TestComp": {
                    "required": ["z_req", "a_req"],
                    "properties": {
                        "z_req": {"type": "string"},
                        "b_opt": {"type": "string"},
                        "a_req": {"type": "string"},
                        "a_opt": {"type": "string"},
                    },
                }
            },
        }

        schema_order_2 = {
            "catalogId": "cat2",
            "components": {
                "TestComp": {
                    "required": ["a_req", "z_req"],
                    "properties": {
                        "a_opt": {"type": "string"},
                        "a_req": {"type": "string"},
                        "b_opt": {"type": "string"},
                        "z_req": {"type": "string"},
                    },
                }
            },
        }

        cat1 = Catalog.from_json(schema_order_1, spec_version="0.9.1")
        cat2 = Catalog.from_json(schema_order_2, spec_version="0.9.1")

        helper1 = CatalogSchemaHelper(cat1)
        helper2 = CatalogSchemaHelper(cat2)

        # Both must yield identical required-first alphabetical property order
        expected = ["a_req", "z_req", "a_opt", "b_opt"]
        self.assertEqual(helper1.get_component_properties("TestComp"), expected)
        self.assertEqual(helper2.get_component_properties("TestComp"), expected)

    def test_compiler_positional_resolution_with_shuffled_schema_keys(self):
        """Verifies that ExpressCompiler produces identical JSON envelopes regardless of raw catalog schema key ordering."""
        schema_shuffled = {
            "catalogId": "shuffled",
            "components": {
                "Widget": {
                    "required": ["req2", "req1"],
                    "properties": {
                        "opt2": {"type": "string"},
                        "req2": {"type": "string"},
                        "opt1": {"type": "string"},
                        "req1": {"type": "string"},
                        "id": {"type": "string"},
                        "component": {"type": "string"},
                    },
                }
            },
        }

        catalog = Catalog.from_json(schema_shuffled, spec_version="0.9.1")
        compiler = ExpressCompiler(catalog)

        # Positional arg 1 maps to req1, arg 2 to req2, arg 3 to opt1, arg 4 to opt2
        dsl = 'root = Widget("Val1", "Val2", "ValOpt1", "ValOpt2")'
        envelope = compiler.compile(dsl)[0]

        comp = envelope["createSurface"]["components"][0]
        self.assertEqual(comp["req1"], "Val1")
        self.assertEqual(comp["req2"], "Val2")
        self.assertEqual(comp["opt1"], "ValOpt1")
        self.assertEqual(comp["opt2"], "ValOpt2")


if __name__ == "__main__":
    unittest.main()
