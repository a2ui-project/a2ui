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

"""Atomic run archiving and history synchronization helper utility."""

import glob
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional

from utils.runner import load_log_data, get_git_diff  # type: ignore[import-not-found]
from utils.reporter import extract_metrics_from_log  # type: ignore[import-not-found]


def _slugify(text: str) -> str:
    slug = text.lower()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_-]+", "_", slug).strip("_")
    return slug[:40] if slug else "run"


def _get_git_commit_sha(workspace_root: str) -> str:
    try:
        cmd = ["git", "rev-parse", "--short", "HEAD"]
        res = subprocess.run(cmd, cwd=workspace_root, capture_output=True, text=True)
        return res.stdout.strip() or "0000000"
    except Exception:
        return "0000000"


def archive_run(
    format_name: str,
    hypothesis: str,
    status: str,
    notes: Optional[str] = None,
    log_dir: Optional[str] = None,
) -> str:
    """Atomically archives current optimization run artifacts into eval/iterative/history/."""
    script_dir = Path(__file__).resolve().parent.parent
    history_dir = script_dir / "history"
    history_dir.mkdir(parents=True, exist_ok=True)
    workspace_root = str(script_dir.parent.parent)

    # 1. Determine next run ID index
    max_id = 0
    for entry in history_dir.iterdir():
        if entry.is_dir() and entry.name.startswith("run_"):
            parts = entry.name.split("_")
            if len(parts) >= 2 and parts[1].isdigit():
                max_id = max(max_id, int(parts[1]))

    next_id = max_id + 1
    sha = _get_git_commit_sha(workspace_root)
    slug = _slugify(hypothesis)
    dir_name = f"run_{next_id:03d}_{sha}_{slug}"
    target_dir = history_dir / dir_name
    target_dir.mkdir(parents=True, exist_ok=True)

    # 2. Save git diff patch
    diff_text = get_git_diff(workspace_root)
    (target_dir / "patch.diff").write_text(diff_text, encoding="utf-8")

    # 3. Copy current report
    report_src = script_dir / "current_report.md"
    if report_src.exists():
        shutil.copy(report_src, target_dir / "report.md")

    # 4. Extract metrics & write run_meta.json
    temp_dir = log_dir or str(script_dir.parent / "logs" / "temp_optimization")
    eval_logs = glob.glob(os.path.join(temp_dir, "*.eval"))

    metrics_extracted: Dict[str, Any] = {}
    if eval_logs:
        try:
            log_data = load_log_data(eval_logs[0])
            metrics_extracted = extract_metrics_from_log(log_data)
        except Exception:
            pass

    meta_payload = {
        "format": format_name,
        "hypothesis": hypothesis,
        "status": status,
        "notes": notes or ("Pytest PASS" if status == "Kept" else "Reverted"),
        "metrics": {
            "schema_acc": metrics_extracted.get("algo_accuracy", 0.0),
            "quality_acc": metrics_extracted.get("overall_accuracy", 0.0),
            "code_tokens_median": metrics_extracted.get(
                "median_output_tokens", metrics_extracted.get("avg_output_tokens", 0.0)
            ),
            "reasoning_tokens_median": metrics_extracted.get(
                "median_reasoning_tokens",
                metrics_extracted.get("avg_reasoning_tokens", 0.0),
            ),
            "input_tokens_median": metrics_extracted.get(
                "median_input_tokens", metrics_extracted.get("avg_input_tokens", 0.0)
            ),
            "latency_seconds_median": metrics_extracted.get(
                "median_latency_seconds",
                metrics_extracted.get("avg_latency_seconds", 0.0),
            ),
            "total_samples": metrics_extracted.get("total_samples", 0),
        },
    }

    with open(target_dir / "run_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta_payload, f, indent=2)

    # 5. Synchronize master index
    try:
        from sync_history import sync_worktree_history  # type: ignore[import-not-found]

        sync_worktree_history()
    except Exception:
        pass

    from optimize_format import regenerate_master_index  # type: ignore[import-not-found]

    regenerate_master_index(str(script_dir))

    print(f"🎉 Successfully archived run {next_id:03d} to: {target_dir}")
    return str(target_dir)
