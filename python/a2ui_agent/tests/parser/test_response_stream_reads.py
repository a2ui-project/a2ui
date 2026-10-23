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

"""How much of a streamed Direct JSON response each chunk reads and checks."""

from __future__ import annotations

import json
from typing import Any

import pytest

from a2ui.core import A2uiIntegrityError
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import to_message_dicts
from a2ui.inference_formats.direct_json import DirectJsonParser
from a2ui.parser import A2uiPart
from a2ui.utils import RendererState


class _CountingState(RendererState):
    """A state that records the messages applied to it."""

    def __init__(self, catalogs: Any) -> None:
        super().__init__(catalogs)
        self.applied: list[dict[str, Any]] = []

    def apply(self, payload: Any) -> list[str]:
        touched = super().apply(payload)
        self.applied.extend(to_message_dicts(list(payload)))
        return touched


def _chunks(text: str, size: int) -> list[str]:
    return [text[i : i + size] for i in range(0, len(text), size)]


def _stream(
    catalog: Any, payload: Any, size: int = 7, progressive_keys: Any = ()
) -> tuple[_CountingState, list[dict[str, Any]]]:
    state = _CountingState([catalog])
    parser = DirectJsonParser([catalog], progressive_keys=frozenset(progressive_keys))
    stream = parser.open_stream(state=state)
    emitted: list[dict[str, Any]] = []
    for chunk in _chunks(f"<a2ui-json>{json.dumps(payload)}</a2ui-json>", size):
        for part in stream.feed(chunk):
            if isinstance(part, A2uiPart):
                emitted.extend(to_message_dicts(part.a2ui))
    stream.close()
    return state, emitted


def _components(messages: list[dict[str, Any]]) -> list[str]:
    return [
        component["id"]
        for message in messages
        for key in ("updateComponents", "surfaceUpdate")
        if key in message
        for component in message[key]["components"]
    ]


_V10 = BasicCatalog("1.0")
_V09 = BasicCatalog("0.9")


def _create(catalog: Any, version: str) -> dict[str, Any]:
    return {
        "version": version,
        "createSurface": {"surfaceId": "s", "catalogId": catalog.catalog_id},
    }


def _texts(version: str, ids: list[str]) -> dict[str, Any]:
    return {
        "version": version,
        "updateComponents": {
            "surfaceId": "s",
            "components": [
                {"id": "root", "component": "Column", "children": ids},
                *({"id": i, "component": "Text", "text": f"Text {i}"} for i in ids),
            ],
        },
    }


def test_each_message_that_closed_is_applied_once():
    ids = [f"t{i}" for i in range(20)]
    payload = [
        _create(_V10, "v1.0"),
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s",
                "components": [{"id": "root", "component": "Column", "children": ids}],
            },
        },
        *(
            {
                "version": "v1.0",
                "updateComponents": {
                    "surfaceId": "s",
                    "components": [{"id": i, "component": "Text", "text": i}],
                },
            }
            for i in ids
        ),
    ]

    state, _ = _stream(_V10, payload)

    assert _components(state.applied) == ["root", *ids]


def test_a_growing_message_applies_only_the_components_it_gains():
    ids = [f"t{i}" for i in range(20)]

    state, emitted = _stream(_V10, [_create(_V10, "v1.0"), _texts("v1.0", ids)])

    # Each component is applied once, though the message is emitted again as
    # it grows, each time with every component it holds so far.
    assert _components(state.applied) == ["root", *ids]
    assert _components(emitted[-1:]) == ["root", *ids]
    assert len(emitted) > 2


def test_a_healed_component_is_applied_again_only_while_it_grows():
    ids = ["a", "b"]

    state, emitted = _stream(
        _V09, [_create(_V09, "v0.9"), _texts("v0.9", ids)], progressive_keys=["text"]
    )

    applied = _components(state.applied)
    # Before v1.0 the last component is healed, so it is applied again as its
    # text grows, but a component that closed is not.
    assert applied[0] == "root"
    assert applied.count("a") > 1
    assert applied[applied.index("b") :].count("a") == 0
    surface = state.get_surface("s")
    assert surface is not None
    assert surface.components_model.get("b").properties["text"] == "Text b"
    assert emitted[-1]["updateComponents"]["components"][-1]["text"] == "Text b"


def test_a_data_model_update_is_emitted_as_it_grows_and_applied_once_it_closes():
    value = {"items": [{"name": f"Item {i}"} for i in range(10)]}
    payload = [
        _create(_V10, "v1.0"),
        {"version": "v1.0", "updateDataModel": {"surfaceId": "s", "value": value}},
    ]

    state, emitted = _stream(_V10, payload)

    data_models = [m for m in state.applied if "updateDataModel" in m]
    # Applied when it first reads, and again in full once it closes.
    assert len(data_models) == 2
    assert data_models[-1]["updateDataModel"]["value"] == value
    assert len([m for m in emitted if "updateDataModel" in m]) > 2
    surface = state.get_surface("s")
    assert surface is not None
    assert surface.data_model.get("/") == value


def test_a_function_call_is_held_until_its_object_closes():
    payload = [
        _create(_V10, "v1.0"),
        {
            "version": "v1.0",
            "callRendererFunction": {
                "functionCallId": "c1",
                "callFunction": {
                    "@call": "openUrl",
                    "args": {"url": "https://a2ui.org"},
                    "catalogId": _V10.catalog_id,
                },
            },
        },
    ]

    _, emitted = _stream(_V10, payload, size=3)

    assert [next(k for k in m if k != "version") for m in emitted] == [
        "createSurface",
        "callRendererFunction",
    ]


def test_a_component_id_repeated_in_a_growing_message_is_rejected():
    payload = [
        _create(_V10, "v1.0"),
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s",
                "components": [
                    {"id": "root", "component": "Column", "children": ["a"]},
                    {"id": "a", "component": "Text", "text": "One"},
                    {"id": "a", "component": "Text", "text": "Two"},
                ],
            },
        },
    ]

    with pytest.raises(A2uiIntegrityError, match="Duplicate component ID 'a'"):
        _stream(_V10, payload)


@pytest.mark.parametrize("size", [1, 2, 3, 5, 8, 1000])
def test_a_close_tag_in_a_string_does_not_end_the_block_however_it_is_cut(size):
    text = 'A \\" quote and a </a2ui-json> tag'
    payload = [
        _create(_V10, "v1.0"),
        {
            "version": "v1.0",
            "updateComponents": {
                "surfaceId": "s",
                "components": [{"id": "root", "component": "Text", "text": text}],
            },
        },
    ]
    response = f"<a2ui-json>{json.dumps(payload)}</a2ui-json> after"
    stream = DirectJsonParser([_V10]).open_stream()

    parts = [p for chunk in _chunks(response, size) for p in stream.feed(chunk)]
    parts += stream.close()

    messages = [
        m for p in parts if isinstance(p, A2uiPart) for m in to_message_dicts(p.a2ui)
    ]
    assert messages[-1]["updateComponents"]["components"][0]["text"] == text
    assert "".join(p.text for p in parts if not isinstance(p, A2uiPart)) == "after"
