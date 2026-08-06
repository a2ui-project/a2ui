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

"""Synchronizes archived history runs across multiple parallel worktrees into a single master history."""

import argparse
import glob
import os
import shutil
import sys
from pathlib import Path
from typing import List, Optional

# Add parent directory to sys.path to import optimize_format
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from optimize_format import (  # type: ignore[import-not-found]
    regenerate_master_index,
)


def _get_max_run_id(history_dir: str) -> int:
    """Finds the maximum integer run ID existing in the target history directory.

    Args:
        history_dir: The filesystem path to the history directory.

    Returns:
        The highest integer run ID found, or 0 if no numeric run IDs exist.
    """
    max_id = 0
    if os.path.exists(history_dir):
        for entry in os.scandir(history_dir):
            if entry.is_dir() and entry.name.startswith("run_"):
                parts = entry.name.split("_")
                if len(parts) >= 2 and parts[1].isdigit():
                    max_id = max(max_id, int(parts[1]))
    return max_id


def sync_worktree_history(
    target_worktrees: Optional[List[str]] = None,
    skip_index_regen: bool = False,
    custom_history_dir: Optional[str] = None,
) -> List[str]:
    """Synchronizes archived run directories from sibling worktrees into main history.

    Args:
        target_worktrees: Optional list of target worktree filesystem paths to scan.
        skip_index_regen: Whether to skip master index regeneration after syncing.
        custom_history_dir: Optional custom main history directory path.

    Returns:
        A list of folder names for newly synchronized history runs.
    """
    skill_dir = (
        os.path.dirname(SCRIPT_DIR)
        if os.path.basename(SCRIPT_DIR) == "scripts"
        else SCRIPT_DIR
    )
    parents = list(Path(skill_dir).parents)
    detected_root = None
    for p in [Path(skill_dir)] + parents:
        if (p / "specification").exists() and (p / "agent_sdks").exists():
            detected_root = str(p)
            break
    workspace_root = detected_root or skill_dir

    if custom_history_dir:
        main_history_dir = custom_history_dir
    else:
        main_history_dir = os.path.join(
            workspace_root, "eval", "iterative_format_optimizer", "history"
        )
    os.makedirs(main_history_dir, exist_ok=True)

    if not target_worktrees:
        parent_dir = os.path.normpath(os.path.join(workspace_root, ".."))
        worktrees_dir = os.path.join(parent_dir, "worktrees")
        target_worktrees = []
        if os.path.exists(worktrees_dir):
            for entry in os.scandir(worktrees_dir):
                if entry.is_dir():
                    target_worktrees.append(entry.path)

        if os.path.exists(parent_dir):
            for entry in os.scandir(parent_dir):
                if entry.is_dir() and entry.name != "worktrees":
                    target_worktrees.append(entry.path)

    copied_runs = []

    for wt in target_worktrees:
        wt_history = os.path.join(wt, "eval", "iterative_format_optimizer", "history")
        if not os.path.exists(wt_history):
            wt_history = os.path.join(wt, "eval", "history")
        if not os.path.exists(wt_history):
            wt_history = os.path.join(
                wt, "eval", "skills", "inference-format-optimizer", "history"
            )
        if not os.path.exists(wt_history):
            wt_history = os.path.join(wt, "eval", "iterative", "history")
        if not os.path.exists(wt_history):
            continue

        # Collect run directories per format
        runs_to_sync = []
        for entry in os.scandir(wt_history):
            if entry.is_dir():
                if entry.name.startswith("run_"):
                    runs_to_sync.append(("atom", entry))
                else:
                    fmt_sub = entry.name
                    for sub in os.scandir(entry.path):
                        if sub.is_dir() and sub.name.startswith("run_"):
                            runs_to_sync.append((fmt_sub, sub))

        for fmt_sub, entry in sorted(runs_to_sync, key=lambda x: x[1].name):
            target_fmt_dir = os.path.join(main_history_dir, fmt_sub)
            os.makedirs(target_fmt_dir, exist_ok=True)

            existing_dirs = {e.name for e in os.scandir(target_fmt_dir) if e.is_dir()}
            current_max_id = _get_max_run_id(target_fmt_dir)

            occupied_ids = set()
            for d_name in existing_dirs:
                if d_name.startswith("run_"):
                    d_parts = d_name.split("_")
                    if len(d_parts) >= 2 and d_parts[1].isdigit():
                        occupied_ids.add(int(d_parts[1]))

            exact_dest = os.path.join(target_fmt_dir, entry.name)
            if entry.name in existing_dirs:
                continue

            parts = entry.name.split("_")
            run_id_num = (
                int(parts[1]) if (len(parts) >= 2 and parts[1].isdigit()) else None
            )

            id_occupied = (
                run_id_num in occupied_ids if run_id_num is not None else False
            )

            if id_occupied:
                current_max_id += 1
                new_id_str = f"{current_max_id:03d}"
                parts[1] = new_id_str
                new_name = "_".join(parts)
                dest_dir = os.path.join(target_fmt_dir, new_name)
            else:
                dest_dir = exact_dest

            try:
                shutil.copytree(entry.path, dest_dir)
                bname = os.path.basename(dest_dir)
                copied_runs.append(f"{fmt_sub}/{bname}")
            except FileExistsError:
                pass
            except Exception as e:
                if os.path.exists(dest_dir):
                    shutil.rmtree(dest_dir)
                print(f"Warning: Failed to sync {entry.path}: {e}", file=sys.stderr)

    # Rebuild master index if requested
    if not skip_index_regen:
        from optimize_format import regenerate_master_index  # type: ignore[import-not-found]

        regenerate_master_index(main_history_dir)
    return copied_runs


def main(argv: Optional[List[str]] = None) -> None:
    """Executes the CLI entrypoint for synchronizing worktree history runs.

    Args:
        argv: Optional command-line argument list.
    """
    parser = argparse.ArgumentParser(
        description=(
            "Sync history run directories from parallel worktrees into main history."
        )
    )
    parser.add_argument(
        "--worktree",
        "-w",
        action="append",
        dest="worktrees",
        help=(
            "Path to worktree directory to sync history from (can be specified multiple"
            " times)"
        ),
    )
    parser.add_argument(
        "--history-dir",
        type=str,
        default=None,
        help=(
            "Custom main history directory path (defaults to"
            " <workspace_root>/eval/iterative_format_optimizer/history)"
        ),
    )

    args = parser.parse_args(argv)
    synced = sync_worktree_history(args.worktrees, custom_history_dir=args.history_dir)

    if synced:
        print(
            f"Successfully synchronized {len(synced)} history runs: {', '.join(synced)}"
        )
    else:
        print("No new history runs found to synchronize.")


if __name__ == "__main__":
    main()
