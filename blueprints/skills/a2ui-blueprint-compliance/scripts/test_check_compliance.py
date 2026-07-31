# Copyright 2026 Google LLC
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
associated module blueprints.
"""

import datetime
import io
import os
import sys
import unittest
from unittest.mock import patch, MagicMock

# Ensure the directory containing check_compliance.py is in the Python search path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from check_compliance import main, run_cmd


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
        """Verifies that a codebase that matches the latest module blueprint version is marked Up to Date."""
        # 1. Mock codebase blueprint file discovery
        mock_glob.return_value = [
            "/path/to/blueprints/codebases/flutter/codebase.blueprint.md"
        ]

        # 2. Mock frontmatter parsed metadata
        mock_parse.return_value = (
            {
                "codebase_path": "renderers/flutter",
                "associated_module": "flutter_core",
                "module_blueprint_commit": "abcdef1234567890",
            },
            None,
        )

        # 3. Mock existence of module blueprint file
        mock_exists.return_value = True

        # 4. Mock git command executions: get_latest_commit returns the same hash
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
        """Verifies that a codebase behind by a few commits is marked Out of Date and lists the commits."""
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

        # Mock git commands:
        # First call: git log -n 1 --pretty=format:%H (get_latest_commit) -> "abcdef12"
        # Second call: git merge-base --is-ancestor (check if commit exists) -> returncode 0
        # Third call: git log since_commit..HEAD (get_commits_since) -> list of 2 commits
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
        """Verifies that a codebase missing the commit pin in its blueprint is marked Not Baselined."""
        mock_glob.return_value = [
            "/path/to/blueprints/codebases/flutter/codebase.blueprint.md"
        ]
        mock_parse.return_value = (
            {
                "codebase_path": "renderers/flutter",
                "associated_module": "flutter_core",
                "module_blueprint_commit": None,  # Missing pin
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
        mock_exists.return_value = False  # File missing

        main()

        output = mock_stdout.getvalue()
        self.assertIn("🔴 Error", output)
        self.assertIn(
            "| `renderers/flutter` | `flutter_core` | 🔴 Error | 0 | `12345678` |"
            " `unknown` |",
            output,
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
        """Verifies that the script handles None or non-string commits without throwing TypeError."""
        mock_glob.return_value = [
            "/path/to/blueprints/codebases/flutter/codebase.blueprint.md"
        ]
        # module_blueprint_commit is explicitly None (not the string "None")
        mock_parse.return_value = (
            {
                "codebase_path": "renderers/flutter",
                "associated_module": "flutter_core",
                "module_blueprint_commit": None,
            },
            None,
        )
        mock_exists.return_value = True

        # mock git commands: get_latest_commit fails (returncode = 1), so run_cmd returns None
        mock_latest = MagicMock()
        mock_latest.returncode = 1
        mock_latest.stdout = ""

        # mock git log (which shouldn't run or fail)
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


if __name__ == "__main__":
    unittest.main()
