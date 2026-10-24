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

import gc
from unittest.mock import MagicMock, patch

from google.genai import types as genai_types

from a2ui.adk.a2a import A2uiEventConverter, A2uiPartConverter
from a2ui.core import Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import DirectJsonParser


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


def test_event_converter_reuses_part_converter_and_reads_processor_and_state():
    from a2ui.core.schema import ProtocolVersion
    from a2ui.processor import A2uiRequestProcessor

    catalog = BasicCatalog(ProtocolVersion.V1_0)
    processor = A2uiRequestProcessor([catalog])
    state = processor.create_state()
    invocation_context_mock = MagicMock()
    invocation_context_mock.session.state = {
        "system:a2ui_processor": processor,
        "system:a2ui_state": state,
    }

    converter = A2uiEventConverter()

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []

        converter(MagicMock(), invocation_context_mock)
        first_part_converter = mock_base_converter.call_args[0][4].__self__

        converter(MagicMock(), invocation_context_mock)
        second_part_converter = mock_base_converter.call_args[0][4].__self__

        assert first_part_converter is second_part_converter
        assert first_part_converter._parser is processor.parser
        assert first_part_converter._state is state
        assert first_part_converter._version == ProtocolVersion.V1_0


def test_event_converter_streams_partial_events_via_response_stream():
    from google.genai import types as genai_types
    from a2ui.core.schema import ProtocolVersion
    from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
    from a2ui.processor import A2uiRequestProcessor

    catalog = BasicCatalog(ProtocolVersion.V0_9)
    processor = A2uiRequestProcessor(
        [catalog], format_factory=DirectJsonFormatFactory()
    )
    state = processor.create_state()
    stream = processor.open_stream(state=state)
    invocation_context_mock = MagicMock()
    invocation_context_mock.session.state = {
        "system:a2ui_processor": processor,
        "system:a2ui_state": state,
        "system:a2ui_stream": stream,
    }

    converter = A2uiEventConverter()

    partial_event_1 = MagicMock()
    partial_event_1.partial = True
    partial_event_2 = MagicMock()
    partial_event_2.partial = True
    final_event = MagicMock()
    final_event.partial = False

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []

        converter(partial_event_1, invocation_context_mock)
        fn1 = mock_base_converter.call_args[0][4]
        parts1 = fn1(
            genai_types.Part(
                text=(
                    'Hello <a2ui-json>[{"version": "v0.9", "createSurface":'
                    f' {{"surfaceId": "s1", "catalogId": "{catalog.catalog_id}"}}}}'
                )
            )
        )
        assert len(parts1) == 2

        converter(partial_event_2, invocation_context_mock)
        fn2 = mock_base_converter.call_args[0][4]
        parts2 = fn2(
            genai_types.Part(
                text=(
                    ', {"version": "v0.9", "updateComponents": {"surfaceId":'
                    ' "s1", "components": [{"id": "root", "component": "Text",'
                    ' "text": "Hi"}]}}]</a2ui-json> <a2ui'
                )
            )
        )
        assert len(parts2) >= 1

        converter(final_event, invocation_context_mock)
        fn_final = mock_base_converter.call_args[0][4]
        parts_final = fn_final(genai_types.Part(text="aggregated ignored"))
        assert [p.root.text for p in parts_final if hasattr(p.root, "text")] == [
            "<a2ui"
        ]


def test_event_converter_does_not_keep_abandoned_streams_alive():
    converter = A2uiEventConverter()
    stream = DirectJsonParser([BasicCatalog("0.9")]).open_stream()
    event = MagicMock()
    event.partial = True

    part_converter = converter._make_stream_part_converter(
        event=event, stream=stream, base_converter=MagicMock()
    )
    part_converter(genai_types.Part(text="<a2ui-json>["))
    assert stream in converter._active_streams

    del part_converter, stream
    gc.collect()
    assert len(converter._active_streams) == 0
