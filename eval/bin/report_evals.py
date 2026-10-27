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

"""Report results from an Inspect AI eval log file."""

import argparse
import json
import os
import statistics
import subprocess
import sys
from typing import Any

A2UI_SCORER = "a2ui_scorer"
JUDGE_SCORER = "measured_model_graded_qa"


def a2ui_scorer_passed(sample: dict[str, Any]) -> bool:
    """True when the sample's Stage 1/2 (`a2ui_scorer`) score is 1.0."""
    scores = sample.get("scores", {}) or {}
    return (scores.get(A2UI_SCORER, {}) or {}).get("value") == 1.0


def judge_grade(sample: dict[str, Any]) -> Any:
    """The sample's judge grade ("C", "P" or "I"), or "N/A" when it is absent."""
    scores = sample.get("scores", {}) or {}
    return (scores.get(JUDGE_SCORER, {}) or {}).get("value", "N/A")


def sample_passed(sample: dict[str, Any]) -> bool:
    """A sample passes when Stage 1/2 validated and the judge graded it "C"."""
    return a2ui_scorer_passed(sample) and judge_grade(sample) == "C"


def _has_both_scores(sample: dict[str, Any]) -> bool:
    scores = sample.get("scores", {}) or {}
    return A2UI_SCORER in scores and JUDGE_SCORER in scores


def extract_accuracy(log_data: dict[str, Any]) -> float:
    """Extracts the pass rate from parsed JSON log data.

    When the log carries per-sample scores for both `a2ui_scorer` and
    `measured_model_graded_qa`, the pass rate is the fraction of samples that
    pass both (the same rule the summaries use). Otherwise it falls back to
    the accuracy metric of the first scorer in `results.scores`.

    Args:
        log_data: Dictionary containing parsed evaluation log data.

    Returns:
        The accuracy score as a float between 0.0 and 1.0.

    Raises:
        ValueError: If no scores or accuracy metrics are present.
    """
    samples = log_data.get("samples") or []
    if samples and all(_has_both_scores(s) for s in samples):
        return sum(1 for s in samples if sample_passed(s)) / len(samples)

    scores = log_data.get("results", {}).get("scores", [])
    if not scores:
        raise ValueError("No scores found in log file.")

    metrics = scores[0].get("metrics", {})
    accuracy_obj = metrics.get("accuracy") or {}
    accuracy = accuracy_obj.get("value")

    if accuracy is None:
        raise ValueError("Could not find accuracy metric in log file.")

    return float(accuracy)


def extract_run_labels(log_data: dict[str, Any]) -> dict[str, str | None]:
    """Extracts the protocol version and strategy of an eval log.

    The values come from the task metadata, falling back to the task arguments.

    Args:
        log_data: Dictionary containing parsed evaluation log data.

    Returns:
        A dictionary with 'version' and 'strategy' keys. A value is None
        when the log does not record it.
    """
    eval_spec = log_data.get("eval", {}) or {}
    task_args = eval_spec.get("task_args", {}) or {}
    metadata = eval_spec.get("metadata", {}) or {}
    return {
        "version": metadata.get("version"),
        "strategy": metadata.get("strategy") or task_args.get("strategy"),
    }


def format_run_label(log_data: dict[str, Any]) -> str:
    """Formats a short label such as 'version=1.0, strategy=direct'."""
    labels = extract_run_labels(log_data)
    return ", ".join(f"{key}={value}" for key, value in labels.items() if value)


def print_results_summary(log_data: dict[str, Any]) -> None:
    """Prints a summary of the evaluation results for each sample grouped by dataset.

    Args:
        log_data: Dictionary containing parsed evaluation log data.
    """
    samples = log_data.get("samples", [])
    print("\n=== Evaluation Results Summary ===")
    run_label = format_run_label(log_data)
    if run_label:
        print(f"Run: {run_label}")

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
            scores = sample.get("scores", {}) or {}

            # Algorithmic validity (a2ui_scorer)
            a2ui_score = scores.get(A2UI_SCORER, {}) or {}
            a2ui_passed = a2ui_scorer_passed(sample)
            a2ui_str = "PASS" if a2ui_passed else "FAIL"

            # Judging results (measured_model_graded_qa)
            qa_score = scores.get(JUDGE_SCORER, {}) or {}
            qa_val = judge_grade(sample)

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

            passed_sample = sample_passed(sample)
            if passed_sample:
                passed += 1

            print(
                f"{name:<25} | Algorithmic: {a2ui_str:<4} | Judging: {qa_val:<2} |"
                f" Inference Time: {inference_time_str}"
            )

            if not passed_sample:
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


def strategy_summary(log_data: dict[str, Any]) -> dict[str, Any]:
    """Computes aggregate performance metrics for a strategy run.

    Returns a mapping of summary metrics:
      - total_samples: int
      - algorithmic_pass_rate: float (0.0 to 1.0)
      - judge_pass_rate: float (0.0 to 1.0)
      - combined_pass_rate: float (0.0 to 1.0)
      - median_input_tokens: float | None
      - median_output_tokens: float | None
      - median_duration_seconds: float | None
      - median_decision_latency_ms: float | None
      - fallback_rate: float
      - reask_rate: float
      - decision_backend: str | None
      - cached: bool
    """
    samples = log_data.get("samples") or []
    total = len(samples)
    if not total:
        return {
            "total_samples": 0,
            "algorithmic_pass_rate": 0.0,
            "judge_pass_rate": 0.0,
            "combined_pass_rate": 0.0,
            "median_input_tokens": None,
            "median_output_tokens": None,
            "median_duration_seconds": None,
            "median_decision_latency_ms": None,
            "fallback_rate": 0.0,
            "reask_rate": 0.0,
            "decision_backend": None,
            "cached": False,
        }

    a2ui_pass_cnt = sum(1 for s in samples if a2ui_scorer_passed(s))
    judge_pass_cnt = sum(1 for s in samples if judge_grade(s) == "C")
    both_pass_cnt = sum(1 for s in samples if sample_passed(s))

    inputs: list[float] = []
    outputs: list[float] = []
    durations: list[float] = []
    decision_lats: list[float] = []
    fallbacks = 0
    reasks = 0
    backend: str | None = None

    for s in samples:
        meta = s.get("metadata", {}) or {}
        if backend is None and meta.get("decision_backend"):
            backend = meta.get("decision_backend")
        in_tok = meta.get("inference_input_tokens")
        if in_tok is not None:
            inputs.append(float(in_tok))
        out_tok = meta.get("inference_output_tokens")
        if out_tok is not None:
            outputs.append(float(out_tok))
        dur = meta.get("inference_duration_seconds")
        if dur is not None:
            durations.append(float(dur))
        dec_lat = meta.get("decision_latency_ms")
        if dec_lat is not None:
            decision_lats.append(float(dec_lat))
        if meta.get("decision_fallback_source"):
            fallbacks += 1
        if meta.get("decision_reasked"):
            reasks += 1

    cached = bool(inputs and all(tok == 0.0 for tok in inputs))

    return {
        "total_samples": total,
        "algorithmic_pass_rate": a2ui_pass_cnt / total,
        "judge_pass_rate": judge_pass_cnt / total,
        "combined_pass_rate": both_pass_cnt / total,
        "median_input_tokens": (
            statistics.median(inputs) if inputs and not cached else None
        ),
        "median_output_tokens": (
            statistics.median(outputs) if outputs and not cached else None
        ),
        "median_duration_seconds": (
            statistics.median(durations) if durations and not cached else None
        ),
        "median_decision_latency_ms": (
            statistics.median(decision_lats) if decision_lats else None
        ),
        "fallback_rate": fallbacks / total,
        "reask_rate": reasks / total,
        "decision_backend": backend,
        "cached": cached,
    }


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
    labels = extract_run_labels(log_data)
    run_label = format_run_label(log_data)

    status_str = "PASS" if accuracy_percentage >= threshold else "FAIL"

    lines = []
    heading = f"### Evaluation Summary: {task_name}"
    if run_label:
        heading += f" ({run_label})"
    lines.append(heading)
    lines.append(f"- **Status**: {status_str}")
    if labels["version"]:
        lines.append(f"- **Protocol Version**: `{labels['version']}`")
    if labels["strategy"]:
        lines.append(f"- **Strategy**: `{labels['strategy']}`")
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
            "| Dataset Name | Total Samples | Algorithmic Pass Rate | Judging Pass"
            " Rate | Dataset Pass Rate |"
        )
        lines.append("| :--- | :---: | :---: | :---: | :---: |")

        for d_name, d_samples in datasets.items():
            total = len(d_samples)
            a2ui_pass_cnt = sum(1 for s in d_samples if a2ui_scorer_passed(s))
            qa_pass_cnt = sum(1 for s in d_samples if judge_grade(s) == "C")
            both_pass_cnt = sum(1 for s in d_samples if sample_passed(s))
            a2ui_pct = (a2ui_pass_cnt / total * 100) if total else 0.0
            qa_pct = (qa_pass_cnt / total * 100) if total else 0.0
            both_pct = (both_pass_cnt / total * 100) if total else 0.0
            lines.append(
                f"| `{d_name}` | {total} | {a2ui_pct:.1f}% | {qa_pct:.1f}% |"
                f" {both_pct:.1f}% |"
            )
        lines.append("")

    has_decision = any(
        s.get("metadata", {}).get("decision_stage")
        or s.get("metadata", {}).get("decision_archetype")
        for s in samples
    )

    lines.append("#### Sample Results")
    if has_decision:
        lines.append(
            "| Sample / Task | Algorithmic | Judging | Inference Time | Path |"
            " Decision ms | Status |"
        )
        lines.append("| :--- | :---: | :---: | :---: | :---: | :---: | :---: |")
    else:
        lines.append(
            "| Sample / Task | Algorithmic | Judging | Inference Time | Status |"
        )
        lines.append("| :--- | :---: | :---: | :---: | :---: |")

    failures = []

    for sample in samples:
        name = sample.get("metadata", {}).get("name") or f"Sample {sample.get('id')}"
        scores = sample.get("scores", {}) or {}

        a2ui_score = scores.get(A2UI_SCORER, {}) or {}
        a2ui_passed = a2ui_scorer_passed(sample)
        a2ui_str = "PASS" if a2ui_passed else "FAIL"

        qa_score = scores.get(JUDGE_SCORER, {}) or {}
        qa_val = judge_grade(sample)

        inference_time = sample.get("metadata", {}).get("evaluation_duration_seconds")
        inference_time_str = (
            f"{float(inference_time):.2f}s" if inference_time is not None else "N/A"
        )

        passed_sample = sample_passed(sample)
        sample_status_str = "PASS" if passed_sample else "FAIL"

        if has_decision:
            meta = sample.get("metadata", {}) or {}
            stage = meta.get("decision_stage") or "-"
            arch = meta.get("decision_archetype") or "-"
            path_str = f"{stage} · {arch}"
            dec_ms = meta.get("decision_latency_ms")
            dec_ms_str = f"{float(dec_ms):.1f}ms" if dec_ms is not None else "-"
            lines.append(
                f"| {name} | {a2ui_str} | {qa_val} | {inference_time_str} |"
                f" {path_str} | {dec_ms_str} | {sample_status_str} |"
            )
        else:
            lines.append(
                f"| {name} | {a2ui_str} | {qa_val} | {inference_time_str} |"
                f" {sample_status_str} |"
            )

        if not passed_sample:
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
