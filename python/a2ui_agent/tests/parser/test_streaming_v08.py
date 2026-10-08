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

"""Unit tests for DirectJsonParser streaming with v0.8 catalogs."""

from __future__ import annotations

import copy

import pytest

from a2ui.core import A2uiValidationError, Catalog
from a2ui.inference_formats.direct_json import DirectJsonParser
from a2ui.parser import ResponsePart
from a2ui.schema import (
    A2UI_CLOSE_TAG,
    A2UI_OPEN_TAG,
    CATALOG_COMPONENTS_KEY,
    VERSION_0_8,
)

MSG_TYPE_BEGIN_RENDERING = "beginRendering"
MSG_TYPE_SURFACE_UPDATE = "surfaceUpdate"


@pytest.fixture
def mock_catalog():
    catalog_schema = {
        "catalogId": "test_catalog",
        "components": {
            "Container": {
                "type": "object",
                "properties": {
                    "children": {
                        "type": "array",
                        "items": {"type": "string", "title": "ComponentId"},
                    }
                },
                "additionalProperties": True,
            },
            "Card": {
                "type": "object",
                "properties": {
                    "child": {"type": "string", "title": "ComponentId"},
                    "children": {
                        "type": "array",
                        "items": {"type": "string", "title": "ComponentId"},
                    },
                },
                "additionalProperties": True,
            },
            "Text": {"type": "object", "additionalProperties": True},
            "Loading": {"type": "object", "additionalProperties": True},
            "List": {"type": "object", "additionalProperties": True},
            "Row": {
                "type": "object",
                "properties": {
                    "children": {
                        "type": "object",
                        "properties": {
                            "explicitList": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                            "required": ["componentId", "dataBinding"],
                        },
                    }
                },
                "required": ["children"],
            },
            "Column": {
                "type": "object",
                "properties": {
                    "children": {
                        "type": "object",
                        "properties": {
                            "explicitList": {
                                "type": "array",
                                "items": {"type": "string", "title": "ComponentId"},
                            }
                        },
                    }
                },
            },
            "AudioPlayer": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "object",
                        "properties": {
                            "literalString": {"type": "string"},
                            "path": {"type": "string"},
                        },
                    },
                },
                "required": ["url"],
            },
        },
    }
    return Catalog.from_json(
        catalog_schema=catalog_schema,
        protocol_version=VERSION_0_8,
        catalog_id="test_catalog",
    )


def _normalize_messages(messages):
    """Sorts components in messages for stable comparison."""
    from a2ui.inference_formats._shared import to_message_dicts

    res = []
    for m in messages:
        if isinstance(m, ResponsePart):
            if m.a2ui:
                res.extend(to_message_dicts(m.a2ui))
        else:
            res.append(copy.deepcopy(m))

    for msg in res:
        if MSG_TYPE_SURFACE_UPDATE in msg:
            payload = msg[MSG_TYPE_SURFACE_UPDATE]
            if CATALOG_COMPONENTS_KEY in payload:
                payload[CATALOG_COMPONENTS_KEY].sort(key=lambda x: x.get("id", ""))
    return res


def test_v08_surface_update_validates_envelope(mock_catalog):
    """Tests that a complete v0.8 surfaceUpdate validates its message envelope."""
    parser = DirectJsonParser(catalogs=[mock_catalog])
    chunk_br = (
        A2UI_OPEN_TAG
        + '[{"beginRendering": {"surfaceId": "s1", "root": "root"}}]'
        + A2UI_CLOSE_TAG
    )
    list(parser.parse_chunk(chunk_br))

    chunk_su = (
        A2UI_OPEN_TAG
        + '[{"surfaceUpdate": {"surfaceId": "s1", "extra": 1, "components":'
        ' [{"id": "root", "component": {"Text": {"text": "hi"}}}]}}]'
        + A2UI_CLOSE_TAG
    )
    with pytest.raises(A2uiValidationError):
        list(parser.parse_chunk(chunk_su))


def test_v08_deleted_surface_can_be_recreated(mock_catalog):
    """A beginRendering and surfaceUpdate after deleteSurface recreate the surface."""
    parser = DirectJsonParser(catalogs=[mock_catalog])
    chunks = [
        A2UI_OPEN_TAG + "[",
        '{"beginRendering": {"surfaceId": "s1", "root": "root"}}, ',
        (
            '{"surfaceUpdate": {"surfaceId": "s1", "components": [{"id": "root",'
            ' "component": {"Text": {"text": {"literalString": "First"}}}}]}}, '
        ),
        '{"deleteSurface": {"surfaceId": "s1"}}, ',
        '{"beginRendering": {"surfaceId": "s1", "root": "root"}}, ',
        (
            '{"surfaceUpdate": {"surfaceId": "s1", "components": [{"id": "root",'
            ' "component": {"Text": {"text": {"literalString": "Recreated"}}}}]}}]'
            + A2UI_CLOSE_TAG
        ),
    ]
    response = []
    for chunk in chunks:
        response.extend(parser.parse_chunk(chunk))

    messages = _normalize_messages(response)
    assert [m for m in messages if MSG_TYPE_BEGIN_RENDERING in m] == [
        {MSG_TYPE_BEGIN_RENDERING: {"surfaceId": "s1", "root": "root"}},
        {MSG_TYPE_BEGIN_RENDERING: {"surfaceId": "s1", "root": "root"}},
    ]
    surface_updates = [m for m in messages if MSG_TYPE_SURFACE_UPDATE in m]
    assert surface_updates[-1] == {
        MSG_TYPE_SURFACE_UPDATE: {
            "surfaceId": "s1",
            "components": [{
                "id": "root",
                "component": {"Text": {"text": {"literalString": "Recreated"}}},
            }],
        }
    }
