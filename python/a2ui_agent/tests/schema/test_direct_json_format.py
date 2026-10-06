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

import json
import pytest

from a2ui.core import A2uiCatalogError
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import DirectJsonFormat, DirectJsonParser
from a2ui.schema import (
    CatalogConfig,
    VERSION_0_8,
    VERSION_0_9,
    VERSION_0_9_1,
    VERSION_1_0,
)


def test_schema_manager_init_valid_version():
    direct_json_format = DirectJsonFormat(
        VERSION_0_8,
        catalogs=[CatalogConfig.from_catalog("basic", BasicCatalog(VERSION_0_8))],
    )

    assert "properties" in direct_json_format._server_to_client_schema
    assert len(direct_json_format._supported_catalogs) >= 1
    catalog = direct_json_format._supported_catalogs[0]
    assert "Text" in catalog.catalog_schema["components"]


def test_schema_manager_init_invalid_version():
    with pytest.raises(A2uiCatalogError, match="Unknown A2UI specification version"):
        DirectJsonFormat("invalid_version")


@pytest.mark.parametrize(
    "version", [VERSION_0_8, VERSION_0_9, VERSION_0_9_1, VERSION_1_0]
)
def test_schema_manager_init_supported_versions(version):
    direct_json_format = DirectJsonFormat(version)

    assert direct_json_format._server_to_client_schema["type"] == "object"


def test_direct_json_parser_methods():
    tf = DirectJsonFormat(
        VERSION_0_8,
        catalogs=[CatalogConfig.from_catalog("basic", BasicCatalog(VERSION_0_8))],
    )
    cat = tf._supported_catalogs[0]
    parser = DirectJsonParser(cat)

    # 1. has_format_content
    assert parser.has_format_content("<a2ui-json>", complete=True) is False
    assert parser.has_format_content("<a2ui-json></a2ui-json>", complete=True) is True

    # 2. process_chunk incremental streaming
    parts1 = parser.process_chunk("<a2ui-json>")
    assert parts1 == []  # Buffering open tag

    parts2 = parser.process_chunk(
        '[{"beginRendering": {"surfaceId": "main", "root": "c1"}}]</a2ui-json>'
    )
    assert len(parts2) == 1
    assert parts2[0].is_final is True

    # 3. decompile and wrap_decompiled_blocks
    payload = {"beginRendering": {"surfaceId": "s1", "root": "c1"}}
    decompiled = parser.decompile(payload)
    assert "beginRendering" in decompiled
    assert '"surfaceId": "s1"' in decompiled

    wrapped = parser.wrap_decompiled_blocks(
        ['{"beginRendering": {"surfaceId": "s1", "root": "c1"}}']
    )
    assert wrapped == (
        '<a2ui-json>\n{"beginRendering": {"surfaceId": "s1", "root":'
        ' "c1"}}\n</a2ui-json>'
    )


def test_direct_json_parser_no_supported_catalogs():
    direct_json_format = DirectJsonFormat(VERSION_0_8)
    direct_json_format._supported_catalogs = []
    with pytest.raises(A2uiCatalogError, match="No supported catalogs configured"):
        _ = direct_json_format.parser


def test_select_catalog_rebuilds_any_component_with_inline_catalogs():
    fmt = DirectJsonFormat(
        VERSION_0_9,
        catalogs=[CatalogConfig.from_catalog("basic", BasicCatalog(VERSION_0_9))],
        accepts_inline_catalogs=True,
    )

    caps = {
        "supportedCatalogIds": [
            "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
        ],
        "inlineCatalogs": [{
            "catalogId": "example_inline",
            "components": {
                "StatusChip": {
                    "type": "object",
                    "allOf": [
                        {
                            "$ref": (
                                "https://a2ui.org/specification/v0_9/common_types.json#/$defs/ComponentCommon"
                            )
                        },
                        {"$ref": "#/$defs/CatalogComponentCommon"},
                        {
                            "type": "object",
                            "properties": {
                                "component": {"const": "StatusChip"},
                                "label": {
                                    "$ref": (
                                        "https://a2ui.org/specification/v0_9/common_types.json#/$defs/DynamicString"
                                    )
                                },
                            },
                            "required": ["component", "label"],
                        },
                    ],
                }
            },
            "functions": [{
                "name": "customFormat",
                "description": "Custom formatting function",
                "parameters": {
                    "type": "object",
                    "properties": {"value": {"type": "string"}},
                    "required": ["value"],
                },
                "returnType": "string",
            }],
        }],
    }

    catalog = fmt.get_selected_catalog(client_ui_capabilities=caps)

    # 1. Custom component and function are in merged maps
    assert "StatusChip" in catalog.catalog_schema["components"]
    assert "customFormat" in catalog.catalog_schema["functions"]

    # 2. $defs.anyComponent.oneOf and $defs.anyFunction.oneOf contain references
    any_comp = catalog.catalog_schema.get("$defs", {}).get("anyComponent", {})
    one_of_refs = [
        item.get("$ref") for item in any_comp.get("oneOf", []) if isinstance(item, dict)
    ]
    assert "#/components/StatusChip" in one_of_refs
    assert "#/components/Text" in one_of_refs

    any_func = catalog.catalog_schema.get("$defs", {}).get("anyFunction", {})
    func_one_of_refs = [
        item.get("$ref") for item in any_func.get("oneOf", []) if isinstance(item, dict)
    ]
    assert "#/functions/customFormat" in func_one_of_refs

    # 3. Payload with StatusChip validates successfully
    cat_id = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
    messages = [
        {
            "version": "v0.9",
            "createSurface": {"surfaceId": "main", "catalogId": cat_id},
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "main",
                "components": [
                    {"id": "root", "component": "StatusChip", "label": "OK"}
                ],
            },
        },
    ]
    assert catalog.validate_components(messages) == []
    catalog.validate(messages)

    # 4. Streaming parser processes payload containing StatusChip
    parser = DirectJsonParser(catalog)
    payload_str = f"<a2ui-json>\n{json.dumps(messages)}\n</a2ui-json>"
    parts = parser.process_chunk(payload_str)
    assert len(parts) >= 1
