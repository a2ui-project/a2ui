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
    VERSION_0_8,
    SURFACE_ID_KEY,
    CATALOG_COMPONENTS_KEY,
)
from a2ui.parser.constants import (
    MSG_TYPE_SURFACE_UPDATE,
    MSG_TYPE_BEGIN_RENDERING,
    MSG_TYPE_DELETE_SURFACE,
    MSG_TYPE_DATA_MODEL_UPDATE,
)
from a2ui.schema.catalog import A2uiCatalog
from a2ui.parser.streaming import A2uiStreamParser
from a2ui.parser.response_part import ResponsePart


@pytest.fixture
def mock_catalog():
  s2c_schema = {
      "title": "A2UI Message Schema",
      "type": "object",
      "additionalProperties": False,
      "properties": {
          "beginRendering": {
              "type": "object",
              "properties": {
                  "surfaceId": {"type": "string"},
                  "root": {"type": "string"},
              },
              "required": ["surfaceId", "root"],
          },
          "surfaceUpdate": {
              "type": "object",
              "properties": {
                  "surfaceId": {
                      "type": "string",
                  },
                  "components": {
                      "type": "array",
                      "items": {
                          "type": "object",
                          "properties": {
                              "id": {
                                  "type": "string",
                              },
                              "component": {
                                  "type": "object",
                                  "additionalProperties": True,
                              },
                          },
                          "required": ["id", "component"],
                      },
                  },
              },
              "required": ["surfaceId", "components"],
          },
          "dataModelUpdate": {
              "type": "object",
              "properties": {
                  "surfaceId": {"type": "string"},
                  "contents": {
                      "type": "array",
                      "items": {
                          "type": "object",
                          "properties": {
                              "key": {"type": "string"},
                              "valueString": {"type": "string"},
                              "valueNumber": {"type": "number"},
                              "valueBoolean": {"type": "boolean"},
                              "valueMap": {
                                  "type": "array",
                                  "items": {
                                      "type": "object",
                                      "properties": {
                                          "key": {"type": "string"},
                                          "valueString": {"type": "string"},
                                          "valueNumber": {"type": "number"},
                                          "valueBoolean": {"type": "boolean"},
                                      },
                                      "required": ["key"],
                                  },
                              },
                          },
                          "required": ["key"],
                      },
                  },
              },
              "required": ["surfaceId", "contents"],
          },
          "deleteSurface": {
              "type": "object",
              "properties": {
                  "surfaceId": {
                      "type": "string",
                  }
              },
              "required": ["surfaceId"],
          },
      },
  }
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
  common_types_schema = {
      "$id": "https://a2ui.org/specification/v0_8/common_types.json",
      "type": "object",
      "$defs": {},
  }
  return A2uiCatalog(
      version=VERSION_0_8,
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
    if MSG_TYPE_SURFACE_UPDATE in msg:
      payload = msg[MSG_TYPE_SURFACE_UPDATE]
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
  parser.add_msg_type(MSG_TYPE_SURFACE_UPDATE)
  parser.add_msg_type(MSG_TYPE_SURFACE_UPDATE)
  assert parser.msg_types == [MSG_TYPE_SURFACE_UPDATE]

  parser.add_msg_type(MSG_TYPE_BEGIN_RENDERING)
  assert parser.msg_types == [MSG_TYPE_SURFACE_UPDATE, MSG_TYPE_BEGIN_RENDERING]
  parser.add_msg_type(MSG_TYPE_SURFACE_UPDATE)
  assert parser.msg_types == [MSG_TYPE_SURFACE_UPDATE, MSG_TYPE_BEGIN_RENDERING]


def test_streaming_msg_type_deduplication(mock_catalog):
  parser = A2uiStreamParser(catalog=mock_catalog)
  # 1. Send partial chunk that triggers sniffing
  chunk1 = A2UI_OPEN_TAG + '[{"surfaceUpdate": {"surfaceId": "s1", "components": ['
  parser.process_chunk(chunk1)

  # Sniffing should have added surfaceUpdate
  assert MSG_TYPE_SURFACE_UPDATE in parser.msg_types
  assert parser.msg_types.count(MSG_TYPE_SURFACE_UPDATE) == 1

  # 2. Send the rest, which triggers handle_complete_object
  chunk2 = (
      '{"id": "root", "component": {"Text": {"text": "hi"}}}]}]'
      f" {A2UI_CLOSE_TAG}"
  )
  parser.process_chunk(chunk2)

  # After completion, msg_types is reset
  assert parser.msg_types == []


def test_v08_path_heuristic_adds_slash(mock_catalog):
  """Tests that v0.8 adds a leading slash to relative paths."""
  parser = A2uiStreamParser(catalog=mock_catalog)
  # Disable validation for simplicity
  parser._validator = None

  # 1. Send beginRendering first to avoid buffering
  chunk_br = (
      A2UI_OPEN_TAG
      + '[{"beginRendering": {"surfaceId": "s1", "root": "root"}}]'
      + A2UI_CLOSE_TAG
  )
  list(parser.process_chunk(chunk_br))

  # 2. Send surfaceUpdate with a relative path
  chunk_su = (
      A2UI_OPEN_TAG
      + '[{"surfaceUpdate": {"surfaceId": "s1", "components": [{"id": "root",'
      ' "component": {"Text": {"text": {"path": "some/relative/path"}}}}]}}]'
      + A2UI_CLOSE_TAG
  )

  messages = []
  for part in parser.process_chunk(chunk_su):
    if part.a2ui_json:
      messages.extend(part.a2ui_json)

  # The path should have been prefixed with a slash
  assert len(messages) > 0
  comp = messages[0][MSG_TYPE_SURFACE_UPDATE]["components"][0]
  assert comp["component"]["Text"]["text"]["path"] == "/some/relative/path"
