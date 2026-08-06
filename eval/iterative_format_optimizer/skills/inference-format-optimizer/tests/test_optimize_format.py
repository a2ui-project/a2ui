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

"""Unit tests for optimize_format.py."""

import json
import os
import sys
from typing import Any, Dict
from unittest.mock import MagicMock, mock_open, patch

import pytest

# Add scripts directory to path to import optimize_format
SCRIPTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../scripts"))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)


from optimize_format import (  # type: ignore[import-not-found]
    extract_metrics_from_log,
    generate_optimization_report,
    get_git_diff,
    load_log_data,
    main,
    regenerate_master_index,
    run_evaluation,
    run_unit_tests,
)


def test_extract_metrics_from_log_empty() -> None:
    log_data: Dict[str, Any] = {}
    metrics = extract_metrics_from_log(log_data)
    assert metrics["overall_accuracy"] == 0.0
    assert metrics["algo_accuracy"] == 0.0
    assert metrics["avg_latency_seconds"] == 0.0
    assert metrics["avg_input_tokens"] == 0.0
    assert metrics["avg_output_tokens"] == 0.0
    assert metrics["total_samples"] == 0


def test_extract_metrics_from_log_valid() -> None:
    log_data: Dict[str, Any] = {
        "results": {
            "scores": [
                {
                    "name": "a2ui_scorer",
                    "metrics": {"accuracy": {"value": 0.8}},
                },
                {
                    "name": "measured_model_graded_qa",
                    "metrics": {"accuracy": {"value": 0.6}},
                },
            ]
        },
        "samples": [
            {
                "id": 1,
                "metadata": {"evaluation_duration_seconds": 1.5},
                "events": [{
                    "event": "model",
                    "usage": {"input_tokens": 100, "output_tokens": 50},
                }],
            },
            {
                "id": 2,
                "metadata": {"evaluation_duration_seconds": 2.5},
                "events": [{
                    "event": "model",
                    "usage": {"input_tokens": 200, "output_tokens": 150},
                }],
            },
        ],
    }

    metrics = extract_metrics_from_log(log_data)
    assert metrics["overall_accuracy"] == 0.6
    assert metrics["algo_accuracy"] == 0.8
    assert metrics["avg_latency_seconds"] == 2.0
    assert metrics["avg_input_tokens"] == 150.0
    assert metrics["avg_output_tokens"] == 100.0
    assert metrics["total_samples"] == 2


def test_extract_metrics_from_log_no_metadata_latency() -> None:
    log_data: Dict[str, Any] = {
        "samples": [{
            "id": 1,
            "events": [{
                "event": "model",
                "working_time": 1.2,
                "usage": {"input_tokens": 100},
            }],
        }]
    }
    metrics = extract_metrics_from_log(log_data)
    assert metrics["avg_latency_seconds"] == 1.2
    assert metrics["avg_input_tokens"] == 100.0


@patch("subprocess.run")
def test_run_unit_tests_success(mock_run: MagicMock) -> None:
    mock_run.return_value = MagicMock(returncode=0, stdout="OK", stderr="")
    res = run_unit_tests()
    assert res["success"] is True
    assert res["stdout"] == "OK"


@patch("subprocess.run")
def test_run_unit_tests_failed(mock_run: MagicMock) -> None:
    mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="pytest error")
    res = run_unit_tests()
    assert res["success"] is False
    assert res["stderr"] == "pytest error"


@patch("subprocess.run")
def test_run_evaluation_success(mock_run: MagicMock) -> None:
    mock_run.return_value = MagicMock(returncode=0)
    success = run_evaluation("atom", "google/gemini-3.5-flash", None, False, "dir")
    assert success is True


@patch("subprocess.run")
def test_run_evaluation_failed(mock_run: MagicMock) -> None:
    mock_run.return_value = MagicMock(returncode=1)
    success = run_evaluation("atom", "google/gemini-3.5-flash", ["p1"], True, "dir")
    assert success is False


@patch("subprocess.check_output")
def test_load_log_data(mock_output: MagicMock) -> None:
    mock_output.return_value = '{"foo": "bar"}'
    data = load_log_data("file.eval")
    assert data == {"foo": "bar"}


@patch("subprocess.run")
def test_get_git_diff(mock_run: MagicMock) -> None:
    mock_run.return_value = MagicMock(stdout="diff content")
    diff = get_git_diff("root")
    assert diff == "diff content"


def test_generate_optimization_report() -> None:
    log_data: Dict[str, Any] = {
        "results": {
            "scores": [
                {
                    "name": "a2ui_scorer",
                    "metrics": {"accuracy": {"value": 0.8}},
                },
                {
                    "name": "measured_model_graded_qa",
                    "metrics": {"accuracy": {"value": 0.6}},
                },
            ]
        },
        "samples": [{
            "id": 1,
            "input": "Prompt text",
            "scores": {
                "a2ui_scorer": {"value": 0.0, "explanation": "Broken schema"},
                "measured_model_graded_qa": {
                    "value": "I",
                    "explanation": "Bad style",
                },
            },
            "events": [{
                "event": "model",
                "output": {"completion": "completion text"},
                "usage": {"input_tokens": 10},
            }],
        }],
    }

    pytest_results = {"success": True, "stdout": "", "stderr": ""}
    baseline_data: Dict[str, Any] = {
        "results": {
            "scores": [
                {
                    "name": "a2ui_scorer",
                    "metrics": {"accuracy": {"value": 0.5}},
                },
                {
                    "name": "measured_model_graded_qa",
                    "metrics": {"accuracy": {"value": 0.4}},
                },
            ]
        },
        "samples": [],
    }

    report = generate_optimization_report(
        log_data=log_data,
        pytest_results=pytest_results,
        baseline_data=baseline_data,
        git_diff="git diff logic",
        format_name="atom",
        model="google/gemini-3.5-flash",
    )

    assert "# Inference Format Optimization Report" in report
    assert "Pytest Conformance" in report
    assert "Overall Pass Rate" in report
    assert "git diff logic" in report
    assert "Bad style" in report


def test_generate_optimization_report_pytest_failed() -> None:
    log_data: Dict[str, Any] = {"samples": []}
    pytest_results = {"success": False, "stdout": "test fail", "stderr": ""}
    report = generate_optimization_report(
        log_data=log_data,
        pytest_results=pytest_results,
        baseline_data=None,
        git_diff="",
        format_name="atom",
        model="google/gemini-3.5-flash",
    )
    assert "❌ Pytest Unit Test Failures" in report
    assert "test fail" in report


def test_regenerate_master_index(tmp_path: Any) -> None:
    history_dir = tmp_path / "history"
    history_dir.mkdir()

    # Create run_001
    run_1_dir = history_dir / "run_001_first_run"
    run_1_dir.mkdir()

    # Write meta.json and results.json
    with open(run_1_dir / "run_meta.json", "w", encoding="utf-8") as f:
        json.dump(
            {
                "hypothesis": "hypo 1",
                "notes": "note 1",
                "status": "Kept",
            },
            f,
        )

    run_1_log = {
        "results": {
            "scores": [
                {
                    "name": "a2ui_scorer",
                    "metrics": {"accuracy": {"value": 0.8}},
                },
                {
                    "name": "measured_model_graded_qa",
                    "metrics": {"accuracy": {"value": 0.6}},
                },
            ]
        },
        "samples": [],
    }
    with open(run_1_dir / "results.json", "w", encoding="utf-8") as f:
        json.dump(run_1_log, f)

    regenerate_master_index(str(tmp_path))

    index_file = tmp_path / "history_summary.md"
    assert index_file.exists()
    with open(index_file, "r", encoding="utf-8") as f:
        content = f.read()

    assert "Optimization Run History" in content
    assert "`001`" in content
    assert "hypo 1" in content
    assert "60.0%" in content
    assert "Kept" in content


def test_regenerate_master_index_without_results_json(
    tmp_path: Any,
) -> None:
    history_dir = tmp_path / "history"
    history_dir.mkdir()

    run_dir = history_dir / "run_002_second_run"
    run_dir.mkdir()

    with open(run_dir / "run_meta.json", "w", encoding="utf-8") as f:
        json.dump(
            {
                "hypothesis": "hypo 2 without results.json",
                "notes": "note 2",
                "status": "Kept",
                "metrics": {
                    "schema_acc": 1.0,
                    "quality_acc": 1.0,
                    "code_tokens_median": 282.0,
                    "reasoning_tokens_median": 3890.0,
                    "input_tokens_median": 4452.0,
                    "latency_seconds_median": 1.37,
                    "total_samples": 6,
                },
            },
            f,
        )

    regenerate_master_index(str(tmp_path))

    index_file = tmp_path / "history_summary.md"
    assert index_file.exists()
    content = index_file.read_text(encoding="utf-8")
    assert "`002`" in content
    assert "hypo 2 without results.json" in content
    assert "100.0%" in content


@patch("optimize_format.run_unit_tests")
@patch("optimize_format.run_evaluation")
def test_main_eval_failed(mock_eval: MagicMock, mock_pytest: MagicMock) -> None:
    mock_pytest.return_value = {"success": True, "stdout": "", "stderr": ""}
    mock_eval.return_value = False

    with pytest.raises(SystemExit) as e:
        main(["--format", "atom"])
    assert e.value.code == 1


@patch("optimize_format.run_unit_tests")
@patch("optimize_format.run_evaluation")
@patch("optimize_format.load_log_data")
@patch("optimize_format.glob.glob")
@patch("shutil.rmtree")
def test_main_save_baseline(
    mock_rmtree: MagicMock,
    mock_glob: MagicMock,
    mock_load: MagicMock,
    mock_eval: MagicMock,
    mock_pytest: MagicMock,
    tmp_path: Any,
) -> None:
    mock_pytest.return_value = {"success": True, "stdout": "", "stderr": ""}
    mock_eval.return_value = True
    mock_glob.return_value = ["temp_optimization/log.eval"]
    mock_load.return_value = {"results": {"scores": []}}

    baseline_dir = tmp_path / "baselines"

    with pytest.raises(SystemExit) as e:
        main([
            "--format",
            "atom",
            "--save-baseline",
            "--baseline-dir",
            str(baseline_dir),
        ])

    assert e.value.code == 0
    assert (baseline_dir / "unbounded_run_meta.json").exists()


@patch("optimize_format.run_unit_tests")
@patch("optimize_format.run_evaluation")
@patch("optimize_format.glob.glob")
def test_main_no_eval_logs_found(
    mock_glob: MagicMock, mock_eval: MagicMock, mock_pytest: MagicMock
) -> None:
    mock_pytest.return_value = {"success": True, "stdout": "", "stderr": ""}
    mock_eval.return_value = True
    mock_glob.return_value = []  # No logs found

    with pytest.raises(SystemExit) as e:
        main(["--format", "atom"])
    assert e.value.code == 1


@patch("optimize_format.run_unit_tests")
@patch("optimize_format.run_evaluation")
@patch("optimize_format.load_log_data")
@patch("optimize_format.glob.glob")
@patch("optimize_format.get_git_diff")
@patch("optimize_format.regenerate_master_index")
@patch("shutil.rmtree")
def test_main_full_flow(
    mock_rmtree: MagicMock,
    mock_regen: MagicMock,
    mock_diff: MagicMock,
    mock_glob: MagicMock,
    mock_load: MagicMock,
    mock_eval: MagicMock,
    mock_pytest: MagicMock,
) -> None:
    mock_pytest.return_value = {"success": True, "stdout": "", "stderr": ""}
    mock_eval.return_value = True
    mock_glob.return_value = ["temp_optimization/log.eval"]
    mock_load.return_value = {
        "results": {"scores": []},
        "samples": [],
    }
    mock_diff.return_value = "git changes"

    # We need to mock os.path.dirname & write operations or run in tmp_path.
    # To run cleanly without modifying workspace, patch open/write inside main execution.
    with patch("builtins.open", mock_open(read_data="{}")):
        main(["--format", "atom", "--full"])

    assert mock_pytest.called
    assert mock_eval.called
    assert mock_load.called
    assert mock_diff.called
    assert mock_regen.called


def test_main_cli_compile_flag() -> None:
    with pytest.raises(SystemExit) as e:
        main(["--format", "atom", "--compile", '(Card (Text "Hello"))'])
    assert e.value.code == 0


def test_main_cli_parse_flag() -> None:
    with pytest.raises(SystemExit) as e:
        main(["--format", "atom", "--parse", '(Card (Text "Hello"))'])
    assert e.value.code == 0


def test_main_cli_decompile_flag() -> None:
    payload = json.dumps(
        {"version": "v1.0", "createSurface": {"surfaceId": "main", "components": []}}
    )
    with pytest.raises(SystemExit) as e:
        main(["--format", "atom", "--decompile", payload])
    assert e.value.code == 0


@patch("utils.archiver.archive_run")
def test_main_cli_archive_flag(mock_archive: MagicMock) -> None:
    mock_archive.return_value = "/tmp/history/run_053"
    with pytest.raises(SystemExit) as e:
        main([
            "--format",
            "atom",
            "--archive",
            "--hypothesis",
            "TestHypothesis",
            "--status",
            "KEEP",
        ])
    assert e.value.code == 0
    assert mock_archive.called


@patch("optimize_format.run_evaluation", return_value=True)
@patch("optimize_format.run_unit_tests")
def test_main_pytest_failed(mock_pytest: MagicMock, mock_eval: MagicMock) -> None:
    mock_pytest.return_value = {"success": False, "stdout": "", "stderr": "Error"}
    with pytest.raises(SystemExit) as e:
        main(["--format", "atom"])
    assert e.value.code == 1


@patch("optimize_format.run_unit_tests")
@patch("optimize_format.run_evaluation")
@patch("optimize_format.load_log_data")
@patch("optimize_format.glob.glob")
@patch("optimize_format.get_git_diff")
@patch("optimize_format.regenerate_master_index")
@patch("shutil.rmtree")
def test_main_cli_sanity_and_budget(
    mock_rmtree: MagicMock,
    mock_regen: MagicMock,
    mock_diff: MagicMock,
    mock_glob: MagicMock,
    mock_load: MagicMock,
    mock_eval: MagicMock,
    mock_pytest: MagicMock,
) -> None:
    mock_pytest.return_value = {"success": True, "stdout": "", "stderr": ""}
    mock_eval.return_value = True
    mock_glob.return_value = ["temp_optimization/log.eval"]
    mock_load.return_value = {"results": {"scores": []}, "samples": []}
    mock_diff.return_value = ""

    with patch("builtins.open", mock_open(read_data="{}")):
        main([
            "--format",
            "atom",
            "--sanity",
            "--thinking-budget",
            "897",
            "--epochs",
            "2",
            "--temperature",
            "0.2",
            "--prompt",
            "loginForm",
        ])

    assert mock_pytest.called
    assert mock_eval.called
    assert mock_eval.call_args[1]["thinking_budget"] == 897
    assert mock_eval.call_args[1]["epochs"] == 2
    assert mock_eval.call_args[1]["temperature"] == 0.2


def test_regenerate_master_index_with_flat_runs(tmp_path: Any) -> None:
    history_dir = tmp_path / "history"
    history_dir.mkdir()
    run_dir = history_dir / "run_001_test"
    run_dir.mkdir()
    (run_dir / "run_meta.json").write_text(
        json.dumps({
            "hypothesis": "hypo flat",
            "notes": "notes flat",
            "status": "KEEP",
            "format": "atom",
            "metrics": {
                "quality_acc": 1.0,
                "schema_acc": 1.0,
                "latency_seconds_median": 1.2,
                "input_tokens_median": 100,
                "code_tokens_median": 50,
            },
        }),
        encoding="utf-8",
    )

    regenerate_master_index(str(history_dir))
    master_md = tmp_path / "history_summary.md"
    assert master_md.exists()
    assert "hypo flat" in master_md.read_text(encoding="utf-8")


def test_regenerate_master_index_results_json_fallback(tmp_path: Any) -> None:
    history_dir = tmp_path / "history"
    history_dir.mkdir()
    run_dir = history_dir / "run_002_fallback"
    run_dir.mkdir()
    (run_dir / "run_meta.json").write_text(
        json.dumps({
            "hypothesis": "fallback hypo",
            "notes": "Pytest FAIL notes",
            "status": "BACKTRACK",
            "format": "express",
        }),
        encoding="utf-8",
    )
    (run_dir / "results.json").write_text(
        json.dumps({
            "results": {"scores": []},
            "samples": [{
                "id": "s1",
                "metadata": {"name": "sample_1", "inference_duration_seconds": 1.5},
            }],
        }),
        encoding="utf-8",
    )

    regenerate_master_index(str(history_dir))
    master_md = tmp_path / "history_summary.md"
    assert master_md.exists()
    text = master_md.read_text(encoding="utf-8")
    assert "fallback hypo" in text

    regenerate_master_index(str(history_dir))
    master_md = tmp_path / "history_summary.md"
    assert master_md.exists()


def test_main_cli_decompile() -> None:
    with pytest.raises(SystemExit) as e:
        main(["--format", "direct_json", "--decompile", "{}"])
    assert e.value.code == 0


def test_main_cli_parse() -> None:
    with pytest.raises(SystemExit) as e:
        main(["--format", "atom", "--parse", "(Text 'hi')"])
    assert e.value.code == 0


@patch("utils.archiver.archive_run")
def test_main_cli_archive(mock_archive: MagicMock) -> None:
    with pytest.raises(SystemExit) as e:
        main([
            "--format",
            "atom",
            "--archive",
            "--hypothesis",
            "test archive hypo",
            "--status",
            "KEEP",
        ])
    assert e.value.code == 0
    assert mock_archive.called


@patch("optimize_format.run_evaluation", return_value=True)
@patch("optimize_format.load_log_data")
@patch("glob.glob")
def test_main_cli_save_baseline(
    mock_glob: MagicMock, mock_load: MagicMock, mock_run_eval: MagicMock, tmp_path: Any
) -> None:
    mock_glob.return_value = [str(tmp_path / "test.eval")]
    mock_load.return_value = {
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
            "id": "s1",
            "metadata": {
                "name": "sample_1",
                "inference_duration_seconds": 1.0,
                "inference_input_tokens": 100,
                "inference_output_tokens": 50,
                "inference_reasoning_tokens": 20,
            },
            "scores": {
                "a2ui_scorer": {"value": 1.0},
                "measured_model_graded_qa": {"value": "C"},
            },
            "events": [{
                "event": "model",
                "working_time": 1.0,
                "call": {"response": {"usageMetadata": {"thoughtsTokenCount": 20}}},
            }],
        }],
    }

    base_dir = tmp_path / "baselines"
    with pytest.raises(SystemExit) as e:
        main([
            "--format",
            "atom",
            "--save-baseline",
            "--thinking-budget",
            "1000",
            "--epochs",
            "2",
            "--temperature",
            "0.5",
            "--baseline-dir",
            str(base_dir),
            "--sanity",
        ])
    assert e.value.code == 0
    assert (base_dir / "budget_1000_run_meta.json").exists()


@patch("optimize_format.run_evaluation", return_value=True)
@patch("optimize_format.load_log_data")
@patch("glob.glob")
@patch("optimize_format.regenerate_master_index")
def test_main_cli_normal_report_generation(
    mock_regen: MagicMock,
    mock_glob: MagicMock,
    mock_load: MagicMock,
    mock_run_eval: MagicMock,
    tmp_path: Any,
) -> None:
    mock_glob.return_value = [str(tmp_path / "test.eval")]
    mock_load.return_value = {
        "results": {
            "scores": [
                {"name": "a2ui_scorer", "metrics": {"accuracy": {"value": 1.0}}},
            ]
        },
        "samples": [{
            "id": "s1",
            "metadata": {"name": "sample_1"},
        }],
    }

    base_dir = tmp_path / "baselines"
    base_dir.mkdir()
    (base_dir / "results.json").write_text(
        json.dumps({"results": {"scores": []}}), encoding="utf-8"
    )

    hist_dir = tmp_path / "history"
    hist_dir.mkdir()

    with patch("sys.stdout"):
        main([
            "--format",
            "atom",
            "--baseline-dir",
            str(base_dir),
            "--history-dir",
            str(hist_dir),
            "--sanity",
        ])
    assert mock_regen.called
