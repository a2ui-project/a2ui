# Copyright 2026 Google LLC
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

import json
import copy
from unittest.mock import MagicMock
import pytest
from a2ui.schema.constants import (
    A2UI_OPEN_TAG,
    A2UI_CLOSE_TAG,
    VERSION_0_9,
    SURFACE_ID_KEY,
    CATALOG_COMPONENTS_KEY,
)
from a2ui.parser.constants import (
    MSG_TYPE_CREATE_SURFACE,
    MSG_TYPE_UPDATE_COMPONENTS,
    MSG_TYPE_DELETE_SURFACE,
    MSG_TYPE_DATA_MODEL_UPDATE,
)
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.streaming import A2uiStreamParser
from a2ui.parser.response_part import ResponsePart


@pytest.fixture
def mock_catalog():
  s2c_schema = {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "https://a2ui.org/specification/v0_9/server_to_client.json",
      "title": "A2UI Message Schema",
      "type": "object",
      "oneOf": [
          {"$ref": "#/$defs/CreateSurfaceMessage"},
          {"$ref": "#/$defs/UpdateComponentsMessage"},
          {"$ref": "#/$defs/UpdateDataModelMessage"},
          {"$ref": "#/$defs/DeleteSurfaceMessage"},
      ],
      "$defs": {
          "CreateSurfaceMessage": {
              "type": "object",
              "properties": {
                  "version": {"const": "v0.9"},
                  "createSurface": {
                      "type": "object",
                      "properties": {
                          "surfaceId": {
                              "type": "string",
                          },
                          "catalogId": {
                              "type": "string",
                          },
                          "theme": {
                              "type": "object",
                              "additionalProperties": True,
                          },
                      },
                      "required": ["surfaceId", "catalogId"],
                      "additionalProperties": False,
                  },
              },
              "required": ["version", "createSurface"],
              "additionalProperties": False,
          },
          "UpdateComponentsMessage": {
              "type": "object",
              "properties": {
                  "version": {"const": "v0.9"},
                  "updateComponents": {
                      "type": "object",
                      "properties": {
                          "surfaceId": {
                              "type": "string",
                          },
                          "root": {
                              "type": "string",
                          },
                          "components": {
                              "type": "array",
                              "minItems": 1,
                              "items": {"$ref": "catalog.json#/$defs/anyComponent"},
                          },
                      },
                      "required": ["surfaceId", "components"],
                      "additionalProperties": False,
                  },
              },
              "required": ["version", "updateComponents"],
              "additionalProperties": False,
          },
          "UpdateDataModelMessage": {
              "type": "object",
              "properties": {
                  "version": {"const": "v0.9"},
                  "updateDataModel": {
                      "type": "object",
                      "properties": {
                          "surfaceId": {
                              "type": "string",
                          },
                          "value": {"additionalProperties": True},
                      },
                      "required": ["surfaceId"],
                      "additionalProperties": False,
                  },
              },
              "required": ["version", "updateDataModel"],
              "additionalProperties": False,
          },
          "DeleteSurfaceMessage": {
              "type": "object",
              "properties": {
                  "version": {"const": "v0.9"},
                  "deleteSurface": {
                      "type": "object",
                      "properties": {"surfaceId": {"type": "string"}},
                      "required": ["surfaceId"],
                  },
              },
              "required": ["version", "deleteSurface"],
          },
      },
  }
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
          "AudioPlayer": {
              "type": "object",
              "allOf": [
                  {"$ref": "common_types.json#/$defs/ComponentCommon"},
                  {"$ref": "#/$defs/CatalogComponentCommon"},
                  {
                      "type": "object",
                      "properties": {
                          "component": {"const": "AudioPlayer"},
                          "url": {"$ref": "common_types.json#/$defs/DynamicString"},
                          "description": {
                              "$ref": "common_types.json#/$defs/DynamicString"
                          },
                      },
                      "required": ["component", "url"],
                  },
              ],
          },
          "List": {
              "type": "object",
              "allOf": [
                  {"$ref": "common_types.json#/$defs/ComponentCommon"},
                  {"$ref": "#/$defs/CatalogComponentCommon"},
                  {
                      "type": "object",
                      "properties": {
                          "component": {"const": "List"},
                          "children": {"$ref": "common_types.json#/$defs/ChildList"},
                          "direction": {
                              "type": "string",
                              "enum": ["vertical", "horizontal"],
                          },
                      },
                      "required": ["component", "children"],
                  },
              ],
          },
          "Row": {
              "type": "object",
              "allOf": [
                  {"$ref": "common_types.json#/$defs/ComponentCommon"},
                  {"$ref": "#/$defs/CatalogComponentCommon"},
                  {
                      "type": "object",
                      "properties": {
                          "component": {"const": "Row"},
                          "children": {"$ref": "common_types.json#/$defs/ChildList"},
                      },
                      "required": ["component", "children"],
                  },
              ],
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
                  {"$ref": "#/components/AudioPlayer"},
                  {"$ref": "#/components/List"},
                  {"$ref": "#/components/Row"},
              ],
              "discriminator": {"propertyName": "component"},
          },
      },
  }
  common_types_schema = {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "https://a2ui.org/specification/v0_9/common_types.json",
      "title": "A2UI Common Types",
      "$defs": {
          "ComponentId": {
              "type": "string",
          },
          "AccessibilityAttributes": {
              "type": "object",
              "properties": {
                  "label": {
                      "$ref": "#/$defs/DynamicString",
                  }
              },
          },
          "Action": {"type": "object", "additionalProperties": True},
          "ComponentCommon": {
              "type": "object",
              "properties": {"id": {"$ref": "#/$defs/ComponentId"}},
              "required": ["id"],
          },
          "DataBinding": {"type": "object"},
          "DynamicString": {
              "anyOf": [{"type": "string"}, {"$ref": "#/$defs/DataBinding"}]
          },
          "DynamicValue": {
              "anyOf": [
                  {"type": "object"},
                  {"type": "array"},
                  {"$ref": "#/$defs/DataBinding"},
              ]
          },
          "DynamicNumber": {
              "anyOf": [{"type": "number"}, {"$ref": "#/$defs/DataBinding"}]
          },
          "ChildList": {
              "oneOf": [
                  {"type": "array", "items": {"$ref": "#/$defs/ComponentId"}},
                  {
                      "type": "object",
                      "properties": {
                          "componentId": {"$ref": "#/$defs/ComponentId"},
                          "path": {"type": "string"},
                      },
                      "required": ["componentId", "path"],
                      "additionalProperties": False,
                  },
              ]
          },
      },
  }
  return A2uiCatalog(
      version=VERSION_0_9,
      name="test_catalog",
      s2c_schema=s2c_schema,
      common_types_schema=common_types_schema,
      catalog_schema=catalog_schema,
  )


def _normalize_messages(messages):
  """Sorts components in messages for stable comparison."""
  # Support ResponsePart list by extracting a2ui_json
  res = []
  for m in messages:
    if isinstance(m, ResponsePart):
      if m.a2ui_json:
        if isinstance(m.a2ui_json, list):
          res.extend(copy.deepcopy(m.a2ui_json))
        else:
          res.append(copy.deepcopy(m.a2ui_json))
    else:
      res.append(copy.deepcopy(m))

  for msg in res:
    if MSG_TYPE_UPDATE_COMPONENTS in msg:
      payload = msg[MSG_TYPE_UPDATE_COMPONENTS]
      if CATALOG_COMPONENTS_KEY in payload:
        payload[CATALOG_COMPONENTS_KEY].sort(key=lambda x: x.get("id", ""))
  return res


def assertResponseContainsMessages(response, expected_messages):
  """Asserts that the response parts contain the expected messages."""
  assert _normalize_messages(response) == _normalize_messages(expected_messages)


def assertResponseContainsNoA2UI(response):
  assert len(response) == 0 or response[0].a2ui_json == None


def assertResponseContainsText(response, expected_text):
  """Asserts that the response parts contain the expected text."""
  assert any(
      (p.text if isinstance(p, ResponsePart) else p) == expected_text for p in response
  )


def test_add_msg_type_deduplication():
  parser = A2uiStreamParser()
  parser.add_msg_type(MSG_TYPE_UPDATE_COMPONENTS)
  parser.add_msg_type(MSG_TYPE_UPDATE_COMPONENTS)
  assert parser.msg_types == [MSG_TYPE_UPDATE_COMPONENTS]

  parser.add_msg_type(MSG_TYPE_CREATE_SURFACE)
  assert parser.msg_types == [MSG_TYPE_UPDATE_COMPONENTS, MSG_TYPE_CREATE_SURFACE]
  parser.add_msg_type(MSG_TYPE_UPDATE_COMPONENTS)
  assert parser.msg_types == [MSG_TYPE_UPDATE_COMPONENTS, MSG_TYPE_CREATE_SURFACE]


def test_streaming_msg_type_deduplication(mock_catalog):
  parser = A2uiStreamParser(catalog=mock_catalog)
  # 1. Send partial chunk that triggers sniffing
  chunk1 = (
      A2UI_OPEN_TAG
      + '[{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "root": "root",'
      ' "components": [{"id": "root", "component": "Text", "text": "Hello"}'
  )
  parser.process_chunk(chunk1)

  assert MSG_TYPE_UPDATE_COMPONENTS in parser.msg_types
  assert parser.msg_types.count(MSG_TYPE_UPDATE_COMPONENTS) == 1

  # 2. Send the rest, which triggers handle_complete_object
  chunk2 = f', {{"id": "c1", "component": "Text", "text": "hi"}}]}}}} {A2UI_CLOSE_TAG}'
  parser.process_chunk(chunk2)

  # After completion, msg_types is reset
  assert not parser.msg_types


def test_v09_path_heuristic_relative_path(mock_catalog):
  """Tests that v0.9 allows relative paths (no leading slash)."""
  parser = A2uiStreamParser(catalog=mock_catalog)
  # Disable validation to avoid needing full catalog for this test
  parser._validator = None

  # 1. Create surface
  chunk_cs = (
      A2UI_OPEN_TAG
      + '[{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId": "c1"}}]'
      + A2UI_CLOSE_TAG
  )
  list(parser.process_chunk(chunk_cs))

  # 2. Update components with a relative path
  chunk_uc = (
      A2UI_OPEN_TAG
      + '[{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components":'
      ' [{"id": "root", "component": "Text", "text": {"path":'
      ' "some/relative/path"}}]}}]'
      + A2UI_CLOSE_TAG
  )

  messages = []
  for part in parser.process_chunk(chunk_uc):
    if part.a2ui_json:
      messages.extend(part.a2ui_json)

  assert len(messages) > 0
  comp = messages[0][MSG_TYPE_UPDATE_COMPONENTS]["components"][0]
  assert comp["text"]["path"] == "some/relative/path"


def test_v09_path_heuristic_absolute_path(mock_catalog):
  """Tests that v0.9 still supports absolute paths (leading slash)."""
  parser = A2uiStreamParser(catalog=mock_catalog)
  parser._validator = None

  # 1. Create surface
  chunk_cs = (
      A2UI_OPEN_TAG
      + '[{"version": "v0.9", "createSurface": {"surfaceId": "s1", "catalogId": "c1"}}]'
      + A2UI_CLOSE_TAG
  )
  list(parser.process_chunk(chunk_cs))

  # 2. Update components with an absolute path
  chunk_uc = (
      A2UI_OPEN_TAG
      + '[{"version": "v0.9", "updateComponents": {"surfaceId": "s1", "components":'
      ' [{"id": "root", "component": "Text", "text": {"path": "/absolute/path"}}]}}]'
      + A2UI_CLOSE_TAG
  )

  messages = []
  for part in parser.process_chunk(chunk_uc):
    if part.a2ui_json:
      messages.extend(part.a2ui_json)

  assert len(messages) > 0
  comp = messages[0][MSG_TYPE_UPDATE_COMPONENTS]["components"][0]
  assert comp["text"]["path"] == "/absolute/path"
