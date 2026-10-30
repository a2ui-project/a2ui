#!/usr/bin/env python3
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

"""Compares evaluation results across inference strategies from Inspect AI eval logs."""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Sequence

from report_evals import extract_run_labels, load_log_data, strategy_summary


def find_eval_logs(paths: Sequence[str]) -> list[str]:
    """Finds all .eval log files from a sequence of file or directory paths."""
    eval_files: list[str] = []
    for p in paths:
        if os.path.isdir(p):
            for root, _, files in os.walk(p):
                for f in sorted(files):
                    if f.endswith(".eval"):
                        eval_files.append(os.path.join(root, f))
        elif os.path.isfile(p) and p.endswith(".eval"):
            eval_files.append(p)
    return sorted(eval_files)


def summarize_log_groups(
    log_paths: Sequence[str],
) -> list[dict[str, Any]]:
    """Loads eval logs and groups summaries by (version, strategy, decision_backend)."""
    groups: dict[tuple[str, str, str | None], list[dict[str, Any]]] = {}
    for path in log_paths:
        try:
            data = load_log_data(path)
        except Exception as e:  # pylint: disable=broad-exception-caught
            print(f"Warning: could not load {path}: {e}", file=sys.stderr)
            continue
        labels = extract_run_labels(data)
        version = labels.get("version") or "unknown"
        strategy = labels.get("strategy") or "unknown"
        samples = data.get("samples") or []
        backend: str | None = None
        for s in samples:
            b = s.get("metadata", {}).get("decision_backend")
            if b:
                backend = str(b)
                break
        key = (version, strategy, backend)
        groups.setdefault(key, []).extend(samples)

    rows: list[dict[str, Any]] = []
    for (version, strategy, backend), samples in sorted(groups.items()):
        synthetic_log = {"samples": samples}
        summary = strategy_summary(synthetic_log)
        rows.append({
            "version": version,
            "strategy": strategy,
            "decision_backend": backend,
            "total_samples": summary["total_samples"],
            "algorithmic_pass_rate": summary["algorithmic_pass_rate"],
            "judge_pass_rate": summary["judge_pass_rate"],
            "combined_pass_rate": summary["combined_pass_rate"],
            "median_input_tokens": summary["median_input_tokens"],
            "median_output_tokens": summary["median_output_tokens"],
            "median_duration_seconds": summary["median_duration_seconds"],
            "median_decision_latency_ms": summary["median_decision_latency_ms"],
            "fallback_rate": summary["fallback_rate"],
            "reask_rate": summary["reask_rate"],
            "cached": summary["cached"],
        })
    return rows


def render_markdown_table(rows: Sequence[dict[str, Any]]) -> str:
    """Formats comparison rows into a Markdown table."""
    if not rows:
        return "No evaluation logs found."

    lines = [
        (
            "| Strategy | Version | Backend | Samples | S1/2 Pass | Judge C |"
            " Combined | In Tok | Out Tok | Duration | Decision ms | Cached |"
        ),
        (
            "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |"
            " :---: | :---: | :---: | :---: |"
        ),
    ]
    for r in rows:
        backend_str = f"`{r['decision_backend']}`" if r["decision_backend"] else "-"
        in_tok_str = (
            f"{int(r['median_input_tokens'])}"
            if r["median_input_tokens"] is not None
            else "-"
        )
        out_tok_str = (
            f"{int(r['median_output_tokens'])}"
            if r["median_output_tokens"] is not None
            else "-"
        )
        dur_str = (
            f"{r['median_duration_seconds']:.2f}s"
            if r["median_duration_seconds"] is not None
            else "-"
        )
        dec_str = (
            f"{r['median_decision_latency_ms']:.1f}ms"
            if r["median_decision_latency_ms"] is not None
            else "-"
        )
        cached_str = "yes" if r["cached"] else "no"
        lines.append(
            f"| `{r['strategy']}` | `{r['version']}` | {backend_str} |"
            f" {r['total_samples']} | {r['algorithmic_pass_rate'] * 100:.1f}% |"
            f" {r['judge_pass_rate'] * 100:.1f}% |"
            f" {r['combined_pass_rate'] * 100:.1f}% | {in_tok_str} |"
            f" {out_tok_str} | {dur_str} | {dec_str} | {cached_str} |"
        )
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entrypoint for compare_strategies."""
    parser = argparse.ArgumentParser(
        description=(
            "Compare evaluation results across strategies from Inspect AI eval logs."
        )
    )
    parser.add_argument(
        "paths",
        nargs="+",
        help="Path(s) to .eval log files or directories containing them.",
    )
    parser.add_argument(
        "--json",
        dest="json_out",
        type=str,
        default=None,
        help="Optional path to write comparison summary as JSON.",
    )
    args = parser.parse_args(argv)

    log_files = find_eval_logs(args.paths)
    if not log_files:
        print(f"No .eval files found in {args.paths}", file=sys.stderr)
        return 0

    rows = summarize_log_groups(log_files)
    table = render_markdown_table(rows)
    print(table)

    if args.json_out:
        os.makedirs(os.path.dirname(os.path.abspath(args.json_out)), exist_ok=True)
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=2)

    return 0


if __name__ == "__main__":
    sys.exit(main())
