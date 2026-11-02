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

"""Tests for the combined Stage 1/2 + judge pass rate in report_evals.py."""

import os
import sys
from typing import Any

import pytest

# Add bin directory to path to import report_evals
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../bin")))
from report_evals import (  # pylint: disable=wrong-import-position
    extract_accuracy,
    generate_markdown_summary,
    print_results_summary,
)


def _sample(name: str, a2ui: float, judge: str | None) -> dict[str, Any]:
    scores: dict[str, Any] = {"a2ui_scorer": {"value": a2ui}}
    if judge is not None:
        scores["measured_model_graded_qa"] = {"value": judge}
    return {"id": name, "metadata": {"name": name}, "scores": scores}


_FOUR_SAMPLES = [
    _sample("pass-1", 1.0, "C"),
    _sample("pass-2", 1.0, "C"),
    _sample("pass-3", 1.0, "C"),
    _sample("partial-judge", 1.0, "P"),
]

# Stage 1 accuracy alone would be 1.0 here; the combined rule must win.
_STAGE1_ONLY_RESULTS = {"scores": [{"metrics": {"accuracy": {"value": 1.0}}}]}


def test_extract_accuracy_combines_stage12_and_judge() -> None:
    log_data = {"results": _STAGE1_ONLY_RESULTS, "samples": _FOUR_SAMPLES}
    assert extract_accuracy(log_data) == 0.75


def test_extract_accuracy_counts_stage1_failure_as_fail() -> None:
    log_data = {
        "results": _STAGE1_ONLY_RESULTS,
        "samples": [_sample("ok", 1.0, "C"), _sample("invalid", 0.0, "C")],
    }
    assert extract_accuracy(log_data) == 0.5


def test_extract_accuracy_matches_summaries() -> None:
    log_data = {
        "eval": {"task": "t", "model": "m"},
        "results": _STAGE1_ONLY_RESULTS,
        "samples": _FOUR_SAMPLES,
    }
    accuracy = extract_accuracy(log_data)
    markdown = generate_markdown_summary(log_data, accuracy * 100, 50.0)
    assert "| partial-judge | PASS | P | N/A | FAIL |" in markdown
    assert markdown.count("| PASS |\n") == 3


def test_print_results_summary_counts_match_extract_accuracy(
    capsys: pytest.CaptureFixture[str],
) -> None:
    log_data = {"results": _STAGE1_ONLY_RESULTS, "samples": _FOUR_SAMPLES}
    print_results_summary(log_data)
    out = capsys.readouterr().out
    assert "default         : 3/4 passed (75.00%)" in out
    assert extract_accuracy(log_data) == 0.75


def test_extract_accuracy_falls_back_without_samples() -> None:
    log_data: dict[str, Any] = {
        "results": {"scores": [{"metrics": {"accuracy": {"value": 0.85}}}]}
    }
    assert extract_accuracy(log_data) == 0.85
    log_data["samples"] = []
    assert extract_accuracy(log_data) == 0.85


def test_extract_accuracy_falls_back_when_only_one_scorer_ran() -> None:
    log_data = {
        "results": {"scores": [{"metrics": {"accuracy": {"value": 0.4}}}]},
        "samples": [_sample("a", 1.0, None), _sample("b", 1.0, None)],
    }
    assert extract_accuracy(log_data) == 0.4


def test_extract_accuracy_no_scores_still_raises() -> None:
    with pytest.raises(ValueError, match="No scores found in log file."):
        extract_accuracy({"results": {"scores": []}})
    with pytest.raises(ValueError, match="No scores found in log file."):
        extract_accuracy({"samples": [_sample("a", 1.0, None)]})


def test_extract_accuracy_no_accuracy_metric_still_raises() -> None:
    with pytest.raises(ValueError, match="Could not find accuracy metric in log file."):
        extract_accuracy({"results": {"scores": [{"metrics": {}}]}})
    with pytest.raises(ValueError, match="Could not find accuracy metric in log file."):
        extract_accuracy(
            {"results": {"scores": [{"metrics": {"accuracy": {"value": None}}}]}}
        )
