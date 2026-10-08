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

"""Unit tests for DirectJsonParser streaming with v0.9 catalogs."""

from __future__ import annotations

import pytest

from a2ui.core import A2uiValidationError, Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import DirectJsonParser
from a2ui.schema import (
    A2UI_CLOSE_TAG,
    A2UI_OPEN_TAG,
    VERSION_0_9,
)

MSG_TYPE_UPDATE_COMPONENTS = "updateComponents"


@pytest.fixture
def mock_catalog():
    catalog_schema = {
        "catalogId": "test_catalog",
        "components": {
            "Container": {
                "type": "object",
                "allOf": [
                    {"$ref": "common_types.json#/$defs/ComponentCommon"},
                    {"$ref": "#/$defs/CatalogComponentCommon"},
                ],
                "properties": {
                    "component": {"const": "Container"},
                    "children": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["component", "children"],
            },
            "Card": {
                "type": "object",
                "allOf": [
                    {"$ref": "common_types.json#/$defs/ComponentCommon"},
                    {"$ref": "#/$defs/CatalogComponentCommon"},
                ],
                "properties": {
                    "component": {"const": "Card"},
                    "child": {"$ref": "common_types.json#/$defs/ComponentId"},
                },
                "required": ["component", "child"],
            },
            "Text": {
                "type": "object",
                "allOf": [
                    {"$ref": "common_types.json#/$defs/ComponentCommon"},
                    {"$ref": "#/$defs/CatalogComponentCommon"},
                ],
                "properties": {
                    "component": {"const": "Text"},
                    "text": {"$ref": "common_types.json#/$defs/DynamicString"},
                },
                "required": ["component", "text"],
            },
            "Column": {
                "type": "object",
                "allOf": [
                    {"$ref": "common_types.json#/$defs/ComponentCommon"},
                    {"$ref": "#/$defs/CatalogComponentCommon"},
                ],
                "properties": {
                    "component": {"const": "Column"},
                    "children": {"$ref": "common_types.json#/$defs/ChildList"},
                },
                "required": ["component", "children"],
            },
        },
        "$defs": {
            "CatalogComponentCommon": {
                "type": "object",
                "properties": {"weight": {"type": "number"}},
            },
            "anyComponent": {
                "oneOf": [
                    {"$ref": "#/components/Container"},
                    {"$ref": "#/components/Card"},
                    {"$ref": "#/components/Text"},
                    {"$ref": "#/components/Column"},
                ],
                "discriminator": {"propertyName": "component"},
            },
        },
    }
    return Catalog.from_json(
        catalog_schema=catalog_schema,
        protocol_version=VERSION_0_9,
        catalog_id="test_catalog",
    )


def _dump_messages(parts):
    messages = []
    for part in parts:
        if part.a2ui:
            for msg in part.a2ui:
                messages.append(msg.model_dump(by_alias=True, exclude_none=True))
    return messages


def test_v09_path_heuristic_relative_path(mock_catalog):
    """Tests that v0.9 allows relative paths (no leading slash)."""
    parser = DirectJsonParser(catalogs=[mock_catalog])

    chunk = (
        A2UI_OPEN_TAG
        + '[{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId":'
        ' "test_catalog"}}, '
        + '{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components":'
        ' [{"id": "root", "component": "Text", "text": {"path":'
        ' "some/relative/path"}}]}}]'
        + A2UI_CLOSE_TAG
    )

    messages = _dump_messages(parser.parse_chunk(chunk))

    assert len(messages) == 2
    comp = messages[1][MSG_TYPE_UPDATE_COMPONENTS]["components"][0]
    assert comp["text"]["path"] == "some/relative/path"


def test_v09_path_heuristic_absolute_path(mock_catalog):
    """Tests that v0.9 still supports absolute paths (leading slash)."""
    parser = DirectJsonParser(catalogs=[mock_catalog])

    chunk = (
        A2UI_OPEN_TAG
        + '[{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId":'
        ' "test_catalog"}}, '
        + '{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components":'
        ' [{"id": "root", "component": "Text", "text": {"path": "/absolute/path"}}]}}]'
        + A2UI_CLOSE_TAG
    )

    messages = _dump_messages(parser.parse_chunk(chunk))

    assert len(messages) == 2
    comp = messages[1][MSG_TYPE_UPDATE_COMPONENTS]["components"][0]
    assert comp["text"]["path"] == "/absolute/path"


def test_v09_single_top_level_object(mock_catalog):
    """Tests that v0.9 supports a single top-level object without array wrapping."""
    parser = DirectJsonParser(catalogs=[mock_catalog])

    chunk = (
        A2UI_OPEN_TAG
        + '{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId":'
        ' "test_catalog"}}'
        + A2UI_CLOSE_TAG
    )
    messages = _dump_messages(parser.parse_chunk(chunk))

    assert len(messages) == 1
    assert messages[0]["createSurface"]["surfaceId"] == "s1"


def test_v09_duplicate_component_ids_rejected():
    """Duplicate component IDs in the same updateComponents payload are rejected."""
    parser = DirectJsonParser(catalogs=[BasicCatalog("v0.9")])
    basic_id = BasicCatalog("v0.9").catalog_id
    chunk = (
        A2UI_OPEN_TAG
        + '[{"version": "v0.9", "createSurface": {"surfaceId": "s", "catalogId":'
        f' "{basic_id}"}}}}, '
        + '{"version": "v0.9", "updateComponents": {"surfaceId": "s", "components":'
        ' [{"id": "root", "component": "Text", "text": "a"},'
        ' {"id": "root", "component": "Text", "text": "b"}]}}]'
        + A2UI_CLOSE_TAG
    )
    with pytest.raises(A2uiValidationError):
        parser.parse_chunk(chunk)
