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
from a2ui.core import A2uiCatalogError
from a2ui.schema import (
    A2uiCatalogProvider,
    FileSystemCatalogProvider,
)
from a2ui.schema.utils import (
    deep_update,
    find_repo_root,
    get_basic_catalog_path,
    get_basic_examples_dir,
    get_spec_dir,
    load_agent_to_renderer_schema,
    load_common_types_schema,
    wrap_as_json_array,
)


class TestSchemaUtils(unittest.TestCase):
    """Test suite covering find_repo_root, load_agent_to_renderer_schema, load_common_types_schema, and wrap_as_json_array."""

    @patch("os.path.isdir")
    def test_find_repo_root_not_found(self, mock_isdir):
        """Verifies find_repo_root returns None if specification directory is not found."""
        mock_isdir.return_value = False
        res = find_repo_root("/mock/path")
        self.assertIsNone(res)

    def test_load_agent_to_renderer_schema_matches_core(self):
        """Verifies the agent's a2r schema matches get_agent_to_renderer_schema_json."""
        import json
        from a2ui.core import get_agent_to_renderer_schema_json
        from a2ui.core.schema import ProtocolVersion

        for ver, protocol_version in [
            ("0.8", ProtocolVersion.V0_8),
            ("0.9", ProtocolVersion.V0_9),
            ("0.9.1", ProtocolVersion.V0_9_1),
            ("1.0", ProtocolVersion.V1_0),
            ("v1_0", ProtocolVersion.V1_0),
        ]:
            self.assertEqual(
                load_agent_to_renderer_schema(ver),
                json.loads(get_agent_to_renderer_schema_json(protocol_version)),
            )
        with self.assertRaises(A2uiCatalogError):
            load_agent_to_renderer_schema("not-a-version")

    def test_load_agent_to_renderer_schema_returns_independent_copies(self):
        """Verifies that mutating a returned schema doesn't change later results."""
        import copy

        schema = load_agent_to_renderer_schema("0.9")
        expected = copy.deepcopy(schema)
        for value in schema.values():
            if isinstance(value, dict):
                value.clear()
        schema.clear()

        self.assertEqual(load_agent_to_renderer_schema("0.9"), expected)

    def test_load_common_types_schema_matches_core(self):
        """Verifies the agent's common types schema is the one a2ui-core generates."""
        from a2ui.core import get_common_types_schema_map
        from a2ui.core.schema import ProtocolVersion

        for ver, protocol_version in [
            ("0.9", ProtocolVersion.V0_9),
            ("0.9.1", ProtocolVersion.V0_9_1),
            ("1.0", ProtocolVersion.V1_0),
            ("v1_0", ProtocolVersion.V1_0),
        ]:
            self.assertEqual(
                load_common_types_schema(ver),
                get_common_types_schema_map(protocol_version),
            )
        self.assertEqual(load_common_types_schema("0.8"), {})
        with self.assertRaises(A2uiCatalogError):
            load_common_types_schema("not-a-version")

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

    def test_catalog_schema_helper_extended(self):
        from a2ui.core import Catalog
        from a2ui.schema.schema_helper import CatalogSchemaHelper

        catalog = Catalog.from_json(
            {
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
            protocol_version="v0.9",
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

    def test_get_spec_dir_standard_versions(self):
        """Verifies get_spec_dir maps standard version formats to their spec directories."""
        self.assertTrue(get_spec_dir("v1_0").endswith("specification/v1_0"))
        self.assertTrue(get_spec_dir("1.0").endswith("specification/v1_0"))
        self.assertTrue(get_spec_dir("v0_9_1").endswith("specification/v0_9_1"))
        self.assertTrue(get_spec_dir("0.9.1").endswith("specification/v0_9_1"))
        self.assertTrue(get_spec_dir("v1_0_0-alpha.1").endswith("specification/v1_0"))

    def test_get_spec_dir_prerelease_versions(self):
        """Verifies get_spec_dir consistently maps pre-release versions to their base spec directory."""
        self.assertTrue(
            get_spec_dir("1.0.0-dev_release").endswith("specification/v1_0")
        )
        self.assertTrue(
            get_spec_dir("v1_0_0-dev_release").endswith("specification/v1_0")
        )
        self.assertTrue(get_spec_dir("1.0.0-alpha.1").endswith("specification/v1_0"))

    def test_get_basic_catalog_path_versioning(self):
        """Verifies get_basic_catalog_path selects canonical catalogs/ for >=v1_0 and spec dir for <v1_0."""
        self.assertTrue(
            get_basic_catalog_path("v1_0").endswith("catalogs/basic/v1/catalog.json")
        )
        self.assertTrue(
            get_basic_catalog_path("1.0").endswith("catalogs/basic/v1/catalog.json")
        )
        self.assertTrue(
            get_basic_catalog_path("v0_9").endswith(
                "specification/v0_9/catalogs/basic/catalog.json"
            )
        )
        self.assertTrue(
            get_basic_catalog_path("v0_8").endswith(
                "specification/v0_8/catalogs/basic/catalog.json"
            )
        )

    def test_get_basic_examples_dir_versioning(self):
        """Verifies get_basic_examples_dir selects canonical catalogs/ for >=v1_0 and spec dir for <v1_0."""
        self.assertTrue(
            get_basic_examples_dir("v1_0").endswith("catalogs/basic/v1/examples")
        )
        self.assertTrue(
            get_basic_examples_dir("1.0").endswith("catalogs/basic/v1/examples")
        )
        self.assertTrue(
            get_basic_examples_dir("v0_9").endswith(
                "specification/v0_9/catalogs/basic/examples"
            )
        )


if __name__ == "__main__":
    unittest.main()
