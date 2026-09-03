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

"""Scorers for A2UI evaluation."""

import json
import time
from typing import Any
from inspect_ai.scorer import (
    Metric,
    SampleScore,
    Score,
    Scorer,
    Target,
    accuracy,
    metric,
    model_graded_qa,
    scorer,
)
from inspect_ai.solver import TaskState
from inspect_ai.model._model import sample_model_usage
from a2ui.core.exceptions import (
    A2uiCatalogError,
    A2uiCompileError,
    A2uiError,
    A2uiIntegrityError,
    A2uiParseError,
    A2uiRecursionError,
    A2uiValidationError,
)
from a2ui.parser.errors import A2uiCompilationError

try:
    from a2ui.inference_formats.experimental.express.errors import ExpressCompilerError
except ImportError:

    class ExpressCompilerError(Exception):  # type: ignore[no-redef]
        pass


from a2ui.inference_formats.direct_json.format import DirectJsonFormat
from a2ui.schema.catalog import CatalogConfig
from a2ui.parser.parser import parse_response
from .shared.utils import GIT_ROOT


@metric
def failure_distribution(normalize: bool = False) -> Metric:
    """Computes the distribution of failure categories across scored samples.

    Args:
        normalize: If True, returns proportions relative to total scored samples.
                   If False (default), returns raw counts for each failure category.

    Returns:
        A Metric function that aggregates failure categories into a dictionary of counts or proportions.
    """

    def compute(scores: list[SampleScore]) -> dict[str, int | float]:
        counts: dict[str, int | float] = {}
        for s in scores:
            cat = (s.score.metadata or {}).get("failure_category")
            if cat:
                counts[cat] = counts.get(cat, 0) + 1

        if not normalize:
            return counts

        total = len(scores)
        denom = float(total) if total > 0 else 1.0
        return {cat: count / denom for cat, count in counts.items()}

    return compute


def classify_exception(e: Exception) -> tuple[str, str]:
    """Derives coarse and fine failure categories from an exception.

    Args:
        e: The exception raised during parsing or validation.

    Returns:
        A tuple of (coarse_category, fine_category).
    """
    if isinstance(e, A2uiIntegrityError):
        return "integrity_error", "integrity_error"

    if isinstance(e, A2uiRecursionError):
        return "recursion_error", "recursion_error"

    if isinstance(e, A2uiCatalogError):
        return "catalog_error", "catalog_error"

    if isinstance(e, (A2uiCompileError, A2uiCompilationError, ExpressCompilerError)):
        return "compile_error", "compile_error"

    if isinstance(e, A2uiValidationError):
        if getattr(e, "details", None) and e.details and e.details[0].code:
            return "validation_error", f"validation_error:{e.details[0].code}"

        # If it is a wrapper exception without details, check error message for integrity/recursion
        msg = str(e).lower()
        if (
            "missing root component" in msg
            or "duplicate component id" in msg
            or "references non-existent component" in msg
            or "circular reference" in msg
        ):
            return "integrity_error", "integrity_error"
        if "recursion limit exceeded" in msg:
            return "recursion_error", "recursion_error"

        return "validation_error", "validation_error"

    if isinstance(e, A2uiParseError):
        msg = str(e).lower()
        if "not found in response" in msg or "empty" in msg:
            return "no_a2ui_payload_found", "no_a2ui_payload_found"
        return "parse_error", "parse_error"

    if isinstance(e, json.JSONDecodeError):
        return "parse_error", "parse_error"

    if isinstance(e, A2uiError):
        return "unknown_a2ui_error", "unknown_a2ui_error"

    return "unknown_error", "unknown_error"


@scorer(metrics=[accuracy(), failure_distribution()])
def a2ui_scorer(version: str) -> Scorer:
    """Scorer for A2UI evaluation using the Python SDK.

    Args:
        version: The schema version to load (e.g. '0.9.1' or '1.0').

    Returns:
        An Inspect Scorer that validates the response against the schema and integrity rules.
    """

    async def score(
        state: TaskState, target: Target
    ) -> Score:  # pylint: disable=unused-argument
        if not state.output or not (
            state.output.completion and state.output.completion.strip()
        ):
            return Score(
                value=0.0,
                explanation="No model output (generation failed or was interrupted)",
                metadata={
                    "failure_category": "no_model_output",
                    "coarse_category": "no_model_output",
                },
            )

        catalog_path = state.metadata["catalog"]
        resolved_catalog_path = str(GIT_ROOT / catalog_path)

        catalog_config = CatalogConfig.from_path("basic_catalog", resolved_catalog_path)
        direct_json_format = DirectJsonFormat(
            version=version,
            catalogs=[catalog_config],
            experiments={"version_1_0"} if version == "1.0" else None,
        )
        catalog = direct_json_format.get_selected_catalog()
        validator = catalog.validator

        answer_text = state.output.completion or ""

        if answer_text.strip().startswith("Compilation/validation failed:"):
            return Score(
                value=0.0,
                answer=answer_text,
                explanation="Format compilation/validation failed during solver step.",
                metadata={
                    "failure_category": "solver_step_compilation_failure",
                    "coarse_category": "solver_step_compilation_failure",
                },
            )

        try:
            parts = parse_response(answer_text)
            all_messages = []
            for part in parts:
                if part.a2ui_json:
                    if isinstance(part.a2ui_json, list):
                        all_messages.extend(part.a2ui_json)
                    else:
                        all_messages.append(part.a2ui_json)

            if not all_messages:
                return Score(
                    value=0.0,
                    answer=answer_text,
                    explanation=(
                        "No A2UI JSON found in response (tags missing or empty)"
                    ),
                    metadata={
                        "failure_category": "no_a2ui_payload_found",
                        "coarse_category": "no_a2ui_payload_found",
                    },
                )

            answer_text = json.dumps(all_messages, indent=2)
            validator.validate(all_messages)
            return Score(
                value=1.0, answer=answer_text, explanation="Valid A2UI payload"
            )
        except Exception as e:
            coarse, fine = classify_exception(e)
            metadata: dict[str, Any] = {
                "failure_category": fine,
                "coarse_category": coarse,
                "error_type": type(e).__name__,
            }
            if (
                isinstance(e, A2uiValidationError)
                and getattr(e, "details", None)
                and e.details
            ):
                metadata["error_code"] = e.details[0].code
                metadata["error_path"] = e.details[0].path
            return Score(
                value=0.0,
                answer=answer_text,
                explanation=str(e),
                metadata=metadata,
            )

    return score


@scorer(metrics=[accuracy()])
def measured_model_graded_qa(model: str, instructions: str | None = None) -> Scorer:
    """Scorer that wraps model_graded_qa and records the token usage in metadata."""
    base_scorer = model_graded_qa(model=model, instructions=instructions)

    async def score(state: TaskState, target: Target) -> Score:
        start_time = time.time()

        usage_before = sample_model_usage().get(model)
        before_input = usage_before.input_tokens if usage_before else 0
        before_cr = usage_before.input_tokens_cache_read or 0 if usage_before else 0
        before_cw = usage_before.input_tokens_cache_write or 0 if usage_before else 0
        before_total_input = before_input + before_cr + before_cw
        before_cached = before_cr + before_cw
        before_output = usage_before.output_tokens if usage_before else 0

        result = await base_scorer(state, target)

        duration = time.time() - start_time

        usage_after = sample_model_usage().get(model)
        after_input = usage_after.input_tokens if usage_after else 0
        after_cr = usage_after.input_tokens_cache_read or 0 if usage_after else 0
        after_cw = usage_after.input_tokens_cache_write or 0 if usage_after else 0
        after_total_input = after_input + after_cr + after_cw
        after_cached = after_cr + after_cw
        after_output = usage_after.output_tokens if usage_after else 0

        state.metadata["evaluation_duration_seconds"] = duration
        state.metadata["evaluation_input_tokens"] = (
            after_total_input - before_total_input
        )
        state.metadata["evaluation_output_tokens"] = after_output - before_output
        state.metadata["evaluation_cached_tokens"] = after_cached - before_cached

        assert result is not None
        return result

    return score
