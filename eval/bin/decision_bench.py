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

"""CLI tool for benchmarking A2UI decision models against golden plans."""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
import json
from pathlib import Path
import sys
from typing import Any

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import (
    DecisionSynthesizer,
    DeterministicMockBackend,
    SynthesisConfig,
)
from a2ui_eval.decision_bench import (
    BenchmarkSummary,
    ParaphraseComparison,
    PlanCase,
    TemplateArmComparison,
    load_plan_cases,
    render_markdown,
    render_paraphrase_markdown,
    render_template_arm_markdown,
    run_benchmark,
    run_paraphrase_benchmark,
    run_template_arm_benchmark,
    serialize_benchmark_summary,
)
from a2ui_eval.decision_common import (
    DECISION_CLI_BACKEND_CHOICES,
    build_decision_backend,
)
from a2ui_eval.shared.utils import GIT_ROOT
from dotenv import load_dotenv

load_dotenv()
load_dotenv(Path.home() / ".env")

DEFAULT_DATASET_DIR = GIT_ROOT / "eval" / "datasets" / "decision_plans"


@dataclass
class SplitRunBundle:
    """Results for one dataset split (`tuning` or `heldout`).

    Attributes:
        split_name: Dataset split identifier (`tuning` or `heldout`).
        summary: Primary benchmark summary for the evaluated backend.
        mock_baseline: Optional `mock/mock` baseline summary on the same split.
        paraphrase: Optional paraphrase sensitivity comparison on the split.
        template_arm: Optional promoted `SurfaceTemplate` comparison on the split.
    """

    split_name: str
    summary: BenchmarkSummary
    mock_baseline: BenchmarkSummary | None = None
    paraphrase: ParaphraseComparison | None = None
    template_arm: TemplateArmComparison | None = None


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parses command-line arguments for `decision_bench`.

    Args:
        argv: Optional list of CLI argument tokens.

    Returns:
        Parsed `argparse.Namespace` configuration.
    """
    parser = argparse.ArgumentParser(
        description="Benchmark decision backend latency, accuracy, and Wave 6 metrics.",
    )
    parser.add_argument(
        "--backend",
        choices=list(DECISION_CLI_BACKEND_CHOICES),
        required=True,
        help="Decision backend to evaluate (mock, jev, gemini, systemone, or step0).",
    )
    parser.add_argument(
        "--model",
        type=str,
        required=True,
        help="Explicit model identifier passed to the backend.",
    )
    parser.add_argument(
        "--endpoint-url",
        type=str,
        default=None,
        help="Optional endpoint URL override for remote or local HTTP backends.",
    )
    parser.add_argument(
        "--calibration",
        type=str,
        default=None,
        help="Optional path to a calibration profile JSON file.",
    )
    parser.add_argument(
        "--dataset",
        "--cases",
        type=str,
        default=str(DEFAULT_DATASET_DIR),
        dest="cases",
        help=(
            "Path to dataset directory or YAML file (default:"
            " eval/datasets/decision_plans)."
        ),
    )
    parser.add_argument(
        "--split",
        choices=["tuning", "heldout", "all"],
        default="all",
        help="Dataset split to evaluate: tuning, heldout, or all (default: all).",
    )
    parser.add_argument(
        "--tags",
        type=str,
        default=None,
        help="Optional comma-separated filter tags.",
    )
    parser.add_argument(
        "--repeat",
        type=int,
        default=1,
        help="Number of times to run each case (default: 1).",
    )
    parser.add_argument(
        "--include-unverified",
        action="store_true",
        help="Include cases with verified=false on tuning splits.",
    )
    parser.add_argument(
        "--paraphrase",
        action="store_true",
        help="Rerun with deterministic paraphrased question prompts and report delta.",
    )
    parser.add_argument(
        "--template-arm",
        action="store_true",
        help=(
            "Compare tool-mode cases against promoted SurfaceTemplates (0 model calls)."
        ),
    )
    parser.add_argument(
        "--fit-temperature",
        action="store_true",
        help="Fit temperature T to minimize Expected Calibration Error.",
    )
    parser.add_argument(
        "--json",
        type=str,
        default=None,
        dest="json_path",
        help="Optional path to write raw JSON summary.",
    )
    parser.add_argument(
        "--markdown",
        action="store_true",
        default=True,
        help="Render summary report in Markdown to stdout (default: True).",
    )
    return parser.parse_args(argv)


def _load_split_groups(
    cases_path: Path, args: argparse.Namespace
) -> list[tuple[str, list[PlanCase]]]:
    """Loads `(split_name, cases)` groups according to `args.split`.

    Args:
        cases_path: Path to a dataset directory or YAML file.
        args: Parsed CLI arguments containing `split`, `tags`, and
            `include_unverified`.

    Returns:
        Ordered list of `(split_name, cases)` pairs to evaluate.
    """
    if args.split == "tuning":
        loaded = load_plan_cases(
            cases_path,
            tags=args.tags,
            split="tuning",
            include_unverified=args.include_unverified,
        )
        return [("tuning", loaded)]
    if args.split == "heldout":
        loaded = load_plan_cases(
            cases_path,
            tags=args.tags,
            split="heldout",
            include_unverified=True,
        )
        return [("heldout", loaded)]

    tuning = load_plan_cases(
        cases_path,
        tags=args.tags,
        split="tuning",
        include_unverified=args.include_unverified,
    )
    heldout = load_plan_cases(
        cases_path,
        tags=args.tags,
        split="heldout",
        include_unverified=True,
    )
    groups: list[tuple[str, list[PlanCase]]] = []
    if tuning:
        groups.append(("tuning", tuning))
    if heldout:
        groups.append(("heldout", heldout))
    return groups


async def _run_split_bundle(
    synth: DecisionSynthesizer,
    split_name: str,
    cases: list[PlanCase],
    args: argparse.Namespace,
) -> SplitRunBundle:
    """Runs benchmark, optional mock baseline, paraphrase, and template arm for one split.

    Args:
        synth: Configured `DecisionSynthesizer` under evaluation.
        split_name: Dataset split identifier (`tuning` or `heldout`).
        cases: Loaded `PlanCase` definitions for `split_name`.
        args: Parsed CLI arguments controlling optional comparison passes.

    Returns:
        `SplitRunBundle` aggregating all requested evaluation passes.
    """
    fit_t = args.fit_temperature and split_name == "tuning"
    summary = await run_benchmark(
        synth,
        cases,
        repeat=args.repeat,
        fit_temp=fit_t,
        split_name=split_name,
    )
    mock_summary: BenchmarkSummary | None = None
    if args.backend != "mock":
        mock_synth = DecisionSynthesizer(
            [BasicCatalog("v1.0")],
            DeterministicMockBackend(model_id="mock"),
            config=SynthesisConfig(),
        )
        mock_summary = await run_benchmark(
            mock_synth, cases, repeat=1, split_name=split_name
        )

    para_comp: ParaphraseComparison | None = None
    if args.paraphrase:
        para_comp = await run_paraphrase_benchmark(
            synth,
            cases,
            repeat=args.repeat,
            split_name=split_name,
            baseline=summary,
        )

    tpl_comp: TemplateArmComparison | None = None
    if args.template_arm:
        tpl_comp = await run_template_arm_benchmark(
            synth, cases, repeat=args.repeat, split_name=split_name
        )

    return SplitRunBundle(
        split_name=split_name,
        summary=summary,
        mock_baseline=mock_summary,
        paraphrase=para_comp,
        template_arm=tpl_comp,
    )


def _render_bundle_markdown(bundle: SplitRunBundle) -> str:
    """Formats Markdown sections for one `SplitRunBundle`.

    Args:
        bundle: Evaluated `SplitRunBundle` for one split.

    Returns:
        Combined Markdown report string for `bundle`.
    """
    label = f"{bundle.summary.backend_kind}/{bundle.summary.model_id}"
    sections = [render_markdown(bundle.summary, backend_name=label)]
    if bundle.mock_baseline is not None:
        sections.append(
            render_markdown(bundle.mock_baseline, backend_name="mock/mock (baseline)")
        )
    if bundle.paraphrase is not None:
        sections.append(render_paraphrase_markdown(bundle.paraphrase))
    if bundle.template_arm is not None:
        sections.append(render_template_arm_markdown(bundle.template_arm))
    return "\n\n".join(sections)


def _serialize_bundle(bundle: SplitRunBundle) -> dict[str, Any]:
    """Serializes one `SplitRunBundle` for JSON output.

    Args:
        bundle: Evaluated `SplitRunBundle` to serialize.

    Returns:
        JSON-serializable dictionary representation of `bundle`.
    """
    out = serialize_benchmark_summary(bundle.summary)
    if bundle.mock_baseline is not None:
        out["mock_baseline"] = serialize_benchmark_summary(bundle.mock_baseline)
    if bundle.paraphrase is not None:
        out["paraphrase"] = {
            "paraphrased": serialize_benchmark_summary(bundle.paraphrase.paraphrased),
            "family_accuracy_delta": bundle.paraphrase.family_accuracy_delta,
            "archetype_accuracy_delta": bundle.paraphrase.archetype_accuracy_delta,
            "slot_binding_accuracy_delta": (
                bundle.paraphrase.slot_binding_accuracy_delta
            ),
            "forced_fit_rate_delta": bundle.paraphrase.forced_fit_rate_delta,
            "false_no_fit_rate_delta": bundle.paraphrase.false_no_fit_rate_delta,
        }
    if bundle.template_arm is not None:
        out["template_arm"] = {
            "tool_cases_count": bundle.template_arm.tool_cases_count,
            "planner_arm": serialize_benchmark_summary(bundle.template_arm.planner_arm),
            "template_arm": serialize_benchmark_summary(
                bundle.template_arm.template_arm
            ),
        }
    return out


async def _async_main(args: argparse.Namespace) -> int:
    """Executes the async benchmark workflow for `args`.

    Args:
        args: Parsed CLI arguments.

    Returns:
        Process exit code (`0` on success, `1` when no matching cases exist).
    """
    cases_path = Path(args.cases)
    if not cases_path.is_absolute():
        cases_path = GIT_ROOT / cases_path

    groups = _load_split_groups(cases_path, args)
    if not groups or (len(groups) == 1 and not groups[0][1] and cases_path.is_file()):
        sys.stderr.write(f"No cases found matching criteria in {cases_path}\n")
        return 1

    cal_path = Path(args.calibration) if args.calibration else None
    backend = build_decision_backend(
        args.backend,
        endpoint_url=args.endpoint_url,
        model=args.model,
        calibration=cal_path,
    )
    synth = DecisionSynthesizer(
        [BasicCatalog("v1.0")],
        backend,
        config=SynthesisConfig(),
    )

    try:
        bundles = [
            await _run_split_bundle(synth, split_name, split_cases, args)
            for split_name, split_cases in groups
        ]
    finally:
        await backend.aclose()

    if args.markdown:
        print("\n\n---\n\n".join(_render_bundle_markdown(b) for b in bundles))

    if args.json_path:
        out_path = Path(args.json_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        payload = (
            _serialize_bundle(bundles[0])
            if len(bundles) == 1
            else {"splits": {b.split_name: _serialize_bundle(b) for b in bundles}}
        )
        out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    return 0


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint for `decision_bench`.

    Args:
        argv: Optional list of CLI argument tokens.

    Returns:
        Process exit code (`0` on success).
    """
    args = parse_args(argv)
    return asyncio.run(_async_main(args))


if __name__ == "__main__":
    sys.exit(main())
