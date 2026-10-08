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

"""Unit tests for DirectJsonParser streaming with v1.0 catalogs."""

from __future__ import annotations

import pytest

from a2ui.core import A2uiValidationError, Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import DirectJsonParser
from a2ui.schema.constants import (
    A2UI_CLOSE_TAG,
    A2UI_OPEN_TAG,
)

MSG_TYPE_CREATE_SURFACE = "createSurface"
MSG_TYPE_DELETE_SURFACE = "deleteSurface"
MSG_TYPE_UPDATE_COMPONENTS = "updateComponents"

BASIC_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
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


def _stream(parser, chunks):
    messages = []
    for chunk in chunks:
        for part in parser.parse_chunk(chunk):
            if part.a2ui:
                for msg in part.a2ui:
                    messages.append(msg.model_dump(by_alias=True, exclude_none=True))
    return messages


def _stream_steps(parser, chunks):
    """Returns the A2UI messages each chunk yields, one list per chunk."""
    return [
        [
            m.model_dump(by_alias=True, exclude_none=True)
            for part in parser.parse_chunk(chunk)
            for m in part.a2ui or []
        ]
        for chunk in chunks
    ]


def _components_for(messages, surface_id):
    return [
        c
        for m in messages
        if MSG_TYPE_UPDATE_COMPONENTS in m
        and m[MSG_TYPE_UPDATE_COMPONENTS].get("surfaceId") == surface_id
        for c in m[MSG_TYPE_UPDATE_COMPONENTS]["components"]
    ]


def test_v10_basic_catalog_id_matches_fixture(basic_catalog_v10):
    assert basic_catalog_v10.catalog_id == BASIC_ID


def test_v10_component_catalog_overrides_surface_catalog(
    basic_catalog_v10, custom_catalog_v10
):
    """Components resolve against their own catalogId, then the surface's."""
    parser = DirectJsonParser([basic_catalog_v10, custom_catalog_v10])

    messages = _stream(
        parser,
        [
            A2UI_OPEN_TAG,
            '[{"version": "v1.0", "createSurface": {"surfaceId": "main", ',
            f'"catalogId": "{BASIC_ID}"}}}}, ',
            '{"version": "v1.0", "updateComponents": {"surfaceId": "main", ',
            (
                '"components": [{"id": "root", "component": "Column", "children":'
                ' ["t1", "m1"]}, '
            ),
            '{"id": "t1", "component": "Text", "text": "Users"}, ',
            f'{{"id": "m1", "catalogId": "{CUSTOM_ID}", "component": "CustomMetric"',
            ', "value": 42}',
            "]}}]" + A2UI_CLOSE_TAG,
        ],
    )

    create_msgs = [m for m in messages if MSG_TYPE_CREATE_SURFACE in m]
    assert create_msgs[-1] == {
        "version": "v1.0",
        "createSurface": {"surfaceId": "main", "catalogId": BASIC_ID},
    }
    components = {c["id"]: c for c in _components_for(messages, "main")}
    assert {"root", "t1", "m1"} <= set(components)
    assert components["m1"]["value"] == 42
    assert all(
        m["version"] == "v1.0" for m in messages if MSG_TYPE_UPDATE_COMPONENTS in m
    )


def test_v10_component_without_catalog_uses_surface_catalog(
    basic_catalog_v10, custom_catalog_v10
):
    """A component that names no catalog isn't looked up in the other catalogs."""
    parser = DirectJsonParser([basic_catalog_v10, custom_catalog_v10])

    _stream_steps(
        parser,
        [
            A2UI_OPEN_TAG
            + '[{"version": "v1.0", "createSurface": {"surfaceId": "main",'
            f' "catalogId": "{BASIC_ID}"}}}}, ',
            (
                '{"version": "v1.0", "updateComponents": {"surfaceId": "main",'
                ' "components": [{"id": "root", "component": "CustomMetric"'
            ),
        ],
    )
    with pytest.raises(A2uiValidationError):
        parser.parse_chunk(', "value": 1}]}}]' + A2UI_CLOSE_TAG)


def test_v10_component_with_late_catalog_id_succeeds_once_closed(
    basic_catalog_v10, custom_catalog_v10
):
    """A component with a late catalogId picks its catalog once complete."""
    parser = DirectJsonParser([basic_catalog_v10, custom_catalog_v10])

    messages = _stream(
        parser,
        [
            A2UI_OPEN_TAG
            + '[{"version": "v1.0", "createSurface": {"surfaceId": "main",'
            f' "catalogId": "{BASIC_ID}"}}}}, ',
            (
                '{"version": "v1.0", "updateComponents": {"surfaceId": "main",'
                ' "components": [{"id": "root", "component": "CustomMetric",'
                ' "value": 42'
            ),
            ', "catalogId": "https://a2ui.org/cata',
            'logs/custom"',
            "}",
            "]}}]" + A2UI_CLOSE_TAG,
        ],
    )

    assert _components_for(messages, "main") == [{
        "id": "root",
        "component": "CustomMetric",
        "value": 42,
        "catalogId": CUSTOM_ID,
    }]


def test_v09_progressive_text_heals_partial_component():
    """v0.9 components yield while a progressive string arrives."""
    parser = DirectJsonParser(
        [BasicCatalog("v0.9")], progressive_keys=frozenset({"text"})
    )
    basic_v09_id = BasicCatalog("v0.9").catalog_id

    steps = _stream_steps(
        parser,
        [
            A2UI_OPEN_TAG
            + '[{"version": "v0.9", "createSurface": {"surfaceId": "main",'
            f' "catalogId": "{basic_v09_id}"}}}}, ',
            (
                '{"version": "v0.9", "updateComponents": {"surfaceId": "main",'
                ' "components": [{"id": "root", "component": "Text", "text": "Hel'
            ),
        ],
    )

    assert _components_for(steps[1], "main") == [
        {"id": "root", "component": "Text", "text": "Hel"}
    ]


def test_v10_surfaces_use_their_own_catalogs(basic_catalog_v10, custom_catalog_v10):
    """Each surface resolves components against the catalog it was created with across chunks."""
    parser = DirectJsonParser([basic_catalog_v10, custom_catalog_v10])

    messages = _stream(
        parser,
        [
            A2UI_OPEN_TAG + "[",
            (
                '{"version": "v1.0", "createSurface": {"surfaceId": "surface-1",'
                f' "catalogId": "{BASIC_ID}"}}}}, '
            ),
            (
                '{"version": "v1.0", "createSurface": {"surfaceId": "surface-2",'
                f' "catalogId": "{CUSTOM_ID}"}}}}, '
            ),
            (
                '{"version": "v1.0", "updateComponents": {"surfaceId": "surface-1",'
                ' "components": [{"id": "root", "component": "Text", "text": "Sur'
            ),
            'face 1"}]}}, ',
            (
                '{"version": "v1.0", "updateComponents": {"surfaceId": "surface-2",'
                ' "components": [{"id": "root", "component": "CustomCard", "child":'
                ' "m1"}, '
            ),
            '{"id": "m1", "component": "CustomMetric", "value": 99}]}}]'
            + A2UI_CLOSE_TAG,
        ],
    )

    assert _components_for(messages, "surface-1")[-1] == {
        "id": "root",
        "component": "Text",
        "text": "Surface 1",
    }
    s2_components = {c["id"]: c for c in _components_for(messages, "surface-2")}
    assert s2_components == {
        "root": {"id": "root", "component": "CustomCard", "child": "m1"},
        "m1": {"id": "m1", "component": "CustomMetric", "value": 99},
    }


def test_v10_deleted_surface_forgets_its_catalog_and_can_be_recreated(
    basic_catalog_v10, custom_catalog_v10
):
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
                f' "catalogId": "{BASIC_ID}"}}}}, '
            ),
            '{"version": "v1.0", "updateComponents": {"surfaceId": "s1", "components":'
            ' [{"id": "root", "component": "Text", "text": "Recreated"}]}}]'
            + A2UI_CLOSE_TAG,
        ],
    )
    create_msgs = [m for m in messages if MSG_TYPE_CREATE_SURFACE in m]
    assert len(create_msgs) == 2
    delete_msgs = [m for m in messages if MSG_TYPE_DELETE_SURFACE in m]
    assert len(delete_msgs) == 1
    assert _components_for(messages, "s1")[-1] == {
        "id": "root",
        "component": "Text",
        "text": "Recreated",
    }


def test_v10_message_types(basic_catalog_v10):
    """Recognizes, validates, and passes through every v1.0 message type."""
    parser = DirectJsonParser([basic_catalog_v10])

    messages = _stream(
        parser,
        [
            A2UI_OPEN_TAG
            + "["
            + '{"version": "v1.0", "createSurface": {"surfaceId": "s1", "catalogId":'
            f' "{BASIC_ID}"}}}}, '
            + '{"version": "v1.0", "callRendererFunction": {"functionCallId": "c1",'
            f' "callFunction": {{"@call": "openUrl", "catalogId": "{BASIC_ID}",'
            ' "args": {"url": "https://a2ui.org"}}}}, '
            + '{"version": "v1.0", "agentFunctionResponse": {"functionCallId": "c2",'
            ' "value": {"success": true}}}, '
            + '{"version": "v1.0", "deleteSurface": {"surfaceId": "s1"}}'
            + "]"
            + A2UI_CLOSE_TAG
        ],
    )

    assert messages == [
        {
            "version": "v1.0",
            "createSurface": {"surfaceId": "s1", "catalogId": BASIC_ID},
        },
        {
            "version": "v1.0",
            "callRendererFunction": {
                "functionCallId": "c1",
                "callFunction": {
                    "@call": "openUrl",
                    "catalogId": BASIC_ID,
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


def test_v09_does_not_recognize_v10_function_messages():
    parser = DirectJsonParser([BasicCatalog("v0.9")])
    with pytest.raises(A2uiValidationError):
        _stream(
            parser,
            [
                A2UI_OPEN_TAG
                + '[{"version": "v0.9", "callRendererFunction": {"surfaceId": "s1",'
                ' "callId": "c1", "function": "alert"}}]'
                + A2UI_CLOSE_TAG
            ],
        )
    parser2 = DirectJsonParser([BasicCatalog("v0.9")])
    with pytest.raises(A2uiValidationError):
        _stream(
            parser2,
            [
                A2UI_OPEN_TAG
                + '[{"version": "v0.9", "agentFunctionResponse": {"callId": "c1",'
                ' "result": 123}}]'
                + A2UI_CLOSE_TAG
            ],
        )
