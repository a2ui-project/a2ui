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

"""Subprocess execution runners for pytest, Inspect AI evaluations, and git diffs."""

import json
import os
import shutil
import subprocess
from typing import Any, Dict, List, Optional


def _get_uv_binary() -> str:
    return shutil.which("uv") or "/usr/local/google/home/gspencer/.local/bin/uv"


def run_unit_tests() -> Dict[str, Any]:
    """Runs pytest unit tests for the python SDK."""
    print("Running pytest unit tests...")
    script_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    eval_root = os.path.dirname(script_dir)
    workspace_root = os.path.dirname(eval_root)

    cmd = [_get_uv_binary(), "run", "pytest", "agent_sdks/python/a2ui_agent/tests/"]
    result = subprocess.run(cmd, cwd=workspace_root, capture_output=True, text=True)

    return {
        "success": result.returncode == 0,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "returncode": result.returncode,
    }


def run_evaluation(
    format_name: str,
    model: str,
    prompts: Optional[List[str]],
    sanity: bool,
    log_dir: str,
) -> bool:
    """Runs the main evaluation framework for the target format strategy."""
    print(f"Running evaluation for strategy '{format_name}' using model '{model}'...")
    script_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    eval_root = os.path.dirname(script_dir)

    strategy_name = "direct" if format_name == "transport" else format_name
    cmd = [
        _get_uv_binary(),
        "run",
        "python",
        "main.py",
        "--strategies",
        strategy_name,
        "--model",
        model,
        "--log-dir",
        log_dir,
    ]

    if sanity:
        cmd.append("--sanity")

    if prompts:
        for p in prompts:
            cmd.extend(["--prompt", p])

    print(f"Executing: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=eval_root, capture_output=False)
    return result.returncode == 0


def load_log_data(log_path: str) -> Dict[str, Any]:
    """Runs inspect log dump and parses the JSON."""
    dump_cmd = [_get_uv_binary(), "run", "inspect", "log", "dump", log_path]
    output = subprocess.check_output(dump_cmd, text=True)
    return json.loads(output)


def get_git_diff(workspace_root: str) -> str:
    """Retrieves git diff of active modifications under agent_sdks/."""
    cmd = ["git", "diff", "agent_sdks/"]
    try:
        result = subprocess.run(cmd, cwd=workspace_root, capture_output=True, text=True)
        return result.stdout.strip()
    except Exception:
        return ""
