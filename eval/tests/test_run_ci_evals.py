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

"""Unit tests for run_ci_evals.py."""

import os
import sys
import pytest

# Add bin directory to path to import run_ci_evals
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../bin")))
from run_ci_evals import check_threshold, build_main_command
from report_evals import extract_accuracy, print_results_summary, generate_markdown_summary
import argparse


def test_extract_accuracy_valid():
  log_data = {"results": {"scores": [{"metrics": {"accuracy": {"value": 0.85}}}]}}
  assert extract_accuracy(log_data) == 0.85


def test_extract_accuracy_no_scores():
  log_data = {"results": {}}
  with pytest.raises(ValueError, match="No scores found"):
    extract_accuracy(log_data)


def test_extract_accuracy_no_accuracy():
  log_data = {"results": {"scores": [{"metrics": {}}]}}
  with pytest.raises(ValueError, match="Could not find accuracy"):
    extract_accuracy(log_data)


def test_extract_accuracy_null_accuracy():
  log_data = {"results": {"scores": [{"metrics": {"accuracy": None}}]}}
  with pytest.raises(ValueError, match="Could not find accuracy"):
    extract_accuracy(log_data)


def test_check_threshold_pass():
  assert check_threshold(85.0, 80.0) is True
  assert check_threshold(80.0, 80.0) is True


def test_check_threshold_fail():
  assert check_threshold(75.0, 80.0) is False


def test_build_main_command_default():
  args = argparse.Namespace(
      model="google/gemini-3-flash-preview",
      max_samples=100,
      grading_model="google/gemini-3.5-flash",
  )
  seed = "20260507"
  cmd = build_main_command(args, seed)
  assert cmd == [
      "uv",
      "run",
      "python",
      "main.py",
      "--model",
      "google/gemini-3-flash-preview",
      "--sample-shuffle",
      seed,
      "--log-dir",
      f"logs/{seed}",
      "--max-retries",
      "10",
      "--grading-model",
      "google/gemini-3.5-flash",
      "--limit",
      "100",
  ]


def test_build_main_command_no_limit():
  args = argparse.Namespace(
      model="google/gemini-3-flash-preview",
      max_samples=0,
      grading_model="google/gemini-3.5-flash",
  )
  seed = "20260507"
  cmd = build_main_command(args, seed)
  assert "--limit" not in cmd


def test_print_results_summary_valid(capsys):
  log_data = {
      "samples": [
          {
              "id": 1,
              "metadata": {"name": "test_task", "evaluation_duration_seconds": 5.0},
              "scores": {
                  "a2ui_scorer": {"value": 1.0, "explanation": "Perfect"},
                  "measured_model_graded_qa": {"value": "C", "explanation": "Correct"},
              },
              "events": [],
          },
          {
              "id": 2,
              "metadata": {"name": "test_task_2", "evaluation_duration_seconds": 10.0},
              "scores": {
                  "a2ui_scorer": {"value": 1.0, "explanation": "Perfect"},
                  "measured_model_graded_qa": {"value": "C", "explanation": "Correct"},
              },
              "events": [],
          },
      ]
  }
  print_results_summary(log_data)
  captured = capsys.readouterr()
  assert (
      "test_task                 | Algorithmic: PASS | Judging: C  | Inference Time:"
      " 5.00s"
      in captured.out
  )
  assert (
      "test_task_2               | Algorithmic: PASS | Judging: C  | Inference Time:"
      " 10.00s"
      in captured.out
  )
  assert "Inference Time - Average: 7.50s | Median: 7.50s" in captured.out


def test_print_results_summary_fail(capsys):
  log_data = {
      "samples": [{
          "id": 2,
          "metadata": {"name": "fail_task"},
          "scores": {
              "a2ui_scorer": {"value": 0.0, "explanation": "Missing component"},
              "measured_model_graded_qa": {"value": "I", "explanation": "Incorrect"},
          },
          "events": [],
      }]
  }
  print_results_summary(log_data)
  captured = capsys.readouterr()
  assert (
      "fail_task                 | Algorithmic: FAIL | Judging: I  | Inference"
      " Time: N/A"
      in captured.out
  )
  assert "  [Algorithmic Failure Reason]:" in captured.out
  assert "    Missing component" in captured.out
  assert "  [Judging Failure Reason (Grade I)]:" in captured.out
  assert "    Incorrect" in captured.out


def test_generate_markdown_summary_valid():
  log_data = {
      "eval": {"task": "test_task", "model": "test_model"},
      "samples": [{
          "id": 1,
          "metadata": {"name": "sample_1", "evaluation_duration_seconds": 5.0},
          "scores": {
              "a2ui_scorer": {"value": 1.0, "explanation": "Perfect"},
              "measured_model_graded_qa": {"value": "C", "explanation": "Correct"},
          },
      }],
  }
  summary = generate_markdown_summary(log_data, 100.0, 90.0)
  assert "### Evaluation Summary: test_task" in summary
  assert "- **Status**: PASS" in summary
  assert "- **Model**: `test_model`" in summary
  assert "- **Pass Percentage**: `100.00%` (Threshold: `90.00%`)" in summary
  assert "| sample_1 | PASS | C | 5.00s | PASS |" in summary
  assert "#### Failure Details" not in summary


def test_generate_markdown_summary_fail():
  log_data = {
      "eval": {"task": "test_task", "model": "test_model"},
      "samples": [{
          "id": 2,
          "metadata": {"name": "sample_2", "evaluation_duration_seconds": 10.0},
          "scores": {
              "a2ui_scorer": {
                  "value": 0.0,
                  "explanation": "Missing components\nSecond line error",
              },
              "measured_model_graded_qa": {"value": "I", "explanation": "Incomplete"},
          },
      }],
  }
  summary = generate_markdown_summary(log_data, 0.0, 90.0)
  assert "### Evaluation Summary: test_task" in summary
  assert "- **Status**: FAIL" in summary
  assert "| sample_2 | FAIL | I | 10.00s | FAIL |" in summary
  assert "#### Failure Details" in summary
  assert "##### sample_2" in summary
  assert "- **Algorithmic Failure Reason**:" in summary
  assert "  > Missing components" in summary
  assert "  > Second line error" in summary
  assert "- **Judging Failure Reason (Grade I)**:" in summary
  assert "  > Incomplete" in summary
