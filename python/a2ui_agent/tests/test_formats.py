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
    from a2ui.processor import CatalogConfig, InMemoryCatalogProvider

    config = CatalogConfig(
        InMemoryCatalogProvider(
            test_catalog.catalog_schema, protocol_version=VERSION_0_9
        ).load()
    )
    catalogs = resolve_catalogs(
        [config],
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
    assert parsed[0].a2ui is not None


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
        '  "createSurface": {\n'
        '    "surfaceId": "main",\n'
        '    "catalogId": "https://a2ui.org/test_catalog"\n'
        "  }\n"
        "}, {\n"
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
    assert parsed[0].a2ui is not None
    dump = parsed[0].a2ui[1].model_dump(by_alias=True, exclude_none=True)
    assert dump["updateComponents"]["components"][0]["text"] == (
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
    from a2ui.processor import CatalogConfig, InMemoryCatalogProvider

    config = CatalogConfig(
        InMemoryCatalogProvider(
            test_catalog.catalog_schema, protocol_version=VERSION_0_9
        ).load()
    )

    # 1. DirectJsonFormat parser supports streaming
    direct_json_fmt = DirectJsonFormat([config.transformed_catalog])
    assert direct_json_fmt.supports_streaming is True
    assert direct_json_fmt.create_parser().supports_streaming is True

    # 2. ExpressFormat parser does not support streaming
    express_fmt = ExpressFormat([test_catalog])
    assert express_fmt.supports_streaming is False
    assert express_fmt.create_parser().supports_streaming is False

    # 3. ElementalFormat parser does not support streaming
    elemental_fmt = ElementalFormat([test_catalog])
    assert elemental_fmt.supports_streaming is False
    assert elemental_fmt.create_parser().supports_streaming is False


def test_process_chunk_raises_not_implemented(test_catalog):
    express_parser = ExpressParser([test_catalog])
    with pytest.raises(NotImplementedError) as exc_info:
        express_parser.parse_chunk("chunk")
    assert "Streaming is not supported by ExpressParser" in str(exc_info.value)

    elemental_parser = ElementalParser([test_catalog])
    with pytest.raises(NotImplementedError) as exc_info:
        elemental_parser.parse_chunk("chunk")
    assert "Streaming is not supported by ElementalParser" in str(exc_info.value)


def test_decompiler_delegation(test_catalog):
    from a2ui.inference_formats._shared import to_message_models
    from a2ui.processor import CatalogConfig

    config = CatalogConfig(test_catalog)
    # Verify Direct JSON Parser Decompile
    direct_json_fmt = DirectJsonFormat([config.transformed_catalog])
    payload = {
        "version": "v0.9",
        "createSurface": {
            "surfaceId": "main",
            "catalogId": "https://a2ui.org/test_catalog",
        },
    }
    direct_decompile = direct_json_fmt.create_parser().decompile(
        to_message_models([payload])
    )
    assert "createSurface" in direct_decompile
    assert "main" in direct_decompile

    # Verify Express Parser Decompile
    express_fmt = ExpressFormat([test_catalog])
    expr_parser = express_fmt.create_parser()
    envelopes = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "main",
                "catalogId": "https://a2ui.org/test_catalog",
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "main",
                "components": [{
                    "id": "root",
                    "component": "Text",
                    "text": "Hello World",
                }],
            },
        },
    ]
    decompiled_dsl = expr_parser.decompile(to_message_models(envelopes))
    assert 'root = Text("Hello World")' in decompiled_dsl

    # Verify wrap_decompiled_blocks implementation
    assert (
        direct_json_fmt.create_parser().wrap_decompiled_blocks(["{}", "{}"])
        == "<a2ui-json>\n{}\n{}\n</a2ui-json>"
    )
    assert (
        expr_parser.wrap_decompiled_blocks(["a = 1", "b = 2"])
        == "<a2ui>\na = 1\nb = 2\n</a2ui>"
    )

    # Verify abstract PromptGenerator generate pass
    from a2ui.prompt import PromptGenerator

    class DummyPromptGenerator(PromptGenerator):

        def generate(self, *args, **kwargs):
            return super().generate(*args, **kwargs)

    assert DummyPromptGenerator().generate("role") == "role"

    # Verify invalid catalog_id check
    from a2ui.core import A2uiCatalogError
    from a2ui.processor import InMemoryCatalogProvider

    with pytest.raises(A2uiCatalogError) as ctx:
        _ = InMemoryCatalogProvider({"catalogId": 12345}, protocol_version="1.0").load()
    assert "not a non-empty string" in str(ctx.value)

    # An empty allowlist keeps nothing. Keeping everything means not pruning.
    from a2ui.catalog_transformers import ComponentPruningTransformer
    from a2ui.utils import prune_messages_schema

    assert not ComponentPruningTransformer([]).transform(test_catalog).components
    assert prune_messages_schema({}, "0.9", []) == {}


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
    assert direct_json_format.catalogs == list(catalogs)
    assert direct_json_format.create_parser().catalogs == list(catalogs)


def test_direct_json_format_passes_all_catalogs_to_v1_0_parsers():
    catalogs = [
        Catalog.from_json(
            {"catalogId": catalog_id, "components": {}}, protocol_version="1.0"
        )
        for catalog_id in ("a", "b")
    ]
    direct_json_format = DirectJsonFormat(catalogs)

    assert direct_json_format.catalogs == list(catalogs)
    assert direct_json_format.create_parser().catalogs == list(catalogs)


_CUT_TEXT_CHUNK = (
    '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "s1",'
    ' "catalogId": "%s"}}, {"version": "v0.9", "updateComponents": {"surfaceId":'
    ' "s1", "components": [{"id": "root", "component": "Text", "text": "Hel'
)


@pytest.mark.parametrize(
    ("progressive_keys", "healed"),
    [(DEFAULT_PROGRESSIVE_KEYS, True), (frozenset(), False)],
    ids=["default", "healing_off"],
)
def test_direct_json_format_progressive_keys_reach_its_parsers(
    progressive_keys, healed
):
    catalog = BasicCatalog("0.9")
    direct_json_format = DirectJsonFormat([catalog], progressive_keys=progressive_keys)
    parser = direct_json_format.create_parser()

    parts = parser.parse_chunk(_CUT_TEXT_CHUNK % catalog.catalog_id)

    messages = [
        message.model_dump(by_alias=True, exclude_none=True)
        for part in parts
        for message in part.a2ui or []
    ]
    assert any("updateComponents" in message for message in messages) == healed
