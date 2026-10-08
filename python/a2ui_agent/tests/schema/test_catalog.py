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

from a2ui.catalog_transformers import (
    ComponentPruningTransformer,
    FunctionPruningTransformer,
)
from a2ui.core import A2uiCatalogError
from a2ui.core.basic_catalog import BasicCatalog, v0_8, v0_9, v1_0
from a2ui.processor import (
    CatalogConfig,
    CatalogProvider,
    FileSystemCatalogProvider,
    InMemoryCatalogProvider,
)
from a2ui.schema import (
    VERSION_0_8,
    VERSION_0_9,
    resolve_examples_path,
)


def test_catalog_provider_is_abstract():
    with pytest.raises(TypeError):
        CatalogProvider()  # type: ignore[abstract]


def test_in_memory_provider_loads_catalog():
    catalog_id = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
    provider = InMemoryCatalogProvider(
        {"catalogId": catalog_id, "components": {}},
        protocol_version=VERSION_0_8,
    )
    catalog = provider.load()
    assert catalog.catalog_id == catalog_id
    assert catalog.protocol_version == "v0.8"


def test_in_memory_provider_missing_catalog_id_raises_error():
    provider = InMemoryCatalogProvider(
        {"components": {}},
        protocol_version=VERSION_0_8,
    )
    with pytest.raises(A2uiCatalogError, match="no 'catalogId'"):
        provider.load()


def test_in_memory_provider_missing_protocol_version_raises_error():
    provider = InMemoryCatalogProvider(
        {"catalogId": "custom/id", "components": {}},
    )
    with pytest.raises(A2uiCatalogError, match="no 'protocolVersion'"):
        provider.load()


def test_in_memory_provider_conflicting_catalog_id_raises_error():
    provider = InMemoryCatalogProvider(
        {"catalogId": "doc/id", "protocolVersion": "1.0", "components": {}},
        catalog_id="provider/id",
    )
    with pytest.raises(A2uiCatalogError, match="declares catalog id 'doc/id'"):
        provider.load()


def test_in_memory_provider_conflicting_protocol_version_raises_error():
    provider = InMemoryCatalogProvider(
        {"catalogId": "doc/id", "protocolVersion": "1.0", "components": {}},
        protocol_version="v0.9",
    )
    with pytest.raises(A2uiCatalogError, match="declares protocol version '1.0'"):
        provider.load()


def test_in_memory_provider_non_mapping_raises_error():
    provider = InMemoryCatalogProvider(
        "not_a_dict",  # type: ignore[arg-type]
        protocol_version="1.0",
        catalog_id="id",
    )
    with pytest.raises(A2uiCatalogError, match="not a mapping"):
        provider.load()


def test_file_system_provider_schemes(tmp_path):
    cat_file = tmp_path / "catalog.json"
    cat_file.write_text(
        '{"catalogId": "test/file", "protocolVersion": "1.0", "components": {}}',
        encoding="utf-8",
    )

    # Local path
    cat1 = FileSystemCatalogProvider(str(cat_file)).load()
    assert cat1.catalog_id == "test/file"

    # file:// scheme
    cat2 = FileSystemCatalogProvider(f"file://{cat_file}").load()
    assert cat2.catalog_id == "test/file"

    # Unsupported scheme raises A2uiCatalogError
    with pytest.raises(A2uiCatalogError, match="Unsupported catalog URL scheme"):
        FileSystemCatalogProvider("ftp://a2ui.org/catalog.json").load()


def test_catalog_config_transformed_catalog_applies_transformers():
    base = BasicCatalog(VERSION_0_9)
    config = CatalogConfig(
        base,
        transformers=[
            ComponentPruningTransformer(["Text", "Card"]),
            FunctionPruningTransformer(["required"]),
        ],
    )
    transformed = config.transformed_catalog
    assert set(transformed.components) == {"Text", "Card"}
    assert set(transformed.functions) == {"required"}
    # Base catalog remains untouched
    assert "Button" in base.components


def test_resolve_examples_path_handling():
    assert resolve_examples_path(None) is None
    assert resolve_examples_path("/absolute/examples") == "/absolute/examples"
    assert resolve_examples_path("file:///absolute/examples") == "/absolute/examples"

    with pytest.raises(A2uiCatalogError, match="Unsupported examples URL scheme"):
        resolve_examples_path("https://a2ui.org/examples")


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
