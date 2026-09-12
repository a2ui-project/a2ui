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

import pytest
import sys
from unittest.mock import patch
from main import resolve_model_name, main


def test_resolve_model_name_aliases():
    """Verify explicit versioned Gemma and Gemini model aliases resolve properly."""
    assert resolve_model_name("gemma-4-26b") == "google/gemma-4-26b-a4b-it"
    assert resolve_model_name("gemma-4-31b") == "google/gemma-4-31b-it"
    assert resolve_model_name("gemma-4-e2b") == "ollama/gemma4:e2b"
    assert resolve_model_name("gemma-4-e4b") == "ollama/gemma4:e4b"
    assert resolve_model_name("gemma-2-2b") == "ollama/gemma2:2b"

    assert resolve_model_name("gemini-3.8-flash") == "google/gemini-3.8-flash"
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
