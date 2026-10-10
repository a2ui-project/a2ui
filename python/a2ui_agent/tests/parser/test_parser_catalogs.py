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

"""Tests for the catalogs that the Direct JSON parsers accept."""

import pytest

from a2ui.core import A2uiCatalogError, Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import DirectJsonParser


def _catalog(catalog_id: str, protocol_version: str) -> Catalog:
    return Catalog.from_json(
        {"catalogId": catalog_id, "components": {}},
        protocol_version=protocol_version,
        catalog_id=catalog_id,
    )


@pytest.mark.parametrize("version", ["0.8", "0.9", "0.9.1", "1.0"])
def test_parsers_hold_multiple_catalogs(version):
    catalogs = [_catalog("basic", version), _catalog("custom", version)]

    assert DirectJsonParser(catalogs).catalogs == list(catalogs)


def test_catalogs_of_incompatible_versions_are_rejected():
    with pytest.raises(A2uiCatalogError, match="incompatible protocol versions"):
        DirectJsonParser([BasicCatalog("0.9"), BasicCatalog("1.0")])


def test_no_catalogs_are_rejected():
    with pytest.raises(A2uiCatalogError, match="At least one catalog"):
        DirectJsonParser([])
