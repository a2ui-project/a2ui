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
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
EVAL_ITERATIVE_DIR = REPO_ROOT / "eval/iterative"

if str(EVAL_ITERATIVE_DIR) not in sys.path:
    sys.path.insert(0, str(EVAL_ITERATIVE_DIR))

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

    def test_compile_snippet_atom(self):
        compiled = format_tools.test_compile_snippet("atom", '(Card (Text "Hello"))')
        payload = json.loads(compiled)
        self.assertEqual(payload["version"], "v1.0")

    def test_compile_snippet_express(self):
        compiled = format_tools.test_compile_snippet(
            "express", 'root = Text("Hello", _)\n'
        )
        payload = json.loads(compiled)
        self.assertTrue(len(payload) > 0)

    def test_compile_snippet_elemental(self):
        compiled = format_tools.test_compile_snippet(
            "elemental", '<body><ui-text text="Hello"></ui-text></body>\n'
        )
        payload = json.loads(compiled)
        self.assertTrue(len(payload) > 0)

    def test_compile_snippet_unsupported_raises(self):
        with self.assertRaises(ValueError):
            format_tools.test_compile_snippet("invalid_fmt", "foo")

    def test_decompile_payload_atom(self):
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

    def test_decompile_payload_express(self):
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

    def test_decompile_payload_elemental(self):
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

    def test_decompile_payload_unsupported_raises(self):
        with self.assertRaises(ValueError):
            format_tools.test_decompile_payload("invalid_fmt", {})

    def test_parse_ast_atom(self):
        parsed = format_tools.test_parse_ast("atom", '(Card (Text "Hello"))')
        ast = json.loads(parsed)
        self.assertEqual(ast[0][0], "Card")

    def test_parse_ast_express(self):
        parsed = format_tools.test_parse_ast("express", 'root = Text("Hello", _)\n')
        self.assertTrue(len(parsed) > 0)

    def test_parse_ast_elemental(self):
        parsed = format_tools.test_parse_ast(
            "elemental", '<body><ui-text text="Hello"></ui-text></body>\n'
        )
        self.assertTrue(len(parsed) > 0)

    def test_parse_ast_unsupported_raises(self):
        with self.assertRaises(ValueError):
            format_tools.test_parse_ast("invalid_fmt", "foo")


class TestArchiver(unittest.TestCase):

    def test_slugify(self):
        self.assertEqual(
            _slugify("Compiler-side dynamic event handler normalization!"),
            "compiler_side_dynamic_event_handler_norm",
        )
        self.assertEqual(_slugify(""), "run")

    def test_get_git_commit_sha(self):
        sha = _get_git_commit_sha(str(REPO_ROOT))
        self.assertTrue(len(sha) >= 7)

    @patch("subprocess.run")
    def test_get_git_commit_sha_failure(self, mock_run):
        mock_run.side_effect = Exception("git error")
        sha = _get_git_commit_sha(str(REPO_ROOT))
        self.assertEqual(sha, "0000000")

    def test_archive_run(self):
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
    def test_archive_run_git_patch_failure(self, mock_run):
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
    def test_run_unit_tests(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="PASS", stderr="")
        res = run_unit_tests()
        self.assertTrue(res["success"])

    @patch("subprocess.run")
    def test_run_evaluation(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        res = run_evaluation(
            "atom", "google/gemini-3.5-flash", ["loginForm"], True, "/tmp/logs"
        )
        self.assertTrue(res)

    @patch("subprocess.check_output")
    def test_load_log_data(self, mock_check_output):
        mock_check_output.return_value = '{"results": {}}'
        res = load_log_data("/tmp/test.eval")
        self.assertEqual(res, {"results": {}})

    @patch("subprocess.run")
    def test_get_git_diff(self, mock_run):
        mock_run.return_value = MagicMock(stdout="diff content")
        diff = get_git_diff(str(REPO_ROOT))
        self.assertEqual(diff, "diff content")

    def test_extract_metrics_from_log_complete(self):
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

    def test_generate_optimization_report_with_failures(self):
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


if __name__ == "__main__":
    unittest.main()
