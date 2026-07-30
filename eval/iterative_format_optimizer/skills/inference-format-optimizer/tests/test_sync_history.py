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

"""Unit tests for sync_history.py."""

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


from sync_history import _get_max_run_id, main, sync_worktree_history


class TestSyncHistory(unittest.TestCase):

    def test_get_max_run_id(self) -> None:
        temp_dir = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(temp_dir, "run_001_foo"))
            os.makedirs(os.path.join(temp_dir, "run_005_bar"))
            os.makedirs(os.path.join(temp_dir, "run_invalid"))

            max_id = _get_max_run_id(temp_dir)
            self.assertEqual(max_id, 5)
        finally:
            shutil.rmtree(temp_dir)

    def test_sync_worktree_history_basic(self) -> None:
        temp_dir = tempfile.mkdtemp()
        try:
            wt_dir = os.path.join(temp_dir, "worktree_1")
            wt_history = os.path.join(wt_dir, "eval", "iterative", "history")
            run_dir = os.path.join(wt_history, "run_099_wt_run")
            os.makedirs(run_dir, exist_ok=True)
            with open(os.path.join(run_dir, "run_meta.json"), "w") as f:
                json.dump({"hypothesis": "worktree run", "status": "Kept"}, f)

            with patch("sync_history.SCRIPT_DIR", temp_dir):
                with patch("sync_history.regenerate_master_index"):
                    copied = sync_worktree_history(target_worktrees=[wt_dir])
                    self.assertTrue(any("run_099_wt_run" in c for c in copied))
        finally:
            shutil.rmtree(temp_dir)

    def test_sync_worktree_history_collision_reindex(self) -> None:
        temp_dir = tempfile.mkdtemp()
        try:
            main_history = os.path.join(temp_dir, "history", "atom")
            os.makedirs(
                os.path.join(main_history, "run_005_existing_main"), exist_ok=True
            )

            wt_dir = os.path.join(temp_dir, "worktree_2")
            wt_history = os.path.join(wt_dir, "eval", "iterative", "history")
            run_dir = os.path.join(wt_history, "run_005_incoming_colliding")
            os.makedirs(run_dir, exist_ok=True)
            with open(os.path.join(run_dir, "run_meta.json"), "w") as f:
                json.dump({"hypothesis": "colliding run", "status": "Kept"}, f)

            with patch("sync_history.SCRIPT_DIR", temp_dir):
                with patch("sync_history.regenerate_master_index"):
                    copied = sync_worktree_history(
                        target_worktrees=[wt_dir],
                        custom_history_dir=os.path.join(temp_dir, "history"),
                    )
                    self.assertTrue(len(copied) == 1)
                    self.assertIn("run_006_", copied[0])
        finally:
            shutil.rmtree(temp_dir)

    @patch("subprocess.check_output")
    def test_sync_worktree_history_with_git_worktree_command(self, mock_sub) -> None:
        temp_dir = tempfile.mkdtemp()
        try:
            wt1 = os.path.join(temp_dir, "worktree_1")
            wt1_hist = os.path.join(
                wt1, "eval", "iterative_format_optimizer", "history", "atom"
            )
            run1 = os.path.join(wt1_hist, "run_010_wt1_run")
            os.makedirs(run1, exist_ok=True)
            with open(os.path.join(run1, "run_meta.json"), "w") as f:
                json.dump({"hypothesis": "wt1 hypo", "status": "KEEP"}, f)

            mock_sub.return_value = f"worktree {temp_dir}\nworktree {wt1}\n".encode(
                "utf-8"
            )
            with patch("sync_history.regenerate_master_index"):
                copied = sync_worktree_history(
                    target_worktrees=[wt1],
                    custom_history_dir=os.path.join(temp_dir, "history"),
                )
                self.assertTrue(len(copied) == 1)
        finally:
            shutil.rmtree(temp_dir)

    def test_main_cli(self) -> None:
        temp_dir = tempfile.mkdtemp()
        try:
            with patch("sync_history.sync_worktree_history") as mock_sync:
                mock_sync.return_value = ["run_100_synced"]
                with patch("sys.stdout"):
                    main(["-w", "/tmp/wt1"])
                self.assertTrue(mock_sync.called)
        finally:
            shutil.rmtree(temp_dir)

    def test_sync_worktree_history_default_discovery(self) -> None:
        temp_dir = tempfile.mkdtemp()
        try:
            worktrees_dir = os.path.join(temp_dir, "worktrees")
            wt1 = os.path.join(worktrees_dir, "wt1")
            wt1_hist = os.path.join(
                wt1, "eval", "iterative_format_optimizer", "history"
            )
            run1 = os.path.join(wt1_hist, "run_099_discover")
            os.makedirs(run1, exist_ok=True)
            with open(os.path.join(run1, "run_meta.json"), "w") as f:
                json.dump({"hypothesis": "discover hypo", "status": "KEEP"}, f)

            with patch("sync_history.regenerate_master_index"):
                copied = sync_worktree_history(
                    target_worktrees=[wt1],
                    custom_history_dir=os.path.join(temp_dir, "history"),
                )
                self.assertEqual(len(copied), 1)
        finally:
            shutil.rmtree(temp_dir)


if __name__ == "__main__":
    unittest.main()
