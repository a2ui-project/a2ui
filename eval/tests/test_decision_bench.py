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

"""Unit tests for decision_bench, calibrate_decision_backend, and seed_decision_plans."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.append(os.path.abspath(os.path.dirname(__file__)))
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../bin")))

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import (
    Calibration,
    DecisionAnswer,
    DecisionBatch,
    DecisionSynthesizer,
)
from a2ui_eval.decision_bench import (
    PlanCase,
    PlanTurn,
    brier_score,
    expected_calibration_error,
    fit_temperature,
    load_plan_cases,
    render_markdown,
    render_paraphrase_markdown,
    render_template_arm_markdown,
    run_benchmark,
    run_case,
    run_paraphrase_benchmark,
    run_template_arm_benchmark,
)
from a2ui_eval.decision_common import (
    ParaphraseDecisionBackend,
    is_transcrypt_ciphertext,
    rewrite_question_prompt,
)
from a2ui_eval.shared.utils import GIT_ROOT
import calibrate_decision_backend
import decision_bench as decision_bench_cli
from decision_fixtures import (
    HOST_ANSWERS,
    HOST_DECISION_BLOCK,
    TRANSFER_ANSWERS,
    scripted_backend,
)
import pytest
from seed_decision_plans import seed_cases_from_logs

CASES_FILE = GIT_ROOT / "eval" / "datasets" / "decision_plans" / "v1.yaml"
SCHEMA_FILE = GIT_ROOT / "eval" / "datasets" / "decision_plans" / "schema.json"

_HOST_PLAN_CASE = PlanCase(
    name="host_health",
    intent=HOST_DECISION_BLOCK.intent,
    payload=dict(HOST_DECISION_BLOCK.payload),
    mutable_paths=list(HOST_DECISION_BLOCK.mutable_paths),
    expected_family="monitor",
    expected_archetypes=["dashboard", "metric_grid"],
    required_blocks=["headline", "facts"],
    expected_action_gate="pass",
    split="tuning",
    verified=True,
    tags=["smoke"],
)


def _write_synthetic_tuning_yaml(path: Path) -> Path:
    """Writes a two-case synthetic tuning dataset YAML file to `path`."""
    path.write_text(
        """
- name: host_health
  intent: "Show CPU utilization for prod-1"
  payload:
    host: "prod-1"
    cpu: 0.78
  expected:
    family: "monitor"
    archetypes: ["dashboard", "metric_grid"]
    blocks:
      required: ["headline", "facts"]
    action_gate: "pass"
  split: "tuning"
  tags: ["smoke"]
  verified: true

- name: wire_transfer
  intent: "Review wire transfer to Acme Corp"
  payload:
    recipient: "Acme Corp"
    amount: 1500
    internalTrace: "omit-me"
  actions:
    send: "Confirm Transfer"
    cancel: "Cancel"
  exclude: ["/internalTrace"]
  expected:
    family: "act"
    archetypes: ["confirm", "checkout", "review"]
    blocks:
      required: ["actions"]
    action_gate: "pass"
  split: "tuning"
  tags: ["smoke"]
  verified: true
""",
        encoding="utf-8",
    )
    return path


def test_synthetic_schema_validation(tmp_path: Path) -> None:
    """Verifies synthetic YAML cases validate against schema.json and parse cleanly."""
    sample_yaml = _write_synthetic_tuning_yaml(tmp_path / "plans.yaml")
    synthetic_cases = load_plan_cases(sample_yaml, schema_path=SCHEMA_FILE)
    assert len(synthetic_cases) == 2
    assert synthetic_cases[0].expected_family == "monitor"
    assert synthetic_cases[0].split == "tuning"
    assert synthetic_cases[0].is_heldout is False
    assert [a.id for a in synthetic_cases[1].action_specs()] == ["send", "cancel"]
    assert synthetic_cases[1].exclude == ["/internalTrace"]


def test_real_v1_yaml_validation_or_skip_if_encrypted() -> None:
    """Validates on-disk v1.yaml tuning cases when decrypted."""
    if not CASES_FILE.is_file():
        pytest.skip("Decision plan dataset file is absent.")
    if is_transcrypt_ciphertext(CASES_FILE):
        pytest.skip(
            "Decision plan dataset is encrypted with Transcrypt; unlock to run"
            " real dataset validation."
        )

    cases = load_plan_cases(CASES_FILE, schema_path=SCHEMA_FILE)
    assert len(cases) == 16
    for case in cases:
        assert case.verified is True
        assert case.split == "tuning"
        assert case.is_heldout is False
        assert "smoke" in case.tags
        assert "actions" not in case.payload
        assert "/actions" not in case.mutable_paths
        assert len(case.expected_archetypes) > 0
        assert case.expected_family in {
            "monitor",
            "act",
            "input",
            "browse",
            "inspect",
            "follow",
        }


def test_load_plan_cases_rejects_ciphertext(tmp_path: Path) -> None:
    """Verifies load_plan_cases raises RuntimeError on Transcrypt-encrypted files."""
    encrypted_file = tmp_path / "encrypted.yaml"
    encrypted_file.write_bytes(b"U2FsdGVkX1+ciphertextbytes")
    with pytest.raises(RuntimeError, match="encrypted with Transcrypt"):
        load_plan_cases(encrypted_file)


@pytest.mark.asyncio
async def test_scripted_backend_host_case_scores_perfect() -> None:
    """Verifies a scripted backend achieves 100% accuracy on the host health case."""
    backend = scripted_backend(HOST_ANSWERS, model_id="mock-v1")
    synth = DecisionSynthesizer([BasicCatalog("v1.0")], backend)

    score = await run_case(synth, _HOST_PLAN_CASE, repeat=1)
    assert score.family_accuracy == 1.0
    assert score.archetype_accuracy == 1.0
    assert score.block_recall == 1.0
    assert score.block_precision > 0.0
    assert score.abstain_rate == 0.0
    assert score.fallback_rate == 0.0
    assert score.round_trips_per_surface == 1.0
    assert score.action_gate_match is True


@pytest.mark.asyncio
async def test_run_benchmark_reports_backend_model_round_trips_and_fallback(
    tmp_path: Path,
) -> None:
    """Verifies run_benchmark and render_markdown report backend identity and fallback rates."""
    sample_yaml = _write_synthetic_tuning_yaml(tmp_path / "plans.yaml")
    cases = load_plan_cases(sample_yaml, schema_path=SCHEMA_FILE)

    # Abstain on family so the synthesizer falls back to facts.
    backend = scripted_backend(
        {"family": ("none", 0.95)},
        model_id="mock-uncalibrated",
    )
    synth = DecisionSynthesizer([BasicCatalog("v1.0")], backend)

    summary = await run_benchmark(synth, cases, repeat=1)
    assert summary.backend_kind == "mock"
    assert summary.model_id == "mock-uncalibrated"
    assert summary.cases_count == 2
    assert summary.fallback_rate == 1.0
    assert summary.round_trips_per_surface == 1.0

    md = render_markdown(summary)
    assert "Backend: `mock` (model `mock-uncalibrated`)" in md
    assert "Fallback rate: 100.0%" in md
    assert "Round trips per surface: 1.00" in md


@pytest.mark.asyncio
async def test_scripted_transfer_actions_case_scores_perfect(tmp_path: Path) -> None:
    """Verifies a scripted backend achieves 100% accuracy on an action-bearing transfer case."""
    sample_yaml = _write_synthetic_tuning_yaml(tmp_path / "plans.yaml")
    cases = load_plan_cases(sample_yaml, schema_path=SCHEMA_FILE)
    transfer_case = cases[1]

    backend = scripted_backend(TRANSFER_ANSWERS, model_id="mock-act")
    synth = DecisionSynthesizer([BasicCatalog("v1.0")], backend)
    score = await run_case(synth, transfer_case, repeat=1)
    assert score.family_accuracy == 1.0
    assert score.archetype_accuracy == 1.0
    assert score.block_recall == 1.0
    assert score.fallback_rate == 0.0


@pytest.mark.asyncio
async def test_array_only_abstention_records_abstain_without_crashing() -> None:
    """Verifies abstaining on an array-only payload records an abstention cleanly."""
    array_case = PlanCase(
        name="resort_list",
        intent="Browse available ski resorts",
        payload={"resorts": [{"name": "Alta", "openRuns": 70}]},
        expected_family="browse",
        expected_archetypes=["feed", "card_list"],
        required_blocks=["collection"],
        expected_action_gate="pass",
        split="tuning",
        verified=True,
    )
    backend = scripted_backend(
        {"family": ("none", 0.95)},
        model_id="mock-abstain",
    )
    synth = DecisionSynthesizer([BasicCatalog("v1.0")], backend)
    score = await run_case(synth, array_case, repeat=1)
    assert score.abstain_rate == 1.0
    assert score.fallback_rate == 0.0
    assert score.round_trips_per_surface == 1.0


@pytest.mark.asyncio
async def test_deliberately_wrong_script_scores_zero() -> None:
    """Verifies an intentionally misclassified job family scores 0.0 accuracy."""
    wrong_answers = dict(HOST_ANSWERS)
    wrong_answers["family"] = ("input", 0.99)
    backend = scripted_backend(wrong_answers)
    synth = DecisionSynthesizer([BasicCatalog("v1.0")], backend)

    score = await run_case(synth, _HOST_PLAN_CASE, repeat=1)
    assert score.family_accuracy == 0.0


def test_brier_and_ece_computation() -> None:
    """Verifies Brier score and 10-bin Expected Calibration Error calculations."""
    wrong_pairs = [(1.0, 0.0), (1.0, 0.0)]
    assert brier_score(wrong_pairs) == 1.0
    assert expected_calibration_error(wrong_pairs, num_bins=10) == 1.0

    calibrated_pairs = [(0.5, 1.0), (0.5, 0.0)]
    assert brier_score(calibrated_pairs) == 0.25
    assert expected_calibration_error(calibrated_pairs, num_bins=10) == 0.0

    pairs = [(0.1, 0.0), (0.9, 1.0)]
    assert pytest.approx(brier_score(pairs)) == (0.01 + 0.01) / 2
    assert pytest.approx(expected_calibration_error(pairs, num_bins=10)) == 0.1


def test_fit_temperature_returns_1_for_calibrated_inputs() -> None:
    """Verifies fit_temperature selects T=1.0 for already-calibrated probability pairs."""
    calibrated_data = [(0.8, 1.0)] * 8 + [(0.8, 0.0)] * 2
    t = fit_temperature(calibrated_data)
    assert t == 1.0
    assert fit_temperature(calibrated_data, candidates=(-1.0, 0.0, 1.0)) == 1.0


def test_calibrate_decision_backend_writes_loadable_profile(
    tmp_path: Path,
) -> None:
    """Verifies calibrate_decision_backend writes a JSON profile loadable by Calibration."""
    sample_yaml = _write_synthetic_tuning_yaml(tmp_path / "tuning.yaml")
    cal_out = tmp_path / "cal.json"

    rc = calibrate_decision_backend.main([
        "--backend",
        "mock",
        "--model",
        "mock",
        "--cases",
        str(sample_yaml),
        "--out",
        str(cal_out),
    ])
    assert rc == 0
    assert cal_out.is_file()

    loaded = Calibration.load(cal_out, backend_kind="mock", model_id="mock")
    assert loaded.temperature > 0.0


def test_calibrate_decision_backend_refuses_heldout_cases(
    tmp_path: Path,
) -> None:
    """Verifies calibrate_decision_backend refuses held-out splits and held-out tags."""
    heldout_split_yaml = tmp_path / "heldout_split.yaml"
    heldout_split_yaml.write_text(
        """
- name: secret_eval_case
  intent: "Show CPU utilization"
  payload:
    cpu: 0.5
  expected:
    family: "monitor"
    archetypes: ["dashboard"]
  split: "heldout"
  tags: ["smoke"]
  verified: true
""",
        encoding="utf-8",
    )
    cal_out = tmp_path / "should_not_exist.json"

    with pytest.raises(ValueError, match="held-out"):
        calibrate_decision_backend.load_tuning_cases(
            heldout_split_yaml, schema_path=SCHEMA_FILE
        )

    rc_split = calibrate_decision_backend.main([
        "--backend",
        "mock",
        "--model",
        "mock",
        "--cases",
        str(heldout_split_yaml),
        "--out",
        str(cal_out),
    ])
    assert rc_split == 1
    assert not cal_out.exists()

    heldout_tag_yaml = tmp_path / "heldout_tag.yaml"
    heldout_tag_yaml.write_text(
        """
- name: tagged_heldout_case
  intent: "Show CPU utilization"
  payload:
    cpu: 0.5
  expected:
    family: "monitor"
    archetypes: ["dashboard"]
  tags: ["smoke", "heldout"]
  verified: true
""",
        encoding="utf-8",
    )
    rc_tag = calibrate_decision_backend.main([
        "--backend",
        "mock",
        "--model",
        "mock",
        "--cases",
        str(heldout_tag_yaml),
        "--out",
        str(cal_out),
    ])
    assert rc_tag == 1
    assert not cal_out.exists()


def test_compute_bayes_optimal_threshold() -> None:
    """Verifies Bayes-optimal threshold computation and input validation."""
    assert calibrate_decision_backend.compute_bayes_optimal_threshold(
        1.0, 20.0
    ) == pytest.approx(0.95)
    assert calibrate_decision_backend.compute_bayes_optimal_threshold(25.0, 20.0) == 0.0
    with pytest.raises(ValueError, match="non-negative"):
        calibrate_decision_backend.compute_bayes_optimal_threshold(-0.1, 10.0)
    with pytest.raises(ValueError, match="strictly positive"):
        calibrate_decision_backend.compute_bayes_optimal_threshold(1.0, 0.0)


def test_plan_case_from_dict_handles_explicit_nulls() -> None:
    """Verifies PlanCase.from_dict normalizes explicit None values to defaults."""
    case = PlanCase.from_dict({
        "name": "null_case",
        "intent": "test",
        "payload": None,
        "mutable_paths": None,
        "tags": None,
        "expected": {
            "family": None,
            "archetypes": None,
            "blocks": None,
            "action_gate": None,
        },
    })
    assert case.payload == {}
    assert case.expected_archetypes == []
    assert case.required_blocks == []
    assert case.expected_action_gate == "pass"


def test_seed_script_creates_unverified_stubs_skipped_by_default(
    tmp_path: Path,
) -> None:
    """Verifies seed_cases_from_logs writes unverified stubs that validate against schema.json."""
    fake_log = {
        "samples": [{
            "id": "sample_123",
            "input": "Show server stats",
            "metadata": {
                "decision_block": json.dumps({
                    "intent": "Show server stats",
                    "payload": {"server": "web-1", "load": 0.42},
                    "actions": {"restart": "Restart Server"},
                    "mutablePaths": ["/load"],
                }),
                "decision_archetype": "dashboard",
                "decision_stage": "monitor",
                "decision_blocks": ["headline_row", "facts_card"],
            },
        }]
    }

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

        loaded_default = load_plan_cases(
            target_seeded, include_unverified=False, schema_path=SCHEMA_FILE
        )
        assert len(loaded_default) == 0

        loaded_all = load_plan_cases(
            target_seeded, include_unverified=True, schema_path=SCHEMA_FILE
        )
        assert len(loaded_all) == 1
        assert loaded_all[0].name == "sample_123_dashboard"
        assert loaded_all[0].verified is False
        assert loaded_all[0].split == "tuning"
        assert [a.id for a in loaded_all[0].action_specs()] == ["restart"]
        assert loaded_all[0].mutable_paths == ["/load"]
        assert loaded_all[0].expected_family == "monitor"
        assert loaded_all[0].expected_archetypes == ["dashboard"]
        assert loaded_all[0].required_blocks == ["headline_row", "facts_card"]
    finally:
        if target_seeded.is_file():
            target_seeded.unlink()


@pytest.mark.asyncio
async def test_collect_calibration_pairs_preserves_alignment_on_empty_score() -> None:
    """Verifies _collect_calibration_pairs skips empty CaseScore objects without misalignment."""
    from a2ui_eval.decision_bench import CaseScore

    synth = DecisionSynthesizer(
        [BasicCatalog("v1.0")], backend=scripted_backend(HOST_ANSWERS)
    )
    host_score = await run_case(synth, _HOST_PLAN_CASE)
    empty_case = PlanCase(
        name="empty_case",
        intent="Empty",
        payload={},
        expected_family="inform",
        expected_archetypes=["article"],
        required_blocks=["nonexistent_block"],
    )
    pairs_with_empty = calibrate_decision_backend._collect_calibration_pairs([
        CaseScore(case=empty_case, repeats=1, evaluations=[]),
        host_score,
    ])
    pairs_direct = calibrate_decision_backend._collect_calibration_pairs([
        host_score,
    ])
    assert pairs_with_empty == pairs_direct


@pytest.mark.asyncio
async def test_wave6_forced_fit_and_false_no_fit_rates() -> None:
    """Verifies forced-fit and false no-fit rates across in-grammar and out-of-grammar cases."""
    none_case = PlanCase(
        name="chess_board_canvas",
        intent="Render an interactive 8x8 chess board with drag-and-drop moves",
        payload={"fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"},
        expected_family="none",
        expected_archetypes=[],
        split="heldout",
        verified=False,
    )
    cases = [_HOST_PLAN_CASE, none_case]

    # 1. Always returning `none` yields 0% forced-fit and 100% false no-fit on in-grammar
    abstain_synth = DecisionSynthesizer(
        [BasicCatalog("v1.0")],
        scripted_backend({"family": ("none", 0.90)}, model_id="mock-none"),
    )
    abstain_summary = await run_benchmark(abstain_synth, cases, repeat=1)
    assert abstain_summary.in_grammar_count == 1
    assert abstain_summary.out_of_grammar_count == 1
    assert abstain_summary.unverified_count == 1
    assert abstain_summary.forced_fit_rate == 0.0
    assert abstain_summary.false_no_fit_rate == 1.0
    assert abstain_summary.family_accuracy == 0.0

    # 2. Always forcing `monitor -> dashboard` yields 100% forced-fit on `none` case
    force_synth = DecisionSynthesizer(
        [BasicCatalog("v1.0")],
        scripted_backend(HOST_ANSWERS, model_id="mock-force"),
    )
    force_summary = await run_benchmark(force_synth, cases, repeat=1)
    assert force_summary.forced_fit_rate == 1.0
    assert force_summary.false_no_fit_rate == 0.0
    assert force_summary.family_accuracy == 1.0
    assert force_summary.archetype_accuracy == 1.0


@pytest.mark.asyncio
async def test_wave6_slot_bindings_sensitive_leaks_and_action_accuracy() -> None:
    """Verifies slot binding recall, action binding accuracy, and sensitive pointer leak detection."""
    safe_case = PlanCase(
        name="host_with_action_and_secret",
        intent="Show server record for prod-1",
        payload={
            "name": "prod-1",
            "cpu": 0.78,
            "uptimeHours": 412,
            "debugTag": "DBG-SECRET-9942",
        },
        actions={
            "ack_alert": {
                "label": "Acknowledge",
                "context": {"hostName": "/name"},
            }
        },
        exclude=["/debugTag"],
        sensitive=["/debugTag"],
        expected_family="inspect",
        expected_archetypes=["detail"],
        expected_bindings={
            "page.title": ["/name"],
            "headline.items": ["/cpu"],
            "facts.rows": ["/uptimeHours"],
        },
        expected_actions={"ack_alert": ["/name"]},
        split="heldout",
    )
    answers = {
        "family": ("inspect", 0.90),
        "stakes": 0.5,
        "urgency": 0.5,
        "archetype:inspect": ("detail", 0.92),
        "gate:headline": 0.90,
        "gate:facts": 0.90,
        "gate:actions": 0.90,
        "salience:/cpu": 2.8,
        "salience:/uptimeHours": 1.1,
        "instance:actions.primary:buttons": ("ack_alert", 0.90),
        "instance:actions.destructive:ack_alert": 0.10,
    }
    synth = DecisionSynthesizer(
        [BasicCatalog("v1.0")], scripted_backend(answers, model_id="mock-safe")
    )
    safe_summary = await run_benchmark(synth, [safe_case], repeat=1)
    assert safe_summary.slot_binding_accuracy == 1.0
    assert safe_summary.action_accuracy == 1.0
    assert safe_summary.sensitive_leak_rate == 0.0

    # Removing `exclude` causes `/debugTag` to bind in `facts`, triggering a sensitive leak
    leak_case = PlanCase(
        name="host_leak",
        intent="Show server record for prod-1",
        payload=safe_case.payload,
        sensitive=["/debugTag"],
        expected_family="inspect",
        expected_archetypes=["detail"],
        expected_actions={"missing_event": ["/name"]},
        split="heldout",
    )
    leak_summary = await run_benchmark(synth, [leak_case], repeat=1)
    assert leak_summary.sensitive_leak_rate == 1.0
    assert leak_summary.action_accuracy == 0.0


@pytest.mark.asyncio
async def test_wave6_multi_turn_cache_hits_and_operation_accuracy() -> None:
    """Verifies multi-turn surface lifecycle operation scoring and plan cache hit rates."""
    mt_case = PlanCase(
        name="host_lifecycle",
        intent="Display server metrics",
        payload=dict(HOST_DECISION_BLOCK.payload),
        expected_family="monitor",
        expected_archetypes=["dashboard"],
        turns=[
            PlanTurn(
                surface_id="ops",
                intent="Display server metrics",
                payload=dict(HOST_DECISION_BLOCK.payload),
                expected_operation="create",
                expected_cache_hit=False,
            ),
            PlanTurn(
                surface_id="ops",
                intent="Display server metrics",
                payload={**HOST_DECISION_BLOCK.payload, "cpu": 0.31},
                expected_operation="update_root",
                expected_cache_hit=True,
            ),
            PlanTurn(
                surface_id="ops",
                intent="Display server metrics",
                payload={**HOST_DECISION_BLOCK.payload, "cpu": 0.55},
                region="headline",
                expected_operation="update_region",
                expected_cache_hit=False,
            ),
            PlanTurn(
                surface_id="ops",
                intent="Display server metrics",
                payload=dict(HOST_DECISION_BLOCK.payload),
                replace=True,
                expected_operation="replace",
                expected_cache_hit=False,
            ),
        ],
    )
    synth = DecisionSynthesizer(
        [BasicCatalog("v1.0")], scripted_backend(HOST_ANSWERS, model_id="mock-mt")
    )
    summary = await run_benchmark(synth, [mt_case], repeat=1)
    assert summary.multi_turn_cache_hit_rate == 1.0
    assert summary.multi_turn_operation_accuracy == 1.0
    assert summary.mean_round_trips == pytest.approx(0.75)


@pytest.mark.asyncio
async def test_wave6_paraphrase_and_template_arm_modes() -> None:
    """Verifies paraphrase sensitivity and tool-mode promoted template arm benchmarks."""
    tool_case = PlanCase(
        name="host_tool",
        intent="Show CPU and host metrics",
        payload=dict(HOST_DECISION_BLOCK.payload),
        mode="tool",
        tool_name="render_host_metrics",
        expected_family="monitor",
        expected_archetypes=["dashboard"],
        expected_bindings={"headline.items": ["/cpu"]},
    )

    seen_prompts: list[str] = []
    inner = scripted_backend(HOST_ANSWERS, model_id="mock-para")

    class _SpyBackend(ParaphraseDecisionBackend):
        """Records rewritten decision question prompts during paraphrase evaluation."""

        async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
            """Forwards `batch` to `super().answer` and records rewritten prompts."""
            res = await super().answer(batch)
            seen_prompts.extend(
                rewrite_question_prompt(q.prompt) for q in batch.questions
            )
            return res

    assert (
        rewrite_question_prompt("What job is this surface doing for the person?")
        != "What job is this surface doing for the person?"
    )
    synth = DecisionSynthesizer([BasicCatalog("v1.0")], inner)
    para_comp = await run_paraphrase_benchmark(synth, [tool_case], repeat=1)
    assert para_comp.family_accuracy_delta == 0.0
    assert "Paraphrase sensitivity" in render_paraphrase_markdown(para_comp)

    spy_synth = DecisionSynthesizer([BasicCatalog("v1.0")], _SpyBackend(inner))
    await run_benchmark(spy_synth, [tool_case], repeat=1)
    assert seen_prompts

    tpl_comp = await run_template_arm_benchmark(synth, [tool_case], repeat=2)
    assert tpl_comp.tool_cases_count == 1
    assert tpl_comp.planner_arm.round_trips_per_surface == 1.0
    assert tpl_comp.template_arm.round_trips_per_surface == 0.0
    assert tpl_comp.template_arm.p95_latency_ms == 0.0
    assert tpl_comp.template_arm.slot_binding_accuracy == 1.0
    assert "Promoted template" in render_template_arm_markdown(tpl_comp)


def test_decision_bench_cli_required_flags_and_heldout_unfrozen_notice(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """Verifies decision_bench CLI required flags and unfrozen heldout banner rendering."""
    with pytest.raises(SystemExit):
        decision_bench_cli.parse_args([])

    ds_dir = tmp_path / "decision_plans"
    ds_dir.mkdir()
    _write_synthetic_tuning_yaml(ds_dir / "v1.yaml")
    (ds_dir / "heldout_v1.yaml").write_text(
        """
- name: heldout_canvas
  intent: "Draw a free-form pixel art editor canvas"
  payload:
    gridWidth: 32
    gridHeight: 32
  expected:
    family: "none"
    archetypes: []
  split: "heldout"
  verified: false
""",
        encoding="utf-8",
    )
    json_out = tmp_path / "bench_out.json"
    rc = decision_bench_cli.main([
        "--backend",
        "mock",
        "--model",
        "mock",
        "--dataset",
        str(ds_dir),
        "--split",
        "all",
        "--paraphrase",
        "--template-arm",
        "--json",
        str(json_out),
    ])
    assert rc == 0
    captured = capsys.readouterr().out
    assert "[UNFROZEN HELDOUT]" in captured
    assert "Forced-fit rate:" in captured
    assert "False no-fit rate:" in captured
    assert "Slot binding accuracy:" in captured
    data = json.loads(json_out.read_text(encoding="utf-8"))
    assert set(data["splits"]) == {"tuning", "heldout"}
    assert data["splits"]["heldout"]["unverified_count"] == 1


@pytest.mark.asyncio
async def test_paraphrase_backend_and_recorder_use_server_reported_latency() -> None:
    """Verifies ParaphraseDecisionBackend forwards last_call_latency_ms to the recorder."""
    import asyncio

    inner = scripted_backend(HOST_ANSWERS, model_id="mock-lat")
    orig_answer = inner.answer

    async def delayed_answer(batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
        """Adds an artificial client sleep before returning the scripted answer."""
        await asyncio.sleep(0.02)
        return await orig_answer(batch)

    inner.answer = delayed_answer  # type: ignore[method-assign]
    inner.last_call_latency_ms = 1.5  # type: ignore[attr-defined]
    wrapped = ParaphraseDecisionBackend(inner)
    assert wrapped.last_call_latency_ms == pytest.approx(1.5)
    case = PlanCase(
        name="host_lat",
        intent="Show CPU and host metrics",
        payload=dict(HOST_DECISION_BLOCK.payload),
        expected_family="monitor",
        expected_archetypes=["dashboard"],
    )
    synth = DecisionSynthesizer([BasicCatalog("v1.0")], wrapped)
    summary = await run_benchmark(synth, [case], repeat=1)
    assert summary.p50_latency_ms == pytest.approx(1.5)


@pytest.mark.asyncio
async def test_plan_turn_forwards_layout_title_summary_and_fallback_dsl() -> None:
    """Verifies PlanTurn parses and forwards layout, title, summary, and fallback_dsl."""
    turn = PlanTurn.from_dict({
        "intent": "Display server metrics",
        "payload": dict(HOST_DECISION_BLOCK.payload),
        "layout": ["headline:cpu", "facts:host"],
        "title": "Custom Turn Title",
        "summary": "Custom Turn Summary",
        "fallback_dsl": "Text: Custom Turn Fallback",
    })
    assert turn.layout == ["headline:cpu", "facts:host"]
    assert turn.title == "Custom Turn Title"
    assert turn.summary == "Custom Turn Summary"
    assert turn.fallback_dsl == "Text: Custom Turn Fallback"

    captured_kwargs: dict[str, object] = {}
    synth = DecisionSynthesizer(
        [BasicCatalog("v1.0")], scripted_backend(HOST_ANSWERS, model_id="mock-turn")
    )
    orig_synthesize = synth.synthesize

    async def spy_synthesize(*args: object, **kwargs: object) -> object:
        """Captures keyword arguments forwarded by _run_single_turn_step."""
        captured_kwargs.update(kwargs)
        return await orig_synthesize(*args, **kwargs)  # type: ignore[arg-type]

    synth.synthesize = spy_synthesize  # type: ignore[method-assign]
    mt_case = PlanCase(
        name="host_turn_fields",
        intent="Display server metrics",
        payload=dict(HOST_DECISION_BLOCK.payload),
        expected_family="monitor",
        expected_archetypes=["dashboard"],
        turns=[turn],
    )
    await run_case(synth, mt_case, repeat=1)
    assert captured_kwargs["layout"] == ["headline:cpu", "facts:host"]
    assert captured_kwargs["title"] == "Custom Turn Title"
    assert captured_kwargs["summary"] == "Custom Turn Summary"
    assert captured_kwargs["fallback_dsl"] == "Text: Custom Turn Fallback"


def test_seed_script_infers_family_from_decision_family_or_archetype_grammar(
    tmp_path: Path,
) -> None:
    """Verifies seed_cases_from_logs produces schema-valid families across synthesis stages."""
    fake_log = {
        "samples": [
            {
                "id": "s_browse",
                "input": "Browse resorts",
                "metadata": {
                    "decision_block": {
                        "intent": "Browse resorts",
                        "payload": {"resorts": [{"name": "Alta"}]},
                    },
                    "decision_archetype": "feed",
                    "decision_stage": "archetype",
                    "decision_blocks": ["collection"],
                },
            },
            {
                "id": "s_tpl",
                "input": "Confirm payment",
                "metadata": {
                    "decision_block": {
                        "intent": "Confirm payment",
                        "payload": {"amount": 50},
                    },
                    "decision_family": "act",
                    "decision_archetype": "confirm",
                    "decision_stage": "template_select",
                    "decision_blocks": ["actions"],
                },
            },
            {
                "id": "s_inspect",
                "input": "Inspect cluster node",
                "metadata": {
                    "decision_block": {
                        "intent": "Inspect cluster node",
                        "payload": {"node": "worker-1", "status": "Ready"},
                    },
                    "decision_archetype": "detail",
                    "decision_stage": "blocks",
                    "decision_blocks": ["prose", "facts"],
                },
            },
        ]
    }
    target_seeded = (
        GIT_ROOT
        / "eval"
        / "datasets"
        / "decision_plans"
        / "test_tmp_seeded_stages.yaml"
    )
    if target_seeded.is_file():
        target_seeded.unlink()
    fake_log_file = tmp_path / "stages.eval"
    fake_log_file.write_text("{}", encoding="utf-8")

    try:
        with patch("seed_decision_plans.load_log_data", return_value=fake_log):
            added = seed_cases_from_logs([fake_log_file], target_seeded)
            assert added == 3

        loaded = load_plan_cases(
            target_seeded, include_unverified=True, schema_path=SCHEMA_FILE
        )
        by_name = {c.name: c for c in loaded}
        assert by_name["s_browse_feed"].expected_family == "browse"
        assert by_name["s_tpl_confirm"].expected_family == "act"
        assert by_name["s_inspect_detail"].expected_family == "inspect"
    finally:
        if target_seeded.is_file():
            target_seeded.unlink()


@pytest.mark.asyncio
async def test_calibration_pairs_exclude_out_of_grammar_archetype_points() -> None:
    """Verifies _collect_calibration_pairs omits archetype points on out-of-grammar abstentions."""
    none_case = PlanCase(
        name="out_of_grammar_none",
        intent="Draw an interactive 3D shader canvas",
        payload={"fps": 60},
        expected_family="none",
        expected_archetypes=[],
        split="tuning",
        verified=True,
    )
    synth = DecisionSynthesizer(
        [BasicCatalog("v1.0")],
        scripted_backend({"family": ("none", 0.90)}, model_id="mock-none"),
    )
    score = await run_case(synth, none_case, repeat=1)
    pairs = calibrate_decision_backend._collect_calibration_pairs([score])
    # Only the family decision question was asked; no archetype question was answered.
    assert len(pairs) == 1
    assert pairs[0] == pytest.approx((0.90, 1.0))


@pytest.mark.asyncio
async def test_out_of_grammar_only_benchmark_reports_zero_in_grammar_accuracy() -> None:
    """Verifies out-of-grammar-only benchmark slices report 0.0 in-grammar accuracy."""
    none_case = PlanCase(
        name="out_of_grammar_only",
        intent="Draw an interactive 3D shader canvas",
        payload={"fps": 60},
        expected_family="none",
        expected_archetypes=[],
        split="heldout",
        verified=True,
    )
    synth = DecisionSynthesizer(
        [BasicCatalog("v1.0")],
        scripted_backend({"family": ("none", 0.90)}, model_id="mock-none"),
    )
    summary = await run_benchmark(synth, [none_case], repeat=1)
    assert summary.in_grammar_count == 0
    assert summary.out_of_grammar_count == 1
    assert summary.forced_fit_rate == 0.0
    assert summary.family_accuracy == 0.0
    assert summary.archetype_accuracy == 0.0


def test_load_tuning_cases_defaults_to_tuning_split_and_rejects_other_splits(
    tmp_path: Path,
) -> None:
    """Verifies load_tuning_cases isolates v1.yaml by default and rejects non-tuning splits."""
    ds_dir = tmp_path / "decision_plans"
    ds_dir.mkdir()
    _write_synthetic_tuning_yaml(ds_dir / "v1.yaml")
    (ds_dir / "heldout_v1.yaml").write_text(
        """
- name: secret_heldout
  intent: "Show CPU utilization"
  payload:
    cpu: 0.5
  expected:
    family: "monitor"
    archetypes: ["dashboard"]
  split: "heldout"
  verified: true
""",
        encoding="utf-8",
    )
    cases = calibrate_decision_backend.load_tuning_cases(
        ds_dir, split=None, schema_path=SCHEMA_FILE
    )
    assert len(cases) == 2
    assert all(not c.is_heldout for c in cases)

    with pytest.raises(ValueError, match="only 'tuning' is allowed"):
        calibrate_decision_backend.load_tuning_cases(
            ds_dir, split="heldout", schema_path=SCHEMA_FILE
        )
    with pytest.raises(ValueError, match="only 'tuning' is allowed"):
        calibrate_decision_backend.load_tuning_cases(
            ds_dir, split="all", schema_path=SCHEMA_FILE
        )
