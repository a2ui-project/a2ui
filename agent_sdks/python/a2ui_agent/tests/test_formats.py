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

import pytest
from a2ui.schema.catalog import A2uiCatalog
from a2ui.schema.constants import VERSION_0_9
from a2ui.inference_formats.transport import TransportFormat, TransportParser
from a2ui.adk.a2a.part_converter import A2uiPartConverter
from google.genai import types as genai_types
from a2ui.inference_formats.experimental.express import ExpressFormat, ExpressParser
from a2ui.inference_formats.experimental.elemental import (
    ElementalFormat,
    ElementalParser,
)


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

    transport_format = TransportFormat(version=VERSION_0_9, catalogs=[config])
    prompt = transport_format.generate_system_prompt(
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
    parser = TransportParser(test_catalog)
    parsed = parser.parse_response(
        '<a2ui-json>[{"createSurface": {"surfaceId": "main", "layout": {"component":'
        ' "Text"}}}]</a2ui-json>'
    )
    assert len(parsed) == 1
    assert parsed[0].a2ui_json is not None


def test_schema_parser_with_nested_close_tag(test_catalog):
    parser = TransportParser(test_catalog)
    # The JSON string literal itself contains '</a2ui-json>'
    response = (
        "<a2ui-json>[{\n"
        '  "createSurface": {\n'
        '    "surfaceId": "main",\n'
        '    "layout": {\n'
        '      "component": "Text",\n'
        '      "text": "This is a literal close tag: </a2ui-json> inside a string."\n'
        "    }\n"
        "  }\n"
        "}]</a2ui-json>"
    )
    parsed = parser.parse_response(response)
    assert len(parsed) == 1
    assert parsed[0].a2ui_json is not None
    assert parsed[0].a2ui_json[0]["createSurface"]["layout"]["text"] == (
        "This is a literal close tag: </a2ui-json> inside a string."
    )


def test_strategy_based_converters(test_catalog, monkeypatch):
    monkeypatch.setenv("A2UI_VERSION_1_0", "true")
    # Test JSON default (TransportParser)
    json_converter = A2uiPartConverter(a2ui_catalog=test_catalog)
    part_json = genai_types.Part(
        text=(
            '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "main",'
            ' "catalogId": "https://a2ui.org/test_catalog"}}]</a2ui-json>'
        )
    )
    parts_json = json_converter.convert(part_json)
    assert len(parts_json) == 1


def test_supports_streaming_property(test_catalog):
    from a2ui.schema.catalog import CatalogConfig
    from a2ui.schema.catalog_provider import A2uiCatalogProvider

    class MemoryCatalogProvider(A2uiCatalogProvider):

        def __init__(self, schema):
            self.schema = schema

        def load(self):
            return self.schema

    config = CatalogConfig(
        name="test_catalog",
        provider=MemoryCatalogProvider(test_catalog.catalog_schema),
    )

    # 1. TransportFormat parser supports streaming
    transport_fmt = TransportFormat(version=VERSION_0_9, catalogs=[config])
    assert transport_fmt.supports_streaming is True
    assert transport_fmt.parser.supports_streaming is True

    # 2. ExpressFormat parser does not support streaming
    express_fmt = ExpressFormat(catalog=test_catalog)
    assert express_fmt.supports_streaming is False
    assert express_fmt.parser.supports_streaming is False

    # 3. ElementalFormat parser does not support streaming
    elemental_fmt = ElementalFormat(catalog=test_catalog)
    assert elemental_fmt.supports_streaming is False
    assert elemental_fmt.parser.supports_streaming is False


def test_process_chunk_raises_not_implemented(test_catalog):
    express_parser = ExpressParser(test_catalog)
    with pytest.raises(NotImplementedError) as exc_info:
        express_parser.process_chunk("chunk")
    assert "Streaming is not supported by ExpressParser" in str(exc_info.value)

    elemental_parser = ElementalParser(test_catalog)
    with pytest.raises(NotImplementedError) as exc_info:
        elemental_parser.process_chunk("chunk")
    assert "Streaming is not supported by ElementalParser" in str(exc_info.value)


def test_decompiler_delegation(test_catalog):
    from a2ui.schema.catalog import CatalogConfig
    from a2ui.schema.catalog_provider import A2uiCatalogProvider

    class DummyProvider(A2uiCatalogProvider):

        def load(self):
            return test_catalog.catalog_schema

    config = CatalogConfig(name="test_catalog", provider=DummyProvider())
    # Verify Transport Parser Decompile
    transport_fmt = TransportFormat(version=VERSION_0_9, catalogs=[config])
    payload = {"createSurface": {"surfaceId": "main"}}
    direct_decompile = transport_fmt.parser.decompile(payload)
    assert "createSurface" in direct_decompile
    assert "main" in direct_decompile

    # Verify Express Parser Decompile
    express_fmt = ExpressFormat(catalog=test_catalog)
    expr_parser = express_fmt.parser
    envelope = {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "main",
            "components": [{
                "id": "root",
                "component": "Text",
                "text": "Hello World",
            }],
        },
    }
    decompiled_dsl = expr_parser.decompile(envelope)
    assert 'root = Text("Hello World")' in decompiled_dsl

    # Verify wrap_decompiled_blocks implementation
    assert (
        transport_fmt.parser.wrap_decompiled_blocks(["{}", "{}"])
        == "<a2ui-json>\n{}\n{}\n</a2ui-json>"
    )
    assert (
        expr_parser.wrap_decompiled_blocks(["a = 1", "b = 2"])
        == "<a2ui>\na = 1\nb = 2\n</a2ui>"
    )

    # Verify abstract PromptGenerator generate pass
    from a2ui.prompt.generator import PromptGenerator

    class DummyPromptGenerator(PromptGenerator):

        def generate(self, *args, **kwargs):
            return super().generate(*args, **kwargs)

    assert DummyPromptGenerator().generate("role") is None

    # Verify invalid catalog_id check
    bad_catalog = A2uiCatalog(
        version="1.0",
        name="bad",
        experiments=None,
        s2c_schema={},
        common_types_schema={},
        catalog_schema={"catalogId": 12345},
    )
    from a2ui.core.exceptions import A2uiCatalogError

    with pytest.raises(A2uiCatalogError) as ctx:
        _ = bad_catalog.catalog_id
    assert "catalogId is not a string" in str(ctx.value)

    # Verify empty pruned components and messages fallback
    assert test_catalog._with_pruned_components([]) is test_catalog
    assert test_catalog._with_pruned_messages([]) is test_catalog
