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

import os
import sys
import argparse
from inspect_ai import eval_set
from tasks import a2ui_v0_9_1_eval, a2ui_v1_0_eval
from a2ui_eval.strategies import STRATEGIES

# Automatically limit Inspect AI's connection rate-limiter limit and cap model retry backoffs to prevent 503 errors
os.environ["INSPECT_MAX_CONNECTIONS"] = "10"
os.environ["INSPECT_MODEL_MAX_BACKOFF"] = "300"


from inspect_ai.dataset import MemoryDataset

MODEL_ALIASES: dict[str, str] = {
    # Cloud models
    "gemma": "google/gemma-4-26b-a4b-it",
    "gemma-4-26b": "google/gemma-4-26b-a4b-it",
    "gemma-large": "google/gemma-4-31b-it",
    "gemma-4-31b": "google/gemma-4-31b-it",
    "gemini-3.8-flash": "google/gemini-3.8-flash",
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
        default="google/gemini-3.8-flash",
        help="Model used to evaluate tasks (or alias like 'gemma', 'gemma-4-26b')",
    )
    parser.add_argument(
        "--grading-model",
        type=str,
        default="google/gemini-3.8-flash",
        help=(
            "Model used for grading (default: google/gemini-3.8-flash). Flash models"
            " must always be used for judging; Gemma should never be used as judge."
        ),
    )
    parser.add_argument(
        "--max-retries", type=int, default=0, help="Maximum number of retries"
    )
    parser.add_argument(
        "--limit", type=int, default=None, help="Maximum number of samples to evaluate"
    )
    parser.add_argument(
        "--log-dir", type=str, default="logs", help="Directory to save logs"
    )
    parser.add_argument(
        "--sample-shuffle", type=int, default=None, help="Seed for shuffling samples"
    )
    parser.add_argument(
        "--thinking-budget",
        type=int,
        default=None,
        help="Thinking budget for reasoning models",
    )
    parser.add_argument(
        "--temperature", type=float, default=None, help="Generation temperature"
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
            "Evaluation strategies to run (choices: direct, subagent_tool, express,"
            " elemental, atom). Can be comma-separated or specified multiple times."
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
            f"Invalid grading model '{grading_model}'. Gemma models must not be used"
            " as LLM-as-a-judge; please use a Gemini Flash model (e.g."
            " 'google/gemini-3.8-flash' or 'google/gemini-3.1-flash-lite')."
        )

    limit = 2 if args.sanity else args.limit
    retry_attempts = 0 if args.sanity else args.max_retries
    sample_shuffle = None if args.sanity else args.sample_shuffle
    epochs = None if args.sanity else args.epochs

    # Resolve dataset filters
    selected_dataset = args.dataset
    if args.datasets:
        selected_dataset = args.datasets

    # Parse and validate strategies
    selected_strategies = []
    raw_strategies = args.strategies if args.strategies else ["direct", "subagent_tool"]
    for item in raw_strategies:
        for s in item.split(","):
            s_clean = s.strip()
            if s_clean and s_clean not in selected_strategies:
                selected_strategies.append(s_clean)

    tasks = []
    for strat in selected_strategies:
        if strat not in STRATEGIES:
            raise ValueError(
                f"Unknown evaluation strategy: {strat}. Valid choices:"
                f" {', '.join(STRATEGIES.keys())}"
            )
        task_func = (
            a2ui_v1_0_eval
            if strat in ["express", "elemental", "atom", "direct"]
            else a2ui_v0_9_1_eval
        )
        task_obj = task_func(
            strategy=strat,
            grading_model=grading_model,
            dataset=selected_dataset,
        )
        if args.prompt:
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

    print("Starting evaluation for multiple strategies...")
    success, logs = eval_set(**eval_set_kwargs)
    if not success:
        print("Evaluation returned failure status!")
        sys.exit(1)

    print(f"\nEvaluations complete. Logs saved to: {os.path.abspath('logs')}")


if __name__ == "__main__":
    main()
