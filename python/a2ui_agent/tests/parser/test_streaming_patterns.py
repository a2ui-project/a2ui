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

"""Tests streaming validation of schema patterns (e.g. extension keys)."""

from __future__ import annotations

import json

import pytest

from a2ui.core import A2uiValidationError, get_common_types_schema_map
from a2ui.inference_formats.direct_json import DirectJsonStreamParser
from a2ui.schema import A2UI_CLOSE_TAG, A2UI_OPEN_TAG, A2uiCatalog, CatalogConfig
from a2ui.schema.utils import get_basic_catalog_path


@pytest.fixture(scope="module")
def basic_catalog() -> A2uiCatalog:
    config = CatalogConfig.from_path("basic", get_basic_catalog_path("1.0"))
    return A2uiCatalog.from_config(config, version="1.0")


def _stream_create_surface(catalog: A2uiCatalog, extensions: dict[str, int]) -> None:
    message = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "main",
            "catalogId": catalog.catalog_id,
            "metadata": {"extensions": extensions},
        },
    }
    parser = DirectJsonStreamParser(catalog=catalog)
    parser.process_chunk(f"{A2UI_OPEN_TAG}[{json.dumps(message)}]{A2UI_CLOSE_TAG}")


def test_catalog_common_types_come_from_core(basic_catalog: A2uiCatalog) -> None:
    assert basic_catalog.common_types_schema == get_common_types_schema_map("1.0")


@pytest.mark.parametrize("key", ["good_key", "名前", "_x"])
def test_streaming_accepts_identifier_extension_keys(
    basic_catalog: A2uiCatalog, key: str
) -> None:
    _stream_create_surface(basic_catalog, {key: 1})


@pytest.mark.parametrize("key", ["bad-key", "1a", "foo\n"])
def test_streaming_rejects_non_identifier_extension_keys(
    basic_catalog: A2uiCatalog, key: str
) -> None:
    with pytest.raises(A2uiValidationError) as exc_info:
        _stream_create_surface(basic_catalog, {key: 1})
    message = str(exc_info.value)
    # The message quotes the schema's pattern, not its multi-kilobyte expansion.
    assert r"\\p{XID_Start}" in message
    assert len(message) < 300
