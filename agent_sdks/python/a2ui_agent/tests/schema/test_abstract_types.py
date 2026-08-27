# Copyright 2026 Google LLC
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

from collections.abc import Mapping
from typing import Any, Iterator
import pytest

from a2ui.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import DirectJsonFormat
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import VERSION_0_9
from a2ui.schema.manager import A2uiSchemaManager


class CustomMapping(Mapping):
    """Custom Mapping implementation for testing non-dict Mapping support."""

    def __init__(self, data: dict[str, Any]):
        self._data = data

    def __getitem__(self, key: str) -> Any:
        return self._data[key]

    def __len__(self) -> int:
        return len(self._data)

    def __iter__(self) -> Iterator[str]:
        return iter(self._data)


def test_a2ui_catalog_common_types_schema_optional_default():
    catalog = A2uiCatalog(
        version=VERSION_0_9,
        name="test_cat",
        s2c_schema={},
        catalog_schema={"catalogId": "test_id"},
    )
    assert catalog.common_types_schema is None
    assert catalog.catalog_id == "test_id"


def test_a2ui_catalog_with_pruning_sequences():
    catalog = A2uiCatalog(
        version=VERSION_0_9,
        name="test_cat",
        s2c_schema={},
        catalog_schema={
            "catalogId": "test_id",
            "components": {"Text": {}, "Button": {}},
        },
    )
    pruned = catalog.with_pruning(
        allowed_components=("Text",),
        allowed_messages=("BeginRendering",),
    )
    assert "Text" in pruned.catalog_schema["components"]
    assert "Button" not in pruned.catalog_schema["components"]


def test_direct_json_format_accepts_tuples_and_mappings():
    basic_config = BasicCatalog.get_config(VERSION_0_9)
    basic_catalog_id = BasicCatalog.get_catalog_id(VERSION_0_9)

    def dummy_modifier(schema: dict[str, Any]) -> dict[str, Any]:
        return schema

    # Tuple for catalogs and schema_modifiers
    fmt = DirectJsonFormat(
        version=VERSION_0_9,
        catalogs=(basic_config,),
        schema_modifiers=(dummy_modifier,),
    )

    # Custom Mapping for client_ui_capabilities
    caps = CustomMapping({"supportedCatalogIds": [basic_catalog_id]})
    catalog = fmt.get_selected_catalog(
        client_ui_capabilities=caps,
        allowed_components=("Text", "Button"),
        allowed_messages=("BeginRendering",),
    )
    assert catalog is not None
    assert catalog.catalog_id == basic_catalog_id


def test_schema_manager_accepts_tuples():
    basic_config = BasicCatalog.get_config(VERSION_0_9)

    with pytest.warns(DeprecationWarning):
        manager = A2uiSchemaManager(
            version=VERSION_0_9,
            catalogs=(basic_config,),
            schema_modifiers=(),
        )
    assert len(manager._supported_catalogs) >= 1
