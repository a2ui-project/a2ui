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
from utils.runner import (  # type: ignore[import-not-found]
    run_unit_tests,
    run_evaluation,
    load_log_data,
    get_git_diff,
)
from utils.reporter import (  # type: ignore[import-not-found]
    extract_metrics_from_log,
    generate_optimization_report,
)


def regenerate_master_index(target_dir: str) -> None:
    """Scans history directory and rebuilds master `history_summary.md` index table.

    Args:
        target_dir: The filesystem path to the history directory or base eval directory.
    """
    if os.path.basename(target_dir.rstrip("/")) == "history":
        history_dir = target_dir
        master_index_file = os.path.join(
            os.path.dirname(target_dir.rstrip("/")), "history_summary.md"
        )
    else:
        history_dir = os.path.join(target_dir, "history")
        master_index_file = os.path.join(target_dir, "history_summary.md")

    # Auto-sync any worktree history folders if sync_history is available
    try:
        from sync_history import (  # type: ignore[import-not-found]
            sync_worktree_history,
        )

        sync_worktree_history(skip_index_regen=True)
    except Exception:
        pass

    if not os.path.exists(history_dir):
        return

    # Find format subdirectories and flat runs
    format_dirs = {}
    for entry in os.scandir(history_dir):
        if entry.is_dir():
            if entry.name.startswith("run_"):
                format_dirs.setdefault("default", []).append(entry)
            else:
                for sub_entry in os.scandir(entry.path):
                    if sub_entry.is_dir() and sub_entry.name.startswith("run_"):
                        format_dirs.setdefault(entry.name, []).append(sub_entry)

    all_master_runs = []

    for fmt_name, entries in format_dirs.items():
        fmt_runs = []
        for entry in entries:
            parts = entry.name.split("_")
            if len(parts) < 2:
                continue
            run_id = parts[1]
            report_path = os.path.join(entry.path, "report.md")
            meta_path = os.path.join(entry.path, "run_meta.json")
            results_path = os.path.join(entry.path, "results.json")

            hypothesis = "-"
            notes = "-"
            status = "-"

            meta_data: Dict[str, Any] = {}
            meta_metrics = None
            detected_format = fmt_name if fmt_name != "default" else "-"
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        meta_data = json.load(f)
                        hypothesis = meta_data.get("hypothesis", "-")
                        notes = meta_data.get("notes", "-")
                        status = meta_data.get("status", "-")
                        meta_metrics = meta_data.get("metrics")
                        if meta_data.get("format"):
                            detected_format = meta_data["format"]
                except Exception as e:
                    print(f"Warning: Failed to parse {meta_path}: {e}", file=sys.stderr)

            model_name = meta_data.get("model", "google/gemini-3.5-flash")
            thinking_budget = meta_data.get("thinking_budget")
            budget_str = (
                str(thinking_budget) if thinking_budget is not None else "Unbounded"
            )

            overall_acc = "-"
            algo_acc = "-"
            latency = "-"
            input_tokens = "-"
            output_tokens = "-"
            pytest_status = meta_data.get("pytest") or (
                "FAIL" if "Pytest FAIL" in str(notes) else "PASS"
            )

            if meta_metrics:
                overall_acc = f"{(meta_metrics.get('quality_acc') or 0.0) * 100:.1f}%"
                algo_acc = f"{(meta_metrics.get('schema_acc') or 0.0) * 100:.1f}%"
                latency = f"{(meta_metrics.get('latency_seconds_median') or 0.0):.2f}s"
                input_tokens = f"{(meta_metrics.get('input_tokens_median') or 0.0):.0f}"
                output_tokens = f"{(meta_metrics.get('code_tokens_median') or 0.0):.0f}"
            elif os.path.exists(results_path):
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

            run_dict = {
                "dir_name": entry.name,
                "format": detected_format,
                "id": run_id,
                "model": model_name,
                "budget": budget_str,
                "hypothesis": hypothesis,
                "pytest": pytest_status,
                "overall": overall_acc,
                "algo": algo_acc,
                "latency": latency,
                "input": input_tokens,
                "output": output_tokens,
                "status": status,
                "notes": notes,
            }
            fmt_runs.append(run_dict)
            all_master_runs.append(run_dict)

    all_master_runs.sort(
        key=lambda r: (r["format"], int(r["id"]) if r["id"].isdigit() else 0)
    )

    table = [
        "# Master Optimization Run History",
        "",
        (
            "| Format | Run ID | Model | Budget | Hypothesis | Pytest | Overall Acc |"
            " Algo Acc | Latency | Input Tok | Output Tok | Status | Notes |"
        ),
        (
            "| :--- | :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---:"
            " | :---: | :---: | :--- |"
        ),
    ]
    for r in all_master_runs:
        clean_hypo = str(r["hypothesis"]).replace("\n", " ").replace("|", "\\|")
        clean_notes = str(r["notes"]).replace("\n", " ").replace("|", "\\|")
        table.append(
            f"| `{r['format']}` | `{r['id']}` | `{r['model']}` | `{r['budget']}` |"
            f" {clean_hypo} | {r['pytest']} | {r['overall']} | {r['algo']} |"
            f" {r['latency']} | {r['input']} | {r['output']} | {r['status']} |"
            f" {clean_notes} |"
        )

    with open(master_index_file, "w", encoding="utf-8") as f:
        f.write("\n".join(table))
    print(f"Regenerated master index: {master_index_file}")


def main(argv: Optional[List[str]] = None) -> None:
    """Executes the orchestrator CLI for running and analyzing format optimizations.

    Args:
        argv: Optional command-line argument list.
    """
    parser = argparse.ArgumentParser(
        description="Algorithmic orchestrator for format optimization loop."
    )
    parser.add_argument(
        "--format",
        type=str,
        required=True,
        choices=["direct_json", "express", "elemental", "atom"],
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
    parser.add_argument(
        "--compile",
        type=str,
        default=None,
        help="Test compiling an inference format payload snippet",
    )
    parser.add_argument(
        "--decompile",
        type=str,
        default=None,
        help="Test decompiling an A2UI v1.0 JSON payload",
    )
    parser.add_argument(
        "--parse",
        type=str,
        default=None,
        help="Test parsing an inference format snippet into raw AST representation",
    )
    parser.add_argument(
        "--archive",
        action="store_true",
        help="Atomically archive current run artifacts into history/",
    )
    parser.add_argument(
        "--hypothesis",
        type=str,
        default=None,
        help="Hypothesis description for archived run",
    )
    parser.add_argument(
        "--status",
        type=str,
        choices=["KEEP", "REVERT", "Backtracked", "Kept", "Pending"],
        default="KEEP",
        help="Decision status for archived run",
    )
    parser.add_argument(
        "--notes",
        type=str,
        default=None,
        help="Qualitative notes for archived run",
    )
    parser.add_argument(
        "--history-dir",
        type=str,
        default=None,
        help=(
            "Custom history directory path (defaults to <workspace_root>/eval/history)"
        ),
    )
    parser.add_argument(
        "--thinking-budget",
        type=int,
        default=None,
        help="Thinking budget constraint for reasoning models",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=None,
        help="Number of evaluation epochs per prompt sample",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=0.0,
        help="Generation temperature for evaluation model",
    )
    args = parser.parse_args(argv)

    if args.compile:
        from utils.format_tools import test_compile_snippet

        print(test_compile_snippet(args.format, args.compile))
        sys.exit(0)

    if args.decompile:
        from utils.format_tools import test_decompile_payload

        print(test_decompile_payload(args.format, args.decompile))
        sys.exit(0)

    if args.parse:
        from utils.format_tools import test_parse_ast

        print(test_parse_ast(args.format, args.parse))
        sys.exit(0)

    if args.archive:
        from utils.archiver import archive_run

        hypo = args.hypothesis or "Format optimization run"
        st = "Kept" if args.status in ("KEEP", "Kept") else "Backtracked"
        archive_run(
            format_name=args.format,
            hypothesis=hypo,
            status=st,
            notes=args.notes,
            custom_history_dir=args.history_dir,
        )
        sys.exit(0)

    curr = os.path.dirname(os.path.abspath(__file__))
    while curr and not os.path.exists(os.path.join(curr, "main.py")):
        parent = os.path.dirname(curr)
        if parent == curr:
            break
        curr = parent
    eval_root = curr
    workspace_root = os.path.dirname(eval_root)

    # Initialize baselines directory
    baseline_dir = args.baseline_dir
    if not baseline_dir:
        baseline_dir = os.path.join(
            eval_root, "iterative_format_optimizer", "baselines", args.format
        )
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
    temp_log_dir = os.path.join(
        eval_root,
        "iterative_format_optimizer",
        "logs",
        f"temp_optimization_{args.format}_{os.getpid()}",
    )
    if os.path.exists(temp_log_dir):
        shutil.rmtree(temp_log_dir)
    os.makedirs(temp_log_dir, exist_ok=True)

    eval_success = run_evaluation(
        format_name=args.format,
        model=args.model,
        prompts=selected_prompts,
        sanity=args.sanity,
        log_dir=temp_log_dir,
        thinking_budget=args.thinking_budget,
        epochs=args.epochs,
        temperature=args.temperature,
    )

    if not eval_success:
        print("Error: Evaluation runner exited with error status.")
        sys.exit(1)

    # 4. Locate log file
    log_files = sorted(
        glob.glob(os.path.join(temp_log_dir, "*.eval")),
        key=lambda f: os.path.getmtime(f) if os.path.exists(f) else 0.0,
        reverse=True,
    )
    if not log_files:
        print("Error: No eval logs found.")
        sys.exit(1)
    current_log_path = log_files[0]

    current_log_data = load_log_data(current_log_path)

    # Save as baseline if requested
    if args.save_baseline:
        metrics_ext = extract_metrics_from_log(current_log_data)
        samples_dict = {}
        samples_list = current_log_data.get("samples") or []
        if isinstance(samples_list, dict):
            samples_list = list(samples_list.values())
        for s in samples_list:
            s_meta = s.get("metadata") or {}
            s_scores = s.get("scores") or {}
            s_id = s_meta.get("name") or str(s.get("id"))
            algo_passed = False
            quality_passed = False
            if isinstance(s_scores, dict):
                algo_passed = (
                    s_scores.get("a2ui_scorer", {}).get("value") == 1.0
                    if isinstance(s_scores.get("a2ui_scorer"), dict)
                    else False
                )
                quality_passed = (
                    s_scores.get("measured_model_graded_qa", {}).get("value") == "C"
                    if isinstance(s_scores.get("measured_model_graded_qa"), dict)
                    else False
                )
            elif isinstance(s_scores, list):
                for sc in s_scores:
                    if isinstance(sc, dict):
                        if sc.get("name") == "a2ui_scorer":
                            algo_passed = sc.get("value") == 1.0
                        elif sc.get("name") == "measured_model_graded_qa":
                            quality_passed = sc.get("value") == "C"

            s_dur = None
            s_reas = None
            for e in s.get("events") or []:
                if (
                    isinstance(e, dict)
                    and e.get("event") == "model"
                    and e.get("working_time") is not None
                ):
                    s_dur = e.get("working_time")
                    call_res = (
                        e.get("call", {}).get("response", {})
                        if isinstance(e.get("call"), dict)
                        else {}
                    )
                    if isinstance(call_res, dict):
                        usage_meta = call_res.get("usageMetadata")
                        if isinstance(usage_meta, dict):
                            s_reas = usage_meta.get("thoughtsTokenCount")
                    break

            if s_dur is None:
                s_dur = s_meta.get("inference_duration_seconds", 0.0)
            if s_reas is None:
                s_reas = s_meta.get("inference_reasoning_tokens", 0)

            samples_dict[s_id] = {
                "schema_acc": 1.0 if algo_passed else 0.0,
                "quality_acc": 1.0 if quality_passed else 0.0,
                "code_tokens": s_meta.get("inference_output_tokens", 0),
                "reasoning_tokens": s_reas,
                "input_tokens": s_meta.get("inference_input_tokens", 0),
                "latency_seconds": s_dur,
            }

        budget_name = (
            f"budget_{args.thinking_budget}"
            if args.thinking_budget is not None
            else "unbounded"
        )
        epochs_val = (
            args.epochs
            if args.epochs is not None
            else (5 if args.thinking_budget is None else 1)
        )
        run_config = {
            "format": args.format,
            "thinking_budget": args.thinking_budget,
            "temperature": args.temperature,
            "model": args.model,
            "dataset": "core_v1_0",
            "epochs": epochs_val,
            "run_name": budget_name,
        }
        meta_base = {
            "format": args.format,
            "model": args.model,
            "thinking_budget": args.thinking_budget,
            "temperature": args.temperature,
            "dataset": "core_v1_0",
            "epochs": epochs_val,
            "run_config": run_config,
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
        baseline_meta_dest = os.path.join(baseline_dir, f"{budget_name}_run_meta.json")
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

    # Write report file to temp_log_dir
    report_dest = os.path.join(temp_log_dir, "current_report.md")
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
    target_history = (
        args.history_dir
        if args.history_dir
        else os.path.join(
            workspace_root, "eval", "iterative_format_optimizer", "history"
        )
    )
    regenerate_master_index(target_history)

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
