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
import os
import sys
from collections.abc import Callable, Collection

from inspect_ai import Task, eval_set
from inspect_ai.dataset import MemoryDataset

from a2ui_eval.bridges import (
    SDK_SUPPORTED_STRATEGIES,
    SDK_SUPPORTED_VERSIONS,
    get_sdk_bridge,
    normalize_protocol_version,
    normalize_sdk_name,
    validate_sdk_strategy,
    validate_sdk_version,
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


def resolve_model_name(model_name: str) -> str:
    """Resolves convenience aliases and provider conventions to fully qualified model IDs."""
    stripped = model_name.strip()
    lower = stripped.lower()
    if lower in MODEL_ALIASES:
        return MODEL_ALIASES[lower]
    if "/" in stripped:
        return stripped
    if lower.startswith("ollama:"):
        return f"ollama/{stripped[7:]}"
    if ":" in stripped:
        # Standard Ollama model tag convention (e.g. 'gemma4:e2b', 'llama3:8b')
        return f"ollama/{stripped}"
    if lower.startswith(("gemma-", "gemini-")):
        return f"google/{stripped}"
    return stripped


def _parse_sdks(raw_sdk: list[str] | None, raw_sdks: str | None) -> list[str]:
    """Parses and normalizes SDK CLI arguments into a deduplicated list."""
    combined: list[str] = []
    if raw_sdk:
        combined.extend(raw_sdk)
    if raw_sdks:
        combined.append(raw_sdks)
    if not combined:
        return ["python"]

    selected: list[str] = []
    for item in combined:
        for part in item.split(","):
            cleaned = part.strip()
            if cleaned:
                norm = normalize_sdk_name(cleaned)
                if norm not in selected:
                    selected.append(norm)
    return selected or ["python"]


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


def _version_key(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split("."))


def plan_protocol_versions(
    strategy: str,
    version: str,
    datasets: list[str],
    supported_versions: Collection[str] | None = None,
) -> list[tuple[str, list[str]]]:
    """Groups the requested datasets by the protocol version they run under.

    Datasets pinned to a version (e.g. 'core_v1_0') run under that version.
    Other datasets run under `version`. When `version` is 'auto', they run
    under the strategy's default version, or under the newest version in
    `supported_versions` if the SDK does not support the default.

    Args:
        strategy: The evaluation strategy name.
        version: The '--version' argument ('0.9.1', '1.0' or 'auto').
        datasets: The requested dataset names. Empty means all datasets.
        supported_versions: The protocol versions the target SDK supports.
            None means every version.

    Returns:
        A list of (protocol version, dataset names) pairs, one per task to run.
        The dataset list is empty when every dataset is requested.

    Raises:
        ValueError: If an explicit version conflicts with a requested dataset.
    """
    if version != "auto":
        fallback = version
    else:
        fallback = default_protocol_version(strategy)
        if supported_versions and fallback not in supported_versions:
            fallback = max(supported_versions, key=_version_key)
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


def main() -> None:
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
            " express, elemental, atom). Can be comma-separated or specified"
            " multiple times."
        ),
    )
    parser.add_argument(
        "--sdk",
        type=str,
        action="append",
        help=(
            "Agent SDK implementation to evaluate (choices: python, ts, dart)."
            " Can be comma-separated or specified multiple times. Defaults to"
            " 'python'."
        ),
    )
    parser.add_argument(
        "--sdks",
        type=str,
        default=None,
        help="Comma-separated list of Agent SDKs to evaluate (e.g. 'python,ts,dart').",
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
            " 1.0, or 0.9.1 for the subagent_tool strategy (falling back to the"
            " newest version the SDK supports)."
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

    # Parse and validate SDKs
    selected_sdks = _parse_sdks(args.sdk, args.sdks)

    # Parse and validate strategies
    selected_strategies: list[str] = []
    if args.strategies:
        for item in args.strategies:
            for s in item.split(","):
                s_clean = s.strip()
                if s_clean and s_clean not in selected_strategies:
                    selected_strategies.append(s_clean)
        for strat in selected_strategies:
            if strat not in STRATEGIES:
                raise ValueError(
                    f"Unknown evaluation strategy: {strat}. Valid choices:"
                    f" {', '.join(STRATEGIES.keys())}"
                )
            for sdk in selected_sdks:
                validate_sdk_strategy(sdk, strat)
    else:
        for sdk in selected_sdks:
            for strat in SDK_SUPPORTED_STRATEGIES[sdk]:
                if strat not in selected_strategies:
                    selected_strategies.append(strat)

    # Plan every task and validate SDK/version support before any SDK build
    # or model call, so an unsupported combination fails fast.
    task_plan: list[tuple[str, str, str, list[str]]] = []
    for sdk in selected_sdks:
        sdk_strategies = (
            selected_strategies
            if args.strategies
            else list(SDK_SUPPORTED_STRATEGIES[sdk])
        )
        for strat in sdk_strategies:
            for task_version, task_datasets in plan_protocol_versions(
                strat,
                args.version,
                selected_datasets,
                SDK_SUPPORTED_VERSIONS[sdk],
            ):
                validate_sdk_version(sdk, task_version)
                task_plan.append((sdk, strat, task_version, task_datasets))

    for sdk in selected_sdks:
        get_sdk_bridge(sdk).prepare()

    tasks = []
    for sdk, strat, task_version, task_datasets in task_plan:
        task_func = _task_function(task_version)
        task_kwargs = {
            "strategy": strat,
            "grading_model": grading_model,
            "dataset": ",".join(task_datasets) or None,
        }
        if sdk != "python":
            task_kwargs["sdk"] = sdk

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

    eval_set_kwargs = {
        "tasks": tasks,
        "model": model,
        "log_dir": args.log_dir,
        "retry_attempts": retry_attempts,
        "limit": limit,
        "sample_shuffle": sample_shuffle,
        "working_limit": 350,
        "log_dir_allow_dirty": True,
    }
    if epochs is not None:
        eval_set_kwargs["epochs"] = epochs
    if args.thinking_budget is not None:
        eval_set_kwargs["reasoning_tokens"] = args.thinking_budget
    if args.temperature is not None:
        eval_set_kwargs["temperature"] = args.temperature
    if args.max_tasks is not None:
        eval_set_kwargs["max_tasks"] = args.max_tasks
    eval_set_kwargs["max_samples"] = (
        args.max_samples if args.max_samples is not None else 10
    )

    print(
        f"Starting evaluation for SDKs {selected_sdks} and strategies"
        f" {selected_strategies}..."
    )
    success, _ = eval_set(**eval_set_kwargs)
    if not success:
        print("Evaluation returned failure status!")
        sys.exit(1)

    print(f"\nEvaluations complete. Logs saved to: {os.path.abspath('logs')}")


if __name__ == "__main__":
    main()
