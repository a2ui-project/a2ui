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
from unittest.mock import AsyncMock, patch

from inspect_ai.model import ModelName, ModelOutput
from inspect_ai.scorer import Score, Target
from inspect_ai.solver import TaskState
import pytest

from a2ui_eval.runner import DEFAULT_PARSE_TIMEOUT_SEC, RunnerOptions
from a2ui_eval.scorers import (
    STAGE12_PASSED_KEY,
    a2ui_scorer,
    evaluate_stage2_assertions,
    measured_model_graded_qa,
)

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
    scorer = a2ui_scorer(version="0.9.1")
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
    scorer = a2ui_scorer(version="0.9.1")
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
    scorer = a2ui_scorer(version="0.9.1")
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
    scorer = a2ui_scorer(version="0.9.1")
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
    scorer = a2ui_scorer(version="0.9.1")
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
    scorer = a2ui_scorer(version="0.9.1")
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

    def __call__(
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
        options: RunnerOptions | None = None,
    ) -> dict[str, Any]:
        self.calls.append({
            "timeout_sec": timeout_sec,
            "validate": validate,
            "options": options,
        })
        if validate and self.error is not None:
            raise self.error
        return {"compiled_jsons": [{"version": "v0.9.1"}], "parts": []}


def _state_with_completion(
    completion: str, metadata: dict[str, Any] | None = None
) -> TaskState:
    return TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=[],
        output=ModelOutput(model="mock/model", completion=completion),
        metadata={"catalog": str(CATALOG_PATH_V091), **(metadata or {})},
    )


@pytest.mark.asyncio
async def test_scorer_uses_default_timeout() -> None:
    runner = _RecordingRunner()
    with patch("a2ui_eval.scorers.parse_and_validate", side_effect=runner):
        score = await a2ui_scorer(version="0.9.1")(
            _state_with_completion("<a2ui-json>[]</a2ui-json>"), Target("")
        )
    assert score is not None
    assert score.value == 1.0
    assert [(c["timeout_sec"], c["validate"]) for c in runner.calls] == [
        (DEFAULT_PARSE_TIMEOUT_SEC, True)
    ]


@pytest.mark.asyncio
async def test_scorer_passes_runner_options_from_metadata() -> None:
    runner = _RecordingRunner()
    state = _state_with_completion(
        "<a2ui-json>[]</a2ui-json>",
        {"allowed_messages": ["updateDataModel"], "stream_chunk_size": 7},
    )
    with patch("a2ui_eval.scorers.parse_and_validate", side_effect=runner):
        await a2ui_scorer(version="0.9.1")(state, Target(""))
    options = runner.calls[0]["options"]
    assert isinstance(options, RunnerOptions)
    assert options.allowed_messages == ("updateDataModel",)
    assert options.stream_chunk_size == 7
    assert options.catalogs[0].path == str(CATALOG_PATH_V091)


@pytest.mark.asyncio
async def test_scorer_answer_is_compiled_json_on_validation_failure() -> None:
    runner = _RecordingRunner(error=ValueError("Component 'root' is missing"))
    with patch("a2ui_eval.scorers.parse_and_validate", side_effect=runner):
        score = await a2ui_scorer(version="0.9.1")(
            _state_with_completion("<a2ui-json>[...]</a2ui-json>"), Target("")
        )
    assert score is not None
    assert score.value == 0.0
    assert score.explanation == "Component 'root' is missing"
    assert score.answer is not None
    assert json.loads(score.answer) == [{"version": "v0.9.1"}]
    assert [c["validate"] for c in runner.calls] == [True, False]


@pytest.mark.asyncio
async def test_scorer_answer_is_raw_completion_when_parsing_fails() -> None:
    scorer = a2ui_scorer(version="0.9.1")
    score = await scorer(_state_with_completion("invalid json"), Target(""))
    assert score is not None
    assert score.value == 0.0
    assert score.answer == "invalid json"


@pytest.mark.asyncio
async def test_scorer_skips_parse_retry_after_timeout() -> None:
    runner = _RecordingRunner(error=TimeoutError("timed out"))
    with patch("a2ui_eval.scorers.parse_and_validate", side_effect=runner):
        score = await a2ui_scorer(version="0.9.1")(
            _state_with_completion("<a2ui-json>[]</a2ui-json>"), Target("")
        )
    assert score is not None
    assert score.value == 0.0
    assert score.answer == "<a2ui-json>[]</a2ui-json>"
    assert len(runner.calls) == 1


# --- Stage 2: deterministic assertions ------------------------------------

_STAGE2_MESSAGES: list[dict[str, Any]] = [
    {
        "version": "v0.9",
        "createSurface": {
            "surfaceId": "main",
            "catalogId": "https://a2ui.org/catalogs/basic",
        },
    },
    {
        "version": "v0.9",
        "updateComponents": {
            "surfaceId": "main",
            "components": [
                {
                    "id": "root",
                    "component": "Column",
                    "children": ["date", "go"],
                },
                {
                    "id": "date",
                    "component": "DateTimeInput",
                    "value": {"path": "/booking/date"},
                },
                {
                    "id": "go",
                    "component": "Button",
                    "child": "label",
                    "action": {"event": {"name": "submit_booking"}},
                },
                {
                    "id": "label",
                    "component": "Text",
                    "text": {"@path": "/labels/go"},
                },
            ],
        },
    },
    {
        "version": "v0.9",
        "updateDataModel": {
            "surfaceId": "main",
            "path": "/booking",
            "value": {},
        },
    },
]


def test_stage2_all_assertions_pass() -> None:
    assertions = {
        "required_components": ["Button", "DateTimeInput"],
        "forbidden_components": ["Image"],
        "required_bindings": ["/booking/date", "/labels/go", "/booking"],
        "required_actions": ["submit_booking"],
        "message_types": ["createSurface", "updateComponents", "updateDataModel"],
        "catalog_ids": ["https://a2ui.org/catalogs/basic"],
    }
    assert evaluate_stage2_assertions(_STAGE2_MESSAGES, assertions) == []


def test_stage2_empty_assertions_pass() -> None:
    assert evaluate_stage2_assertions(_STAGE2_MESSAGES, {}) == []
    assert evaluate_stage2_assertions([], {"required_components": []}) == []


@pytest.mark.parametrize(
    "assertions, expected",
    [
        (
            {"required_components": ["Button", "Slider"]},
            "Missing required components: Slider",
        ),
        (
            {"forbidden_components": ["Text", "Image"]},
            "Forbidden components present: Text",
        ),
        (
            {"required_bindings": ["/booking/date", "/missing"]},
            "Missing required bindings: /missing",
        ),
        (
            {"required_actions": ["cancel"]},
            "Missing required actions: cancel",
        ),
        (
            {"message_types": ["createSurface", "updateComponents"]},
            (
                "Unexpected message types: updateDataModel"
                " (allowed: createSurface, updateComponents)"
            ),
        ),
        (
            {"catalog_ids": ["https://example.com/other"]},
            "Missing required catalog ids: https://example.com/other",
        ),
    ],
)
def test_stage2_each_failure_kind(assertions: dict[str, Any], expected: str) -> None:
    assert evaluate_stage2_assertions(_STAGE2_MESSAGES, assertions) == [expected]


def test_stage2_reports_every_failed_field() -> None:
    failures = evaluate_stage2_assertions(
        _STAGE2_MESSAGES,
        {"required_components": ["Slider"], "required_actions": ["cancel"]},
    )
    assert len(failures) == 2


def test_stage2_recognises_alternative_shapes() -> None:
    messages = [{
        "version": "1.0",
        "updateComponents": {
            "surfaceId": "main",
            "components": [{
                "id": "root",
                "component": "Button",
                "catalogId": "custom",
                "action": {"@call": "openUrl"},
                "label": '{"path": "/cta"}',
                "child": {
                    "component": "Text",
                    "action": {"functionCall": {"call": "noop"}},
                },
            }],
        },
    }]
    failures = evaluate_stage2_assertions(
        messages,
        {
            "required_components": ["Button", "Text"],
            "required_actions": ["openUrl", "noop"],
            "required_bindings": ["/cta"],
            "catalog_ids": ["custom"],
        },
    )
    assert failures == []


# --- a2ui_scorer: Stage 1 reuse and Stage 2 gating -------------------------


@pytest.mark.asyncio
async def test_scorer_reuses_compiled_messages_without_calling_runner() -> None:
    runner = _RecordingRunner()
    state = _state_with_completion(
        "<a2ui-json>[]</a2ui-json>", {"compiled_messages": _STAGE2_MESSAGES}
    )
    with patch("a2ui_eval.scorers.parse_and_validate", side_effect=runner):
        score = await a2ui_scorer(version="0.9.1")(state, Target(""))
    assert runner.calls == []
    assert score is not None
    assert score.value == 1.0
    assert score.answer is not None
    assert json.loads(score.answer) == _STAGE2_MESSAGES
    assert state.metadata[STAGE12_PASSED_KEY] is True


@pytest.mark.asyncio
async def test_scorer_runs_stage2_on_compiled_messages() -> None:
    state = _state_with_completion(
        "<a2ui-json>[]</a2ui-json>",
        {
            "compiled_messages": _STAGE2_MESSAGES,
            "assertions": {"required_components": ["Slider"]},
        },
    )
    runner = _RecordingRunner()
    with patch("a2ui_eval.scorers.parse_and_validate", side_effect=runner):
        score = await a2ui_scorer(version="0.9.1")(state, Target(""))
    assert runner.calls == []
    assert score is not None
    assert score.value == 0.0
    assert score.explanation is not None
    assert "Stage 2 assertions failed" in score.explanation
    assert "Missing required components: Slider" in score.explanation
    assert state.metadata[STAGE12_PASSED_KEY] is False


@pytest.mark.asyncio
async def test_scorer_runs_stage2_after_runner_validation() -> None:
    runner = _RecordingRunner()
    state = _state_with_completion(
        "<a2ui-json>[]</a2ui-json>",
        {"assertions": {"message_types": ["createSurface"]}},
    )
    with patch("a2ui_eval.scorers.parse_and_validate", side_effect=runner):
        score = await a2ui_scorer(version="0.9.1")(state, Target(""))
    assert len(runner.calls) == 1
    assert score is not None
    assert score.value == 1.0
    assert score.explanation == "Valid A2UI payload; Stage 2 assertions passed"
    assert state.metadata[STAGE12_PASSED_KEY] is True


@pytest.mark.asyncio
async def test_scorer_marks_stage1_failure_in_metadata() -> None:
    runner = _RecordingRunner(error=ValueError("bad payload"))
    state = _state_with_completion("<a2ui-json>[]</a2ui-json>")
    with patch("a2ui_eval.scorers.parse_and_validate", side_effect=runner):
        score = await a2ui_scorer(version="0.9.1")(state, Target(""))
    assert score is not None
    assert score.value == 0.0
    assert state.metadata[STAGE12_PASSED_KEY] is False


@pytest.mark.asyncio
async def test_scorer_marks_solver_failure_in_metadata() -> None:
    state = _state_with_completion("Compilation/validation failed: nope")
    score = await a2ui_scorer(version="0.9.1")(state, Target(""))
    assert score is not None
    assert score.value == 0.0
    assert state.metadata[STAGE12_PASSED_KEY] is False


# --- measured_model_graded_qa: Stage 3 gating ------------------------------


@pytest.mark.asyncio
async def test_judge_skipped_when_stage12_failed() -> None:
    state = _state_with_completion("anything", {STAGE12_PASSED_KEY: False})
    with patch("a2ui_eval.scorers.model_graded_qa") as graded:
        graded.return_value = AsyncMock()
        score = await measured_model_graded_qa(model="mock/judge")(state, Target(""))
    graded.return_value.assert_not_called()
    assert score is not None
    assert score.value == "I"
    assert score.explanation == "Skipped LLM judge because Stage 1/2 validation failed."


@pytest.mark.asyncio
async def test_judge_runs_when_stage12_passed() -> None:
    state = _state_with_completion("anything", {STAGE12_PASSED_KEY: True})
    judge = AsyncMock(return_value=Score(value="P", explanation="partial"))
    with patch("a2ui_eval.scorers.model_graded_qa", return_value=judge):
        score = await measured_model_graded_qa(model="mock/judge")(state, Target(""))
    judge.assert_awaited_once()
    assert score is not None
    assert score.value == "P"
    assert "evaluation_duration_seconds" in state.metadata
    assert state.metadata["evaluation_input_tokens"] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "stage12, expected",
    [(True, "C"), (None, "C"), (False, "I")],
)
async def test_no_judge_mode_never_calls_model(
    stage12: bool | None, expected: str
) -> None:
    metadata = {} if stage12 is None else {STAGE12_PASSED_KEY: stage12}
    state = _state_with_completion("anything", metadata)
    with patch("a2ui_eval.scorers.model_graded_qa") as graded:
        score = await measured_model_graded_qa(no_judge=True)(state, Target(""))
    graded.assert_not_called()
    assert score is not None
    assert score.value == expected
    assert score.explanation is not None
    assert score.explanation.startswith("Skipped LLM judge")


def test_stage2_written_data_paths_count_as_bindings() -> None:
    """Data written inline or via updateDataModel satisfies required_bindings."""
    folded = [{
        "version": "1.0",
        "createSurface": {
            "surfaceId": "main",
            "catalogId": "cat",
            "dataModel": {
                "products": {"p1": {"id": "p1"}},
                "user": {"name": "John", "email": "j@x", "event": {"name": "n"}},
            },
        },
    }]
    written = [{
        "version": "1.0",
        "updateDataModel": {
            "surfaceId": "main",
            "path": "/user",
            "value": {"name": "J", "email": "e", "component": "Text"},
        },
    }]
    wanted = {"required_bindings": ["/products", "/user/name", "/user/email"]}
    assert evaluate_stage2_assertions(folded, wanted) == []
    assert (
        evaluate_stage2_assertions(
            written, {"required_bindings": ["/user", "/user/name", "/user/email"]}
        )
        == []
    )
    assert evaluate_stage2_assertions(folded, {"required_actions": ["n"]}) == [
        "Missing required actions: n"
    ]
    assert evaluate_stage2_assertions(written, {"required_components": ["Text"]}) == [
        "Missing required components: Text"
    ]
