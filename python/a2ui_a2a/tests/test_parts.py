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

"""Unit tests for the A2A part helpers that read model responses."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
import json

from a2a.types import Part
import pytest

from a2ui.a2a import (
    is_a2ui_part,
    parse_content_to_parts,
    stream_response_to_parts,
    to_a2a_parts,
)
from a2ui.core import A2uiParseError
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import DirectJsonParser
from a2ui.parser import A2uiPart, TextPart
from a2ui.utils import RendererState

_BASIC = BasicCatalog("0.9")
_CREATE = {
    "version": "v0.9",
    "createSurface": {"surfaceId": "s", "catalogId": _BASIC.catalog_id},
}


async def _tokens(*tokens: str) -> AsyncIterator[str]:
    for token in tokens:
        yield token


def _read(*tokens: str) -> list[Part]:
    """Streams the tokens through a new stream and returns the parts."""

    async def collect() -> list[Part]:
        stream = DirectJsonParser([_BASIC]).open_stream()
        return [
            part async for part in stream_response_to_parts(stream, _tokens(*tokens))
        ]

    return asyncio.run(collect())


def test_the_stream_is_closed_after_the_last_token():
    """Closing emits the text held back as a possible tag."""
    parts = _read("Compare ", "a <a2u")

    assert [part.root.text for part in parts] == ["Compare", " a", " <a2u"]


def test_a_block_left_open_raises_after_the_last_token():
    with pytest.raises(A2uiParseError, match="ended inside"):
        _read("<a2ui-json>", json.dumps([_CREATE]))


def test_messages_are_emitted_as_they_arrive():
    parts = _read("<a2ui-json>", json.dumps([_CREATE]), "</a2ui-json>")

    assert [part.root.data for part in parts] == [_CREATE]


def test_to_a2a_parts_splits_messages_and_drops_empty_text():
    parts = to_a2a_parts(
        [TextPart(text="Here."), TextPart(text=""), A2uiPart(a2ui=[_CREATE])],
        version="0.9",
    )

    assert parts[0].root.text == "Here."
    assert [part.root.data for part in parts[1:]] == [_CREATE]
    assert all(is_a2ui_part(part) for part in parts[1:])


def test_parse_content_to_parts_falls_back_when_the_response_is_invalid():
    """A response that updates an unknown surface is dropped, not raised."""
    update = {
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "unknown",
            "components": [{"id": "root", "component": "Text", "text": "Hi"}],
        },
    }
    content = f"<a2ui-json>{json.dumps([update])}</a2ui-json>"

    parts = parse_content_to_parts(
        content, DirectJsonParser([_BASIC]), fallback_text="OK."
    )

    assert [part.root.text for part in parts] == ["OK."]


def test_parse_content_to_parts_checks_a_canvas_turn_against_its_state():
    """A response that updates a surface from an earlier turn is kept."""
    parser = DirectJsonParser([_BASIC])
    state = RendererState([_BASIC])
    root = {"id": "root", "component": "Text", "text": "Hi"}
    update = {
        "version": "v0.9",
        "updateComponents": {"surfaceId": "s", "components": [root]},
    }
    parse_content_to_parts(
        f"<a2ui-json>{json.dumps([_CREATE, update])}</a2ui-json>", parser, state=state
    )
    changed = {
        **update,
        "updateComponents": {"surfaceId": "s", "components": [{**root, "text": "Bye"}]},
    }

    parts = parse_content_to_parts(
        f"<a2ui-json>{json.dumps([changed])}</a2ui-json>", parser, state=state
    )

    assert [part.root.data for part in parts] == [changed]
