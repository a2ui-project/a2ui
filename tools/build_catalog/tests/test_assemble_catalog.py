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

import unittest
from unittest.mock import patch, MagicMock
import json
import os
from pathlib import Path
import sys

# Add the parent directory to the path so we can import assemble_catalog
sys.path.insert(0, str(Path(__file__).parent.parent.resolve()))
from assemble_catalog import CatalogAssembler, BASIC_CATALOG_URLS, CatalogError
import urllib.error

class TestAssembleCatalog(unittest.TestCase):
    def setUp(self):
        self.fixtures_dir = Path(__file__).parent / "fixtures"
        self.basic_catalog_path = self.fixtures_dir / "basic_catalog.json"
        self.component1_path = self.fixtures_dir / "component1.json"
        self.component2_path = self.fixtures_dir / "component2.json"

    def test_local_assembly(self):
        # Assemble component1 and component2, intercepting basic_catalog locally
        assembler = CatalogAssembler(version="0.9", local_basic_catalog_path=str(self.basic_catalog_path))
        result = assembler.assemble("TestCatalog", [str(self.component1_path), str(self.component2_path)])

        self.assertEqual(result["$id"], "TestCatalog.json")
        self.assertEqual(result["catalogId"], "urn:a2ui:catalog:TestCatalog")
        self.assertEqual(result["title"], "TestCatalog A2UI Catalog")
        self.assertEqual(result["description"], f"TestCatalog A2UI catalog, including {self.component1_path.stem}, {self.component2_path.stem}.")
        self.assertIn("CustomHeader", result["components"])
        self.assertIn("Page", result["components"])

        # Verify the $refs were translated into internal $defs correctly
        self.assertIn("$defs", result)

        # We expect a definition for basic_catalog's Text component and component1's CustomHeader
        defs_keys = list(result["$defs"].keys())
        self.assertTrue(any("basic_catalog_Text" in k for k in defs_keys))
        self.assertTrue(any("component1_CustomHeader" in k for k in defs_keys))

    def test_custom_catalog_id(self):
        assembler = CatalogAssembler(version="0.9", local_basic_catalog_path=str(self.basic_catalog_path))
        
        # Pass a custom catalog_id to assemble()
        custom_id = "my:custom:catalog:identifier"
        result = assembler.assemble(
            "TestCatalog", 
            [str(self.component1_path)], 
            catalog_id=custom_id
        )

        self.assertEqual(result["$id"], "TestCatalog.json")
        self.assertEqual(result["catalogId"], custom_id)

    @patch('assemble_catalog.urllib.request.urlopen')
    def test_remote_basic_catalog_fallback(self, mock_urlopen):
        # Mock the HTTP response for basic_catalog.json
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "components": {
                "Text": {"type": "string"},
                "RemoteText": {"type": "string"}
            }
        }).encode('utf-8')
        mock_urlopen.return_value.__enter__.return_value = mock_response

        # Assemble without a local basic_catalog_path, it MUST fetch from HTTP
        assembler = CatalogAssembler(version="1.0", local_basic_catalog_path=None)
        result = assembler.assemble("RemoteTest", [str(self.component1_path)])

        # Assert urlopen was called with the 1.0 URL
        called_req = mock_urlopen.call_args[0][0]
        self.assertEqual(called_req.full_url, BASIC_CATALOG_URLS["1.0"])

        self.assertIn("$defs", result)
        defs_keys = list(result["$defs"].keys())
        # The key should contain basic_catalog since we intercepted the target pointer path
        self.assertTrue(any("basic_catalog" in k for k in defs_keys))

    def test_extend_basic_catalog(self):
        # Assemble component1, which DOES NOT have all of basic_catalog natively (just CustomHeader's ref to Text)
        # But we pass extend_basic=True, so basic_catalog's entirety should be dumped into components
        assembler = CatalogAssembler(version="0.9", local_basic_catalog_path=str(self.basic_catalog_path))
        result = assembler.assemble("ExtendedCatalog", [str(self.component1_path)], extend_basic=True)

        self.assertEqual(result["title"], "ExtendedCatalog A2UI Catalog")
        self.assertIn("CustomHeader", result["components"])

        # Because we merged basic_catalog implicitly, Text should be directly in the top-level components
        self.assertIn("Text", result["components"])

    @patch('assemble_catalog.urllib.request.urlopen')
    def test_http_input_assembly(self, mock_urlopen):
        # Mock full fetching if the input itself is an HTTP URL
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "components": {
                "CloudWidget": {
                    "properties": {
                        "text": {"$ref": "basic_catalog.json#/components/Text"}
                    }
                }
            }
        }).encode('utf-8')
        mock_urlopen.return_value.__enter__.return_value = mock_response

        assembler = CatalogAssembler(version="0.9", local_basic_catalog_path=str(self.basic_catalog_path))
        result = assembler.assemble("CloudCatalog", ["https://example.com/widget_catalog.json"])

        # Assert urlopen was called for the input catalog
        self.assertEqual(mock_urlopen.call_count, 1)
        self.assertEqual(mock_urlopen.call_args[0][0].full_url, "https://example.com/widget_catalog.json")

        self.assertIn("CloudWidget", result["components"])

        # Assert the inner basic_catalog.json ref correctly routed locally
        self.assertIn("$defs", result)
        defs_keys = list(result["$defs"].keys())
        self.assertTrue(any("basic_catalog" in k for k in defs_keys))

    def test_local_common_types_fallback(self):
        # The component3 mock references common_types.json directly.
        # This test ensures we properly intercept that reference if passed locally.
        common_types_path = self.fixtures_dir / "common_types.json"
        component3_path = self.fixtures_dir / "component3.json"

        assembler = CatalogAssembler(
            version="0.9",
            local_basic_catalog_path=str(self.basic_catalog_path),
            local_common_types_path=str(common_types_path)
        )
        result = assembler.assemble("CommonTextCatalog", [str(component3_path)])

        self.assertIn("$defs", result)
        defs_keys = list(result["$defs"].keys())
        # The key should contain common_types since we intercepted the target pointer path
        self.assertTrue(any("common_types_DynamicString" in k for k in defs_keys))

    @patch('assemble_catalog.urllib.request.urlopen')
    def test_remote_common_types_fallback(self, mock_urlopen):
        # Mock the HTTP response for common_types.json
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "$defs": {
                "DynamicString": {"type": "string"}
            }
        }).encode('utf-8')
        mock_urlopen.return_value.__enter__.return_value = mock_response

        component3_path = self.fixtures_dir / "component3.json"

        # Assemble without a local common_types_path, it MUST fetch from HTTP
        assembler = CatalogAssembler(version="1.0", local_common_types_path=None)
        result = assembler.assemble("RemoteCommonTypes", [str(component3_path)])

        # Assert urlopen was called with the 1.0 URL for common_types.json at least once
        from assemble_catalog import COMMON_TYPES_URLS
        called_urls = [call.args[0].full_url for call in mock_urlopen.call_args_list]
        self.assertIn(COMMON_TYPES_URLS["1.0"], called_urls)

        self.assertIn("$defs", result)
        defs_keys = list(result["$defs"].keys())
        # The key should contain common_types since we intercepted the target pointer path
        self.assertTrue(any("common_types_DynamicString" in k for k in defs_keys))

    def test_circular_dependency(self):
        # Create a mock schema with a circular $ref
        schema_with_loop = {
            "components": {
                "LoopBlock": {
                    "$ref": "memory://test#/components/LoopBlock"
                }
            }
        }

        assembler = CatalogAssembler(version="0.9", max_depth=5)

        # We manually call process_schema to trigger the recursion check
        # and mock fetch_json to always return the loop schema so it infinitely evaluates
        with patch.object(assembler, 'fetch_json', return_value=schema_with_loop):
            with self.assertRaises(CatalogError) as context:
                assembler.process_schema(schema_with_loop, "memory://test")

        self.assertIn("Max recursion depth reached", str(context.exception))

    @patch.object(CatalogAssembler, 'fetch_json')
    @patch('assemble_catalog.logger')
    def test_collision_warning_on_merge(self, mock_logger, mock_fetch_json):
        assembler = CatalogAssembler(version="0.9")
        
        # component1 and component2 do not collide. Provide two distinct URIs that return
        # the exact same schema to ensure the collision logic fires and they aren't deduplicated.
        mock_schema = {
            "components": {
                "CustomHeader": {"type": "object"}
            }
        }
        mock_fetch_json.return_value = mock_schema

        assembler.assemble("CollisionCatalog", ["memory://file1.json", "memory://file2.json"])
        
        # We should see a warning about 'CustomHeader' colliding
        mock_logger.warning.assert_called_with("Component collision: 'CustomHeader' already exists. Overwriting.")

    def test_missing_local_file(self):
        assembler = CatalogAssembler(version="0.9", local_basic_catalog_path=str(self.basic_catalog_path))
        missing_path = self.fixtures_dir / "does_not_exist.json"

        with self.assertRaises(CatalogError) as context:
            assembler.assemble("MissingCatalog", [str(missing_path)])

        self.assertIn("File not found:", str(context.exception))

    @patch('assemble_catalog.urllib.request.urlopen')
    def test_network_timeout(self, mock_urlopen):
        # URLError simulating a timeout
        mock_urlopen.side_effect = urllib.error.URLError("timeout")

        assembler = CatalogAssembler(version="0.9")

        with self.assertRaises(CatalogError) as context:
            assembler.fetch_json("https://example.com/slow_catalog.json", referrer="memory://component.json")

        self.assertIn("Network error fetching", str(context.exception))
        self.assertIn("timeout", str(context.exception))
        self.assertIn("referenced from memory://component", str(context.exception))

    @patch('assemble_catalog.Path.cwd')
    @patch('assemble_catalog.CatalogAssembler.assemble')
    def test_output_filename_generation(self, mock_assemble, mock_cwd):
        mock_assemble.return_value = {}
        import tempfile
        import assemble_catalog

        with tempfile.TemporaryDirectory() as temp_dir:
            mock_cwd.return_value = Path(temp_dir)

            # Test without .json provided
            with patch('sys.argv', ['assemble_catalog.py', '--output-name', 'MyCatalog', str(self.component1_path)]):
                assemble_catalog.main()

            out_file = Path(temp_dir) / "dist" / "MyCatalog.json"
            self.assertTrue(out_file.exists())

            # Test with .json provided
            with patch('sys.argv', ['assemble_catalog.py', '--output-name', 'MyCatalogWithExt.json', str(self.component1_path)]):
                assemble_catalog.main()

            out_file2 = Path(temp_dir) / "dist" / "MyCatalogWithExt.json"
            self.assertTrue(out_file2.exists())
            # Ensure it did not double append the extension
            self.assertFalse((Path(temp_dir) / "dist" / "MyCatalogWithExt.json.json").exists())

    @patch.object(CatalogAssembler, 'fetch_json')
    def test_catalog_json_resolution(self, mock_fetch_json):
        # common_types.json typically contains a reference to `catalog.json#/$defs/anyFunction`
        mock_schema = {
            "components": {
                "TestComp": {
                    "properties": {
                        "func": {
                            "$ref": "catalog.json#/$defs/anyFunction"
                        }
                    }
                }
            }
        }
        mock_fetch_json.return_value = mock_schema

        assembler = CatalogAssembler(version="0.9")
        result = assembler.assemble("TestCatalog", ["memory://test.json"])
        
        # The reference should be transformed from 'catalog.json#/$defs/anyFunction' 
        # to just '#/$defs/anyFunction' internally.
        self.assertEqual(
            result["components"]["TestComp"]["properties"]["func"]["$ref"],
            "#/$defs/anyFunction"
        )

    def test_synthesized_defs(self):
        assembler = CatalogAssembler(version="0.9", local_basic_catalog_path=str(self.basic_catalog_path))
        result = assembler.assemble("SynthesizedCatalog", [str(self.component1_path), str(self.component2_path)])
        
        self.assertIn("$defs", result)
        
        # anyComponent MUST be populated with a oneOf of all merged components
        self.assertIn("anyComponent", result["$defs"])
        self.assertEqual(result["$defs"]["anyComponent"]["discriminator"]["propertyName"], "component")
        any_comp_refs = [item["$ref"] for item in result["$defs"]["anyComponent"]["oneOf"]]
        self.assertIn("#/components/CustomHeader", any_comp_refs)
        self.assertIn("#/components/Page", any_comp_refs)
        
        # anyFunction MUST be populated
        self.assertIn("anyFunction", result["$defs"])
        
        # theme MUST be extracted from the basic catalog
        self.assertIn("theme", result["$defs"])
        self.assertEqual(result["$defs"]["theme"]["type"], "object")

    @patch.object(CatalogAssembler, 'fetch_json')
    def test_theme_property_override_and_clash(self, mock_fetch_json):
        basic_schema = {
            "$id": "basic_catalog.json",
            "$defs": {
                "theme": {
                    "type": "object",
                    "properties": {
                        "primaryColor": {"type": "string", "default": "#000000"},
                        "iconUrl": {"type": "string"}
                    }
                }
            }
        }
        
        custom_schema_1 = {
            "$id": "custom1.json",
            "components": {},
            "$defs": {
                "theme": {
                    "type": "object",
                    "properties": {
                        "primaryColor": {"type": "string", "default": "#FF0000"},
                        "customProp": {"type": "number"}
                    }
                }
            }
        }
        
        custom_schema_2 = {
            "$id": "custom2.json",
            "components": {},
            "$defs": {
                "theme": {
                    "type": "object",
                    "properties": {
                        "customProp": {"type": "boolean"}
                    }
                }
            }
        }

        def mock_fetch_json_side_effect(uri):
            if "basic_catalog" in uri:
                return json.loads(json.dumps(basic_schema))
            elif "custom1" in uri:
                return json.loads(json.dumps(custom_schema_1))
            elif "custom2" in uri:
                return json.loads(json.dumps(custom_schema_2))
            return {"components": {}}
            
        mock_fetch_json.side_effect = mock_fetch_json_side_effect
        
        assembler = CatalogAssembler(version="0.9", local_basic_catalog_path="memory://basic_catalog.json")
        
        # Test override: basic + custom1
        result = assembler.assemble("TestTheme", ["memory://custom1.json"])
        theme_props = result["$defs"]["theme"]["properties"]
        
        # basic loses, custom1 wins
        self.assertEqual(theme_props["primaryColor"]["default"], "#FF0000")
        self.assertIn("iconUrl", theme_props)
        self.assertIn("customProp", theme_props)
        self.assertEqual(theme_props["customProp"]["type"], "number")
        
        # Test clash: custom1 + custom2
        with self.assertRaises(CatalogError) as context:
            assembler.assemble("TestThemeClash", ["memory://custom1.json", "memory://custom2.json"])
            
        self.assertIn("Theme property clash", str(context.exception))
        self.assertIn("customProp", str(context.exception))

    def test_inline_instructions_and_additional_files(self):
        basic_schema = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": "https://a2ui.org/basic",
            "instructions": "Basic layout rules.",
            "components": {},
        }
        custom_schema = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": "https://a2ui.org/custom",
            "instructions": "Custom component rules.",
            "components": {},
        }

        with patch.object(CatalogAssembler, "fetch_json") as mock_fetch:
            def mock_fetch_json_side_effect(uri, **kwargs):
                if "basic_catalog" in uri:
                    return json.loads(json.dumps(basic_schema))
                elif "custom" in uri:
                    return json.loads(json.dumps(custom_schema))
                return {"components": {}}

            mock_fetch.side_effect = mock_fetch_json_side_effect

            assembler = CatalogAssembler(version="0.9", local_basic_catalog_path="memory://basic_catalog.json")

            with patch("pathlib.Path.exists", return_value=True), patch("pathlib.Path.read_text", return_value="External CLI rules."):
                result = assembler.assemble(
                    "TestInstructions",
                    ["memory://custom.json"],
                    extend_basic=True,
                    additional_instructions=[Path("ext1.md"), Path("ext2.md")],
                )

            self.assertIn("instructions", result)
            self.assertIn("Basic layout rules.", result["instructions"])
            self.assertIn("Custom component rules.", result["instructions"])
            self.assertIn("External CLI rules.", result["instructions"])

if __name__ == '__main__':
    unittest.main()
