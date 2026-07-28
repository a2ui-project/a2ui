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
from unittest.mock import patch, mock_open, MagicMock, call
import sys
import os
import json
import subprocess


import apply_triage


class TestApplyTriage(unittest.TestCase):

    @patch("argparse.ArgumentParser.parse_args")
    @patch("apply_triage.run_cmd")
    @patch("os.path.exists")
    def test_apply_triage_flow(self, mock_exists, mock_run, mock_parse_args):
        # Mock arguments
        mock_args = MagicMock()
        mock_args.decisions_file = "/mock/triage_decisions.json"
        mock_parse_args.return_value = mock_args

        mock_exists.return_value = True

        mock_decisions_data = {
            "decisions": [
                {
                    "id": 101,
                    "approved": True,
                    "priority": "P0",
                    "assignee": "gspencer",
                    "action": "investigate",
                    "labels": ["component: core"],
                    "reply": "Working on it",
                },
                {
                    "id": 102,
                    "approved": True,
                    "priority": "None",
                    "assignee": "",
                    "action": "close_duplicate",
                    "labels": [],
                    "reply": "",
                },
                {"id": 103, "approved": False, "priority": "P2"},  # Not approved
            ]
        }

        # Mock command outputs
        def run_cmd_side_effect(args):
            cmd_str = " ".join(args)
            if "view 101 --json labels" in cmd_str:
                return json.dumps(
                    {"labels": [{"name": "P1"}, {"name": "component: core"}]}
                )
            elif "view 101 --json comments" in cmd_str:
                return json.dumps({"comments": []})
            elif "view 102 --json labels" in cmd_str:
                return json.dumps({"labels": [{"name": "P3"}]})
            return ""

        mock_run.side_effect = run_cmd_side_effect

        m_open = mock_open(read_data=json.dumps(mock_decisions_data))
        with patch("apply_triage.open", m_open):
            with self.assertRaises(SystemExit) as cm:
                apply_triage.main()

        self.assertEqual(cm.exception.code, 0)

        # Verify correct priority label swaps and comment posting prefix
        expected_calls = [
            call(["gh", "issue", "view", "101", "--json", "labels"]),
            call(["gh", "issue", "edit", "101", "--remove-label", "P1"]),
            call(["gh", "issue", "edit", "101", "--add-label", "P0"]),
            call(["gh", "issue", "edit", "101", "--add-assignee", "gspencer"]),
            call(["gh", "issue", "view", "101", "--json", "comments"]),
            call([
                "gh",
                "issue",
                "comment",
                "101",
                "--body",
                "A2UI Triage: Working on it",
            ]),
            call(["gh", "issue", "view", "102", "--json", "labels"]),
            call(["gh", "issue", "edit", "102", "--remove-label", "P3"]),
            call(["gh", "issue", "close", "102", "--reason", "duplicate"]),
        ]
        mock_run.assert_has_calls(expected_calls, any_order=False)

    @patch("os.path.exists")
    @patch("argparse.ArgumentParser.parse_args")
    def test_decisions_file_not_exists(self, mock_parse_args, mock_exists):
        mock_exists.return_value = False

        mock_args = MagicMock()
        mock_args.decisions_file = "/mock/non_existent.json"
        mock_parse_args.return_value = mock_args

        # Should exit with error code 1
        with self.assertRaises(SystemExit) as cm:
            apply_triage.main()
        self.assertEqual(cm.exception.code, 1)

    @patch("argparse.ArgumentParser.parse_args")
    @patch("apply_triage.run_cmd")
    @patch("os.path.exists")
    def test_labels_parse_error_fallback(self, mock_exists, mock_run, mock_parse_args):
        mock_exists.return_value = True
        mock_args = MagicMock()
        mock_args.decisions_file = "/mock/triage_decisions.json"
        mock_parse_args.return_value = mock_args

        mock_decisions_data = {
            "decisions": [{
                "id": 105,
                "approved": True,
                "priority": "P2",
                "assignee": "",
                "action": "investigate",
                "labels": [],
                "reply": "",
            }]
        }

        # Mock labels query to return invalid JSON
        def run_cmd_side_effect(args):
            cmd_str = " ".join(args)
            if "view 105 --json labels" in cmd_str:
                return "invalid-json-response"
            return ""

        mock_run.side_effect = run_cmd_side_effect

        m_open = mock_open(read_data=json.dumps(mock_decisions_data))
        with patch("apply_triage.open", m_open):
            with self.assertRaises(SystemExit) as cm:
                apply_triage.main()

        self.assertEqual(cm.exception.code, 0)
        # It should fallback to treating current labels as empty and successfully add P2
        mock_run.assert_any_call(["gh", "issue", "edit", "105", "--add-label", "P2"])

    @patch("argparse.ArgumentParser.parse_args")
    @patch("apply_triage.run_cmd")
    @patch("os.path.exists")
    def test_apply_triage_comment_already_posted(
        self, mock_exists, mock_run, mock_parse_args
    ):
        mock_exists.return_value = True
        mock_args = MagicMock()
        mock_args.decisions_file = "/mock/triage_decisions.json"
        mock_parse_args.return_value = mock_args

        mock_decisions_data = {
            "decisions": [{
                "id": 110,
                "approved": True,
                "priority": "None",
                "assignee": "",
                "action": "investigate",
                "labels": [],
                "reply": "We are on it",
            }]
        }

        # Mock comments query to return comments containing the exact branded draft reply
        def run_cmd_side_effect(args):
            cmd_str = " ".join(args)
            if "view 110 --json labels" in cmd_str:
                return json.dumps({"labels": []})
            elif "view 110 --json comments" in cmd_str:
                return json.dumps({"comments": [{"body": "A2UI Triage: We are on it"}]})
            return ""

        mock_run.side_effect = run_cmd_side_effect

        m_open = mock_open(read_data=json.dumps(mock_decisions_data))
        with patch("apply_triage.open", m_open):
            with self.assertRaises(SystemExit) as cm:
                apply_triage.main()

        self.assertEqual(cm.exception.code, 0)
        # It should find that the comment is already posted and SKIP gh issue comment!
        for call_args in mock_run.call_args_list:
            self.assertNotIn("comment", call_args[0])

    @patch("argparse.ArgumentParser.parse_args")
    @patch("apply_triage.run_cmd")
    @patch("os.path.exists")
    def test_apply_triage_actions(self, mock_exists, mock_run, mock_parse_args):
        mock_exists.return_value = True
        mock_args = MagicMock()
        mock_args.decisions_file = "/mock/triage_decisions.json"
        mock_parse_args.return_value = mock_args

        # Mock 2 close actions: close_invalid and close_resolved
        mock_decisions_data = {
            "decisions": [
                {
                    "id": 111,
                    "approved": True,
                    "priority": "None",
                    "assignee": "",
                    "action": "close_invalid",
                    "labels": [],
                    "reply": "",
                },
                {
                    "id": 112,
                    "approved": True,
                    "priority": "None",
                    "assignee": "",
                    "action": "close_resolved",
                    "labels": [],
                    "reply": "",
                },
            ]
        }

        mock_run.return_value = "{}"

        m_open = mock_open(read_data=json.dumps(mock_decisions_data))
        with patch("apply_triage.open", m_open):
            with self.assertRaises(SystemExit) as cm:
                apply_triage.main()

        self.assertEqual(cm.exception.code, 0)
        # Verify close reasons passed: close_invalid -> "not planned", close_resolved -> "completed"
        mock_run.assert_any_call(
            ["gh", "issue", "close", "111", "--reason", "not planned"]
        )
        mock_run.assert_any_call(
            ["gh", "issue", "close", "112", "--reason", "completed"]
        )

    @patch("argparse.ArgumentParser.parse_args")
    @patch("apply_triage.run_cmd")
    @patch("os.path.exists")
    def test_apply_triage_failure_accumulation(
        self, mock_exists, mock_run, mock_parse_args
    ):
        mock_exists.return_value = True
        mock_args = MagicMock()
        mock_args.decisions_file = "/mock/triage_decisions.json"
        mock_parse_args.return_value = mock_args

        # Mock 2 issues: one that fails, and one that succeeds
        mock_decisions_data = {
            "decisions": [
                {
                    "id": 201,
                    "approved": True,
                    "priority": "P0",
                    "assignee": "",
                    "action": "investigate",
                    "labels": [],
                    "reply": "",
                },
                {
                    "id": 202,
                    "approved": True,
                    "priority": "P2",
                    "assignee": "",
                    "action": "investigate",
                    "labels": [],
                    "reply": "",
                },
            ]
        }

        # Mock edit to fail for issue 201
        def run_cmd_side_effect(args):
            cmd_str = " ".join(args)
            if "201" in cmd_str and "edit" in cmd_str:
                raise subprocess.CalledProcessError(
                    returncode=1, cmd=args, stderr="API Error"
                )
            return "{}"

        mock_run.side_effect = run_cmd_side_effect

        m_open = mock_open(read_data=json.dumps(mock_decisions_data))
        with patch("apply_triage.open", m_open):
            # The script should continue to process 202 and finally exit with code 1 due to 201's failure
            with self.assertRaises(SystemExit) as cm:
                apply_triage.main()

        self.assertEqual(cm.exception.code, 1)
        # Verify that both issues were processed
        mock_run.assert_any_call(["gh", "issue", "view", "201", "--json", "labels"])
        mock_run.assert_any_call(["gh", "issue", "view", "202", "--json", "labels"])
        mock_run.assert_any_call(["gh", "issue", "edit", "202", "--add-label", "P2"])


if __name__ == "__main__":
    unittest.main()
