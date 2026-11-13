# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Unit tests for `a2ui.utils.read_renderer_capabilities`.

The shared `renderer_capabilities.yaml` suite covers the `v0.9` entry. These
tests cover the `v0.9.1` entry, which it doesn't.
"""

import pytest

from a2ui.constants import A2UI_CLIENT_CAPABILITIES_KEY
from a2ui.core import A2uiCatalogError, Catalog
from a2ui.processor import CatalogConfig
from a2ui.utils import read_renderer_capabilities, resolve_catalogs

_VERSIONS = pytest.mark.parametrize("version", ["v0.9", "v0.9.1"])


def _metadata(capabilities: dict) -> dict:
    return {A2UI_CLIENT_CAPABILITIES_KEY: capabilities}


@_VERSIONS
def test_the_v0_9_1_entry_is_read(version):
    capabilities = {"v0.9.1": {"supportedCatalogIds": ["a"]}}

    assert read_renderer_capabilities(_metadata(capabilities), version) == capabilities


@_VERSIONS
def test_the_v0_9_1_and_v0_9_entries_are_both_read(version):
    capabilities = {
        "v0.9": {"supportedCatalogIds": ["a"]},
        "v0.9.1": {"supportedCatalogIds": ["b"]},
        "1.0": {"supportedCatalogIds": ["c"]},
    }

    result = read_renderer_capabilities(_metadata(capabilities), version)

    assert result == {
        "v0.9.1": {"supportedCatalogIds": ["b"]},
        "v0.9": {"supportedCatalogIds": ["a"]},
    }


@_VERSIONS
def test_a_malformed_v0_9_entry_beside_a_v0_9_1_entry_is_invalid(version):
    capabilities = {
        "v0.9.1": {"supportedCatalogIds": ["a"]},
        "v0.9": {"supportedCatalogIds": "a"},
    }

    with pytest.raises(A2uiCatalogError, match="'v0.9' renderer capabilities"):
        read_renderer_capabilities(_metadata(capabilities), version)


@pytest.mark.parametrize("key", ["v0.9", "v0.9.1"])
@pytest.mark.parametrize("declared", ["v0.9", "v0.9.1"])
def test_an_entry_accepts_v0_9_and_v0_9_1_inline_catalogs(key, declared):
    inline = {"catalogId": "inline", "protocolVersion": declared, "components": {}}
    capabilities = {key: {"supportedCatalogIds": [], "inlineCatalogs": [inline]}}

    assert read_renderer_capabilities(_metadata(capabilities), "v0.9.1") == capabilities


def test_a_v0_9_1_entry_with_a_v1_0_inline_catalog_is_invalid():
    inline = {"catalogId": "inline", "protocolVersion": "1.0", "components": {}}
    capabilities = {"v0.9.1": {"supportedCatalogIds": [], "inlineCatalogs": [inline]}}

    with pytest.raises(A2uiCatalogError, match="incompatible with 'v0.9.1'"):
        read_renderer_capabilities(_metadata(capabilities), "v0.9.1")


def test_the_result_resolves_catalogs_unchanged():
    registered = Catalog.from_json(
        {"catalogId": "a", "components": {}}, protocol_version="0.9.1"
    )
    capabilities = {
        "v0.9.1": {"supportedCatalogIds": ["other"]},
        "v0.9": {"supportedCatalogIds": ["a"]},
    }

    result = read_renderer_capabilities(_metadata(capabilities), "v0.9.1")

    assert [
        catalog.catalog_id
        for catalog in resolve_catalogs([CatalogConfig(registered)], result)
    ] == ["a"]
