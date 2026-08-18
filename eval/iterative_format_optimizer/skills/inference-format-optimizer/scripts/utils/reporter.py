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

"""Markdown report generation and evaluation log metric extraction."""

import statistics
from typing import Any, Dict, List, Optional

from compare_results import format_delta_pct  # type: ignore[import-not-found]


def extract_metrics_from_log(log_data: Dict[str, Any]) -> Dict[str, Any]:
    """Extracts summary metrics from an inspect log dictionary or run metadata dictionary.

    Args:
        log_data: The dictionary containing evaluation log data or run metadata.

    Returns:
        A dictionary containing aggregated pass rates, latency, and token counts.
    """
    if "metrics" in log_data and not log_data.get("results"):
        m = log_data["metrics"]

        def _get_first_not_none(
            d: Dict[str, Any], keys: List[str], default: float = 0.0
        ) -> float:
            for k in keys:
                val = d.get(k)
                if val is not None:
                    return float(val)
            return default

        med_lat = _get_first_not_none(
            m, ["latency_seconds_median", "avg_latency_seconds"]
        )
        med_c = _get_first_not_none(m, ["code_tokens_median", "avg_output_tokens"])
        med_r = _get_first_not_none(
            m, ["reasoning_tokens_median", "avg_reasoning_tokens"]
        )
        med_in = _get_first_not_none(m, ["input_tokens_median", "avg_input_tokens"])
        s_acc = _get_first_not_none(m, ["schema_acc", "algo_accuracy"])
        q_acc = _get_first_not_none(m, ["quality_acc", "overall_accuracy"])
        tot_samp = int(
            m.get("total_samples") if m.get("total_samples") is not None else 0
        )
        return {
            "algo_accuracy": s_acc,
            "overall_accuracy": q_acc,
            "avg_latency_seconds": med_lat,
            "median_latency_seconds": med_lat,
            "avg_input_tokens": med_in,
            "median_input_tokens": med_in,
            "avg_output_tokens": med_c,
            "median_output_tokens": med_c,
            "avg_reasoning_tokens": med_r,
            "median_reasoning_tokens": med_r,
            "total_samples": tot_samp,
        }

    results = log_data.get("results") or {}
    scores = results.get("scores") or []

    algo_acc = 0.0
    overall_acc = 0.0

    for s in scores:
        if isinstance(s, dict):
            m_dict = s.get("metrics") or {}
            acc_obj = m_dict.get("accuracy")
            acc_val = acc_obj.get("value") if isinstance(acc_obj, dict) else acc_obj
            if s.get("name") == "a2ui_scorer":
                algo_acc = float(acc_val or 0.0)
            elif s.get("name") == "measured_model_graded_qa":
                overall_acc = float(acc_val or 0.0)

    samples = log_data.get("samples") or []
    if isinstance(samples, dict):
        samples = list(samples.values())

    durations: List[float] = []
    input_toks: List[float] = []
    output_toks: List[float] = []
    reasoning_toks: List[float] = []

    for sample in samples:
        meta = sample.get("metadata") or {}
        s_duration = None
        s_reasoning = None

        events = sample.get("events") or []
        model_events = [
            e
            for e in events
            if isinstance(e, dict)
            and e.get("event") == "model"
            and e.get("working_time") is not None
        ]
        if model_events:
            m = model_events[0]
            s_duration = m.get("working_time") or m.get("time")
            call_res = (
                m.get("call", {}).get("response", {})
                if isinstance(m.get("call"), dict)
                else {}
            )
            if isinstance(call_res, dict):
                usage_meta = call_res.get("usageMetadata")
                if isinstance(usage_meta, dict):
                    s_reasoning = usage_meta.get("thoughtsTokenCount")

        if s_duration is None:
            if "evaluation_duration_seconds" in meta:
                s_duration = meta["evaluation_duration_seconds"]
            elif "inference_duration_seconds" in meta:
                s_duration = meta["inference_duration_seconds"]

        if s_duration is None:
            for e in events:
                if isinstance(e, dict) and e.get("event") == "model":
                    w = e.get("working_time") or e.get("time") or e.get("duration")
                    if w is not None:
                        s_duration = w
                        break

        if s_reasoning is None and "inference_reasoning_tokens" in meta:
            s_reasoning = meta["inference_reasoning_tokens"]

        if s_duration is not None:
            durations.append(float(s_duration))

        if s_reasoning is not None:
            reasoning_toks.append(float(s_reasoning))

        s_input = meta.get("inference_input_tokens")
        s_output = meta.get("inference_output_tokens")

        for e in events:
            if isinstance(e, dict) and e.get("event") == "model":
                usage = e.get("usage") or {}
                if isinstance(usage, dict):
                    if s_input is None and "input_tokens" in usage:
                        s_input = usage["input_tokens"]
                    if s_output is None and "output_tokens" in usage:
                        s_output = usage["output_tokens"]

        if s_input is not None:
            input_toks.append(float(s_input))

        if s_output is not None:
            output_toks.append(float(s_output))

    avg_latency = float(statistics.mean(durations)) if durations else 0.0
    med_latency = float(statistics.median(durations)) if durations else 0.0

    avg_input = float(statistics.mean(input_toks)) if input_toks else 0.0
    med_input = float(statistics.median(input_toks)) if input_toks else 0.0

    avg_output = float(statistics.mean(output_toks)) if output_toks else 0.0
    med_output = float(statistics.median(output_toks)) if output_toks else 0.0

    avg_reasoning = float(statistics.mean(reasoning_toks)) if reasoning_toks else 0.0
    med_reasoning = float(statistics.median(reasoning_toks)) if reasoning_toks else 0.0

    return {
        "overall_accuracy": overall_acc,
        "algo_accuracy": algo_acc,
        "avg_latency_seconds": avg_latency,
        "median_latency_seconds": med_latency,
        "avg_input_tokens": avg_input,
        "median_input_tokens": med_input,
        "avg_output_tokens": avg_output,
        "median_output_tokens": med_output,
        "avg_reasoning_tokens": avg_reasoning,
        "median_reasoning_tokens": med_reasoning,
        "total_samples": len(samples),
    }


def generate_optimization_report(
    log_data: Dict[str, Any],
    pytest_results: Dict[str, Any],
    baseline_data: Optional[Dict[str, Any]],
    git_diff: str,
    format_name: str,
    model: str,
) -> str:
    """Generates a detailed markdown report for evaluation run inspection.

    Args:
        log_data: The current evaluation run log dictionary.
        pytest_results: The dictionary containing unit test execution results.
        baseline_data: Optional baseline evaluation log dictionary.
        git_diff: The active git diff patch string.
        format_name: The target format strategy name.
        model: The evaluation model name.

    Returns:
        The complete markdown report string.
    """
    metrics = extract_metrics_from_log(log_data)
    pytest_status = "PASS" if pytest_results["success"] else "FAIL"

    base_pytest = "-"
    base_overall = "-"
    base_algo = "-"
    base_latency = "-"
    base_input = "-"
    base_output = "-"
    base_reasoning = "-"

    diff_overall = ""
    diff_algo = ""
    diff_latency = ""
    diff_input = ""
    diff_output = ""
    diff_reasoning = ""

    if baseline_data:
        base_pytest = "PASS"
        base_metrics = extract_metrics_from_log(baseline_data)

        base_overall_val = float(base_metrics.get("overall_accuracy") or 0.0)
        base_algo_val = float(base_metrics.get("algo_accuracy") or 0.0)
        base_lat_val = float(base_metrics.get("avg_latency_seconds") or 0.0)
        base_in_val = float(base_metrics.get("avg_input_tokens") or 0.0)
        base_out_val = float(base_metrics.get("avg_output_tokens") or 0.0)
        base_reas_val = float(base_metrics.get("avg_reasoning_tokens") or 0.0)

        base_overall = f"{base_overall_val * 100:.1f}%"
        base_algo = f"{base_algo_val * 100:.1f}%"
        base_latency = f"{base_lat_val:.2f}s"
        base_input = f"{base_in_val:.0f}"
        base_output = f"{base_out_val:.0f}"
        base_reasoning = f"{base_reas_val:.0f}"

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
        diff_reasoning = format_delta_pct(
            metrics["avg_reasoning_tokens"], base_metrics["avg_reasoning_tokens"]
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
        f"| **Avg Input Tokens** | {base_input} |"
        f" {metrics['avg_input_tokens']:.0f} | {diff_input} |"
    )
    report.append(
        f"| **Avg Output Tokens** | {base_output} |"
        f" {metrics['avg_output_tokens']:.0f} | {diff_output} |"
    )
    report.append(
        f"| **Avg Reasoning Tokens** | {base_reasoning} |"
        f" {metrics['avg_reasoning_tokens']:.0f} | {diff_reasoning} |"
    )
    report.append("")

    if not pytest_results.get("success"):
        report.append("## ❌ Pytest Unit Test Failures")
        report.append("```")
        report.append(pytest_results.get("stdout", ""))
        report.append(pytest_results.get("stderr", ""))
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
    curr_samples = log_data.get("samples") or []
    if isinstance(curr_samples, dict):
        curr_samples = list(curr_samples.values())
    for sample in curr_samples:
        s_scores = sample.get("scores") or {}
        algo_passed = False
        judging_val = "N/A"
        if isinstance(s_scores, dict):
            a2ui_sc = s_scores.get("a2ui_scorer") or {}
            if isinstance(a2ui_sc, dict):
                algo_passed = a2ui_sc.get("value") == 1.0
            qa_sc = s_scores.get("measured_model_graded_qa") or {}
            if isinstance(qa_sc, dict):
                judging_val = qa_sc.get("value", "N/A")
        elif isinstance(s_scores, list):
            for sc in s_scores:
                if isinstance(sc, dict):
                    if sc.get("name") == "a2ui_scorer":
                        algo_passed = sc.get("value") == 1.0
                    elif sc.get("name") == "measured_model_graded_qa":
                        judging_val = sc.get("value", "N/A")

        if not algo_passed or (judging_val != "N/A" and judging_val != "C"):
            failures.append((sample, algo_passed, judging_val))

    report.append(
        f"## Failure Details (Count: {len(failures)} / {metrics['total_samples']})"
    )
    if not failures:
        report.append("🎉 *All tests passed successfully!*")
    else:
        for sample, algo_passed, judging_val in failures:
            s_meta = sample.get("metadata") or {}
            name = s_meta.get("name") or f"Sample {sample.get('id')}"
            report.append(f"### ❌ Sample: `{name}`")
            report.append(
                f"- **Algorithmic Schema**: `{'PASS' if algo_passed else 'FAIL'}`"
            )
            report.append(f"- **LLM Judge Grade**: `{judging_val}`")
            prompt_str = str(sample.get("input") or "")
            quoted_prompt = prompt_str.replace("\n", "\n  > ")
            report.append(f"- **Prompt**:\n  > {quoted_prompt}")
            report.append("")

            output_content = ""
            for event in sample.get("events") or []:
                if isinstance(event, dict) and event.get("event") == "model":
                    out_obj = event.get("output")
                    if isinstance(out_obj, dict):
                        output_content = out_obj.get("completion", "") or ""
                    break

            report.append("- **Raw Model Output**:")
            report.append("  ```")
            for line in output_content.splitlines():
                report.append(f"  {line}")
            report.append("  ```")
            report.append("")

            if not algo_passed:
                a2ui_sc = {}
                if isinstance(s_scores, dict):
                    a2ui_sc = s_scores.get("a2ui_scorer") or {}
                elif isinstance(s_scores, list):
                    for sc in s_scores:
                        if isinstance(sc, dict) and sc.get("name") == "a2ui_scorer":
                            a2ui_sc = sc
                            break
                expl = (
                    a2ui_sc.get("explanation") if isinstance(a2ui_sc, dict) else "N/A"
                )
                report.append("- **Algorithmic Failure Explanation**:")
                report.append("  > " + str(expl or "N/A").replace("\n", "\n  > "))
                report.append("")

            if judging_val != "C":
                qa_sc = {}
                if isinstance(s_scores, dict):
                    qa_sc = s_scores.get("measured_model_graded_qa") or {}
                elif isinstance(s_scores, list):
                    for sc in s_scores:
                        if (
                            isinstance(sc, dict)
                            and sc.get("name") == "measured_model_graded_qa"
                        ):
                            qa_sc = sc
                            break
                expl = qa_sc.get("explanation") if isinstance(qa_sc, dict) else "N/A"
                report.append("- **LLM Judge Explanation**:")
                report.append("  > " + str(expl or "N/A").replace("\n", "\n  > "))
                report.append("")

    return "\n".join(report)
