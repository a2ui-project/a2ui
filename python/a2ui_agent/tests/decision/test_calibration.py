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

"""Unit tests for decision-model confidence threshold calibration."""

from __future__ import annotations

from collections.abc import Collection, Mapping
from typing import Any

import pytest

from a2ui.inference_formats.decision import (
    LabeledDecisionExample,
    SynthesisConfig,
    SynthesisOutput,
    SynthesisStage,
    SynthesizerLike,
    calibrate_thresholds,
    compute_bayes_optimal_threshold,
)


class _FakeSynthesizer:
    """Lightweight fake implementing SynthesizerLike for calibration tests."""

    def __init__(self, scripted_outputs: Mapping[str, SynthesisOutput]) -> None:
        self.config = SynthesisConfig()
        self._scripted = dict(scripted_outputs)
        self.calls: list[tuple[str, tuple[str, ...]]] = []
        self.seen_configs: list[SynthesisConfig | None] = []

    async def synthesize(
        self,
        intent: str,
        payload: Mapping[str, Any],
        *,
        surface_id: str | None = None,
        mutable_paths: Collection[str] = (),
        config: SynthesisConfig | None = None,
    ) -> SynthesisOutput:
        del payload, surface_id
        self.calls.append((intent, tuple(mutable_paths)))
        self.seen_configs.append(config)
        return self._scripted[intent]


def test_compute_bayes_optimal_threshold_valid() -> None:
    """Computes exact and clamped Bayes-optimal thresholds for valid costs."""
    assert compute_bayes_optimal_threshold(0.1, 1.0) == pytest.approx(0.9)
    assert compute_bayes_optimal_threshold(0.25, 1.0) == pytest.approx(0.75)
    assert compute_bayes_optimal_threshold(0.0, 2.0) == pytest.approx(1.0)
    assert compute_bayes_optimal_threshold(2.5, 1.0) == pytest.approx(0.0)


@pytest.mark.parametrize(
    ("cost_fallback", "cost_wrong_ui"),
    [
        (-0.01, 1.0),
        (0.5, 0.0),
        (0.5, -1.0),
    ],
)
def test_compute_bayes_optimal_threshold_invalid(
    cost_fallback: float, cost_wrong_ui: float
) -> None:
    """Raises ValueError when fallback cost is negative or wrong-UI cost <= 0."""
    with pytest.raises(ValueError):
        compute_bayes_optimal_threshold(cost_fallback, cost_wrong_ui)


@pytest.mark.asyncio
async def test_calibrate_thresholds_validation_errors() -> None:
    """Raises ValueError on empty dataset, invalid target_precision, or empty thresholds."""
    synth = _FakeSynthesizer({})
    assert isinstance(synth, SynthesizerLike)

    example = LabeledDecisionExample(
        intent="show cpu",
        payload={"cpu": 0.5},
        expected_root_component="MetricCard",
    )

    with pytest.raises(ValueError, match="dataset"):
        await calibrate_thresholds(synth, [])

    with pytest.raises(ValueError, match="target_precision"):
        await calibrate_thresholds(synth, [example], target_precision=0.0)

    with pytest.raises(ValueError, match="target_precision"):
        await calibrate_thresholds(synth, [example], target_precision=1.05)

    with pytest.raises(ValueError, match="thresholds"):
        await calibrate_thresholds(synth, [example], thresholds=[])


@pytest.mark.asyncio
async def test_calibrate_thresholds_golden_mix() -> None:
    """Calibrates thresholds across read-only, mutable, wrong, and abstain examples."""
    scripted = {
        "readonly_template": SynthesisOutput(
            stage=SynthesisStage.TEMPLATE_SELECT,
            messages=[],
            confidence=0.92,
            entropy=0.10,
            selected_template_id="tpl_portfolio",
            component_tree_spec={"template_id": "tpl_portfolio"},
        ),
        "mutable_leaf": SynthesisOutput(
            stage=SynthesisStage.ARCHETYPE,
            messages=[],
            confidence=0.86,
            entropy=0.15,
            component_tree_spec={"root_component": "OrderForm"},
        ),
        "container_tree": SynthesisOutput(
            stage=SynthesisStage.ARCHETYPE,
            messages=[],
            confidence=0.78,
            entropy=0.25,
            component_tree_spec={"root_component": "VitalGrid"},
        ),
        "wrong_component_low_conf": SynthesisOutput(
            stage=SynthesisStage.ARCHETYPE,
            messages=[],
            confidence=0.62,
            entropy=0.55,
            component_tree_spec={"root_component": "WrongWidget"},
        ),
        "hallucinated_when_should_abstain": SynthesisOutput(
            stage=SynthesisStage.ARCHETYPE,
            messages=[],
            confidence=0.52,
            entropy=0.70,
            component_tree_spec={"root_component": "MetricCard"},
        ),
        "already_abstained": SynthesisOutput(
            stage=SynthesisStage.ABSTAIN_FALLBACK,
            messages=[],
            confidence=0.95,
            entropy=0.90,
        ),
    }
    synth = _FakeSynthesizer(scripted)
    dataset = [
        LabeledDecisionExample(
            intent="readonly_template",
            payload={"balance": 100},
            expected_template_id="tpl_portfolio",
        ),
        LabeledDecisionExample(
            intent="mutable_leaf",
            payload={"qty": 10},
            expected_root_component="OrderForm",
            mutable_paths=("/qty",),
        ),
        LabeledDecisionExample(
            intent="container_tree",
            payload={"vitals": []},
            expected_root_component="VitalGrid",
        ),
        LabeledDecisionExample(
            intent="wrong_component_low_conf",
            payload={"cpu": 90},
            expected_root_component="ClusterHealth",
        ),
        LabeledDecisionExample(
            intent="hallucinated_when_should_abstain",
            payload={"unknown": 1},
            should_abstain=True,
        ),
        LabeledDecisionExample(
            intent="already_abstained",
            payload={},
            should_abstain=True,
        ),
    ]

    result = await calibrate_thresholds(synth, dataset, target_precision=0.95)

    # Synthesize called once per example, preserving mutable_paths.
    assert len(synth.calls) == len(dataset)
    assert ("mutable_leaf", ("/qty",)) in synth.calls
    assert len(result.pareto_points) == 15

    # At tau=0.65, the 3 correct examples (0.92, 0.86, 0.78) are accepted and
    # the 2 wrong ones (0.62, 0.52) are rejected -> precision = 1.0, coverage = 3/6 = 0.5.
    # Tie-breaking among tau in [0.65, 0.70, 0.75] (all coverage 0.5, precision 1.0)
    # picks the lowest threshold: 0.65.
    assert result.recommended_template_threshold == pytest.approx(0.65)
    assert result.recommended_mutable_threshold == pytest.approx(0.75)
    assert result.recommended_abstain_threshold == pytest.approx(0.65)
    assert result.achieved_precision == pytest.approx(1.0)
    assert result.achieved_coverage == pytest.approx(0.5)


@pytest.mark.asyncio
async def test_calibrate_thresholds_unachievable_target_and_clamping() -> None:
    """Falls back to highest precision/threshold and clamps derived thresholds."""
    scripted = {
        "wrong_high": SynthesisOutput(
            stage=SynthesisStage.TEMPLATE_SELECT,
            messages=[],
            confidence=0.96,
            entropy=0.1,
            selected_template_id="wrong_tpl",
        ),
        "right_mid": SynthesisOutput(
            stage=SynthesisStage.ARCHETYPE,
            messages=[],
            confidence=0.92,
            entropy=0.1,
            component_tree_spec={"root_component": "RightLeaf"},
        ),
    }
    synth = _FakeSynthesizer(scripted)
    dataset = [
        LabeledDecisionExample(
            intent="wrong_high",
            payload={},
            expected_template_id="expected_tpl",
        ),
        LabeledDecisionExample(
            intent="right_mid",
            payload={},
            expected_root_component="RightLeaf",
        ),
    ]

    # At custom thresholds [0.80, 0.90], both examples are accepted (precision 0.5).
    # Neither meets target_precision=0.95, so fallback selects highest precision
    # and breaks ties by highest threshold (0.90).
    result = await calibrate_thresholds(
        synth,
        dataset,
        target_precision=0.95,
        thresholds=[0.80, 0.90],
    )
    assert result.recommended_template_threshold == pytest.approx(0.90)
    assert result.recommended_mutable_threshold == pytest.approx(0.99)
    assert result.recommended_abstain_threshold == pytest.approx(0.90)
    assert result.achieved_precision == pytest.approx(0.5)
    assert result.achieved_coverage == pytest.approx(1.0)

    # Test zero-accepted precision=1.0 behavior and exact abstain threshold.
    low_result = await calibrate_thresholds(
        synth,
        [dataset[1]],
        target_precision=0.95,
        thresholds=[0.35, 0.99],
    )
    assert low_result.recommended_template_threshold == pytest.approx(0.35)
    assert low_result.recommended_abstain_threshold == pytest.approx(0.35)
    assert low_result.pareto_points[1].coverage == pytest.approx(0.0)
    assert low_result.pareto_points[1].precision == pytest.approx(1.0)
    assert low_result.pareto_points[1].fallback_rate == pytest.approx(1.0)


@pytest.mark.asyncio
async def test_calibrate_thresholds_restores_config_and_matches_template_root() -> None:
    """Verifies H2 (permissive sweep + config restoration) and M5 (template root_component match)."""
    scripted = {
        "template_with_root": SynthesisOutput(
            stage=SynthesisStage.TEMPLATE_SELECT,
            messages=[],
            confidence=0.88,
            entropy=0.1,
            selected_template_id="tpl_1",
            component_tree_spec={
                "template_id": "tpl_1",
                "root_component": "MetricCard",
            },
        ),
        "low_conf_wrong": SynthesisOutput(
            stage=SynthesisStage.ARCHETYPE,
            messages=[],
            confidence=0.36,
            entropy=0.8,
            component_tree_spec={"root_component": "WrongCard"},
        ),
    }
    synth = _FakeSynthesizer(scripted)
    original_cfg = SynthesisConfig(
        template_confidence_threshold=0.80,
        mutable_confidence_threshold=0.90,
        abstain_threshold=0.50,
    )
    synth.config = original_cfg

    dataset = [
        LabeledDecisionExample(
            intent="template_with_root",
            payload={},
            expected_root_component="MetricCard",
        ),
        LabeledDecisionExample(
            intent="low_conf_wrong",
            payload={},
            expected_root_component="MetricCard",
        ),
    ]
    res = await calibrate_thresholds(synth, dataset, target_precision=1.0)
    assert synth.config == original_cfg
    assert all(
        cfg is not None
        and cfg.abstain_threshold == 0.0
        and cfg.template_confidence_threshold == 0.0
        and cfg.mutable_confidence_threshold == 0.0
        for cfg in synth.seen_configs
    )
    assert res.achieved_precision == pytest.approx(1.0)
    assert res.achieved_coverage == pytest.approx(0.5)
    assert res.recommended_abstain_threshold == pytest.approx(0.40)


@pytest.mark.asyncio
async def test_calibrate_thresholds_stage2_shadowing_and_threshold_1_0_clamp() -> None:
    """Verifies M7: threshold=1.0 clamps recommended_mutable_threshold >= recommended_template_threshold."""
    scripted = {
        "show_host": SynthesisOutput(
            stage=SynthesisStage.ARCHETYPE,
            messages=[],
            confidence=0.85,
            entropy=0.1,
            component_tree_spec={"root_component": "Column"},
        )
    }
    synth = _FakeSynthesizer(scripted)
    dataset = [
        LabeledDecisionExample(
            intent="show_host",
            payload={"host": "db-01"},
            expected_root_component="Column",
        )
    ]
    res = await calibrate_thresholds(synth, dataset, target_precision=0.95)
    assert res.achieved_coverage == pytest.approx(1.0)
    assert res.achieved_precision == pytest.approx(1.0)

    # Candidate threshold 1.0 must keep recommended_mutable_threshold >= recommended_template_threshold.
    res_one = await calibrate_thresholds(
        synth, dataset, target_precision=0.95, thresholds=[1.0]
    )
    assert res_one.recommended_template_threshold == pytest.approx(1.0)
    assert res_one.recommended_mutable_threshold == pytest.approx(1.0)
    SynthesisConfig(
        template_confidence_threshold=res_one.recommended_template_threshold,
        mutable_confidence_threshold=res_one.recommended_mutable_threshold,
        abstain_threshold=res_one.recommended_abstain_threshold,
    )
