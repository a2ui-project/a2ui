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

"""Orchestration script to run and analyze inference format optimizations."""

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
from typing import Any, Dict, List, Optional

# Ensure rate limiter connections limit (matches max_tasks=10)
os.environ["INSPECT_MAX_CONNECTIONS"] = "10"

from compare_results import (  # type: ignore[import-not-found]
    format_delta_pct,
    extract_metrics,
    resolve_results_file,
    generate_markdown_table,
)


def _get_uv_binary() -> str:
    return shutil.which("uv") or "/usr/local/google/home/gspencer/.local/bin/uv"


def run_unit_tests() -> Dict[str, Any]:
    """Runs pytest unit tests for the python SDK."""
    print("Running pytest unit tests...")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    eval_root = os.path.dirname(script_dir)
    workspace_root = os.path.dirname(eval_root)

    cmd = [_get_uv_binary(), "run", "pytest", "agent_sdks/python/a2ui_agent/tests/"]
    result = subprocess.run(cmd, cwd=workspace_root, capture_output=True, text=True)

    return {
        "success": result.returncode == 0,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "returncode": result.returncode,
    }


def run_evaluation(
    format_name: str,
    model: str,
    prompts: Optional[List[str]],
    sanity: bool,
    log_dir: str,
) -> bool:
    """Runs the main evaluation framework for the target format strategy."""
    print(f"Running evaluation for strategy '{format_name}' using model '{model}'...")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    eval_root = os.path.dirname(script_dir)

    strategy_name = "direct" if format_name == "transport" else format_name
    cmd = [
        _get_uv_binary(),
        "run",
        "python",
        "main.py",
        "--strategies",
        strategy_name,
        "--model",
        model,
        "--log-dir",
        log_dir,
    ]

    if sanity:
        cmd.append("--sanity")

    if prompts:
        for p in prompts:
            cmd.extend(["--prompt", p])

    print(f"Executing: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=eval_root, capture_output=False)
    return result.returncode == 0


def load_log_data(log_path: str) -> Dict[str, Any]:
    """Runs inspect log dump and parses the JSON."""
    dump_cmd = [_get_uv_binary(), "run", "inspect", "log", "dump", log_path]
    dump_output = subprocess.check_output(dump_cmd, text=True)
    res: Dict[str, Any] = json.loads(dump_output)
    return res


def get_git_diff(workspace_root: str) -> str:
    """Gets the git diff of python sdk format files and templates."""
    paths = [
        "agent_sdks/python/a2ui_agent/src/a2ui/inference_formats/",
        "agent_sdks/python/a2ui_agent/tests/",
    ]
    cmd = ["git", "diff"] + paths
    result = subprocess.run(cmd, cwd=workspace_root, capture_output=True, text=True)
    return result.stdout.strip()


def extract_metrics_from_log(log_data: Dict[str, Any]) -> Dict[str, Any]:
    """Extracts algorithmic/graded accuracies, latency, and token usages."""
    samples = log_data.get("samples", [])
    total_samples = len(samples)

    # Extract score values
    scores = log_data.get("results", {}).get("scores", [])
    accuracy_scorer: Dict[str, Any] = next(
        (s for s in scores if s.get("name") == "a2ui_scorer"), {}
    )
    accuracy_metrics = accuracy_scorer.get("metrics", {})
    algo_accuracy = (
        accuracy_metrics.get("accuracy", {}).get("value", 0.0)
        if accuracy_metrics
        else 0.0
    )

    judging_scorer: Dict[str, Any] = next(
        (s for s in scores if s.get("name") == "measured_model_graded_qa"), {}
    )
    judging_metrics = judging_scorer.get("metrics", {})
    overall_accuracy = (
        judging_metrics.get("accuracy", {}).get("value", 0.0)
        if judging_metrics
        else 0.0
    )

    # Latency & Tokens
    latencies = []
    input_tokens = []
    output_tokens = []

    for s in samples:
        duration = s.get("metadata", {}).get("evaluation_duration_seconds")
        if duration is not None:
            latencies.append(float(duration))
        for event in s.get("events", []):
            if event.get("event") == "model":
                usage = event.get("usage") or {}
                if "input_tokens" in usage:
                    input_tokens.append(usage["input_tokens"])
                if "output_tokens" in usage:
                    output_tokens.append(usage["output_tokens"])
                if duration is None:
                    working_time = event.get("working_time") or event.get("duration")
                    if working_time is not None:
                        latencies.append(float(working_time))

    avg_latency = (sum(latencies) / len(latencies)) if latencies else 0.0
    avg_input = (sum(input_tokens) / len(input_tokens)) if input_tokens else 0.0
    avg_output = (sum(output_tokens) / len(output_tokens)) if output_tokens else 0.0

    return {
        "overall_accuracy": overall_accuracy,
        "algo_accuracy": algo_accuracy,
        "avg_latency_seconds": avg_latency,
        "avg_input_tokens": avg_input,
        "avg_output_tokens": avg_output,
        "total_samples": total_samples,
    }


def generate_optimization_report(
    log_data: Dict[str, Any],
    pytest_results: Dict[str, Any],
    baseline_data: Optional[Dict[str, Any]],
    git_diff: str,
    format_name: str,
    model: str,
) -> str:
    """Generates a detailed markdown report for LLM / Human inspection."""
    metrics = extract_metrics_from_log(log_data)
    pytest_status = "PASS" if pytest_results["success"] else "FAIL"

    base_pytest = "-"
    base_overall = "-"
    base_algo = "-"
    base_latency = "-"
    base_input = "-"
    base_output = "-"

    diff_overall = ""
    diff_algo = ""
    diff_latency = ""
    diff_input = ""
    diff_output = ""

    if baseline_data:
        base_pytest = "PASS"
        base_metrics = extract_metrics_from_log(baseline_data)

        base_overall = f"{base_metrics['overall_accuracy'] * 100:.1f}%"
        base_algo = f"{base_metrics['algo_accuracy'] * 100:.1f}%"
        base_latency = f"{base_metrics['avg_latency_seconds']:.2f}s"
        base_input = f"{base_metrics['avg_input_tokens']:.0f}"
        base_output = f"{base_metrics['avg_output_tokens']:.0f}"

        diff_overall = format_delta_pct(
            metrics["overall_accuracy"],
            base_metrics["overall_accuracy"],
            is_percentage_points=True,
        )
        diff_algo = format_delta_pct(
            metrics["algo_accuracy"],
            base_metrics["algo_accuracy"],
            is_percentage_points=True,
        )
        diff_latency = format_delta_pct(
            metrics["avg_latency_seconds"], base_metrics["avg_latency_seconds"]
        )
        diff_input = format_delta_pct(
            metrics["avg_input_tokens"], base_metrics["avg_input_tokens"]
        )
        diff_output = format_delta_pct(
            metrics["avg_output_tokens"], base_metrics["avg_output_tokens"]
        )

    report = []
    report.append("# Inference Format Optimization Report")
    report.append(f"- **Strategy (Format)**: `{format_name}`")
    report.append(f"- **Evaluation Model**: `{model}`")
    report.append("")
    report.append("## Summary Table")
    report.append("| Metric | Baseline | Current | Diff |")
    report.append("| :--- | :--- | :--- | :--- |")
    report.append(f"| **Pytest Conformance** | {base_pytest} | {pytest_status} | - |")
    report.append(
        f"| **Overall Pass Rate** | {base_overall} |"
        f" {metrics['overall_accuracy'] * 100:.1f}% | {diff_overall} |"
    )
    report.append(
        f"| **Algorithmic Schema Pass Rate** | {base_algo} |"
        f" {metrics['algo_accuracy'] * 100:.1f}% | {diff_algo} |"
    )
    report.append(
        f"| **Inference Duration (sec)** | {base_latency} |"
        f" {metrics['avg_latency_seconds']:.2f}s | {diff_latency} |"
    )
    report.append(
        f"| **Avg Input Tokens** | {base_input} | {metrics['avg_input_tokens']:.0f} |"
        f" {diff_input} |"
    )
    report.append(
        f"| **Avg Output Tokens** | {base_output} | {metrics['avg_output_tokens']:.0f}"
        f" | {diff_output} |"
    )
    report.append("")

    if not pytest_results["success"]:
        report.append("## ❌ Pytest Unit Test Failures")
        report.append("```")
        report.append(pytest_results["stdout"])
        report.append(pytest_results["stderr"])
        report.append("```")
        report.append("")

    report.append("## Active Git Diff")
    if git_diff:
        report.append("```diff")
        report.append(git_diff)
        report.append("```")
    else:
        report.append("*No files modified under `agent_sdks`.*")
    report.append("")

    failures = []
    for sample in log_data.get("samples", []):
        s_scores = sample.get("scores", {})
        algo_passed = s_scores.get("a2ui_scorer", {}).get("value") == 1.0
        judging_val = s_scores.get("measured_model_graded_qa", {}).get("value", "N/A")

        if not algo_passed or judging_val != "C":
            failures.append((sample, algo_passed, judging_val))

    report.append(
        f"## Failure Details (Count: {len(failures)} / {metrics['total_samples']})"
    )
    if not failures:
        report.append("🎉 *All tests passed successfully!*")
    else:
        for sample, algo_passed, judging_val in failures:
            name = (
                sample.get("metadata", {}).get("name") or f"Sample {sample.get('id')}"
            )
            report.append(f"### ❌ Sample: `{name}`")
            report.append(
                f"- **Algorithmic Schema**: `{'PASS' if algo_passed else 'FAIL'}`"
            )
            report.append(f"- **LLM Judge Grade**: `{judging_val}`")
            report.append(
                f"- **Prompt**:\n  > {sample.get('input').replace('\n', '\n  > ')}"
            )
            report.append("")

            output_content = ""
            for event in sample.get("events", []):
                if event.get("event") == "model":
                    output_content = event.get("output", {}).get("completion", "")
                    break

            report.append("- **Raw Model Output**:")
            report.append("  ```")
            for line in output_content.splitlines():
                report.append(f"  {line}")
            report.append("  ```")
            report.append("")

            if not algo_passed:
                expl = s_scores.get("a2ui_scorer", {}).get("explanation")
                report.append("- **Algorithmic Failure Explanation**:")
                report.append("  > " + str(expl).replace("\n", "\n  > "))
                report.append("")

            if judging_val != "C":
                expl = s_scores.get("measured_model_graded_qa", {}).get("explanation")
                report.append(f"- **Grader Reasoning (Grade {judging_val})**:")
                report.append("  > " + str(expl).replace("\n", "\n  > "))
                report.append("")

    return "\n".join(report)


def regenerate_master_index(iterative_dir: str) -> None:
    """Scans history/ directory and rebuilds history_summary.md index."""
    history_dir = os.path.join(iterative_dir, "history")
    index_file = os.path.join(iterative_dir, "history_summary.md")

    # Auto-sync any worktree history folders if sync_history is available
    try:
        from sync_history import (  # type: ignore[import-not-found]
            sync_worktree_history,
        )

        sync_worktree_history()
    except Exception:
        pass

    if not os.path.exists(history_dir):
        return

    runs = []
    for entry in os.scandir(history_dir):
        if entry.is_dir() and entry.name.startswith("run_"):
            run_id = entry.name.split("_")[1]
            report_path = os.path.join(entry.path, "report.md")
            meta_path = os.path.join(entry.path, "run_meta.json")
            results_path = os.path.join(entry.path, "results.json")

            # Default metadata values
            hypothesis = "-"
            notes = "-"
            status = "-"

            meta_metrics = None
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        meta_data = json.load(f)
                        hypothesis = meta_data.get("hypothesis", "-")
                        notes = meta_data.get("notes", "-")
                        status = meta_data.get("status", "-")
                        meta_metrics = meta_data.get("metrics")
                except Exception:
                    pass

            overall_acc = "-"
            algo_acc = "-"
            latency = "-"
            input_tokens = "-"
            output_tokens = "-"
            pytest_status = "PASS"  # Assumed if evaluation ran

            if os.path.exists(results_path):
                try:
                    with open(results_path, "r", encoding="utf-8") as f:
                        log_data = json.load(f)
                        metrics = extract_metrics_from_log(log_data)
                        overall_acc = f"{metrics['overall_accuracy'] * 100:.1f}%"
                        algo_acc = f"{metrics['algo_accuracy'] * 100:.1f}%"
                        latency = f"{metrics['avg_latency_seconds']:.2f}s"
                        input_tokens = f"{metrics['avg_input_tokens']:.0f}"
                        output_tokens = f"{metrics['avg_output_tokens']:.0f}"
                except Exception:
                    pass
            elif meta_metrics:
                overall_acc = f"{meta_metrics.get('quality_acc', 0.0) * 100:.1f}%"
                algo_acc = f"{meta_metrics.get('schema_acc', 0.0) * 100:.1f}%"
                latency = f"{meta_metrics.get('latency_seconds_median', 0.0):.2f}s"
                input_tokens = f"{meta_metrics.get('input_tokens_median', 0.0):.0f}"
                output_tokens = f"{meta_metrics.get('code_tokens_median', 0.0):.0f}"

            runs.append({
                "dir_name": entry.name,
                "id": run_id,
                "hypothesis": hypothesis,
                "pytest": pytest_status,
                "overall": overall_acc,
                "algo": algo_acc,
                "latency": latency,
                "input": input_tokens,
                "output": output_tokens,
                "status": status,
                "notes": notes,
            })

    # Sort runs chronologically by directory name
    runs.sort(key=lambda r: r["dir_name"])

    table = []
    table.append("# Optimization Run History")
    table.append("")
    table.append(
        "| Run ID | Hypothesis | Pytest | Overall Acc | Algo Acc | Latency | Input"
        " Tok | Output Tok | Status | Notes |"
    )
    table.append(
        "| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |"
    )

    for r in runs:
        table.append(
            f"| `{r['id']}` | {r['hypothesis']} | {r['pytest']} | {r['overall']} |"
            f" {r['algo']} | {r['latency']} | {r['input']} | {r['output']} |"
            f" {r['status']} | {r['notes']} |"
        )

    with open(index_file, "w", encoding="utf-8") as f:
        f.write("\n".join(table))
    print(f"Regenerated master index: {index_file}")


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(
        description="Algorithmic orchestrator for format optimization loop."
    )
    parser.add_argument(
        "--format",
        type=str,
        required=True,
        choices=["transport", "express", "elemental", "atom"],
        help="Target inference format strategy to optimize",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="google/gemini-3.5-flash",
        help="Evaluation model name",
    )
    parser.add_argument(
        "--prompt",
        type=str,
        action="append",
        help="Run on a specific prompt subset",
    )
    parser.add_argument(
        "--sanity",
        action="store_true",
        help="Run a quick sanity check (2 samples)",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Run on the full evaluation suite",
    )
    parser.add_argument(
        "--save-baseline",
        action="store_true",
        help="Save current run as the baseline for this strategy",
    )
    parser.add_argument(
        "--baseline-dir",
        type=str,
        default=None,
        help="Directory to read/write baseline files",
    )
    args = parser.parse_args(argv)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    eval_root = os.path.dirname(script_dir)
    workspace_root = os.path.dirname(eval_root)

    # Initialize baselines directory
    baseline_dir = args.baseline_dir
    if not baseline_dir:
        baseline_dir = os.path.join(eval_root, "baselines", args.format)
    os.makedirs(baseline_dir, exist_ok=True)

    # 1. Run Pytest unit tests
    pytest_results = run_unit_tests()

    # 2. Setup prompts filter (small-scale by default, unless --full is provided)
    selected_prompts = args.prompt
    if not args.full and not args.sanity and not selected_prompts:
        selected_prompts = [
            "dogBreedGenerator",
            "loginForm",
            "settingsPage",
            "productGallery",
            "updateDataModel",
        ]

    # 3. Run Evals
    temp_log_dir = os.path.join(eval_root, "logs", "temp_optimization")
    if os.path.exists(temp_log_dir):
        shutil.rmtree(temp_log_dir)
    os.makedirs(temp_log_dir, exist_ok=True)

    eval_success = run_evaluation(
        format_name=args.format,
        model=args.model,
        prompts=selected_prompts,
        sanity=args.sanity,
        log_dir=temp_log_dir,
    )

    if not eval_success:
        print("Error: Evaluation runner exited with error status.")
        sys.exit(1)

    # 4. Locate log file
    log_files = glob.glob(os.path.join(temp_log_dir, "*.eval"))
    if not log_files:
        print("Error: No eval logs found.")
        sys.exit(1)
    current_log_path = log_files[0]

    current_log_data = load_log_data(current_log_path)

    # Save as baseline if requested
    if args.save_baseline:
        metrics_ext = extract_metrics_from_log(current_log_data)
        samples_dict = {}
        for s in current_log_data.get("samples", []):
            s_meta = s.get("metadata", {})
            s_scores = s.get("scores", {})
            s_id = s_meta.get("name") or str(s.get("id"))
            algo_passed = s_scores.get("a2ui_scorer", {}).get("value") == 1.0
            quality_passed = (
                s_scores.get("measured_model_graded_qa", {}).get("value") == "C"
            )
            samples_dict[s_id] = {
                "schema_acc": 1.0 if algo_passed else 0.0,
                "quality_acc": 1.0 if quality_passed else 0.0,
                "code_tokens": s_meta.get("inference_output_tokens", 0),
                "reasoning_tokens": s_meta.get("inference_reasoning_tokens", 0),
                "input_tokens": s_meta.get("inference_input_tokens", 0),
                "latency_seconds": s_meta.get("inference_duration_seconds", 0.0),
            }

        meta_base = {
            "format": args.format,
            "metrics": {
                "schema_acc": metrics_ext.get("algo_accuracy", 0.0),
                "quality_acc": metrics_ext.get("overall_accuracy", 0.0),
                "code_tokens_median": metrics_ext.get(
                    "median_output_tokens", metrics_ext.get("avg_output_tokens", 0.0)
                ),
                "reasoning_tokens_median": metrics_ext.get(
                    "median_reasoning_tokens",
                    metrics_ext.get("avg_reasoning_tokens", 0.0),
                ),
                "input_tokens_median": metrics_ext.get(
                    "median_input_tokens", metrics_ext.get("avg_input_tokens", 0.0)
                ),
                "latency_seconds_median": metrics_ext.get(
                    "median_latency_seconds",
                    metrics_ext.get("avg_latency_seconds", 0.0),
                ),
                "total_samples": metrics_ext.get("total_samples", 0),
            },
            "samples": samples_dict,
        }
        baseline_meta_dest = os.path.join(baseline_dir, "run_meta.json")
        with open(baseline_meta_dest, "w", encoding="utf-8") as f:
            json.dump(meta_base, f, indent=2)
        print(f"Saved baseline run_meta.json to: {baseline_meta_dest}")
        shutil.rmtree(temp_log_dir)
        sys.exit(0)

    # Load baseline if exists
    baseline_data = None
    try:
        baseline_file = resolve_results_file(baseline_dir)
        with open(baseline_file, "r", encoding="utf-8") as f:
            baseline_data = json.load(f)
    except Exception:
        pass

    # Get active git changes
    git_diff = get_git_diff(workspace_root)

    # Generate the Markdown report
    report_md = generate_optimization_report(
        log_data=current_log_data,
        pytest_results=pytest_results,
        baseline_data=baseline_data,
        git_diff=git_diff,
        format_name=args.format,
        model=args.model,
    )

    # Write report file to current_report.md
    report_dest = os.path.join(script_dir, "current_report.md")
    with open(report_dest, "w", encoding="utf-8") as f:
        f.write(report_md)

    # Save raw log data and metrics metadata to temp_log_dir
    with open(os.path.join(temp_log_dir, "results.json"), "w", encoding="utf-8") as f:
        json.dump(current_log_data, f, indent=2)

    metrics_extracted = extract_metrics_from_log(current_log_data)
    meta_payload = {
        "hypothesis": "Pending agent hypothesis",
        "status": "Pending",
        "metrics": {
            "schema_acc": metrics_extracted.get("algo_accuracy", 0.0),
            "quality_acc": metrics_extracted.get("overall_accuracy", 0.0),
            "code_tokens_median": metrics_extracted.get(
                "median_output_tokens", metrics_extracted.get("avg_output_tokens", 0.0)
            ),
            "reasoning_tokens_median": metrics_extracted.get(
                "median_reasoning_tokens",
                metrics_extracted.get("avg_reasoning_tokens", 0.0),
            ),
            "input_tokens_median": metrics_extracted.get(
                "median_input_tokens", metrics_extracted.get("avg_input_tokens", 0.0)
            ),
            "latency_seconds_median": metrics_extracted.get(
                "median_latency_seconds",
                metrics_extracted.get("avg_latency_seconds", 0.0),
            ),
            "total_samples": metrics_extracted.get("total_samples", 0),
        },
    }
    with open(os.path.join(temp_log_dir, "run_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta_payload, f, indent=2)

    # Rebuild index
    regenerate_master_index(script_dir)

    print(f"\nOptimization report written to: {report_dest}")
    print("\n================ REPORT PREVIEW ================")
    lines = report_md.splitlines()
    for line in lines[:30]:
        print(line)
    if len(lines) > 30:
        print("...")
    print("================================================\n")


if __name__ == "__main__":
    main()
