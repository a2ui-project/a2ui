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

"""Unit tests for eval/iterative/utils modules."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"

UTILS_DIR = SCRIPTS_DIR / "utils"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
if str(UTILS_DIR) not in sys.path:
    sys.path.insert(0, str(UTILS_DIR))


from utils import format_tools
from utils.archiver import _get_git_commit_sha, _slugify, archive_run
from utils.reporter import extract_metrics_from_log, generate_optimization_report
from utils.runner import (
    get_git_diff,
    load_log_data,
    run_evaluation,
    run_unit_tests,
)


class TestFormatTools(unittest.TestCase):

    def test_compile_snippet_atom(self) -> None:
        compiled = format_tools.test_compile_snippet("atom", '(Card (Text "Hello"))')
        payload = json.loads(compiled)
        self.assertEqual(payload["version"], "v1.0")

    def test_compile_snippet_express(self) -> None:
        compiled = format_tools.test_compile_snippet(
            "express", 'root = Text("Hello", _)\n'
        )
        payload = json.loads(compiled)
        self.assertTrue(len(payload) > 0)

    def test_compile_snippet_elemental(self) -> None:
        compiled = format_tools.test_compile_snippet(
            "elemental", '<body><ui-text text="Hello"></ui-text></body>\n'
        )
        payload = json.loads(compiled)
        self.assertTrue(len(payload) > 0)

    def test_compile_snippet_unsupported_raises(self) -> None:
        with self.assertRaises(ValueError):
            format_tools.test_compile_snippet("invalid_fmt", "foo")

    def test_decompile_payload_atom(self) -> None:
        payload = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "main",
                "components": [
                    {"id": "root", "component": "Card", "child": "node_0"},
                    {"id": "node_0", "component": "Text", "text": "Hello"},
                ],
            },
        }
        decompiled = format_tools.test_decompile_payload("atom", json.dumps(payload))
        self.assertIn("Card", decompiled)

    def test_decompile_payload_express(self) -> None:
        payload = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "main",
                "components": [
                    {"id": "root", "component": "Card", "child": "node_0"},
                    {"id": "node_0", "component": "Text", "text": "Hello"},
                ],
            },
        }
        decompiled = format_tools.test_decompile_payload("express", payload)
        self.assertTrue(len(decompiled) > 0)

    def test_decompile_payload_elemental(self) -> None:
        payload = {
            "version": "v1.0",
            "createSurface": {
                "surfaceId": "main",
                "components": [
                    {"id": "root", "component": "Card", "child": "node_0"},
                    {"id": "node_0", "component": "Text", "text": "Hello"},
                ],
            },
        }
        decompiled = format_tools.test_decompile_payload("elemental", payload)
        self.assertTrue(len(decompiled) > 0)

    def test_decompile_payload_unsupported_raises(self) -> None:
        with self.assertRaises(ValueError):
            format_tools.test_decompile_payload("invalid_fmt", {})

    def test_parse_ast_atom(self) -> None:
        parsed = format_tools.test_parse_ast("atom", '(Card (Text "Hello"))')
        ast = json.loads(parsed)
        self.assertEqual(ast[0][0], "Card")

    def test_parse_ast_express(self) -> None:
        parsed = format_tools.test_parse_ast("express", 'root = Text("Hello", _)\n')
        self.assertTrue(len(parsed) > 0)

    def test_parse_ast_elemental(self) -> None:
        parsed = format_tools.test_parse_ast(
            "elemental", '<body><ui-text text="Hello"></ui-text></body>\n'
        )
        self.assertTrue(len(parsed) > 0)

    def test_parse_ast_unsupported_raises(self) -> None:
        with self.assertRaises(ValueError):
            format_tools.test_parse_ast("invalid_fmt", "foo")


class TestArchiver(unittest.TestCase):

    def test_slugify(self) -> None:
        self.assertEqual(
            _slugify("Compiler-side dynamic event handler normalization!"),
            "compiler_side_dynamic_event_handler_norm",
        )
        self.assertEqual(_slugify(""), "run")

    def test_get_git_commit_sha(self) -> None:
        sha = _get_git_commit_sha(str(REPO_ROOT))
        self.assertTrue(len(sha) >= 7)

    @patch("subprocess.run")
    def test_get_git_commit_sha_failure(self, mock_run) -> None:
        mock_run.side_effect = Exception("git error")
        sha = _get_git_commit_sha(str(REPO_ROOT))
        self.assertEqual(sha, "0000000")

    def test_archive_run(self) -> None:
        temp_dir = tempfile.mkdtemp()
        try:
            temp_history = Path(temp_dir) / "eval" / "iterative" / "history"
            temp_history.mkdir(parents=True, exist_ok=True)
            report_file = Path(temp_dir) / "eval" / "iterative" / "current_report.md"
            report_file.write_text("# Report", encoding="utf-8")

            with patch("utils.archiver.Path") as mock_path:
                mock_path.resolve.return_value.parent.parent = (
                    Path(temp_dir) / "eval" / "iterative"
                )
                mock_path.return_value = Path(temp_dir) / "eval" / "iterative"

                target = archive_run(
                    format_name="atom",
                    hypothesis="Test hypothesis for archive run",
                    status="Kept",
                    notes="Pytest 100% pass",
                )
                self.assertTrue(os.path.exists(target))
                self.assertTrue(os.path.exists(os.path.join(target, "run_meta.json")))
                self.assertTrue(os.path.exists(os.path.join(target, "patch.diff")))

                with open(os.path.join(target, "run_meta.json"), "r") as f:
                    meta = json.load(f)
                    self.assertEqual(meta["format"], "atom")
                    self.assertEqual(meta["status"], "Kept")
                    self.assertEqual(meta["notes"], "Pytest 100% pass")
        finally:
            shutil.rmtree(temp_dir)

    @patch("subprocess.run")
    def test_archive_run_git_patch_failure(self, mock_run) -> None:
        mock_run.side_effect = Exception("git patch error")
        temp_dir = tempfile.mkdtemp()
        try:
            temp_history = Path(temp_dir) / "eval" / "iterative" / "history"
            temp_history.mkdir(parents=True, exist_ok=True)
            report_file = Path(temp_dir) / "eval" / "iterative" / "current_report.md"
            report_file.write_text("# Report", encoding="utf-8")

            with patch("utils.archiver.Path") as mock_path:
                mock_path.resolve.return_value.parent.parent = (
                    Path(temp_dir) / "eval" / "iterative"
                )
                mock_path.return_value = Path(temp_dir) / "eval" / "iterative"

                target = archive_run(
                    format_name="atom",
                    hypothesis="Test git diff error handling",
                    status="Reverted",
                )
                self.assertTrue(os.path.exists(os.path.join(target, "patch.diff")))
        finally:
            shutil.rmtree(temp_dir)


class TestRunnerAndReporter(unittest.TestCase):

    @patch("subprocess.run")
    def test_run_unit_tests(self, mock_run) -> None:
        mock_run.return_value = MagicMock(returncode=0, stdout="PASS", stderr="")
        res = run_unit_tests()
        self.assertTrue(res["success"])

    @patch("subprocess.run")
    def test_run_evaluation(self, mock_run) -> None:
        mock_run.return_value = MagicMock(returncode=0)
        res = run_evaluation(
            "atom", "google/gemini-3.5-flash", ["loginForm"], True, "/tmp/logs"
        )
        self.assertTrue(res)

    @patch("subprocess.check_output")
    def test_load_log_data(self, mock_check_output) -> None:
        mock_check_output.return_value = '{"results": {}}'
        res = load_log_data("/tmp/test.eval")
        self.assertEqual(res, {"results": {}})

    @patch("subprocess.run")
    def test_get_git_diff(self, mock_run) -> None:
        mock_run.return_value = MagicMock(stdout="diff content")
        diff = get_git_diff(str(REPO_ROOT))
        self.assertEqual(diff, "diff content")

    def test_extract_metrics_from_log_complete(self) -> None:
        log_data = {
            "results": {
                "scores": [
                    {"name": "a2ui_scorer", "metrics": {"accuracy": {"value": 1.0}}},
                    {
                        "name": "measured_model_graded_qa",
                        "metrics": {"accuracy": {"value": 1.0}},
                    },
                ]
            },
            "samples": [{
                "id": 1,
                "metadata": {
                    "inference_duration_seconds": 1.5,
                    "inference_input_tokens": 100,
                    "inference_output_tokens": 50,
                    "inference_reasoning_tokens": 10,
                },
                "events": [{
                    "event": "model",
                    "working_time": 1.5,
                    "call": {"response": {"usageMetadata": {"thoughtsTokenCount": 10}}},
                }],
            }],
        }
        metrics = extract_metrics_from_log(log_data)
        self.assertEqual(metrics["overall_accuracy"], 1.0)
        self.assertEqual(metrics["algo_accuracy"], 1.0)

    def test_generate_optimization_report_with_failures(self) -> None:
        log_data = {
            "results": {
                "scores": [
                    {"name": "a2ui_scorer", "metrics": {"accuracy": {"value": 0.5}}},
                    {
                        "name": "measured_model_graded_qa",
                        "metrics": {"accuracy": {"value": 0.5}},
                    },
                ]
            },
            "samples": [{
                "id": 1,
                "input": "Sample prompt",
                "metadata": {"name": "sample_1", "inference_duration_seconds": 2.0},
                "scores": {
                    "a2ui_scorer": {"value": 0.0, "explanation": "Syntax error"},
                    "measured_model_graded_qa": {
                        "value": "I",
                        "explanation": "Incomplete",
                    },
                },
                "events": [{"event": "model", "output": {"completion": "(Card ...)"}}],
            }],
        }
        pytest_res = {
            "success": False,
            "stdout": "Test failed",
            "stderr": "Error trace",
        }
        report = generate_optimization_report(
            log_data=log_data,
            pytest_results=pytest_res,
            baseline_data=None,
            git_diff="active diff",
            format_name="atom",
            model="google/gemini-3.5-flash",
        )
        self.assertIn("# Inference Format Optimization Report", report)
        self.assertIn("Pytest Unit Test Failures", report)

    def test_generate_optimization_report_with_baseline(self) -> None:
        log_data = {
            "results": {
                "scores": [
                    {"name": "a2ui_scorer", "metrics": {"accuracy": {"value": 1.0}}},
                    {
                        "name": "measured_model_graded_qa",
                        "metrics": {"accuracy": {"value": 1.0}},
                    },
                ]
            },
            "samples": [],
        }
        baseline_data = {
            "results": {
                "scores": [
                    {"name": "a2ui_scorer", "metrics": {"accuracy": {"value": 0.8}}},
                    {
                        "name": "measured_model_graded_qa",
                        "metrics": {"accuracy": {"value": 0.8}},
                    },
                ]
            },
            "samples": [],
        }
        pytest_res = {"success": True, "stdout": "All passed", "stderr": ""}
        report = generate_optimization_report(
            log_data=log_data,
            pytest_results=pytest_res,
            baseline_data=baseline_data,
            git_diff="",
            format_name="atom",
            model="google/gemini-3.5-flash",
        )
        self.assertIn("## Summary Table", report)
        self.assertIn("Overall Pass Rate", report)
        self.assertIn("All tests passed successfully", report)

    def test_generate_optimization_report_with_failures(self) -> None:
        from utils.reporter import generate_optimization_report

        log_data = {
            "results": {"scores": []},
            "samples": [{
                "id": "sample_fail_1",
                "metadata": {"name": "failing_sample"},
                "input": "Generate a broken component",
                "scores": {
                    "a2ui_scorer": {
                        "value": 0.0,
                        "explanation": "Syntax error in payload",
                    },
                    "measured_model_graded_qa": {
                        "value": "I",
                        "explanation": "Incorrect layout structure",
                    },
                },
                "events": [{
                    "event": "model",
                    "output": {"completion": "(Text 'broken')"},
                }],
            }],
        }
        pytest_results = {
            "success": False,
            "stdout": "Test failed!",
            "stderr": "Error trace",
        }

        report = generate_optimization_report(
            log_data=log_data,
            pytest_results=pytest_results,
            baseline_data=None,
            git_diff="",
            format_name="express",
            model="gemini",
        )
        self.assertIn("Pytest Unit Test Failures", report)
        self.assertIn("Sample: `failing_sample`", report)
        self.assertIn("Syntax error in payload", report)
        self.assertIn("Incorrect layout structure", report)

    def test_generate_optimization_report_list_scores(self) -> None:
        from utils.reporter import generate_optimization_report

        log_data = {
            "results": {"scores": []},
            "samples": [{
                "id": "sample_list_1",
                "metadata": {"name": "sample_list_score"},
                "input": "Prompt test",
                "scores": [
                    {
                        "name": "a2ui_scorer",
                        "value": 0.0,
                        "explanation": "List format failure",
                    },
                    {
                        "name": "measured_model_graded_qa",
                        "value": "I",
                        "explanation": "List format QA failure",
                    },
                ],
                "events": [{
                    "event": "model",
                    "output": {"completion": "(Button 'Click')"},
                }],
            }],
        }
        pytest_results = {"success": True, "stdout": "", "stderr": ""}

        report = generate_optimization_report(
            log_data=log_data,
            pytest_results=pytest_results,
            baseline_data=None,
            git_diff="some diff",
            format_name="elemental",
            model="gemini",
        )
        self.assertIn("List format failure", report)
        self.assertIn("List format QA failure", report)

    def test_get_uv_binary_resolution(self) -> None:
        from utils.runner import _get_uv_binary

        bin_path = _get_uv_binary()
        self.assertTrue(isinstance(bin_path, str))
        self.assertTrue(len(bin_path) > 0)

    @patch("subprocess.run")
    def test_run_evaluation_full_args(self, mock_run) -> None:
        from utils.runner import run_evaluation

        mock_run.return_value = MagicMock(returncode=0)
        res = run_evaluation(
            format_name="atom",
            model="google/gemini-3.5-flash",
            prompts=["prompt1", "prompt2"],
            sanity=True,
            log_dir="/tmp/logs",
            thinking_budget=1795,
            epochs=3,
            temperature=0.7,
        )
        self.assertTrue(res)
        cmd_args = mock_run.call_args[0][0]
        self.assertIn("--thinking-budget", cmd_args)
        self.assertIn("1795", cmd_args)

    @patch("subprocess.run")
    def test_run_evaluation_direct_json_and_defaults(self, mock_run) -> None:
        from utils.runner import run_evaluation

        mock_run.return_value = MagicMock(returncode=0)
        res = run_evaluation(
            format_name="direct_json",
            model="gemini",
            prompts=None,
            sanity=False,
            log_dir="/tmp/logs",
        )
        self.assertTrue(res)
        cmd_args = mock_run.call_args[0][0]
        self.assertIn("direct", cmd_args)
        self.assertNotIn("--sanity", cmd_args)

    @patch("subprocess.run")
    def test_get_git_diff_exception(self, mock_run) -> None:
        from utils.runner import get_git_diff

        mock_run.side_effect = Exception("git failed")
        diff = get_git_diff("/tmp")
        self.assertEqual(diff, "")

    @patch("subprocess.check_output")
    def test_load_log_data_success(self, mock_sub) -> None:
        from utils.runner import load_log_data

        mock_sub.return_value = json.dumps({"test": "data"})
        res = load_log_data("/tmp/test.eval")
        self.assertEqual(res, {"test": "data"})

    def test_archiver_archive_run_full(self) -> None:
        import utils.archiver

        temp_dir = tempfile.mkdtemp()
        try:
            skill_dir = os.path.join(temp_dir, "skills", "inference-format-optimizer")
            scripts_dir = os.path.join(skill_dir, "scripts")
            os.makedirs(scripts_dir, exist_ok=True)
            report_src = os.path.join(scripts_dir, "current_report.md")
            with open(report_src, "w") as f:
                f.write("# Report")

            logs_dir = os.path.join(temp_dir, "logs", "temp_optimization_atom_1234")
            os.makedirs(logs_dir, exist_ok=True)
            with open(os.path.join(logs_dir, "results.json"), "w") as f:
                json.dump({"samples": []}, f)

            real_report_src = SCRIPTS_DIR / "current_report.md"
            created_report = False
            if not real_report_src.exists():
                with open(real_report_src, "w") as f:
                    f.write("# Temporary Report")
                created_report = True

            with patch("sync_history.regenerate_master_index"):
                dest = utils.archiver.archive_run(
                    format_name="atom",
                    hypothesis="Test full hypothesis",
                    status="KEEP",
                    notes="Test notes",
                    log_dir=logs_dir,
                    custom_history_dir=os.path.join(temp_dir, "history"),
                )
                self.assertTrue(os.path.exists(dest))
                self.assertTrue(os.path.exists(os.path.join(dest, "run_meta.json")))
                self.assertTrue(os.path.exists(os.path.join(dest, "report.md")))

            if created_report and real_report_src.exists():
                os.remove(real_report_src)
        finally:
            shutil.rmtree(temp_dir)

    def test_format_tools_invalid_inputs(self) -> None:
        from utils.format_tools import (
            test_compile_snippet,
            test_decompile_payload,
            test_parse_ast,
        )

        with self.assertRaises(ValueError):
            test_compile_snippet("unknown_format", "snippet")

        with self.assertRaises(ValueError):
            test_decompile_payload("unknown_format", "{}")

        with self.assertRaises(ValueError):
            test_parse_ast("unknown_format", "snippet")

    @patch("subprocess.check_output")
    def test_get_git_commit_sha_error(self, mock_sub) -> None:
        from utils.archiver import _get_git_commit_sha

        mock_sub.side_effect = subprocess.CalledProcessError(1, "git")
        sha = _get_git_commit_sha("/tmp")
        self.assertEqual(sha, "0000000")

    @patch("subprocess.run")
    def test_run_unit_tests_failed(self, mock_run) -> None:
        from utils.runner import run_unit_tests

        mock_run.return_value = MagicMock(returncode=1, stdout="Fail", stderr="Err")
        res = run_unit_tests()
        self.assertFalse(res["success"])
        self.assertEqual(res["stdout"], "Fail")

    def test_extract_metrics_from_log_dict_samples(self) -> None:
        log_data = {
            "results": {
                "scores": [
                    {"name": "a2ui_scorer", "metrics": {"accuracy": {"value": 0.8}}},
                    {
                        "name": "measured_model_graded_qa",
                        "metrics": {"accuracy": {"value": 0.9}},
                    },
                ]
            },
            "samples": {
                "s1": {
                    "metadata": {
                        "evaluation_duration_seconds": 1.2,
                        "inference_reasoning_tokens": 100,
                        "inference_input_tokens": 200,
                        "inference_output_tokens": 50,
                    },
                    "events": [{
                        "event": "model",
                        "usage": {"input_tokens": 200, "output_tokens": 50},
                    }],
                }
            },
        }
        res = extract_metrics_from_log(log_data)
        self.assertEqual(res["algo_accuracy"], 0.8)
        self.assertEqual(res["overall_accuracy"], 0.9)
        self.assertEqual(res["total_samples"], 1)

    def test_extract_metrics_from_log_event_time_fallback(self) -> None:
        log_data = {
            "results": {
                "scores": [
                    {"name": "a2ui_scorer", "metrics": {"accuracy": {"value": 0.7}}},
                ]
            },
            "samples": [{
                "metadata": {
                    "inference_duration_seconds": 2.5,
                    "inference_reasoning_tokens": 120,
                },
                "events": [{
                    "event": "model",
                    "duration": 2.5,
                }],
            }],
        }
        res = extract_metrics_from_log(log_data)
        self.assertEqual(res["algo_accuracy"], 0.7)
        self.assertEqual(res["avg_latency_seconds"], 2.5)

    def test_archiver_archive_run_default_dir(self) -> None:
        import utils.archiver

        with patch("sync_history.regenerate_master_index"):
            with patch("sync_history.sync_worktree_history"):
                dest = utils.archiver.archive_run(
                    format_name="atom",
                    hypothesis="test_default_hist",
                    status="BACKTRACK",
                )
                self.assertTrue(os.path.exists(dest))
                if os.path.exists(dest):
                    shutil.rmtree(dest)

    @patch("utils.archiver.load_log_data")
    def test_archiver_eval_log_fallback(self, mock_load) -> None:
        import utils.archiver

        mock_load.return_value = {
            "results": {"scores": []},
            "samples": [{"metadata": {"evaluation_duration_seconds": 1.0}}],
        }
        temp_dir = tempfile.mkdtemp()
        try:
            log_dir = os.path.join(temp_dir, "logs")
            os.makedirs(log_dir, exist_ok=True)
            eval_file = os.path.join(log_dir, "test.eval")
            with open(eval_file, "w") as f:
                f.write("{}")

            with patch("sync_history.regenerate_master_index"):
                with patch("sync_history.sync_worktree_history"):
                    dest = utils.archiver.archive_run(
                        format_name="atom",
                        hypothesis="eval_fallback_test",
                        status="KEEP",
                        log_dir=log_dir,
                        custom_history_dir=os.path.join(temp_dir, "history"),
                    )
                    self.assertTrue(os.path.exists(os.path.join(dest, "results.json")))
        finally:
            shutil.rmtree(temp_dir)


if __name__ == "__main__":
    unittest.main()
