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

import json
import os
from typing import Any
from unittest.mock import patch

from inspect_ai.model import ModelName, ModelOutput
from inspect_ai.scorer import Target
from inspect_ai.solver import TaskState
import pytest

from a2ui_eval.runner import DEFAULT_PARSE_TIMEOUT_SEC
from a2ui_eval.scorers import a2ui_scorer

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
CATALOG_PATH = os.path.abspath(
    os.path.join(CURRENT_DIR, "../../specification/v0_9/catalogs/basic/catalog.json")
)
CATALOG_PATH_V091 = os.path.abspath(
    os.path.join(CURRENT_DIR, "../../specification/v0_9_1/catalogs/basic/catalog.json")
)


@pytest.mark.asyncio
async def test_scorer_valid_json_v091() -> None:
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
    assert score is not None
    assert score.explanation is not None
    assert score.value == 1.0
    assert "Valid A2UI payload" in score.explanation


@pytest.mark.asyncio
async def test_scorer_valid_json() -> None:
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
    assert score is not None
    assert score.explanation is not None
    assert score.value == 1.0
    assert "Valid A2UI payload" in score.explanation


@pytest.mark.asyncio
async def test_scorer_invalid_json() -> None:
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
    assert score is not None
    assert score.explanation is not None
    assert score.value == 0.0
    assert "tags '<a2ui-json>' and '</a2ui-json>' not found" in score.explanation


@pytest.mark.asyncio
async def test_scorer_missing_root() -> None:
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
    assert score is not None
    assert score.explanation is not None
    assert score.value == 0.0
    assert "Missing root component" in score.explanation


@pytest.mark.asyncio
async def test_scorer_duplicate_ids() -> None:
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
            {"id": "root", "component": "Column", "children": ["child1", "child2"]},
            {"id": "child1", "component": "Text", "text": "1"},
            {"id": "child1", "component": "Text", "text": "2"}
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
    assert score is not None
    assert score.explanation is not None
    assert score.value == 0.0
    assert "Duplicate component ID" in score.explanation


@pytest.mark.asyncio
async def test_scorer_broken_relationship() -> None:
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
    assert score is not None
    assert score.explanation is not None
    assert score.value == 0.0
    assert "references non-existent component" in score.explanation


@pytest.mark.asyncio
async def test_scorer_circular_reference() -> None:
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
            {"id": "root", "component": "Column", "children": ["nodeA"]},
            {"id": "nodeA", "component": "Row", "children": ["nodeB"]},
            {"id": "nodeB", "component": "Row", "children": ["nodeA"]}
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
    assert score is not None
    assert score.explanation is not None
    assert score.value == 0.0
    assert "Circular reference detected" in score.explanation


class _RecordingRunner:
    """Fake runner that records calls and fails strict validation on demand."""

    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.calls: list[dict[str, Any]] = []

    def parse_and_validate(
        self,
        format_name: str,
        version: str,
        resolved_catalog_path: str,
        surface_id: str,
        completion: str,
        timeout_sec: float = DEFAULT_PARSE_TIMEOUT_SEC,
        require_complete_tags: bool = False,
        *,
        validate: bool = True,
    ) -> dict[str, Any]:
        self.calls.append({"timeout_sec": timeout_sec, "validate": validate})
        if validate and self.error is not None:
            raise self.error
        return {"compiled_jsons": [{"version": "v0.9.1"}], "parts": []}


def _state_with_completion(completion: str) -> TaskState:
    return TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=[],
        output=ModelOutput(model="mock/model", completion=completion),
        metadata={"catalog": str(CATALOG_PATH_V091)},
    )


@pytest.mark.asyncio
async def test_scorer_uses_default_timeout() -> None:
    runner = _RecordingRunner()
    with patch(
        "a2ui_eval.scorers.parse_and_validate", side_effect=runner.parse_and_validate
    ):
        score = await a2ui_scorer(version="0.9.1")(
            _state_with_completion("<a2ui-json>[]</a2ui-json>"), Target("")
        )
    assert score.value == 1.0
    assert runner.calls == [
        {"timeout_sec": DEFAULT_PARSE_TIMEOUT_SEC, "validate": True}
    ]


@pytest.mark.asyncio
async def test_scorer_answer_is_compiled_json_on_validation_failure() -> None:
    runner = _RecordingRunner(error=ValueError("Component 'root' is missing"))
    with patch(
        "a2ui_eval.scorers.parse_and_validate", side_effect=runner.parse_and_validate
    ):
        score = await a2ui_scorer(version="0.9.1")(
            _state_with_completion("<a2ui-json>[...]</a2ui-json>"), Target("")
        )
    assert score.value == 0.0
    assert score.explanation == "Component 'root' is missing"
    assert json.loads(score.answer) == [{"version": "v0.9.1"}]
    assert [c["validate"] for c in runner.calls] == [True, False]


@pytest.mark.asyncio
async def test_scorer_answer_is_raw_completion_when_parsing_fails() -> None:
    scorer = a2ui_scorer(version="0.9")
    score = await scorer(_state_with_completion("invalid json"), Target(""))
    assert score.value == 0.0
    assert score.answer == "invalid json"


@pytest.mark.asyncio
async def test_scorer_skips_parse_retry_after_timeout() -> None:
    runner = _RecordingRunner(error=TimeoutError("timed out"))
    with patch(
        "a2ui_eval.scorers.parse_and_validate", side_effect=runner.parse_and_validate
    ):
        score = await a2ui_scorer(version="0.9.1")(
            _state_with_completion("<a2ui-json>[]</a2ui-json>"), Target("")
        )
    assert score.value == 0.0
    assert score.answer == "<a2ui-json>[]</a2ui-json>"
    assert len(runner.calls) == 1
