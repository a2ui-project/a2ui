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

"""Compares A2UI evaluation run results directories against a baseline directory."""

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
from typing import Any, Dict, List, Optional, Set, Tuple


def resolve_results_file(target_path: str) -> str:
    """Resolves results.json from a directory, .eval file, or direct json file path."""
    if os.path.isfile(target_path):
        if target_path.endswith(".json"):
            return target_path
        elif target_path.endswith(".eval"):
            uv_bin = (
                shutil.which("uv") or "/usr/local/google/home/gspencer/.local/bin/uv"
            )
            dump_cmd = [uv_bin, "run", "inspect", "log", "dump", target_path]
            data = json.loads(subprocess.check_output(dump_cmd, text=True))
            temp_json = target_path + ".json"
            with open(temp_json, "w", encoding="utf-8") as f:
                json.dump(data, f)
            return temp_json

    if os.path.isdir(target_path):
        res_json = os.path.join(target_path, "results.json")
        if os.path.exists(res_json):
            return res_json

        meta_json = os.path.join(target_path, "run_meta.json")
        if os.path.exists(meta_json):
            try:
                with open(meta_json, "r", encoding="utf-8") as f:
                    m_data = json.load(f)
                    if "metrics" in m_data:
                        return meta_json
            except Exception:
                pass

        # Search for .eval files inside directory
        eval_files = glob.glob(os.path.join(target_path, "*.eval")) + glob.glob(
            os.path.join(target_path, "**/*.eval"), recursive=True
        )
        if eval_files:
            uv_bin = (
                shutil.which("uv") or "/usr/local/google/home/gspencer/.local/bin/uv"
            )
            dump_cmd = [uv_bin, "run", "inspect", "log", "dump", eval_files[0]]
            data = json.loads(subprocess.check_output(dump_cmd, text=True))
            temp_json = os.path.join(target_path, "results.json")
            with open(temp_json, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            return temp_json

    raise FileNotFoundError(
        "Could not find valid results.json, run_meta.json, or .eval file in:"
        f" '{target_path}'"
    )


def extract_metrics(
    json_path: str,
    label_name: str = "",
    use_median: bool = True,
    filter_sample_ids: Optional[Set[str]] = None,
) -> Dict[str, Any]:
    """Extracts summary and per-sample metadata metrics from results JSON data."""
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Extract name/label
    name = label_name or os.path.basename(os.path.dirname(json_path))
    if not name or name in (".", ".."):
        name = os.path.basename(json_path)

    eval_spec = data.get("eval", {})
    task_name = eval_spec.get("task", "unknown")

    if "metrics" in data and isinstance(data.get("samples"), dict):
        samples_dict = data["samples"]
        matching_samples = {}
        if filter_sample_ids:
            for s_id, s_data in samples_dict.items():
                if s_id in filter_sample_ids:
                    matching_samples[s_id] = s_data
        else:
            matching_samples = samples_dict

        if matching_samples:
            import statistics

            s_accs = [
                s.get("schema_acc", 1.0 if s.get("schema_passed") else 0.0)
                for s in matching_samples.values()
            ]
            q_accs = [
                s.get("quality_acc", 1.0 if s.get("quality_passed") else 0.0)
                for s in matching_samples.values()
            ]
            c_toks = [
                s["code_tokens"]
                for s in matching_samples.values()
                if s.get("code_tokens")
            ]
            r_toks = [
                s["reasoning_tokens"]
                for s in matching_samples.values()
                if s.get("reasoning_tokens")
            ]
            i_toks = [
                s["input_tokens"]
                for s in matching_samples.values()
                if s.get("input_tokens")
            ]
            lats = [
                s["latency_seconds"]
                for s in matching_samples.values()
                if s.get("latency_seconds")
            ]

            s_acc = sum(s_accs) / len(s_accs) if s_accs else 0.0
            q_acc = sum(q_accs) / len(q_accs) if q_accs else 0.0
            med_c = float(statistics.median(c_toks)) if c_toks else 0.0
            med_r = float(statistics.median(r_toks)) if r_toks else 0.0
            med_i = float(statistics.median(i_toks)) if i_toks else 0.0
            med_lat = float(statistics.median(lats)) if lats else 0.0

            return {
                "name": name,
                "task_name": task_name,
                "total_samples": len(matching_samples),
                "schema_acc": s_acc,
                "schema_accuracy": s_acc,
                "algo_accuracy": s_acc,
                "quality_acc": q_acc,
                "quality_accuracy": q_acc,
                "overall_accuracy": q_acc,
                "avg_latency_seconds": med_lat,
                "median_latency_seconds": med_lat,
                "avg_input_tokens": med_i,
                "median_input_tokens": med_i,
                "avg_output_tokens": med_c,
                "median_output_tokens": med_c,
                "avg_reasoning_tokens": med_r,
                "median_reasoning_tokens": med_r,
                "sample_ids": set(matching_samples.keys()),
            }

    if "metrics" in data and not data.get("samples"):
        m = data["metrics"]
        return {
            "name": name,
            "task_name": task_name,
            "total_samples": m.get("total_samples", 0),
            "schema_accuracy": m.get("schema_acc", 0.0),
            "algo_accuracy": m.get("schema_acc", 0.0),
            "quality_accuracy": m.get("quality_acc", 0.0),
            "overall_accuracy": m.get("quality_acc", 0.0),
            "avg_latency_seconds": m.get("latency_seconds_median", 0.0),
            "median_latency_seconds": m.get("latency_seconds_median", 0.0),
            "avg_input_tokens": m.get("input_tokens_median", 0.0),
            "median_input_tokens": m.get("input_tokens_median", 0.0),
            "avg_output_tokens": m.get("code_tokens_median", 0.0),
            "median_output_tokens": m.get("code_tokens_median", 0.0),
            "avg_reasoning_tokens": m.get("reasoning_tokens_median", 0.0),
            "median_reasoning_tokens": m.get("reasoning_tokens_median", 0.0),
            "sample_ids": set(),
        }

    samples = data.get("samples", [])
    filtered_samples = []
    extracted_sample_ids = set()

    for s in samples:
        name_id = str(s.get("metadata", {}).get("name") or "")
        raw_id = str(s.get("id") or "")
        s_id = name_id or raw_id
        extracted_sample_ids.add(s_id)
        if raw_id:
            extracted_sample_ids.add(raw_id)
        if filter_sample_ids and (
            s_id not in filter_sample_ids and raw_id not in filter_sample_ids
        ):
            continue
        filtered_samples.append(s)

    sample_count = len(filtered_samples) if filtered_samples else len(samples)
    active_samples = filtered_samples if filtered_samples else samples

    # Calculate schema and quality accuracy over active samples
    schema_passes = 0
    quality_passes = 0
    total_schema = 0
    total_quality = 0

    for s in active_samples:
        s_scores = s.get("scores", {})
        if "a2ui_scorer" in s_scores:
            val = s_scores["a2ui_scorer"].get("value")
            if val is not None:
                total_schema += 1
                if val == 1.0:
                    schema_passes += 1
        if "measured_model_graded_qa" in s_scores:
            val = s_scores["measured_model_graded_qa"].get("value")
            if val is not None:
                total_quality += 1
                if val == "C":
                    quality_passes += 1

    schema_acc = (schema_passes / total_schema) if total_schema > 0 else None
    quality_acc = (quality_passes / total_quality) if total_quality > 0 else None

    # Metadata aggregation
    durations = []
    input_tokens = []
    output_tokens = []
    cached_tokens = []
    reasoning_tokens = []

    for sample in active_samples:
        meta = sample.get("metadata", {})

        # Redefined inference_duration_seconds: extract pure model working_time excluding retries
        sample_duration = None
        sample_reasoning = None
        events = sample.get("events", [])
        model_events = [
            e
            for e in events
            if e.get("event") == "model" and e.get("working_time") is not None
        ]
        if model_events:
            m = model_events[0]
            sample_duration = (
                m.get("working_time")
                or m.get("time")
                or (
                    m.get("call", {}).get("time")
                    if isinstance(m.get("call"), dict)
                    else None
                )
            )

            call_res = (
                m.get("call", {}).get("response", {})
                if isinstance(m.get("call"), dict)
                else {}
            )
            if isinstance(call_res, dict):
                usage_meta = call_res.get("usageMetadata", {})
                sample_reasoning = usage_meta.get("thoughtsTokenCount")

        if sample_duration is None and "inference_duration_seconds" in meta:
            sample_duration = meta["inference_duration_seconds"]

        if sample_reasoning is None and "inference_reasoning_tokens" in meta:
            sample_reasoning = meta["inference_reasoning_tokens"]

        if sample_duration is not None:
            durations.append(sample_duration)

        if sample_reasoning is not None:
            reasoning_tokens.append(sample_reasoning)

        if "inference_input_tokens" in meta:
            input_tokens.append(meta["inference_input_tokens"])
        if "inference_output_tokens" in meta:
            output_tokens.append(meta["inference_output_tokens"])
        if "inference_cached_tokens" in meta:
            cached_tokens.append(meta["inference_cached_tokens"])

    # Wall-clock duration calculation from stats
    stats = data.get("stats", {})
    started_at_str = stats.get("started_at")
    completed_at_str = stats.get("completed_at")
    wall_clock_duration = 0.0
    if started_at_str and completed_at_str:
        try:
            from datetime import datetime

            t_start = datetime.fromisoformat(started_at_str)
            t_end = datetime.fromisoformat(completed_at_str)
            wall_clock_duration = (t_end - t_start).total_seconds()
        except Exception:
            wall_clock_duration = 0.0

    wall_clock_per_sample = (
        wall_clock_duration / max(sample_count, 1) if wall_clock_duration > 0 else 0.0
    )

    # Fallback stats model usage if sample metadata is empty
    model_usage: Dict[str, Any] = data.get("stats", {}).get("model_usage", {})
    primary_usage: Dict[str, Any] = (
        next(iter(model_usage.values()), {}) if model_usage else {}
    )

    import statistics

    def _calc_stat(lst: List[float], fallback: float = 0.0) -> float:
        if not lst:
            return fallback
        return float(statistics.median(lst)) if use_median else (sum(lst) / len(lst))

    avg_duration = _calc_stat(durations)
    avg_input_tokens = _calc_stat(
        input_tokens, primary_usage.get("input_tokens", 0) / max(sample_count, 1)
    )
    avg_output_tokens = _calc_stat(
        output_tokens, primary_usage.get("output_tokens", 0) / max(sample_count, 1)
    )
    avg_cached_tokens = _calc_stat(
        cached_tokens,
        primary_usage.get("input_tokens_cache_read", 0) / max(sample_count, 1),
    )
    avg_reasoning_tokens = _calc_stat(
        reasoning_tokens,
        primary_usage.get("reasoning_tokens", 0) / max(sample_count, 1),
    )

    total_gen_tokens = avg_reasoning_tokens + avg_output_tokens
    reasoning_frac = avg_reasoning_tokens / max(total_gen_tokens, 1.0)
    est_reasoning_time = avg_duration * reasoning_frac
    est_code_time = avg_duration * (1.0 - reasoning_frac)

    total_duration = sum(durations)
    total_input_tokens = (
        sum(input_tokens) if input_tokens else primary_usage.get("input_tokens", 0)
    )
    total_output_tokens = (
        sum(output_tokens) if output_tokens else primary_usage.get("output_tokens", 0)
    )

    return {
        "name": name,
        "path": json_path,
        "sample_count": sample_count,
        "schema_acc": schema_acc,
        "quality_acc": quality_acc,
        "avg_duration": avg_duration,
        "wall_clock_duration": wall_clock_duration,
        "wall_clock_per_sample": wall_clock_per_sample,
        "avg_input_tokens": avg_input_tokens,
        "avg_output_tokens": avg_output_tokens,
        "avg_cached_tokens": avg_cached_tokens,
        "avg_reasoning_tokens": avg_reasoning_tokens,
        "est_reasoning_time": est_reasoning_time,
        "est_code_time": est_code_time,
        "total_duration": total_duration,
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
        "use_median": use_median,
        "sample_ids": extracted_sample_ids,
    }


def format_delta_pct(
    val: float, base_val: float, is_percentage_points: bool = False
) -> str:
    """Formats percentage change or point diff against baseline."""
    if base_val == 0.0 or base_val is None or val is None:
        return "-"

    if is_percentage_points:
        diff = (val - base_val) * 100
        sign = "+" if diff > 0 else ""
        return f"{sign}{diff:.1f}%"

    pct_change = ((val - base_val) / base_val) * 100
    sign = "+" if pct_change > 0 else ""
    return f"{sign}{pct_change:.1f}%"


def compute_s_opt(m: Dict[str, Any], b: Dict[str, Any]) -> float:
    """Computes Composite Optimization Score S_opt."""
    schema_acc = m.get("schema_acc") or 0.0
    quality_acc = m.get("quality_acc") or 0.0
    code_tok = m.get("avg_output_tokens") or 1.0
    base_code_tok = b.get("avg_output_tokens") or 1.0
    reason_tok = m.get("avg_reasoning_tokens") or 1.0
    base_reason_tok = b.get("avg_reasoning_tokens") or 1.0
    input_tok = m.get("avg_input_tokens") or 1.0
    base_input_tok = b.get("avg_input_tokens") or 1.0

    code_ratio = code_tok / max(base_code_tok, 1.0)
    reason_ratio = reason_tok / max(base_reason_tok, 1.0)
    input_ratio = input_tok / max(base_input_tok, 1.0)

    s_opt = (
        (0.50 * schema_acc)
        + (0.30 * quality_acc)
        - (0.15 * code_ratio)
        - (0.05 * reason_ratio)
        - (0.03 * input_ratio)
    )
    return round(s_opt, 3)


def generate_markdown_table(
    baseline_metrics: Dict[str, Any],
    comparison_metrics_list: List[Dict[str, Any]],
    use_median: bool = True,
) -> str:
    """Renders a GFM comparison markdown table."""
    lines = []
    stat_title = "Median" if use_median else "Average"
    lines.append(
        f"### A2UI Evaluation Comparison & Baseline Delta ({stat_title} Metrics)"
    )
    lines.append("")

    stat_name = "Median" if use_median else "Avg"
    headers = [
        "Run / Results Directory",
        "Samples",
        "Score (S_opt)",
        "Schema Acc (Delta)",
        "Quality Score (Delta)",
        "Parallel Wall Latency (Delta)",
        f"Sample Working Time ({stat_name})",
        f"Non-reasoning Output Time ({stat_name})",
        f"{stat_name} Input Tok (Delta)",
        f"{stat_name} Reasoning Tok (Delta)",
        f"{stat_name} Code Output Tok (Delta)",
    ]

    lines.append("| " + " | ".join(headers) + " |")
    lines.append(
        "| "
        + " | ".join([":---" if i == 0 else ":---:" for i in range(len(headers))])
        + " |"
    )

    # Format baseline row
    b = baseline_metrics
    b_s_opt = compute_s_opt(b, b)
    b_s_opt_str = f"**{b_s_opt:+.3f}**"
    b_s_acc = b.get("schema_acc", b.get("schema_accuracy"))
    b_q_acc = b.get("quality_acc", b.get("quality_accuracy"))
    b_schema_str = f"{b_s_acc*100:.1f}%" if b_s_acc is not None else "N/A"
    b_quality_str = f"{b_q_acc*100:.1f}%" if b_q_acc is not None else "N/A"
    b_wall_val = b.get("wall_clock_per_sample", 0)
    b_wall_str = f"{b_wall_val:.2f}s" if b_wall_val > 0 else "N/A"
    b_lat_str = f"{b.get('avg_duration', 0):.2f}s"
    b_ctime_str = f"{b.get('est_code_time', 0):.2f}s"
    b_inp_str = f"{b.get('avg_input_tokens', 0):,.0f}"
    b_rtok_str = f"{b.get('avg_reasoning_tokens', 0):,.0f}"
    b_out_str = f"{b.get('avg_output_tokens', 0):,.0f}"
    b_name = b.get("name", "baseline")
    b_count = b.get("sample_count", b.get("total_samples", 0))

    lines.append(
        f"| **Baseline**: `{b_name}` | {b_count} | {b_s_opt_str} |"
        f" {b_schema_str} | {b_quality_str} | {b_wall_str} | {b_lat_str} |"
        f" {b_ctime_str} | {b_inp_str} | {b_rtok_str} | {b_out_str} |"
    )

    # Format comparison rows
    for c in comparison_metrics_list:
        c_name = c.get("name") or c.get("run_name") or "run"
        name_str = f"`{c_name}`"
        samples_str = str(c.get("sample_count", c.get("total_samples", 0)))

        c_s_opt = compute_s_opt(c, b)
        d_s_opt = c_s_opt - b_s_opt
        sign_opt = "+" if d_s_opt > 0 else ""
        s_opt_str = f"**{c_s_opt:+.3f}** ({sign_opt}{d_s_opt:.3f})"

        # Schema Acc
        c_s_acc = c.get("schema_acc", c.get("schema_accuracy"))
        b_s_acc = b.get("schema_acc", b.get("schema_accuracy", 0.0))
        if c_s_acc is not None:
            c_schema_val = f"{c_s_acc*100:.1f}%"
            d_schema = format_delta_pct(c_s_acc, b_s_acc, is_percentage_points=True)
            schema_cell = f"{c_schema_val} ({d_schema})"
        else:
            schema_cell = "N/A"

        # Quality Acc
        c_q_acc = c.get("quality_acc", c.get("quality_accuracy"))
        b_q_acc = b.get("quality_acc", b.get("quality_accuracy", 0.0))
        if c_q_acc is not None:
            c_qual_val = f"{c_q_acc*100:.1f}%"
            d_qual = format_delta_pct(c_q_acc, b_q_acc, is_percentage_points=True)
            quality_cell = f"{c_qual_val} ({d_qual})"
        else:
            quality_cell = "N/A"

        # Parallel Wall Latency
        c_wall = c.get("wall_clock_per_sample", 0)
        b_wall = b.get("wall_clock_per_sample", 0)
        if c_wall > 0:
            c_wall_val = f"{c_wall:.2f}s"
            d_wall = format_delta_pct(c_wall, b_wall)
            wall_cell = f"{c_wall_val} ({d_wall})"
        else:
            wall_cell = "N/A"

        # Sample Latency
        c_dur = c.get("avg_duration", c.get("avg_latency_seconds", 0.0))
        b_dur = b.get("avg_duration", b.get("avg_latency_seconds", 0.0))
        c_lat_val = f"{c_dur:.2f}s"
        d_lat = format_delta_pct(c_dur, b_dur)
        latency_cell = f"{c_lat_val} ({d_lat})"

        # Non-reasoning Output Time
        c_ctime_val = f"{c.get('est_code_time', 0):.2f}s"
        d_ctime = format_delta_pct(c.get("est_code_time", 0), b.get("est_code_time", 0))
        ctime_cell = f"{c_ctime_val} ({d_ctime})"

        # Input Tokens
        c_inp = c.get("avg_input_tokens", 0.0)
        b_inp = b.get("avg_input_tokens", 0.0)
        c_inp_val = f"{c_inp:,.0f}"
        d_inp = format_delta_pct(c_inp, b_inp)
        inp_cell = f"{c_inp_val} ({d_inp})"

        # Reasoning Tokens
        c_rtok_val = f"{c.get('avg_reasoning_tokens', 0):,.0f}"
        d_rtok = format_delta_pct(
            c.get("avg_reasoning_tokens", 0), b.get("avg_reasoning_tokens", 0)
        )
        rtok_cell = f"{c_rtok_val} ({d_rtok})"

        # Output Tokens
        c_out = c.get("avg_output_tokens", 0.0)
        b_out = b.get("avg_output_tokens", 0.0)
        c_out_val = f"{c_out:,.0f}"
        d_out = format_delta_pct(c_out, b_out)
        out_cell = f"{c_out_val} ({d_out})"

        lines.append(
            f"| {name_str} | {samples_str} | {s_opt_str} | {schema_cell} |"
            f" {quality_cell} | {wall_cell} | {latency_cell} | {ctime_cell} |"
            f" {inp_cell} | {rtok_cell} | {out_cell} |"
        )

    lines.append("")
    lines.append("#### Metric Definitions & Derivation Key")
    lines.append(
        "- **Run / Results Directory**: Identifier or directory path of the evaluation"
        " run."
    )
    lines.append(
        "- **Samples**: Total number of evaluation sample prompts executed in the run."
    )
    lines.append(
        "- **Score (S_opt)**: Composite Format Score `S_opt = 0.50×SchemaAcc +"
        " 0.30×QualityScore - 0.15×(CodeTok/BaseCodeTok) -"
        " 0.05×(ReasonTok/BaseReasonTok) - 0.03×(InputTok/BaseInputTok)`. Higher score"
        " indicates superior accuracy and token efficiency."
    )
    lines.append(
        "- **Schema Acc (Delta)**: Percentage of outputs passing strict compiler"
        " compilation and schema validation (`a2ui_scorer`), with point diff vs"
        " baseline."
    )
    lines.append(
        "- **Quality Score (Delta)**: LLM-graded semantic intent accuracy score"
        " (`measured_model_graded_qa`), with point diff vs baseline."
    )
    lines.append(
        "- **Parallel Wall Latency (Delta)**: Total wall-clock run duration divided by"
        " sample count `(completed_at - started_at) / samples`, measuring parallel"
        " batch throughput under concurrency."
    )
    lines.append(
        "- **Sample Working Time (Delta)**: Sample pure HTTP execution duration"
        " (`working_time`), excluding API rate-limit backoffs and task queue wait"
        " times."
    )
    lines.append(
        "- **Non-reasoning Output Time (Delta)**: Estimated time spent emitting final"
        " code output, calculated as `Working Time × (Code Output Tokens / Total"
        " Generated Tokens)`."
    )
    lines.append(
        "- **Input Tok (Delta)**: Prompt input tokens sent per sample, including system"
        " instructions and catalog schema definitions."
    )
    lines.append(
        "- **Reasoning Tok (Delta)**: Internal thinking/reasoning tokens"
        " (`thoughtsTokenCount`) generated by the model per sample."
    )
    lines.append(
        "- **Code Output Tok (Delta)**: Final code output tokens"
        " (`candidatesTokenCount`) generated by the model per sample."
    )
    lines.append("")
    stat_note = "medians" if use_median else "averages"
    lines.append(
        f"*Notes: Latency and token metrics represent per-sample {stat_note}. Delta"
        " percentages indicate relative gain (+) or reduction (-) against the"
        " baseline.*"
    )
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(
        description="Compare A2UI evaluation results against a baseline directory."
    )
    parser.add_argument(
        "--baseline",
        type=str,
        required=True,
        help="Path to baseline results directory or results.json file",
    )
    parser.add_argument(
        "results_dirs",
        nargs="+",
        help=(
            "One or more target results directories or json files to compare against"
            " baseline"
        ),
    )
    parser.add_argument(
        "--average",
        action="store_true",
        help=(
            "Compute and display sample averages instead of default medians for latency"
            " and token metrics"
        ),
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Optional output markdown file path to save report",
    )

    args = parser.parse_args(argv)

    use_median = not args.average

    # Load comparison runs
    comp_metrics_list = []
    target_sample_ids = None

    for r_dir in args.results_dirs:
        res_json = resolve_results_file(r_dir)
        label = os.path.basename(os.path.normpath(r_dir))
        m = extract_metrics(res_json, label_name=label, use_median=use_median)
        comp_metrics_list.append(m)
        if target_sample_ids is None and m.get("sample_ids"):
            target_sample_ids = m["sample_ids"]

    # Load baseline (filtered to target sample IDs if target is a validation subset)
    baseline_json = resolve_results_file(args.baseline)
    baseline_metrics = extract_metrics(
        baseline_json,
        label_name=os.path.basename(os.path.normpath(args.baseline)),
        use_median=use_median,
        filter_sample_ids=target_sample_ids
        if (target_sample_ids and len(target_sample_ids) < 50)
        else None,
    )

    table_md = generate_markdown_table(
        baseline_metrics, comp_metrics_list, use_median=use_median
    )
    print(table_md)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(table_md)
        print(f"\nSaved comparison table to: {args.output}")


if __name__ == "__main__":
    main()
