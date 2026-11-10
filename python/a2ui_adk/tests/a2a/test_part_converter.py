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

"""Tests for the A2uiPartConverter class."""

import json
from unittest.mock import patch

from a2a import types as a2a_types
from google.genai import types as genai_types

from a2ui.a2a import create_a2ui_part
from a2ui.adk import SendA2uiToClientToolset
from a2ui.adk.a2a import A2uiPartConverter
from a2ui.constants import A2UI_CLOSE_TAG, A2UI_OPEN_TAG
from a2ui.core import CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
from a2ui.processor import A2uiRequestProcessor
from a2ui.utils import RendererState


# A v0.8 response must begin rendering the surfaces it updates. The renderer
# buffers the updates that arrive before `beginRendering`.
_BEGIN_MAIN = {"beginRendering": {"surfaceId": "main", "root": "t"}}


def _converter(
    catalog: CatalogApi | None = None,
    *,
    state: RendererState | None = None,
    fallback_text: str | None = None,
) -> A2uiPartConverter:
    """A converter for one catalog, reading the Direct JSON these tests write."""
    processor = A2uiRequestProcessor(
        [catalog if catalog is not None else BasicCatalog(ProtocolVersion.V0_9)],
        format_factory=DirectJsonFormatFactory(),
        state=state,
    )
    return A2uiPartConverter(processor, fallback_text=fallback_text)


def test_converter_class_convert_valid_tool_response():
    converter = _converter()

    valid_a2ui = {"type": "Text", "text": "Hello"}
    function_response = genai_types.FunctionResponse(
        name=SendA2uiToClientToolset._SendA2uiJsonToClientTool.TOOL_NAME,
        response={
            SendA2uiToClientToolset._SendA2uiJsonToClientTool.VALIDATED_A2UI_JSON_KEY: [
                valid_a2ui
            ]
        },
    )
    part = genai_types.Part(function_response=function_response)

    a2a_parts = converter.convert(part)
    assert len(a2a_parts) == 1
    assert a2a_parts[0] == create_a2ui_part(valid_a2ui, version=ProtocolVersion.V0_9)


def test_converter_class_convert_valid_tool_response_v0_9_1():
    converter = _converter(BasicCatalog(ProtocolVersion.V0_9_1))

    valid_a2ui = {
        "version": "v0.9.1",
        "createSurface": {"surfaceId": "main", "catalogId": "c"},
    }
    function_response = genai_types.FunctionResponse(
        name=SendA2uiToClientToolset._SendA2uiJsonToClientTool.TOOL_NAME,
        response={
            SendA2uiToClientToolset._SendA2uiJsonToClientTool.VALIDATED_A2UI_JSON_KEY: [
                valid_a2ui
            ]
        },
    )
    part = genai_types.Part(function_response=function_response)

    a2a_parts = converter.convert(part)
    assert len(a2a_parts) == 1
    assert a2a_parts[0] == create_a2ui_part(valid_a2ui, version=ProtocolVersion.V0_9_1)


def test_converter_class_convert_tool_error_response(caplog):
    converter = _converter()

    function_response = genai_types.FunctionResponse(
        name=SendA2uiToClientToolset._SendA2uiJsonToClientTool.TOOL_NAME,
        response={
            SendA2uiToClientToolset._SendA2uiJsonToClientTool.TOOL_ERROR_KEY: (
                "Some error quoting the payload"
            )
        },
    )
    part = genai_types.Part(function_response=function_response)

    with caplog.at_level("WARNING"):
        a2a_parts = converter.convert(part)
    assert len(a2a_parts) == 0
    assert "A2UI tool call failed" in caplog.text
    assert "quoting the payload" not in caplog.text


def test_converter_class_convert_tool_response_no_result():
    converter = _converter()

    function_response = genai_types.FunctionResponse(
        name=SendA2uiToClientToolset._SendA2uiJsonToClientTool.TOOL_NAME,
        response={},
    )
    part = genai_types.Part(function_response=function_response)

    a2a_parts = converter.convert(part)
    assert len(a2a_parts) == 0


def test_converter_class_convert_function_call_ignores():
    converter = _converter()

    function_call = genai_types.FunctionCall(
        name=SendA2uiToClientToolset._SendA2uiJsonToClientTool.TOOL_NAME,
        args={
            SendA2uiToClientToolset._SendA2uiJsonToClientTool.A2UI_PAYLOAD_ARG_NAME: (
                "{}"
            )
        },
    )
    part = genai_types.Part(function_call=function_call)

    a2a_parts = converter.convert(part)
    assert len(a2a_parts) == 0


def test_converter_class_convert_text_with_a2ui():
    converter = _converter(BasicCatalog(ProtocolVersion.V0_8))
    valid_a2ui = [
        {
            "surfaceUpdate": {
                "surfaceId": "main",
                "components": [{
                    "id": "t",
                    "component": {"Text": {"text": {"literalString": "Hello"}}},
                }],
            }
        },
        _BEGIN_MAIN,
    ]
    text = (
        f"Here is the UI:\n{A2UI_OPEN_TAG}\n{json.dumps(valid_a2ui)}\n{A2UI_CLOSE_TAG}"
    )
    part = genai_types.Part(text=text)
    a2a_parts = converter.convert(part)

    # Expect a TextPart and one A2UI DataPart per message
    assert len(a2a_parts) == 3
    assert a2a_parts[0].root.text == "Here is the UI:"
    assert a2a_parts[1] == create_a2ui_part(valid_a2ui[0], version=ProtocolVersion.V0_8)
    assert a2a_parts[-1] == create_a2ui_part(_BEGIN_MAIN, version=ProtocolVersion.V0_8)


def test_converter_class_convert_text_with_a2ui_v0_9_1():
    catalog = BasicCatalog(ProtocolVersion.V0_9_1)
    converter = _converter(catalog)
    valid_a2ui = [
        {
            "version": "v0.9.1",
            "createSurface": {
                "surfaceId": "main",
                "catalogId": catalog.catalog_id,
            },
        },
        {
            "version": "v0.9.1",
            "updateComponents": {
                "surfaceId": "main",
                "components": [{"id": "root", "component": "Text", "text": "Hello"}],
            },
        },
    ]
    text = (
        f"Here is the UI:\n{A2UI_OPEN_TAG}\n{json.dumps(valid_a2ui)}\n{A2UI_CLOSE_TAG}"
    )
    part = genai_types.Part(text=text)
    a2a_parts = converter.convert(part)

    # Expect a TextPart and one A2UI DataPart per message
    assert len(a2a_parts) == 3
    assert a2a_parts[0].root.text == "Here is the UI:"
    assert a2a_parts[1:] == [
        create_a2ui_part(message, version=ProtocolVersion.V0_9_1)
        for message in valid_a2ui
    ]


def test_converter_class_convert_text_empty_leading():
    converter = _converter(BasicCatalog(ProtocolVersion.V0_8))
    ui = [
        {
            "surfaceUpdate": {
                "surfaceId": "main",
                "components": [{
                    "id": "t",
                    "component": {"Text": {"text": {"literalString": "Top"}}},
                }],
            }
        },
        _BEGIN_MAIN,
    ]
    text = f"\n{A2UI_OPEN_TAG}\n{json.dumps(ui)}\n{A2UI_CLOSE_TAG}"
    part = genai_types.Part(text=text)
    a2a_parts = converter.convert(part)

    assert len(a2a_parts) == 2
    assert a2a_parts[0] == create_a2ui_part(ui[0], version=ProtocolVersion.V0_8)
    assert a2a_parts[-1] == create_a2ui_part(_BEGIN_MAIN, version=ProtocolVersion.V0_8)


def test_converter_class_convert_text_markdown_wrapped():
    converter = _converter(BasicCatalog(ProtocolVersion.V0_8))
    ui = [
        {
            "surfaceUpdate": {
                "surfaceId": "main",
                "components": [{
                    "id": "t",
                    "component": {
                        "Text": {"text": {"literalString": "Inside Markdown"}}
                    },
                }],
            }
        },
        _BEGIN_MAIN,
    ]
    text = f"Behold:\n{A2UI_OPEN_TAG}\n```json\n{json.dumps(ui)}\n```\n{A2UI_CLOSE_TAG}"
    part = genai_types.Part(text=text)
    a2a_parts = converter.convert(part)

    assert len(a2a_parts) == 3
    assert a2a_parts[0].root.text == "Behold:"
    assert a2a_parts[1] == create_a2ui_part(ui[0], version=ProtocolVersion.V0_8)
    assert a2a_parts[-1] == create_a2ui_part(_BEGIN_MAIN, version=ProtocolVersion.V0_8)


def test_converter_class_convert_text_with_invalid_a2ui():
    converter = _converter()

    text = f"Here is the UI:\n{A2UI_OPEN_TAG}\ninvalid_json\n{A2UI_CLOSE_TAG}"
    part = genai_types.Part(text=text)

    a2a_parts = converter.convert(part)
    assert len(a2a_parts) == 0


def test_converter_class_convert_text_with_a2ui_that_fails_validation():
    custom_fallback = "Could not build interface."
    converter = _converter(
        BasicCatalog(ProtocolVersion.V0_8), fallback_text=custom_fallback
    )
    ui = [{
        "surfaceUpdate": {
            "surfaceId": "main",
            "components": [{"id": "t", "component": {"Unknown": {}}}],
        }
    }]
    text = f"Here is the UI:\n{A2UI_OPEN_TAG}\n{json.dumps(ui)}\n{A2UI_CLOSE_TAG}"

    a2a_parts = converter.convert(genai_types.Part(text=text))

    assert len(a2a_parts) == 1
    assert a2a_parts[0].root.text == custom_fallback


def test_converter_class_convert_other_part():
    converter = _converter()

    part = genai_types.Part(
        inline_data=genai_types.Blob(mime_type="image/png", data=b"abc")
    )

    with patch(
        "google.adk.a2a.converters.part_converter.convert_genai_part_to_a2a_part"
    ) as mock_convert:
        mock_a2a_part = a2a_types.Part(root=a2a_types.DataPart(kind="data", data={}))
        mock_convert.return_value = mock_a2a_part

        a2a_parts = converter.convert(part)
        assert len(a2a_parts) == 1
        assert a2a_parts[0] is mock_a2a_part
        mock_convert.assert_called_once_with(part)


def test_converter_class_convert_tool_response_with_result_containing_a2ui():
    converter = _converter(BasicCatalog(ProtocolVersion.V0_8))
    valid_a2ui = [
        {
            "surfaceUpdate": {
                "surfaceId": "main",
                "components": [{
                    "id": "t",
                    "component": {"Text": {"text": {"literalString": "Result UI"}}},
                }],
            }
        },
        _BEGIN_MAIN,
    ]
    result_text = (
        "Here is the"
        f" result:\n{A2UI_OPEN_TAG}\n{json.dumps(valid_a2ui)}\n{A2UI_CLOSE_TAG}"
    )
    function_response = genai_types.FunctionResponse(
        name="some_generic_tool",
        response={"result": result_text},
    )
    part = genai_types.Part(function_response=function_response)
    a2a_parts = converter.convert(part)

    # Expect a TextPart and one A2UI DataPart per message
    assert len(a2a_parts) == 3
    assert a2a_parts[0].root.text == "Here is the result:"
    assert a2a_parts[1] == create_a2ui_part(valid_a2ui[0], version=ProtocolVersion.V0_8)
    assert a2a_parts[-1] == create_a2ui_part(_BEGIN_MAIN, version=ProtocolVersion.V0_8)


def test_converter_class_convert_text_with_invalid_a2ui_and_custom_fallback():
    custom_fallback = "Could not build interface."
    converter = _converter(fallback_text=custom_fallback)

    text = f"Here is the UI:\n{A2UI_OPEN_TAG}\ninvalid_json\n{A2UI_CLOSE_TAG}"
    part = genai_types.Part(text=text)

    a2a_parts = converter.convert(part)
    assert len(a2a_parts) == 1
    assert a2a_parts[0].root.text == custom_fallback


def test_converter_class_convert_tool_response_with_result_containing_invalid_a2ui_and_default_fallback():
    converter = _converter()

    result_text = (
        f"Here is the result:\n{A2UI_OPEN_TAG}\ninvalid_json\n{A2UI_CLOSE_TAG}"
    )
    function_response = genai_types.FunctionResponse(
        name="some_generic_tool",
        response={"result": result_text},
    )
    part = genai_types.Part(function_response=function_response)

    a2a_parts = converter.convert(part)
    assert len(a2a_parts) == 0


def test_converter_class_convert_tool_response_with_result_containing_invalid_a2ui_and_custom_fallback():
    custom_fallback = "Could not load the custom tool UI."
    converter = _converter(fallback_text=custom_fallback)

    result_text = (
        f"Here is the result:\n{A2UI_OPEN_TAG}\ninvalid_json\n{A2UI_CLOSE_TAG}"
    )
    function_response = genai_types.FunctionResponse(
        name="some_generic_tool",
        response={"result": result_text},
    )
    part = genai_types.Part(function_response=function_response)

    a2a_parts = converter.convert(part)
    assert len(a2a_parts) == 1
    assert a2a_parts[0].root.text == custom_fallback


def test_converter_reads_text_in_the_processors_format():
    catalog = BasicCatalog(ProtocolVersion.V0_9)
    converter = A2uiPartConverter(A2uiRequestProcessor([catalog]))  # Express
    text = '<a2ui>\nsurface("main")\nroot = Text("Hello")\n</a2ui>'

    a2a_parts = converter.convert(genai_types.Part(text=text))

    assert a2a_parts == [
        create_a2ui_part(
            {
                "version": "v0.9",
                "createSurface": {
                    "surfaceId": "main",
                    "catalogId": catalog.catalog_id,
                },
            },
            version=ProtocolVersion.V0_9,
        ),
        create_a2ui_part(
            {
                "version": "v0.9",
                "updateComponents": {
                    "surfaceId": "main",
                    "components": [
                        {"id": "root", "component": "Text", "text": "Hello"}
                    ],
                },
            },
            version=ProtocolVersion.V0_9,
        ),
    ]


def test_converter_labels_each_part_with_its_messages_version():
    catalog = BasicCatalog(ProtocolVersion.V1_0)
    converter = _converter(catalog)

    valid_a2ui = {
        "version": "1.0",
        "createSurface": {"surfaceId": "main", "catalogId": catalog.catalog_id},
    }
    function_response = genai_types.FunctionResponse(
        name=SendA2uiToClientToolset._SendA2uiJsonToClientTool.TOOL_NAME,
        response={
            SendA2uiToClientToolset._SendA2uiJsonToClientTool.VALIDATED_A2UI_JSON_KEY: [
                valid_a2ui
            ]
        },
    )
    part = genai_types.Part(function_response=function_response)

    a2a_parts = converter.convert(part)
    assert len(a2a_parts) == 1
    assert a2a_parts[0] == create_a2ui_part(valid_a2ui, version=ProtocolVersion.V1_0)


def test_converter_checks_text_against_the_processors_bound_state():
    catalog = BasicCatalog(ProtocolVersion.V0_9)
    state = RendererState([catalog])
    converter = _converter(catalog, state=state)

    turn1 = [
        {
            "version": "v0.9",
            "createSurface": {
                "surfaceId": "main",
                "catalogId": catalog.catalog_id,
            },
        },
        {
            "version": "v0.9",
            "updateComponents": {
                "surfaceId": "main",
                "components": [{"id": "root", "component": "Text", "text": "Turn 1"}],
            },
        },
    ]
    parts1 = converter.convert(
        genai_types.Part(text=f"{A2UI_OPEN_TAG}\n{json.dumps(turn1)}\n{A2UI_CLOSE_TAG}")
    )
    assert len(parts1) == 2

    # Turn 2 updates the surface created in Turn 1 via the shared Canvas state
    turn2 = [{
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "main",
            "components": [{"id": "root", "component": "Text", "text": "Turn 2"}],
        },
    }]
    parts2 = converter.convert(
        genai_types.Part(text=f"{A2UI_OPEN_TAG}\n{json.dumps(turn2)}\n{A2UI_CLOSE_TAG}")
    )
    assert len(parts2) == 1
    assert parts2[0] == create_a2ui_part(turn2[0], version=ProtocolVersion.V0_9)


def test_converter_leaves_thought_parts_to_adk():
    converter = _converter()
    part = genai_types.Part(
        text=f"Thinking about {A2UI_OPEN_TAG}\ninvalid_json\n{A2UI_CLOSE_TAG}",
        thought=True,
    )

    a2a_parts = converter.convert(part)

    assert len(a2a_parts) == 1
    assert isinstance(a2a_parts[0].root, a2a_types.TextPart)
    assert a2a_parts[0].root.metadata == {"adk_thought": True}
