# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import os
import pytest

from a2ui_eval.scorers import a2ui_scorer
from inspect_ai.scorer import Target
from inspect_ai.solver import TaskState
from inspect_ai.model import ModelOutput, ModelName

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
CATALOG_PATH = os.path.abspath(
    os.path.join(CURRENT_DIR, "../../specification/v0_9/catalogs/basic/catalog.json")
)
CATALOG_PATH_V091 = os.path.abspath(
    os.path.join(CURRENT_DIR, "../../specification/v0_9_1/catalogs/basic/catalog.json")
)


@pytest.mark.asyncio
async def test_scorer_valid_json_v091():
  scorer = a2ui_scorer(version="0.9.1")
  valid_json = """
    <a2ui-json>
    [
      {
        "version": "v0.9",
        "createSurface": {
          "surfaceId": "main",
          "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
        }
      },
      {
        "version": "v0.9",
        "updateComponents": {
          "surfaceId": "main",
          "components": [
            {
              "id": "root",
              "component": "Button",
              "child": "button-text",
              "action": {
                "functionCall": {
                  "call": "openUrl",
                  "args": {
                    "url": "https://google.com"
                  }
                }
              }
            },
            {
              "id": "button-text",
              "component": "Text",
              "text": "Click me"
            }
          ]
        }
      }
    ]
    </a2ui-json>
    """
  state = TaskState(
      model=ModelName("mock/model"),
      sample_id=1,
      epoch=1,
      input="test",
      messages=[],
      output=ModelOutput(model="mock/model", completion=valid_json),
      metadata={"catalog": str(CATALOG_PATH_V091)},
  )

  score = await scorer(state, Target(""))
  assert score.value == 1.0
  assert "Valid A2UI payload" in score.explanation


@pytest.mark.asyncio
async def test_scorer_valid_json():
  scorer = a2ui_scorer(version="0.9")
  valid_json = """
    <a2ui-json>
    {
      "version": "v0.9",
      "createSurface": {
        "surfaceId": "main",
        "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
      }
    }
    </a2ui-json>
    """
  state = TaskState(
      model=ModelName("mock/model"),
      sample_id=1,
      epoch=1,
      input="test",
      messages=[],
      output=ModelOutput(model="mock/model", completion=valid_json),
      metadata={"catalog": str(CATALOG_PATH)},
  )

  score = await scorer(state, Target(""))
  assert score.value == 1.0
  assert "Valid A2UI payload" in score.explanation


@pytest.mark.asyncio
async def test_scorer_invalid_json():
  scorer = a2ui_scorer(version="0.9")
  state = TaskState(
      model=ModelName("mock/model"),
      sample_id=1,
      epoch=1,
      input="test",
      messages=[],
      output=ModelOutput(model="mock/model", completion="invalid json"),
      metadata={"catalog": str(CATALOG_PATH)},
  )
  score = await scorer(state, Target(""))
  assert score.value == 0.0
  assert "tags '<a2ui-json>' and '</a2ui-json>' not found" in score.explanation


@pytest.mark.asyncio
async def test_scorer_missing_root():
  scorer = a2ui_scorer(version="0.9")
  payload = """
    <a2ui-json>
    [
      {
        "version": "v0.9",
        "createSurface": {
          "surfaceId": "main",
          "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
        }
      },
      {
        "version": "v0.9",
        "updateComponents": {
          "surfaceId": "main",
          "components": [
            {"id": "not-root", "component": "Text", "text": "Hello"}
          ]
        }
      }
    ]
    </a2ui-json>
    """
  state = TaskState(
      model=ModelName("mock/model"),
      sample_id=1,
      epoch=1,
      input="test",
      messages=[],
      output=ModelOutput(model="mock/model", completion=payload),
      metadata={"catalog": str(CATALOG_PATH)},
  )
  score = await scorer(state, Target(""))
  assert score.value == 0.0
  assert "Missing root component" in score.explanation


@pytest.mark.asyncio
async def test_scorer_duplicate_ids():
  scorer = a2ui_scorer(version="0.9")
  payload = """
    <a2ui-json>
    {
      "version": "v0.9",
      "updateComponents": {
        "surfaceId": "main",
        "components": [
          {"id": "root", "component": "Column", "children": ["child1", "child2"]},
          {"id": "child1", "component": "Text", "text": "1"},
          {"id": "child1", "component": "Text", "text": "2"}
        ]
      }
    }
    </a2ui-json>
    """
  state = TaskState(
      model=ModelName("mock/model"),
      sample_id=1,
      epoch=1,
      input="test",
      messages=[],
      output=ModelOutput(model="mock/model", completion=payload),
      metadata={"catalog": str(CATALOG_PATH)},
  )
  score = await scorer(state, Target(""))
  assert score.value == 0.0
  assert "Duplicate component ID" in score.explanation


@pytest.mark.asyncio
async def test_scorer_broken_relationship():
  scorer = a2ui_scorer(version="0.9")
  payload = """
    <a2ui-json>
    [
      {
        "version": "v0.9",
        "createSurface": {
          "surfaceId": "main",
          "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
        }
      },
      {
        "version": "v0.9",
        "updateComponents": {
          "surfaceId": "main",
          "components": [
            {"id": "root", "component": "Column", "children": ["child1", "missing-child"]},
            {"id": "child1", "component": "Text", "text": "1"}
          ]
        }
      }
    ]
    </a2ui-json>
    """
  state = TaskState(
      model=ModelName("mock/model"),
      sample_id=1,
      epoch=1,
      input="test",
      messages=[],
      output=ModelOutput(model="mock/model", completion=payload),
      metadata={"catalog": str(CATALOG_PATH)},
  )
  score = await scorer(state, Target(""))
  assert score.value == 0.0
  assert "references non-existent component" in score.explanation


@pytest.mark.asyncio
async def test_scorer_circular_reference():
  scorer = a2ui_scorer(version="0.9")
  payload = """
    <a2ui-json>
    {
      "version": "v0.9",
      "updateComponents": {
        "surfaceId": "main",
        "components": [
          {"id": "root", "component": "Column", "children": ["nodeA"]},
          {"id": "nodeA", "component": "Row", "children": ["nodeB"]},
          {"id": "nodeB", "component": "Row", "children": ["nodeA"]}
        ]
      }
    }
    </a2ui-json>
    """
  state = TaskState(
      model=ModelName("mock/model"),
      sample_id=1,
      epoch=1,
      input="test",
      messages=[],
      output=ModelOutput(model="mock/model", completion=payload),
      metadata={"catalog": str(CATALOG_PATH)},
  )
  score = await scorer(state, Target(""))
  assert score.value == 0.0
  assert "Circular reference detected" in score.explanation
