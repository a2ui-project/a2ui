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

import json
from pathlib import Path

import pytest

from a2ui.core import (
    A2uiCatalogError,
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

    # Forward-compatible future wire version streaming
    future_stream = (
        VerticalFormat([basic_v10], surface_id="fut", version="v1.1")
        .create_parser()
        .open_stream()
    )
    fut_parts = future_stream.feed('<a2ui>\nText("Future v1.1")\n</a2ui>')
    assert len(fut_parts) == 1
    assert isinstance(fut_parts[0], A2uiPart)
    assert fut_parts[0].a2ui[0]["version"] == "1.1"


def test_coercion_with_standalone_eval_catalog():
    repo_root = Path(__file__).resolve().parents[3]
    catalog_path = (
        repo_root / "eval" / "catalogs" / "standalone_components" / "catalog.json"
    )
    if not catalog_path.exists():
        pytest.skip(f"Standalone catalog not found at {catalog_path}")

    cat_data = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog = Catalog.from_json(cat_data, protocol_version="0.9.1")
    fmt = VerticalFormat([catalog], surface_id="main", version="v0.9.1")

    raw = (
        '<a2ui>\nWeatherWidget(city="Seattle", temperature="58", condition="rainy",'
        ' high="62", low="50", humidity="82", unit="fahrenheit")\n</a2ui>'
    )
    msgs = to_message_dicts(fmt.create_parser().compile(raw))
    w_comp = msgs[1]["updateComponents"]["components"][0]
    assert w_comp["temperature"] == 58
    assert isinstance(w_comp["temperature"], int)
    assert w_comp["high"] == 62
    assert w_comp["low"] == 50
    assert w_comp["humidity"] == 82

    v1_catalog_path = (
        repo_root
        / "eval"
        / "catalogs"
        / "standalone_components"
        / "v1"
        / "catalog.json"
    )
    if v1_catalog_path.exists():
        v1_data = json.loads(v1_catalog_path.read_text(encoding="utf-8"))
        v1_cat = Catalog.from_json(v1_data, protocol_version="1.0")
        v1_fmt = VerticalFormat([v1_cat], surface_id="main", version="1.0")
        v1_msgs = to_message_dicts(v1_fmt.create_parser().compile(raw))
        v1_comp = v1_msgs[0]["createSurface"]["components"][0]
        assert v1_comp["temperature"] == 58
        assert isinstance(v1_comp["temperature"], int)
