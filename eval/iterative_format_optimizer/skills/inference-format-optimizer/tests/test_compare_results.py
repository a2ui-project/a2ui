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

"""Unit tests for compare_results.py."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


from compare_results import (
    compute_s_opt,
    extract_metrics,
    format_delta_pct,
    generate_markdown_table,
    main,
    resolve_results_file,
)


class TestCompareResults(unittest.TestCase):

    def test_format_delta_pct(self) -> None:
        self.assertEqual(format_delta_pct(100, 100), "0.0%")
        self.assertEqual(format_delta_pct(150, 100), "+50.0%")
        self.assertEqual(format_delta_pct(50, 100), "-50.0%")
        self.assertEqual(
            format_delta_pct(0.8, 0.6, is_percentage_points=True), "+20.0%"
        )
        self.assertEqual(format_delta_pct(None, 100), "-")

    def test_compute_s_opt(self) -> None:
        b = {
            "schema_acc": 1.0,
            "quality_acc": 1.0,
            "avg_input_tokens": 1000,
            "avg_reasoning_tokens": 500,
            "avg_output_tokens": 200,
            "avg_duration": 2.0,
        }
        c = {
            "schema_acc": 1.0,
            "quality_acc": 1.0,
            "avg_input_tokens": 800,
            "avg_reasoning_tokens": 400,
            "avg_output_tokens": 180,
            "avg_duration": 1.5,
        }
        score = compute_s_opt(c, b)
        self.assertTrue(score > 0)

    def test_resolve_results_file_direct_json(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
            f.write("{}")
            temp_path = f.name
        try:
            resolved = resolve_results_file(temp_path)
            self.assertEqual(resolved, temp_path)
        finally:
            os.remove(temp_path)

    @patch("subprocess.check_output")
    def test_resolve_results_file_eval_file(self, mock_check) -> None:
        mock_check.return_value = '{"results": {}}'
        with tempfile.NamedTemporaryFile(suffix=".eval", mode="w", delete=False) as f:
            f.write("{}")
            temp_path = f.name
        try:
            resolved = resolve_results_file(temp_path)
            self.assertTrue(resolved.endswith(".eval.json"))
        finally:
            os.remove(temp_path)
            if os.path.exists(temp_path + ".json"):
                os.remove(temp_path + ".json")

    def test_resolve_results_file_dir_with_results_json(self) -> None:
        temp_dir = tempfile.mkdtemp()
        res_json = os.path.join(temp_dir, "results.json")
        with open(res_json, "w") as f:
            f.write("{}")
        try:
            resolved = resolve_results_file(temp_dir)
            self.assertEqual(resolved, res_json)
        finally:
            shutil.rmtree(temp_dir)

    def test_resolve_results_file_dir_with_run_meta_json(self) -> None:
        temp_dir = tempfile.mkdtemp()
        meta_json = os.path.join(temp_dir, "run_meta.json")
        with open(meta_json, "w") as f:
            json.dump({"metrics": {"schema_acc": 1.0}}, f)
        try:
            resolved = resolve_results_file(temp_dir)
            self.assertEqual(resolved, meta_json)
        finally:
            shutil.rmtree(temp_dir)

    def test_resolve_results_file_dir_with_flat_budget_run_meta_json(self) -> None:
        temp_dir = tempfile.mkdtemp()
        flat_meta_json = os.path.join(temp_dir, "unbounded_run_meta.json")
        with open(flat_meta_json, "w") as f:
            json.dump({"metrics": {"schema_acc": 1.0}}, f)
        try:
            resolved = resolve_results_file(temp_dir)
            self.assertEqual(resolved, flat_meta_json)
        finally:
            shutil.rmtree(temp_dir)

    @patch("subprocess.check_output")
    def test_resolve_results_file_dir_with_eval_files(self, mock_check) -> None:
        mock_check.return_value = '{"results": {}}'
        temp_dir = tempfile.mkdtemp()
        eval_file = os.path.join(temp_dir, "sample.eval")
        with open(eval_file, "w") as f:
            f.write("{}")
        try:
            resolved = resolve_results_file(temp_dir)
            self.assertTrue(resolved.endswith("results.json"))
        finally:
            shutil.rmtree(temp_dir)

    def test_resolve_results_file_not_found(self) -> None:
        temp_dir = tempfile.mkdtemp()
        try:
            with self.assertRaises(FileNotFoundError):
                resolve_results_file(temp_dir)
        finally:
            shutil.rmtree(temp_dir)

    def test_extract_metrics_from_full_samples(self) -> None:
        temp_dir = tempfile.mkdtemp()
        res_json = os.path.join(temp_dir, "results.json")
        data = {
            "eval": {"task": "a2ui_task"},
            "stats": {
                "started_at": "2026-07-21T10:00:00Z",
                "completed_at": "2026-07-21T10:01:00Z",
                "model_usage": {"gemini": {"input_tokens": 1000, "output_tokens": 500}},
            },
            "samples": [
                {
                    "id": "s1",
                    "metadata": {"name": "sample_1"},
                    "scores": {
                        "a2ui_scorer": {"value": 1.0},
                        "measured_model_graded_qa": {"value": "C"},
                    },
                    "events": [{
                        "event": "model",
                        "working_time": 1.5,
                        "call": {
                            "response": {"usageMetadata": {"thoughtsTokenCount": 100}}
                        },
                    }],
                },
                {
                    "id": "s2",
                    "metadata": {"name": "sample_2"},
                    "scores": {
                        "a2ui_scorer": {"value": 0.0},
                        "measured_model_graded_qa": {"value": "I"},
                    },
                    "events": [{
                        "event": "model",
                        "working_time": 2.5,
                        "call": {
                            "response": {"usageMetadata": {"thoughtsTokenCount": 200}}
                        },
                    }],
                },
            ],
        }
        with open(res_json, "w") as f:
            json.dump(data, f)
        try:
            m = extract_metrics(res_json, use_median=False)
            self.assertEqual(m["sample_count"], 2)
            self.assertEqual(m["schema_acc"], 0.5)
            self.assertEqual(m["quality_acc"], 0.5)

            # Test sample ID filter
            m_filt = extract_metrics(res_json, filter_sample_ids={"s1"})
            self.assertEqual(m_filt["sample_count"], 1)
            self.assertEqual(m_filt["schema_acc"], 1.0)
        finally:
            shutil.rmtree(temp_dir)

    def test_generate_markdown_table(self) -> None:
        base_metrics = {
            "name": "base",
            "sample_count": 5,
            "schema_acc": 1.0,
            "quality_acc": 1.0,
            "wall_clock_per_sample": 2.0,
            "avg_duration": 2.0,
            "est_code_time": 0.5,
            "avg_input_tokens": 5000,
            "avg_reasoning_tokens": 2000,
            "avg_output_tokens": 300,
            "code_tokens_median": 300,
            "reasoning_tokens_median": 2000,
            "input_tokens_median": 5000,
            "latency_seconds_median": 2.0,
        }
        current_metrics = {
            "name": "run_001",
            "run_name": "run_001",
            "sample_count": 5,
            "schema_acc": 1.0,
            "quality_acc": 1.0,
            "wall_clock_per_sample": 1.5,
            "avg_duration": 1.5,
            "est_code_time": 0.4,
            "avg_input_tokens": 4000,
            "avg_reasoning_tokens": 1500,
            "avg_output_tokens": 250,
            "code_tokens_median": 250,
            "reasoning_tokens_median": 1500,
            "input_tokens_median": 4000,
            "latency_seconds_median": 1.5,
        }

        table = generate_markdown_table(base_metrics, [current_metrics])
        self.assertIn("A2UI Evaluation Comparison & Baseline Delta", table)
        self.assertIn("run_001", table)

    def test_main_cli_execution(self) -> None:
        temp_dir = tempfile.mkdtemp()
        base_dir = os.path.join(temp_dir, "base")
        curr_dir = os.path.join(temp_dir, "curr")
        out_file = os.path.join(temp_dir, "report.md")
        os.makedirs(base_dir, exist_ok=True)
        os.makedirs(curr_dir, exist_ok=True)

        meta_data = {
            "metrics": {
                "schema_acc": 1.0,
                "quality_acc": 1.0,
                "code_tokens_median": 300,
                "reasoning_tokens_median": 2000,
                "input_tokens_median": 5000,
                "latency_seconds_median": 3.0,
                "total_samples": 5,
            }
        }

        with open(os.path.join(base_dir, "run_meta.json"), "w") as f:
            json.dump(meta_data, f)

        with open(os.path.join(curr_dir, "run_meta.json"), "w") as f:
            json.dump(meta_data, f)

        try:
            with patch("sys.stdout"):
                main([
                    "--baseline",
                    base_dir,
                    "--average",
                    "--output",
                    out_file,
                    curr_dir,
                ])
            self.assertTrue(os.path.exists(out_file))
        finally:
            shutil.rmtree(temp_dir)

    def test_main_cli_median_and_multiple_dirs(self) -> None:
        temp_dir = tempfile.mkdtemp()
        base_dir = os.path.join(temp_dir, "base")
        curr_dir1 = os.path.join(temp_dir, "curr1")
        curr_dir2 = os.path.join(temp_dir, "curr2")
        out_file = os.path.join(temp_dir, "report.md")
        os.makedirs(base_dir, exist_ok=True)
        os.makedirs(curr_dir1, exist_ok=True)
        os.makedirs(curr_dir2, exist_ok=True)

        meta_data = {
            "metrics": {
                "schema_acc": 0.9,
                "quality_acc": 0.8,
                "code_tokens_median": 300,
                "reasoning_tokens_median": 1000,
                "input_tokens_median": 2000,
                "latency_seconds_median": 2.0,
                "total_samples": 5,
            }
        }
        with open(os.path.join(base_dir, "run_meta.json"), "w") as f:
            json.dump(meta_data, f)
        with open(os.path.join(curr_dir1, "run_meta.json"), "w") as f:
            json.dump(meta_data, f)
        with open(os.path.join(curr_dir2, "run_meta.json"), "w") as f:
            json.dump(meta_data, f)

        try:
            with patch("sys.stdout"):
                main([
                    "--baseline",
                    base_dir,
                    "--output",
                    out_file,
                    curr_dir1,
                    curr_dir2,
                ])
            self.assertTrue(os.path.exists(out_file))
        finally:
            shutil.rmtree(temp_dir)

    def test_generate_markdown_table_mean(self) -> None:
        b = {
            "name": "base",
            "sample_count": 10,
            "schema_accuracy": 0.9,
            "quality_accuracy": 0.8,
            "avg_duration": 2.5,
            "avg_input_tokens": 1000,
            "avg_reasoning_tokens": 500,
            "avg_output_tokens": 200,
            "est_code_time": 1.2,
            "wall_clock_per_sample": 0.5,
        }
        c = {
            "name": "curr",
            "sample_count": 10,
            "schema_acc": 0.95,
            "quality_acc": 0.85,
            "avg_duration": 2.0,
            "avg_input_tokens": 800,
            "avg_reasoning_tokens": 400,
            "avg_output_tokens": 180,
            "est_code_time": 1.0,
            "wall_clock_per_sample": 0.4,
        }
        md = generate_markdown_table(b, [c], use_median=False)
        self.assertIn("Average Metrics", md)
        self.assertIn("Score (S_opt)", md)
        self.assertIn("curr", md)

    @patch("subprocess.check_output")
    def test_resolve_results_file_eval_success(self, mock_check) -> None:
        mock_check.return_value = json.dumps({"samples": []})
        temp_dir = tempfile.mkdtemp()
        try:
            eval_file = os.path.join(temp_dir, "test.eval")
            with open(eval_file, "w") as f:
                f.write("raw eval")
            res = resolve_results_file(temp_dir)
            self.assertTrue(res.endswith("results.json"))
            self.assertTrue(os.path.exists(res))
        finally:
            shutil.rmtree(temp_dir)

    def test_resolve_results_file_flat_and_subdirs(self) -> None:
        temp_dir = tempfile.mkdtemp()
        try:
            # Flat budget file
            flat_file = os.path.join(temp_dir, "budget_0_run_meta.json")
            with open(flat_file, "w") as f:
                json.dump({"metrics": {"schema_acc": 1.0}}, f)
            res = resolve_results_file(temp_dir)
            self.assertEqual(res, flat_file)

            # Subdir results file
            os.remove(flat_file)
            sub_dir = os.path.join(temp_dir, "unbounded")
            os.makedirs(sub_dir, exist_ok=True)
            sub_res = os.path.join(sub_dir, "results.json")
            with open(sub_res, "w") as f:
                json.dump({"samples": []}, f)
            res2 = resolve_results_file(temp_dir)
            self.assertEqual(res2, sub_res)
        finally:
            shutil.rmtree(temp_dir)

    def test_resolve_results_file_not_found_dir(self) -> None:
        temp_dir = tempfile.mkdtemp()
        try:
            with self.assertRaises(FileNotFoundError):
                resolve_results_file(temp_dir)
        finally:
            shutil.rmtree(temp_dir)

    def test_extract_metrics_use_average(self) -> None:
        temp_dir = tempfile.mkdtemp()
        res_json = os.path.join(temp_dir, "results.json")
        sample_log = {
            "samples": [
                {
                    "id": "s1",
                    "metadata": {
                        "inference_input_tokens": 1000,
                        "inference_output_tokens": 200,
                        "inference_reasoning_tokens": 500,
                        "inference_duration_seconds": 2.0,
                    },
                    "scores": {
                        "a2ui_scorer": {"value": 1.0},
                        "measured_model_graded_qa": {"value": "C"},
                    },
                    "events": [{
                        "event": "model",
                        "working_time": 2.0,
                        "usage": {
                            "input_tokens": 1000,
                            "output_tokens": 200,
                            "reasoning_tokens": 500,
                        },
                    }],
                },
                {
                    "id": "s2",
                    "metadata": {
                        "inference_input_tokens": 2000,
                        "inference_output_tokens": 400,
                        "inference_reasoning_tokens": 1000,
                        "inference_duration_seconds": 4.0,
                    },
                    "scores": {
                        "a2ui_scorer": {"value": "INCORRECT"},
                        "measured_model_graded_qa": {"value": 0.0},
                    },
                    "events": [{
                        "event": "model",
                        "working_time": 4.0,
                        "usage": {
                            "input_tokens": 2000,
                            "output_tokens": 400,
                            "reasoning_tokens": 1000,
                        },
                    }],
                },
            ],
            "stats": {"started_at": 100, "completed_at": 110},
        }
        with open(res_json, "w") as f:
            json.dump(sample_log, f)
        try:
            m = extract_metrics(res_json, use_median=False)
            self.assertEqual(m["schema_acc"], 0.5)
            self.assertEqual(m["avg_duration"], 3.0)
            self.assertEqual(m["avg_input_tokens"], 1500.0)
            self.assertEqual(m["avg_reasoning_tokens"], 750.0)
            self.assertEqual(m["avg_output_tokens"], 300.0)
        finally:
            shutil.rmtree(temp_dir)

    def test_format_delta_pct_utility(self) -> None:
        from compare_results import format_delta_pct

        self.assertEqual(format_delta_pct(None, 10.0), "-")
        self.assertEqual(format_delta_pct(10.0, None), "-")
        self.assertEqual(format_delta_pct(10.0, 0.0), "-")
        self.assertEqual(format_delta_pct(12.0, 10.0), "+20.0%")
        self.assertEqual(format_delta_pct(8.0, 10.0), "-20.0%")
        self.assertEqual(
            format_delta_pct(0.9, 0.8, is_percentage_points=True), "+10.0%"
        )
        self.assertEqual(
            format_delta_pct(0.7, 0.8, is_percentage_points=True), "-10.0%"
        )

    def test_compute_s_opt_utility(self) -> None:
        from compare_results import compute_s_opt

        m = {
            "schema_acc": 0.9,
            "quality_acc": 0.8,
            "avg_output_tokens": 100.0,
            "avg_reasoning_tokens": 50.0,
            "avg_input_tokens": 500.0,
        }
        b = {
            "schema_acc": 0.9,
            "quality_acc": 0.8,
            "avg_output_tokens": 100.0,
            "avg_reasoning_tokens": 50.0,
            "avg_input_tokens": 500.0,
        }
        s_opt = compute_s_opt(m, b)
        self.assertTrue(isinstance(s_opt, float))

    def test_generate_markdown_table_utility(self) -> None:
        from compare_results import generate_markdown_table

        b = {
            "name": "base_run",
            "sample_count": 51,
            "schema_acc": 0.9,
            "quality_acc": 0.8,
            "avg_duration": 2.5,
            "est_code_time": 1.5,
            "avg_input_tokens": 1000,
            "avg_reasoning_tokens": 200,
            "avg_output_tokens": 300,
            "wall_clock_per_sample": 0.5,
        }
        c = {
            "name": "comp_run",
            "sample_count": 51,
            "schema_acc": 0.95,
            "quality_acc": 0.85,
            "avg_duration": 2.0,
            "est_code_time": 1.2,
            "avg_input_tokens": 800,
            "avg_reasoning_tokens": 150,
            "avg_output_tokens": 250,
            "wall_clock_per_sample": 0.4,
        }
        tbl = generate_markdown_table(b, [c], use_median=True)
        self.assertIn("A2UI Evaluation Comparison", tbl)
        self.assertIn("base_run", tbl)
        self.assertIn("comp_run", tbl)

    @patch("compare_results.extract_metrics")
    def test_compare_results_main_cli(self, mock_extract) -> None:
        from compare_results import main

        mock_extract.return_value = {
            "name": "test_run",
            "sample_count": 51,
            "schema_acc": 0.9,
            "quality_acc": 0.8,
            "avg_duration": 2.5,
            "est_code_time": 1.5,
            "avg_input_tokens": 1000,
            "avg_reasoning_tokens": 200,
            "avg_output_tokens": 300,
            "wall_clock_per_sample": 0.5,
        }
        temp_dir = tempfile.mkdtemp()
        r1 = os.path.join(temp_dir, "run1.json")
        b1 = os.path.join(temp_dir, "base.json")
        with open(r1, "w") as f:
            f.write("{}")
        with open(b1, "w") as f:
            f.write("{}")
        try:
            with patch("sys.argv", ["compare_results.py", "--baseline", b1, r1]):
                main()
        finally:
            shutil.rmtree(temp_dir)

    def test_extract_metrics_dict_samples_structure(self) -> None:
        from compare_results import extract_metrics

        temp_dir = tempfile.mkdtemp()
        res_json = os.path.join(temp_dir, "results.json")
        dict_data = {
            "eval": {"task": "dict_task"},
            "samples": {
                "s1": {
                    "schema_passed": True,
                    "quality_passed": True,
                    "code_tokens": 100,
                    "reasoning_tokens": 500,
                    "input_tokens": 1000,
                    "latency_seconds": 2.0,
                },
                "s2": {
                    "schema_passed": False,
                    "quality_passed": False,
                    "code_tokens": 150,
                    "reasoning_tokens": 600,
                    "input_tokens": 1200,
                    "latency_seconds": 2.5,
                },
            },
        }
        with open(res_json, "w") as f:
            json.dump(dict_data, f)

        try:
            res = extract_metrics(res_json, label_name="dict_samples")
            self.assertEqual(res["sample_count"], 2)
            self.assertEqual(res["schema_acc"], 0.5)
            self.assertEqual(res["quality_acc"], 0.5)
            self.assertEqual(res["avg_output_tokens"], 125.0)
            self.assertEqual(res["avg_input_tokens"], 1100.0)
        finally:
            shutil.rmtree(temp_dir)


if __name__ == "__main__":
    unittest.main()
