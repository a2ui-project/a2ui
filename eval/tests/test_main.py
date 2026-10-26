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

"""Unit tests for eval main.py CLI and model resolution logic."""

import sys
from unittest.mock import patch

import pytest

from a2ui_eval.runner import validate_version
from main import main, plan_protocol_versions, resolve_model_name
from tasks import a2ui_v0_9_1_eval, dataset_protocol_version


def test_resolve_model_name_aliases():
    """Verify explicit versioned Gemma and Gemini model aliases resolve properly."""
    assert resolve_model_name("gemma") == "google/gemma-4-26b-a4b-it"
    assert resolve_model_name("gemma-4-26b") == "google/gemma-4-26b-a4b-it"
    assert resolve_model_name("gemma-large") == "google/gemma-4-31b-it"
    assert resolve_model_name("gemma-4-31b") == "google/gemma-4-31b-it"
    assert resolve_model_name("gemma-e2b") == "ollama/gemma4:e2b"
    assert resolve_model_name("gemma-4-e2b") == "ollama/gemma4:e2b"
    assert resolve_model_name("gemma-e4b") == "ollama/gemma4:e4b"
    assert resolve_model_name("gemma-4-e4b") == "ollama/gemma4:e4b"
    assert resolve_model_name("gemma-2b") == "ollama/gemma2:2b"
    assert resolve_model_name("gemma-2-2b") == "ollama/gemma2:2b"

    assert resolve_model_name("gemini-3.8-flash") == "google/gemini-3.8-flash"
    assert resolve_model_name("gemini-3.6-flash") == "google/gemini-3.6-flash"
    assert resolve_model_name("gemini-3.5-flash") == "google/gemini-3.5-flash"
    assert resolve_model_name("gemini-3.1-flash-lite") == "google/gemini-3.1-flash-lite"


def test_resolve_model_name_prefixes():
    """Verify models with gemma-, gemini-, or ollama: prefixes resolve properly."""
    assert resolve_model_name("gemma-custom-model") == "google/gemma-custom-model"
    assert resolve_model_name("gemini-custom-model") == "google/gemini-custom-model"
    assert resolve_model_name("ollama:custom-model") == "ollama/custom-model"
    # Fully qualified remains unchanged
    assert (
        resolve_model_name("google/gemma-4-26b-a4b-it") == "google/gemma-4-26b-a4b-it"
    )
    assert resolve_model_name("ollama/gemma4:e2b") == "ollama/gemma4:e2b"
    assert resolve_model_name("openai/gpt-4o") == "openai/gpt-4o"


def test_grading_model_rejects_gemma():
    """Verify that using a Gemma model as LLM-as-a-judge raises ValueError."""
    test_args = ["main.py", "--grading-model", "gemma-4-26b"]
    with patch.object(sys, "argv", test_args):
        with pytest.raises(
            ValueError, match="Gemma models must not be used as LLM-as-a-judge"
        ):
            main()


def test_resolve_model_name_whitespace_stripping():
    """Verify that resolve_model_name strips leading and trailing whitespace."""
    assert resolve_model_name("  gemma-4-26b  ") == "google/gemma-4-26b-a4b-it"
    assert resolve_model_name("  gemma-custom  ") == "google/gemma-custom"
    assert resolve_model_name("  ollama:custom  ") == "ollama/custom"
    assert resolve_model_name("  openai/gpt-4o  ") == "openai/gpt-4o"


def test_gemma_model_flag_defaults_to_json():
    """Verify that specifying a model via --model defaults strategy to standard strategies."""
    test_args = [
        "main.py",
        "--model",
        "gemma-4-26b",
        "--dataset",
        "core_v1_0",
        "--limit",
        "1",
    ]
    with patch.object(sys, "argv", test_args), patch(
        "main.eval_set", return_value=(True, [])
    ) as mock_eval_set, patch("main.a2ui_v1_0_eval") as mock_v1_eval, patch(
        "main.a2ui_v0_9_1_eval"
    ) as mock_v09_eval:
        main()

        assert mock_eval_set.called
        call_kwargs = mock_eval_set.call_args.kwargs
        assert call_kwargs["model"] == "google/gemma-4-26b-a4b-it"
        strategies = [
            call.kwargs["strategy"] for call in mock_v1_eval.call_args_list
        ] + [call.kwargs["strategy"] for call in mock_v09_eval.call_args_list]
        assert "direct" in strategies
        assert "subagent_tool" in strategies


def test_gemma_model_flag_with_express_strategy():
    """Verify that specifying --model gemma-4-26b --strategies express configures express strategy."""
    test_args = [
        "main.py",
        "--model",
        "gemma-4-26b",
        "--strategies",
        "express",
        "--dataset",
        "core_v1_0",
        "--limit",
        "1",
    ]
    with patch.object(sys, "argv", test_args), patch(
        "main.eval_set", return_value=(True, [])
    ) as mock_eval_set, patch("main.a2ui_v1_0_eval") as mock_v1_eval:
        main()

        assert mock_eval_set.called
        call_kwargs = mock_eval_set.call_args.kwargs
        assert call_kwargs["model"] == "google/gemma-4-26b-a4b-it"
        assert mock_v1_eval.call_args.kwargs["strategy"] == "express"


def _run_main(args: list[str]):
    """Runs main() with the task functions and eval_set mocked out."""
    with patch.object(sys, "argv", ["main.py", *args]), patch(
        "main.eval_set", return_value=(True, [])
    ) as mock_eval_set, patch("main.a2ui_v1_0_eval") as mock_v1_eval, patch(
        "main.a2ui_v0_9_1_eval"
    ) as mock_v09_eval:
        main()
    return mock_eval_set, mock_v1_eval, mock_v09_eval


def _calls(mock_task) -> list[tuple[str, str | None]]:
    """Returns (strategy, dataset) for each call to a mocked task function."""
    return [
        (call.kwargs["strategy"], call.kwargs["dataset"])
        for call in mock_task.call_args_list
    ]


def test_main_auto_version_defaults_subagent_tool_to_v0_9_1() -> None:
    _, mock_v1_eval, mock_v09_eval = _run_main(["--strategies", "direct,subagent_tool"])
    assert _calls(mock_v1_eval) == [("direct", None)]
    assert _calls(mock_v09_eval) == [("subagent_tool", None)]


@pytest.mark.parametrize("version_arg", ["0.9.1", "v0.9.1"])
def test_main_explicit_version_routes_every_strategy(version_arg: str) -> None:
    _, mock_v1_eval, mock_v09_eval = _run_main(
        ["--version", version_arg, "--strategies", "direct,express,subagent_tool"]
    )
    assert not mock_v1_eval.called
    assert [strat for strat, _ in _calls(mock_v09_eval)] == [
        "direct",
        "express",
        "subagent_tool",
    ]


def test_main_rejects_unknown_version() -> None:
    with patch.object(sys, "argv", ["main.py", "--version", "0.8"]):
        with pytest.raises(SystemExit):
            main()


def test_main_routes_each_dataset_to_its_pinned_version() -> None:
    _, mock_v1_eval, mock_v09_eval = _run_main([
        "--datasets",
        "core_v0_9_1,core_v1_0,multi_turn_conversation_dataset",
        "--strategies",
        "direct,subagent_tool",
    ])
    # Unpinned datasets follow the strategy default: 1.0 for direct and 0.9.1
    # for subagent_tool.
    assert _calls(mock_v1_eval) == [
        ("direct", "core_v1_0,multi_turn_conversation_dataset"),
        ("subagent_tool", "core_v1_0"),
    ]
    assert _calls(mock_v09_eval) == [
        ("direct", "core_v0_9_1"),
        ("subagent_tool", "core_v0_9_1,multi_turn_conversation_dataset"),
    ]


def test_main_single_dataset_flag_is_routed_by_version() -> None:
    _, mock_v1_eval, mock_v09_eval = _run_main(
        ["--dataset", "core_v0_9_1", "--strategies", "express"]
    )
    assert not mock_v1_eval.called
    assert _calls(mock_v09_eval) == [("express", "core_v0_9_1")]


def test_main_rejects_version_that_conflicts_with_dataset() -> None:
    with patch.object(
        sys, "argv", ["main.py", "--version", "0.9.1", "--dataset", "core_v1_0"]
    ), patch("main.eval_set") as mock_eval_set:
        with pytest.raises(ValueError, match="pinned to protocol version 1.0"):
            main()
    assert not mock_eval_set.called


def test_plan_protocol_versions() -> None:
    assert plan_protocol_versions("direct", "auto", []) == [("1.0", [])]
    assert plan_protocol_versions("subagent_tool", "auto", []) == [("0.9.1", [])]
    assert plan_protocol_versions("subagent_tool", "1.0", []) == [("1.0", [])]
    assert plan_protocol_versions("direct", "auto", ["core_v0_9_1", "custom"]) == [
        ("0.9.1", ["core_v0_9_1"]),
        ("1.0", ["custom"]),
    ]
    assert plan_protocol_versions("direct", "0.9.1", ["core_v0_9_1", "custom"]) == [
        ("0.9.1", ["core_v0_9_1", "custom"])
    ]
    with pytest.raises(ValueError, match="core_v0_9_1"):
        plan_protocol_versions("direct", "1.0", ["custom", "core_v0_9_1"])


def test_dataset_protocol_version() -> None:
    assert dataset_protocol_version("core_v0_9_1") == "0.9.1"
    assert dataset_protocol_version("core_v1_0") == "1.0"
    assert dataset_protocol_version("multi_turn_conversation_dataset") is None


@pytest.mark.parametrize(
    ("version", "expected"),
    [
        ("0.9", "0.9"),
        ("v0.9", "0.9"),
        ("0.9.1", "0.9.1"),
        ("v0.9.1", "0.9.1"),
        (" V1.0 ", "1.0"),
    ],
)
def test_validate_version_normalizes(version: str, expected: str) -> None:
    assert validate_version(version) == expected


@pytest.mark.parametrize("version", ["0.8", "2.0", ""])
def test_validate_version_rejects_unsupported(version: str) -> None:
    with pytest.raises(ValueError, match="is not supported"):
        validate_version(version)


def test_task_rejects_dataset_pinned_to_other_version() -> None:
    with pytest.raises(ValueError, match="core_v1_0"):
        a2ui_v0_9_1_eval(dataset="core_v1_0")


def test_main_default_strategies() -> None:
    """Verify default strategies when --strategies is omitted."""
    with patch.object(sys, "argv", ["main.py"]), patch(
        "main.eval_set", return_value=(True, [])
    ), patch("main.a2ui_v1_0_eval") as mock_v1_py, patch(
        "main.a2ui_v0_9_1_eval"
    ) as mock_v09_py:
        main()
        py_strategies = [
            call.kwargs["strategy"] for call in mock_v1_py.call_args_list
        ] + [call.kwargs["strategy"] for call in mock_v09_py.call_args_list]
        assert set(py_strategies) == {
            "direct",
            "subagent_tool",
            "express",
            "elemental",
            "atom",
        }
