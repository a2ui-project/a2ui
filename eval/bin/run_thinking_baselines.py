#!/usr/bin/env python3
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

"""Orchestration script to run and aggregate thinking budget baselines."""

import json
import os
import shutil
import subprocess
import sys
from typing import Dict, Any, List

FORMATS = ["transport", "express", "elemental", "atom"]
BUDGETS = [0, 1795, 897]


def get_uv_binary() -> str:
    user_uv = os.path.expanduser("~/.local/bin/uv")
    if os.path.exists(user_uv):
        return user_uv
    cargo_uv = os.path.expanduser("~/.cargo/bin/uv")
    if os.path.exists(cargo_uv):
        return cargo_uv
    return shutil.which("uv") or "uv"


def main():
    eval_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    optimizer_script = os.path.join(
        eval_dir,
        "skills",
        "inference-format-optimizer",
        "scripts",
        "optimize_format.py",
    )
    baselines_thinking_root = os.path.join(eval_dir, "baselines_thinking")

    print(f"Starting Thinking Budget Baselines Evaluation Matrix...")
    print(f"Formats: {FORMATS}")
    print(f"Budget Levels: {BUDGETS}")
    print(f"Target Root: {baselines_thinking_root}\n")

    uv_bin = get_uv_binary()
    completed_runs = 0
    total_runs = len(FORMATS) * len(BUDGETS)

    for budget in BUDGETS:
        for fmt in FORMATS:
            completed_runs += 1
            print(f"\n========================================================")
            print(
                f"[{completed_runs}/{total_runs}] Running Format '{fmt}' with Thinking"
                f" Budget = {budget}"
            )
            print(f"========================================================")

            target_baseline_dir = os.path.join(
                baselines_thinking_root, f"budget_{budget}", fmt
            )
            os.makedirs(target_baseline_dir, exist_ok=True)

            cmd = [
                uv_bin,
                "run",
                "python",
                optimizer_script,
                "--format",
                fmt,
                "--full",
                "--save-baseline",
                "--thinking-budget",
                str(budget),
                "--baseline-dir",
                target_baseline_dir,
            ]

            print(f"Executing: {' '.join(cmd)}")
            res = subprocess.run(cmd, cwd=eval_dir)
            if res.returncode != 0:
                print(f"Error: Run failed for format '{fmt}' with budget {budget}!")
                sys.exit(res.returncode)

    print("\nAll 12 baseline runs completed successfully!")


if __name__ == "__main__":
    main()
