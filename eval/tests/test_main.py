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

from a2ui_eval.bridges import SDK_SUPPORTED_VERSIONS, validate_sdk_version
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
    """Verify that specifying a model via --model defaults strategy to direct and subagent_tool."""
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
        # Strategy defaults to standard JSON strategies
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
    ) as mock_eval_set, patch("main.get_sdk_bridge") as mock_get_bridge, patch(
        "main.a2ui_v1_0_eval"
    ) as mock_v1_eval, patch(
        "main.a2ui_v0_9_1_eval"
    ) as mock_v09_eval:
        main()
    return mock_eval_set, mock_get_bridge, mock_v1_eval, mock_v09_eval


def _calls(mock_task) -> list[tuple[str, str, str | None]]:
    """Returns (sdk, strategy, dataset) for each call to a mocked task function."""
    return [
        (
            call.kwargs.get("sdk", "python"),
            call.kwargs["strategy"],
            call.kwargs["dataset"],
        )
        for call in mock_task.call_args_list
    ]


def test_main_multi_sdk_selection() -> None:
    """Each SDK runs a strategy's default version, or its newest supported one."""
    mock_eval_set, mock_get_bridge, mock_v1_eval, mock_v09_eval = _run_main(
        ["--sdks", "python,ts,dart", "--strategies", "direct,express", "--limit", "1"]
    )

    assert mock_eval_set.called
    assert mock_get_bridge.call_count == 3
    assert sorted(_calls(mock_v1_eval)) == sorted(
        (sdk, strat, None)
        for sdk in ("python", "ts")
        for strat in ("direct", "express")
    )
    # The Dart agent SDK supports only v0.9.1, so auto mode falls back to it.
    assert sorted(_calls(mock_v09_eval)) == [
        ("dart", "direct", None),
        ("dart", "express", None),
    ]


def test_main_auto_version_defaults_subagent_tool_to_v0_9_1() -> None:
    _, _, mock_v1_eval, mock_v09_eval = _run_main(
        ["--sdk", "dart", "--strategies", "direct,subagent_tool"]
    )
    assert not mock_v1_eval.called
    assert _calls(mock_v09_eval) == [
        ("dart", "direct", None),
        ("dart", "subagent_tool", None),
    ]


@pytest.mark.parametrize("version_arg", ["0.9.1", "v0.9.1"])
def test_main_explicit_version_routes_every_strategy(version_arg: str) -> None:
    _, _, mock_v1_eval, mock_v09_eval = _run_main(
        ["--version", version_arg, "--strategies", "direct,express,subagent_tool"]
    )
    assert not mock_v1_eval.called
    assert [strat for _, strat, _ in _calls(mock_v09_eval)] == [
        "direct",
        "express",
        "subagent_tool",
    ]


def test_main_rejects_unknown_version() -> None:
    with patch.object(sys, "argv", ["main.py", "--version", "0.8"]):
        with pytest.raises(SystemExit):
            main()


def test_main_routes_each_dataset_to_its_pinned_version() -> None:
    _, _, mock_v1_eval, mock_v09_eval = _run_main([
        "--datasets",
        "core_v0_9_1,core_v1_0,multi_turn_conversation_dataset",
        "--strategies",
        "direct,subagent_tool",
    ])
    # Unpinned datasets follow the strategy default: 1.0 for direct and 0.9.1
    # for subagent_tool.
    assert _calls(mock_v1_eval) == [
        ("python", "direct", "core_v1_0,multi_turn_conversation_dataset"),
        ("python", "subagent_tool", "core_v1_0"),
    ]
    assert _calls(mock_v09_eval) == [
        ("python", "direct", "core_v0_9_1"),
        ("python", "subagent_tool", "core_v0_9_1,multi_turn_conversation_dataset"),
    ]


def test_main_single_dataset_flag_is_routed_by_version() -> None:
    _, _, mock_v1_eval, mock_v09_eval = _run_main(
        ["--dataset", "core_v0_9_1", "--strategies", "express"]
    )
    assert not mock_v1_eval.called
    assert _calls(mock_v09_eval) == [("python", "express", "core_v0_9_1")]


def test_main_rejects_version_that_conflicts_with_dataset() -> None:
    with patch.object(
        sys, "argv", ["main.py", "--version", "0.9.1", "--dataset", "core_v1_0"]
    ), patch("main.eval_set") as mock_eval_set, patch(
        "main.get_sdk_bridge"
    ) as mock_get_bridge:
        with pytest.raises(ValueError, match="pinned to protocol version 1.0"):
            main()
    assert not mock_get_bridge.called
    assert not mock_eval_set.called


def test_main_rejects_unsupported_sdk_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unsupported SDK/version pair fails before any SDK is prepared."""
    monkeypatch.setitem(SDK_SUPPORTED_VERSIONS, "dart", frozenset({"0.9.1"}))
    with patch.object(
        sys, "argv", ["main.py", "--sdks", "python,dart", "--version", "1.0"]
    ), patch("main.eval_set") as mock_eval_set, patch(
        "main.get_sdk_bridge"
    ) as mock_get_bridge:
        with pytest.raises(ValueError, match="not supported by SDK 'dart'"):
            main()
    assert not mock_get_bridge.called
    assert not mock_eval_set.called


def test_main_auto_version_falls_back_to_a_supported_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With 'auto', an SDK without v1.0 support runs unpinned datasets on v0.9.1."""
    monkeypatch.setitem(SDK_SUPPORTED_VERSIONS, "dart", frozenset({"0.9.1"}))
    _, _, mock_v1_eval, mock_v09_eval = _run_main(
        ["--sdks", "python,dart", "--strategies", "direct"]
    )
    assert _calls(mock_v1_eval) == [("python", "direct", None)]
    assert _calls(mock_v09_eval) == [("dart", "direct", None)]


def test_main_auto_version_still_rejects_pinned_unsupported_dataset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setitem(SDK_SUPPORTED_VERSIONS, "dart", frozenset({"0.9.1"}))
    with patch.object(
        sys, "argv", ["main.py", "--sdk", "dart", "--dataset", "core_v1_0"]
    ), patch("main.get_sdk_bridge") as mock_get_bridge:
        with pytest.raises(ValueError, match="not supported by SDK 'dart'"):
            main()
    assert not mock_get_bridge.called


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
    assert plan_protocol_versions("direct", "auto", [], {"0.9.1"}) == [("0.9.1", [])]
    # An explicit version is kept so that SDK validation can reject it.
    assert plan_protocol_versions("direct", "1.0", [], {"0.9.1"}) == [("1.0", [])]


def test_dataset_protocol_version() -> None:
    assert dataset_protocol_version("core_v0_9_1") == "0.9.1"
    assert dataset_protocol_version("core_v1_0") == "1.0"
    assert dataset_protocol_version("multi_turn_conversation_dataset") is None


@pytest.mark.parametrize(
    "sdk, version, expected",
    [
        ("python", "0.9.1", "0.9.1"),
        ("typescript", "v0.9.1", "0.9.1"),
        ("dart", "v0.9.1", "0.9.1"),
        ("ts", " V1.0 ", "1.0"),
    ],
)
def test_validate_sdk_version_normalizes(sdk: str, version: str, expected: str) -> None:
    assert validate_sdk_version(sdk, version) == expected


@pytest.mark.parametrize("version", ["0.8", "0.9", "2.0", ""])
def test_validate_sdk_version_rejects_unsupported(version: str) -> None:
    with pytest.raises(ValueError, match="is not supported by SDK 'python'"):
        validate_sdk_version("python", version)


def test_validate_sdk_version_rejects_unknown_sdk() -> None:
    with pytest.raises(ValueError, match="Unknown SDK 'kotlin'"):
        validate_sdk_version("kotlin", "1.0")


def test_task_rejects_dataset_pinned_to_other_version() -> None:
    with pytest.raises(ValueError, match="core_v1_0"):
        a2ui_v0_9_1_eval(dataset="core_v1_0")


def test_task_rejects_unsupported_sdk_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setitem(SDK_SUPPORTED_VERSIONS, "ts", frozenset({"1.0"}))
    with pytest.raises(ValueError, match="not supported by SDK 'ts'"):
        a2ui_v0_9_1_eval(sdk="ts")


def test_main_default_strategies_per_sdk() -> None:
    """Verify default strategies per SDK when --strategies is omitted."""
    # Python defaults to direct, subagent_tool, express, elemental, atom
    with patch.object(sys, "argv", ["main.py", "--sdk", "python"]), patch(
        "main.eval_set", return_value=(True, [])
    ), patch("main.get_sdk_bridge"), patch("main.a2ui_v1_0_eval") as mock_v1_py, patch(
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

    # TS defaults to direct, subagent_tool, express
    with patch.object(sys, "argv", ["main.py", "--sdk", "ts"]), patch(
        "main.eval_set", return_value=(True, [])
    ), patch("main.get_sdk_bridge"), patch("main.a2ui_v1_0_eval") as mock_v1_ts, patch(
        "main.a2ui_v0_9_1_eval"
    ) as mock_v09_ts:
        main()
        ts_strategies = [
            call.kwargs["strategy"] for call in mock_v1_ts.call_args_list
        ] + [call.kwargs["strategy"] for call in mock_v09_ts.call_args_list]
        assert set(ts_strategies) == {"direct", "subagent_tool", "express"}

    # Dart defaults to direct, subagent_tool, express
    with patch.object(sys, "argv", ["main.py", "--sdk", "dart"]), patch(
        "main.eval_set", return_value=(True, [])
    ), patch("main.get_sdk_bridge"), patch(
        "main.a2ui_v1_0_eval"
    ) as mock_v1_dart, patch(
        "main.a2ui_v0_9_1_eval"
    ) as mock_v09_dart:
        main()
        dart_strategies = [
            call.kwargs["strategy"] for call in mock_v1_dart.call_args_list
        ] + [call.kwargs["strategy"] for call in mock_v09_dart.call_args_list]
        assert set(dart_strategies) == {"direct", "subagent_tool", "express"}


def test_main_rejects_unsupported_sdk_strategy() -> None:
    """Verify that running an experimental Python-only strategy on TS or Dart raises ValueError."""
    test_args = [
        "main.py",
        "--sdk",
        "ts",
        "--strategies",
        "elemental",
    ]
    with patch.object(sys, "argv", test_args):
        with pytest.raises(ValueError, match="not supported by SDK 'ts'"):
            main()
