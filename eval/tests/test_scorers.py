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
import pytest

from a2ui_eval.scorers import (
    a2ui_scorer,
    classify_exception,
    failure_distribution,
)
from a2ui.core.exceptions import (
    A2uiCatalogError,
    A2uiCompileError,
    A2uiError,
    A2uiErrorDetail,
    A2uiIntegrityError,
    A2uiParseError,
    A2uiRecursionError,
    A2uiValidationError,
)
from inspect_ai.scorer import Target, SampleScore, Score
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
    assert score.metadata is None or "failure_category" not in score.metadata


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
    assert score.metadata is not None
    assert score.metadata.get("failure_category") == "no_a2ui_payload_found"
    assert score.metadata.get("coarse_category") == "no_a2ui_payload_found"


@pytest.mark.asyncio
async def test_scorer_malformed_json() -> None:
    scorer = a2ui_scorer(version="0.9")
    state = TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=[],
        output=ModelOutput(
            model="mock/model", completion="<a2ui-json>\n{not valid json\n</a2ui-json>"
        ),
        metadata={"catalog": str(CATALOG_PATH)},
    )
    score = await scorer(state, Target(""))
    assert score is not None
    assert score.explanation is not None
    assert score.value == 0.0
    assert score.metadata is not None
    assert score.metadata.get("failure_category") == "parse_error"
    assert score.metadata.get("coarse_category") == "parse_error"


@pytest.mark.asyncio
async def test_scorer_no_model_output() -> None:
    scorer = a2ui_scorer(version="0.9")
    state = TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=[],
        output=None,
        metadata={"catalog": str(CATALOG_PATH)},
    )
    score = await scorer(state, Target(""))
    assert score is not None
    assert score.value == 0.0
    assert "No model output" in (score.explanation or "")
    assert score.metadata is not None
    assert score.metadata.get("failure_category") == "no_model_output"
    assert score.metadata.get("coarse_category") == "no_model_output"


@pytest.mark.asyncio
async def test_scorer_solver_step_compilation_failure() -> None:
    scorer = a2ui_scorer(version="0.9")
    state = TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=[],
        output=ModelOutput(
            model="mock/model",
            completion="Compilation/validation failed: Syntax error in express format",
        ),
        metadata={"catalog": str(CATALOG_PATH)},
    )
    score = await scorer(state, Target(""))
    assert score is not None
    assert score.value == 0.0
    assert "Format compilation/validation failed during solver step." in (
        score.explanation or ""
    )
    assert score.metadata is not None
    assert score.metadata.get("failure_category") == "solver_step_compilation_failure"
    assert score.metadata.get("coarse_category") == "solver_step_compilation_failure"


@pytest.mark.asyncio
async def test_scorer_no_a2ui_payload_found() -> None:
    scorer = a2ui_scorer(version="0.9")
    state = TaskState(
        model=ModelName("mock/model"),
        sample_id=1,
        epoch=1,
        input="test",
        messages=[],
        output=ModelOutput(
            model="mock/model",
            completion="Hello! I cannot generate any UI for this request.",
        ),
        metadata={"catalog": str(CATALOG_PATH)},
    )
    score = await scorer(state, Target(""))
    assert score is not None
    assert score.value == 0.0
    assert score.metadata is not None
    assert score.metadata.get("failure_category") in (
        "no_a2ui_payload_found",
        "parse_error",
    )


@pytest.mark.asyncio
async def test_scorer_validation_missing_field() -> None:
    scorer = a2ui_scorer(version="0.9")
    payload = """
    <a2ui-json>
    [
      {
        "version": "v0.9",
        "createSurface": {
          "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
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
    assert score.value == 0.0
    assert score.metadata is not None
    assert score.metadata.get("failure_category") == "validation_error:missing_field"
    assert score.metadata.get("coarse_category") == "validation_error"
    assert score.metadata.get("error_code") == "missing_field"


@pytest.mark.asyncio
async def test_scorer_validation_type_mismatch() -> None:
    scorer = a2ui_scorer(version="0.9")
    payload = """
    <a2ui-json>
    [
      {
        "version": "v0.9",
        "createSurface": {
          "surfaceId": 12345,
          "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"
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
    assert score.value == 0.0
    assert score.metadata is not None
    assert score.metadata.get("failure_category") == "validation_error:type_mismatch"
    assert score.metadata.get("coarse_category") == "validation_error"
    assert score.metadata.get("error_code") == "type_mismatch"


@pytest.mark.asyncio
async def test_scorer_validation_extra_field() -> None:
    scorer = a2ui_scorer(version="0.9")
    payload = """
    <a2ui-json>
    [
      {
        "version": "v0.9",
        "createSurface": {
          "surfaceId": "main",
          "catalogId": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
          "extraPropertyNotAllowed": true
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
    assert score.value == 0.0
    assert score.metadata is not None
    assert score.metadata.get("failure_category") == "validation_error:extra_field"
    assert score.metadata.get("coarse_category") == "validation_error"
    assert score.metadata.get("error_code") == "extra_field"


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
    assert score.metadata is not None
    assert score.metadata.get("failure_category") == "integrity_error"
    assert score.metadata.get("coarse_category") == "integrity_error"


@pytest.mark.asyncio
async def test_scorer_duplicate_ids() -> None:
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
    assert score is not None
    assert score.explanation is not None
    assert score.value == 0.0
    assert "Duplicate component ID" in score.explanation
    assert score.metadata is not None
    assert score.metadata.get("failure_category") == "integrity_error"
    assert score.metadata.get("coarse_category") == "integrity_error"


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
    assert score.metadata is not None
    assert score.metadata.get("failure_category") == "integrity_error"
    assert score.metadata.get("coarse_category") == "integrity_error"


@pytest.mark.asyncio
async def test_scorer_circular_reference() -> None:
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
    assert score is not None
    assert score.explanation is not None
    assert score.value == 0.0
    assert "Circular reference detected" in score.explanation
    assert score.metadata is not None
    assert score.metadata.get("failure_category") == "integrity_error"
    assert score.metadata.get("coarse_category") == "integrity_error"


def test_classify_exception() -> None:
    # 1. Validation errors with details
    val_err_missing = A2uiValidationError(
        "Missing required field",
        details=[A2uiErrorDetail(path="foo", code="missing_field", message="Missing")],
    )
    assert classify_exception(val_err_missing) == (
        "validation_error",
        "validation_error:missing_field",
    )

    val_err_type = A2uiValidationError(
        "Type mismatch",
        details=[A2uiErrorDetail(path="bar", code="type_mismatch", message="Mismatch")],
    )
    assert classify_exception(val_err_type) == (
        "validation_error",
        "validation_error:type_mismatch",
    )

    val_err_no_detail = A2uiValidationError("Plain validation error")
    assert classify_exception(val_err_no_detail) == (
        "validation_error",
        "validation_error",
    )

    # 2. Parse errors
    assert classify_exception(A2uiParseError("Parse failed")) == (
        "parse_error",
        "parse_error",
    )
    assert classify_exception(json.JSONDecodeError("msg", "doc", 0)) == (
        "parse_error",
        "parse_error",
    )

    # 3. Integrity errors
    assert classify_exception(A2uiIntegrityError("Duplicate ID")) == (
        "integrity_error",
        "integrity_error",
    )

    # 4. Recursion errors
    assert classify_exception(A2uiRecursionError("Too deep")) == (
        "recursion_error",
        "recursion_error",
    )

    # 5. Catalog errors
    assert classify_exception(A2uiCatalogError("Catalog missing")) == (
        "catalog_error",
        "catalog_error",
    )

    # 6. Compilation errors
    assert classify_exception(A2uiCompileError("DSL compile failed")) == (
        "compile_error",
        "compile_error",
    )

    # 7. Base A2UI error
    assert classify_exception(A2uiError("Generic")) == (
        "unknown_a2ui_error",
        "unknown_a2ui_error",
    )

    # 8. Unhandled exception
    assert classify_exception(RuntimeError("Crash")) == (
        "unknown_error",
        "unknown_error",
    )


def test_failure_distribution_metric() -> None:
    metric_fn = failure_distribution(normalize=False)
    scores = [
        SampleScore(score=Score(value=1.0)),
        SampleScore(
            score=Score(
                value=0.0,
                metadata={"failure_category": "validation_error:missing_field"},
            )
        ),
        SampleScore(
            score=Score(
                value=0.0,
                metadata={"failure_category": "validation_error:missing_field"},
            )
        ),
        SampleScore(
            score=Score(
                value=0.0,
                metadata={"failure_category": "no_model_output"},
            )
        ),
    ]

    result = metric_fn(scores)
    assert result == {
        "validation_error:missing_field": 2,
        "no_model_output": 1,
    }

    # Normalized version
    norm_fn = failure_distribution(normalize=True)
    norm_result = norm_fn(scores)
    assert norm_result == {
        "validation_error:missing_field": 0.5,
        "no_model_output": 0.25,
    }


def test_failure_distribution_empty() -> None:
    metric_fn = failure_distribution(normalize=False)
    scores = [
        SampleScore(score=Score(value=1.0)),
        SampleScore(score=Score(value=1.0)),
    ]
    assert metric_fn(scores) == {}
    assert metric_fn([]) == {}
