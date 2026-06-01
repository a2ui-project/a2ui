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
from pathlib import Path
import sys

# Add the parent directory to the path so we can import assemble_catalog
sys.path.insert(0, str(Path(__file__).parent.parent.resolve()))
from assemble_catalog import CatalogAssembler, BASIC_CATALOG_URLS

class TestAssembleCatalogV08(unittest.TestCase):
    def setUp(self):
        self.fixtures_dir = Path(__file__).parent / "fixtures"
        self.standard_catalog_path = self.fixtures_dir / "v0_8_standard_catalog_definition.json"
        self.custom_catalog_path = self.fixtures_dir / "v0_8_custom_catalog.json"

    def test_v08_local_assembly(self):
        # Assemble v0.8 catalog, intercepting standard_catalog_definition locally
        assembler = CatalogAssembler(
            version="0.8", 
            local_basic_catalog_path=str(self.standard_catalog_path)
        )
        result = assembler.assemble(
            "TestV08Catalog", 
            [str(self.custom_catalog_path)]
        )

        self.assertEqual(result["$id"], "TestV08Catalog.json")
        self.assertIn("CustomV08Component", result["components"])
        
        # Verify theme (styles in v0.8)
        self.assertIn("theme", result["$defs"])
        theme_props = result["$defs"]["theme"]["properties"]
        self.assertIn("primaryColor", theme_props)
        self.assertIn("secondaryColor", theme_props)

        # Verify the $ref to standard_catalog_definition.json was resolved
        self.assertIn("$defs", result)
        defs_keys = list(result["$defs"].keys())
        self.assertTrue(any("basic_catalog_Text" in k for k in defs_keys))

    @patch('assemble_catalog.urllib.request.urlopen')
    def test_v08_remote_fallback(self, mock_urlopen):
        # Mock the HTTP response for standard_catalog_definition.json
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "components": {
                "Text": {"type": "object"}
            },
            "styles": {
                "primaryColor": {"type": "string"}
            }
        }).encode('utf-8')
        mock_urlopen.return_value.__enter__.return_value = mock_response

        # Assemble without a local basic_catalog_path, it MUST fetch from HTTP
        assembler = CatalogAssembler(version="0.8", local_basic_catalog_path=None)
        result = assembler.assemble("RemoteV08Test", [str(self.custom_catalog_path)])

        # Assert urlopen was called with the 0.8 URL
        called_req = mock_urlopen.call_args[0][0]
        self.assertEqual(called_req.full_url, BASIC_CATALOG_URLS["0.8"])
        self.assertIn("https://raw.githubusercontent.com/a2ui-project/a2ui/refs/heads/main/specification/v0_8/json/standard_catalog_definition.json", called_req.full_url)

        self.assertIn("$defs", result)
        self.assertIn("theme", result["$defs"])

    def test_detect_local_overrides_v08(self):
        from assemble_catalog import detect_local_overrides
        inputs = ["/path/to/standard_catalog_definition.json", "other.json"]
        local_basic, local_common = detect_local_overrides(inputs)
        self.assertEqual(local_basic, "/path/to/standard_catalog_definition.json")

if __name__ == '__main__':
    unittest.main()
