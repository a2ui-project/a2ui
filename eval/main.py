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

"""CLI entrypoint for A2UI evaluations."""

from __future__ import annotations

import argparse
from collections.abc import Callable
import os
import sys
from typing import Any

from inspect_ai import Task, eval_set
from inspect_ai.dataset import MemoryDataset

from a2ui_eval.runner import (
    DEFAULT_STRATEGIES,
    normalize_protocol_version,
    validate_strategy,
    validate_version,
)
from a2ui_eval.strategies import STRATEGIES
from tasks import (
    a2ui_v0_9_1_eval,
    a2ui_v1_0_eval,
    dataset_protocol_version,
    split_dataset_names,
)

# Automatically limit Inspect AI's connection rate-limiter limit and cap model retry backoffs to prevent 503 errors
os.environ["INSPECT_MAX_CONNECTIONS"] = "10"
os.environ["INSPECT_MODEL_MAX_BACKOFF"] = "300"

MODEL_ALIASES: dict[str, str] = {
    # Cloud models
    "gemma": "google/gemma-4-26b-a4b-it",
    "gemma-4-26b": "google/gemma-4-26b-a4b-it",
    "gemma-large": "google/gemma-4-31b-it",
    "gemma-4-31b": "google/gemma-4-31b-it",
    "gemini-3.8-flash": "google/gemini-3.8-flash",
    "gemini-3.6-flash": "google/gemini-3.6-flash",
    "gemini-3.5-flash": "google/gemini-3.5-flash",
    "gemini-3.1-flash-lite": "google/gemini-3.1-flash-lite",
    # Ollama edge convenience aliases
    "gemma-e2b": "ollama/gemma4:e2b",
    "gemma-4-e2b": "ollama/gemma4:e2b",
    "gemma-e4b": "ollama/gemma4:e4b",
    "gemma-4-e4b": "ollama/gemma4:e4b",
    "gemma-2b": "ollama/gemma2:2b",
    "gemma-2-2b": "ollama/gemma2:2b",
}

RESTRICTED_GRADING_MODEL_FAMILIES = ("gemma",)

PROTOCOL_VERSIONS: tuple[str, ...] = ("0.9.1", "1.0")

# Inspect AI provider prefixes accepted as-is by `resolve_model_name`.
KNOWN_PROVIDER_PREFIXES: tuple[str, ...] = (
    "google/",
    "openai/",
    "anthropic/",
    "mistral/",
    "ollama/",
    "vllm/",
    "hf/",
    "openai-api/",
    "openrouter/",
    "bedrock/",
    "vertex/",
    "azureai/",
    "groq/",
    "together/",
)

# Runtime profiles: concurrency and time budgets that suit a hosted API, a
# single local model server, or a fully offline run with no judge.
RUNTIME_PROFILES: dict[str, dict[str, int | bool | None]] = {
    "cloud": {
        "max_samples": 10,
        "max_connections": None,
        "working_limit": 350,
        "no_judge": False,
    },
    "local": {
        "max_samples": 1,
        "max_connections": 2,
        "working_limit": 900,
        "no_judge": False,
    },
    "offline": {
        "max_samples": 1,
        "max_connections": 2,
        "working_limit": 900,
        "no_judge": True,
    },
}


def resolve_model_name(model_name: str) -> str:
    """Resolves convenience aliases and provider conventions to fully qualified model IDs."""
    stripped = model_name.strip()
    lower = stripped.lower()
    if lower in MODEL_ALIASES:
        return MODEL_ALIASES[lower]
    if lower.startswith(KNOWN_PROVIDER_PREFIXES) or "/" in stripped:
        return stripped
    if lower.startswith("ollama:"):
        return f"ollama/{stripped[7:]}"
    if lower.startswith(("vllm:", "openai:", "anthropic:")):
        provider, _, name = stripped.partition(":")
        return f"{provider.lower()}/{name}"
    if ":" in stripped:
        # Standard Ollama model tag convention (e.g. 'gemma4:e2b', 'llama3:8b')
        return f"ollama/{stripped}"
    if lower.startswith(("gemma-", "gemini-")):
        return f"google/{stripped}"
    return stripped


def _task_function(version: str) -> Callable[..., Task]:
    """Returns the Inspect task function for a protocol version."""
    # Looked up at call time so that tests can patch the task functions.
    if version == "0.9.1":
        return a2ui_v0_9_1_eval
    if version == "1.0":
        return a2ui_v1_0_eval
    raise ValueError(f"Unsupported protocol version: {version}")


def default_protocol_version(strategy: str) -> str:
    """Returns the protocol version a strategy runs under when none is given."""
    return "0.9.1" if strategy == "subagent_tool" else "1.0"


def plan_protocol_versions(
    strategy: str,
    version: str,
    datasets: list[str],
) -> list[tuple[str, list[str]]]:
    """Groups the requested datasets by the protocol version they run under.

    Datasets pinned to a version (e.g. 'core_v1_0') run under that version.
    Other datasets run under `version`, or under the strategy's default version
    when `version` is 'auto'.

    Args:
        strategy: The evaluation strategy name.
        version: The '--version' argument ('0.9.1', '1.0' or 'auto').
        datasets: The requested dataset names. Empty means all datasets.

    Returns:
        A list of (protocol version, dataset names) pairs, one per task to run.
        The dataset list is empty when every dataset is requested.

    Raises:
        ValueError: If an explicit version conflicts with a requested dataset.
    """
    fallback = default_protocol_version(strategy) if version == "auto" else version
    if not datasets:
        return [(fallback, [])]

    groups: dict[str, list[str]] = {}
    for name in datasets:
        pinned = dataset_protocol_version(name)
        if pinned and version != "auto" and pinned != version:
            raise ValueError(
                f"Dataset '{name}' is pinned to protocol version {pinned} and"
                f" cannot be evaluated with --version {version}."
            )
        groups.setdefault(pinned or fallback, []).append(name)
    return list(groups.items())


def _parse_version_arg(value: str) -> str:
    """Normalizes the '--version' argument (e.g. 'v1.0' -> '1.0')."""
    cleaned = value.strip().lower()
    return cleaned if cleaned == "auto" else normalize_protocol_version(cleaned)


def _split_strategy_args(raw: list[str]) -> list[str]:
    """Flattens repeated or comma-separated `--strategies` values."""
    selected: list[str] = []
    for item in raw:
        for s in item.split(","):
            s_clean = s.strip()
            if s_clean and s_clean not in selected:
                selected.append(s_clean)
    return selected


def parse_strategies(raw: list[str] | None) -> list[str]:
    """Returns the strategies to run.

    Without `--strategies`, returns `DEFAULT_STRATEGIES` (the production
    formats); experimental strategies must be named explicitly.

    Raises:
        ValueError: If a named strategy is unknown.
    """
    if not raw:
        return list(DEFAULT_STRATEGIES)
    selected = _split_strategy_args(raw)
    for strat in selected:
        if strat not in STRATEGIES:
            raise ValueError(
                f"Unknown evaluation strategy: {strat}. Valid choices:"
                f" {', '.join(STRATEGIES.keys())}"
            )
        validate_strategy(strat)
    return selected


def resolve_runtime_settings(args: argparse.Namespace) -> dict[str, Any]:
    """Merges the `--profile` preset with the explicit runtime flags.

    An explicit `--max-samples`, `--max-connections` or `--working-limit`
    overrides the profile; `--no-judge` turns the judge off for any profile.
    """
    profile = dict(RUNTIME_PROFILES[args.profile])
    if args.max_samples is not None:
        profile["max_samples"] = args.max_samples
    if args.max_connections is not None:
        profile["max_connections"] = args.max_connections
    if args.working_limit is not None:
        profile["working_limit"] = args.working_limit
    if args.no_judge:
        profile["no_judge"] = True
    return profile


def main() -> None:
    """Parses CLI arguments and runs the A2UI evaluation suite."""
    parser = argparse.ArgumentParser(description="Run A2UI evaluations")
    parser.add_argument(
        "--sanity",
        action="store_true",
        help="Run a quick sanity check (2 samples, gemini-3.1-flash-lite, 0 retry)",
    )
    parser.add_argument(
        "--dataset",
        type=str,
        default=None,
        help=(
            "Evaluate only a specific dataset (e.g. 'customer_a_data' or 'core_v0_9_1')"
        ),
    )
    parser.add_argument(
        "--datasets",
        type=str,
        default=None,
        help="Comma-separated list of datasets to evaluate",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="google/gemini-3.6-flash",
        help="Model used to evaluate tasks (or alias like 'gemma', 'gemma-4-26b')",
    )
    parser.add_argument(
        "--grading-model",
        type=str,
        default="google/gemini-3.6-flash",
        help=(
            "Model used for grading (default: google/gemini-3.6-flash). Flash"
            " models must always be used for judging; Gemma should never be"
            " used as judge."
        ),
    )
    parser.add_argument(
        "--max-retries", type=int, default=0, help="Maximum number of retries"
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of samples to evaluate",
    )
    parser.add_argument(
        "--log-dir", type=str, default="logs", help="Directory to save logs"
    )
    parser.add_argument(
        "--sample-shuffle",
        type=int,
        default=None,
        help="Seed for shuffling samples",
    )
    parser.add_argument(
        "--thinking-budget",
        type=int,
        default=None,
        help="Thinking budget for reasoning models",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=None,
        help="Generation temperature",
    )
    parser.add_argument(
        "--max-tasks",
        type=int,
        default=None,
        help="Maximum number of concurrent tasks to execute",
    )
    parser.add_argument(
        "--max-samples",
        type=int,
        default=None,
        help="Maximum number of concurrent samples to evaluate",
    )
    parser.add_argument(
        "--strategies",
        type=str,
        action="append",
        help=(
            "Evaluation strategies to run (choices: direct, subagent_tool,"
            " express, skill_mode, elemental, atom). Can be comma-separated or"
            " specified multiple times. Defaults to the production strategies"
            " direct, subagent_tool and express."
        ),
    )
    parser.add_argument(
        "--profile",
        choices=sorted(RUNTIME_PROFILES),
        default="cloud",
        help=(
            "Runtime preset: 'cloud' (default) for hosted APIs, 'local' for a"
            " single local model server (serial samples, longer time budget),"
            " 'offline' for 'local' plus --no-judge."
        ),
    )
    parser.add_argument(
        "--no-judge",
        action="store_true",
        help=(
            "Skip the LLM judge and grade on schema validation and the"
            " dataset's deterministic assertions only."
        ),
    )
    parser.add_argument(
        "--max-connections",
        type=int,
        default=None,
        help="Maximum concurrent connections to the model provider.",
    )
    parser.add_argument(
        "--working-limit",
        type=int,
        default=None,
        help="Working time budget per sample, in seconds.",
    )
    parser.add_argument(
        "--model-base-url",
        type=str,
        default=None,
        help="Base URL of an OpenAI-compatible or other self-hosted model server.",
    )
    parser.add_argument(
        "--max-validation-retries",
        type=int,
        default=0,
        help=(
            "Times a sample may be re-asked after a validation failure. Reports"
            " Pass@1 and Pass@K."
        ),
    )
    parser.add_argument(
        "--subagent-format",
        choices=["direct_json", "express"],
        default="direct_json",
        help="Inference format the subagent_tool specialist answers in.",
    )
    parser.add_argument(
        "--tags",
        type=str,
        default=None,
        help="Comma-separated tags a sample must carry to be evaluated.",
    )
    parser.add_argument(
        "--tier",
        type=str,
        default=None,
        help="Alias for --tags with one tag, e.g. 'smoke'.",
    )
    parser.add_argument(
        "--version",
        type=_parse_version_arg,
        choices=[*PROTOCOL_VERSIONS, "auto"],
        default="auto",
        help=(
            "Protocol version to evaluate ('0.9.1', '1.0', or 'auto'). With"
            " 'auto' (the default), datasets with a version suffix such as"
            " 'core_v1_0' run under that version, and other datasets run under"
            " 1.0, or 0.9.1 for the subagent_tool strategy."
        ),
    )
    parser.add_argument(
        "--prompt",
        type=str,
        action="append",
        help="Target specific sample prompt names to evaluate",
    )
    parser.add_argument(
        "--epochs",
        type=int,
        default=None,
        help="Number of epochs/repetitions to run for each evaluation sample",
    )
    args = parser.parse_args()
    if args.sanity:
        model = "google/gemini-3.1-flash-lite"
    else:
        model = resolve_model_name(args.model)

    grading_model = resolve_model_name(args.grading_model)
    if any(
        family in grading_model.lower() for family in RESTRICTED_GRADING_MODEL_FAMILIES
    ):
        raise ValueError(
            f"Invalid grading model '{grading_model}'. Gemma models must not be"
            " used as LLM-as-a-judge; please use a Gemini Flash model (e.g."
            " 'google/gemini-3.6-flash' or 'google/gemini-3.1-flash-lite')."
        )

    limit = 2 if args.sanity else args.limit
    retry_attempts = 0 if args.sanity else args.max_retries
    sample_shuffle = None if args.sanity else args.sample_shuffle
    epochs = None if args.sanity else args.epochs

    # Resolve dataset filters
    selected_datasets = split_dataset_names(args.datasets or args.dataset)

    # Parse and validate strategies
    selected_strategies = parse_strategies(args.strategies)
    runtime = resolve_runtime_settings(args)
    tags = args.tags or args.tier

    # Plan every task and validate version support before any model call, so
    # an unsupported combination fails fast.
    task_plan: list[tuple[str, str, list[str]]] = []
    for strat in selected_strategies:
        for task_version, task_datasets in plan_protocol_versions(
            strat,
            args.version,
            selected_datasets,
        ):
            validate_version(task_version)
            task_plan.append((strat, task_version, task_datasets))

    tasks = []
    for strat, task_version, task_datasets in task_plan:
        task_func = _task_function(task_version)
        task_kwargs: dict[str, Any] = {
            "strategy": strat,
            "grading_model": grading_model,
            "dataset": ",".join(task_datasets) or None,
        }
        if tags:
            task_kwargs["tags"] = tags
        if runtime["no_judge"]:
            task_kwargs["no_judge"] = True
        if args.max_validation_retries:
            task_kwargs["max_validation_retries"] = args.max_validation_retries
        if args.subagent_format != "direct_json":
            task_kwargs["subagent_format"] = args.subagent_format

        task_obj = task_func(**task_kwargs)
        if args.prompt and getattr(task_obj, "dataset", None) is not None:
            prompt_list = [p.lower() for p in args.prompt]
            filtered = [
                s
                for s in task_obj.dataset
                if any(
                    p in str((s.metadata or {}).get("name", "")).lower()
                    or p in str(s.input).lower()
                    for p in prompt_list
                )
            ]
            task_obj.dataset = MemoryDataset(
                samples=filtered, name=task_obj.dataset.name
            )
        tasks.append(task_obj)

    eval_set_kwargs: dict[str, Any] = {
        "tasks": tasks,
        "model": model,
        "log_dir": args.log_dir,
        "retry_attempts": retry_attempts,
        "limit": limit,
        "sample_shuffle": sample_shuffle,
        "working_limit": runtime["working_limit"],
        "log_dir_allow_dirty": True,
    }
    if runtime["max_connections"] is not None:
        eval_set_kwargs["max_connections"] = runtime["max_connections"]
    if args.model_base_url:
        eval_set_kwargs["model_base_url"] = args.model_base_url
    if epochs is not None:
        eval_set_kwargs["epochs"] = epochs
    if args.thinking_budget is not None:
        eval_set_kwargs["reasoning_tokens"] = args.thinking_budget
    if args.temperature is not None:
        eval_set_kwargs["temperature"] = args.temperature
    if args.max_tasks is not None:
        eval_set_kwargs["max_tasks"] = args.max_tasks
    eval_set_kwargs["max_samples"] = runtime["max_samples"]

    print(f"Starting evaluation for strategies {selected_strategies}...")
    success, _ = eval_set(**eval_set_kwargs)
    if not success:
        print("Evaluation returned failure status!")
        sys.exit(1)

    print(f"\nEvaluations complete. Logs saved to: {os.path.abspath('logs')}")


if __name__ == "__main__":
    main()
