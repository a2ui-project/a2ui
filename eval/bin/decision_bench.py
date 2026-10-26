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
from dataclasses import asdict
import json
from pathlib import Path
import sys

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import DecisionSynthesizer
from a2ui_eval.decision_bench import (
    load_plan_cases,
    render_markdown,
    run_benchmark,
)
from a2ui_eval.decision_common import build_decision_backend
from a2ui_eval.shared.utils import GIT_ROOT

DEFAULT_CASES_PATH = GIT_ROOT / "eval" / "datasets" / "decision_plans" / "v1.yaml"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Benchmark decision backend latency, accuracy, and calibration.",
    )
    parser.add_argument(
        "--backend",
        choices=["mock", "local", "jev"],
        default=None,
        help="Decision backend to evaluate (mock, local, or jev; default: env).",
    )
    parser.add_argument(
        "--cases",
        type=str,
        default=str(DEFAULT_CASES_PATH),
        help="Path to YAML cases file (default: eval/datasets/decision_plans/v1.yaml).",
    )
    parser.add_argument(
        "--tags",
        type=str,
        default="smoke",
        help="Comma-separated filter tags (default: smoke).",
    )
    parser.add_argument(
        "--repeat",
        type=int,
        default=3,
        help="Number of times to run each case (default: 3).",
    )
    parser.add_argument(
        "--include-unverified",
        action="store_true",
        help="Include cases with verified=false.",
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
        help="Render summary table in markdown to stdout (default: True).",
    )
    return parser.parse_args(argv)


async def _async_main(args: argparse.Namespace) -> int:
    cases_path = Path(args.cases)
    if not cases_path.is_absolute():
        cases_path = GIT_ROOT / cases_path

    cases = load_plan_cases(
        cases_path,
        tags=args.tags,
        include_unverified=args.include_unverified,
    )
    if not cases:
        sys.stderr.write(f"No cases found matching criteria in {cases_path}\n")
        return 1

    backend = build_decision_backend(args.backend)
    backend_name = args.backend or getattr(backend, "name", "default")
    catalogs = [BasicCatalog("v1.0")]
    synth = DecisionSynthesizer(catalogs, backend)

    try:
        summary = await run_benchmark(
            synth,
            cases,
            repeat=args.repeat,
            fit_temp=args.fit_temperature,
        )
    finally:
        if hasattr(backend, "aclose"):
            await backend.aclose()
        elif hasattr(backend, "close"):
            backend.close()

    if args.markdown:
        md = render_markdown(summary, backend_name=str(backend_name))
        print(md)

    if args.json_path:
        out_path = Path(args.json_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        # Serialize summary to JSON
        serializable = {
            "cases_count": summary.cases_count,
            "total_runs": summary.total_runs,
            "family_accuracy": summary.family_accuracy,
            "archetype_accuracy": summary.archetype_accuracy,
            "block_precision": summary.block_precision,
            "block_recall": summary.block_recall,
            "abstain_rate": summary.abstain_rate,
            "decision_latency_p50": summary.decision_latency_p50,
            "decision_latency_p95": summary.decision_latency_p95,
            "host_overhead_p50": summary.host_overhead_p50,
            "host_overhead_p95": summary.host_overhead_p95,
            "decision_calls_mean": summary.decision_calls_mean,
            "brier_family": summary.brier_family,
            "ece_family": summary.ece_family,
            "brier_archetype": summary.brier_archetype,
            "ece_archetype": summary.ece_archetype,
            "brier_gates": summary.brier_gates,
            "ece_gates": summary.ece_gates,
            "fitted_temperature": summary.fitted_temperature,
            "cases": [
                {
                    "name": cs.case.name,
                    "family_accuracy": cs.family_accuracy,
                    "archetype_accuracy": cs.archetype_accuracy,
                    "block_precision": cs.block_precision,
                    "block_recall": cs.block_recall,
                    "abstain_rate": cs.abstain_rate,
                    "decision_latency_p50": cs.decision_latency_p50,
                    "host_overhead_p50": cs.host_overhead_p50,
                }
                for cs in summary.case_scores
            ],
        }
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(serializable, f, indent=2)

    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    return asyncio.run(_async_main(args))


if __name__ == "__main__":
    sys.exit(main())
