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

"""Risk-controlled threshold calibration for local decision-model UI synthesis."""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from .models import (
    CalibrationPoint,
    CalibrationResult,
    SynthesisConfig,
    SynthesisOutput,
    SynthesisStage,
)

_DEFAULT_THRESHOLDS: tuple[float, ...] = (
    *(round(0.30 + 0.05 * i, 2) for i in range(14)),
    0.99,
)


@runtime_checkable
class SynthesizerLike(Protocol):
    """Structural protocol for a decision synthesizer evaluated during calibration."""

    config: SynthesisConfig

    async def synthesize(
        self,
        intent: str,
        payload: Mapping[str, Any],
        *,
        surface_id: str | None = None,
        mutable_paths: Collection[str] = (),
    ) -> SynthesisOutput:
        """Synthesizes an A2UI surface output for the given intent and payload."""
        ...


@dataclass(frozen=True)
class LabeledDecisionExample:
    """Golden labeled example for empirical confidence threshold calibration."""

    intent: str
    payload: Mapping[str, Any]
    expected_root_component: str | None = None
    expected_template_id: str | None = None
    should_abstain: bool = False
    mutable_paths: tuple[str, ...] = ()


def compute_bayes_optimal_threshold(
    cost_fallback: float, cost_wrong_ui: float
) -> float:
    """Computes the Bayes-optimal confidence threshold clamped to [0.0, 1.0].

    Raises a ValueError if cost_fallback is negative or cost_wrong_ui is not
    strictly positive.
    """
    if cost_fallback < 0:
        raise ValueError("cost_fallback must be non-negative.")
    if cost_wrong_ui <= 0:
        raise ValueError("cost_wrong_ui must be strictly positive.")
    raw_threshold = 1.0 - (cost_fallback / cost_wrong_ui)
    return max(0.0, min(1.0, raw_threshold))


def _is_accepted_locally(output: SynthesisOutput, threshold: float) -> bool:
    """Returns whether the synthesis output is accepted locally at threshold."""
    return (
        output.stage != SynthesisStage.ABSTAIN_FALLBACK
        and output.confidence >= threshold
    )


def _is_prediction_correct(
    output: SynthesisOutput, example: LabeledDecisionExample
) -> bool:
    """Returns whether an accepted synthesis output matches the golden label."""
    if example.should_abstain:
        return False
    if (
        example.expected_template_id is not None
        and output.selected_template_id != example.expected_template_id
    ):
        return False
    if example.expected_root_component is not None:
        root_comp = (output.component_tree_spec or {}).get("root_component")
        if root_comp != example.expected_root_component:
            return False
    return True


def _evaluate_threshold(
    evaluated: Sequence[tuple[SynthesisOutput, LabeledDecisionExample]],
    threshold: float,
) -> CalibrationPoint:
    """Computes coverage, precision, and fallback rate at a candidate threshold."""
    accepted = [
        (output, ex)
        for output, ex in evaluated
        if _is_accepted_locally(output, threshold)
    ]
    accepted_count = len(accepted)
    correct_accepted = sum(
        1 for output, ex in accepted if _is_prediction_correct(output, ex)
    )
    coverage = accepted_count / len(evaluated)
    fallback_rate = 1.0 - coverage
    precision = correct_accepted / accepted_count if accepted_count > 0 else 1.0
    return CalibrationPoint(
        threshold=threshold,
        coverage=coverage,
        precision=precision,
        fallback_rate=fallback_rate,
    )


def _select_best_point(
    points: Sequence[CalibrationPoint], target_precision: float
) -> CalibrationPoint:
    """Selects the optimal Pareto calibration point for target_precision."""
    feasible = [p for p in points if p.precision >= target_precision]
    if feasible:
        return max(feasible, key=lambda p: (p.coverage, -p.threshold))
    return max(points, key=lambda p: (p.precision, p.threshold))


def _build_permissive_config(base: SynthesisConfig) -> SynthesisConfig:
    """Builds a permissive config for raw confidence collection during sweep."""
    return SynthesisConfig(
        template_confidence_threshold=0.0,
        mutable_confidence_threshold=0.0,
        abstain_threshold=0.0,
        uncalibrated_min_logit_margin=base.uncalibrated_min_logit_margin,
        entropy_switch_margin=base.entropy_switch_margin,
        max_tree_depth=base.max_tree_depth,
        max_children_per_container=base.max_children_per_container,
        default_surface_id=base.default_surface_id,
    )


async def _collect_evaluated_outputs(
    synthesizer: SynthesizerLike,
    dataset: Sequence[LabeledDecisionExample],
) -> list[tuple[SynthesisOutput, LabeledDecisionExample]]:
    """Evaluates dataset examples with permissive thresholds and restores config."""
    original_config = getattr(synthesizer, "config", None)
    if isinstance(original_config, SynthesisConfig):
        synthesizer.config = _build_permissive_config(original_config)
    try:
        evaluated: list[tuple[SynthesisOutput, LabeledDecisionExample]] = []
        for ex in dataset:
            output = await synthesizer.synthesize(
                ex.intent, ex.payload, mutable_paths=ex.mutable_paths
            )
            evaluated.append((output, ex))
        return evaluated
    finally:
        if isinstance(original_config, SynthesisConfig):
            synthesizer.config = original_config


async def calibrate_thresholds(
    synthesizer: SynthesizerLike,
    dataset: Sequence[LabeledDecisionExample],
    *,
    target_precision: float = 0.95,
    thresholds: Sequence[float] | None = None,
) -> CalibrationResult:
    """Calibrates decision confidence thresholds against a labeled golden dataset.

    Evaluates each example once through the synthesizer, sweeps candidate
    thresholds to build the coverage-precision Pareto frontier, and selects
    thresholds that satisfy target_precision while maximizing local coverage.
    """
    if not dataset:
        raise ValueError("dataset must not be empty.")
    if not (0.0 < target_precision <= 1.0):
        raise ValueError("target_precision must be in (0.0, 1.0].")

    candidate_thresholds: Sequence[float] = (
        _DEFAULT_THRESHOLDS if thresholds is None else thresholds
    )
    if not candidate_thresholds:
        raise ValueError("thresholds must not be empty.")

    evaluated = await _collect_evaluated_outputs(synthesizer, dataset)

    points = tuple(
        _evaluate_threshold(evaluated, float(tau)) for tau in candidate_thresholds
    )
    best = _select_best_point(points, target_precision)

    return CalibrationResult(
        recommended_template_threshold=best.threshold,
        recommended_mutable_threshold=round(min(0.99, best.threshold + 0.10), 2),
        recommended_abstain_threshold=best.threshold,
        achieved_precision=best.precision,
        achieved_coverage=best.coverage,
        pareto_points=points,
    )
