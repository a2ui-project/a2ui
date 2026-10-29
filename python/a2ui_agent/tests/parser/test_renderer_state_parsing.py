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

"""Parsing chat and canvas turns against a `RendererState`."""

from __future__ import annotations

import json
from typing import Any

import pytest

from a2ui.core import (
    A2uiCatalogError,
    A2uiIntegrityError,
    A2uiParseError,
    A2uiValidationError,
    Catalog,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import to_message_dicts
from a2ui.inference_formats.direct_json import (
    DirectJsonFormatFactory,
    DirectJsonParser,
)
from a2ui.inference_formats.express import ExpressParser
from a2ui.parser import A2uiPart, ResponsePart, TextPart
from a2ui.processor import A2uiRequestProcessor
from a2ui.utils import RendererState, validate_payload

_BASIC = BasicCatalog("0.9")
_CREATE = {
    "version": "v0.9",
    "createSurface": {"surfaceId": "s", "catalogId": _BASIC.catalog_id},
}


def _update(*components: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": "v0.9",
        "updateComponents": {"surfaceId": "s", "components": list(components)},
    }


def _column(*children: str) -> dict[str, Any]:
    return {"id": "root", "component": "Column", "children": list(children)}


def _text(component_id: str) -> dict[str, Any]:
    return {"id": component_id, "component": "Text", "text": component_id}


def _block(*messages: dict[str, Any]) -> str:
    return f"<a2ui-json>{json.dumps(list(messages))}</a2ui-json>"


def _component_ids(state: RendererState) -> set[str]:
    surface = state.get_surface("s")
    assert surface is not None
    return set(surface.components_model.keys)


def _components(state: RendererState) -> dict[str, dict[str, Any]]:
    surface = state.get_surface("s")
    assert surface is not None
    return {c.id: c.properties for c in surface.components_model.values}


def _emitted(parts: list[ResponsePart]) -> list[dict[str, Any]]:
    return [
        message
        for part in parts
        if isinstance(part, A2uiPart)
        for message in to_message_dicts(part.a2ui)
    ]


def _text_of(parts: list[ResponsePart]) -> str:
    return "".join(part.text for part in parts if isinstance(part, TextPart))


def test_a_chat_turn_shows_new_ui():
    """Without a state, an update to a surface the turn never created is rejected.

    `validate_payload`, which checks one payload with no record of earlier
    ones, assumes such a surface exists.
    """
    parser = DirectJsonParser([_BASIC])
    update = _update(_column("earlier"))

    with pytest.raises(A2uiIntegrityError, match="Surface not found"):
        parser.parse_response(_block(update))
    validate_payload([_BASIC], [update])


def test_a_canvas_turn_is_checked_against_earlier_turns():
    parser = DirectJsonParser([_BASIC])
    state = RendererState([_BASIC])
    parser.parse_response(
        _block(_CREATE, _update(_column("a"), _text("a"))), state=state
    )

    parser.parse_response(_block(_update(_column("a", "b"), _text("b"))), state=state)

    assert _component_ids(state) == {"root", "a", "b"}
    with pytest.raises(A2uiIntegrityError, match="Dangling reference"):
        parser.parse_response(_block(_update(_column("a", "missing"))), state=state)


def test_a_failed_canvas_turn_leaves_the_state_unchanged():
    parser = DirectJsonParser([_BASIC])
    state = RendererState([_BASIC])
    parser.parse_response(
        _block(_CREATE, _update(_column("a"), _text("a"))), state=state
    )
    before = _components(state)

    with pytest.raises(A2uiValidationError) as excinfo:
        parser.parse_response(
            "Adding b.\n"
            + _block(_update(_column("a", "b"), _text("b")))
            + _block(_update({"id": "c", "component": "Unknown"})),
            state=state,
        )

    assert _components(state) == before
    assert len(getattr(excinfo.value, "partial_results")) == 2


def test_a_stream_reuses_one_state_while_data_arrives():
    parser = DirectJsonParser([_BASIC])
    state = RendererState([_BASIC])
    stream = parser.open_stream(state=state)
    response = "Here. " + _block(_CREATE, _update(_column("a"), _text("a"))) + " Done."

    parts: list[ResponsePart] = []
    for start in range(0, len(response), 7):
        parts.extend(stream.feed(response[start : start + 7]))
    parts.extend(stream.close())

    assert stream.state is state
    assert _text_of(parts) == "Here.Done."
    # Replaying what was emitted rebuilds the state.
    replayed = RendererState([_BASIC])
    replayed.apply(_emitted(parts))
    assert _component_ids(replayed) == _component_ids(state) == {"root", "a"}


def test_a_canvas_stream_updates_the_state_of_an_earlier_turn():
    parser = DirectJsonParser([_BASIC])
    state = RendererState([_BASIC])
    parser.parse_response(
        _block(_CREATE, _update(_column("a"), _text("a"))), state=state
    )

    stream = parser.open_stream(state=state)
    parts = stream.feed(_block(_update(_column("a", "b"), _text("b"))))
    parts.extend(stream.close())

    assert _emitted(parts) == [_update(_column("a", "b"), _text("b"))]
    assert _component_ids(state) == {"root", "a", "b"}


def test_a_failed_stream_keeps_what_it_emitted():
    """The renderer received the emitted messages, so the state keeps them."""
    parser = DirectJsonParser([_BASIC])
    state = RendererState([_BASIC])
    stream = parser.open_stream(state=state)

    parts = stream.feed("<a2ui-json>" + json.dumps([_CREATE, _update(_column("a"))]))
    with pytest.raises(A2uiIntegrityError, match="Dangling reference"):
        stream.feed("</a2ui-json>")

    assert _emitted(parts) == [_CREATE, _update(_column("a"))]
    assert _component_ids(state) == {"root"}


def test_close_flushes_text_held_as_a_possible_tag():
    stream = DirectJsonParser([_BASIC]).open_stream()

    parts = stream.feed("Compare a <a2ui")
    parts.extend(stream.close())

    assert _text_of(parts) == "Compare a <a2ui"


def test_close_rejects_an_unclosed_block():
    stream = DirectJsonParser([_BASIC]).open_stream()
    stream.feed("<a2ui-json>" + json.dumps([_CREATE]))

    with pytest.raises(A2uiParseError, match="ended inside"):
        stream.close()


def test_parse_response_rejects_an_unclosed_block():
    parser = DirectJsonParser([_BASIC])

    with pytest.raises(A2uiParseError, match="ended inside"):
        parser.parse_response("<a2ui-json>" + json.dumps([_CREATE]))


def test_a_truncated_block_only_skips_the_surface_it_touches():
    parser = ExpressParser([_BASIC])
    closed_dangling = '<a2ui>\nsurface("s1")\nroot = Column([missing])\n</a2ui>'
    truncated_other = '<a2ui>\nsurface("s2")\nroot = Column([a])\na = Text("hi"'

    with pytest.raises(A2uiIntegrityError, match="Dangling reference"):
        parser.parse_response(closed_dangling + "\n" + truncated_other)


def test_close_checks_the_tree_of_an_unwrapped_stream():
    stream = DirectJsonParser([_BASIC]).open_stream(wrapped=False)
    stream.feed(json.dumps([_CREATE, _update(_column("a"))]))

    with pytest.raises(A2uiIntegrityError, match="Dangling reference"):
        stream.close()


def test_feed_after_close_is_an_error():
    stream = DirectJsonParser([_BASIC]).open_stream()
    stream.close()

    with pytest.raises(ValueError, match="closed"):
        stream.feed("more")


def test_request_processor_parses_canvas_turns_against_its_state():
    processor = A2uiRequestProcessor([_BASIC], format_factory=DirectJsonFormatFactory())
    state = processor.create_state()
    processor.parse_response(
        _block(_CREATE, _update(_column("a"), _text("a"))), state=state
    )

    stream = processor.open_stream(state=state)
    stream.feed(_block(_update(_column("a", "b"), _text("b"))))
    stream.close()

    assert _component_ids(state) == {"root", "a", "b"}
    with pytest.raises(A2uiIntegrityError, match="Dangling reference"):
        processor.parse_response(_block(_update(_column("missing"))), state=state)


def test_request_processor_rejects_a_state_for_other_catalogs():
    processor = A2uiRequestProcessor([_BASIC])
    other = RendererState([Catalog(catalog_id="other", protocol_version="0.9")])

    with pytest.raises(A2uiCatalogError, match="active catalogs"):
        processor.parse_response(_block(_CREATE), state=other)


def test_every_version_a_stream_emitted_rebuilds_its_state():
    parser = DirectJsonParser([_BASIC], progressive_keys={"text"})
    state = RendererState([_BASIC])
    stream = parser.open_stream(state=state)
    long_text = {"id": "a", "component": "Text", "text": "a" * 40}
    body = json.dumps([_CREATE, _update(_column("a"), long_text)])

    parts = stream.feed("<a2ui-json>")
    for start in range(0, len(body), 3):
        parts.extend(stream.feed(body[start : start + 3]))
    parts.extend(stream.feed("</a2ui-json>"))
    parts.extend(stream.close())

    emitted = _emitted(parts)
    assert len(emitted) > 2  # the update was emitted again as its text grew
    rebuilt = RendererState([_BASIC])
    rebuilt.apply(emitted)
    assert _components(rebuilt) == _components(state)
    assert _components(state)["a"]["text"] == "a" * 40


def test_a_stream_holds_a_delete_until_it_closes():
    parser = DirectJsonParser([_BASIC])
    state = RendererState([_BASIC])
    parser.parse_response(_block(_CREATE, _update(_text("root"))), state=state)
    stream = parser.open_stream(state=state)

    held = stream.feed(
        '<a2ui-json>[{"version": "v0.9", "deleteSurface": {"surfaceId": "s"}'
    )
    assert _emitted(held) == []
    assert state.surface_ids == ["s"]

    closed = stream.feed("}]</a2ui-json>")
    assert _emitted(closed) == [
        {"version": "v0.9", "deleteSurface": {"surfaceId": "s"}}
    ]
    assert state.surface_ids == []


def test_a_response_may_reference_a_component_a_later_block_adds():
    parser = DirectJsonParser([_BASIC])
    first = _block(_CREATE, _update(_column("a")))
    second = _block(_update(_text("a")))

    parts = parser.parse_response(first + " and " + second)

    assert len(_emitted(parts)) == 3
    # A block parsed on its own is checked as a whole response.
    with pytest.raises(A2uiIntegrityError, match="Dangling reference"):
        parser.parse_response(first)


def test_a_bound_state_is_used_when_a_call_passes_none():
    state = RendererState([_BASIC])
    processor = A2uiRequestProcessor(
        [_BASIC], format_factory=DirectJsonFormatFactory(), state=state
    )

    processor.parse_response(_block(_CREATE, _update(_column("a"), _text("a"))))
    stream = processor.open_stream()
    stream.feed(_block(_update(_column("a", "b"), _text("b"))))
    stream.close()

    assert processor.state is state
    assert _component_ids(state) == {"root", "a", "b"}


def test_a_bound_state_for_other_catalogs_is_rejected():
    other = RendererState([Catalog(catalog_id="other", protocol_version="0.9")])

    with pytest.raises(A2uiCatalogError, match="active catalogs"):
        A2uiRequestProcessor([_BASIC], state=other)


def test_a_bound_state_normalizes_protocol_version_spelling():
    raw = Catalog(catalog_id=_BASIC.catalog_id, protocol_version="0.9")
    prefixed = Catalog(catalog_id=_BASIC.catalog_id, protocol_version="v0.9")
    state = RendererState([raw])

    processor = A2uiRequestProcessor([prefixed], state=state)

    assert processor.state is state


def test_accepts_state_tells_whether_a_state_fits_the_active_catalogs():
    other = Catalog(catalog_id="other", protocol_version="0.9")
    processor = A2uiRequestProcessor(
        [_BASIC, other], format_factory=DirectJsonFormatFactory()
    )

    assert processor.accepts_state(processor.create_state())
    assert processor.accepts_state(RendererState([_BASIC, other]))
    # The order decides which catalog a surface resolves to.
    assert not processor.accepts_state(RendererState([other, _BASIC]))
    assert not processor.accepts_state(RendererState([_BASIC]))


def test_a_stream_that_raises_has_ended():
    stream = DirectJsonParser([_BASIC]).open_stream()
    stream.feed("<a2ui-json>" + json.dumps([_CREATE, _update(_column("a"))]))

    with pytest.raises(A2uiIntegrityError, match="Dangling reference"):
        stream.feed("</a2ui-json> More text.")
    with pytest.raises(ValueError, match="closed"):
        stream.feed("More text.")
    assert stream.close() == []


def test_closing_twice_returns_nothing_the_second_time():
    stream = DirectJsonParser([_BASIC]).open_stream()
    stream.feed("Held <a2ui")

    assert _text_of(stream.close()) == " <a2ui"
    assert stream.close() == []


@pytest.mark.parametrize(
    "message, error",
    [
        (
            _update({"id": "root", "component": "Unknown"}),
            "Unrecognized component",
        ),
        ({**_update(_text("root")), "version": "v1.0"}, "states version"),
        (_update(_text("root"), _text("root")), "Duplicate component"),
    ],
    ids=["unknown_component", "wrong_version", "duplicate_id"],
)
def test_a_block_that_arrives_whole_is_checked_when_it_closes(message, error):
    """Messages that never streamed in parts are checked as the block closes."""
    stream = DirectJsonParser([_BASIC]).open_stream()

    with pytest.raises(A2uiValidationError, match=error):
        stream.feed(_block(_CREATE, message))


def test_the_last_message_of_a_block_is_checked_when_it_closes():
    """A message whose object closes with the block is checked then."""
    stream = DirectJsonParser([_BASIC]).open_stream()
    body = json.dumps([_CREATE, _update({"id": "root", "component": "Unknown"})])

    stream.feed("<a2ui-json>" + body[:-2])
    with pytest.raises(A2uiValidationError, match="Unrecognized component"):
        stream.feed(body[-2:] + "</a2ui-json>")


def _canvas(parser: DirectJsonParser) -> RendererState:
    """A canvas state holding surface `s` with `root -> a`."""
    state = RendererState([_BASIC])
    parser.parse_response(
        _block(_CREATE, _update(_column("a"), _text("a"))), state=state
    )
    return state


_CHANGE_A = _update({"id": "a", "component": "Text", "text": "Changed"})


def test_a_failed_stream_does_not_hold_what_it_emitted_against_later_turns():
    parser = DirectJsonParser([_BASIC])
    state = _canvas(parser)
    stream = parser.open_stream(state=state)

    emitted = stream.feed("<a2ui-json>[" + json.dumps(_update(_text("orphan"))))
    assert _emitted(emitted)
    with pytest.raises(A2uiIntegrityError, match="'orphan' is not reachable"):
        stream.feed("]</a2ui-json>")

    # The renderer holds the orphan, and no message can remove it.
    assert "orphan" in _component_ids(state)
    parser.parse_response(_block(_CHANGE_A), state=state)
    assert _components(state)["a"]["text"] == "Changed"


def test_a_stream_cut_off_inside_a_block_does_not_hold_what_it_emitted():
    parser = DirectJsonParser([_BASIC])
    state = _canvas(parser)
    stream = parser.open_stream(state=state)

    assert _emitted(
        stream.feed("<a2ui-json>[" + json.dumps(_update(_text("orphan"))) + ",")
    )
    with pytest.raises(A2uiParseError, match="ended inside"):
        stream.close()

    parser.parse_response(_block(_CHANGE_A), state=state)
    assert _components(state)["a"]["text"] == "Changed"


def test_a_failed_tree_check_keeps_only_the_text_in_partial_results():
    parser = DirectJsonParser([_BASIC])
    state = RendererState([_BASIC])

    with pytest.raises(A2uiIntegrityError, match="Dangling reference") as excinfo:
        parser.parse_response(
            "Here.\n" + _block(_CREATE, _update(_column("missing"))), state=state
        )

    partial = getattr(excinfo.value, "partial_results")
    assert all(isinstance(p, TextPart) for p in partial)
    assert _text_of(partial) == "Here."
    assert state.surface_ids == []


class _TruncationTolerantParser(DirectJsonParser):
    """Compiles a cut-off block as far as it goes, as Express does."""

    def compile(self, format_content: str, *, is_final: bool = True) -> list[Any]:
        del is_final
        return super().compile(format_content)


def test_a_truncated_block_does_not_hold_its_components_against_later_turns():
    parser = _TruncationTolerantParser([_BASIC])
    state = _canvas(parser)

    parser.parse_response(
        "<a2ui-json>" + json.dumps([_update(_text("orphan"))]), state=state
    )

    assert "orphan" in _component_ids(state)
    parser.parse_response(_block(_CHANGE_A), state=state)
    assert _components(state)["a"]["text"] == "Changed"


def test_a_chunk_that_finishes_a_block_then_fails_keeps_its_emitted_surfaces():
    """The rollback restores what the finished block emitted earlier."""
    parser = DirectJsonParser([_BASIC])
    state = _canvas(parser)
    stream = parser.open_stream(state=state)

    assert _emitted(stream.feed("<a2ui-json>[" + json.dumps(_update(_text("b"))) + ","))
    with pytest.raises(A2uiValidationError, match="Unrecognized component"):
        stream.feed(
            json.dumps(_update(_column("a", "b")))
            + "]</a2ui-json>"
            + _block(_update({"id": "x", "component": "Unknown"}))
        )

    # `b` was emitted, but the update that attached it was undone.
    assert "b" in _component_ids(state)
    parser.parse_response(_block(_CHANGE_A), state=state)
    assert _components(state)["a"]["text"] == "Changed"
