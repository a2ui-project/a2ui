# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Tests for the check_compliance script.

This module validates that the compliance check script successfully identifies
codebases as up-to-date, out-of-date, not baselined, or erroneous based on
associated module and feature blueprints.
"""

from __future__ import annotations

import io
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

# Ensure the directory containing check_compliance.py is in the Python search path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from check_compliance import audit_feature_commits, is_valid_ancestor, main, run_cmd
from validate_blueprints import _validate_single_codebase_blueprint, parse_yaml


class TestCheckCompliance(unittest.TestCase):
    """Unit tests for the check_compliance script."""

    @patch("sys.stdout", new_callable=io.StringIO)
    @patch("glob.glob")
    @patch("check_compliance.parse_frontmatter")
    @patch("os.path.exists")
    @patch("subprocess.run")
    def test_up_to_date_codebase(
        self,
        mock_run: MagicMock,
        mock_exists: MagicMock,
        mock_parse: MagicMock,
        mock_glob: MagicMock,
        mock_stdout: MagicMock,
    ) -> None:
        """Verifies that a codebase matching the latest module blueprint is marked Up to Date."""
        mock_glob.return_value = [
            "/path/to/blueprints/codebases/flutter/codebase.blueprint.md"
        ]
        mock_parse.return_value = (
            {
                "codebase_path": "renderers/flutter",
                "associated_module": "flutter_core",
                "module_blueprint_commit": "abcdef1234567890",
            },
            None,
        )
        mock_exists.return_value = True

        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_res.stdout = "abcdef1234567890\n"
        mock_run.return_value = mock_res

        main()

        output = mock_stdout.getvalue()
        self.assertIn("🟢 Up to Date", output)
        self.assertIn(
            "| `renderers/flutter` | `flutter_core` | 🟢 Up to Date | 0 | `abcdef12` |"
            " `abcdef12` |",
            output,
        )

    @patch("sys.stdout", new_callable=io.StringIO)
    @patch("glob.glob")
    @patch("check_compliance.parse_frontmatter")
    @patch("os.path.exists")
    @patch("subprocess.run")
    def test_out_of_date_codebase(
        self,
        mock_run: MagicMock,
        mock_exists: MagicMock,
        mock_parse: MagicMock,
        mock_glob: MagicMock,
        mock_stdout: MagicMock,
    ) -> None:
        """Verifies that a codebase behind by commits is marked Out of Date and lists commits."""
        mock_glob.return_value = [
            "/path/to/blueprints/codebases/flutter/codebase.blueprint.md"
        ]
        mock_parse.return_value = (
            {
                "codebase_path": "renderers/flutter",
                "associated_module": "flutter_core",
                "module_blueprint_commit": "12345678",
            },
            None,
        )
        mock_exists.return_value = True

        mock_latest = MagicMock()
        mock_latest.returncode = 0
        mock_latest.stdout = "abcdef12\n"

        mock_ancestor = MagicMock()
        mock_ancestor.returncode = 0
        mock_ancestor.stdout = ""

        mock_log = MagicMock()
        mock_log.returncode = 0
        mock_log.stdout = "commit2: fix something\ncommit1: initial change\n"

        mock_run.side_effect = [mock_latest, mock_ancestor, mock_log]

        main()

        output = mock_stdout.getvalue()
        self.assertIn("🟡 Out of Date", output)
        self.assertIn(
            "| `renderers/flutter` | `flutter_core` | 🟡 Out of Date | 2 | `12345678` |"
            " `abcdef12` |",
            output,
        )
        self.assertIn("commit2: fix something", output)
        self.assertIn("commit1: initial change", output)

    @patch("sys.stdout", new_callable=io.StringIO)
    @patch("glob.glob")
    @patch("check_compliance.parse_frontmatter")
    @patch("os.path.exists")
    @patch("subprocess.run")
    def test_not_baselined_codebase(
        self,
        mock_run: MagicMock,
        mock_exists: MagicMock,
        mock_parse: MagicMock,
        mock_glob: MagicMock,
        mock_stdout: MagicMock,
    ) -> None:
        """Verifies that a codebase missing the commit pin is marked Not Baselined."""
        mock_glob.return_value = [
            "/path/to/blueprints/codebases/flutter/codebase.blueprint.md"
        ]
        mock_parse.return_value = (
            {
                "codebase_path": "renderers/flutter",
                "associated_module": "flutter_core",
                "module_blueprint_commit": None,
            },
            None,
        )
        mock_exists.return_value = True

        mock_latest = MagicMock()
        mock_latest.returncode = 0
        mock_latest.stdout = "abcdef12\n"

        mock_log = MagicMock()
        mock_log.returncode = 0
        mock_log.stdout = "commit2: fix something\ncommit1: initial change\n"

        mock_run.side_effect = [mock_latest, mock_log]

        main()

        output = mock_stdout.getvalue()
        self.assertIn("🔴 Not Baselined", output)
        self.assertIn(
            "| `renderers/flutter` | `flutter_core` | 🔴 Not Baselined | All | `None` |"
            " `abcdef12` |",
            output,
        )

    @patch("sys.stdout", new_callable=io.StringIO)
    @patch("glob.glob")
    @patch("check_compliance.parse_frontmatter")
    @patch("os.path.exists")
    def test_missing_module_blueprint(
        self,
        mock_exists: MagicMock,
        mock_parse: MagicMock,
        mock_glob: MagicMock,
        mock_stdout: MagicMock,
    ) -> None:
        """Verifies that a codebase whose module blueprint does not exist is marked Error."""
        mock_glob.return_value = [
            "/path/to/blueprints/codebases/flutter/codebase.blueprint.md"
        ]
        mock_parse.return_value = (
            {
                "codebase_path": "renderers/flutter",
                "associated_module": "flutter_core",
                "module_blueprint_commit": "12345678",
            },
            None,
        )
        mock_exists.return_value = False

        main()

        output = mock_stdout.getvalue()
        self.assertIn("🔴 Error", output)
        self.assertIn(
            "| `renderers/flutter` | `flutter_core` | 🔴 Error | 0 | `12345678` |"
            " `unknown` |",
            output,
        )

    @patch("subprocess.run")
    def test_is_valid_ancestor_rejects_non_string_commit(
        self, mock_run: MagicMock
    ) -> None:
        """Verifies that non-string commit values return False without invoking git."""
        self.assertFalse(is_valid_ancestor(None))
        self.assertFalse(is_valid_ancestor(True))
        self.assertFalse(is_valid_ancestor(1234))
        mock_run.assert_not_called()

    @patch("validate_blueprints.parse_frontmatter")
    def test_validate_codebase_blueprint_rejects_non_string_codebase_path(
        self, mock_parse: MagicMock
    ) -> None:
        """Verifies that a non-string codebase_path reports an error instead of raising."""
        mock_parse.return_value = (
            {
                "codebase_path": True,
                "associated_module": "flutter_core",
                "module_blueprint_commit": None,
                "implemented_features": {},
            },
            None,
        )
        errors: list[str] = []
        warnings: list[str] = []

        _validate_single_codebase_blueprint(
            "/path/to/blueprints/codebases/flutter/codebase.blueprint.md",
            "flutter/codebase.blueprint.md",
            "codebase.blueprint.md",
            "/path/to",
            {"flutter_core": {"file": "flutter_core.blueprint.md"}},
            {},
            errors,
            warnings,
        )

        self.assertTrue(
            any("'codebase_path' must be a string" in e for e in errors), errors
        )

    @patch("sys.stderr", new_callable=io.StringIO)
    @patch("subprocess.run")
    def test_run_cmd_file_not_found(
        self, mock_run: MagicMock, mock_stderr: MagicMock
    ) -> None:
        """Verifies that run_cmd handles FileNotFoundError safely and prints to stderr."""
        mock_run.side_effect = FileNotFoundError(
            "[Errno 2] No such file or directory: 'git'"
        )

        result = run_cmd(["git", "status"])

        self.assertIsNone(result)
        self.assertIn(
            "Error running command ['git', 'status']: executable not found",
            mock_stderr.getvalue(),
        )

    @patch("sys.stdout", new_callable=io.StringIO)
    @patch("glob.glob")
    @patch("check_compliance.parse_frontmatter")
    @patch("os.path.exists")
    @patch("subprocess.run")
    def test_compliance_with_none_commits(
        self,
        mock_run: MagicMock,
        mock_exists: MagicMock,
        mock_parse: MagicMock,
        mock_glob: MagicMock,
        mock_stdout: MagicMock,
    ) -> None:
        """Verifies that the script handles None commits without throwing TypeError."""
        mock_glob.return_value = [
            "/path/to/blueprints/codebases/flutter/codebase.blueprint.md"
        ]
        mock_parse.return_value = (
            {
                "codebase_path": "renderers/flutter",
                "associated_module": "flutter_core",
                "module_blueprint_commit": None,
            },
            None,
        )
        mock_exists.return_value = True

        mock_latest = MagicMock()
        mock_latest.returncode = 1
        mock_latest.stdout = ""

        mock_log = MagicMock()
        mock_log.returncode = 1
        mock_log.stdout = ""

        mock_run.side_effect = [mock_latest, mock_log]

        main()

        output = mock_stdout.getvalue()
        self.assertIn("🔴 Not Baselined", output)
        self.assertIn(
            "| `renderers/flutter` | `flutter_core` | 🔴 Not Baselined | All | `None` |"
            " `unknown` |",
            output,
        )

    def test_parse_yaml_feature_commit_map_and_nulls(self) -> None:
        """Verifies that parse_yaml parses per-feature commit maps and null literals."""
        yaml_str = """
codebase_path: typescript/core/web_core
associated_module: a2ui_core
module_blueprint_commit: null
implemented_features:
  node_resolution: b161f9bdc9395732b305b0adddfd182a36382f09
  universal_custom_elements: ~
"""
        parsed = parse_yaml(yaml_str)
        self.assertIsNone(parsed["module_blueprint_commit"])
        self.assertEqual(
            parsed["implemented_features"],
            {
                "node_resolution": "b161f9bdc9395732b305b0adddfd182a36382f09",
                "universal_custom_elements": None,
            },
        )

    @patch("os.path.exists")
    @patch("subprocess.run")
    def test_audit_feature_commits_statuses(
        self, mock_run: MagicMock, mock_exists: MagicMock
    ) -> None:
        """Verifies UP-TO-DATE, OUT-OF-SYNC, UNTRACKED, and UNKNOWN COMMIT feature statuses."""
        mock_exists.return_value = True

        # 1. node_resolution: UP-TO-DATE (latest == pinned)
        res_up_to_date = MagicMock(returncode=0, stdout="aaaa1111\n")
        # 2. skill_generator: OUT-OF-SYNC (latest != pinned, is_ancestor=0, 1 commit behind)
        res_out_latest = MagicMock(returncode=0, stdout="bbbb2222\n")
        res_out_anc = MagicMock(returncode=0, stdout="")
        res_out_log = MagicMock(returncode=0, stdout="bbbb2222 feat: update skill\n")
        # 3. typesafe_builder_api: UNTRACKED (null commit)
        res_untracked_latest = MagicMock(returncode=0, stdout="cccc3333\n")
        res_untracked_log = MagicMock(returncode=0, stdout="cccc3333 init\n")
        # 4. universal_custom_elements: UNKNOWN COMMIT (is_ancestor fails)
        res_unknown_latest = MagicMock(returncode=0, stdout="dddd4444\n")
        res_unknown_anc = MagicMock(returncode=1, stdout="")

        mock_run.side_effect = [
            res_up_to_date,
            res_out_latest,
            res_out_anc,
            res_out_log,
            res_untracked_latest,
            res_untracked_log,
            res_unknown_latest,
            res_unknown_anc,
        ]

        results = audit_feature_commits(
            {
                "node_resolution": "aaaa1111",
                "skill_generator": "00001111",
                "typesafe_builder_api": None,
                "universal_custom_elements": "deadbeef",
            },
            "/repo/blueprints",
            "/repo",
        )

        by_feat = {r["feature"]: r for r in results}
        self.assertEqual(by_feat["node_resolution"]["status"], "UP-TO-DATE")
        self.assertEqual(
            by_feat["skill_generator"]["status"], "OUT-OF-SYNC (1 commits behind)"
        )
        self.assertEqual(
            by_feat["typesafe_builder_api"]["status"], "UNTRACKED (null commit)"
        )
        self.assertEqual(
            by_feat["universal_custom_elements"]["status"], "UNKNOWN COMMIT"
        )


if __name__ == "__main__":
    unittest.main()
