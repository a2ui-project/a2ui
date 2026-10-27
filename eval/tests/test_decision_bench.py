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

"""Unit tests for the decision plan golden dataset and benchmark runner."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../bin")))

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import DecisionSynthesizer
from a2ui_eval.decision_bench import (
    brier_score,
    expected_calibration_error,
    fit_temperature,
    load_plan_cases,
    run_benchmark,
    run_case,
)
from a2ui_eval.shared.utils import GIT_ROOT
import pytest
from seed_decision_plans import seed_cases_from_logs
from tests.decision_fixtures import HOST_ANSWERS, scripted_backend

CASES_FILE = GIT_ROOT / "eval" / "datasets" / "decision_plans" / "v1.yaml"
SCHEMA_FILE = GIT_ROOT / "eval" / "datasets" / "decision_plans" / "schema.json"


def test_schema_and_v1_yaml_validation() -> None:
    cases = load_plan_cases(CASES_FILE, schema_path=SCHEMA_FILE)
    assert len(cases) == 16
    for case in cases:
        assert case.verified is True
        assert "smoke" in case.tags
        assert len(case.expected_archetypes) > 0
        assert case.expected_family in {
            "monitor",
            "act",
            "input",
            "browse",
            "inspect",
            "follow",
        }


@pytest.mark.asyncio
async def test_scripted_backend_host_case_scores_perfect() -> None:
    cases = load_plan_cases(CASES_FILE)
    host_case = next(c for c in cases if c.name == "host_health")

    backend = scripted_backend(HOST_ANSWERS)
    synth = DecisionSynthesizer([BasicCatalog("v1.0")], backend)

    score = await run_case(synth, host_case, repeat=1)
    assert score.family_accuracy == 1.0
    assert score.archetype_accuracy == 1.0
    assert score.block_recall == 1.0
    assert score.block_precision > 0.0
    assert score.abstain_rate == 0.0
    assert score.action_gate_match is True


@pytest.mark.asyncio
async def test_deliberately_wrong_script_scores_zero() -> None:
    cases = load_plan_cases(CASES_FILE)
    host_case = next(c for c in cases if c.name == "host_health")

    wrong_answers = dict(HOST_ANSWERS)
    wrong_answers["family"] = ("input", 0.99)
    backend = scripted_backend(wrong_answers)
    synth = DecisionSynthesizer([BasicCatalog("v1.0")], backend)

    score = await run_case(synth, host_case, repeat=1)
    assert score.family_accuracy == 0.0


def test_brier_and_ece_computation() -> None:
    # 1. Completely confident and wrong: p=1.0, y=0.0
    wrong_pairs = [(1.0, 0.0), (1.0, 0.0)]
    assert brier_score(wrong_pairs) == 1.0
    assert expected_calibration_error(wrong_pairs, num_bins=10) == 1.0

    # 2. Perfect calibration in single bin: 50% yes, 50% no with p=0.5
    calibrated_pairs = [(0.5, 1.0), (0.5, 0.0)]
    # Brier: ((0.5 - 1.0)^2 + (0.5 - 0.0)^2) / 2 = (0.25 + 0.25) / 2 = 0.25
    assert brier_score(calibrated_pairs) == 0.25
    # Bin [0.5, 0.6) has avg_conf=0.5, avg_acc=0.5 -> diff=0.0
    assert expected_calibration_error(calibrated_pairs, num_bins=10) == 0.0

    # 3. Hand-computed test with two points:
    # Point 1: p=0.1, y=0.0 -> falls into bin 0 [0.0, 0.1) -> conf=0.1, acc=0.0 -> error=0.1
    # Point 2: p=0.9, y=1.0 -> falls into bin 9 [0.9, 1.0] -> conf=0.9, acc=1.0 -> error=0.1
    # Total ECE = 0.5 * 0.1 + 0.5 * 0.1 = 0.1
    pairs = [(0.1, 0.0), (0.9, 1.0)]
    assert pytest.approx(brier_score(pairs)) == (0.01 + 0.01) / 2
    assert pytest.approx(expected_calibration_error(pairs, num_bins=10)) == 0.1


def test_fit_temperature_returns_1_for_calibrated_inputs() -> None:
    # Perfectly calibrated inputs: 80% confidence with 80% accuracy
    calibrated_data = [(0.8, 1.0)] * 8 + [(0.8, 0.0)] * 2
    t = fit_temperature(calibrated_data)
    assert t == 1.0


def test_seed_script_creates_unverified_stubs_skipped_by_default(
    tmp_path: Path,
) -> None:
    fake_log = {
        "samples": [{
            "id": "sample_123",
            "input": "Show server stats",
            "metadata": {
                "decision_block": json.dumps({
                    "intent": "Show server stats",
                    "payload": {"server": "web-1", "load": 0.42},
                    "mutable_paths": [],
                }),
                "decision_archetype": "dashboard",
                "decision_stage": "monitor",
                "decision_blocks": ["headline_row", "facts_card"],
            },
        }]
    }

    # Target file strictly under eval/datasets/decision_plans/
    target_seeded = (
        GIT_ROOT / "eval" / "datasets" / "decision_plans" / "test_tmp_seeded.yaml"
    )
    if target_seeded.is_file():
        target_seeded.unlink()

    fake_log_file = tmp_path / "test.eval"
    fake_log_file.write_text("{}", encoding="utf-8")

    try:
        with patch("seed_decision_plans.load_log_data", return_value=fake_log):
            added = seed_cases_from_logs([fake_log_file], target_seeded)
            assert added == 1

        # Check default loader ignores unverified
        loaded_default = load_plan_cases(target_seeded, include_unverified=False)
        assert len(loaded_default) == 0

        # Check loader with include_unverified=True includes it
        loaded_all = load_plan_cases(target_seeded, include_unverified=True)
        assert len(loaded_all) == 1
        assert loaded_all[0].name == "sample_123_dashboard"
        assert loaded_all[0].verified is False
        assert loaded_all[0].expected_family == "monitor"
        assert loaded_all[0].expected_archetypes == ["dashboard"]
        assert loaded_all[0].required_blocks == ["headline_row", "facts_card"]
    finally:
        if target_seeded.is_file():
            target_seeded.unlink()
