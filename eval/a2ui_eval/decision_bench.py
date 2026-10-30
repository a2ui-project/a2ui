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

"""Golden plan evaluation and latency benchmark for A2UI decision models."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
import json
import math
from pathlib import Path
import time
from typing import Any

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import (
    DecisionAnswer,
    DecisionSynthesizer,
    SynthesisOutput,
    SynthesisStage,
)
import jsonschema
import yaml

from .decision_common import build_decision_backend


@dataclass(frozen=True)
class PlanCase:
    """A single ground-truth decision case."""

    name: str
    intent: str
    payload: dict[str, Any]
    expected_family: str
    expected_archetypes: list[str]
    mutable_paths: list[str] = field(default_factory=list)
    required_blocks: list[str] = field(default_factory=list)
    forbidden_blocks: list[str] = field(default_factory=list)
    expected_action_gate: str = "pass"
    tags: list[str] = field(default_factory=list)
    verified: bool = True
    source: dict[str, Any] | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PlanCase:
        expected = data.get("expected") or {}
        blocks = expected.get("blocks") or {}
        return cls(
            name=data["name"],
            intent=data["intent"],
            payload=dict(data.get("payload") or {}),
            expected_family=expected.get("family") or "",
            expected_archetypes=list(expected.get("archetypes") or []),
            mutable_paths=list(data.get("mutable_paths") or []),
            required_blocks=list(blocks.get("required") or []),
            forbidden_blocks=list(blocks.get("forbidden") or []),
            expected_action_gate=expected.get("action_gate") or "pass",
            tags=list(data.get("tags") or []),
            verified=bool(data.get("verified", True)),
            source=data.get("source"),
        )


def load_plan_cases(
    cases_path: str | Path,
    *,
    tags: Sequence[str] | str | None = None,
    include_unverified: bool = False,
    schema_path: str | Path | None = None,
) -> list[PlanCase]:
    """Loads and validates decision plan cases from a YAML file.

    Args:
        cases_path: Path to the YAML file holding cases.
        tags: Optional filter tag(s) to match.
        include_unverified: If True, include cases marked verified=False.
        schema_path: Optional path to JSON schema; defaults to schema.json
            alongside the cases file.
    """
    path = Path(cases_path)
    if not path.is_file():
        raise FileNotFoundError(f"Decision cases file not found: {path}")

    schema_file = Path(schema_path) if schema_path else path.parent / "schema.json"
    if schema_file.is_file():
        with open(schema_file, "r", encoding="utf-8") as f:
            schema = json.load(f)
    else:
        schema = None

    with open(path, "r", encoding="utf-8") as f:
        raw_cases = yaml.safe_load(f) or []

    if schema is not None:
        jsonschema.validate(instance=raw_cases, schema=schema)

    target_tags: set[str] = set()
    if isinstance(tags, str):
        target_tags = {t.strip() for t in tags.split(",") if t.strip()}
    elif tags:
        target_tags = {str(t).strip() for t in tags if str(t).strip()}

    cases: list[PlanCase] = []
    for item in raw_cases:
        if not isinstance(item, dict):
            continue
        if not include_unverified and not item.get("verified", True):
            continue
        case = PlanCase.from_dict(item)
        if target_tags and not any(t in target_tags for t in case.tags):
            continue
        cases.append(case)

    return cases


def is_action_gate_blocked(output: SynthesisOutput) -> bool:
    """Checks whether the synthesis run was blocked by an action gate.

    The action gate is recorded in the trace reason where question.id is
    archetype_status and outcome is action_gate.
    """
    if output.stage is not SynthesisStage.ABSTAIN_FALLBACK:
        return False
    return any(
        record.question.id == "archetype_status" and record.outcome == "action_gate"
        for record in output.trace
    )


@dataclass(frozen=True)
class CaseEvaluation:
    """Evaluation metrics for a single synthesis execution."""

    output: SynthesisOutput
    wall_time_ms: float
    family_correct: bool
    archetype_correct: bool
    block_precision: float
    block_recall: float
    forbidden_block_count: int
    action_gate_outcome: str
    abstained: bool

    @property
    def host_overhead_ms(self) -> float:
        return max(0.0, self.wall_time_ms - self.output.decision_latency_ms)


@dataclass
class CaseScore:
    """Aggregated score for a case across repeats."""

    case: PlanCase
    repeats: int
    evaluations: list[CaseEvaluation] = field(default_factory=list)

    @property
    def family_accuracy(self) -> float:
        if not self.evaluations:
            return 0.0
        return sum(1.0 for e in self.evaluations if e.family_correct) / len(
            self.evaluations
        )

    @property
    def archetype_accuracy(self) -> float:
        if not self.evaluations:
            return 0.0
        return sum(1.0 for e in self.evaluations if e.archetype_correct) / len(
            self.evaluations
        )

    @property
    def block_precision(self) -> float:
        if not self.evaluations:
            return 0.0
        return sum(e.block_precision for e in self.evaluations) / len(self.evaluations)

    @property
    def block_recall(self) -> float:
        if not self.evaluations:
            return 0.0
        return sum(e.block_recall for e in self.evaluations) / len(self.evaluations)

    @property
    def abstain_rate(self) -> float:
        if not self.evaluations:
            return 0.0
        return sum(1.0 for e in self.evaluations if e.abstained) / len(self.evaluations)

    @property
    def action_gate_match(self) -> bool:
        if not self.evaluations:
            return False
        expected = self.case.expected_action_gate
        if expected == "any":
            return True
        return all(e.action_gate_outcome == expected for e in self.evaluations)

    @property
    def decision_latency_p50(self) -> float:
        latencies = sorted(e.output.decision_latency_ms for e in self.evaluations)
        return _percentile(latencies, 0.50)

    @property
    def decision_latency_p95(self) -> float:
        latencies = sorted(e.output.decision_latency_ms for e in self.evaluations)
        return _percentile(latencies, 0.95)

    @property
    def host_overhead_p50(self) -> float:
        overheads = sorted(e.host_overhead_ms for e in self.evaluations)
        return _percentile(overheads, 0.50)

    @property
    def host_overhead_p95(self) -> float:
        overheads = sorted(e.host_overhead_ms for e in self.evaluations)
        return _percentile(overheads, 0.95)

    @property
    def mean_decision_calls(self) -> float:
        if not self.evaluations:
            return 0.0
        return sum(e.output.decision_calls for e in self.evaluations) / len(
            self.evaluations
        )


def _percentile(sorted_values: list[float], q: float) -> float:
    if not sorted_values:
        return 0.0
    idx = (len(sorted_values) - 1) * q
    low = int(math.floor(idx))
    high = int(math.ceil(idx))
    if low == high:
        return sorted_values[low]
    weight = idx - low
    return sorted_values[low] * (1.0 - weight) + sorted_values[high] * weight


def brier_score(pairs: Sequence[tuple[float, float]]) -> float:
    """Computes the mean squared error (Brier score) for probability pairs."""
    if not pairs:
        return 0.0
    return sum((p - y) ** 2 for p, y in pairs) / len(pairs)


def expected_calibration_error(
    pairs: Sequence[tuple[float, float]], num_bins: int = 10
) -> float:
    """Computes Expected Calibration Error (ECE) across 10 equal bins."""
    if not pairs or num_bins <= 0:
        return 0.0
    bin_size = 1.0 / num_bins
    total = len(pairs)
    ece = 0.0

    for b in range(num_bins):
        low = b * bin_size
        high = (b + 1) * bin_size
        if b == num_bins - 1:
            in_bin = [
                (p, y) for p, y in pairs if low <= p <= high or math.isclose(p, high)
            ]
        else:
            in_bin = [(p, y) for p, y in pairs if low <= p < high]

        if not in_bin:
            continue
        bin_count = len(in_bin)
        avg_conf = sum(p for p, _ in in_bin) / bin_count
        avg_acc = sum(y for _, y in in_bin) / bin_count
        ece += (bin_count / total) * abs(avg_acc - avg_conf)

    return ece


TEMPERATURE_GRID = (
    0.25,
    0.50,
    0.75,
    1.00,
    1.25,
    1.50,
    1.75,
    2.00,
    2.25,
    2.50,
    2.75,
    3.00,
    3.25,
    3.50,
    3.75,
    4.00,
)


def fit_temperature(
    calibration_data: Sequence[tuple[float, float]],
    candidates: Sequence[float] | None = None,
) -> float:
    """Finds temperature T in candidates that minimizes Expected Calibration Error."""
    if not calibration_data:
        return 1.0
    grid = candidates or TEMPERATURE_GRID
    best_temp = 1.0
    best_ece = float("inf")

    for temp in grid:
        if temp <= 0:
            continue
        rescaled: list[tuple[float, float]] = []
        for p, y in calibration_data:
            # Rescale probability through temperature:
            # logit = ln(p / (1 - p)), rescaled = logit / T
            p_clamped = min(max(p, 1e-6), 1.0 - 1e-6)
            logit = math.log(p_clamped / (1.0 - p_clamped))
            scaled_logit = max(min(logit / temp, 30.0), -30.0)
            p_scaled = 1.0 / (1.0 + math.exp(-scaled_logit))
            rescaled.append((p_scaled, y))

        ece = expected_calibration_error(rescaled)
        if ece < best_ece or (math.isclose(ece, best_ece) and temp == 1.0):
            best_ece = ece
            best_temp = temp

    return best_temp


@dataclass
class BenchmarkSummary:
    """Complete summary of a golden plan benchmark run."""

    cases_count: int
    total_runs: int
    family_accuracy: float
    archetype_accuracy: float
    block_precision: float
    block_recall: float
    abstain_rate: float
    decision_latency_p50: float
    decision_latency_p95: float
    host_overhead_p50: float
    host_overhead_p95: float
    decision_calls_mean: float
    brier_family: float
    ece_family: float
    brier_archetype: float
    ece_archetype: float
    brier_gates: float
    ece_gates: float
    fitted_temperature: float | None = None
    case_scores: list[CaseScore] = field(default_factory=list)


def evaluate_single_run(
    case: PlanCase, output: SynthesisOutput, wall_time_ms: float
) -> tuple[CaseEvaluation, list[tuple[str, float, float]]]:
    """Evaluates one synthesis output against case expectations.

    Returns the CaseEvaluation and calibration pairs (kind, prob, correct).
    """
    answers_by_id = {ans.question_id: ans for ans in output.decision_answers}

    # Family accuracy
    observed_family = ""
    family_prob = 1.0
    if "family" in answers_by_id:
        family_choice, family_prob = answers_by_id["family"].top()
        observed_family = family_choice
    elif output.layout_plan:
        observed_family = output.layout_plan.family

    family_correct = observed_family.lower() == case.expected_family.lower()

    # Archetype accuracy
    observed_archetype = ""
    archetype_prob = 1.0
    if output.layout_plan:
        observed_archetype = output.layout_plan.archetype
        arch_ans = answers_by_id.get(f"archetype:{output.layout_plan.family}")
        if arch_ans is not None:
            _, archetype_prob = arch_ans.top()
    elif f"archetype:{observed_family}" in answers_by_id:
        observed_archetype, archetype_prob = answers_by_id[
            f"archetype:{observed_family}"
        ].top()
    else:
        for qid, ans in answers_by_id.items():
            if qid.startswith("archetype:"):
                top_arch, archetype_prob = ans.top()
                observed_archetype = top_arch
                break

    archetype_correct = observed_archetype.lower() in {
        a.lower() for a in case.expected_archetypes
    }

    # Blocks precision & recall
    observed_blocks = set()
    if output.layout_plan:
        observed_blocks = {b.block_id for b in output.layout_plan.blocks}

    required_set = set(case.required_blocks)
    forbidden_set = set(case.forbidden_blocks)

    if required_set:
        recall = len(required_set & observed_blocks) / len(required_set)
        precision = (
            len(required_set & observed_blocks) / len(observed_blocks)
            if observed_blocks
            else 0.0
        )
    else:
        recall = 1.0
        precision = 1.0

    forbidden_count = len(forbidden_set & observed_blocks)
    if forbidden_count > 0:
        precision = max(0.0, precision - (forbidden_count * 0.25))

    # Action gate outcome
    is_blocked = is_action_gate_blocked(output)
    action_gate_outcome = "abstain" if is_blocked else "pass"
    abstained = (
        output.stage is SynthesisStage.ABSTAIN_FALLBACK
        and output.fallback_source is None
    ) or not output.messages

    eval_result = CaseEvaluation(
        output=output,
        wall_time_ms=wall_time_ms,
        family_correct=family_correct,
        archetype_correct=archetype_correct,
        block_precision=precision,
        block_recall=recall,
        forbidden_block_count=forbidden_count,
        action_gate_outcome=action_gate_outcome,
        abstained=abstained,
    )

    # Calibration points: (kind, prob, y)
    cal_points: list[tuple[str, float, float]] = []
    cal_points.append(("family", family_prob, 1.0 if family_correct else 0.0))
    cal_points.append(("archetype", archetype_prob, 1.0 if archetype_correct else 0.0))

    for qid, ans in answers_by_id.items():
        if qid.startswith("gate:"):
            block_id = qid.removeprefix("gate:")
            block_expected = 1.0 if block_id in required_set else 0.0
            cal_points.append(("gate", ans.yes, block_expected))

    return eval_result, cal_points


async def run_case(
    synth: DecisionSynthesizer,
    case: PlanCase,
    *,
    repeat: int = 1,
) -> CaseScore:
    """Executes a decision synthesis case multiple times and scores results."""
    score = CaseScore(case=case, repeats=repeat)

    for _ in range(repeat):
        start = time.perf_counter()
        output = await synth.synthesize(
            case.intent,
            case.payload,
            mutable_paths=case.mutable_paths,
        )
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        evaluation, _ = evaluate_single_run(case, output, elapsed_ms)
        score.evaluations.append(evaluation)

    return score


async def run_benchmark(
    synth: DecisionSynthesizer,
    cases: Sequence[PlanCase],
    *,
    repeat: int = 3,
    fit_temp: bool = False,
) -> BenchmarkSummary:
    """Runs the benchmark across all cases and summarizes accuracy, latency, and calibration."""
    case_scores: list[CaseScore] = []
    all_evaluations: list[CaseEvaluation] = []
    calibration_records: list[tuple[str, float, float]] = []

    for case in cases:
        score = CaseScore(case=case, repeats=repeat)
        for _ in range(repeat):
            start = time.perf_counter()
            output = await synth.synthesize(
                case.intent,
                case.payload,
                mutable_paths=case.mutable_paths,
            )
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            evaluation, cal_points = evaluate_single_run(case, output, elapsed_ms)
            score.evaluations.append(evaluation)
            all_evaluations.append(evaluation)
            calibration_records.extend(cal_points)
        case_scores.append(score)

    total_runs = len(all_evaluations)
    if not total_runs:
        return BenchmarkSummary(
            cases_count=0,
            total_runs=0,
            family_accuracy=0.0,
            archetype_accuracy=0.0,
            block_precision=0.0,
            block_recall=0.0,
            abstain_rate=0.0,
            decision_latency_p50=0.0,
            decision_latency_p95=0.0,
            host_overhead_p50=0.0,
            host_overhead_p95=0.0,
            decision_calls_mean=0.0,
            brier_family=0.0,
            ece_family=0.0,
            brier_archetype=0.0,
            ece_archetype=0.0,
            brier_gates=0.0,
            ece_gates=0.0,
        )

    family_acc = sum(1.0 for e in all_evaluations if e.family_correct) / total_runs
    arch_acc = sum(1.0 for e in all_evaluations if e.archetype_correct) / total_runs
    block_prec = sum(e.block_precision for e in all_evaluations) / total_runs
    block_rec = sum(e.block_recall for e in all_evaluations) / total_runs
    abstain_rate = sum(1.0 for e in all_evaluations if e.abstained) / total_runs

    latencies = sorted(e.output.decision_latency_ms for e in all_evaluations)
    overheads = sorted(e.host_overhead_ms for e in all_evaluations)
    mean_calls = sum(e.output.decision_calls for e in all_evaluations) / total_runs

    family_pairs = [(p, y) for k, p, y in calibration_records if k == "family"]
    arch_pairs = [(p, y) for k, p, y in calibration_records if k == "archetype"]
    gate_pairs = [(p, y) for k, p, y in calibration_records if k == "gate"]

    fitted_t = None
    if fit_temp:
        # Fit temperature over the combined classification & gate predictions
        fitted_t = fit_temperature(family_pairs + arch_pairs + gate_pairs)

    return BenchmarkSummary(
        cases_count=len(cases),
        total_runs=total_runs,
        family_accuracy=family_acc,
        archetype_accuracy=arch_acc,
        block_precision=block_prec,
        block_recall=block_rec,
        abstain_rate=abstain_rate,
        decision_latency_p50=_percentile(latencies, 0.50),
        decision_latency_p95=_percentile(latencies, 0.95),
        host_overhead_p50=_percentile(overheads, 0.50),
        host_overhead_p95=_percentile(overheads, 0.95),
        decision_calls_mean=mean_calls,
        brier_family=brier_score(family_pairs),
        ece_family=expected_calibration_error(family_pairs),
        brier_archetype=brier_score(arch_pairs),
        ece_archetype=expected_calibration_error(arch_pairs),
        brier_gates=brier_score(gate_pairs),
        ece_gates=expected_calibration_error(gate_pairs),
        fitted_temperature=fitted_t,
        case_scores=case_scores,
    )


def render_markdown(summary: BenchmarkSummary, backend_name: str) -> str:
    """Renders a markdown report from the benchmark summary."""
    lines: list[str] = [
        f"## Decision Model Benchmark Summary: `{backend_name}`",
        "",
        (
            f"- **Cases Evaluated**: {summary.cases_count} ({summary.total_runs} total"
            " runs)"
        ),
        f"- **Family Accuracy**: {summary.family_accuracy * 100.0:.1f}%",
        f"- **Archetype Accuracy**: {summary.archetype_accuracy * 100.0:.1f}%",
        f"- **Block Precision**: {summary.block_precision * 100.0:.1f}%",
        f"- **Block Recall**: {summary.block_recall * 100.0:.1f}%",
        f"- **Abstain Rate**: {summary.abstain_rate * 100.0:.1f}%",
        "",
        "### Latency & Overhead",
        "",
        (
            f"- **Decision Latency (p50 / p95)**: {summary.decision_latency_p50:.1f} ms"
            f" / {summary.decision_latency_p95:.1f} ms"
        ),
        (
            f"- **Host Overhead (p50 / p95)**: {summary.host_overhead_p50:.1f} ms /"
            f" {summary.host_overhead_p95:.1f} ms"
        ),
        f"- **Mean Decision Calls**: {summary.decision_calls_mean:.2f}",
        "",
        "### Calibration",
        "",
        "| Question Kind | Brier Score | ECE (10-bin) |",
        "| :--- | :--- | :--- |",
        f"| Family | {summary.brier_family:.4f} | {summary.ece_family:.4f} |",
        f"| Archetype | {summary.brier_archetype:.4f} | {summary.ece_archetype:.4f} |",
        f"| Gates | {summary.brier_gates:.4f} | {summary.ece_gates:.4f} |",
    ]

    if summary.fitted_temperature is not None:
        lines.extend([
            "",
            "### Recommended Temperature",
            "",
            (
                f"Set `A2UI_DECISION_TEMPERATURE={summary.fitted_temperature:.2f}` for"
                " optimal ECE calibration."
            ),
        ])

    lines.extend([
        "",
        "### Case Breakdown",
        "",
        (
            "| Case | Family | Archetype | Recall | Prec | Backend ms | Overhead ms |"
            " Abstain |"
        ),
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ])

    for cs in summary.case_scores:
        fam_mark = "✓" if cs.family_accuracy >= 1.0 else f"{cs.family_accuracy:.0%}"
        arch_mark = (
            "✓" if cs.archetype_accuracy >= 1.0 else f"{cs.archetype_accuracy:.0%}"
        )
        rec_mark = f"{cs.block_recall:.0%}"
        prec_mark = f"{cs.block_precision:.0%}"
        ab_mark = f"{cs.abstain_rate:.0%}"
        lines.append(
            f"| `{cs.case.name}` | {fam_mark} | {arch_mark} | {rec_mark} | {prec_mark}"
            f" | {cs.decision_latency_p50:.1f} | {cs.host_overhead_p50:.1f} |"
            f" {ab_mark} |"
        )

    return "\n".join(lines)
