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

"""Scorers for A2UI evaluation."""

import json
import os
import time
from inspect_ai.scorer import scorer, Score, Target, accuracy, model_graded_qa
from inspect_ai.solver import TaskState
from inspect_ai.model._model import sample_model_usage
from a2ui.schema.manager import A2uiSchemaManager
from a2ui.schema.catalog import CatalogConfig
from a2ui.parser.parser import parse_response
from .shared.utils import GIT_ROOT


@scorer(metrics=[accuracy()])
def a2ui_scorer(version: str):
  """Scorer for A2UI evaluation using the Python SDK.

  Args:
      version: The schema version to load (e.g. '0.9.1' or '1.0').

  Returns:
      An Inspect Scorer that validates the response against the schema and integrity rules.
  """

  async def score(state: TaskState, target: Target) -> Score:  # pylint: disable=unused-argument
    if not state.output:
      return Score(
          value=0.0,
          explanation="No model output (generation failed or was interrupted)",
      )

    catalog_path = state.metadata["catalog"]
    resolved_catalog_path = str(GIT_ROOT / catalog_path)

    catalog_config = CatalogConfig.from_path("basic_catalog", resolved_catalog_path)
    manager = A2uiSchemaManager(version=version, catalogs=[catalog_config])
    catalog = manager.get_selected_catalog()
    validator = catalog.validator

    answer_text = state.output.completion or ""
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
            explanation="No A2UI JSON found in response (tags missing or empty)",
        )

      answer_text = json.dumps(all_messages, indent=2)
      validator.validate(all_messages)
      return Score(value=1.0, answer=answer_text, explanation="Valid A2UI payload")
    except Exception as e:
      return Score(value=0.0, answer=answer_text, explanation=str(e))

  return score


@scorer(metrics=[accuracy()])
def measured_model_graded_qa(model: str, instructions: str | None = None):
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
    state.metadata["evaluation_input_tokens"] = after_total_input - before_total_input
    state.metadata["evaluation_output_tokens"] = after_output - before_output
    state.metadata["evaluation_cached_tokens"] = after_cached - before_cached

    return result

  return score
