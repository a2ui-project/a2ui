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

"""Unit tests for `a2ui.inference_formats.direct_json.schema_to_prompt`."""

import json
from typing import Any

import pytest

from a2ui.core import A2uiCatalogError, Catalog, CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.direct_json import schema_to_prompt
from a2ui.schema import VERSION_0_8, VERSION_0_9, VERSION_0_9_1, VERSION_1_0, constants
from a2ui.schema.utils import load_common_types_schema

_A2R = "Agent to Renderer Schema"
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


def _section_list(block: str) -> list[tuple[str, Any]]:
    """Returns the title and JSON of each `### <title>:` section, duplicates included."""
    sections = []
    for part in block.split("\n\n"):
        if part.startswith("### "):
            title, _, body = part.removeprefix("### ").partition(":\n")
            sections.append((title, json.loads(body)))
    return sections


def _message_refs(a2r_schema: dict[str, Any]) -> list[str]:
    return [item["$ref"].removeprefix("#/$defs/") for item in a2r_schema["oneOf"]]


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


def test_schema_to_prompt_puts_the_sections_between_the_markers_in_order():
    block = schema_to_prompt([BasicCatalog(VERSION_0_9)])

    assert block.startswith(constants.A2UI_SCHEMA_BLOCK_START + "\n\n")
    assert block.endswith("\n\n" + constants.A2UI_SCHEMA_BLOCK_END)
    assert list(_sections(block)) == [_A2R, _COMMON_TYPES, _CATALOG]


def test_schema_to_prompt_includes_the_catalog_schema():
    catalog = BasicCatalog(VERSION_0_9)

    sections = _sections(schema_to_prompt([catalog]))

    assert sections[_CATALOG] == catalog.validation_schema


@pytest.mark.parametrize("version", [VERSION_0_9, VERSION_0_9_1])
def test_schema_to_prompt_uses_the_published_v0_9_schemas(version):
    sections = _sections(schema_to_prompt([BasicCatalog(version)]))

    assert _message_refs(sections[_A2R]) == _V09_MESSAGES
    assert sections[_COMMON_TYPES]["$defs"]


def test_schema_to_prompt_uses_the_published_v1_0_schemas():
    sections = _sections(schema_to_prompt([BasicCatalog(VERSION_1_0)]))

    assert "CallRendererFunctionMessage" in _message_refs(sections[_A2R])
    assert sections[_COMMON_TYPES]["$defs"]


def test_schema_to_prompt_has_no_common_types_section_for_v0_8():
    sections = _sections(schema_to_prompt([BasicCatalog(VERSION_0_8)]))

    assert list(sections) == [_A2R, _CATALOG]
    assert set(sections[_A2R]["properties"]) == _V08_MESSAGES


def test_schema_to_prompt_keeps_every_message_without_an_allowlist():
    sections = _sections(
        schema_to_prompt([BasicCatalog(VERSION_0_9)], allowed_messages=None)
    )

    assert _message_refs(sections[_A2R]) == _V09_MESSAGES


def test_schema_to_prompt_keeps_only_the_allowed_messages():
    sections = _sections(
        schema_to_prompt(
            [BasicCatalog(VERSION_0_9)],
            allowed_messages=["CreateSurfaceMessage", "UpdateComponentsMessage"],
        )
    )

    a2r = sections[_A2R]
    assert _message_refs(a2r) == ["CreateSurfaceMessage", "UpdateComponentsMessage"]
    assert set(a2r["$defs"]) == {"CreateSurfaceMessage", "UpdateComponentsMessage"}


def test_schema_to_prompt_keeps_no_message_with_an_empty_allowlist():
    sections = _sections(
        schema_to_prompt([BasicCatalog(VERSION_0_9)], allowed_messages=[])
    )

    assert sections[_A2R]["oneOf"] == []
    assert sections[_A2R]["$defs"] == {}


def test_schema_to_prompt_keeps_only_the_allowed_v0_8_messages():
    sections = _sections(
        schema_to_prompt(
            [BasicCatalog(VERSION_0_8)],
            allowed_messages=["beginRendering", "surfaceUpdate"],
        )
    )

    assert set(sections[_A2R]["properties"]) == {"beginRendering", "surfaceUpdate"}


def test_schema_to_prompt_keeps_only_the_common_types_in_use():
    published = load_common_types_schema(VERSION_0_9)["$defs"]

    sections = _sections(schema_to_prompt([_label_catalog()], allowed_messages=[]))

    # With no messages, only the catalog refers to common types: DynamicString
    # and the types it refers to.
    kept = sections[_COMMON_TYPES]["$defs"]
    assert "DynamicString" in kept
    assert set(kept) < set(published)
    assert all(kept[name] == published[name] for name in kept)


def test_schema_to_prompt_omits_common_types_that_nothing_uses():
    catalog_id = "https://example.com/plain_catalog.json"
    catalog = Catalog.from_json(
        catalog_schema={
            "catalogId": catalog_id,
            "components": {
                "Label": {"type": "object", "properties": {"text": {"type": "string"}}}
            },
        },
        protocol_version=VERSION_0_9,
        catalog_id=catalog_id,
    )

    sections = _sections(schema_to_prompt([catalog], allowed_messages=[]))

    assert list(sections) == [_A2R, _CATALOG]


def test_schema_to_prompt_shows_the_protocol_schemas_once_for_several_catalogs():
    basic = BasicCatalog(VERSION_0_9)
    label = _label_catalog()

    block = schema_to_prompt([basic, label])

    assert block.count(constants.A2UI_SCHEMA_BLOCK_START) == 1
    assert block.count(constants.A2UI_SCHEMA_BLOCK_END) == 1
    sections = _section_list(block)
    assert [title for title, _ in sections] == [_A2R, _COMMON_TYPES, _CATALOG, _CATALOG]
    assert sections[2][1] == basic.validation_schema
    assert sections[3][1] == label.validation_schema


def test_schema_to_prompt_keeps_the_common_types_that_any_catalog_uses():
    catalog_id = "https://example.com/plain_catalog.json"
    plain = Catalog.from_json(
        catalog_schema={
            "catalogId": catalog_id,
            "components": {
                "Plain": {"type": "object", "properties": {"text": {"type": "string"}}}
            },
        },
        protocol_version=VERSION_0_9,
        catalog_id=catalog_id,
    )

    sections = _sections(
        schema_to_prompt([plain, _label_catalog()], allowed_messages=[])
    )

    assert "DynamicString" in sections[_COMMON_TYPES]["$defs"]


def test_schema_to_prompt_rejects_no_catalogs():
    with pytest.raises(A2uiCatalogError):
        schema_to_prompt([])


def test_schema_to_prompt_rejects_catalogs_of_different_versions():
    with pytest.raises(A2uiCatalogError):
        schema_to_prompt([BasicCatalog(VERSION_0_9), BasicCatalog(VERSION_1_0)])
