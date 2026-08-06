#!/usr/bin/env python3
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Report results from an Inspect AI eval log file."""

import argparse
import json
import os
import statistics
import subprocess
import sys
from typing import Any


def extract_accuracy(log_data: dict[str, Any]) -> float:
    """Extracts accuracy metric from parsed JSON log data.

    Args:
        log_data: Dictionary containing parsed evaluation log data.

    Returns:
        The accuracy score as a float between 0.0 and 1.0.

    Raises:
        ValueError: If no scores or accuracy metrics are present.
    """
    scores = log_data.get("results", {}).get("scores", [])
    if not scores:
        raise ValueError("No scores found in log file.")

    metrics = scores[0].get("metrics", {})
    accuracy_obj = metrics.get("accuracy") or {}
    accuracy = accuracy_obj.get("value")

    if accuracy is None:
        raise ValueError("Could not find accuracy metric in log file.")

    return float(accuracy)


def print_results_summary(log_data: dict[str, Any]) -> None:
    """Prints a summary of the evaluation results for each sample grouped by dataset.

    Args:
        log_data: Dictionary containing parsed evaluation log data.
    """
    samples = log_data.get("samples", [])
    print("\n=== Evaluation Results Summary ===")

    # Group by dataset
    datasets: dict[str, list[dict[str, Any]]] = {}
    for sample in samples:
        d_name = sample.get("metadata", {}).get("dataset") or "default"
        datasets.setdefault(d_name, []).append(sample)

    all_durations = []
    dataset_stats: dict[str, dict[str, int]] = {}

    for d_name, d_samples in datasets.items():
        total = len(d_samples)
        passed = 0
        print(f"\n--- Dataset: {d_name} ---")
        for sample in d_samples:
            name = (
                sample.get("metadata", {}).get("name") or f"Sample {sample.get('id')}"
            )
            scores = sample.get("scores", {})

            # Algorithmic validity (a2ui_scorer)
            a2ui_score = scores.get("a2ui_scorer", {})
            a2ui_passed = a2ui_score.get("value") == 1.0
            a2ui_str = "PASS" if a2ui_passed else "FAIL"

            # Judging results (measured_model_graded_qa)
            qa_score = scores.get("measured_model_graded_qa", {})
            qa_val = qa_score.get("value", "N/A")

            inference_time = None
            for event in sample.get("events", []):
                if event.get("event") == "model":
                    inference_time = event.get("working_time") or event.get("duration")
                    break
            if inference_time is None:
                inference_time = sample.get("metadata", {}).get(
                    "evaluation_duration_seconds"
                )
            inference_time_str = (
                f"{float(inference_time):.2f}s" if inference_time is not None else "N/A"
            )

            sample_passed = a2ui_passed and qa_val == "C"
            if sample_passed:
                passed += 1

            print(
                f"{name:<25} | Algorithmic: {a2ui_str:<4} | Judging: {qa_val:<2} |"
                f" Inference Time: {inference_time_str}"
            )

            if not sample_passed:
                if not a2ui_passed:
                    print(f"  [Algorithmic Failure Reason]:")
                    expl = a2ui_score.get("explanation") or "No explanation provided."
                    for line in str(expl).splitlines():
                        print(f"    {line}")
                if qa_val != "C":
                    print(f"  [Judging Failure Reason (Grade {qa_val})]:")
                    expl = qa_score.get("explanation") or "No explanation provided."
                    for line in str(expl).splitlines():
                        print(f"    {line}")

            if inference_time is not None:
                all_durations.append(float(inference_time))

        dataset_stats[d_name] = {"passed": passed, "total": total}

    print("\n==================================")
    print("Dataset Summary:")
    for d_name, stats in dataset_stats.items():
        pct = (stats["passed"] / stats["total"] * 100) if stats["total"] else 0.0
        print(f"  {d_name:<16}: {stats['passed']}/{stats['total']} passed ({pct:.2f}%)")

    if all_durations:
        avg_duration = statistics.mean(all_durations)
        med_duration = statistics.median(all_durations)
        print(
            f"Inference Time - Average: {avg_duration:.2f}s | Median:"
            f" {med_duration:.2f}s"
        )
    print("==================================")


def generate_markdown_summary(
    log_data: dict[str, Any], accuracy_percentage: float, threshold: float
) -> str:
    """Generates a markdown summary of the evaluation results.

    Args:
        log_data: Dictionary containing parsed evaluation log data.
        accuracy_percentage: Pass percentage achieved in the evaluation.
        threshold: Minimum pass percentage required by CI.

    Returns:
        A formatted markdown string summarizing evaluation performance.
    """
    eval_spec = log_data.get("eval", {}) or {}
    task_name = eval_spec.get("task", "Unknown Task")
    model_name = eval_spec.get("model", "Unknown Model")

    status_str = "PASS" if accuracy_percentage >= threshold else "FAIL"

    lines = []
    lines.append(f"### Evaluation Summary: {task_name}")
    lines.append(f"- **Status**: {status_str}")
    lines.append(f"- **Model**: `{model_name}`")
    lines.append(
        f"- **Pass Percentage**: `{accuracy_percentage:.2f}%` (Threshold:"
        f" `{threshold:.2f}%`)"
    )
    lines.append("")

    samples = log_data.get("samples", []) or []

    # Dataset performance summary table
    datasets: dict[str, list[dict[str, Any]]] = {}
    for sample in samples:
        d_name = sample.get("metadata", {}).get("dataset") or "default"
        datasets.setdefault(d_name, []).append(sample)

    if any(k != "default" for k in datasets.keys()):
        lines.append("#### Dataset Performance Summary")
        lines.append(
            "| Dataset Name | Total Samples | Algorithmic Pass Rate | Judging Pass Rate"
            " | Dataset Pass Rate |"
        )
        lines.append("| :--- | :---: | :---: | :---: | :---: |")

        for d_name, d_samples in datasets.items():
            total = len(d_samples)
            a2ui_pass_cnt = sum(
                1
                for s in d_samples
                if s.get("scores", {}).get("a2ui_scorer", {}).get("value") == 1.0
            )
            qa_pass_cnt = sum(
                1
                for s in d_samples
                if s.get("scores", {}).get("measured_model_graded_qa", {}).get("value")
                == "C"
            )
            both_pass_cnt = sum(
                1
                for s in d_samples
                if s.get("scores", {}).get("a2ui_scorer", {}).get("value") == 1.0
                and s.get("scores", {}).get("measured_model_graded_qa", {}).get("value")
                == "C"
            )
            a2ui_pct = (a2ui_pass_cnt / total * 100) if total else 0.0
            qa_pct = (qa_pass_cnt / total * 100) if total else 0.0
            both_pct = (both_pass_cnt / total * 100) if total else 0.0
            lines.append(
                f"| `{d_name}` | {total} | {a2ui_pct:.1f}% | {qa_pct:.1f}% |"
                f" {both_pct:.1f}% |"
            )
        lines.append("")

    lines.append("#### Sample Results")
    lines.append("| Sample / Task | Algorithmic | Judging | Inference Time | Status |")
    lines.append("| :--- | :---: | :---: | :---: | :---: |")

    failures = []

    for sample in samples:
        name = sample.get("metadata", {}).get("name") or f"Sample {sample.get('id')}"
        scores = sample.get("scores", {}) or {}

        a2ui_score = scores.get("a2ui_scorer", {}) or {}
        a2ui_passed = a2ui_score.get("value") == 1.0
        a2ui_str = "PASS" if a2ui_passed else "FAIL"

        qa_score = scores.get("measured_model_graded_qa", {}) or {}
        qa_val = qa_score.get("value", "N/A")

        inference_time = sample.get("metadata", {}).get("evaluation_duration_seconds")
        inference_time_str = (
            f"{float(inference_time):.2f}s" if inference_time is not None else "N/A"
        )

        sample_passed = a2ui_passed and qa_val == "C"
        sample_status_str = "PASS" if sample_passed else "FAIL"

        lines.append(
            f"| {name} | {a2ui_str} | {qa_val} | {inference_time_str} |"
            f" {sample_status_str} |"
        )

        if not sample_passed:
            failures.append((
                name,
                a2ui_passed,
                a2ui_score.get("explanation"),
                qa_val,
                qa_score.get("explanation"),
            ))

    lines.append("")

    if failures:
        lines.append("#### Failure Details")
        for name, a2ui_passed, a2ui_expl, qa_val, qa_expl in failures:
            lines.append(f"##### {name}")
            if not a2ui_passed:
                lines.append("- **Algorithmic Failure Reason**:")
                if a2ui_expl:
                    for line in str(a2ui_expl).strip().splitlines():
                        lines.append(f"  > {line}")
                else:
                    lines.append("  > No explanation provided.")
            if qa_val != "C":
                lines.append(f"- **Judging Failure Reason (Grade {qa_val})**:")
                if qa_expl:
                    for line in str(qa_expl).strip().splitlines():
                        lines.append(f"  > {line}")
                else:
                    lines.append("  > No explanation provided.")
            lines.append("")

    return "\n".join(lines)


def load_log_data(log_path: str) -> dict[str, Any]:
    """Loads and parses Inspect AI evaluation log JSON data using inspect log dump.

    Args:
        log_path: Path to the .eval log file.

    Returns:
        A dictionary containing parsed evaluation log data.
    """
    dump_cmd = ["uv", "run", "inspect", "log", "dump", log_path]
    dump_output = subprocess.check_output(dump_cmd, text=True)
    result: dict[str, Any] = json.loads(dump_output)
    return result


def main() -> None:
    """Main entrypoint for reporting evaluation results."""
    parser = argparse.ArgumentParser(
        description="Report results from an Inspect AI eval log file."
    )
    parser.add_argument("log", type=str, help="Path to the .eval log file.")
    args = parser.parse_args()

    if not os.path.exists(args.log):
        print(f"Error: Log file not found: {args.log}", file=sys.stderr)
        sys.exit(1)

    print(f"Processing log file: {args.log}")

    try:
        log_data = load_log_data(args.log)
        print_results_summary(log_data)
        accuracy = extract_accuracy(log_data)
        percentage = accuracy * 100
        print(f"Pass percentage: {percentage:.2f}%")
        sys.exit(0)
    except (subprocess.CalledProcessError, ValueError) as e:
        print(f"Error processing log file: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
