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

"""Unit tests for `a2ui.processor.StreamedAnswer`."""

from __future__ import annotations

import json
from typing import Any

import pytest

from a2ui.constants import A2UI_CLOSE_TAG, A2UI_OPEN_TAG
from a2ui.core import (
    A2uiCatalogError,
    A2uiParseError,
    A2uiValidationError,
    MessageProcessor,
)
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import DirectJsonFormatFactory
from a2ui.parser import ErrorPart
from a2ui.processor import (
    A2uiRequestProcessor,
    AnswerSurfacePart,
    AnswerTextPart,
    StreamedAnswer,
)

_BASIC = BasicCatalog("v1.0")


def _processor() -> A2uiRequestProcessor:
    return A2uiRequestProcessor(
        catalogs=[_BASIC], format_factory=DirectJsonFormatFactory()
    )


def _answer() -> StreamedAnswer:
    return StreamedAnswer(_processor(), renderer=MessageProcessor([_BASIC]))


def _create(surface_id: str) -> str:
    return json.dumps({
        "version": "v1.0",
        "createSurface": {"surfaceId": surface_id, "catalogId": _BASIC.catalog_id},
    })


def _root(surface_id: str, component: dict[str, Any]) -> str:
    return json.dumps({
        "version": "v1.0",
        "updateComponents": {
            "surfaceId": surface_id,
            "components": [{"id": "root", **component}],
        },
    })


def _surface_block(surface_id: str) -> str:
    text = _root(surface_id, {"component": "Text", "text": "Hi"})
    return f"{A2UI_OPEN_TAG}[{_create(surface_id)}, {text}]{A2UI_CLOSE_TAG}"


def _describe(answer: StreamedAnswer) -> list[Any]:
    """The parts of an answer, each surface by its id and each error by its class."""
    described: list[Any] = []
    for part in answer.parts:
        if isinstance(part, AnswerSurfacePart):
            described.append({"surface": part.surface.id})
        elif isinstance(part, ErrorPart):
            described.append({"error": type(part.error)})
        else:
            described.append(part.text)
    return described


def test_keeps_the_text_and_surfaces_in_the_order_the_model_wrote_them():
    answer = _answer()

    for chunk in [
        "Here ",
        "it is: ",
        _surface_block("a"),
        " and ",
        _surface_block("b"),
    ]:
        answer.feed(chunk)
    answer.feed(" Done.")
    answer.close()

    assert _describe(answer) == [
        "Here it is:",
        {"surface": "a"},
        "and",
        {"surface": "b"},
        "Done.",
    ]


def test_puts_each_surface_in_the_renderers_model():
    renderer = MessageProcessor([_BASIC])
    answer = StreamedAnswer(_processor(), renderer=renderer)

    answer.feed(_surface_block("a"))

    part = answer.parts[0]
    assert isinstance(part, AnswerSurfacePart)
    assert part.surface is renderer.model.get_surface("a")
    assert answer.renderer is renderer


def test_shows_a_rejected_block_as_an_error_and_goes_on_after_it():
    answer = _answer()
    bad = (
        f"{A2UI_OPEN_TAG}[{_create('bad')}, {_root('bad', {'component': 'Bogus'})}]"
        f"{A2UI_CLOSE_TAG}"
    )

    answer.feed(f"Before {bad} after {_surface_block('good')}")
    answer.close()

    # The block arrived whole, so none of it was emitted.
    assert _describe(answer) == [
        "Before",
        {"error": A2uiValidationError},
        "after",
        {"surface": "good"},
    ]


def test_keeps_a_surface_a_rejected_block_created_before_it_was_rejected():
    answer = _answer()

    answer.feed(f"{A2UI_OPEN_TAG}[{_create('a')}, ")
    answer.feed(f"{_root('a', {'component': 'Bogus'})}]{A2UI_CLOSE_TAG} after")

    assert [type(p) for p in answer.parts] == [
        AnswerSurfacePart,
        ErrorPart,
        AnswerTextPart,
    ]
    assert isinstance(answer.parts[1], ErrorPart)
    assert isinstance(answer.parts[1].error, A2uiValidationError)


def test_adds_an_error_for_a_block_still_open_when_the_answer_ends():
    answer = _answer()

    answer.feed(f"Text {A2UI_OPEN_TAG}[")
    answer.close()

    assert _describe(answer) == ["Text", {"error": A2uiParseError}]


def test_drops_a_surface_the_answer_deletes():
    answer = _answer()
    remove = json.dumps({"version": "v1.0", "deleteSurface": {"surfaceId": "a"}})

    answer.feed(
        f"{_surface_block('a')} {_surface_block('b')}"
        f" {A2UI_OPEN_TAG}{remove}{A2UI_CLOSE_TAG}"
    )

    assert _describe(answer) == [{"surface": "b"}]


def test_replaces_its_parts_when_they_change_and_only_then():
    answer = _answer()
    answer.feed("Hello")
    before = answer.parts

    answer.feed(" <a2ui")
    assert answer.parts is before
    answer.feed("-json>")
    answer.feed(f"[{_create('a')}]")

    assert answer.parts is not before
    assert list(before) == [AnswerTextPart(text="Hello")]


def test_says_whether_it_ends_inside_a_block():
    answer = _answer()

    answer.feed(f"Text {A2UI_OPEN_TAG}[")
    assert answer.is_in_block
    answer.feed(f"]{A2UI_CLOSE_TAG}")
    assert not answer.is_in_block


def test_rejects_a_renderer_whose_catalogs_are_not_the_processors():
    renderer = MessageProcessor([BasicCatalog("v0.9")])

    with pytest.raises(A2uiCatalogError):
        StreamedAnswer(_processor(), renderer=renderer)
