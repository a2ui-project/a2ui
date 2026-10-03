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
from a2ui.core.basic_catalog import BasicCatalog, v0_8, v0_9, v1_0
from a2ui.schema.catalog import A2uiCatalogProvider, CatalogConfig
from a2ui.schema.constants import VERSION_0_8, VERSION_0_9

BASIC_CATALOG_NAME = "basic"


class _DictCatalogProvider(A2uiCatalogProvider):

    def __init__(self, schema: dict):
        self._schema = schema

    def load(self) -> dict:
        return self._schema


def test_catalog_id_property():
    catalog_id = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
    config = CatalogConfig(
        name=BASIC_CATALOG_NAME,
        provider=_DictCatalogProvider({"catalogId": catalog_id}),
    )
    catalog = config.to_catalog(version=VERSION_0_8)
    assert catalog.catalog_id == catalog_id


def test_catalog_id_missing_raises_error():
    config = CatalogConfig(
        name=BASIC_CATALOG_NAME,
        provider=_DictCatalogProvider({}),  # No catalogId
    )
    with pytest.raises(A2uiCatalogError, match="missing 'catalogId'"):
        config.to_catalog(version=VERSION_0_8)


def test_resolve_examples_path_handling():
    from a2ui.schema.catalog import resolve_examples_path

    assert resolve_examples_path(None) is None
    assert resolve_examples_path("/absolute/examples") == "/absolute/examples"
    assert resolve_examples_path("file:///absolute/examples") == "/absolute/examples"

    with pytest.raises(ValueError, match="Unsupported examples URL scheme"):
        resolve_examples_path("https://a2ui.org/examples")


def test_catalog_config_from_path_schemes():
    # Test local path
    config = CatalogConfig.from_path(
        name="test_file", catalog_path="relative_path/to/catalog.json"
    )
    assert config.provider.path == "relative_path/to/catalog.json"

    # Test file:// scheme
    config = CatalogConfig.from_path(
        name="test_file", catalog_path="file:///absolute_path/to/catalog.json"
    )
    assert config.provider.path == "/absolute_path/to/catalog.json"

    # Test HTTP raises NotImplementedError
    with pytest.raises(NotImplementedError, match="HTTP support is coming soon."):
        CatalogConfig.from_path(
            name="test_http", catalog_path="http://a2ui.org/catalog.json"
        )

    # Test unsupported scheme raises ValueError
    with pytest.raises(ValueError, match="Unsupported catalog URL scheme"):
        CatalogConfig.from_path(
            name="test_ftp", catalog_path="ftp://a2ui.org/catalog.json"
        )


def test_basic_catalog_from_catalog_examples_path():
    # Test CatalogConfig.from_catalog with file:// scheme examples path
    config = CatalogConfig.from_catalog(
        "basic", BasicCatalog(VERSION_0_9), examples_path="file:///absolute/examples"
    )
    assert config.name == "basic"
    assert config.examples_path == "/absolute/examples"
    assert config.provider.load() == BasicCatalog(VERSION_0_9).catalog_schema


def test_basic_catalog_id_retrieval_methods():
    expected_0_8 = (
        "https://a2ui.org/specification/v0_8/standard_catalog_definition.json"
    )
    assert v0_8.BasicCatalog().catalog_id == expected_0_8
    assert BasicCatalog("0.8").catalog_id == expected_0_8
    assert BasicCatalog(VERSION_0_8).catalog_id == expected_0_8

    expected_0_9 = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
    assert v0_9.BasicCatalog().catalog_id == expected_0_9
    assert BasicCatalog("0.9").catalog_id == expected_0_9
    assert BasicCatalog(VERSION_0_9).catalog_id == expected_0_9

    expected_1_0 = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
    assert v1_0.BasicCatalog().catalog_id == expected_1_0
    assert BasicCatalog("1.0").catalog_id == expected_1_0

    # BasicCatalog requires protocol_version with no implicit default.
    with pytest.raises(TypeError):
        BasicCatalog()  # type: ignore[call-arg]
