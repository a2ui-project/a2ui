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

from __future__ import annotations

import asyncio
import json
import time

from inspect_ai.model._model import sample_model_usage
from inspect_ai.scorer import (
    Score,
    Scorer,
    Target,
    accuracy,
    model_graded_qa,
    scorer,
)
from inspect_ai.solver import TaskState

from .runner import DEFAULT_PARSE_TIMEOUT_SEC, parse_and_validate
from .shared.utils import GIT_ROOT


async def _compiled_answer_or_none(
    version: str,
    resolved_catalog_path: str,
    completion: str,
) -> str | None:
    """Parses a completion without validation and returns its JSON messages.

    Used after a failed validation so that the score's answer shows the
    compiled messages that failed, rather than the raw completion.
    """
    try:
        res_dict = await asyncio.to_thread(
            parse_and_validate,
            "direct_json",
            version,
            resolved_catalog_path,
            "main",
            completion,
            DEFAULT_PARSE_TIMEOUT_SEC,
            True,
            validate=False,
        )
    except Exception:  # pylint: disable=broad-exception-caught
        return None
    compiled_jsons = res_dict.get("compiled_jsons")
    return json.dumps(compiled_jsons, indent=2) if compiled_jsons else None


@scorer(metrics=[accuracy()])
def a2ui_scorer(version: str) -> Scorer:
    """Scorer for A2UI evaluation using the Python Agent SDK.

    Args:
        version: The schema version to load (e.g. '0.9.1' or '1.0').

    Returns:
        An Inspect Scorer that validates the response against the schema and integrity rules.
    """

    async def score(
        state: TaskState, target: Target
    ) -> Score:  # pylint: disable=unused-argument
        if not state.output:
            return Score(
                value=0.0,
                explanation="No model output (generation failed or was interrupted)",
            )

        catalog_path = state.metadata["catalog"]
        resolved_catalog_path = str(GIT_ROOT / catalog_path)
        answer_text = state.output.completion or ""

        if answer_text.strip().startswith("Compilation/validation failed:"):
            return Score(
                value=0.0,
                answer=answer_text,
                explanation="Format compilation/validation failed during solver step.",
            )

        try:
            res_dict = await asyncio.to_thread(
                parse_and_validate,
                "direct_json",
                version,
                resolved_catalog_path,
                "main",
                answer_text,
                DEFAULT_PARSE_TIMEOUT_SEC,
                True,
            )
            return Score(
                value=1.0,
                answer=json.dumps(res_dict["compiled_jsons"], indent=2),
                explanation="Valid A2UI payload",
            )
        except Exception as e:  # pylint: disable=broad-exception-caught
            # A timeout would only repeat itself, so skip the parse-only retry.
            compiled_answer = (
                None
                if isinstance(e, TimeoutError)
                else await _compiled_answer_or_none(
                    version, resolved_catalog_path, answer_text
                )
            )
            return Score(
                value=0.0,
                answer=compiled_answer or answer_text,
                explanation=str(e),
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
