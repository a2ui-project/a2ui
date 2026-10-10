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

import pytest

from a2ui.core import A2uiCatalogError
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import DirectJsonFormat, DirectJsonParser
from a2ui.schema import (
    VERSION_0_8,
    VERSION_0_9,
    VERSION_0_9_1,
    VERSION_1_0,
)


def test_direct_json_format_holds_its_catalogs():
    catalog = BasicCatalog(VERSION_0_8)
    direct_json_format = DirectJsonFormat([catalog])

    assert direct_json_format.catalogs == [catalog]
    assert "Text" in direct_json_format.catalogs[0].validation_schema["components"]


def test_direct_json_format_without_catalogs_is_an_error():
    with pytest.raises(A2uiCatalogError, match="At least one catalog"):
        DirectJsonFormat([])


def test_direct_json_format_with_mixed_versions_is_an_error():
    with pytest.raises(A2uiCatalogError, match="incompatible protocol versions"):
        DirectJsonFormat([BasicCatalog(VERSION_0_8), BasicCatalog(VERSION_0_9)])


@pytest.mark.parametrize(
    "version", [VERSION_0_8, VERSION_0_9, VERSION_0_9_1, VERSION_1_0]
)
def test_direct_json_format_supports_each_version(version):
    catalog = BasicCatalog(version)
    direct_json_format = DirectJsonFormat([catalog])

    assert [c.catalog_id for c in direct_json_format.catalogs] == [catalog.catalog_id]
    assert isinstance(direct_json_format.create_parser(), DirectJsonParser)
    assert direct_json_format.create_parser() is not direct_json_format.create_parser()


def test_direct_json_parser_methods():
    from a2ui.inference_formats._shared import to_message_models

    tf = DirectJsonFormat([BasicCatalog(VERSION_0_8)])
    cat = tf.catalogs[0]
    parser = DirectJsonParser([cat])

    # 1. has_format_content
    assert parser.has_format_content("<a2ui-json>", complete=True) is False
    assert parser.has_format_content("<a2ui-json>{}</a2ui-json>", complete=True) is True

    # 2. parse_chunk incremental streaming
    parts1 = parser.parse_chunk("<a2ui-json>")
    assert parts1 == []  # Buffering open tag

    parts2 = parser.parse_chunk(
        '[{"beginRendering": {"surfaceId": "main", "root": "c1"}}]</a2ui-json>'
    )
    assert len(parts2) == 1
    assert len(parts2[0].a2ui) == 1

    # 3. decompile and wrap_decompiled_blocks
    payload = to_message_models([{"beginRendering": {"surfaceId": "s1", "root": "c1"}}])
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
