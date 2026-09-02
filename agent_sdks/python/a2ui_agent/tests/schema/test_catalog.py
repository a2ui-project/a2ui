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
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import (
    VERSION_0_8,
    VERSION_0_9,
)
from a2ui.basic_catalog.constants import BASIC_CATALOG_NAME
from a2ui.basic_catalog import BasicCatalog


def test_catalog_id_property():
    catalog_id = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
    catalog = A2uiCatalog(
        version=VERSION_0_8,
        name=BASIC_CATALOG_NAME,
        s2c_schema={},
        common_types_schema={},
        catalog_schema={"catalogId": catalog_id},
    )
    assert catalog.catalog_id == catalog_id


def test_catalog_id_missing_raises_error():
    catalog = A2uiCatalog(
        version=VERSION_0_8,
        name=BASIC_CATALOG_NAME,
        s2c_schema={},
        common_types_schema={},
        catalog_schema={},  # No catalogId
    )
    with pytest.raises(
        ValueError, match=f"Catalog '{BASIC_CATALOG_NAME}' missing catalogId"
    ):
        _ = catalog.catalog_id


def test_resolve_examples_path_handling():
    from a2ui.schema.catalog import resolve_examples_path

    assert resolve_examples_path(None) is None
    assert resolve_examples_path("/absolute/examples") == "/absolute/examples"
    assert resolve_examples_path("file:///absolute/examples") == "/absolute/examples"

    with pytest.raises(ValueError, match="Unsupported examples URL scheme"):
        resolve_examples_path("https://a2ui.org/examples")


def test_catalog_config_from_path_schemes(mocker=None):
    from a2ui.schema.catalog import CatalogConfig
    from a2ui.schema.catalog_provider import HttpCatalogProvider
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

    # Test HTTP loads HttpCatalogProvider
    config = CatalogConfig.from_path(
        name="test_http", catalog_path="http://a2ui.org/catalog.json"
    )
    assert isinstance(config.provider, HttpCatalogProvider)
    assert config.provider.url == "http://a2ui.org/catalog.json"

    # Test unsupported scheme raises ValueError
    with pytest.raises(ValueError, match="Unsupported catalog URL scheme"):
        CatalogConfig.from_path(
            name="test_ftp", catalog_path="ftp://a2ui.org/catalog.json"
        )


def test_basic_catalog_get_config_examples_path():
    from a2ui.basic_catalog.provider import BasicCatalog

    # Test get_config with file:// scheme examples path
    config = BasicCatalog.get_config(
        version=VERSION_0_9, examples_path="file:///absolute/examples"
    )
    assert config.examples_path == "/absolute/examples"


def test_basic_catalog_id_retrieval_methods():

    # Test v0.8 variations
    expected_0_8 = (
        "https://a2ui.org/specification/v0_8/standard_catalog_definition.json"
    )
    assert BasicCatalog.get_catalog_id("0.8") == expected_0_8

    # Test other version variations
    expected_0_9 = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
    assert BasicCatalog.get_catalog_id("0.9") == expected_0_9

    with pytest.raises(ValueError, match="Unsupported version: 0.7"):
        BasicCatalog.get_catalog_id("0.7")


def test_http_catalog_provider_success():
    from unittest.mock import patch, MagicMock
    from a2ui.schema.catalog_provider import HttpCatalogProvider

    mock_response = MagicMock()
    mock_response.__enter__.return_value = mock_response
    mock_response.read.return_value = b'{"catalogId": "my_remote_catalog"}'
    mock_response.headers = {"Content-Type": "application/agent-plugin+json"}

    provider = HttpCatalogProvider("http://example.com/catalog.json")

    with patch("urllib.request.urlopen", return_value=mock_response):
        data = provider.load()
        assert data == {"catalogId": "my_remote_catalog"}


def test_catalog_part_helpers():
    from a2ui.a2a.parts import is_catalog_part, create_catalog_part, CATALOG_MIME_TYPE
    from a2a.types import Part, DataPart

    catalog_data = {"catalogId": "test_catalog"}
    part = create_catalog_part(catalog_data)

    assert isinstance(part, Part)
    assert isinstance(part.root, DataPart)
    assert part.root.data == catalog_data
    assert part.root.metadata.get("mimeType") == CATALOG_MIME_TYPE
    assert is_catalog_part(part) is True

    # Test is_catalog_part with non-catalog part
    non_catalog_part = Part(root=DataPart(data={}, metadata={"mimeType": "application/json"}))
    assert is_catalog_part(non_catalog_part) is False

