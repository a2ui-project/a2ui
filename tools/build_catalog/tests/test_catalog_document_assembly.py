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

"""Tests for Catalog Document merging and format conversion in assemble_catalog.py."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
from typing import Any
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.resolve()))
import assemble_catalog
from assemble_catalog import (
    CatalogAssembler,
    CatalogError,
    is_catalog_document_dict,
)

REPO_ROOT = Path(__file__).resolve().parents[3]


class TestCatalogDocumentAssembly(unittest.TestCase):

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_dir = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _write_json(self, name: str, data: dict[str, Any]) -> Path:
        path = self.tmp_dir / name
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return path

    def test_merge_two_catalog_documents_offline_without_ref_mangling(self) -> None:
        doc_a = self._write_json(
            "cat_a.catalog.json",
            {
                "formatVersion": "1.0",
                "protocolVersion": "1.0",
                "catalogId": "https://example.com/a",
                "instructions": "Rules from A.",
                "metadata": {"extensions": {"com_example_a": True}},
                "types": {
                    "Spacing": {"type": "enum", "values": ["sm", "lg"]},
                },
                "surfaceProperties": {
                    "properties": [
                        {"name": "brandColor", "type": "string"},
                    ]
                },
                "components": [{
                    "name": "HeroBanner",
                    "description": "Hero header.",
                    "parameters": [
                        {
                            "name": "title",
                            "type": "string",
                            "dynamic": True,
                            "required": True,
                        },
                        {"name": "padding", "type": "ref", "ref": "Spacing"},
                    ],
                }],
                "functions": [{
                    "name": "formatBadge",
                    "returnType": "string",
                    "parameters": [
                        {"name": "count", "type": "integer", "required": True}
                    ],
                }],
            },
        )
        doc_b = self._write_json(
            "cat_b.catalog.json",
            {
                "formatVersion": "1.0",
                "protocolVersion": "1.0",
                "catalogId": "https://example.com/b",
                "instructions": "Rules from B.",
                "metadata": {"extensions": {"com_example_b": 2}},
                "types": {
                    "Spacing": {"type": "enum", "values": ["sm", "lg"]},
                    "Radius": {"type": "number", "min": 0},
                },
                "surfaceProperties": {
                    "properties": [
                        {"name": "fontFamily", "type": "string"},
                    ]
                },
                "components": [{
                    "name": "StatusChip",
                    "parameters": [{"name": "radius", "type": "ref", "ref": "Radius"}],
                }],
            },
        )
        extra_md = self.tmp_dir / "extra.md"
        extra_md.write_text("Extra CLI guidance.", encoding="utf-8")

        assembler = CatalogAssembler(version="1.0")
        with patch("assemble_catalog.urllib.request.urlopen") as mock_urlopen:
            result = assembler.assemble(
                "MergedDoc",
                [str(doc_a), str(doc_b)],
                catalog_id="https://example.com/merged",
                additional_instructions=[extra_md],
            )
            # Offline pure Catalog Document assembly makes zero HTTP requests.
            mock_urlopen.assert_not_called()

        self.assertTrue(is_catalog_document_dict(result))
        self.assertEqual(result["formatVersion"], "1.0")
        self.assertEqual(result["protocolVersion"], "1.0")
        self.assertEqual(result["catalogId"], "https://example.com/merged")
        self.assertNotIn("$defs", result)
        self.assertEqual(
            [c["name"] for c in result["components"]], ["HeroBanner", "StatusChip"]
        )
        self.assertEqual([f["name"] for f in result["functions"]], ["formatBadge"])
        self.assertEqual(set(result["types"].keys()), {"Spacing", "Radius"})
        self.assertEqual(
            [p["name"] for p in result["surfaceProperties"]["properties"]],
            ["brandColor", "fontFamily"],
        )
        self.assertIn("Rules from A.", result["instructions"])
        self.assertIn("Rules from B.", result["instructions"])
        self.assertIn("Extra CLI guidance.", result["instructions"])
        self.assertEqual(
            result["metadata"]["extensions"],
            {"com_example_a": True, "com_example_b": 2},
        )

    def test_surface_property_and_type_clashes_raise(self) -> None:
        doc_1 = self._write_json(
            "c1.json",
            {
                "formatVersion": "1.0",
                "protocolVersion": "1.0",
                "catalogId": "https://example.com/c1",
                "types": {"Token": {"type": "string"}},
                "components": [{"name": "CompA"}],
            },
        )
        doc_2 = self._write_json(
            "c2.json",
            {
                "formatVersion": "1.0",
                "protocolVersion": "1.0",
                "catalogId": "https://example.com/c2",
                "types": {"Token": {"type": "number"}},
                "components": [{"name": "CompB"}],
            },
        )
        assembler = CatalogAssembler(version="1.0")
        with self.assertRaises(CatalogError) as ctx:
            assembler.assemble("Clash", [str(doc_1), str(doc_2)])
        self.assertIn("Type definition clash", str(ctx.exception))

        sp_1 = self._write_json(
            "sp1.json",
            {
                "formatVersion": "1.0",
                "protocolVersion": "1.0",
                "catalogId": "https://example.com/sp1",
                "surfaceProperties": {
                    "properties": [{"name": "accent", "type": "string"}]
                },
                "components": [{"name": "CompA"}],
            },
        )
        sp_2 = self._write_json(
            "sp2.json",
            {
                "formatVersion": "1.0",
                "protocolVersion": "1.0",
                "catalogId": "https://example.com/sp2",
                "surfaceProperties": {
                    "properties": [{"name": "accent", "type": "number"}]
                },
                "components": [{"name": "CompB"}],
            },
        )
        with self.assertRaises(CatalogError) as sp_ctx:
            assembler.assemble("SpClash", [str(sp_1), str(sp_2)])
        self.assertIn("Surface property clash", str(sp_ctx.exception))

    def test_convert_published_json_schema_catalogs_to_catalog_document_and_back(
        self,
    ) -> None:
        vega_path = REPO_ROOT / "catalogs/vegachart/v1/catalog.json"
        mcp_path = REPO_ROOT / "catalogs/mcp/v1/catalog.json"
        common_path = REPO_ROOT / "specification/v1_0/json/common_types.json"

        assembler = CatalogAssembler(
            version="1.0",
            local_common_types_path=str(common_path),
        )
        doc = assembler.assemble(
            "VegaAndMcp",
            [str(vega_path), str(mcp_path)],
            catalog_id="https://example.com/vega_mcp/v1",
            output_format="catalog-document",
        )
        self.assertTrue(is_catalog_document_dict(doc))
        self.assertEqual(
            {c["name"] for c in doc["components"]}, {"VegaChart", "McpApp"}
        )
        self.assertEqual(len(doc["functions"]), 5)

        # Write out the Catalog Document and convert back to JSON Schema via CLI.
        doc_path = self._write_json("vega_mcp.catalog.json", doc)
        with patch("assemble_catalog.Path.cwd", return_value=self.tmp_dir):
            with patch(
                "sys.argv",
                [
                    "assemble_catalog.py",
                    "--version",
                    "1.0",
                    "--output-name",
                    "VegaMcpSchema",
                    "--output-format",
                    "json-schema",
                    str(doc_path),
                ],
            ):
                assemble_catalog.main()

        out_file = self.tmp_dir / "dist" / "VegaMcpSchema.json"
        self.assertTrue(out_file.exists())
        schema = json.loads(out_file.read_text(encoding="utf-8"))
        self.assertFalse(is_catalog_document_dict(schema))
        self.assertEqual(set(schema["components"].keys()), {"VegaChart", "McpApp"})
        self.assertEqual(len(schema["functions"]), 5)
        self.assertIn("anyComponent", schema["$defs"])


if __name__ == "__main__":
    unittest.main()
