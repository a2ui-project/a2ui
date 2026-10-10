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

"""Unit tests for DirectJsonParser.parse_chunk across protocol versions.

The shared suite `conformance/agent/direct_json/response_streaming.yaml` fixes
what each chunk yields. These tests cover what it cannot state: catalogs
built in code, and several surfaces and catalogs in one stream.
"""

import pytest

from a2ui.core import A2uiValidationError, Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats import to_message_dicts
from a2ui.inference_formats.direct_json import DirectJsonParser
from a2ui.parser import (
    A2uiPart,
    MSG_TYPE_BEGIN_RENDERING,
    MSG_TYPE_CREATE_SURFACE,
    MSG_TYPE_DELETE_SURFACE,
    MSG_TYPE_SURFACE_UPDATE,
    MSG_TYPE_UPDATE_COMPONENTS,
)
from a2ui.schema import A2UI_CLOSE_TAG, A2UI_OPEN_TAG

CUSTOM_ID = "https://a2ui.org/catalogs/custom"


@pytest.fixture
def basic_catalog_v10():
    return BasicCatalog("v1.0")


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
                        "child": {"type": "string"},
                    },
                    "required": ["id", "component", "child"],
                },
            },
        },
        protocol_version="v1.0",
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
        protocol_version="v1.0",
        catalog_id=catalog_id,
    )


def _stream(parser, chunks):
    """Returns the A2UI messages the chunks yield, in order."""
    return [
        message
        for chunk in chunks
        for part in parser.parse_chunk(chunk)
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


def test_v10_surfaces_use_their_own_catalogs(basic_catalog_v10, custom_catalog_v10):
    """Each surface checks its components against the catalog it was created with."""
    parser = DirectJsonParser([basic_catalog_v10, custom_catalog_v10])

    messages = _stream(
        parser,
        [
            A2UI_OPEN_TAG + "[",
            (
                '{"version": "v1.0", "createSurface": {"surfaceId": "surface-1",'
                f' "catalogId": "{basic_catalog_v10.catalog_id}"}}}}, '
            ),
            (
                '{"version": "v1.0", "createSurface": {"surfaceId": "surface-2",'
                f' "catalogId": "{CUSTOM_ID}"}}}}, '
            ),
            (
                '{"version": "v1.0", "updateComponents": {"surfaceId": "surface-1",'
                ' "components": [{"id": "root", "component": "Text", "text": "Surface'
                ' 1"}]}}, '
            ),
            (
                '{"version": "v1.0", "updateComponents": {"surfaceId": "surface-2",'
                ' "components": [{"id": "root", "component": "CustomCard", "child":'
                ' "m1"}, '
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
        + '[{"version": "v1.0", "createSurface": {"surfaceId": "s1", "catalogId":'
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
                '{"version": "v1.0", "createSurface": {"surfaceId": "s1",'
                f' "catalogId": "{CUSTOM_ID}"}}}}, '
            ),
            (
                '{"version": "v1.0", "updateComponents": {"surfaceId": "s1",'
                ' "components": [{"id": "root", "component": "CustomMetric", "value":'
                " 1}]}}, "
            ),
            '{"version": "v1.0", "deleteSurface": {"surfaceId": "s1"}}, ',
            (
                '{"version": "v1.0", "createSurface": {"surfaceId": "s1",'
                f' "catalogId": "{basic_catalog_v10.catalog_id}"}}}}, '
            ),
            '{"version": "v1.0", "updateComponents": {"surfaceId": "s1",'
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
    parser = DirectJsonParser([basic_catalog_v10])

    parser.parse_chunk(
        A2UI_OPEN_TAG
        + '[{"version": "v1.0", "createSurface": {"surfaceId": "main",'
        f' "catalogId": "{basic_catalog_v10.catalog_id}"}}}}, '
    )
    parts = parser.parse_chunk(
        '{"version": "v1.0", "updateComponents": {"surfaceId": "main",'
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
        parser.parse_chunk('{"id": "a", "component": "Bogus"}, ')


def test_v08_deleted_surface_can_be_recreated():
    """v0.8 has no createSurface, so a surface is started over after deleteSurface."""
    parser = DirectJsonParser([BasicCatalog("v0.8")])

    messages = _stream(
        parser,
        [
            A2UI_OPEN_TAG + "[",
            '{"beginRendering": {"surfaceId": "s1", "root": "root"}}, ',
            (
                '{"surfaceUpdate": {"surfaceId": "s1", "components": [{"id": "root",'
                ' "component": {"Text": {"text": {"literalString": "First"}}}}]}}, '
            ),
            '{"deleteSurface": {"surfaceId": "s1"}}, ',
            (
                '{"surfaceUpdate": {"surfaceId": "s1", "components": [{"id": "root",'
                ' "component": {"Text": {"text": {"literalString": "Recreated"}}}}]}}, '
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
            + '[{"version": "v1.0", "createSurface": {"surfaceId": "s1", "catalogId":'
            f' "{basic_id}"}}}}, '
            '{"version": "v1.0", "callRendererFunction": {"functionCallId": "c1",'
            f' "callFunction": {{"@call": "openUrl", "catalogId": "{basic_id}",'
            ' "args": {"url": "https://a2ui.org"}}}}, '
            '{"version": "v1.0", "agentFunctionResponse": {"functionCallId": "c2",'
            ' "value": {"success": true}}}, '
            '{"version": "v1.0", "deleteSurface": {"surfaceId": "s1"}}]'
            + A2UI_CLOSE_TAG
        ],
    )

    assert messages == [
        {
            "version": "v1.0",
            "createSurface": {"surfaceId": "s1", "catalogId": basic_id},
        },
        {
            "version": "v1.0",
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
            "version": "v1.0",
            "agentFunctionResponse": {
                "functionCallId": "c2",
                "value": {"success": True},
            },
        },
        {"version": "v1.0", "deleteSurface": {"surfaceId": "s1"}},
    ]


@pytest.mark.parametrize(
    "message",
    [
        (
            '{"version": "v0.9", "callRendererFunction": {"surfaceId": "s1", "callId":'
            ' "c1", "function": "alert"}}'
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
    catalog = BasicCatalog("v1.0")
    parser = DirectJsonParser([catalog], progressive_keys=frozenset({"greeting"}))

    messages = _stream(
        parser,
        [
            A2UI_OPEN_TAG
            + '[{"version": "v1.0", "updateDataModel": {"surfaceId": "s1", "value":'
            f' {{"greeting": "{value}'
        ],
    )

    expected = {
        "version": "v1.0",
        "updateDataModel": {"surfaceId": "s1", "value": {"greeting": value}},
    }
    assert messages == ([expected] if healed else [])
