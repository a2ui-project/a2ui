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
from a2ui.core import A2uiValidationError, Catalog
from a2ui.schema import VERSION_0_9
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import (
    DEFAULT_PROGRESSIVE_KEYS,
    DirectJsonFormat,
    DirectJsonParser,
)
from a2ui.adk import A2uiPartConverter
from a2ui.utils import resolve_catalogs
from google.genai import types as genai_types
from a2ui.inference_formats.experimental.express import ExpressFormat, ExpressParser
from a2ui.inference_formats.experimental.elemental import (
    ElementalFormat,
    ElementalParser,
)


@pytest.fixture
def test_catalog():
    return Catalog.from_json(
        {
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
        protocol_version=f"v{VERSION_0_9}",
    )


def test_schema_strategy_prompt_generation(test_catalog):
    from a2ui.schema import A2uiCatalogProvider, CatalogConfig

    class MemoryCatalogProvider(A2uiCatalogProvider):

        def __init__(self, schema):
            self.schema = schema

        def load(self):
            return self.schema

    config = CatalogConfig(
        name="test_catalog", provider=MemoryCatalogProvider(test_catalog.catalog_schema)
    )
    catalogs = resolve_catalogs(
        [CatalogConfig.from_catalog("test_catalog", config.to_catalog(VERSION_0_9))],
        {"v0.9": {"supportedCatalogIds": ["https://a2ui.org/test_catalog"]}},
    )

    direct_json_format = DirectJsonFormat(catalogs)
    prompt = direct_json_format.prompt_generator.generate(
        role_description="You are a helpful assistant.",
        workflow_description="Please adhere to constraints.",
        include_schema=True,
    )
    assert "You are a helpful assistant." in prompt
    assert "Please adhere to constraints." in prompt
    assert "### Catalog Schema:" in prompt


def test_schema_strategy_prompt_shows_the_protocol_schemas_once(test_catalog):
    direct_json_format = DirectJsonFormat([test_catalog, BasicCatalog(VERSION_0_9)])

    prompt = direct_json_format.prompt_generator.generate(
        role_description="You are a helpful assistant.", include_schema=True
    )
    instructions = direct_json_format.prompt_generator.generate_catalog_instructions()

    for text in (prompt, instructions):
        assert text.count("### Agent to Renderer Schema:") == 1
        assert text.count("### Common Types Schema:") <= 1
        assert text.count("### Catalog Schema:") == 2


def test_schema_parser(test_catalog):
    parser = DirectJsonParser([test_catalog])
    parsed = parser.parse_response(
        '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "main",'
        ' "catalogId": "https://a2ui.org/test_catalog"}}]</a2ui-json>'
    )
    assert len(parsed) == 1
    assert parsed[0].a2ui_json is not None


def test_schema_parser_rejects_an_invalid_payload(test_catalog):
    parser = DirectJsonParser([test_catalog])
    with pytest.raises(A2uiValidationError):
        parser.parse_response(
            '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "main",'
            ' "catalogId": "https://a2ui.org/test_catalog"}}, {"version": "v0.9",'
            ' "updateComponents": {"surfaceId": "main", "components": [{"id":'
            ' "root", "component": "Unknown"}]}}]</a2ui-json>'
        )


def test_schema_parser_with_nested_close_tag(test_catalog):
    parser = DirectJsonParser([test_catalog])
    # The JSON string literal itself contains '</a2ui-json>'
    response = (
        "<a2ui-json>[{\n"
        '  "version": "v0.9",\n'
        '  "updateComponents": {\n'
        '    "surfaceId": "main",\n'
        '    "components": [{\n'
        '      "id": "root",\n'
        '      "component": "Text",\n'
        '      "text": "This is a literal close tag: </a2ui-json> inside a string."\n'
        "    }]\n"
        "  }\n"
        "}]</a2ui-json>"
    )
    parsed = parser.parse_response(response)
    assert len(parsed) == 1
    assert parsed[0].a2ui_json is not None
    assert parsed[0].a2ui_json[0]["updateComponents"]["components"][0]["text"] == (
        "This is a literal close tag: </a2ui-json> inside a string."
    )


def test_strategy_based_converters(test_catalog, monkeypatch):
    monkeypatch.setenv("A2UI_VERSION_1_0", "true")
    # Test JSON default (DirectJsonParser)
    json_converter = A2uiPartConverter(catalogs=[test_catalog])
    part_json = genai_types.Part(
        text=(
            '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "main",'
            ' "catalogId": "https://a2ui.org/test_catalog"}}]</a2ui-json>'
        )
    )
    parts_json = json_converter.convert(part_json)
    assert len(parts_json) == 1


def test_supports_streaming_property(test_catalog):
    from a2ui.schema import A2uiCatalogProvider, CatalogConfig

    class MemoryCatalogProvider(A2uiCatalogProvider):

        def __init__(self, schema):
            self.schema = schema

        def load(self):
            return self.schema

    config = CatalogConfig(
        name="test_catalog",
        provider=MemoryCatalogProvider(test_catalog.catalog_schema),
    )

    # 1. DirectJsonFormat parser supports streaming
    direct_json_fmt = DirectJsonFormat([config.to_catalog(VERSION_0_9)])
    assert direct_json_fmt.supports_streaming is True
    assert direct_json_fmt.parser.supports_streaming is True

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
    from a2ui.schema import A2uiCatalogProvider, CatalogConfig

    class DummyProvider(A2uiCatalogProvider):

        def load(self):
            return test_catalog.catalog_schema

    config = CatalogConfig(name="test_catalog", provider=DummyProvider())
    # Verify Direct JSON Parser Decompile
    direct_json_fmt = DirectJsonFormat([config.to_catalog(VERSION_0_9)])
    payload = {"createSurface": {"surfaceId": "main"}}
    direct_decompile = direct_json_fmt.parser.decompile(payload)
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
        direct_json_fmt.parser.wrap_decompiled_blocks(["{}", "{}"])
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

    assert DummyPromptGenerator().generate("role") == "role"

    # Verify invalid catalog_id check
    from a2ui.core import A2uiCatalogError
    from a2ui.schema import A2uiCatalogProvider, CatalogConfig

    class _BadProvider(A2uiCatalogProvider):

        def load(self):
            return {"catalogId": 12345}

    with pytest.raises(A2uiCatalogError) as ctx:
        _ = CatalogConfig(name="bad", provider=_BadProvider()).to_catalog(
            protocol_version="1.0"
        )
    assert "catalogId is not a string" in str(ctx.value)

    # An empty allowlist keeps nothing. Keeping everything means not pruning.
    from a2ui.catalog_transformers import ComponentPruningTransformer
    from a2ui.utils import prune_messages_schema

    assert not ComponentPruningTransformer([]).transform(test_catalog).components
    assert prune_messages_schema({}, "0.9", []) == {}


def test_direct_json_stream_parser_record_inline_components_surface_id(
    test_catalog,
):
    from a2ui.inference_formats.direct_json import DirectJsonStreamParserModern

    parser = DirectJsonStreamParserModern([test_catalog])
    parser.surface_id = "main_surface"
    parser._record_inline_components(
        "custom_surface", [{"id": "c1", "component": "Text"}]
    )

    assert "c1" in parser._components_by_surface.get("custom_surface", {})
    assert "c1" in parser._yielded_ids.get("custom_surface", set())
    assert ("custom_surface", "c1") in parser._yielded_contents
    assert "c1" not in parser._components_by_surface.get("main_surface", {})


def test_direct_json_stream_parser_leaf_child_fields(test_catalog):
    from a2ui.inference_formats.direct_json import DirectJsonStreamParser

    parser = DirectJsonStreamParser([test_catalog])
    # Text is defined in reference_map with no child props
    fields = parser._get_child_fields_for_obj(
        {"component": "Text", "id": "t1", "text": "Click me", "label": "Submit"}
    )
    assert fields == set()

    # Unmapped/custom component falls back to is_v0_8_heuristic_child_prop_key
    unmapped_fields = parser._get_child_fields_for_obj({
        "component": "CustomCard",
        "id": "c1",
        "child": "inner1",
        "children": ["inner2"],
        "label": "Click me",
    })
    assert "child" in unmapped_fields
    assert "children" in unmapped_fields
    assert "label" not in unmapped_fields


def test_direct_json_prompt_describes_every_catalog():
    catalogs = [
        Catalog.from_json(
            {"catalogId": catalog_id, "components": {}}, protocol_version="0.9"
        )
        for catalog_id in ("a", "b")
    ]
    direct_json_format = DirectJsonFormat(catalogs)

    prompt = direct_json_format.prompt_generator.generate("Role", include_schema=True)

    assert '"catalogId":"a"' in prompt
    assert '"catalogId":"b"' in prompt
    assert direct_json_format.catalogs == tuple(catalogs)
    assert direct_json_format.parser.catalogs == tuple(catalogs)
    assert direct_json_format.create_stream_parser().catalogs == tuple(catalogs)


def test_direct_json_format_passes_all_catalogs_to_v1_0_parsers():
    catalogs = [
        Catalog.from_json(
            {"catalogId": catalog_id, "components": {}}, protocol_version="1.0"
        )
        for catalog_id in ("a", "b")
    ]
    direct_json_format = DirectJsonFormat(catalogs)

    assert direct_json_format.catalogs == tuple(catalogs)
    assert direct_json_format.parser.catalogs == tuple(catalogs)
    assert direct_json_format.create_stream_parser().catalogs == tuple(catalogs)


_CUT_TEXT_CHUNK = (
    '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "s1",'
    ' "catalogId": "%s"}}, {"version": "v0.9", "updateComponents": {"surfaceId":'
    ' "s1", "components": [{"id": "root", "component": "Text", "text": "Hel'
)


@pytest.mark.parametrize("parser_name", ["create_stream_parser", "parser"])
@pytest.mark.parametrize(
    ("progressive_keys", "healed"),
    [(DEFAULT_PROGRESSIVE_KEYS, True), (frozenset(), False)],
    ids=["default", "healing_off"],
)
def test_direct_json_format_progressive_keys_reach_its_parsers(
    progressive_keys, healed, parser_name
):
    catalog = BasicCatalog("0.9")
    direct_json_format = DirectJsonFormat([catalog], progressive_keys=progressive_keys)
    parser = (
        direct_json_format.create_stream_parser()
        if parser_name == "create_stream_parser"
        else direct_json_format.parser
    )

    parts = parser.process_chunk(_CUT_TEXT_CHUNK % catalog.catalog_id)

    messages = [message for part in parts for message in part.a2ui_json or []]
    assert any("updateComponents" in message for message in messages) == healed
