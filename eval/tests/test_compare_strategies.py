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

"""Unit tests for the compare_strategies CLI utility."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
from typing import Any
from unittest.mock import patch

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../bin")))
from compare_strategies import (
    main,
    render_markdown_table,
    summarize_log_groups,
)


def _synthetic_log(
    strategy: str,
    version: str,
    *,
    decision_backend: str | None = None,
    samples_count: int = 2,
    input_tokens: list[int] | None = None,
    output_tokens: list[int] | None = None,
    durations: list[float] | None = None,
    decision_latencies: list[float] | None = None,
    s1_pass: bool = True,
    judge_grade: str = "C",
) -> dict[str, Any]:
    samples = []
    for i in range(samples_count):
        in_tok = input_tokens[i] if input_tokens else 500
        out_tok = output_tokens[i] if output_tokens else 100
        dur = durations[i] if durations else 1.2
        dec_lat = decision_latencies[i] if decision_latencies else 25.0
        meta = {
            "name": f"sample_{i}",
            "strategy": strategy,
            "version": version,
            "inference_input_tokens": in_tok,
            "inference_output_tokens": out_tok,
            "inference_duration_seconds": dur,
        }
        if decision_backend:
            meta["decision_backend"] = decision_backend
            meta["decision_latency_ms"] = dec_lat
            meta["decision_stage"] = "archetype"
            meta["decision_archetype"] = "dashboard"

        scores = {
            "a2ui_scorer": {"value": 1.0 if s1_pass else 0.0},
            "measured_model_graded_qa": {"value": judge_grade},
        }
        samples.append({
            "id": i + 1,
            "metadata": meta,
            "scores": scores,
        })

    return {
        "eval": {
            "metadata": {
                "strategy": strategy,
                "version": version,
            }
        },
        "samples": samples,
    }


def test_summarize_log_groups_and_metrics() -> None:
    log_express = _synthetic_log(
        "express",
        "1.0",
        samples_count=2,
        input_tokens=[400, 600],
        output_tokens=[80, 120],
        durations=[1.0, 1.4],
    )
    log_decision = _synthetic_log(
        "decision",
        "1.0",
        decision_backend="mock",
        samples_count=2,
        input_tokens=[200, 300],
        output_tokens=[20, 40],
        durations=[0.4, 0.6],
        decision_latencies=[20.0, 40.0],
    )

    fake_logs = {
        "/fake/express.eval": log_express,
        "/fake/decision.eval": log_decision,
    }

    with patch("compare_strategies.load_log_data", side_effect=lambda p: fake_logs[p]):
        rows = summarize_log_groups(["/fake/express.eval", "/fake/decision.eval"])

    assert len(rows) == 2
    row_map = {r["strategy"]: r for r in rows}

    express_row = row_map["express"]
    assert express_row["version"] == "1.0"
    assert express_row["decision_backend"] is None
    assert express_row["total_samples"] == 2
    assert express_row["algorithmic_pass_rate"] == 1.0
    assert express_row["judge_pass_rate"] == 1.0
    assert express_row["median_input_tokens"] == 500.0
    assert express_row["median_output_tokens"] == 100.0
    assert express_row["median_duration_seconds"] == 1.2
    assert express_row["cached"] is False

    decision_row = row_map["decision"]
    assert decision_row["version"] == "1.0"
    assert decision_row["decision_backend"] == "mock"
    assert decision_row["total_samples"] == 2
    assert decision_row["median_input_tokens"] == 250.0
    assert decision_row["median_output_tokens"] == 30.0
    assert decision_row["median_duration_seconds"] == 0.5
    assert decision_row["median_decision_latency_ms"] == 30.0


def test_cached_row_omits_tokens_and_duration() -> None:
    cached_log = _synthetic_log(
        "decision",
        "1.0",
        decision_backend="jev",
        samples_count=2,
        input_tokens=[0, 0],
        output_tokens=[0, 0],
        durations=[0.01, 0.01],
        decision_latencies=[15.0, 15.0],
    )
    with patch("compare_strategies.load_log_data", return_value=cached_log):
        rows = summarize_log_groups(["/fake/cached.eval"])

    assert len(rows) == 1
    row = rows[0]
    assert row["cached"] is True
    assert row["median_input_tokens"] is None
    assert row["median_output_tokens"] is None
    assert row["median_duration_seconds"] is None
    assert row["median_decision_latency_ms"] == 15.0

    table = render_markdown_table(rows)
    assert "`decision`" in table
    assert "`jev`" in table
    assert "yes" in table


def test_compare_strategies_cli_json_export(tmp_path: Path) -> None:
    log_data = _synthetic_log("decision", "1.0", decision_backend="mock")
    out_json = str(tmp_path / "out.json")

    with patch(
        "compare_strategies.find_eval_logs", return_value=["/fake/decision.eval"]
    ), patch("compare_strategies.load_log_data", return_value=log_data):
        exit_code = main(["/fake/decision.eval", "--json", out_json])

    assert exit_code == 0
    assert Path(out_json).exists()
    with open(out_json, "r", encoding="utf-8") as f:
        loaded = json.load(f)
    assert len(loaded) == 1
    assert loaded[0]["strategy"] == "decision"
    assert loaded[0]["decision_backend"] == "mock"
