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


def extract_accuracy(log_data: dict) -> float:
  """Extracts accuracy from parsed JSON log data.

  Args:
      log_data: Parsed JSON data from inspect log dump.

  Returns:
      The accuracy score as a float.

  Raises:
      ValueError: If scores or accuracy are not found or invalid.
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


def print_results_summary(log_data: dict):
  """Prints a summary of the results for each sample.

  Args:
      log_data: Parsed JSON data from inspect log dump.
  """
  samples = log_data.get("samples", [])
  print("\n=== Evaluation Results Summary ===")
  durations = []
  for sample in samples:
    name = sample.get("metadata", {}).get("name") or f"Sample {sample.get('id')}"
    scores = sample.get("scores", {})

    # Algorithmic validity (a2ui_scorer)
    a2ui_score = scores.get("a2ui_scorer", {})
    a2ui_passed = a2ui_score.get("value") == 1.0
    a2ui_str = "PASS" if a2ui_passed else "FAIL"

    # Judging results (measured_model_graded_qa)
    qa_score = scores.get("measured_model_graded_qa", {})
    qa_val = qa_score.get("value", "N/A")

    inference_time = None
    for event in sample["events"]:
      if event["event"] == "model":
        inference_time = event.get("working_time") or event.get("duration")
        break
    if inference_time is None:
      inference_time = sample.get("metadata", {}).get("evaluation_duration_seconds")
    inference_time_str = (
        f"{float(inference_time):.2f}s" if inference_time is not None else "N/A"
    )

    print(
        f"{name:<25} | Algorithmic: {a2ui_str:<4} | Judging: {qa_val:<2} | Inference"
        f" Time: {inference_time_str}"
    )

    if not a2ui_passed or qa_val != "C":
      if not a2ui_passed:
        print(f"  [Algorithmic Failure Reason]:")
        expl = a2ui_score.get("explanation") or "No explanation provided."
        for line in expl.splitlines():
          print(f"    {line}")
      if qa_val != "C":
        print(f"  [Judging Failure Reason (Grade {qa_val})]:")
        expl = qa_score.get("explanation") or "No explanation provided."
        for line in expl.splitlines():
          print(f"    {line}")

    if inference_time is not None:
      durations.append(float(inference_time))

  print("==================================")
  if durations:
    avg_duration = statistics.mean(durations)
    med_duration = statistics.median(durations)
    print(
        f"Inference Time - Average: {avg_duration:.2f}s | Median: {med_duration:.2f}s"
    )
    print("==================================")


def generate_markdown_summary(
    log_data: dict, accuracy_percentage: float, threshold: float
) -> str:
  """Generates a markdown summary of the evaluation results.

  Args:
      log_data: Parsed JSON data from inspect log dump.
      accuracy_percentage: The calculated accuracy percentage.
      threshold: The threshold to compare against.

  Returns:
      A string containing the markdown summary.
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
  lines.append("#### Sample Results")
  lines.append("| Sample / Task | Algorithmic | Judging | Inference Time | Status |")
  lines.append("| :--- | :---: | :---: | :---: | :---: |")

  samples = log_data.get("samples", []) or []
  failures = []

  for sample in samples:
    name = sample.get("metadata", {}).get("name") or f"Sample {sample.get('id')}"
    scores = sample.get("scores", {}) or {}

    # Algorithmic validity (a2ui_scorer)
    a2ui_score = scores.get("a2ui_scorer", {}) or {}
    a2ui_passed = a2ui_score.get("value") == 1.0
    a2ui_str = "PASS" if a2ui_passed else "FAIL"

    # Judging results (measured_model_graded_qa)
    qa_score = scores.get("measured_model_graded_qa", {}) or {}
    qa_val = qa_score.get("value", "N/A")

    inference_time = sample.get("metadata", {}).get("evaluation_duration_seconds")
    inference_time_str = (
        f"{float(inference_time):.2f}s" if inference_time is not None else "N/A"
    )

    # Overall sample status
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


def load_log_data(log_path: str) -> dict:
  """Runs inspect log dump to get JSON and parses it.

  Args:
      log_path: Path to the .eval log file.

  Returns:
      Parsed JSON data as a dictionary.
  """
  dump_cmd = ["uv", "run", "inspect", "log", "dump", log_path]
  dump_output = subprocess.check_output(dump_cmd, text=True)
  return json.loads(dump_output)


def main():
  parser = argparse.ArgumentParser(
      description="Report results from an Inspect AI eval log file."
  )
  parser.add_argument("log", type=str, help="Path to the .eval log file.")
  args = parser.parse_args()

  if not os.path.exists(args.log):
    print(f"Error: Log file not found: {args.log}")
    sys.exit(1)

  print(f"Processing log file: {args.log}")

  try:
    log_data = load_log_data(args.log)

    # Print summary of results per sample
    print_results_summary(log_data)

    try:
      accuracy = extract_accuracy(log_data)
      percentage = accuracy * 100
      print(f"Pass percentage: {percentage:.2f}%")
      sys.exit(0)
    except ValueError as e:
      print(f"Error: {e}")
      sys.exit(1)

  except subprocess.CalledProcessError as e:
    print(f"Error running inspect log dump: {e}")
    sys.exit(e.returncode)
  except Exception as e:
    print(f"Error processing log file: {e}")
    sys.exit(1)


if __name__ == "__main__":
  main()
