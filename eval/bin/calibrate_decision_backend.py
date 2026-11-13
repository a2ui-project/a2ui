#!/usr/bin/env python3
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

"""Fits a per-model temperature calibration profile on tuning decision cases.

Ports temperature fitting and risk-controlled Pareto frontier evaluation from
the archived `calibration.py` into an offline CLI tool. Evaluates a named
backend and model on tuning cases from `decision_plans/v1.yaml` (refusing any
cases tagged `heldout` or `split: heldout`) and writes a profile JSON file in
the format `Calibration.load` reads (`{"<backend>/<model>": {"temperature": T}}`).
"""

from __future__ import annotations

import argparse
import asyncio
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import json
from pathlib import Path
import sys
from typing import Any

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import (
    Calibration,
    DecisionSynthesizer,
    SynthesisConfig,
)
from a2ui_eval.decision_bench import (
    TEMPERATURE_GRID,
    CaseEvaluation,
    CaseScore,
    PlanCase,
    brier_score,
    expected_calibration_error,
    fit_temperature,
    load_plan_cases,
    run_benchmark,
)
from a2ui_eval.decision_common import (
    DECISION_CLI_BACKEND_CHOICES,
    build_decision_backend,
)
from a2ui_eval.shared.utils import GIT_ROOT
from dotenv import load_dotenv

load_dotenv()
load_dotenv(Path.home() / ".env")

DEFAULT_CASES_PATH = GIT_ROOT / "eval" / "datasets" / "decision_plans" / "v1.yaml"

_DEFAULT_PARETO_THRESHOLDS: tuple[float, ...] = (
    *(round(0.30 + 0.05 * i, 2) for i in range(14)),
    0.99,
)


@dataclass(frozen=True)
class CalibrationPoint:
    """Coverage, precision, and fallback rate at one confidence threshold.

    Attributes:
        threshold: Minimum confidence score required to accept a layout plan.
        coverage: Fraction of cases accepted at or above `threshold`.
        precision: Fraction of accepted cases with matching family and archetype.
        fallback_rate: Fraction of cases that abstain or fall back (`1 - coverage`).
    """

    threshold: float
    coverage: float
    precision: float
    fallback_rate: float


@dataclass(frozen=True)
class FittedCalibrationReport:
    """Result of fitting a backend calibration profile on tuning cases.

    Attributes:
        backend_kind: Canonical decision backend kind name.
        model_id: Concrete decision model identifier.
        temperature: Fitted temperature scaling factor `T`.
        cases_count: Number of verified tuning cases evaluated.
        raw_ece: Expected Calibration Error before temperature scaling.
        calibrated_ece: Expected Calibration Error after applying `temperature`.
        raw_brier: Mean squared probability error before temperature scaling.
        achieved_precision: Precision at the selected Pareto threshold.
        achieved_coverage: Coverage at the selected Pareto threshold.
        pareto_points: Evaluated `(threshold, coverage, precision, fallback_rate)`
            grid points.
    """

    backend_kind: str
    model_id: str
    temperature: float
    cases_count: int
    raw_ece: float
    calibrated_ece: float
    raw_brier: float
    achieved_precision: float
    achieved_coverage: float
    pareto_points: tuple[CalibrationPoint, ...]


def compute_bayes_optimal_threshold(
    cost_fallback: float, cost_wrong_ui: float
) -> float:
    """Computes the Bayes-optimal confidence threshold clamped to `[0.0, 1.0]`.

    Args:
        cost_fallback: Non-negative cost of abstaining or falling back.
        cost_wrong_ui: Strictly positive cost of rendering an incorrect layout.

    Returns:
        Minimum confidence threshold `1 - (cost_fallback / cost_wrong_ui)`
        clamped to `[0.0, 1.0]`.

    Raises:
        ValueError: If `cost_fallback < 0` or `cost_wrong_ui <= 0`.
    """
    if cost_fallback < 0:
        raise ValueError("cost_fallback must be non-negative.")
    if cost_wrong_ui <= 0:
        raise ValueError("cost_wrong_ui must be strictly positive.")
    return max(0.0, min(1.0, 1.0 - (cost_fallback / cost_wrong_ui)))


def _evaluate_pareto_threshold(
    evaluations: Sequence[CaseEvaluation], threshold: float
) -> CalibrationPoint:
    """Computes coverage, precision, and fallback rate at `threshold`.

    Args:
        evaluations: Sequence of per-case benchmark evaluations.
        threshold: Minimum confidence required to accept a synthesis output.

    Returns:
        `CalibrationPoint` summarizing coverage and precision at `threshold`.
    """
    if not evaluations:
        return CalibrationPoint(
            threshold=threshold, coverage=0.0, precision=1.0, fallback_rate=1.0
        )
    accepted = [
        ev
        for ev in evaluations
        if not ev.abstained
        and not ev.used_fallback
        and ev.output.confidence >= threshold
    ]
    accepted_count = len(accepted)
    correct_count = sum(
        1 for ev in accepted if ev.family_correct and ev.archetype_correct
    )
    coverage = accepted_count / len(evaluations)
    precision = correct_count / accepted_count if accepted_count > 0 else 1.0
    return CalibrationPoint(
        threshold=threshold,
        coverage=coverage,
        precision=precision,
        fallback_rate=1.0 - coverage,
    )


def _select_best_pareto_point(
    points: Sequence[CalibrationPoint], target_precision: float
) -> CalibrationPoint:
    """Selects the Pareto-optimal calibration point for `target_precision`.

    Args:
        points: Candidate `CalibrationPoint` entries across thresholds.
        target_precision: Minimum acceptable precision on accepted plans.

    Returns:
        Feasible point with highest coverage (breaking ties toward lower
        threshold), or highest-precision point if none reach `target_precision`.
    """
    feasible = [p for p in points if p.precision >= target_precision]
    if feasible:
        return max(feasible, key=lambda p: (p.coverage, -p.threshold))
    return max(points, key=lambda p: (p.precision, p.threshold))


def validate_tuning_cases(cases: Sequence[PlanCase]) -> None:
    """Raises `ValueError` if `cases` is empty or contains any held-out case.

    Args:
        cases: Sequence of loaded `PlanCase` definitions to validate.

    Raises:
        ValueError: If `cases` is empty or includes any held-out case.
    """
    if not cases:
        raise ValueError("Calibration tuning dataset must not be empty.")
    # Guard against leaking held-out test cases into temperature calibration.
    heldout_names = [c.name for c in cases if c.is_heldout]
    if heldout_names:
        joined = ", ".join(heldout_names)
        raise ValueError(f"Refusing to fit calibration on held-out cases: {joined}.")


def load_tuning_cases(
    cases_path: str | Path,
    *,
    tags: Sequence[str] | str | None = None,
    split: str | None = None,
    schema_path: str | Path | None = None,
) -> list[PlanCase]:
    """Loads verified tuning cases, refusing any non-tuning split or held-out tag.

    Args:
        cases_path: Path to a tuning YAML file or `decision_plans` directory.
        tags: Optional tag sequence or comma-separated tag filter string.
        split: Optional dataset split name (defaults to `'tuning'`).
        schema_path: Optional override path to `decision_plans/schema.json`.

    Returns:
        List of verified tuning `PlanCase` instances.

    Raises:
        ValueError: If `split` is not `'tuning'`, if `tags` requests `'heldout'`,
            or if the resulting case list is empty or contains held-out cases.
    """
    # Default to the tuning split so directory paths never load heldout_v1.yaml.
    effective_split = "tuning" if split is None else split.strip().lower()
    if effective_split != "tuning":
        raise ValueError(
            f"Refusing to fit calibration on '{split}' split; only 'tuning' is allowed."
        )
    if isinstance(tags, str):
        tag_tokens = {t.strip().lower() for t in tags.split(",") if t.strip()}
    elif tags:
        tag_tokens = {str(t).strip().lower() for t in tags}
    else:
        tag_tokens = set()
    if "heldout" in tag_tokens or "split:heldout" in tag_tokens:
        raise ValueError("Refusing to fit calibration on 'heldout' tag.")

    loaded = load_plan_cases(
        cases_path,
        tags=tags,
        split=effective_split if Path(cases_path).is_dir() else None,
        include_unverified=False,
        schema_path=schema_path,
    )
    validate_tuning_cases(loaded)
    return loaded


def _case_calibration_pairs(
    case: PlanCase, ev: CaseEvaluation
) -> list[tuple[float, float]]:
    """Extracts `(probability, is_correct)` pairs from a single case evaluation.

    Args:
        case: Ground-truth `PlanCase` definition.
        ev: Evaluated `CaseEvaluation` for `case`.

    Returns:
        List of `(probability, label)` pairs for family, in-grammar archetype,
        and block gate questions.
    """
    pairs: list[tuple[float, float]] = []
    answers_by_id = {a.question_id: a for a in ev.output.decision_answers}
    if "family" in answers_by_id:
        _, fam_p = answers_by_id["family"].top()
        pairs.append((fam_p, float(ev.family_correct)))

    # Only include archetype calibration points for in-grammar cases that
    # produced a layout plan; out-of-grammar abstentions never score an archetype.
    if not case.is_out_of_grammar and ev.output.layout_plan is not None:
        arch_ans = answers_by_id.get(f"archetype:{ev.output.layout_plan.family}")
        arch_p = arch_ans.top()[1] if arch_ans is not None else ev.output.confidence
        pairs.append((arch_p, float(ev.archetype_correct)))

    req_blocks = set(case.required_blocks)
    forb_blocks = set(case.forbidden_blocks)
    for qid, ans in answers_by_id.items():
        if qid.startswith("gate:"):
            b_id = qid.removeprefix("gate:")
            if b_id in req_blocks:
                pairs.append((ans.yes, 1.0))
            elif b_id in forb_blocks:
                pairs.append((ans.yes, 0.0))
    return pairs


def _collect_calibration_pairs(
    case_scores: Sequence[CaseScore],
) -> list[tuple[float, float]]:
    """Extracts `(probability, is_correct)` pairs across family, archetype, and gates.

    Args:
        case_scores: Sequence of per-case benchmark scores.

    Returns:
        Flattened list of `(probability, label)` calibration pairs.
    """
    pairs: list[tuple[float, float]] = []
    for cs in case_scores:
        if cs.evaluations:
            pairs.extend(_case_calibration_pairs(cs.case, cs.evaluations[0]))
    return pairs


def _rescale_pairs(
    pairs: Sequence[tuple[float, float]], temperature: float
) -> list[tuple[float, float]]:
    """Applies `Calibration(temperature)` to `(probability, target)` pairs.

    Args:
        pairs: Uncalibrated `(probability, label)` pairs.
        temperature: Positive temperature scaling factor `T`.

    Returns:
        List of temperature-scaled `(probability, label)` pairs.
    """
    cal = Calibration(temperature=temperature)
    rescaled: list[tuple[float, float]] = []
    for p, y in pairs:
        p_clamped = min(max(p, 1e-6), 1.0 - 1e-6)
        scaled = cal.apply({"pos": p_clamped, "neg": 1.0 - p_clamped})
        rescaled.append((scaled["pos"], y))
    return rescaled


async def fit_backend_calibration(
    synth: DecisionSynthesizer,
    cases: Sequence[PlanCase],
    *,
    target_precision: float = 0.95,
    temperature_candidates: Sequence[float] | None = None,
    thresholds: Sequence[float] | None = None,
) -> FittedCalibrationReport:
    """Evaluates `synth` on `cases` and fits temperature `T` minimizing ECE.

    Args:
        synth: Configured `DecisionSynthesizer` to evaluate.
        cases: Verified tuning `PlanCase` definitions.
        target_precision: Target precision for Pareto threshold selection.
        temperature_candidates: Optional grid of candidate temperatures `T`.
        thresholds: Optional grid of confidence thresholds for Pareto analysis.

    Returns:
        `FittedCalibrationReport` containing the fitted temperature and metrics.

    Raises:
        ValueError: If `cases` contains held-out cases or `target_precision` is
            outside `(0.0, 1.0]`.
    """
    validate_tuning_cases(cases)
    if not 0.0 < target_precision <= 1.0:
        raise ValueError("target_precision must be in (0.0, 1.0].")

    summary = await run_benchmark(synth, cases, repeat=1, fit_temp=False)
    evaluations = [cs.evaluations[0] for cs in summary.case_scores if cs.evaluations]
    pairs = _collect_calibration_pairs(summary.case_scores)
    fitted_t = fit_temperature(
        pairs, candidates=temperature_candidates or TEMPERATURE_GRID
    )

    raw_ece = expected_calibration_error(pairs)
    cal_ece = expected_calibration_error(_rescale_pairs(pairs, fitted_t))
    raw_brier = brier_score(pairs)

    cand_thresholds = (
        thresholds if thresholds is not None else _DEFAULT_PARETO_THRESHOLDS
    )
    points = tuple(
        _evaluate_pareto_threshold(evaluations, float(tau)) for tau in cand_thresholds
    )
    best_point = _select_best_pareto_point(points, target_precision)

    return FittedCalibrationReport(
        backend_kind=synth.backend.backend_kind,
        model_id=synth.backend.model_id,
        temperature=fitted_t,
        cases_count=len(cases),
        raw_ece=raw_ece,
        calibrated_ece=cal_ece,
        raw_brier=raw_brier,
        achieved_precision=best_point.precision,
        achieved_coverage=best_point.coverage,
        pareto_points=points,
    )


def write_calibration_profile(
    out_path: str | Path,
    *,
    backend_kind: str,
    model_id: str,
    temperature: float,
) -> Calibration:
    """Writes or updates `backend_kind/model_id` in `out_path` and verifies loading.

    Args:
        out_path: Destination JSON file path for the calibration profile.
        backend_kind: Canonical decision backend kind name.
        model_id: Concrete decision model identifier.
        temperature: Fitted temperature scaling factor `T`.

    Returns:
        Reloaded `Calibration` instance verified via `Calibration.load`.

    Raises:
        ValueError: If an existing file at `out_path` does not contain a JSON
            object.
    """
    target = Path(out_path)
    existing: dict[str, Any] = {}
    if target.is_file():
        loaded = json.loads(target.read_text(encoding="utf-8"))
        if not isinstance(loaded, Mapping):
            raise ValueError(
                f"Existing calibration file {target} must hold a JSON object."
            )
        existing = dict(loaded)

    existing[f"{backend_kind}/{model_id}"] = {"temperature": float(temperature)}
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(existing, indent=2) + "\n", encoding="utf-8")
    return Calibration.load(target, backend_kind=backend_kind, model_id=model_id)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parses command-line arguments for `calibrate_decision_backend`.

    Args:
        argv: Optional list of CLI argument tokens.

    Returns:
        Parsed `argparse.Namespace` configuration.
    """
    parser = argparse.ArgumentParser(
        description=(
            "Fit a temperature calibration profile on tuning cases of"
            " decision_plans/v1.yaml."
        ),
    )
    parser.add_argument(
        "--backend",
        required=True,
        choices=list(DECISION_CLI_BACKEND_CHOICES),
        help="Decision backend kind (mock, jev, gemini, systemone, or step0).",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="Model identifier for the backend (defaults to backend's pinned model).",
    )
    parser.add_argument(
        "--endpoint-url",
        type=str,
        default=None,
        help="Optional endpoint URL for HTTP decision backends.",
    )
    parser.add_argument(
        "--cases",
        type=str,
        default=str(DEFAULT_CASES_PATH),
        help=(
            "Path to tuning plan cases YAML (default:"
            " eval/datasets/decision_plans/v1.yaml)."
        ),
    )
    parser.add_argument(
        "--split",
        type=str,
        default=None,
        help=(
            "Optional dataset split filter (defaults to 'tuning'; 'heldout' is"
            " refused)."
        ),
    )
    parser.add_argument(
        "--tags",
        type=str,
        default=None,
        help="Optional comma-separated filter tags ('heldout' is refused).",
    )
    parser.add_argument(
        "--target-precision",
        type=float,
        default=0.95,
        help="Target precision for Pareto diagnostics (default: 0.95).",
    )
    parser.add_argument(
        "--out",
        required=True,
        type=str,
        help="Output path for the calibration profile JSON file.",
    )
    return parser.parse_args(argv)


async def _async_main(args: argparse.Namespace) -> int:
    """Runs async calibration fitting and writes the resulting JSON profile.

    Args:
        args: Parsed CLI arguments.

    Returns:
        Process exit code (`0` on success).
    """
    cases_path = Path(args.cases)
    if not cases_path.is_absolute():
        cases_path = GIT_ROOT / cases_path

    cases = load_tuning_cases(
        cases_path,
        tags=args.tags,
        split=args.split,
    )
    backend = build_decision_backend(
        args.backend,
        endpoint_url=args.endpoint_url,
        model=args.model,
        calibration=Calibration(temperature=1.0),
    )
    synth = DecisionSynthesizer(
        [BasicCatalog("v1.0")],
        backend,
        config=SynthesisConfig(),
    )
    try:
        report = await fit_backend_calibration(
            synth,
            cases,
            target_precision=args.target_precision,
        )
    finally:
        await backend.aclose()

    verified = write_calibration_profile(
        args.out,
        backend_kind=report.backend_kind,
        model_id=report.model_id,
        temperature=report.temperature,
    )
    print(
        f"Wrote calibration profile {report.backend_kind}/{report.model_id}"
        f" (temperature={verified.temperature:.2f}, raw_ece={report.raw_ece:.4f},"
        f" calibrated_ece={report.calibrated_ece:.4f}, cases={report.cases_count})"
        f" to {args.out}"
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint for `calibrate_decision_backend`.

    Args:
        argv: Optional list of CLI argument tokens.

    Returns:
        Process exit code (`0` on success, `1` on error).
    """
    args = parse_args(argv)
    try:
        return asyncio.run(_async_main(args))
    except (ValueError, RuntimeError, FileNotFoundError) as exc:
        sys.stderr.write(f"Error: {exc}\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
