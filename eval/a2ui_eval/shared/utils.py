# Copyright 2024 Google LLC
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

from pathlib import Path
import time

from inspect_ai.model._model import sample_model_usage
from inspect_ai.solver import Generate, Solver, TaskState, solver

GIT_ROOT = (Path(__file__).resolve().parent / "../../..").resolve()
PAYLOAD_STORE_KEY = "a2ui_payload"


@solver
def measured_generate(
    required_close_tag: str | None = None,
) -> Solver:
    """Solver that wraps generate() and records duration and token metrics."""

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        usage_before = sample_model_usage().get(str(state.model))
        before_input = usage_before.input_tokens if usage_before else 0
        before_cr = usage_before.input_tokens_cache_read or 0 if usage_before else 0
        before_cw = usage_before.input_tokens_cache_write or 0 if usage_before else 0
        before_total_input = before_input + before_cr + before_cw
        before_cached = before_cr + before_cw
        before_output = usage_before.output_tokens if usage_before else 0
        before_reasoning = usage_before.reasoning_tokens or 0 if usage_before else 0

        call_start = time.time()
        state = await generate(state)

        output_call = (
            getattr(state.output, "call", None) if hasattr(state, "output") else None
        )
        if output_call and getattr(output_call, "time", None):
            duration = float(output_call.time)
        else:
            duration = time.time() - call_start

        usage_after = sample_model_usage().get(str(state.model))
        after_input = usage_after.input_tokens if usage_after else 0
        after_cr = usage_after.input_tokens_cache_read or 0 if usage_after else 0
        after_cw = usage_after.input_tokens_cache_write or 0 if usage_after else 0
        after_total_input = after_input + after_cr + after_cw
        after_cached = after_cr + after_cw
        after_output = usage_after.output_tokens if usage_after else 0
        after_reasoning = usage_after.reasoning_tokens or 0 if usage_after else 0

        state.metadata["inference_duration_seconds"] = (
            state.metadata.get("inference_duration_seconds", 0.0) + duration
        )
        state.metadata["generate_attempts"] = (
            state.metadata.get("generate_attempts", 0) + 1
        )
        state.metadata["inference_input_tokens"] = state.metadata.get(
            "inference_input_tokens", 0
        ) + (after_total_input - before_total_input)
        state.metadata["inference_output_tokens"] = state.metadata.get(
            "inference_output_tokens", 0
        ) + (after_output - before_output)
        state.metadata["inference_cached_tokens"] = state.metadata.get(
            "inference_cached_tokens", 0
        ) + (after_cached - before_cached)
        state.metadata["inference_reasoning_tokens"] = state.metadata.get(
            "inference_reasoning_tokens", 0
        ) + (after_reasoning - before_reasoning)

        return state

    return solve
