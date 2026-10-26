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

"""Scorers for A2UI evaluation.

Scoring runs in three stages, in the order the scorers are listed on the task:

1. `a2ui_scorer` compiles and validates the payload with the Python Agent SDK
   (Stage 1) and then checks the dataset's deterministic `assertions` against
   the compiled messages (Stage 2). It records the combined verdict in
   `state.metadata["a2ui_stage12_passed"]`.
2. `measured_model_graded_qa` asks an LLM judge for a grade (Stage 3), but
   only when Stage 1 and 2 passed; a payload that is already known to be
   wrong is graded "I" without spending judge tokens.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
import json
import time
from typing import Any, Literal

from inspect_ai.model import ModelUsage
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

from .runner import (
    DEFAULT_PARSE_TIMEOUT_SEC,
    RunnerOptions,
    Stage2Assertions,
    parse_and_validate,
    runner_options_from_metadata,
)
from .shared.utils import GIT_ROOT

__all__ = [
    "PayloadFacts",
    "STAGE12_PASSED_KEY",
    "a2ui_scorer",
    "collect_payload_facts",
    "evaluate_stage2_assertions",
    "measured_model_graded_qa",
]

STAGE12_PASSED_KEY = "a2ui_stage12_passed"
"""Metadata key under which `a2ui_scorer` records its Stage 1/2 verdict."""

_JUDGE_SKIPPED_AFTER_FAILURE = "Skipped LLM judge because Stage 1/2 validation failed."
_JUDGE_SKIPPED_NO_JUDGE = "Skipped LLM judge (--no-judge mode); Stage 1/2 passed."


@dataclass
class PayloadFacts:
    """Names found in a compiled payload, checked against Stage 2 assertions.

    Attributes:
        component_types: Component names rendered in the payload.
        bound_paths: Data model paths bound or written by the payload.
        action_names: Action event or function call names in the payload.
        message_types: Top-level message types present in the payload.
        catalog_ids: Catalog identifiers referenced by the payload.
    """

    component_types: set[str] = field(default_factory=set)
    bound_paths: set[str] = field(default_factory=set)
    action_names: set[str] = field(default_factory=set)
    message_types: set[str] = field(default_factory=set)
    catalog_ids: set[str] = field(default_factory=set)


_PayloadFacts = PayloadFacts


def _collect_dict_facts(node: Mapping[str, Any], facts: _PayloadFacts) -> None:
    """Records the facts carried directly by one JSON object."""
    component = node.get("component")
    if isinstance(component, str):
        facts.component_types.add(component)
    elif isinstance(component, Mapping):
        # v0.8 shape: {"component": {"Button": {...}}}
        facts.component_types.update(str(k) for k in component)
    catalog_id = node.get("catalogId")
    if isinstance(catalog_id, str):
        facts.catalog_ids.add(catalog_id)
    for key in ("path", "@path"):
        path = node.get(key)
        if isinstance(path, str):
            facts.bound_paths.add(path)
    # Data written by the payload counts as bound: the `updateDataModel` path
    # and every nested key under it, and (v1.0) every key of the inline
    # `createSurface.dataModel`, which is where Express compiles `$/x = ...`.
    update = node.get("updateDataModel")
    if isinstance(update, Mapping) and isinstance(update.get("path"), str):
        facts.bound_paths.update(_written_paths(update["path"], update.get("value")))
    create = node.get("createSurface")
    if isinstance(create, Mapping):
        facts.bound_paths.update(_written_paths("", create.get("dataModel")))
    _collect_action_names(node, facts)


def _written_paths(prefix: str, value: Any) -> set[str]:
    """Returns `prefix` plus the path of every nested object key in `value`."""
    paths = {prefix} if prefix else set()
    if isinstance(value, Mapping):
        base = prefix.rstrip("/")
        for key, child in value.items():
            paths |= _written_paths(f"{base}/{key}", child)
    return paths


def _collect_action_names(node: Mapping[str, Any], facts: _PayloadFacts) -> None:
    """Records action names in their `event`, `functionCall` and `@call` forms."""
    event = node.get("event")
    if isinstance(event, Mapping) and isinstance(event.get("name"), str):
        facts.action_names.add(event["name"])
    function_call = node.get("functionCall")
    if isinstance(function_call, Mapping) and isinstance(
        function_call.get("call"), str
    ):
        facts.action_names.add(function_call["call"])
    at_call = node.get("@call")
    if isinstance(at_call, str):
        facts.action_names.add(at_call)


def _walk_payload(value: Any, facts: _PayloadFacts) -> None:
    """Recursively collects facts from nested objects, lists and JSON strings."""
    if isinstance(value, list):
        for item in value:
            _walk_payload(item, facts)
        return
    if isinstance(value, str):
        # Some formats keep a binding as a JSON string, e.g. '{"path": "/x"}'.
        if value.lstrip().startswith("{"):
            try:
                _walk_payload(json.loads(value), facts)
            except ValueError:
                pass
        return
    if isinstance(value, Mapping):
        _walk_mapping(value, facts)


def _walk_mapping(node: Mapping[str, Any], facts: _PayloadFacts) -> None:
    """Collects the facts of one object and recurses into its children.

    `updateDataModel.value` and `createSurface.dataModel` hold user data, not
    A2UI structure, so a data key that happens to be named `event`, `path` or
    `component` must not register as an action, binding or component.
    """
    _collect_dict_facts(node, facts)
    for key, child in node.items():
        if key == "updateDataModel" and isinstance(child, Mapping):
            child = {k: v for k, v in child.items() if k != "value"}
        elif key == "createSurface" and isinstance(child, Mapping):
            child = {k: v for k, v in child.items() if k != "dataModel"}
        _walk_payload(child, facts)


def collect_payload_facts(messages: Iterable[Mapping[str, Any]]) -> PayloadFacts:
    """Collects component types, bindings, actions, message types and catalogs.

    The top-level keys of each message other than `version` are its message
    types (`createSurface`, `updateComponents`, `updateDataModel`,
    `deleteSurface`, ...). Everything else is found by walking the message
    tree, so inline children and v0.8/v0.9.1/v1.0 shapes are all covered.

    Args:
        messages: Compiled A2UI message dictionaries to inspect.

    Returns:
        A `PayloadFacts` instance containing the extracted sets.
    """
    facts = PayloadFacts()
    for message in messages:
        if not isinstance(message, Mapping):
            continue
        facts.message_types.update(k for k in message if k != "version")
        _walk_payload(message, facts)
    return facts


_collect_payload_facts = collect_payload_facts


def _check_assertion_set(
    label: str,
    expected: Iterable[str],
    actual: set[str],
    mode: Literal["required", "forbidden", "only"],
) -> str | None:
    """Compares one assertion field with the payload and describes a failure.

    Args:
        label: Plural noun for messages, e.g. "components".
        expected: The names listed by the assertion field.
        actual: The names found in the payload.
        mode: "required" fails on expected names that are absent, "forbidden"
            fails on expected names that are present, and "only" fails on
            found names that the assertion does not list.

    Returns:
        A human-readable failure, or None when the field is satisfied.
    """
    expected_set = set(expected)
    if not expected_set:
        return None
    if mode == "required":
        missing = expected_set - actual
        return f"Missing required {label}: {_fmt(missing)}" if missing else None
    if mode == "forbidden":
        present = expected_set & actual
        return f"Forbidden {label} present: {_fmt(present)}" if present else None
    unexpected = actual - expected_set
    if unexpected:
        return f"Unexpected {label}: {_fmt(unexpected)} (allowed: {_fmt(expected_set)})"
    return None


def _fmt(names: Iterable[str]) -> str:
    return ", ".join(sorted(names))


def evaluate_stage2_assertions(
    messages: list[dict[str, Any]],
    assertions: Mapping[str, Any] | Stage2Assertions,
) -> list[str]:
    """Checks compiled A2UI messages against a sample's Stage 2 assertions.

    Args:
        messages: The compiled A2UI JSON messages (v0.9.1 or v1.0 shapes).
        assertions: A dataset `assertions` block or parsed `Stage2Assertions`.

    Returns:
        One human-readable string per failed assertion field; an empty list
        means every assertion passed (or none were given).
    """
    checks = (
        assertions
        if isinstance(assertions, Stage2Assertions)
        else Stage2Assertions.from_mapping(assertions)
    )
    if checks.is_empty:
        return []
    facts = _collect_payload_facts(messages)
    results = [
        _check_assertion_set(
            "components", checks.required_components, facts.component_types, "required"
        ),
        _check_assertion_set(
            "components",
            checks.forbidden_components,
            facts.component_types,
            "forbidden",
        ),
        _check_assertion_set(
            "bindings", checks.required_bindings, facts.bound_paths, "required"
        ),
        _check_assertion_set(
            "actions", checks.required_actions, facts.action_names, "required"
        ),
        _check_assertion_set(
            "message types", checks.message_types, facts.message_types, "only"
        ),
        _check_assertion_set(
            "catalog ids", checks.catalog_ids, facts.catalog_ids, "required"
        ),
    ]
    return [failure for failure in results if failure]


async def _compiled_answer_or_none(
    version: str,
    resolved_catalog_path: str,
    completion: str,
    options: RunnerOptions | None = None,
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
            options=options,
        )
    except Exception:  # pylint: disable=broad-exception-caught
        return None
    compiled_jsons = res_dict.get("compiled_jsons")
    return json.dumps(compiled_jsons, indent=2) if compiled_jsons else None


async def _stage1_messages(
    state: TaskState,
    answer_text: str,
    resolved_catalog_path: str,
    version: str,
) -> list[dict[str, Any]] | Score:
    """Runs Stage 1 and returns the compiled messages, or the failing Score.

    Reuses `state.metadata["compiled_messages"]` when a solver already
    validated the payload, so the runner is not called twice.
    """
    compiled = state.metadata.get("compiled_messages")
    if compiled:
        return list(compiled)
    options = runner_options_from_metadata(state.metadata, resolved_catalog_path)
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
            options=options,
        )
        return list(res_dict["compiled_jsons"])
    except Exception as e:  # pylint: disable=broad-exception-caught
        # A timeout would only repeat itself, so skip the parse-only retry.
        compiled_answer = (
            None
            if isinstance(e, TimeoutError)
            else await _compiled_answer_or_none(
                version, resolved_catalog_path, answer_text, options
            )
        )
        return _stage12_score(
            state, 0.0, answer=compiled_answer or answer_text, explanation=str(e)
        )


def _stage12_score(state: TaskState, value: float, **kwargs: Any) -> Score:
    """Builds the Stage 1/2 score and records its verdict for the judge."""
    state.metadata[STAGE12_PASSED_KEY] = value == 1.0
    return Score(value=value, **kwargs)


def _solver_failure_score(state: TaskState) -> Score | None:
    """Returns the failing Score when the solver produced no usable output."""
    if not state.output:
        return _stage12_score(
            state,
            0.0,
            explanation="No model output (generation failed or was interrupted)",
        )
    answer_text = state.output.completion or ""
    if answer_text.strip().startswith("Compilation/validation failed:"):
        return _stage12_score(
            state,
            0.0,
            answer=answer_text,
            explanation="Format compilation/validation failed during solver step.",
        )
    return None


@scorer(metrics=[accuracy()])
def a2ui_scorer(version: str) -> Scorer:
    """Scorer for A2UI evaluation using the Python Agent SDK.

    Stage 1 compiles and validates the `<a2ui-json>` payload with the Python
    runner, unless a solver already did so and left the result in
    `state.metadata["compiled_messages"]`. Stage 2 then checks the sample's
    `assertions` against the compiled messages. The verdict is stored in
    `state.metadata["a2ui_stage12_passed"]` so the judge scorer can skip
    payloads that already failed.

    Args:
        version: The schema version to load (e.g. '0.9.1' or '1.0').

    Returns:
        An Inspect Scorer that validates the response against the schema and integrity rules.
    """

    async def score(
        state: TaskState, target: Target
    ) -> Score:  # pylint: disable=unused-argument
        early = _solver_failure_score(state)
        if early is not None:
            return early

        resolved_catalog_path = str(GIT_ROOT / state.metadata["catalog"])
        answer_text = state.output.completion or ""
        messages = await _stage1_messages(
            state, answer_text, resolved_catalog_path, version
        )
        if isinstance(messages, Score):
            return messages
        answer = json.dumps(messages, indent=2)

        assertions = state.metadata.get("assertions")
        failures = (
            evaluate_stage2_assertions(messages, assertions) if assertions else []
        )
        if failures:
            return _stage12_score(
                state,
                0.0,
                answer=answer,
                explanation="Stage 2 assertions failed:\n"
                + "\n".join(f"- {f}" for f in failures),
            )
        explanation = "Valid A2UI payload"
        if assertions:
            explanation += "; Stage 2 assertions passed"
        return _stage12_score(state, 1.0, answer=answer, explanation=explanation)

    return score


def _usage_totals(model: str | None) -> tuple[int, int, int]:
    """Returns (total input, cached input, output) tokens used so far.

    Counts the named model, or every model in the sample when `model` is None
    (the judge then runs on the eval's default model).
    """
    usage = sample_model_usage()
    selected: list[ModelUsage] = (
        list(usage.values()) if model is None else [u for u in [usage.get(model)] if u]
    )
    cached = sum(
        (u.input_tokens_cache_read or 0) + (u.input_tokens_cache_write or 0)
        for u in selected
    )
    total_input = sum(u.input_tokens for u in selected) + cached
    output = sum(u.output_tokens for u in selected)
    return total_input, cached, output


@scorer(metrics=[accuracy()])
def measured_model_graded_qa(
    model: str | None = None,
    instructions: str | None = None,
    no_judge: bool = False,
) -> Scorer:
    """Scorer that wraps model_graded_qa and records the token usage in metadata.

    The judge only runs when `a2ui_scorer` has recorded a passing Stage 1/2
    verdict in `state.metadata["a2ui_stage12_passed"]`; a failed verdict is
    graded "I" without calling the model.

    Args:
        model: The grading model, or None to grade with the eval's model.
        instructions: Grading instructions passed to `model_graded_qa`.
        no_judge: When True, never call the model: grade "C" when Stage 1/2
            passed (or did not run) and "I" when it failed.

    Returns:
        An Inspect Scorer producing "C", "P" or "I" grades.
    """
    base_scorer = (
        None if no_judge else model_graded_qa(model=model, instructions=instructions)
    )

    async def score(state: TaskState, target: Target) -> Score:
        if state.metadata.get(STAGE12_PASSED_KEY) is False:
            return Score(value="I", explanation=_JUDGE_SKIPPED_AFTER_FAILURE)
        if base_scorer is None:
            return Score(value="C", explanation=_JUDGE_SKIPPED_NO_JUDGE)

        start_time = time.time()
        before_total_input, before_cached, before_output = _usage_totals(model)

        result = await base_scorer(state, target)

        duration = time.time() - start_time
        after_total_input, after_cached, after_output = _usage_totals(model)

        state.metadata["evaluation_duration_seconds"] = duration
        state.metadata["evaluation_input_tokens"] = (
            after_total_input - before_total_input
        )
        state.metadata["evaluation_output_tokens"] = after_output - before_output
        state.metadata["evaluation_cached_tokens"] = after_cached - before_cached

        assert result is not None
        return result

    return score
