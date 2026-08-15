# Copyright 2024 Google LLC
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

"""Unit tests focusing on schema utility functions in schema/utils.py."""

import unittest
from unittest.mock import patch
from a2ui.core.exceptions import A2uiCatalogError
from a2ui.schema.catalog_provider import A2uiCatalogProvider, FileSystemCatalogProvider
from a2ui.schema.common_modifiers import remove_strict_validation
from a2ui.schema.utils import (
    find_repo_root,
    load_from_bundled_resource,
    wrap_as_json_array,
    deep_update,
)


class TestSchemaUtils(unittest.TestCase):
    """Test suite covering find_repo_root, load_from_bundled_resource, and wrap_as_json_array."""

    @patch("os.path.isdir")
    def test_find_repo_root_not_found(self, mock_isdir):
        """Verifies find_repo_root returns None if specification directory is not found."""
        mock_isdir.return_value = False
        res = find_repo_root("/mock/path")
        self.assertIsNone(res)

    def test_load_from_bundled_resource_unknown_version(self):
        """Verifies load_from_bundled_resource raises A2uiCatalogError for unknown version."""
        with self.assertRaises(A2uiCatalogError) as ctx:
            load_from_bundled_resource(
                version="invalid_v", resource_key="s2c", spec_map={}
            )
        self.assertIn("Unknown A2UI version: invalid_v", str(ctx.exception))

    def test_load_from_bundled_resource_missing_key(self):
        """Verifies load_from_bundled_resource raises A2uiCatalogError for missing resource key."""
        spec_map = {"v1.0": {"s2c": "s2c_path.json"}}
        with self.assertRaises(A2uiCatalogError) as ctx:
            load_from_bundled_resource(
                version="v1.0", resource_key="missing_key", spec_map=spec_map
            )
        self.assertIn("Resource key 'missing_key' not found", str(ctx.exception))

    def test_load_from_bundled_resource_common_types_fallback(self):
        """Verifies load_from_bundled_resource fallback for common_types key."""
        spec_map = {"v1.0": {"s2c": "s2c_path.json"}}
        res = load_from_bundled_resource(
            version="v1.0", resource_key="common_types", spec_map=spec_map
        )
        self.assertEqual(res, {})

    def test_wrap_as_json_array_empty_schema(self):
        """Verifies wrap_as_json_array raises A2uiCatalogError for empty schema."""
        with self.assertRaises(A2uiCatalogError) as ctx:
            wrap_as_json_array({})
        self.assertIn("A2UI schema is empty", str(ctx.exception))

    def test_wrap_as_json_array_success(self):
        """Verifies wrap_as_json_array wraps a schema correctly."""
        schema = {"type": "object"}
        self.assertEqual(wrap_as_json_array(schema), {"type": "array", "items": schema})

    def test_deep_update(self):
        """Verifies deep_update recursively updates nested dicts."""
        base = {"a": 1, "b": {"c": 2, "d": 3}}
        update = {"b": {"d": 4, "e": 5}, "f": 6}
        expected = {"a": 1, "b": {"c": 2, "d": 4, "e": 5}, "f": 6}
        self.assertEqual(deep_update(base, update), expected)

    def test_catalog_provider_abstract(self):
        """Verifies abstract A2uiCatalogProvider load pass."""

        class DummyProvider(A2uiCatalogProvider):

            def load(self):
                return super().load()

        self.assertIsNone(DummyProvider().load())

    def test_file_system_catalog_provider_error(self):
        """Verifies FileSystemCatalogProvider load raises IOError on failure."""
        provider = FileSystemCatalogProvider("non_existent_file.json")
        with self.assertRaises(IOError) as ctx:
            provider.load()
        self.assertIn("Could not load schema", str(ctx.exception))

    def test_remove_strict_validation(self):
        """Verifies remove_strict_validation removes additionalProperties and unevaluatedProperties if False."""
        schema = {
            "type": "object",
            "properties": {"foo": {"type": "string"}},
            "additionalProperties": False,
            "unevaluatedProperties": False,
            "sub": [{
                "type": "object",
                "additionalProperties": False,
                "unevaluatedProperties": False,
            }],
        }
        expected = {
            "type": "object",
            "properties": {"foo": {"type": "string"}},
            "sub": [{"type": "object"}],
        }
        self.assertEqual(remove_strict_validation(schema), expected)

    def test_catalog_schema_helper_extended(self):
        from a2ui.schema.catalog import A2uiCatalog
        from a2ui.schema.schema_helper import CatalogSchemaHelper

        catalog = A2uiCatalog(
            version="v0.9",
            name="helper_test",
            s2c_schema={},
            common_types_schema={},
            catalog_schema={
                "catalogId": "test",
                "components": {
                    "CustomButton": {
                        "type": "object",
                        "description": "A test button component.",
                        "properties": {
                            "label": {"type": "string"},
                            "action": {"$ref": "common_types.json#/$defs/Action"},
                            "children": {"$ref": "common_types.json#/$defs/ChildList"},
                            "child": {"$ref": "common_types.json#/$defs/Child"},
                        },
                    }
                },
                "functions": {
                    "testFunc": {
                        "type": "object",
                        "description": "A test function.",
                        "properties": {
                            "args": {
                                "type": "object",
                                "properties": {
                                    "param1": {
                                        "type": "string",
                                        "description": "Param 1",
                                    }
                                },
                            }
                        },
                    }
                },
            },
        )

        helper = CatalogSchemaHelper(catalog)
        self.assertEqual(
            helper.get_component_description("CustomButton"), "A test button component."
        )
        self.assertEqual(
            helper.get_function_description("testFunc"), "A test function."
        )
        self.assertEqual(helper.get_property_type("CustomButton", "action"), "Action")
        self.assertEqual(
            helper.get_property_type("CustomButton", "children"), "ChildList"
        )
        self.assertEqual(helper.get_property_type("CustomButton", "child"), "Child")
        fn_prop_schema = helper.get_function_property_schema("testFunc", "param1")
        self.assertEqual(fn_prop_schema, {"type": "string", "description": "Param 1"})

        # Unsupported type should raise TypeError
        with self.assertRaises(TypeError):
            CatalogSchemaHelper("invalid_catalog_type")


if __name__ == "__main__":
    unittest.main()
