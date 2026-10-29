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

"""Unit tests for streaming Direct JSON responses across protocol versions.

The shared suite `conformance/agent/direct_json/response_streaming.yaml` fixes
what each chunk yields. These tests cover what it cannot state: catalogs
built in code, and several surfaces and catalogs in one stream.
"""

import json

import pytest

from a2ui.core import A2uiParseError, A2uiValidationError, Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import to_message_dicts
from a2ui.inference_formats.direct_json import DirectJsonParser
from a2ui.parser import (
    A2uiPart,
    ErrorPart,
    MSG_TYPE_BEGIN_RENDERING,
    MSG_TYPE_CREATE_SURFACE,
    MSG_TYPE_DELETE_SURFACE,
    MSG_TYPE_SURFACE_UPDATE,
    MSG_TYPE_UPDATE_COMPONENTS,
    TextPart,
)
from a2ui.constants import A2UI_CLOSE_TAG, A2UI_OPEN_TAG
from a2ui.utils import RendererState

CUSTOM_ID = "https://a2ui.org/catalogs/custom"


@pytest.fixture
def basic_catalog_v10():
    return BasicCatalog("1.0")


@pytest.fixture
def custom_catalog_v10():
    return Catalog.from_json(
        catalog_schema={
            "catalogId": CUSTOM_ID,
            "components": {
                "CustomMetric": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "component": {"const": "CustomMetric"},
                        "value": {"type": "number"},
                    },
                    "required": ["id", "component", "value"],
                },
                "CustomCard": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "component": {"const": "CustomCard"},
                        "child": {"$ref": "common_types.json#/$defs/ComponentId"},
                    },
                    "required": ["id", "component", "child"],
                },
            },
        },
        protocol_version="1.0",
        catalog_id=CUSTOM_ID,
    )


def _item_catalog(catalog_id, required):
    return Catalog.from_json(
        {
            "catalogId": catalog_id,
            "components": {
                "Item": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "component": {"const": "Item"},
                        "label": {"type": "string"},
                        "extra": {"type": "string"},
                    },
                    "required": ["id", "component", *required],
                }
            },
        },
        protocol_version="1.0",
        catalog_id=catalog_id,
    )


def _stream(parser, chunks, state=None):
    """Returns the A2UI messages the chunks yield, in order."""
    stream = parser.open_stream(state=state)
    return [
        message
        for chunk in chunks
        for part in stream.feed(chunk)
        if isinstance(part, A2uiPart)
        for message in to_message_dicts(part.a2ui)
    ]


def _components_for(messages, surface_id, key=MSG_TYPE_UPDATE_COMPONENTS):
    return [
        component
        for message in messages
        if key in message and message[key].get("surfaceId") == surface_id
        for component in message[key]["components"]
    ]


def test_create_surface_streamed_in_pieces_is_emitted_once():
    """A createSurface cut into small chunks reaches a renderer once, whole."""
    catalog = BasicCatalog("v0.9")
    parser = DirectJsonParser([catalog], progressive_keys=frozenset({"primaryColor"}))
    response = (
        A2UI_OPEN_TAG
        + '[{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId":'
        f' "{catalog.catalog_id}", "theme": {{"primaryColor": "#FF0000"}}}}}}]'
        + A2UI_CLOSE_TAG
    )

    messages = _stream(
        parser, [response[i : i + 7] for i in range(0, len(response), 7)]
    )

    assert messages == [{
        "version": "v0.9",
        "createSurface": {
            "surfaceId": "s1",
            "catalogId": catalog.catalog_id,
            "theme": {"primaryColor": "#FF0000"},
        },
    }]


def _v09_block(catalog, surface_id, root):
    """A v0.9 block that creates a surface with one root component."""
    return (
        A2UI_OPEN_TAG
        + json.dumps([
            {
                "version": "v0.9",
                "createSurface": {
                    "surfaceId": surface_id,
                    "catalogId": catalog.catalog_id,
                },
            },
            {
                "version": "v0.9",
                "updateComponents": {
                    "surfaceId": surface_id,
                    "components": [{"id": "root", **root}],
                },
            },
        ])
        + A2UI_CLOSE_TAG
    )


def _v10_create(catalog, surface_id):
    return json.dumps({
        "version": "v1.0",
        "createSurface": {"surfaceId": surface_id, "catalogId": catalog.catalog_id},
    })


_V10_BOGUS_ROOT = json.dumps({
    "version": "v1.0",
    "updateComponents": {
        "surfaceId": "main",
        "components": [{"id": "root", "component": "Bogus"}],
    },
})


def test_chunk_that_fails_keeps_and_returns_the_block_it_finished():
    """A chunk that raises keeps the block it finished, and returns it with the error."""
    catalog = BasicCatalog("v0.9")
    parser = DirectJsonParser([catalog])
    state = RendererState([catalog])
    stream = parser.open_stream(state=state)
    chunk = (
        "Before "
        + _v09_block(catalog, "s1", {"component": "Text", "text": "Hi"})
        + " between "
        + _v09_block(catalog, "s2", {"component": "Text"})
    )

    with pytest.raises(A2uiValidationError) as raised:
        stream.feed(chunk)

    partial = raised.value.partial_results
    assert [type(p) for p in partial] == [TextPart, A2uiPart, TextPart]
    assert partial[0] == TextPart(text="Before")
    assert partial[2] == TextPart(text="between")
    assert state.surface_ids == ["s1"]


def test_chunk_that_fails_returns_what_it_emitted_from_the_failing_block(
    basic_catalog_v10,
):
    stream = DirectJsonParser([basic_catalog_v10]).open_stream()
    create = _v10_create(basic_catalog_v10, "main")

    with pytest.raises(A2uiValidationError) as raised:
        stream.feed(f"{A2UI_OPEN_TAG}[{create}, {_V10_BOGUS_ROOT}")

    partial = raised.value.partial_results
    assert [to_message_dicts(p.a2ui) for p in partial] == [[json.loads(create)]]
    assert stream.state.surface_ids == ["main"]


def test_close_sets_partial_results_on_the_error_it_raises():
    stream = DirectJsonParser([BasicCatalog("v0.9")]).open_stream()
    stream.feed(f"{A2UI_OPEN_TAG}[")

    with pytest.raises(A2uiParseError) as raised:
        stream.close()

    assert raised.value.partial_results == []


def test_is_in_block_from_opening_tag_to_closing_tag():
    catalog = BasicCatalog("v0.9")
    stream = DirectJsonParser([catalog]).open_stream()

    stream.feed("Hello <a2ui")
    assert not stream.is_in_block
    stream.feed("-json>[")
    assert stream.is_in_block
    create = {
        "version": "v0.9",
        "createSurface": {"surfaceId": "s1", "catalogId": catalog.catalog_id},
    }
    stream.feed(f"{json.dumps(create)}] </a2ui")
    assert stream.is_in_block
    stream.feed("-json> after")
    assert not stream.is_in_block


def test_is_in_block_for_an_unwrapped_stream_until_it_ends():
    catalog = BasicCatalog("v0.9")
    stream = DirectJsonParser([catalog]).open_stream(wrapped=False)
    create = {
        "version": "v0.9",
        "createSurface": {"surfaceId": "s1", "catalogId": catalog.catalog_id},
    }

    assert stream.is_in_block
    stream.feed(json.dumps([create]))
    assert stream.is_in_block
    stream.close()
    assert not stream.is_in_block


def test_is_in_block_is_false_once_the_stream_ended_inside_a_block():
    stream = DirectJsonParser([BasicCatalog("v0.9")]).open_stream()
    stream.feed(f"{A2UI_OPEN_TAG}[")

    with pytest.raises(A2uiParseError):
        stream.close()

    assert not stream.is_in_block


def test_continue_returns_an_error_part_in_place_of_a_rejected_block():
    catalog = BasicCatalog("v0.9")
    stream = DirectJsonParser([catalog]).open_stream(after_rejected_block="continue")

    parts = stream.feed(
        "Before "
        + _v09_block(catalog, "s1", {"component": "Text"})
        + " between "
        + _v09_block(catalog, "s2", {"component": "Text", "text": "Hi"})
        + " after"
    )

    assert [type(p) for p in parts] == [
        TextPart,
        ErrorPart,
        TextPart,
        A2uiPart,
        TextPart,
    ]
    assert isinstance(parts[1].error, A2uiValidationError)
    assert stream.state.surface_ids == ["s2"]
    assert stream.close() == []


def test_continue_keeps_what_a_rejected_block_emitted_and_skips_the_rest(
    basic_catalog_v10,
):
    stream = DirectJsonParser([basic_catalog_v10]).open_stream(
        after_rejected_block="continue"
    )
    create = _v10_create(basic_catalog_v10, "main")
    skipped = _v10_create(basic_catalog_v10, "skipped")

    first = stream.feed(f"{A2UI_OPEN_TAG}[{create}, {_V10_BOGUS_ROOT}, ")
    second = stream.feed(f"{skipped}]{A2UI_CLOSE_TAG} Done.")

    assert [type(p) for p in first] == [A2uiPart, ErrorPart]
    assert to_message_dicts(first[0].a2ui) == [json.loads(create)]
    assert second == [TextPart(text="Done.")]
    assert stream.state.surface_ids == ["main"]


def test_continue_reports_a_block_that_cannot_be_read():
    stream = DirectJsonParser([BasicCatalog("v0.9")]).open_stream(
        after_rejected_block="continue"
    )

    parts = stream.feed(f"{A2UI_OPEN_TAG}not json{A2UI_CLOSE_TAG} after")

    assert [type(p) for p in parts] == [ErrorPart, TextPart]


def test_continue_returns_an_error_part_for_a_block_open_at_the_end():
    stream = DirectJsonParser([BasicCatalog("v0.9")]).open_stream(
        after_rejected_block="continue"
    )
    stream.feed(f"Text {A2UI_OPEN_TAG}[")

    parts = stream.close()

    assert [type(p) for p in parts] == [ErrorPart]
    assert isinstance(parts[0].error, A2uiParseError)


def test_continue_returns_an_error_part_for_a_rejected_unwrapped_response():
    stream = DirectJsonParser([BasicCatalog("v0.9")]).open_stream(
        wrapped=False, after_rejected_block="continue"
    )

    assert stream.feed("not json") == []
    assert [type(p) for p in stream.close()] == [ErrorPart]


def test_continue_still_ends_the_stream_on_an_error_that_rejects_no_block():
    stream = DirectJsonParser([BasicCatalog("v0.9")]).open_stream(
        after_rejected_block="continue"
    )
    stream.close()

    with pytest.raises(ValueError, match="The response stream is closed."):
        stream.feed("text")


def test_fenced_block_streamed_one_character_at_a_time_is_read_whole():
    """A Markdown fence that arrives in pieces is stripped, not read as JSON."""
    catalog = BasicCatalog("v0.9")
    parser = DirectJsonParser([catalog])
    create = {
        "version": "v0.9",
        "createSurface": {"surfaceId": "s1", "catalogId": catalog.catalog_id},
    }
    response = (
        A2UI_OPEN_TAG + "```json\n[" + json.dumps(create) + "]\n```" + A2UI_CLOSE_TAG
    )

    assert _stream(parser, list(response)) == [create]


def test_v10_surfaces_use_their_own_catalogs(basic_catalog_v10, custom_catalog_v10):
    """Each surface checks its components against the catalog it was created with."""
    parser = DirectJsonParser([basic_catalog_v10, custom_catalog_v10])

    messages = _stream(
        parser,
        [
            A2UI_OPEN_TAG + "[",
            (
                '{"version": "1.0", "createSurface": {"surfaceId": "surface-1",'
                f' "catalogId": "{basic_catalog_v10.catalog_id}"}}}}, '
            ),
            (
                '{"version": "1.0", "createSurface": {"surfaceId": "surface-2",'
                f' "catalogId": "{CUSTOM_ID}"}}}}, '
            ),
            (
                '{"version": "1.0", "updateComponents": {"surfaceId":'
                ' "surface-1", "components": [{"id": "root", "component": "Text",'
                ' "text": "Surface 1"}]}}, '
            ),
            (
                '{"version": "1.0", "updateComponents": {"surfaceId":'
                ' "surface-2", "components": [{"id": "root", "component":'
                ' "CustomCard", "child": "m1"}, '
            ),
            '{"id": "m1", "component": "CustomMetric", "value": 99}]}}]'
            + A2UI_CLOSE_TAG,
        ],
    )

    assert _components_for(messages, "surface-1") == [
        {"id": "root", "component": "Text", "text": "Surface 1"}
    ]
    assert _components_for(messages, "surface-2")[-2:] == [
        {"id": "root", "component": "CustomCard", "child": "m1"},
        {"id": "m1", "component": "CustomMetric", "value": 99},
    ]


@pytest.mark.parametrize(
    ("surface_catalog", "valid"),
    [("cat-b", True), ("cat-a", False)],
    ids=["catalog_allows_it", "catalog_requires_more"],
)
def test_v10_inline_components_use_the_surface_catalog(surface_catalog, valid):
    """Components inside a createSurface are checked against the catalog it names."""
    parser = DirectJsonParser([
        _item_catalog("cat-a", ["label", "extra"]),
        _item_catalog("cat-b", ["label"]),
    ])
    chunks = [
        A2UI_OPEN_TAG
        + '[{"version": "1.0", "createSurface": {"surfaceId": "s1", "catalogId":'
        f' "{surface_catalog}", "components": [{{"id": "root", "component":'
        ' "Item", "label": "ok"}',
        "]}}]" + A2UI_CLOSE_TAG,
    ]

    if valid:
        messages = _stream(parser, chunks)
        assert [m[MSG_TYPE_CREATE_SURFACE]["catalogId"] for m in messages] == [
            surface_catalog
        ]
    else:
        with pytest.raises(A2uiValidationError):
            _stream(parser, chunks)


def test_v10_deleted_surface_can_be_recreated_on_another_catalog(
    basic_catalog_v10, custom_catalog_v10
):
    """A surface deleted and created again uses the catalog it is created with."""
    parser = DirectJsonParser([basic_catalog_v10, custom_catalog_v10])

    messages = _stream(
        parser,
        [
            A2UI_OPEN_TAG + "[",
            (
                '{"version": "1.0", "createSurface": {"surfaceId": "s1",'
                f' "catalogId": "{CUSTOM_ID}"}}}}, '
            ),
            (
                '{"version": "1.0", "updateComponents": {"surfaceId": "s1",'
                ' "components": [{"id": "root", "component": "CustomMetric",'
                ' "value": 1}]}}, '
            ),
            '{"version": "1.0", "deleteSurface": {"surfaceId": "s1"}}, ',
            (
                '{"version": "1.0", "createSurface": {"surfaceId": "s1",'
                f' "catalogId": "{basic_catalog_v10.catalog_id}"}}}}, '
            ),
            '{"version": "1.0", "updateComponents": {"surfaceId": "s1",'
            ' "components": [{"id": "root", "component": "Text", "text":'
            ' "Recreated"}]}}]'
            + A2UI_CLOSE_TAG,
        ],
    )

    assert [
        m[MSG_TYPE_CREATE_SURFACE]["catalogId"]
        for m in messages
        if MSG_TYPE_CREATE_SURFACE in m
    ] == [
        CUSTOM_ID,
        basic_catalog_v10.catalog_id,
    ]
    assert len([m for m in messages if MSG_TYPE_DELETE_SURFACE in m]) == 1
    assert _components_for(messages, "s1")[-1] == {
        "id": "root",
        "component": "Text",
        "text": "Recreated",
    }


def test_v10_invalid_component_raises_when_it_closes(basic_catalog_v10):
    """An invalid v1.0 component raises on its chunk instead of stalling the stream.

    A closed component can't become valid later, so the parser doesn't hold
    back the components after it until the block ends.
    """
    stream = DirectJsonParser([basic_catalog_v10]).open_stream()

    stream.feed(
        A2UI_OPEN_TAG
        + '[{"version": "1.0", "createSurface": {"surfaceId": "main",'
        f' "catalogId": "{basic_catalog_v10.catalog_id}"}}}}, '
    )
    parts = stream.feed(
        '{"version": "1.0", "updateComponents": {"surfaceId": "main",'
        ' "components": [{"id": "root", "component": "Column",'
        ' "children": ["a", "b"]}, '
    )
    messages = [
        message
        for part in parts
        if isinstance(part, A2uiPart)
        for message in to_message_dicts(part.a2ui)
    ]
    assert "root" in [c["id"] for c in _components_for(messages, "main")]

    with pytest.raises(A2uiValidationError, match="Unrecognized component type"):
        stream.feed('{"id": "a", "component": "Bogus"}, ')


def test_v10_components_before_surface_id_waits_for_surface_id(
    basic_catalog_v10,
):
    """When components arrive before surfaceId in updateComponents, the parser waits."""
    stream = DirectJsonParser([basic_catalog_v10]).open_stream()

    stream.feed(
        A2UI_OPEN_TAG
        + '[{"version": "1.0", "createSurface": {"surfaceId": "main",'
        f' "catalogId": "{basic_catalog_v10.catalog_id}"}}}}, '
    )
    parts = stream.feed(
        '{"version": "1.0", "updateComponents": {"components": [{"id": "root",'
        ' "component": "Text", "text": "hi"}], '
    )
    assert parts == []

    parts = stream.feed('"surfaceId": "main"}}]' + A2UI_CLOSE_TAG)
    messages = [
        message
        for part in parts
        if isinstance(part, A2uiPart)
        for message in to_message_dicts(part.a2ui)
    ]
    assert _components_for(messages, "main") == [
        {"id": "root", "component": "Text", "text": "hi"}
    ]


def test_v08_deleted_surface_can_be_recreated():
    """v0.8 has no createSurface, so a surface is started over after deleteSurface."""
    parser = DirectJsonParser([BasicCatalog("v0.8")])

    messages = _stream(
        parser,
        [
            A2UI_OPEN_TAG + "[",
            '{"beginRendering": {"surfaceId": "s1", "root": "root"}}, ',
            (
                '{"surfaceUpdate": {"surfaceId": "s1", "components": [{"id":'
                ' "root", "component": {"Text": {"text": {"literalString":'
                ' "First"}}}}]}}, '
            ),
            '{"deleteSurface": {"surfaceId": "s1"}}, ',
            (
                '{"surfaceUpdate": {"surfaceId": "s1", "components": [{"id":'
                ' "root", "component": {"Text": {"text": {"literalString":'
                ' "Recreated"}}}}]}}, '
            ),
            '{"beginRendering": {"surfaceId": "s1", "root": "root"}}]' + A2UI_CLOSE_TAG,
        ],
    )

    assert len([m for m in messages if MSG_TYPE_BEGIN_RENDERING in m]) == 2
    assert _components_for(messages, "s1", MSG_TYPE_SURFACE_UPDATE)[-1] == {
        "id": "root",
        "component": {"Text": {"text": {"literalString": "Recreated"}}},
    }


def test_v08_surface_update_with_an_unknown_field_fails():
    """A v0.8 surfaceUpdate envelope with a field v0.8 does not define is rejected."""
    parser = DirectJsonParser([BasicCatalog("v0.8")])

    with pytest.raises(A2uiValidationError):
        _stream(
            parser,
            [
                A2UI_OPEN_TAG
                + '[{"beginRendering": {"surfaceId": "s1", "root": "root"}}, '
                '{"surfaceUpdate": {"surfaceId": "s1", "extra": 1, "components":'
                ' [{"id": "root", "component": {"Text": {"text": {"literalString":'
                ' "hi"}}}}]}}]'
                + A2UI_CLOSE_TAG
            ],
        )


def test_v10_message_types(basic_catalog_v10):
    """Every v1.0 message type is read, checked and passed through."""
    parser = DirectJsonParser([basic_catalog_v10])
    basic_id = basic_catalog_v10.catalog_id

    messages = _stream(
        parser,
        [
            A2UI_OPEN_TAG
            + '[{"version": "1.0", "createSurface": {"surfaceId": "s1",'
            f' "catalogId": "{basic_id}"}}}}, {{"version": "1.0",'
            ' "callRendererFunction": {"functionCallId": "c1",'
            f' "callFunction": {{"@call": "openUrl", "catalogId": "{basic_id}",'
            ' "args": {"url": "https://a2ui.org"}}}}, {"version": "1.0",'
            ' "agentFunctionResponse": {"functionCallId": "c2", "value":'
            ' {"success": true}}}, {"version": "1.0", "deleteSurface":'
            ' {"surfaceId": "s1"}}]'
            + A2UI_CLOSE_TAG
        ],
    )

    assert messages == [
        {
            "version": "1.0",
            "createSurface": {"surfaceId": "s1", "catalogId": basic_id},
        },
        {
            "version": "1.0",
            "callRendererFunction": {
                "functionCallId": "c1",
                "callFunction": {
                    "@call": "openUrl",
                    "catalogId": basic_id,
                    "args": {"url": "https://a2ui.org"},
                },
            },
        },
        {
            "version": "1.0",
            "agentFunctionResponse": {
                "functionCallId": "c2",
                "value": {"success": True},
            },
        },
        {"version": "1.0", "deleteSurface": {"surfaceId": "s1"}},
    ]


@pytest.mark.parametrize(
    "message",
    [
        (
            '{"version": "v0.9", "callRendererFunction": {"surfaceId": "s1",'
            ' "callId": "c1", "function": "alert"}}'
        ),
        '{"version": "v0.9", "agentFunctionResponse": {"callId": "c1", "result": 123}}',
    ],
    ids=["callRendererFunction", "agentFunctionResponse"],
)
def test_v09_rejects_v10_function_messages(message):
    """The v1.0 function messages are not v0.9 messages."""
    parser = DirectJsonParser([BasicCatalog("v0.9")])

    with pytest.raises(A2uiValidationError):
        _stream(parser, [A2UI_OPEN_TAG + "[" + message + "]" + A2UI_CLOSE_TAG])


@pytest.mark.parametrize(
    ("value", "healed"),
    [
        ("Hel", True),
        ("https://exa", False),
        ("http://exa", False),
        ("data:image/png;base64,iVB", False),
    ],
    ids=["text", "https", "http", "data"],
)
def test_url_value_under_a_progressive_key_is_not_healed(value, healed):
    """A cut string that starts as a URL waits, since a shorter URL is a broken one."""
    catalog = BasicCatalog("1.0")
    parser = DirectJsonParser([catalog], progressive_keys=frozenset({"greeting"}))
    create = {
        "version": "1.0",
        "createSurface": {"surfaceId": "s1", "catalogId": catalog.catalog_id},
    }
    state = RendererState([catalog])
    state.apply(create)

    messages = _stream(
        parser,
        [
            A2UI_OPEN_TAG
            + '[{"version": "1.0", "updateDataModel": {"surfaceId": "s1",'
            f' "value": {{"greeting": "{value}'
        ],
        state=state,
    )

    expected = {
        "version": "1.0",
        "updateDataModel": {"surfaceId": "s1", "value": {"greeting": value}},
    }
    assert messages == ([expected] if healed else [])


def test_stream_text_with_lone_backticks_kept(basic_catalog_v10):
    """Text chunks containing lone backticks outside blocks are preserved."""
    parser = DirectJsonParser([basic_catalog_v10])
    stream = parser.open_stream()
    parts = []
    for chunk in ["Use ", "`", "Text", "`", " for labels."]:
        parts.extend(stream.feed(chunk))
    parts.extend(stream.close())
    texts = [p.text for p in parts if isinstance(p, TextPart)]
    assert "".join(texts) == "Use `Text` for labels."
