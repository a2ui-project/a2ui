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
import io
import json
import pytest

from unittest.mock import patch, MagicMock
from a2ui.core import A2uiCatalogError
from a2ui.inference_formats.direct_json import DirectJsonFormat, DirectJsonParser
from a2ui.basic_catalog import BasicCatalog
from a2ui.schema.constants import (
    VERSION_0_8,
)


@pytest.fixture
def mock_importlib_resources():
    with patch("importlib.resources.files") as mock_files:
        yield mock_files


def test_schema_manager_init_valid_version(mock_importlib_resources):
    mock_files = mock_importlib_resources
    mock_traversable = MagicMock()

    def files_side_effect(package):
        if package == "a2ui.assets":
            return mock_traversable
        return MagicMock()

    mock_files.side_effect = files_side_effect

    # Mock file open calls for server_to_client and catalog
    def joinpath_side_effect(path):
        if path == VERSION_0_8:
            return mock_traversable

        mock_file = MagicMock()
        if path == "server_to_client.json":
            content = (
                '{"$schema": "https://json-schema.org/draft/2020-12/schema",'
                f' "version": "{VERSION_0_8}", "defs": "server_defs"}}'
            )
        elif path == "standard_catalog_definition.json":
            content = (
                '{"$schema": "https://json-schema.org/draft/2020-12/schema",'
                f' "version": "{VERSION_0_8}", "components": {{"Text": {{}}}}}}'
            )
        else:
            content = '{"$schema": "https://json-schema.org/draft/2020-12/schema"}'

        mock_file.open.return_value.__enter__.return_value = io.StringIO(content)
        return mock_file

    mock_traversable.joinpath.side_effect = joinpath_side_effect

    direct_json_format = DirectJsonFormat(
        VERSION_0_8, catalogs=[BasicCatalog.get_config(VERSION_0_8)]
    )

    assert direct_json_format._server_to_client_schema["defs"] == "server_defs"
    # Basic catalog might have a URI-based ID if not explicitly matched
    # So we check if any catalog exists
    assert len(direct_json_format._supported_catalogs) >= 1
    # The first one should be the basic one
    catalog = direct_json_format._supported_catalogs[0]
    assert catalog.catalog_schema["version"] == VERSION_0_8
    assert "Text" in catalog.catalog_schema["components"]


def test_schema_manager_init_invalid_version():
    with pytest.raises(ValueError, match="Unknown A2UI specification version"):
        DirectJsonFormat("invalid_version")


def test_schema_manager_fallback_local_assets(mock_importlib_resources):
    # Force importlib to fail
    # Note: A2UI_ASSET_PACKAGE is "a2ui.assets"
    mock_importlib_resources.side_effect = FileNotFoundError("Package not found")

    with (
        patch("os.path.exists", return_value=True),
        patch("builtins.open", new_callable=MagicMock) as mock_open,
    ):

        def open_side_effect(path, *args, **kwargs):
            path_str = str(path)
            if "server_to_client" in path_str:
                return io.StringIO(
                    '{"$schema": "https://json-schema.org/draft/2020-12/schema",'
                    ' "defs": "local_server"}'
                )
            elif "standard_catalog" in path_str or "catalog" in path_str:
                return io.StringIO(
                    '{"$schema": "https://json-schema.org/draft/2020-12/schema",'
                    ' "catalogId": "basic", "components": {"LocalText": {}}}'
                )
            raise FileNotFoundError(path)

        mock_open.side_effect = open_side_effect

        direct_json_format = DirectJsonFormat(
            VERSION_0_8, catalogs=[BasicCatalog.get_config(VERSION_0_8)]
        )

        assert direct_json_format._server_to_client_schema["defs"] == "local_server"
        assert len(direct_json_format._supported_catalogs) >= 1
        catalog = direct_json_format._supported_catalogs[0]
        assert "LocalText" in catalog.catalog_schema["components"]


def test_direct_json_parser_methods():
    tf = DirectJsonFormat(VERSION_0_8, catalogs=[BasicCatalog.get_config(VERSION_0_8)])
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
    from a2ui.schema.constants import VERSION_0_9

    fmt = DirectJsonFormat(
        VERSION_0_9,
        catalogs=[BasicCatalog.get_config(VERSION_0_9)],
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
        }],
    }

    catalog = fmt.get_selected_catalog(client_ui_capabilities=caps)

    # 1. Custom component is in components map
    assert "StatusChip" in catalog.catalog_schema["components"]

    # 2. $defs.anyComponent.oneOf contains reference to StatusChip
    any_comp = catalog.catalog_schema.get("$defs", {}).get("anyComponent", {})
    one_of_refs = [
        item.get("$ref") for item in any_comp.get("oneOf", []) if isinstance(item, dict)
    ]
    assert "#/components/StatusChip" in one_of_refs
    assert "#/components/Text" in one_of_refs

    # 3. Payload with StatusChip validates successfully
    test_message = {
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "main",
            "components": [{
                "id": "root",
                "component": "StatusChip",
                "label": "OK",
            }],
        },
    }
    catalog.validator.validate(test_message)

    # 4. Streaming parser processes payload containing StatusChip
    parser = DirectJsonParser(catalog)
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
    payload_str = f"<a2ui-json>\n{json.dumps(messages)}\n</a2ui-json>"
    parts = parser.process_chunk(payload_str)
    assert len(parts) >= 1
