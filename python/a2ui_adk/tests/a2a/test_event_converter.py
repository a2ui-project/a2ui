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
import re
from unittest.mock import MagicMock, patch

from google.adk.a2a.converters import part_converter as adk_part_converter
from google.adk.agents.readonly_context import ReadonlyContext
from google.genai import types as genai_types
import pytest

from a2ui.adk import A2uiProcessorStore
from a2ui.adk.a2a import A2uiEventConverter, A2uiPartConverter
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
from a2ui.processor import A2uiRequestProcessor
from a2ui.utils import RendererState


def _context(invocation_id: str = "inv-1", session_id: str = "session-1") -> MagicMock:
    invocation_context = MagicMock()
    invocation_context.invocation_id = invocation_id
    invocation_context.session.id = session_id
    invocation_context.session.state = {}
    return invocation_context


def _event(partial: bool = False, branch: str | None = None) -> MagicMock:
    event = MagicMock()
    event.partial = partial
    event.branch = branch
    event.author = "agent"
    return event


def _convert(converter: A2uiEventConverter, invocation_context=None, event=None):
    """Runs the converter and returns the part converter it passes to ADK."""
    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []
        converter(event or _event(), invocation_context or _context())
    return mock_base_converter.call_args[0][4]


def test_event_converter_uses_the_processor_and_its_bound_state():
    catalog = BasicCatalog(ProtocolVersion.V1_0)
    state = RendererState([catalog])
    processor = A2uiRequestProcessor([catalog], state=state)

    part_converter = _convert(
        A2uiEventConverter(a2ui_processor=lambda ctx: processor)
    ).__self__

    assert isinstance(part_converter, A2uiPartConverter)
    assert part_converter._processor is processor
    assert part_converter._parser is processor.parser
    assert part_converter._state is state


def test_event_converter_calls_the_provider_with_a_readonly_context():
    processor = A2uiRequestProcessor([BasicCatalog("1.0")])
    contexts = []

    def provider(ctx):
        contexts.append(ctx)
        return processor

    invocation_context = _context(session_id="s-42")
    _convert(A2uiEventConverter(a2ui_processor=provider), invocation_context)

    assert isinstance(contexts[0], ReadonlyContext)
    assert contexts[0].session.id == "s-42"


def test_event_converter_reads_the_processor_from_a_store():
    store = A2uiProcessorStore()
    processor = A2uiRequestProcessor([BasicCatalog("1.0")])
    store.set("session-1", processor)
    converter = A2uiEventConverter(a2ui_processor=store.get)

    assert _convert(converter, _context()).__self__._processor is processor
    effective = _convert(converter, _context(session_id="other"))
    assert effective is adk_part_converter.convert_genai_part_to_a2a_part


def test_event_converter_takes_one_processor_for_every_request():
    processor = A2uiRequestProcessor([BasicCatalog("1.0")])

    part_converter = _convert(A2uiEventConverter(a2ui_processor=processor)).__self__

    assert part_converter._processor is processor


def test_event_converter_falls_back_when_the_provider_returns_none():
    effective = _convert(A2uiEventConverter(a2ui_processor=lambda ctx: None))
    assert effective is adk_part_converter.convert_genai_part_to_a2a_part


def test_event_converter_rejects_a_provider_returning_another_type():
    converter = A2uiEventConverter(a2ui_processor=lambda ctx: [BasicCatalog("1.0")])
    with pytest.raises(TypeError, match="returned list, not an A2uiRequestProcessor"):
        _convert(converter)


def test_event_converter_rejects_an_async_provider():
    async def provider(ctx):
        return None

    converter = A2uiEventConverter(a2ui_processor=provider)
    with pytest.raises(TypeError, match="must not be async"):
        _convert(converter)


def test_event_converter_warns_about_one_processor_with_a_bound_state(caplog):
    catalog = BasicCatalog("1.0")
    processor = A2uiRequestProcessor([catalog], state=RendererState([catalog]))

    with caplog.at_level("WARNING"):
        A2uiEventConverter(a2ui_processor=processor)

    assert "every conversation shares that state" in caplog.text


def test_event_converter_does_not_warn_about_a_provider(caplog):
    with caplog.at_level("WARNING"):
        _convert(A2uiEventConverter(a2ui_processor=lambda ctx: None))
    assert caplog.text == ""


def test_event_converter_passes_its_options_to_the_part_converter():
    processor = A2uiRequestProcessor([BasicCatalog("1.0")])

    part_converter = _convert(
        A2uiEventConverter(
            bypass_tool_check=True,
            fallback_text="Sorry.",
            a2ui_processor=processor,
        )
    ).__self__

    assert part_converter._bypass_tool_check
    assert part_converter._fallback_text == "Sorry."


def test_event_converter_streams_partial_events_into_one_stream():

    catalog = BasicCatalog(ProtocolVersion.V0_9)
    state = RendererState([catalog])
    processor = A2uiRequestProcessor(
        [catalog], format_factory=DirectJsonFormatFactory(), state=state
    )
    invocation_context = _context()
    converter = A2uiEventConverter(a2ui_processor=processor)

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []

        def convert(event, text):
            # Like ADK, call the part converter while converting the event.
            converted = []
            mock_base_converter.side_effect = lambda *args: converted.extend(
                args[4](genai_types.Part(text=text))
            )
            converter(event, invocation_context)
            return converted

        parts1 = convert(
            _event(partial=True),
            'Hello <a2ui-json>[{"version": "v0.9", "createSurface":'
            f' {{"surfaceId": "s1", "catalogId": "{catalog.catalog_id}"}}}}',
        )
        assert len(parts1) == 2
        assert ("inv-1", "agent") in converter._streams

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
    converter = A2uiEventConverter(a2ui_processor=processor)

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []
        for invocation_id in ("a", "b"):
            converter(_event(partial=True), _context(invocation_id))
            mock_base_converter.call_args[0][4](genai_types.Part(text="Hi"))

    assert set(converter._streams) == {("a", "agent"), ("b", "agent")}
    assert (
        converter._streams[("a", "agent")].stream
        is not converter._streams[("b", "agent")].stream
    )


def test_event_converter_converts_a_response_without_partial_events_whole():

    catalog = BasicCatalog("0.9")
    processor = A2uiRequestProcessor(
        [catalog], format_factory=DirectJsonFormatFactory()
    )
    converter = A2uiEventConverter(a2ui_processor=processor)
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
        converter(_event(partial=False), _context())
        parts = mock_base_converter.call_args[0][4](genai_types.Part(text=text))

    assert len(parts) == 2
    assert converter._streams == {}


def test_event_converter_does_not_stream_a_format_that_cannot():

    processor = A2uiRequestProcessor([BasicCatalog("0.9")])  # Express
    invocation_context = _context()
    converter = A2uiEventConverter(a2ui_processor=processor)

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
    invocation_context = _context()
    converter = A2uiEventConverter(fallback_text="Sorry.", a2ui_processor=processor)
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
            # Like ADK, call the part converter while converting the event.
            converted = []
            mock_base_converter.side_effect = lambda *args: converted.extend(
                args[4](genai_types.Part(text=text))
            )
            converter(event, invocation_context)
            return converted

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


def test_event_converter_does_not_feed_thought_parts_into_stream():
    processor = A2uiRequestProcessor(
        [BasicCatalog("0.9")], format_factory=DirectJsonFormatFactory()
    )
    invocation_context = _context()
    converter = A2uiEventConverter(a2ui_processor=processor)

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []
        converter(_event(partial=True), invocation_context)
        convert_part = mock_base_converter.call_args[0][4]
        thought_parts = convert_part(
            genai_types.Part(text="<a2ui-json>draft", thought=True)
        )

    assert len(thought_parts) == 1
    assert thought_parts[0].root.metadata == {"adk_thought": True}
    assert converter._streams == {}


def test_event_converter_closes_stream_when_final_event_has_no_text_part():
    processor = A2uiRequestProcessor(
        [BasicCatalog("0.9")], format_factory=DirectJsonFormatFactory()
    )
    invocation_context = _context()
    converter = A2uiEventConverter(a2ui_processor=processor)

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []
        converter(_event(partial=True), invocation_context)
        mock_base_converter.call_args[0][4](genai_types.Part(text="Hello <a2ui"))
        assert ("inv-1", "agent") in converter._streams

        # Like ADK, call the part converter while converting the event.
        parts = []
        mock_base_converter.side_effect = lambda *args: parts.extend(
            args[4](
                genai_types.Part(
                    function_call=genai_types.FunctionCall(name="some_tool", args={})
                )
            )
        )
        converter(_event(partial=False), invocation_context)

    assert parts[0].root.text == " <a2ui"
    assert converter._streams == {}


def test_event_converter_closes_the_stream_on_a_final_event_without_parts():
    processor = A2uiRequestProcessor(
        [BasicCatalog("0.9")], format_factory=DirectJsonFormatFactory()
    )
    invocation_context = _context()
    converter = A2uiEventConverter(a2ui_processor=processor)

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []
        converter(_event(partial=True), invocation_context)
        mock_base_converter.call_args[0][4](genai_types.Part(text="Hi <a2ui"))
        assert ("inv-1", "agent") in converter._streams

        # ADK never calls the part converter for an event with no parts.
        converter(_event(partial=False), invocation_context)

    assert converter._streams == {}


def test_event_converter_keeps_one_stream_per_branch_of_an_invocation():
    # The sub-agents of a ParallelAgent share the invocation, with a branch each.
    processor = A2uiRequestProcessor(
        [BasicCatalog("0.9")], format_factory=DirectJsonFormatFactory()
    )
    invocation_context = _context()
    converter = A2uiEventConverter(a2ui_processor=processor)

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []

        def convert(event, text):
            # Like ADK, call the part converter while converting the event.
            converted = []
            mock_base_converter.side_effect = lambda *args: converted.extend(
                args[4](genai_types.Part(text=text))
            )
            converter(event, invocation_context)
            return converted

        convert(_event(partial=True, branch="root.a"), "From a <a2ui")
        convert(_event(partial=True, branch="root.b"), "From b <a2ui-json>[")
        assert set(converter._streams) == {("inv-1", "root.a"), ("inv-1", "root.b")}

        final_a = convert(_event(partial=False, branch="root.a"), "ignored")

    # Branch a's final event closes only its own stream.
    assert [p.root.text for p in final_a] == [" <a2ui"]
    assert set(converter._streams) == {("inv-1", "root.b")}


def test_event_converter_drops_a_stream_that_gets_no_event(caplog):
    processor = A2uiRequestProcessor(
        [BasicCatalog("0.9")], format_factory=DirectJsonFormatFactory()
    )
    converter = A2uiEventConverter(a2ui_processor=processor, stream_idle_timeout=60)

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []
        with patch("time.monotonic", return_value=1000.0):
            # A run that is cancelled after its first partial event.
            converter(_event(partial=True), _context("cancelled"))
            mock_base_converter.call_args[0][4](genai_types.Part(text="Hi <a2ui"))
        with patch("time.monotonic", return_value=1030.0):
            converter(_event(partial=True), _context("live"))
            mock_base_converter.call_args[0][4](genai_types.Part(text="Hi"))
        assert set(converter._streams) == {
            ("cancelled", "agent"),
            ("live", "agent"),
        }

        with patch("time.monotonic", return_value=1061.0), caplog.at_level("WARNING"):
            converter(_event(partial=True), _context("live"))
            mock_base_converter.call_args[0][4](genai_types.Part(text=" there"))

    assert set(converter._streams) == {("live", "agent")}
    assert "Dropped 1 A2UI streams" in caplog.text


def test_event_converter_logs_a_failed_chunk_without_its_text(caplog):
    catalog = BasicCatalog("0.9")
    processor = A2uiRequestProcessor(
        [catalog], format_factory=DirectJsonFormatFactory()
    )
    converter = A2uiEventConverter(a2ui_processor=processor)
    secret = "secret-component-id"
    dangling = {
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "s1",
            "components": [{"id": "root", "component": "Column", "children": [secret]}],
        },
    }
    create = {
        "version": "v0.9",
        "createSurface": {"surfaceId": "s1", "catalogId": catalog.catalog_id},
    }

    with patch(
        "google.adk.a2a.converters.event_converter.convert_event_to_a2a_events"
    ) as mock_base_converter:
        mock_base_converter.return_value = []
        with caplog.at_level("WARNING"):
            converter(_event(partial=True), _context())
            mock_base_converter.call_args[0][4](
                genai_types.Part(
                    text=f"<a2ui-json>{json.dumps([create, dangling])}</a2ui-json>"
                )
            )

    assert re.search(r"Failed to stream A2UI chunk: \w+$", caplog.text, re.M)
    assert secret not in caplog.text
