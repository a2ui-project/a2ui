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

import os
import sys
import traceback
import argparse
from inspect_ai import eval_set
from tasks import a2ui_v0_9_1_eval, a2ui_v1_0_eval
from a2ui_eval.strategies import STRATEGIES

# Automatically override Inspect AI's connection rate-limiter limit to prevent queuing delays in latency measurements
os.environ["INSPECT_MAX_CONNECTIONS"] = "50"


def main():
    parser = argparse.ArgumentParser(description="Run A2UI evaluations")
    parser.add_argument(
        "--sanity",
        action="store_true",
        help="Run a quick sanity check (2 samples, gemini-3.1-flash-lite, 0 retry)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="google/gemini-3.5-flash",
        help="Model used to evaluate tasks",
    )
    parser.add_argument(
        "--grading-model",
        type=str,
        default="google/gemini-3.5-flash",
        help="Model used for grading",
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
            " elemental). Can be comma-separated or specified multiple times."
        ),
    )
    args = parser.parse_args()

    model = "google/gemini-3.1-flash-lite" if args.sanity else args.model
    limit = 2 if args.sanity else args.limit
    retry_attempts = 0 if args.sanity else args.max_retries
    sample_shuffle = None if args.sanity else args.sample_shuffle

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
        if strat in ["express", "elemental"]:
            tasks.append(
                a2ui_v1_0_eval(strategy=strat, grading_model=args.grading_model)
            )
        else:
            tasks.append(
                a2ui_v0_9_1_eval(strategy=strat, grading_model=args.grading_model)
            )

    eval_set_kwargs = {
        "tasks": tasks,
        "model": model,
        "log_dir": args.log_dir,
        "retry_attempts": retry_attempts,
        "limit": limit,
        "sample_shuffle": sample_shuffle,
    }
    model_args = {}
    if args.thinking_budget is not None:
        model_args["reasoning_tokens"] = args.thinking_budget
    if args.temperature is not None:
        model_args["temperature"] = args.temperature
    if model_args:
        eval_set_kwargs["model_args"] = model_args
    if args.max_tasks is not None:
        eval_set_kwargs["max_tasks"] = args.max_tasks
    if args.max_samples is not None:
        eval_set_kwargs["max_samples"] = args.max_samples

    print("Starting evaluation for multiple strategies...")
    success, logs = eval_set(**eval_set_kwargs)
    if not success:
        print("Evaluation returned failure status!")
        sys.exit(1)

    print(f"\nEvaluations complete. Logs saved to: {os.path.abspath('logs')}")


if __name__ == "__main__":
    main()
