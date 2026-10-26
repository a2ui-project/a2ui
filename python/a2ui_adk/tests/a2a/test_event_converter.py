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

from unittest.mock import MagicMock, patch

from google.genai import types as genai_types

from a2ui.adk.a2a import A2uiEventConverter, A2uiPartConverter
from a2ui.core import Catalog
from a2ui.core.basic_catalog import BasicCatalog


def test_event_converter_injects_catalog():
    catalog_mock = MagicMock(
        spec=Catalog, catalog_id="test_catalog", protocol_version="0.9"
    )
    event_mock = MagicMock()
    invocation_context_mock = MagicMock()
    # Correctly access session via mock
    invocation_context_mock.session.state = {"system:a2ui_catalogs": catalog_mock}

    converter = A2uiEventConverter()

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []

        # Converter is not async
        converter(event_mock, invocation_context_mock)

        # Verify that mock_base_converter was called with a part_converter that uses the catalog
        args, kwargs = mock_base_converter.call_args
        effective_part_converter = args[4]

        assert effective_part_converter.__name__ == "convert"
        assert isinstance(effective_part_converter.__self__, A2uiPartConverter)
        assert effective_part_converter.__self__._parser.catalogs == [catalog_mock]


def test_event_converter_injects_catalog_sequence():
    catalogs = [
        BasicCatalog("1.0"),
        Catalog.from_json(
            {"catalogId": "custom", "components": {}},
            protocol_version="1.0",
            catalog_id="custom",
        ),
    ]
    event_mock = MagicMock()
    invocation_context_mock = MagicMock()
    invocation_context_mock.session.state = {"system:a2ui_catalogs": catalogs}

    converter = A2uiEventConverter()

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []

        converter(event_mock, invocation_context_mock)

        args, _ = mock_base_converter.call_args
        effective_part_converter = args[4]

        assert isinstance(effective_part_converter.__self__, A2uiPartConverter)
        assert effective_part_converter.__self__._parser.catalogs == list(catalogs)


def test_event_converter_reads_custom_catalogs_key():
    catalog_mock = MagicMock(
        spec=Catalog, catalog_id="test_catalog", protocol_version="0.9"
    )
    invocation_context_mock = MagicMock()
    invocation_context_mock.session.state = {"custom:catalogs": [catalog_mock]}

    converter = A2uiEventConverter(catalogs_key="custom:catalogs")

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []

        converter(MagicMock(), invocation_context_mock)

        args, _ = mock_base_converter.call_args
        effective_part_converter = args[4]

        assert isinstance(effective_part_converter.__self__, A2uiPartConverter)
        assert effective_part_converter.__self__._parser.catalogs == [catalog_mock]


def test_event_converter_falls_back_without_catalog():
    event_mock = MagicMock()
    invocation_context_mock = MagicMock()
    invocation_context_mock.session.state = {}  # No catalog

    converter = A2uiEventConverter()

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []

        # Converter is not async
        converter(event_mock, invocation_context_mock)

        args, kwargs = mock_base_converter.call_args
        effective_part_converter = args[4]

        from google.adk.a2a.converters.part_converter import (
            convert_genai_part_to_a2a_part,
        )

        assert effective_part_converter == convert_genai_part_to_a2a_part


def test_event_converter_propagates_fallback_text():
    catalog_mock = MagicMock(
        spec=Catalog, catalog_id="test_catalog", protocol_version="0.9"
    )
    event_mock = MagicMock()
    invocation_context_mock = MagicMock()
    invocation_context_mock.session.state = {"system:a2ui_catalogs": catalog_mock}

    custom_fallback = "Custom event fallback text"
    converter = A2uiEventConverter(fallback_text=custom_fallback)

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []

        converter(event_mock, invocation_context_mock)

        args, kwargs = mock_base_converter.call_args
        effective_part_converter = args[4]

        assert isinstance(effective_part_converter.__self__, A2uiPartConverter)
        assert effective_part_converter.__self__._fallback_text == custom_fallback


def test_event_converter_reads_the_processor_and_its_bound_state():
    from a2ui.core.schema import ProtocolVersion
    from a2ui.processor import A2uiRequestProcessor
    from a2ui.utils import RendererState

    catalog = BasicCatalog(ProtocolVersion.V1_0)
    state = RendererState([catalog])
    processor = A2uiRequestProcessor([catalog], state=state)
    invocation_context_mock = MagicMock()
    invocation_context_mock.session.state = {"system:a2ui_processor": processor}

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []
        A2uiEventConverter()(MagicMock(), invocation_context_mock)

    part_converter = mock_base_converter.call_args[0][4].__self__
    assert part_converter._parser is processor.parser
    assert part_converter._state is state
    assert part_converter._version == ProtocolVersion.V1_0


def test_event_converter_prefers_the_processor_to_the_catalogs():
    from a2ui.processor import A2uiRequestProcessor

    processor = A2uiRequestProcessor([BasicCatalog("1.0")])
    invocation_context_mock = MagicMock()
    invocation_context_mock.session.state = {
        "system:a2ui_processor": processor,
        "system:a2ui_catalogs": [MagicMock(spec=Catalog)],
    }

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []
        A2uiEventConverter()(MagicMock(), invocation_context_mock)

    assert mock_base_converter.call_args[0][4].__self__._parser is processor.parser


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
    from a2ui.core.schema import ProtocolVersion
    from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
    from a2ui.processor import A2uiRequestProcessor
    from a2ui.utils import RendererState

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
    from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
    from a2ui.processor import A2uiRequestProcessor

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
    from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
    from a2ui.processor import A2uiRequestProcessor

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
    from a2ui.processor import A2uiRequestProcessor

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
