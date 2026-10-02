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
import pytest

pytestmark = pytest.mark.skip(
    reason="TODO: validation package was removed from a2ui_agent library"
)
from a2ui.core import A2uiCatalogError
from a2ui.core.basic_catalog.v0_8 import BasicCatalog
from a2ui.inference_formats.direct_json import DirectJsonFormat, DirectJsonParser
from a2ui.schema.catalog import CatalogConfig
from a2ui.schema.constants import (
    VERSION_0_8,
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
    with pytest.raises(ValueError, match="Unknown A2UI specification version"):
        DirectJsonFormat("invalid_version")


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
