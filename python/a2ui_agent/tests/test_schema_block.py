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

"""Unit tests for `a2ui.inference_formats.direct_json.render_schema_block`."""

import copy
import json
from typing import Any

import pytest

from a2ui.core import Catalog, CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import render_schema_block
from a2ui.schema import VERSION_0_8, VERSION_0_9, VERSION_0_9_1, VERSION_1_0, constants

_S2C = "Server To Client Schema"
_COMMON_TYPES = "Common Types Schema"
_CATALOG = "Catalog Schema"

_V09_MESSAGES = [
    "CreateSurfaceMessage",
    "UpdateComponentsMessage",
    "UpdateDataModelMessage",
    "DeleteSurfaceMessage",
]
_V08_MESSAGES = {"beginRendering", "dataModelUpdate", "deleteSurface", "surfaceUpdate"}


def _sections(block: str) -> dict[str, Any]:
    """Returns the JSON of each `### <title>:` section, keyed by title in order."""
    sections = {}
    for part in block.split("\n\n"):
        if part.startswith("### "):
            title, _, body = part.removeprefix("### ").partition(":\n")
            sections[title] = json.loads(body)
    return sections


def _message_refs(s2c_schema: dict[str, Any]) -> list[str]:
    return [item["$ref"].removeprefix("#/$defs/") for item in s2c_schema["oneOf"]]


def _label_catalog() -> CatalogApi:
    """Returns a v0.9 catalog whose one component uses `DynamicString`."""
    catalog_id = "https://example.com/label_catalog.json"
    return Catalog.from_json(
        catalog_schema={
            "catalogId": catalog_id,
            "components": {
                "Label": {
                    "type": "object",
                    "properties": {
                        "text": {"$ref": "common_types.json#/$defs/DynamicString"}
                    },
                }
            },
        },
        protocol_version=VERSION_0_9,
        catalog_id=catalog_id,
    )


def test_render_schema_block_puts_the_sections_between_the_markers_in_order():
    block = render_schema_block(BasicCatalog(VERSION_0_9))

    assert block.startswith(constants.A2UI_SCHEMA_BLOCK_START + "\n\n")
    assert block.endswith("\n\n" + constants.A2UI_SCHEMA_BLOCK_END)
    assert list(_sections(block)) == [_S2C, _COMMON_TYPES, _CATALOG]


def test_render_schema_block_renders_the_catalog_schema():
    catalog = BasicCatalog(VERSION_0_9)

    sections = _sections(render_schema_block(catalog))

    assert sections[_CATALOG] == catalog.catalog_schema


@pytest.mark.parametrize("version", [VERSION_0_9, VERSION_0_9_1])
def test_render_schema_block_loads_the_v0_9_schemas_by_default(version):
    sections = _sections(render_schema_block(BasicCatalog(version)))

    assert _message_refs(sections[_S2C]) == _V09_MESSAGES
    assert sections[_COMMON_TYPES]["$defs"]


def test_render_schema_block_loads_the_v1_0_schemas_by_default():
    sections = _sections(render_schema_block(BasicCatalog(VERSION_1_0)))

    assert "CallRendererFunctionMessage" in _message_refs(sections[_S2C])
    assert sections[_COMMON_TYPES]["$defs"]


def test_render_schema_block_has_no_common_types_section_for_v0_8():
    sections = _sections(render_schema_block(BasicCatalog(VERSION_0_8)))

    assert list(sections) == [_S2C, _CATALOG]
    assert set(sections[_S2C]["properties"]) == _V08_MESSAGES


def test_render_schema_block_keeps_every_message_without_an_allowlist():
    sections = _sections(
        render_schema_block(BasicCatalog(VERSION_0_9), allowed_messages=None)
    )

    assert _message_refs(sections[_S2C]) == _V09_MESSAGES


def test_render_schema_block_keeps_only_the_allowed_messages():
    sections = _sections(
        render_schema_block(
            BasicCatalog(VERSION_0_9),
            allowed_messages=["CreateSurfaceMessage", "UpdateComponentsMessage"],
        )
    )

    s2c = sections[_S2C]
    assert _message_refs(s2c) == ["CreateSurfaceMessage", "UpdateComponentsMessage"]
    assert set(s2c["$defs"]) == {"CreateSurfaceMessage", "UpdateComponentsMessage"}


def test_render_schema_block_keeps_no_message_with_an_empty_allowlist():
    sections = _sections(
        render_schema_block(BasicCatalog(VERSION_0_9), allowed_messages=[])
    )

    assert sections[_S2C]["oneOf"] == []
    assert sections[_S2C]["$defs"] == {}


def test_render_schema_block_keeps_only_the_allowed_v0_8_messages():
    sections = _sections(
        render_schema_block(
            BasicCatalog(VERSION_0_8),
            allowed_messages=["beginRendering", "surfaceUpdate"],
        )
    )

    assert set(sections[_S2C]["properties"]) == {"beginRendering", "surfaceUpdate"}


def test_render_schema_block_uses_the_given_schemas():
    s2c_schema = {
        "type": "object",
        "properties": {"surfaceId": {"$ref": "common_types.json#/$defs/SurfaceName"}},
    }
    common_types_schema = {
        "$defs": {
            "DynamicString": {
                "oneOf": [{"type": "string"}, {"$ref": "#/$defs/StringPath"}]
            },
            "StringPath": {"type": "string"},
            "SurfaceName": {"type": "string"},
            "UnusedType": {"type": "number"},
        }
    }
    s2c_before = copy.deepcopy(s2c_schema)
    common_types_before = copy.deepcopy(common_types_schema)

    sections = _sections(
        render_schema_block(
            _label_catalog(),
            s2c_schema=s2c_schema,
            common_types_schema=common_types_schema,
        )
    )

    assert sections[_S2C] == s2c_schema
    # The catalog refers to DynamicString, which refers to StringPath, and the
    # server-to-client schema refers to SurfaceName. Nothing refers to
    # UnusedType.
    assert sections[_COMMON_TYPES] == {
        "$defs": {
            "DynamicString": common_types_schema["$defs"]["DynamicString"],
            "StringPath": {"type": "string"},
            "SurfaceName": {"type": "string"},
        }
    }
    assert s2c_schema == s2c_before
    assert common_types_schema == common_types_before


def test_render_schema_block_omits_common_types_that_nothing_uses():
    sections = _sections(
        render_schema_block(
            _label_catalog(),
            s2c_schema={},
            common_types_schema={"$defs": {"UnusedType": {"type": "number"}}},
        )
    )

    assert list(sections) == [_S2C, _CATALOG]
    assert sections[_S2C] == {}
