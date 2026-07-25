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

import unittest
from unittest.mock import patch, mock_open, MagicMock
import sys
import os
import json
import subprocess


import fetch_issues


class TestFetchIssues(unittest.TestCase):

    def test_run_cmd_success(self):
        # Test run_cmd returns trimmed stdout on success
        with patch("subprocess.run") as mock_run:
            mock_res = MagicMock()
            mock_res.stdout = "  hello world  \n"
            mock_run.return_value = mock_res
            res = fetch_issues.run_cmd(["echo", "hello"])
            self.assertEqual(res, "hello world")

    def test_run_cmd_failure(self):
        # Test run_cmd returns None and prints error on failure
        with patch("subprocess.run") as mock_run:
            mock_run.side_effect = subprocess.CalledProcessError(
                returncode=1, cmd=["false"], stderr="Execution failed"
            )
            res = fetch_issues.run_cmd(["false"])
            self.assertIsNone(res)

    @patch("os.makedirs")
    @patch("shutil.which")
    @patch("argparse.ArgumentParser.parse_args")
    @patch("fetch_issues.run_cmd")
    def test_main_fetch_flow(
        self, mock_run, mock_parse_args, mock_which, mock_makedirs
    ):
        # Mock CLI dependencies
        mock_which.return_value = "/usr/local/bin/gh"

        # Mock arguments
        mock_args = MagicMock()
        mock_args.repo = "a2ui-project/a2ui"
        mock_args.output_file = "/mock/raw_issues.json"
        mock_args.limit = 2
        mock_parse_args.return_value = mock_args

        # Set up precise mock command outputs based on command arguments
        def run_cmd_side_effect(args):
            if len(args) >= 3 and args[1] == "api" and "assignees" in args[2]:
                # varun login will trigger substring match against varun-s10 email prefix
                return "gspencer\nVarun-S10\nvarun"
            elif args[0] == "git" and args[1] == "log":
                return (
                    "George Spencer <gspencer@example.com>\nVarun S"
                    " <varun-s10@example.com>"
                )
            elif len(args) >= 3 and args[1] == "label" and args[2] == "list":
                return json.dumps([{"name": "type: bug"}, {"name": "component: core"}])
            elif len(args) >= 3 and args[1] == "issue" and args[2] == "list":
                # Return 2 issues: one untriaged, one already triaged with P1 (should be skipped!)
                return json.dumps([
                    {
                        "number": 123,
                        "title": "Crash in lit",
                        "author": {"login": "alex"},
                        "body": "Lit crashed.",
                        "createdAt": "2026-06-25T00:00:00Z",
                        "updatedAt": "2026-06-25T01:00:00Z",
                        "labels": [{"name": "type: bug"}],
                        "assignees": [],
                    },
                    {
                        "number": 124,
                        "title": "Already triaged crash",
                        "author": {"login": "alex"},
                        "body": "This has a priority label.",
                        "createdAt": "2026-06-25T00:00:00Z",
                        "updatedAt": "2026-06-25T01:00:00Z",
                        "labels": [{"name": "P1"}],  # Priority P1, should be skipped!
                        "assignees": [],
                    },
                ])
            elif (
                len(args) >= 3
                and args[1] == "issue"
                and args[2] == "view"
                and "comments" in args[-1]
            ):
                return json.dumps({
                    "comments": [
                        {"author": {"login": "Varun-S10"}, "body": "Looking into this."}
                    ]
                })
            return ""

        mock_run.side_effect = run_cmd_side_effect

        # Mock open
        m_open = mock_open()
        with patch("fetch_issues.open", m_open):
            fetch_issues.main()

        m_open.assert_any_call("/mock/raw_issues.json", "w", encoding="utf-8")

        handle = m_open()
        written_data = "".join([call[0][0] for call in handle.write.call_args_list])
        parsed_output = json.loads(written_data)

        # Verify output structure
        self.assertEqual(parsed_output["repo"], "a2ui-project/a2ui")
        self.assertIn("type: bug", parsed_output["labels"])
        # Verify that only the untriaged issue 123 is included, and issue 124 is skipped!
        self.assertEqual(len(parsed_output["issues"]), 1)

        issue = parsed_output["issues"][0]
        self.assertEqual(issue["id"], 123)
        self.assertEqual(issue["title"], "Crash in lit")

        # Verify assignee resolution (including the substring matched "varun" to "Varun S")
        assignees = parsed_output["assignees"]
        self.assertEqual(len(assignees), 3)
        self.assertEqual(assignees[0]["login"], "gspencer")
        self.assertEqual(assignees[0]["name"], "George Spencer")
        self.assertEqual(assignees[1]["login"], "Varun-S10")
        self.assertEqual(assignees[1]["name"], "Varun S")
        self.assertEqual(assignees[2]["login"], "varun")
        self.assertEqual(assignees[2]["name"], "Varun S")

    @patch("shutil.which")
    @patch("argparse.ArgumentParser.parse_args")
    def test_main_gh_cli_missing(self, mock_parse_args, mock_which):
        # Mock CLI missing
        mock_which.return_value = None

        mock_args = MagicMock()
        mock_args.repo = "a2ui-project/a2ui"
        mock_args.output_file = "/mock/raw_issues.json"
        mock_parse_args.return_value = mock_args

        # Should exit with error code 1
        with self.assertRaises(SystemExit) as cm:
            fetch_issues.main()
        self.assertEqual(cm.exception.code, 1)

    @patch("os.makedirs")
    @patch("shutil.which")
    @patch("argparse.ArgumentParser.parse_args")
    @patch("fetch_issues.run_cmd")
    def test_main_no_issues_exit(
        self, mock_run, mock_parse_args, mock_which, mock_makedirs
    ):
        mock_which.return_value = "/usr/local/bin/gh"

        mock_args = MagicMock()
        mock_args.repo = "a2ui-project/a2ui"
        mock_args.output_file = "/mock/raw_issues.json"
        mock_args.limit = 2
        mock_parse_args.return_value = mock_args

        # Mock issue list to return empty string ""
        def run_cmd_side_effect(args):
            if "issue" in args and "list" in args:
                return ""
            return "[]"

        mock_run.side_effect = run_cmd_side_effect

        # Should exit with error code 1 because issues JSON is empty
        with self.assertRaises(SystemExit) as cm:
            fetch_issues.main()
        self.assertEqual(cm.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
