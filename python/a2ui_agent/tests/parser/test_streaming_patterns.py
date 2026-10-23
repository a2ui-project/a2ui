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
import os

import pytest

from a2ui.constants import A2UI_CLOSE_TAG, A2UI_OPEN_TAG
from a2ui.core import A2uiValidationError, CatalogApi, get_common_types_schema_map
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats.direct_json import DirectJsonParser
from a2ui.processor import CatalogConfig
from a2ui.utils import load_common_types_schema

from ..repo_paths import find_repo_root


@pytest.fixture(scope="module")
def basic_catalog() -> CatalogApi:
    catalog_path = os.path.join(
        find_repo_root() or "", "catalogs", "basic", "v1", "catalog.json"
    )
    config = CatalogConfig.from_path(catalog_path)
    return config.transformed_catalog


def _stream_create_surface(catalog: CatalogApi, extensions: dict[str, int]) -> None:
    message = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "main",
            "catalogId": catalog.catalog_id,
            "metadata": {"extensions": extensions},
        },
    }
    stream = DirectJsonParser(catalogs=[catalog]).open_stream()
    stream.feed(f"{A2UI_OPEN_TAG}[{json.dumps(message)}]{A2UI_CLOSE_TAG}")


def test_load_common_types_schema_comes_from_core() -> None:
    assert load_common_types_schema("1.0") == get_common_types_schema_map(
        ProtocolVersion.V1_0
    )


@pytest.mark.parametrize("key", ["good_key", "名前", "_x"])
def test_streaming_accepts_identifier_extension_keys(
    basic_catalog: CatalogApi, key: str
) -> None:
    _stream_create_surface(basic_catalog, {key: 1})


@pytest.mark.parametrize("key", ["bad-key", "1a", "foo\n"])
def test_streaming_rejects_non_identifier_extension_keys(
    basic_catalog: CatalogApi, key: str
) -> None:
    with pytest.raises(A2uiValidationError) as exc_info:
        _stream_create_surface(basic_catalog, {key: 1})
    message = str(exc_info.value)
    # The message names the rule and the key, and stays short.
    assert "Extensions keys must be Unicode identifiers" in message
    assert repr(key) in message
    assert len(message) < 300
