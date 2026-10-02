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

"""Unit tests for DirectJsonStreamParser v1.0 implementation."""

import pytest

from a2ui.core import Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json.streaming import DirectJsonStreamParser
from a2ui.inference_formats.direct_json.streaming_v09 import (
    DirectJsonStreamParserV09,
    DirectJsonStreamParserV10,
)
from a2ui.parser.constants import (
    MSG_TYPE_CREATE_SURFACE,
    MSG_TYPE_DELETE_SURFACE,
    MSG_TYPE_UPDATE_COMPONENTS,
    MSG_TYPE_UPDATE_DATA_MODEL,
)
from a2ui.schema.constants import (
    A2UI_CLOSE_TAG,
    A2UI_OPEN_TAG,
)


@pytest.fixture
def basic_catalog_v10():
    return BasicCatalog("v1.0")


@pytest.fixture
def custom_catalog_v10():
    return Catalog.from_json(
        catalog_schema={
            "catalogId": "https://a2ui.org/catalogs/custom",
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
        catalog_id="https://a2ui.org/catalogs/custom",
    )


def test_v10_parser_class_selection(basic_catalog_v10):
    """Verifies that DirectJsonStreamParser selects DirectJsonStreamParserV10 for v1.0."""
    parser_v10 = DirectJsonStreamParser(catalogs=[basic_catalog_v10])
    assert isinstance(parser_v10, DirectJsonStreamParserV10)

    basic_catalog_v09 = BasicCatalog("v0.9")
    parser_v09 = DirectJsonStreamParser(catalogs=[basic_catalog_v09])
    assert isinstance(parser_v09, DirectJsonStreamParserV09)
    assert not isinstance(parser_v09, DirectJsonStreamParserV10)


def test_v10_multiple_catalogs_supported(basic_catalog_v10, custom_catalog_v10):
    """Verifies that multiple v1.0 catalogs can be configured and components resolved."""
    parser = DirectJsonStreamParser(catalogs=[basic_catalog_v10, custom_catalog_v10])
    assert parser.catalogs == [basic_catalog_v10, custom_catalog_v10]

    # Resolve child fields for standard component from basic catalog
    basic_child_fields = parser._get_child_fields_for_obj(
        {"component": "Column", "id": "col1", "children": ["c1", "c2"]}
    )
    assert "children" in basic_child_fields

    # Resolve child fields for custom component from second catalog
    custom_child_fields = parser._get_child_fields_for_obj(
        {"component": "CustomCard", "id": "card1", "child": "c1"}
    )
    assert "child" in custom_child_fields


def test_v10_streaming_incremental_tokens(basic_catalog_v10, custom_catalog_v10):
    """Verifies streaming incremental token parsing with multiple catalogs."""
    parser = DirectJsonStreamParser(catalogs=[basic_catalog_v10, custom_catalog_v10])
    parser._validator = None

    chunks = [
        A2UI_OPEN_TAG,
        '[{"version": "v1.0", "createSurface": {"surfaceId": "main", ',
        '"catalogId": "https://a2ui.org/catalogs/basic"}}, ',
        '{"version": "v1.0", "updateComponents": {"surfaceId": "main", ',
        (
            '"components": [{"id": "root", "component": "Column", "children": ["t1",'
            ' "m1"]}, '
        ),
        '{"id": "t1", "component": "Text", "text": "Users"}, ',
        '{"id": "m1", "component": "CustomMetric", "value": 42}]}}]' + A2UI_CLOSE_TAG,
    ]

    all_messages = []
    for chunk in chunks:
        for part in parser.process_chunk(chunk):
            if part.a2ui_json:
                all_messages.extend(part.a2ui_json)

    assert len(all_messages) >= 2
    # Verify createSurface
    create_msgs = [m for m in all_messages if MSG_TYPE_CREATE_SURFACE in m]
    assert len(create_msgs) == 1
    assert create_msgs[0][MSG_TYPE_CREATE_SURFACE]["surfaceId"] == "main"
    assert create_msgs[0]["version"] == "v1.0"

    # Verify updateComponents
    update_msgs = [m for m in all_messages if MSG_TYPE_UPDATE_COMPONENTS in m]
    assert len(update_msgs) >= 1
    comp_ids = [
        c["id"]
        for m in update_msgs
        for c in m[MSG_TYPE_UPDATE_COMPONENTS]["components"]
    ]
    assert "root" in comp_ids
    assert "t1" in comp_ids
    assert "m1" in comp_ids


def test_v10_multi_surface_streaming(basic_catalog_v10, custom_catalog_v10):
    """Verifies streaming components across multiple surfaces."""
    parser = DirectJsonStreamParser(catalogs=[basic_catalog_v10, custom_catalog_v10])
    parser._validator = None

    payload = (
        A2UI_OPEN_TAG
        + "["
        + '{"version": "v1.0", "createSurface": {"surfaceId": "surface-1", "catalogId":'
        ' "https://a2ui.org/catalogs/basic"}}, '
        + '{"version": "v1.0", "createSurface": {"surfaceId": "surface-2", "catalogId":'
        ' "https://a2ui.org/catalogs/custom"}}, '
        + '{"version": "v1.0", "updateComponents": {"surfaceId": "surface-1",'
        ' "components": [{"id": "root", "component": "Text", "text": "Surface'
        ' 1"}]}}, '
        + '{"version": "v1.0", "updateComponents": {"surfaceId": "surface-2",'
        ' "components": [{"id": "root", "component": "CustomMetric", "value": 99}]}}'
        + "]"
        + A2UI_CLOSE_TAG
    )

    messages = []
    for part in parser.process_chunk(payload):
        if part.a2ui_json:
            messages.extend(part.a2ui_json)

    s1_updates = [
        m
        for m in messages
        if MSG_TYPE_UPDATE_COMPONENTS in m
        and m[MSG_TYPE_UPDATE_COMPONENTS].get("surfaceId") == "surface-1"
    ]
    s2_updates = [
        m
        for m in messages
        if MSG_TYPE_UPDATE_COMPONENTS in m
        and m[MSG_TYPE_UPDATE_COMPONENTS].get("surfaceId") == "surface-2"
    ]

    assert len(s1_updates) >= 1
    assert (
        s1_updates[0][MSG_TYPE_UPDATE_COMPONENTS]["components"][0]["text"]
        == "Surface 1"
    )

    assert len(s2_updates) >= 1
    assert s2_updates[0][MSG_TYPE_UPDATE_COMPONENTS]["components"][0]["value"] == 99


def test_v10_message_types(basic_catalog_v10):
    """Verifies recognition and parsing of all v1.0 message types."""
    parser = DirectJsonStreamParser(catalogs=[basic_catalog_v10])
    parser._validator = None

    # Test is_protocol_msg recognizes v1.0 message types
    assert parser.is_protocol_msg(
        {"version": "v1.0", MSG_TYPE_CREATE_SURFACE: {"surfaceId": "s1"}}
    )
    assert parser.is_protocol_msg({
        "version": "v1.0",
        MSG_TYPE_UPDATE_COMPONENTS: {"surfaceId": "s1", "components": []},
    })
    assert parser.is_protocol_msg({
        "version": "v1.0",
        MSG_TYPE_UPDATE_DATA_MODEL: {"surfaceId": "s1", "value": {}},
    })
    assert parser.is_protocol_msg(
        {"version": "v1.0", MSG_TYPE_DELETE_SURFACE: {"surfaceId": "s1"}}
    )
    assert parser.is_protocol_msg({
        "version": "v1.0",
        "callRendererFunction": {"surfaceId": "s1", "callId": "c1", "function": "foo"},
    })
    assert parser.is_protocol_msg(
        {"version": "v1.0", "agentFunctionResponse": {"callId": "c1", "result": 123}}
    )

    # Stream createSurface, callRendererFunction, agentFunctionResponse, and deleteSurface
    stream_payload = (
        A2UI_OPEN_TAG
        + "["
        + '{"version": "v1.0", "createSurface": {"surfaceId": "s1", "catalogId":'
        ' "https://a2ui.org/catalogs/basic"}}, '
        + '{"version": "v1.0", "callRendererFunction": {"surfaceId": "s1", "callId":'
        ' "c1", "function": "alert", "arguments": {"message": "hi"}}}, '
        + '{"version": "v1.0", "agentFunctionResponse": {"callId": "c2", "result":'
        ' {"success": true}}}, '
        + '{"version": "v1.0", "deleteSurface": {"surfaceId": "s1"}}'
        + "]"
        + A2UI_CLOSE_TAG
    )

    messages = []
    for part in parser.process_chunk(stream_payload):
        if part.a2ui_json:
            messages.extend(part.a2ui_json)

    assert len(messages) == 4
    assert messages[0] == {
        "version": "v1.0",
        "createSurface": {
            "surfaceId": "s1",
            "catalogId": "https://a2ui.org/catalogs/basic",
        },
    }
    assert messages[1] == {
        "version": "v1.0",
        "callRendererFunction": {
            "surfaceId": "s1",
            "callId": "c1",
            "function": "alert",
            "arguments": {"message": "hi"},
        },
    }
    assert messages[2] == {
        "version": "v1.0",
        "agentFunctionResponse": {
            "callId": "c2",
            "result": {"success": True},
        },
    }
    assert messages[3] == {"version": "v1.0", "deleteSurface": {"surfaceId": "s1"}}
