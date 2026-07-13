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

import json
import pytest
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import VERSION_0_9, VERSION_1_0
from a2ui.strategies.schema import A2uiSchemaManager, A2uiSchemaParser
from a2ui.experimental.express import ExpressInferenceStrategy, ExpressParser
from a2ui.experimental.elemental import ElementalInferenceStrategy, ElementalParser
from a2ui.adk.a2a.part_converter import A2uiPartConverter
from google.genai import types as genai_types


@pytest.fixture
def test_catalog():
    return A2uiCatalog(
        version=VERSION_0_9,
        name="test_catalog",
        s2c_schema={},
        common_types_schema={},
        catalog_schema={
            "catalogId": "https://a2ui.org/test_catalog",
            "components": {
                "Text": {
                    "properties": {"text": {"type": "string", "positionalIndex": 0}}
                }
            },
            "functions": {
                "openUrl": {
                    "properties": {"url": {"type": "string", "positionalIndex": 0}}
                }
            },
        },
    )


def test_schema_strategy_prompt_generation(test_catalog):
    from a2ui.schema.catalog import CatalogConfig
    from a2ui.schema.catalog_provider import A2uiCatalogProvider

    class MemoryCatalogProvider(A2uiCatalogProvider):

        def __init__(self, schema):
            self.schema = schema

        def load(self):
            return self.schema

    config = CatalogConfig(
        name="test_catalog", provider=MemoryCatalogProvider(test_catalog.catalog_schema)
    )

    manager = A2uiSchemaManager(version=VERSION_0_9, catalogs=[config])
    prompt = manager.generate_system_prompt(
        role_description="You are a helpful assistant.",
        workflow_description="Please adhere to constraints.",
        include_schema=True,
        client_ui_capabilities={
            "supportedCatalogIds": ["https://a2ui.org/test_catalog"]
        },
    )
    assert "You are a helpful assistant." in prompt
    assert "Please adhere to constraints." in prompt
    assert "### Catalog Schema:" in prompt


def test_schema_parser(test_catalog):
    parser = A2uiSchemaParser(test_catalog)
    parsed = parser.parse_response(
        '<a2ui-json>[{"createSurface": {"surfaceId": "main", "layout": {"component":'
        ' "Text"}}}]</a2ui-json>'
    )
    assert len(parsed) == 1
    assert parsed[0].a2ui_json is not None


def test_express_inference_strategy(test_catalog):
    strategy = ExpressInferenceStrategy(catalog=test_catalog)
    prompt = strategy.generate_system_prompt(
        role_description="Test assistant",
        workflow_description="Custom rules",
        include_schema=True,
    )
    assert "Test assistant" in prompt
    assert "Custom rules" in prompt
    assert "## Positional Component Signatures" in prompt


def test_express_parser(test_catalog):
    parser = ExpressParser(test_catalog)
    parsed = parser.parse_response("<a2ui>\nroot = Text()\n</a2ui>")
    assert len(parsed) == 1
    assert parsed[0].a2ui_json is not None


def test_elemental_inference_strategy(test_catalog):
    strategy = ElementalInferenceStrategy(catalog=test_catalog)
    prompt = strategy.generate_system_prompt(
        role_description="Test assistant",
        workflow_description="Custom rules",
        include_schema=True,
    )
    assert "Test assistant" in prompt
    assert "Custom rules" in prompt
    assert "## Component Interfaces" in prompt


def test_elemental_parser(test_catalog):
    parser = ElementalParser(test_catalog)
    parsed = parser.parse_response(
        '<a2ui id="main"><link rel="catalog"'
        ' href="https://a2ui.org/test_catalog"><ui-text id="root"'
        ' text="hello"></ui-text></a2ui>'
    )
    assert len(parsed) == 1
    assert parsed[0].a2ui_json is not None


def test_strategy_based_converters(test_catalog, monkeypatch):
    monkeypatch.setenv("A2UI_VERSION_1_0", "true")
    # Test JSON default (A2uiSchemaParser)
    json_converter = A2uiPartConverter(a2ui_catalog=test_catalog)
    part_json = genai_types.Part(
        text=(
            '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "main",'
            ' "catalogId": "https://a2ui.org/test_catalog"}}]</a2ui-json>'
        )
    )
    parts_json = json_converter.convert(part_json)
    assert len(parts_json) == 1

    test_catalog_v1_0 = A2uiCatalog(
        version=VERSION_1_0,
        name="test_catalog",
        s2c_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": "https://a2ui.org/s2c.json",
        },
        common_types_schema={
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": "https://a2ui.org/common.json",
        },
        catalog_schema=test_catalog.catalog_schema,
        experiments=frozenset({"version_1_0"}),
    )

    express_parser = ExpressParser(test_catalog_v1_0)
    express_converter = A2uiPartConverter(
        a2ui_catalog=test_catalog_v1_0,
        version=VERSION_1_0,
        parser=express_parser,
    )
    part_express = genai_types.Part(text="<a2ui>\nroot = Text()\n</a2ui>")
    parts_express = express_converter.convert(part_express)
    assert len(parts_express) == 1
