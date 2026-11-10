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

"""Unit tests for the Python A2UI Vertical inference format."""

from __future__ import annotations

import pytest

from a2ui.core import (
    A2uiCatalogError,
    A2uiError,
    A2uiParseError,
    A2uiValidationError,
    Catalog,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import (
    VerticalFormat,
    VerticalFormatFactory,
    VerticalParser,
    VerticalResponseStream,
    to_message_dicts,
    to_message_models,
)
from a2ui.parser import A2uiPart, ErrorPart, TextPart
from a2ui.processor import A2uiGenerator, CatalogConfig
from a2ui.skill import SkillGenerator
from a2ui.utils import RendererState


def _make_v091_catalog() -> Catalog:
    return Catalog.from_json(
        {
            "catalogId": "https://a2ui.org/test_vertical_v091",
            "components": {
                "Column": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "Column"},
                        "children": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["component", "children"],
                },
                "Card": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "Card"},
                        "child": {"type": "string"},
                    },
                    "required": ["component", "child"],
                },
                "Text": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "Text"},
                        "text": {
                            "$ref": "common_types.json#/$defs/DynamicString",
                            "positionalIndex": 0,
                        },
                        "variant": {"type": "string", "positionalIndex": 1},
                    },
                    "required": ["component", "text"],
                },
                "Slider": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "Slider"},
                        "value": {
                            "$ref": "common_types.json#/$defs/DynamicNumber",
                            "positionalIndex": 0,
                        },
                        "step": {"type": "integer"},
                        "enabled": {"type": "boolean"},
                    },
                    "required": ["component", "value"],
                },
                "ActionChip": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "ActionChip"},
                        "label": {"type": "string", "positionalIndex": 0},
                        "action": {"$ref": "common_types.json#/$defs/Action"},
                    },
                    "required": ["component", "label"],
                },
            },
            "functions": {
                "openUrl": {
                    "type": "object",
                    "returnType": "void",
                    "properties": {
                        "call": {"const": "openUrl"},
                        "args": {
                            "type": "object",
                            "properties": {
                                "url": {"type": "string", "positionalIndex": 0}
                            },
                            "required": ["url"],
                        },
                    },
                    "required": ["call", "args"],
                }
            },
        },
        protocol_version="0.9.1",
    )


def _make_v10_catalog(
    catalog_id: str = "https://a2ui.org/test_vertical_v10",
) -> Catalog:
    return Catalog.from_json(
        {
            "catalogId": catalog_id,
            "protocolVersion": "1.0",
            "components": {
                "Text": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "Text"},
                        "text": {
                            "$ref": "common_types.json#/$defs/DynamicString",
                            "positionalIndex": 0,
                        },
                        "variant": {"type": "string", "positionalIndex": 1},
                    },
                    "required": ["component", "text"],
                },
                "ActionChip": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "ActionChip"},
                        "label": {"type": "string", "positionalIndex": 0},
                        "action": {"$ref": "common_types.json#/$defs/Action"},
                    },
                    "required": ["component", "label"],
                },
                "ConfigCard": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "ConfigCard"},
                        "config": {"type": "object"},
                    },
                    "required": ["component", "config"],
                },
                "ValidatedInput": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "ValidatedInput"},
                        "label": {"type": "string", "positionalIndex": 0},
                        "value": {"$ref": "common_types.json#/$defs/DataBinding"},
                        "checks": {
                            "type": "array",
                            "items": {"$ref": "common_types.json#/$defs/CheckRule"},
                        },
                    },
                    "required": ["component", "label"],
                },
            },
            "functions": {
                "openUrl": {
                    "type": "object",
                    "returnType": "void",
                    "allowedCallers": "rendererOrAgent",
                    "properties": {
                        "@call": {"const": "openUrl"},
                        "args": {
                            "type": "object",
                            "properties": {
                                "url": {"type": "string", "positionalIndex": 0}
                            },
                            "required": ["url"],
                        },
                    },
                    "required": ["@call", "args"],
                },
                "rendererOnlyHelper": {
                    "type": "object",
                    "returnType": "string",
                    "allowedCallers": "rendererOnly",
                    "properties": {
                        "@call": {"const": "rendererOnlyHelper"},
                        "args": {"type": "object", "properties": {}},
                    },
                    "required": ["@call"],
                },
                "required": {
                    "type": "object",
                    "returnType": "validationResult",
                    "properties": {
                        "@call": {"const": "required"},
                        "args": {
                            "type": "object",
                            "properties": {"value": {}},
                            "required": ["value"],
                        },
                    },
                    "required": ["@call", "args"],
                },
            },
        },
        protocol_version="1.0",
    )


def test_format_requires_catalog():
    with pytest.raises(A2uiCatalogError):
        VerticalFormat([])


def test_v091_compile_decompile_and_coercion():
    cat = _make_v091_catalog()
    fmt = VerticalFormat([cat], surface_id="main")
    assert fmt.version == "v0.9.1"
    assert fmt.supports_streaming is True

    parser = fmt.create_parser()
    assert isinstance(parser, VerticalParser)
    assert parser.supports_streaming is True
    assert fmt.create_parser() is not parser

    compiled = to_message_dicts(
        parser.compile('Slider("42.5", step="5", enabled="true")\nText($/user/name)')
    )
    assert len(compiled) == 4
    assert compiled[0] == {
        "version": "v0.9.1",
        "createSurface": {
            "surfaceId": "main",
            "catalogId": "https://a2ui.org/test_vertical_v091",
        },
    }
    assert compiled[1]["updateComponents"]["components"][0] == {
        "id": "root",
        "component": "Slider",
        "value": 42.5,
        "step": 5,
        "enabled": True,
    }
    assert compiled[2]["createSurface"]["surfaceId"] == "main_1"
    assert compiled[3]["updateComponents"]["components"][0]["text"] == {
        "path": "/user/name"
    }

    dsl = parser.decompile(to_message_models(compiled))
    assert "Slider(" in dsl
    assert "$/user/name" in dsl
    assert to_message_dicts(parser.compile(dsl)) == compiled


def test_v10_unified_create_surface_and_literal_maps():
    cat = _make_v10_catalog()
    fmt = VerticalFormat([cat], surface_id="card")
    assert fmt.version == "1.0"
    parser = fmt.create_parser()

    compiled = to_message_dicts(
        parser.compile(
            "Text($/user/title)\n"
            'ConfigCard(config={path: "/literal/route", call: "webhook"})'
        )
    )
    assert len(compiled) == 2
    assert compiled[0] == {
        "version": "1.0",
        "createSurface": {
            "surfaceId": "card",
            "catalogId": "https://a2ui.org/test_vertical_v10",
            "components": [{
                "id": "root",
                "component": "Text",
                "text": {"@path": "/user/title"},
            }],
        },
    }
    # Plain `path` and `call` keys in a v1.0 literal map are preserved as literal strings
    assert compiled[1]["createSurface"]["components"][0]["config"] == {
        "path": "/literal/route",
        "call": "webhook",
    }

    dsl = parser.decompile(to_message_models(compiled))
    assert 'path: "/literal/route"' in dsl or '"path": "/literal/route"' in dsl
    assert "$/literal/route" not in dsl
    assert to_message_dicts(parser.compile(dsl)) == compiled


def test_event_user_message_and_function_call_actions():
    cat_v10 = _make_v10_catalog()
    parser_v10 = VerticalFormat([cat_v10], surface_id="main").create_parser()

    msgs = to_message_dicts(
        parser_v10.compile(
            'ActionChip("Save", action=Event("save", item=$/id, userMessage="Saved'
            ' item"))\nActionChip("Docs", action=openUrl("https://a2ui.org"))'
        )
    )
    assert msgs[0]["createSurface"]["components"][0]["action"] == {
        "event": {
            "name": "save",
            "userMessage": "Saved item",
            "context": {"item": {"@path": "/id"}},
        }
    }
    assert msgs[1]["createSurface"]["components"][0]["action"] == {
        "functionCall": {
            "@call": "openUrl",
            "args": {"url": "https://a2ui.org"},
        }
    }
    decompiled = parser_v10.decompile(to_message_models(msgs))
    assert 'userMessage="Saved item"' in decompiled
    assert (
        'openUrl("https://a2ui.org")' in decompiled
        or 'openUrl(url="https://a2ui.org")' in decompiled
    )
    assert to_message_dicts(parser_v10.compile(decompiled)) == msgs

    # Pre-v1.0 rejects Event userMessage
    cat_v091 = _make_v091_catalog()
    parser_v091 = VerticalFormat([cat_v091], surface_id="main").create_parser()
    with pytest.raises(A2uiValidationError, match="userMessage"):
        parser_v091.compile(
            'ActionChip("Save", action=Event("save", userMessage="Not allowed in'
            ' v0.9.1"))'
        )


def test_multi_catalog_v10_resolution_and_pre_v10_rejection():
    cat_a = _make_v10_catalog("https://a2ui.org/cat_a")
    cat_b = Catalog.from_json(
        {
            "catalogId": "https://a2ui.org/cat_b",
            "protocolVersion": "1.0",
            "components": {
                "Text": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "Text"},
                        "text": {"type": "string", "positionalIndex": 0},
                    },
                    "required": ["component", "text"],
                },
                "MetricTile": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "MetricTile"},
                        "score": {"type": "number", "positionalIndex": 0},
                    },
                    "required": ["component", "score"],
                },
            },
        },
        protocol_version="1.0",
    )

    parser = VerticalFormat([cat_a, cat_b], surface_id="s").create_parser()

    # Ambiguous component without catalogId raises A2uiValidationError
    with pytest.raises(A2uiValidationError, match="disambiguate"):
        parser.compile('Text("Which catalog?")')

    # Unambiguous + explicitly disambiguated components compile cleanly
    msgs = to_message_dicts(
        parser.compile(
            'MetricTile(98)\nText("Disambiguated", catalogId="https://a2ui.org/cat_b")'
        )
    )
    assert "catalogId" not in msgs[0]["createSurface"]
    assert msgs[0]["createSurface"]["components"][0] == {
        "id": "root",
        "component": "MetricTile",
        "catalogId": "https://a2ui.org/cat_b",
        "score": 98,
    }
    assert msgs[1]["createSurface"]["components"][0] == {
        "id": "root",
        "component": "Text",
        "catalogId": "https://a2ui.org/cat_b",
        "text": "Disambiguated",
    }

    dsl = parser.decompile(to_message_models(msgs))
    assert "MetricTile(98)" in dsl or "MetricTile(score=98)" in dsl
    assert 'catalogId="https://a2ui.org/cat_b"' in dsl

    # Multiple catalogs before v1.0 raise A2uiCatalogError
    cat_old_1 = _make_v091_catalog()
    cat_old_2 = Catalog.from_json(
        {"catalogId": "https://a2ui.org/other_v091", "components": {}},
        protocol_version="0.9.1",
    )
    with pytest.raises(A2uiCatalogError, match="Several catalogs need A2UI v1.0"):
        VerticalFormat([cat_old_1, cat_old_2])


def test_extensions_and_system_functions_validation():
    cat_v10 = _make_v10_catalog()
    parser_v10 = VerticalFormat([cat_v10], surface_id="main").create_parser()

    msgs = to_message_dicts(
        parser_v10.compile('Text("Hello", extensions={vendor_tag: "featured"})')
    )
    assert msgs[0]["createSurface"]["components"][0]["metadata"] == {
        "extensions": {"vendor_tag": "featured"}
    }

    # Non-UAX #31 extension keys are rejected
    with pytest.raises(A2uiValidationError, match="UAX #31"):
        parser_v10.compile('Text("Hello", extensions={"invalid-hyphen": 1})')

    # System functions (@index) require list templates and are rejected in Vertical
    with pytest.raises(A2uiValidationError, match="@index"):
        parser_v10.compile("Text(@index())")

    # Pre-v1.0 rejects extensions=
    parser_v091 = VerticalFormat(
        [_make_v091_catalog()], surface_id="main"
    ).create_parser()
    with pytest.raises(A2uiValidationError, match="extensions"):
        parser_v091.compile('Text("Hello", extensions={vendor_tag: "featured"})')


def test_checks_and_standalone_call_renderer_function():
    cat_v10 = _make_v10_catalog()
    parser_v10 = VerticalFormat([cat_v10], surface_id="main").create_parser()

    msgs = to_message_dicts(
        parser_v10.compile(
            'ValidatedInput("Name", value=$/form/name, checks=[?required("Name is'
            ' required")])\nopenUrl("https://a2ui.org")'
        )
    )
    assert msgs[0]["createSurface"]["components"][0]["checks"] == [{
        "condition": {
            "@call": "required",
            "args": {"value": {"@path": "/form/name"}},
        },
        "message": "Name is required",
    }]
    assert msgs[1] == {
        "version": "1.0",
        "callRendererFunction": {
            "functionCallId": "call_1",
            "callFunction": {
                "catalogId": "https://a2ui.org/test_vertical_v10",
                "@call": "openUrl",
                "args": {"url": "https://a2ui.org"},
            },
        },
    }

    # Non-checkable component rejects ?check
    with pytest.raises(A2uiValidationError, match="checks"):
        parser_v10.compile('Text("Hello", ?required)')

    # Standalone call to rendererOnly function fails parse_response / RendererState validation
    with pytest.raises(A2uiValidationError):
        parser_v10.parse_response("<a2ui>\nrendererOnlyHelper()\n</a2ui>")


def test_streaming_incremental_and_error_recovery():
    cat_v10 = _make_v10_catalog()
    parser = VerticalFormat([cat_v10], surface_id="stream").create_parser()
    stream = parser.open_stream()
    assert isinstance(stream, VerticalResponseStream)

    p1 = stream.feed('Intro\n<a2ui>\nText("Card ')
    assert len(p1) == 1
    assert isinstance(p1[0], TextPart)
    assert p1[0].text == "Intro"
    assert stream.is_in_block is True

    p2 = stream.feed('One")\nText("Card Two")\n</a2ui>\nOutro')
    assert stream.is_in_block is False
    a2ui_parts = [p for p in p2 if isinstance(p, A2uiPart)]
    assert len(a2ui_parts) == 2
    assert "stream" in stream.state.surface_ids
    assert "stream_1" in stream.state.surface_ids
    assert stream.close() == []

    # Verify after_rejected_block="continue" yields ErrorPart and continues
    cont_stream = parser.open_stream(after_rejected_block="continue")
    parts = cont_stream.feed(
        '<a2ui>\nrendererOnlyHelper()\n</a2ui>\n<a2ui>\nText("Recovered")\n</a2ui>'
    )
    assert any(isinstance(p, ErrorPart) for p in parts)
    assert any(isinstance(p, A2uiPart) for p in parts)
    assert cont_stream.close() == []

    # Verify partial_results preserved when after_rejected_block="end" raises
    end_stream = parser.open_stream(after_rejected_block="end")
    with pytest.raises(A2uiValidationError) as exc_info:
        end_stream.feed(
            'Before error\n<a2ui>\nText("Valid first")\nrendererOnlyHelper()\n</a2ui>'
        )
    assert len(exc_info.value.partial_results) == 2
    assert isinstance(exc_info.value.partial_results[0], TextPart)
    assert isinstance(exc_info.value.partial_results[1], A2uiPart)

    # Unclosed block on close raises A2uiParseError
    unclosed = parser.open_stream()
    unclosed.feed('<a2ui>\nText("Unclosed')
    with pytest.raises(A2uiParseError):
        unclosed.close()


def test_prompt_generator_skill_and_processor_integration():
    basic_v10 = BasicCatalog("1.0")
    fmt = VerticalFormat([basic_v10], surface_id="main")
    prompt = fmt.prompt_generator.generate()
    assert "# A2UI Vertical Output Contract" in prompt
    assert "## Component Signatures" in prompt
    # Container components requiring child/children are excluded from Vertical prompt
    assert "Column(" not in prompt
    assert "Card(" not in prompt
    assert "Text(" in prompt

    # SkillGenerator integration
    skill = SkillGenerator(fmt).generate_skill()
    assert "# A2UI Vertical Output Contract" in skill.content

    # A2uiGenerator + VerticalFormatFactory integration
    example_turn = to_message_models([{
        "version": "1.0",
        "createSurface": {
            "surfaceId": "ex_1",
            "catalogId": basic_v10.catalog_id,
            "components": [{"id": "root", "component": "Text", "text": "Example UI"}],
        },
    }])
    gen = A2uiGenerator(
        catalogs=[CatalogConfig(basic_v10)],
        examples=[example_turn],
        inference_format_factory=VerticalFormatFactory(surface_id="proc_surface"),
    )
    proc = gen.create_processor(
        {"1.0": {"supportedCatalogIds": [basic_v10.catalog_id]}}
    )
    assert "A2UI Vertical" in proc.prompt_snippet
    assert "Example UI" in proc.prompt_snippet
    parsed = proc.parse_response('<a2ui>\nText("Processor works")\n</a2ui>')
    assert len(parsed) == 1
    assert isinstance(parsed[0], A2uiPart)
    dumped = to_message_dicts(parsed[0].a2ui)
    assert dumped[0]["createSurface"]["surfaceId"] == "proc_surface"

    # Unsupported wire versions are rejected up front
    with pytest.raises(A2uiCatalogError):
        VerticalFormat([basic_v10], surface_id="old", version="v0.8")
    with pytest.raises(A2uiCatalogError):
        VerticalFormat([basic_v10], surface_id="fut", version="1.1")

    # BasicCatalog("1.0") instructions should not leak raw Column/Card JSON blocks
    assert '"component": "Column"' not in prompt
    assert '"component": "Card"' not in prompt
    assert "weight" not in prompt

    # Sequential numbering when only callRendererFunction is allowed
    fn_only_fmt = VerticalFormat(
        [_make_v10_catalog()],
        allowed_messages=["callRendererFunction"],
        surface_id="main",
    )
    fn_prompt = fn_only_fmt.prompt_generator.generate()
    assert "1. Standalone Renderer Function Calls:" in fn_prompt
    assert "6. Standalone Renderer Function Calls:" not in fn_prompt


def test_coercion_with_standalone_widget_catalog():
    weather_props = {
        "component": {"const": "WeatherWidget"},
        "city": {"type": "string"},
        "temperature": {"type": "integer"},
        "condition": {"type": "string"},
        "high": {"type": "integer"},
        "low": {"type": "integer"},
        "humidity": {"type": "integer"},
        "unit": {"type": "string"},
    }
    cat_v091 = Catalog.from_json(
        {
            "catalogId": "https://example.com/catalogs/weather_v091",
            "components": {
                "WeatherWidget": {
                    "type": "object",
                    "properties": weather_props,
                    "required": ["component", "city", "temperature"],
                }
            },
            "$defs": {
                "anyComponent": {"oneOf": [{"$ref": "#/components/WeatherWidget"}]}
            },
        },
        protocol_version="0.9.1",
    )
    fmt_v091 = VerticalFormat([cat_v091], surface_id="main", version="v0.9.1")
    raw = (
        '<a2ui>\nWeatherWidget(city="Seattle", temperature="58", condition="rainy",'
        ' high="62", low="50", humidity="82", unit="fahrenheit")\n</a2ui>'
    )
    msgs = to_message_dicts(fmt_v091.create_parser().compile(raw))
    w_comp = msgs[1]["updateComponents"]["components"][0]
    assert w_comp["temperature"] == 58
    assert isinstance(w_comp["temperature"], int)
    assert w_comp["high"] == 62
    assert w_comp["low"] == 50
    assert w_comp["humidity"] == 82

    cat_v10 = Catalog.from_json(
        {
            "catalogId": "https://example.com/catalogs/weather_v10",
            "protocolVersion": "1.0",
            "components": {
                "WeatherWidget": {
                    "type": "object",
                    "properties": weather_props,
                    "required": ["component", "city", "temperature"],
                }
            },
            "$defs": {
                "anyComponent": {"oneOf": [{"$ref": "#/components/WeatherWidget"}]}
            },
        },
        protocol_version="1.0",
    )
    v1_fmt = VerticalFormat([cat_v10], surface_id="main", version="1.0")
    v1_msgs = to_message_dicts(v1_fmt.create_parser().compile(raw))
    v1_comp = v1_msgs[0]["createSurface"]["components"][0]
    assert v1_comp["temperature"] == 58
    assert isinstance(v1_comp["temperature"], int)

    # Non-integral string is NOT truncated to int and fails validation cleanly
    bad_parser = v1_fmt.create_parser()
    with pytest.raises(A2uiValidationError):
        bad_parser.parse_response(
            '<a2ui>\nWeatherWidget(city="Seattle", temperature="58.9")\n</a2ui>'
        )
    with pytest.raises(A2uiError):
        bad_parser.compile('WeatherWidget(city="Seattle", temperature="1e999")')


def test_multi_block_multi_turn_and_continued_stream_ids():
    cat_v10 = _make_v10_catalog()
    parser = VerticalFormat([cat_v10], surface_id="main").create_parser()
    state = RendererState([cat_v10])

    # Turn 1: two <a2ui> blocks with both components and standalone calls
    turn1 = parser.parse_response(
        'First:\n<a2ui>\nText("A")\nopenUrl("https://example.com/1")\n</a2ui>\n'
        'Second:\n<a2ui>\nText("B")\nopenUrl("https://example.com/2")\n</a2ui>',
        state=state,
    )
    a2ui_t1 = [to_message_dicts(p.a2ui) for p in turn1 if isinstance(p, A2uiPart)]
    assert len(a2ui_t1) == 2
    assert a2ui_t1[0][0]["createSurface"]["surfaceId"] == "main"
    assert a2ui_t1[0][1]["callRendererFunction"]["functionCallId"] == "call_1"
    assert a2ui_t1[1][0]["createSurface"]["surfaceId"] == "main_1"
    assert a2ui_t1[1][1]["callRendererFunction"]["functionCallId"] == "call_2"

    # Turn 2 on the same persistent RendererState advances to main_2 and call_3
    turn2 = parser.parse_response(
        '<a2ui>\nText("C")\nopenUrl("https://example.com/3")\n</a2ui>',
        state=state,
    )
    a2ui_t2 = [to_message_dicts(p.a2ui) for p in turn2 if isinstance(p, A2uiPart)]
    assert a2ui_t2[0][0]["createSurface"]["surfaceId"] == "main_2"
    assert a2ui_t2[0][1]["callRendererFunction"]["functionCallId"] == "call_3"

    # Streaming after_rejected_block="continue" after partial emission in block 1
    stream = parser.open_stream(after_rejected_block="continue")
    parts = stream.feed(
        '<a2ui>\nText("Before failure")\nrendererOnlyHelper()\n</a2ui>\n'
        '<a2ui>\nText("After recovery")\n</a2ui>'
    )
    emitted_surfaces = [
        to_message_dicts(p.a2ui)[0]["createSurface"]["surfaceId"]
        for p in parts
        if isinstance(p, A2uiPart)
    ]
    assert emitted_surfaces == ["main", "main_1"]
    assert any(isinstance(p, ErrorPart) for p in parts)
    assert stream.close() == []


def test_comments_string_fences_and_catalog_agnostic_properties():
    domain_cat = Catalog.from_json(
        {
            "catalogId": "https://example.com/catalogs/domain",
            "protocolVersion": "1.0",
            "components": {
                "BookingCard": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "BookingCard"},
                        "action": {"type": "string"},
                        "onClick": {"type": "string"},
                        "children": {"type": "integer"},
                        "color": {"type": "string"},
                        "url": {"type": "string"},
                        "notes": {"type": "string"},
                    },
                    "required": ["component"],
                },
                "CodeInput": {
                    "type": "object",
                    "properties": {
                        "component": {"const": "CodeInput"},
                        "value": {"$ref": "common_types.json#/$defs/DynamicString"},
                        "checks": {
                            "type": "array",
                            "items": {"$ref": "common_types.json#/$defs/CheckRule"},
                        },
                    },
                    "required": ["component", "value"],
                },
            },
            "functions": {
                "length": {
                    "type": "object",
                    "properties": {
                        "@call": {"const": "length"},
                        "args": {
                            "type": "object",
                            "properties": {
                                "value": {
                                    "$ref": "common_types.json#/$defs/DynamicString"
                                },
                                "min": {"type": "integer"},
                                "max": {"type": "integer"},
                            },
                            "required": ["value"],
                            "additionalProperties": False,
                        },
                        "returnType": {"const": "validationResult"},
                    },
                    "required": ["@call", "args"],
                }
            },
            "$defs": {
                "anyComponent": {
                    "oneOf": [
                        {"$ref": "#/components/BookingCard"},
                        {"$ref": "#/components/CodeInput"},
                    ]
                }
            },
        },
        protocol_version="1.0",
    )
    parser = VerticalFormat([domain_cat], surface_id="main").create_parser()

    # Non-Action 'action'/'onClick' strings and integer 'children' stay literal
    msgs = to_message_dicts(
        parser.compile(
            "BookingCard(\n"
            '  action="checkout", # inline comment\n'
            '  /* block: comment */ onClick="track_click",\n'
            "  children=2,\n"
            "  color=#ff00aa,\n"
            "  url=https://example.com/book,\n"
            '  notes="""Code:\n```py\nx = 1\n```\n"""\n'
            ")"
        )
    )
    comp = msgs[0]["createSurface"]["components"][0]
    assert comp["action"] == "checkout"
    assert comp["onClick"] == "track_click"
    assert comp["children"] == 2
    assert comp["color"] == "#ff00aa"
    assert comp["url"] == "https://example.com/book"
    assert "```py\nx = 1\n```" in comp["notes"]

    # Round-trip decompile preserves non-child 'children' and non-action strings
    decompiled = parser.decompile(msgs)
    recompiled = to_message_dicts(parser.compile(decompiled))
    assert recompiled[0]["createSurface"]["components"][0] == comp

    # Same-line statements split identically in compile() and open_stream()
    same_line_msgs = to_message_dicts(
        parser.compile('BookingCard(action="one") BookingCard(action="two")')
    )
    assert len(same_line_msgs) == 2
    assert same_line_msgs[0]["createSurface"]["surfaceId"] == "main"
    assert same_line_msgs[1]["createSurface"]["surfaceId"] == "main_1"

    # Optional numeric check parameter with trailing custom message
    chk_msgs = to_message_dicts(
        parser.compile('CodeInput(value=$/code, checks=[?length(5, "Too short")])')
    )
    chk = chk_msgs[0]["createSurface"]["components"][0]["checks"][0]
    assert chk["condition"]["args"] == {
        "value": {"@path": "/code"},
        "min": 5,
    }
    assert chk["message"] == "Too short"

    # Missing value binding on check raises ValidationError
    with pytest.raises(A2uiValidationError):
        parser.compile('CodeInput(value="literal", checks=[?length(5, "Too short")])')

    # Outer markdown code fence and inline backtick stripping in streaming
    stream = parser.open_stream()
    stream_parts = stream.feed(
        '```a2ui\n<a2ui>`BookingCard(action="fenced")`</a2ui>\n```'
    )
    stream_parts.extend(stream.close())
    a2ui_stream = [p for p in stream_parts if isinstance(p, A2uiPart)]
    text_stream = [p for p in stream_parts if isinstance(p, TextPart)]
    assert len(a2ui_stream) == 1
    assert text_stream == []
