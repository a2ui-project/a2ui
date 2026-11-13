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

"""Multi-backend Wave 6 scorecard generator for A2UI decision models."""

from __future__ import annotations

import argparse
import asyncio
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
import json
from pathlib import Path
import sys
from typing import Any

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import (
    DecisionBackend,
    DecisionSynthesizer,
    SynthesisConfig,
)
from a2ui_eval.decision_bench import (
    BenchmarkSummary,
    ParaphraseComparison,
    PlanCase,
    TemplateArmComparison,
    load_plan_cases,
    render_paraphrase_markdown,
    render_template_arm_markdown,
    run_benchmark,
    run_paraphrase_benchmark,
    run_template_arm_benchmark,
    serialize_benchmark_summary,
)
from a2ui_eval.decision_common import (
    DECISION_CLI_BACKEND_CHOICES,
    FALSE_NO_FIT_TARGET,
    FORCED_FIT_TARGET,
    build_decision_backend,
    p95_target_for_backend,
)
from a2ui_eval.shared.utils import GIT_ROOT
from dotenv import load_dotenv
import yaml

load_dotenv()
load_dotenv(Path.home() / ".env")

DEFAULT_DATASET_DIR = GIT_ROOT / "eval" / "datasets" / "decision_plans"


@dataclass(frozen=True)
class ScorecardTargetSpec:
    """Stores configuration for one backend entry in a scorecard run.

    Attributes:
        backend: Backend kind (`mock`, `openrouter`, `gemini`, `http`, or `litert`).
        model: Model identifier or `.litertlm` file path.
        label: Optional display label override for scorecard rows.
        endpoint_url: Optional endpoint URL for `http` or `openrouter` backends.
        calibration: Optional path to a calibration profile JSON file.
        p95_target_ms: Optional P95 decision latency target override in milliseconds.
    """

    backend: str
    model: str
    label: str | None = None
    endpoint_url: str | None = None
    calibration: str | None = None
    p95_target_ms: float | None = None

    @property
    def display_name(self) -> str:
        """Returns the human-readable backend display label."""
        return self.label or f"{self.backend}/{self.model}"

    @property
    def target_ms(self) -> float:
        """Returns the effective P95 latency target in milliseconds."""
        if self.p95_target_ms is not None:
            return float(self.p95_target_ms)
        return p95_target_for_backend(self.backend)

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> ScorecardTargetSpec:
        """Constructs a `ScorecardTargetSpec` from a raw YAML backend mapping.

        Args:
            data: Raw dictionary parsed from a scorecard configuration YAML file.

        Returns:
            A validated `ScorecardTargetSpec` instance.
        """
        backend = str(data["backend"]).strip().lower()
        model = str(data.get("model") or backend).strip()
        raw_target = data.get("p95_target_ms")
        return cls(
            backend=backend,
            model=model,
            label=str(data["name"]) if data.get("name") else None,
            endpoint_url=(
                str(data["endpoint_url"])
                if data.get("endpoint_url") is not None
                else None
            ),
            calibration=(
                str(data["calibration"])
                if data.get("calibration") is not None
                else None
            ),
            p95_target_ms=float(raw_target) if raw_target is not None else None,
        )


@dataclass
class ScorecardRow:
    """Stores the evaluated summary and target pass/fail status for one backend on one split.

    Attributes:
        spec: Backend target specification.
        summary: Primary benchmark summary for the split.
        paraphrase: Optional paraphrase sensitivity comparison.
        template_arm: Optional promoted template arm comparison.
    """

    spec: ScorecardTargetSpec
    summary: BenchmarkSummary
    paraphrase: ParaphraseComparison | None = None
    template_arm: TemplateArmComparison | None = None

    @property
    def latency_target_pass(self) -> bool:
        """Returns whether P95 decision latency meets `self.spec.target_ms`."""
        return self.summary.p95_latency_ms <= self.spec.target_ms

    @property
    def rates_target_pass(self) -> bool:
        """Returns whether forced-fit, false no-fit, and sensitive leak rates meet targets."""
        return (
            self.summary.forced_fit_rate <= FORCED_FIT_TARGET
            and self.summary.false_no_fit_rate <= FALSE_NO_FIT_TARGET
            and self.summary.sensitive_leak_rate == 0.0
        )

    @property
    def overall_target_pass(self) -> bool:
        """Returns whether both latency and error-rate targets pass."""
        return self.latency_target_pass and self.rates_target_pass


@dataclass
class ScorecardReport:
    """Stores the multi-backend scorecard report grouped by split.

    Attributes:
        rows_by_split: Mapping from split name (`tuning`, `heldout`) to evaluated rows.
        skipped_backends: List of `(display_name, reason)` pairs for skipped backends.
    """

    rows_by_split: dict[str, list[ScorecardRow]] = field(default_factory=dict)
    skipped_backends: list[tuple[str, str]] = field(default_factory=list)


def load_scorecard_config(config_path: str | Path) -> list[ScorecardTargetSpec]:
    """Loads `ScorecardTargetSpec` entries from a YAML scorecard config file.

    Args:
        config_path: Path to the YAML configuration file.

    Returns:
        List of parsed `ScorecardTargetSpec` entries.

    Raises:
        ValueError: If the YAML file is malformed or defines no backends.
    """
    path = Path(config_path)
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if isinstance(raw, Sequence) and not isinstance(raw, (str, bytes)):
        entries = raw
    elif isinstance(raw, Mapping):
        entries = raw.get("backends") or []
    else:
        raise ValueError(f"Scorecard config {path} must be a mapping or list.")
    specs = [
        ScorecardTargetSpec.from_dict(item)
        for item in entries
        if isinstance(item, Mapping)
    ]
    if not specs:
        raise ValueError(f"Scorecard config {path} defines no backends.")
    return specs


def ensure_mock_baseline(
    specs: Sequence[ScorecardTargetSpec],
) -> list[ScorecardTargetSpec]:
    """Appends the `mock/mock` baseline when no `mock` entry is present.

    Args:
        specs: Initial sequence of `ScorecardTargetSpec` entries.

    Returns:
        A list of `ScorecardTargetSpec` entries guaranteed to include a `mock` baseline.
    """
    ordered = list(specs)
    if not any(s.backend == "mock" for s in ordered):
        ordered.append(
            ScorecardTargetSpec(
                backend="mock",
                model="mock",
                label="mock/mock (baseline)",
                p95_target_ms=p95_target_for_backend("mock"),
            )
        )
    return ordered


def _parse_spec_token(token: str) -> ScorecardTargetSpec:
    """Parses `<backend>:<model>[@<endpoint_url>]` into `ScorecardTargetSpec`."""
    head, _, url = token.partition("@")
    backend, sep, model = head.partition(":")
    clean_backend = backend.strip().lower()
    if not sep or not model.strip():
        raise ValueError(
            f"Invalid --spec {token!r}; expected '<backend>:<model>[@<url>]'."
        )
    return ScorecardTargetSpec(
        backend=clean_backend,
        model=model.strip(),
        endpoint_url=url.strip() or None,
    )


def _format_scorecard_row(row: ScorecardRow) -> str:
    """Formats one Markdown table row in the scorecard."""
    s = row.summary
    status = "pass" if row.overall_target_pass else "FAIL"
    return (
        f"| `{row.spec.display_name}` | `{s.model_id}` | {s.cases_count} |"
        f" {s.family_accuracy * 100.0:.1f}% | {s.archetype_accuracy * 100.0:.1f}% |"
        f" {s.forced_fit_rate * 100.0:.1f}% | {s.false_no_fit_rate * 100.0:.1f}% |"
        f" {s.slot_binding_accuracy * 100.0:.1f}% | {s.action_accuracy * 100.0:.1f}% |"
        f" {s.sensitive_leak_rate * 100.0:.1f}% | {s.mean_round_trips:.2f} |"
        f" {s.multi_turn_cache_hit_rate * 100.0:.1f}% | {s.fallback_rate * 100.0:.1f}%"
        f" | {s.p50_latency_ms:.1f} | {s.p95_latency_ms:.1f} | <"
        f" {row.spec.target_ms:.0f} ms | {status} |"
    )


def _render_split_section(split_name: str, rows: Sequence[ScorecardRow]) -> str:
    """Renders the Markdown scorecard section for one dataset split."""
    lines: list[str] = [f"## Split: `{split_name}`", ""]
    unverified = max((r.summary.unverified_count for r in rows), default=0)
    total_cases = max((r.summary.cases_count for r in rows), default=0)
    if unverified > 0:
        lines.extend([
            (
                f"> **[UNFROZEN HELDOUT]** {unverified} of {total_cases}"
                " evaluated cases have `verified: false` (pending human label"
                " review)."
            ),
            "",
        ])
    lines.extend([
        (
            "Targets: forced-fit rate"
            f" <= {FORCED_FIT_TARGET * 100.0:.0f}%, false no-fit rate"
            f" <= {FALSE_NO_FIT_TARGET * 100.0:.0f}%, sensitive leak rate = 0%,"
            " hosted reference P95 < 250 ms."
        ),
        "",
        (
            "| Backend | Model | Cases | Family Acc | Archetype Acc |"
            " Forced-Fit (<=5%) | False No-Fit (<=10%) | Slot Bind | Action Acc |"
            " Sens Leak | Round Trips | Cache Hit | Fallback | P50 (ms) |"
            " P95 (ms) | P95 Target | Target Pass |"
        ),
        (
            "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |"
            " :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |"
        ),
        *(_format_scorecard_row(r) for r in rows),
    ])
    for row in rows:
        if row.paraphrase is not None:
            lines.extend([
                "",
                f"#### `{row.spec.display_name}` paraphrase check",
                "",
                render_paraphrase_markdown(row.paraphrase),
            ])
        if row.template_arm is not None and row.template_arm.tool_cases_count > 0:
            lines.extend([
                "",
                f"#### `{row.spec.display_name}` template arm",
                "",
                render_template_arm_markdown(row.template_arm),
            ])
    return "\n".join(lines)


def render_scorecard_markdown(report: ScorecardReport) -> str:
    """Renders the complete multi-backend Wave 6 Markdown scorecard.

    Args:
        report: `ScorecardReport` holding evaluated rows and skipped backends.

    Returns:
        Formatted Markdown scorecard document ending with a newline.
    """
    lines: list[str] = ["# A2UI Decision Model Scorecard", ""]
    for split_name, rows in report.rows_by_split.items():
        lines.append(_render_split_section(split_name, rows))
        lines.append("")
    if report.skipped_backends:
        lines.extend(["## Skipped backends", ""])
        for name, reason in report.skipped_backends:
            lines.append(f"- `{name}`: {reason}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


async def evaluate_backend_on_splits(
    spec: ScorecardTargetSpec,
    backend: DecisionBackend,
    split_groups: Sequence[tuple[str, Sequence[PlanCase]]],
    *,
    repeat: int = 1,
    paraphrase: bool = False,
    template_arm: bool = False,
) -> dict[str, ScorecardRow]:
    """Runs `backend` across every `(split_name, cases)` group.

    Args:
        spec: Target specification for `backend`.
        backend: Initialized `DecisionBackend` instance.
        split_groups: Sequence of `(split_name, cases)` pairs to evaluate.
        repeat: Number of repeat runs per case.
        paraphrase: Whether to include a paraphrase sensitivity check.
        template_arm: Whether to include a promoted template arm comparison.

    Returns:
        Mapping from `split_name` to the evaluated `ScorecardRow`.
    """
    synth = DecisionSynthesizer(
        [BasicCatalog("v1.0")],
        backend,
        config=SynthesisConfig(),
    )
    results: dict[str, ScorecardRow] = {}
    for split_name, cases in split_groups:
        summary = await run_benchmark(
            synth, cases, repeat=repeat, split_name=split_name
        )
        para = (
            await run_paraphrase_benchmark(
                synth,
                cases,
                repeat=repeat,
                split_name=split_name,
                baseline=summary,
            )
            if paraphrase
            else None
        )
        tpl = (
            await run_template_arm_benchmark(
                synth, cases, repeat=repeat, split_name=split_name
            )
            if template_arm
            else None
        )
        results[split_name] = ScorecardRow(
            spec=spec,
            summary=summary,
            paraphrase=para,
            template_arm=tpl,
        )
    return results


async def _run_single_scorecard_spec(
    spec: ScorecardTargetSpec,
    split_groups: Sequence[tuple[str, Sequence[PlanCase]]],
    *,
    repeat: int,
    paraphrase: bool,
    template_arm: bool,
    strict: bool,
) -> tuple[dict[str, ScorecardRow] | None, tuple[str, str] | None]:
    """Builds and evaluates one `ScorecardTargetSpec`, returning `(rows, skipped)`."""
    cal_path = Path(spec.calibration) if spec.calibration else None
    try:
        backend = build_decision_backend(
            spec.backend,
            endpoint_url=spec.endpoint_url,
            model=spec.model,
            calibration=cal_path,
        )
    except ValueError as exc:
        if strict:
            raise
        return None, (spec.display_name, str(exc))

    try:
        rows = await evaluate_backend_on_splits(
            spec,
            backend,
            split_groups,
            repeat=repeat,
            paraphrase=paraphrase,
            template_arm=template_arm,
        )
        return rows, None
    except Exception as exc:
        if strict:
            raise
        return None, (spec.display_name, str(exc))
    finally:
        await backend.aclose()


async def run_scorecard(
    specs: Sequence[ScorecardTargetSpec],
    split_groups: Sequence[tuple[str, Sequence[PlanCase]]],
    *,
    repeat: int = 1,
    paraphrase: bool = False,
    template_arm: bool = False,
    strict: bool = False,
) -> ScorecardReport:
    """Builds and benchmarks every configured backend.

    Args:
        specs: Backend specifications to evaluate.
        split_groups: Sequence of `(split_name, cases)` pairs to evaluate.
        repeat: Number of repeat runs per case.
        paraphrase: Whether to include paraphrase sensitivity checks.
        template_arm: Whether to include promoted template arm comparisons.
        strict: Whether to re-raise backend credential or execution errors.

    Returns:
        Completed `ScorecardReport` across all splits and backends.
    """
    all_specs = list(specs) or ensure_mock_baseline(())
    rows_by_split: dict[str, list[ScorecardRow]] = {
        name: [] for name, _ in split_groups
    }
    skipped: list[tuple[str, str]] = []

    for spec in all_specs:
        per_split, skip_entry = await _run_single_scorecard_spec(
            spec,
            split_groups,
            repeat=repeat,
            paraphrase=paraphrase,
            template_arm=template_arm,
            strict=strict,
        )
        if skip_entry is not None:
            skipped.append(skip_entry)
        elif per_split is not None:
            for split_name, row in per_split.items():
                rows_by_split[split_name].append(row)

    return ScorecardReport(rows_by_split=rows_by_split, skipped_backends=skipped)


def _load_split_groups(
    cases_path: Path, split: str, tags: str | None, include_unverified: bool
) -> list[tuple[str, list[PlanCase]]]:
    """Loads `(split_name, cases)` groups for scorecard evaluation."""
    if split == "tuning":
        return [(
            "tuning",
            load_plan_cases(
                cases_path,
                tags=tags,
                split="tuning",
                include_unverified=include_unverified,
            ),
        )]
    if split == "heldout":
        return [(
            "heldout",
            load_plan_cases(
                cases_path,
                tags=tags,
                split="heldout",
                include_unverified=True,
            ),
        )]
    groups: list[tuple[str, list[PlanCase]]] = []
    tuning = load_plan_cases(
        cases_path,
        tags=tags,
        split="tuning",
        include_unverified=include_unverified,
    )
    heldout = load_plan_cases(
        cases_path, tags=tags, split="heldout", include_unverified=True
    )
    if tuning:
        groups.append(("tuning", tuning))
    if heldout:
        groups.append(("heldout", heldout))
    return groups


def _resolve_target_specs(args: argparse.Namespace) -> list[ScorecardTargetSpec]:
    """Builds `ScorecardTargetSpec` list from `--config`, `--spec`, or `--backend`."""
    specs: list[ScorecardTargetSpec] = []
    if args.config:
        specs.extend(load_scorecard_config(args.config))
    for tok in args.spec or []:
        specs.append(_parse_spec_token(tok))
    if args.backend:
        if not args.model:
            raise ValueError("--model is required when --backend is provided.")
        specs.append(
            ScorecardTargetSpec(
                backend=args.backend,
                model=args.model,
                endpoint_url=args.endpoint_url,
                calibration=args.calibration,
                p95_target_ms=args.p95_target_ms,
            )
        )
    return specs or ensure_mock_baseline(())


def serialize_scorecard_report(report: ScorecardReport) -> dict[str, Any]:
    """Serializes `report` into a JSON-compatible dictionary.

    Args:
        report: `ScorecardReport` to serialize.

    Returns:
        JSON-serializable dictionary of splits and skipped backends.
    """
    return {
        "splits": {
            split_name: [
                {
                    "display_name": row.spec.display_name,
                    "p95_target_ms": row.spec.target_ms,
                    "latency_target_pass": row.latency_target_pass,
                    "rates_target_pass": row.rates_target_pass,
                    "overall_target_pass": row.overall_target_pass,
                    "summary": serialize_benchmark_summary(row.summary),
                }
                for row in rows
            ]
            for split_name, rows in report.rows_by_split.items()
        },
        "skipped_backends": [
            {"backend": name, "reason": reason}
            for name, reason in report.skipped_backends
        ],
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """Parses command-line arguments for `decision_scorecard.py`.

    Args:
        argv: Optional argument list; defaults to `sys.argv[1:]`.

    Returns:
        Parsed `argparse.Namespace`.
    """
    parser = argparse.ArgumentParser(
        description="Run multi-backend decision scorecard and emit Markdown table.",
    )
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="Optional YAML file listing backends and P95 latency targets.",
    )
    parser.add_argument(
        "--spec",
        action="append",
        default=[],
        help="Repeatable backend spec '<backend>:<model>[@<endpoint_url>]'.",
    )
    parser.add_argument(
        "--backend",
        choices=list(DECISION_CLI_BACKEND_CHOICES),
        default=None,
        help="Optional single backend to include alongside mock baseline.",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=None,
        help="Model identifier for --backend.",
    )
    parser.add_argument(
        "--endpoint-url",
        type=str,
        default=None,
        help="Optional endpoint URL for --backend.",
    )
    parser.add_argument(
        "--calibration",
        type=str,
        default=None,
        help="Optional calibration profile JSON path for --backend.",
    )
    parser.add_argument(
        "--p95-target-ms",
        type=float,
        default=None,
        help="Optional P95 latency target override in milliseconds.",
    )
    parser.add_argument(
        "--dataset",
        "--cases",
        type=str,
        default=str(DEFAULT_DATASET_DIR),
        dest="cases",
        help="Path to dataset directory or YAML file.",
    )
    parser.add_argument(
        "--split",
        choices=["tuning", "heldout", "all"],
        default="all",
        help="Dataset split to score: tuning, heldout, or all (default: all).",
    )
    parser.add_argument(
        "--tags",
        type=str,
        default=None,
        help="Optional comma-separated tag filter.",
    )
    parser.add_argument(
        "--repeat",
        type=int,
        default=1,
        help="Number of repeats per case (default: 1).",
    )
    parser.add_argument(
        "--include-unverified",
        action="store_true",
        help="Include unverified cases on tuning split.",
    )
    parser.add_argument(
        "--paraphrase",
        action="store_true",
        help="Include paraphrase sensitivity section per backend.",
    )
    parser.add_argument(
        "--template-arm",
        action="store_true",
        help="Include tool-mode promoted template arm section per backend.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail immediately if any configured backend lacks credentials or fails.",
    )
    parser.add_argument(
        "--out",
        type=str,
        default=None,
        help="Optional path to write Markdown scorecard.",
    )
    parser.add_argument(
        "--json",
        type=str,
        default=None,
        dest="json_path",
        help="Optional path to write JSON scorecard summary.",
    )
    return parser.parse_args(list(argv) if argv is not None else None)


async def _async_main(args: argparse.Namespace) -> int:
    """Executes the scorecard workflow asynchronously and writes outputs."""
    cases_path = Path(args.cases)
    if not cases_path.is_absolute():
        cases_path = GIT_ROOT / cases_path

    try:
        specs = _resolve_target_specs(args)
        split_groups = _load_split_groups(
            cases_path, args.split, args.tags, args.include_unverified
        )
        if not split_groups:
            sys.stderr.write(f"No cases found in {cases_path}\n")
            return 1
        report = await run_scorecard(
            specs,
            split_groups,
            repeat=args.repeat,
            paraphrase=args.paraphrase,
            template_arm=args.template_arm,
            strict=args.strict,
        )
    except (FileNotFoundError, RuntimeError, ValueError) as exc:
        sys.stderr.write(f"Scorecard failed: {exc}\n")
        return 1

    md = render_scorecard_markdown(report)
    if args.out:
        out_file = Path(args.out)
        out_file.parent.mkdir(parents=True, exist_ok=True)
        out_file.write_text(md, encoding="utf-8")
    else:
        print(md, end="")

    if args.json_path:
        json_file = Path(args.json_path)
        json_file.parent.mkdir(parents=True, exist_ok=True)
        json_file.write_text(
            json.dumps(serialize_scorecard_report(report), indent=2) + "\n",
            encoding="utf-8",
        )
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    """Runs the CLI entrypoint for `decision_scorecard.py`."""
    args = parse_args(argv)
    return asyncio.run(_async_main(args))


if __name__ == "__main__":
    sys.exit(main())
