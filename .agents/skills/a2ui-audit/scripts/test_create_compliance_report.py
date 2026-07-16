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

"""Tests for the create_compliance_report script.

This module verifies that the script parses command-line arguments correctly,
validates input file paths, handles GitHub CLI subprocess errors, and executes
with the expected options.
"""

import datetime
import io
import os
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

# Ensure the directory containing create_compliance_report.py is in the Python search path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from create_compliance_report import main


class TestCreateComplianceReport(unittest.TestCase):
    """Unit tests for the create_compliance_report script."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.report_file = os.path.join(self.temp_dir.name, "report.md")
        with open(self.report_file, "w") as f:
            f.write("Test Report Content")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    @patch("sys.stderr", new_callable=io.StringIO)
    def test_missing_argument(self, mock_stderr: MagicMock) -> None:
        """Verifies that the script exits if the report path argument is missing."""
        with patch.object(sys, "argv", ["create_compliance_report.py"]):
            with self.assertRaises(SystemExit) as cm:
                main()
            self.assertEqual(cm.exception.code, 2)
        self.assertIn(
            "the following arguments are required: report_path",
            mock_stderr.getvalue(),
        )

    @patch("sys.stdout", new_callable=io.StringIO)
    def test_report_file_not_found(self, mock_stdout: MagicMock) -> None:
        """Verifies that the script exits with code 1 if the report file does not exist."""
        with patch.object(
            sys, "argv", ["create_compliance_report.py", "nonexistent_file.md"]
        ):
            with self.assertRaises(SystemExit) as cm:
                main()
            self.assertEqual(cm.exception.code, 1)
        self.assertIn("Error: Report file not found", mock_stdout.getvalue())

    @patch("sys.stdout", new_callable=io.StringIO)
    @patch("subprocess.run")
    def test_successful_run(self, mock_run: MagicMock, mock_stdout: MagicMock) -> None:
        """Verifies a successful run without --repo option."""
        today = datetime.date.today().isoformat()
        expected_title = f"Weekly A2UI Compliance Report ({today})"

        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_res.stdout = "https://github.com/a2ui-project/a2ui/issues/123\n"
        mock_res.stderr = ""
        mock_run.return_value = mock_res

        with patch.object(
            sys, "argv", ["create_compliance_report.py", self.report_file]
        ):
            main()

        # Verify subprocess call
        mock_run.assert_called_once()
        args, kwargs = mock_run.call_args
        cmd = args[0]
        self.assertEqual(
            cmd,
            [
                "gh",
                "issue",
                "create",
                "--title",
                expected_title,
                "--body-file",
                self.report_file,
                "--label",
                "status: needs review",
                "--label",
                "component: specification",
            ],
        )

        output = mock_stdout.getvalue()
        self.assertIn("Success: Compliance report issue posted successfully.", output)
        self.assertIn("https://github.com/a2ui-project/a2ui/issues/123", output)

    @patch("subprocess.run")
    def test_successful_run_with_repo(self, mock_run: MagicMock) -> None:
        """Verifies a successful run with --repo option."""
        today = datetime.date.today().isoformat()
        expected_title = f"Weekly A2UI Compliance Report ({today})"

        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_res.stdout = "https://github.com/a2ui-project/a2ui/issues/123\n"
        mock_res.stderr = ""
        mock_run.return_value = mock_res

        with patch.object(
            sys,
            "argv",
            [
                "create_compliance_report.py",
                self.report_file,
                "--repo",
                "a2ui-project/a2ui",
            ],
        ):
            main()

        # Verify subprocess call includes --repo
        mock_run.assert_called_once()
        args, kwargs = mock_run.call_args
        cmd = args[0]
        self.assertEqual(
            cmd,
            [
                "gh",
                "issue",
                "create",
                "--title",
                expected_title,
                "--body-file",
                self.report_file,
                "--label",
                "status: needs review",
                "--label",
                "component: specification",
                "--repo",
                "a2ui-project/a2ui",
            ],
        )

    @patch("sys.stdout", new_callable=io.StringIO)
    @patch("subprocess.run")
    def test_failed_run(self, mock_run: MagicMock, mock_stdout: MagicMock) -> None:
        """Verifies that the script exits with code 1 if the gh command fails."""
        mock_res = MagicMock()
        mock_res.returncode = 1
        mock_res.stdout = ""
        mock_res.stderr = "some github cli error"
        mock_run.return_value = mock_res

        with patch.object(
            sys, "argv", ["create_compliance_report.py", self.report_file]
        ):
            with self.assertRaises(SystemExit) as cm:
                main()
            self.assertEqual(cm.exception.code, 1)

        output = mock_stdout.getvalue()
        self.assertIn("Error: Failed to create GitHub issue via gh CLI.", output)
        self.assertIn("some github cli error", output)

    @patch("sys.stdout", new_callable=io.StringIO)
    @patch("subprocess.run")
    def test_gh_cli_not_found(
        self, mock_run: MagicMock, mock_stdout: MagicMock
    ) -> None:
        """Verifies that the script prints an error and exits if gh is not installed."""
        mock_run.side_effect = FileNotFoundError

        with patch.object(
            sys, "argv", ["create_compliance_report.py", self.report_file]
        ):
            with self.assertRaises(SystemExit) as cm:
                main()
            self.assertEqual(cm.exception.code, 1)

        output = mock_stdout.getvalue()
        self.assertIn("Error: 'gh' CLI tool not found", output)
