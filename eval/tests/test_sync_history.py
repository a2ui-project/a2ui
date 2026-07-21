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

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
EVAL_ITERATIVE_DIR = REPO_ROOT / "eval/iterative"

if str(EVAL_ITERATIVE_DIR) not in sys.path:
    sys.path.insert(0, str(EVAL_ITERATIVE_DIR))

from sync_history import _get_max_run_id, main, sync_worktree_history


class TestSyncHistory(unittest.TestCase):

    def test_get_max_run_id(self):
        temp_dir = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(temp_dir, "run_001_foo"))
            os.makedirs(os.path.join(temp_dir, "run_005_bar"))
            os.makedirs(os.path.join(temp_dir, "run_invalid"))

            max_id = _get_max_run_id(temp_dir)
            self.assertEqual(max_id, 5)
        finally:
            shutil.rmtree(temp_dir)

    def test_sync_worktree_history_basic(self):
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
                    self.assertIn("run_099_wt_run", copied)
        finally:
            shutil.rmtree(temp_dir)

    def test_sync_worktree_history_collision_reindex(self):
        temp_dir = tempfile.mkdtemp()
        try:
            main_history = os.path.join(temp_dir, "history")
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
                    copied = sync_worktree_history(target_worktrees=[wt_dir])
                    self.assertTrue(len(copied) == 1)
                    self.assertIn("run_006_", copied[0])
        finally:
            shutil.rmtree(temp_dir)

    def test_main_cli(self):
        temp_dir = tempfile.mkdtemp()
        try:
            with patch("sync_history.sync_worktree_history") as mock_sync:
                mock_sync.return_value = ["run_100_synced"]
                with patch("sys.stdout"):
                    main(["-w", "/tmp/wt1"])
                self.assertTrue(mock_sync.called)
        finally:
            shutil.rmtree(temp_dir)


if __name__ == "__main__":
    unittest.main()
