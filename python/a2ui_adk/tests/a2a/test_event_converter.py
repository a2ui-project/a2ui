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

"""Tests for the A2uiEventConverter class."""

import json
from unittest.mock import MagicMock, patch

from google.adk.a2a.converters import part_converter as adk_part_converter
from google.genai import types as genai_types

from a2ui.adk.a2a import A2uiEventConverter, A2uiPartConverter
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
from a2ui.processor import A2uiRequestProcessor
from a2ui.utils import RendererState


def _convert(converter: A2uiEventConverter, state: dict, event=None):
    """Runs the converter and returns the part converter it passes to ADK."""
    invocation_context = MagicMock()
    invocation_context.session.state = state
    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []
        converter(event or MagicMock(), invocation_context)
    return mock_base_converter.call_args[0][4]


def test_event_converter_reads_the_processor_and_its_bound_state():
    catalog = BasicCatalog(ProtocolVersion.V1_0)
    state = RendererState([catalog])
    processor = A2uiRequestProcessor([catalog], state=state)

    part_converter = _convert(
        A2uiEventConverter(), {"system:a2ui_processor": processor}
    ).__self__

    assert isinstance(part_converter, A2uiPartConverter)
    assert part_converter._processor is processor
    assert part_converter._parser is processor.parser
    assert part_converter._state is state


def test_event_converter_reads_a_custom_processor_key():
    processor = A2uiRequestProcessor([BasicCatalog("1.0")])

    part_converter = _convert(
        A2uiEventConverter(processor_key="custom:processor"),
        {"custom:processor": processor},
    ).__self__

    assert part_converter._processor is processor


def test_event_converter_falls_back_without_a_processor():
    effective = _convert(A2uiEventConverter(), {})
    assert effective is adk_part_converter.convert_genai_part_to_a2a_part


def test_event_converter_ignores_a_value_that_is_not_a_processor():
    effective = _convert(
        A2uiEventConverter(), {"system:a2ui_processor": [BasicCatalog("1.0")]}
    )
    assert effective is adk_part_converter.convert_genai_part_to_a2a_part


def test_event_converter_passes_its_options_to_the_part_converter():
    processor = A2uiRequestProcessor([BasicCatalog("1.0")])

    part_converter = _convert(
        A2uiEventConverter(bypass_tool_check=True, fallback_text="Sorry."),
        {"system:a2ui_processor": processor},
    ).__self__

    assert part_converter._bypass_tool_check
    assert part_converter._fallback_text == "Sorry."


def _streaming_context(processor, invocation_id: str = "inv-1") -> MagicMock:
    invocation_context = MagicMock()
    invocation_context.invocation_id = invocation_id
    invocation_context.session.state = {"system:a2ui_processor": processor}
    return invocation_context


def _event(partial: bool) -> MagicMock:
    event = MagicMock()
    event.partial = partial
    return event


def test_event_converter_streams_partial_events_into_one_stream():

    catalog = BasicCatalog(ProtocolVersion.V0_9)
    state = RendererState([catalog])
    processor = A2uiRequestProcessor(
        [catalog], format_factory=DirectJsonFormatFactory(), state=state
    )
    invocation_context = _streaming_context(processor)
    converter = A2uiEventConverter()

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []

        def convert(event, text):
            converter(event, invocation_context)
            return mock_base_converter.call_args[0][4](genai_types.Part(text=text))

        parts1 = convert(
            _event(partial=True),
            'Hello <a2ui-json>[{"version": "v0.9", "createSurface":'
            f' {{"surfaceId": "s1", "catalogId": "{catalog.catalog_id}"}}}}',
        )
        assert len(parts1) == 2
        assert "inv-1" in converter._streams

        parts2 = convert(
            _event(partial=True),
            ', {"version": "v0.9", "updateComponents": {"surfaceId":'
            ' "s1", "components": [{"id": "root", "component": "Text",'
            ' "text": "Hi"}]}}]</a2ui-json> <a2ui',
        )
        assert len(parts2) >= 1

        # The final event closes the stream; its aggregated text is dropped.
        parts_final = convert(_event(partial=False), "aggregated ignored")
        assert [p.root.text for p in parts_final if hasattr(p.root, "text")] == [
            "<a2ui"
        ]
        assert converter._streams == {}

    # The stream checked and applied the messages to the processor's state.
    assert state.get_surface("s1") is not None


def test_event_converter_keeps_one_stream_per_invocation():

    processor = A2uiRequestProcessor(
        [BasicCatalog("0.9")], format_factory=DirectJsonFormatFactory()
    )
    converter = A2uiEventConverter()

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []
        for invocation_id in ("a", "b"):
            converter(
                _event(partial=True), _streaming_context(processor, invocation_id)
            )
            mock_base_converter.call_args[0][4](genai_types.Part(text="Hi"))

    assert set(converter._streams) == {"a", "b"}
    assert converter._streams["a"] is not converter._streams["b"]


def test_event_converter_converts_a_response_without_partial_events_whole():

    catalog = BasicCatalog("0.9")
    processor = A2uiRequestProcessor(
        [catalog], format_factory=DirectJsonFormatFactory()
    )
    converter = A2uiEventConverter()
    text = (
        '<a2ui-json>[{"version": "v0.9", "createSurface": {"surfaceId": "s1",'
        f' "catalogId": "{catalog.catalog_id}"}}}}, {{"version": "v0.9",'
        ' "updateComponents": {"surfaceId": "s1", "components": [{"id": "root",'
        ' "component": "Text", "text": "Hi"}]}}]</a2ui-json>'
    )

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []
        converter(_event(partial=False), _streaming_context(processor))
        parts = mock_base_converter.call_args[0][4](genai_types.Part(text=text))

    assert len(parts) == 2
    assert converter._streams == {}


def test_event_converter_does_not_stream_a_format_that_cannot():

    processor = A2uiRequestProcessor([BasicCatalog("0.9")])  # Express
    invocation_context = _streaming_context(processor)
    converter = A2uiEventConverter()

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []
        converter(_event(partial=True), invocation_context)
        effective = mock_base_converter.call_args[0][4]

    assert isinstance(effective.__self__, A2uiPartConverter)
    assert converter._streams == {}


def test_event_converter_drops_the_rest_of_a_response_after_a_failed_chunk():
    catalog = BasicCatalog("0.9")
    processor = A2uiRequestProcessor(
        [catalog], format_factory=DirectJsonFormatFactory()
    )
    invocation_context = _streaming_context(processor)
    converter = A2uiEventConverter(fallback_text="Sorry.")
    create = {
        "version": "v0.9",
        "createSurface": {"surfaceId": "s1", "catalogId": catalog.catalog_id},
    }
    # The root's child doesn't exist, so the block fails when it closes.
    dangling = {
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{"id": "root", "component": "Column", "children": ["x"]}],
        },
    }

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []

        def convert(event, text):
            converter(event, invocation_context)
            return mock_base_converter.call_args[0][4](genai_types.Part(text=text))

        failed = convert(
            _event(partial=True),
            f"<a2ui-json>{json.dumps([create, dangling])}</a2ui-json>",
        )
        later = convert(_event(partial=True), ' <a2ui-json>[{"version": "v0.9"}')
        final = convert(_event(partial=False), "aggregated ignored")

    assert failed == []
    # The rest of the response is not sent as text.
    assert later == []
    assert [p.root.text for p in final] == ["Sorry."]
    assert converter._streams == {}
