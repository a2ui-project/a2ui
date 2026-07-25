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


import suggest_triage


class TestSuggestTriage(unittest.TestCase):

    def test_guess_triage_heuristics_documentation(self):
        # Typo should trigger close_resolved
        res = suggest_triage.guess_triage_heuristics(
            "Fix typo in README", "The README has a typo."
        )
        self.assertEqual(res["priority"], "P3")
        self.assertEqual(res["action"], "close_resolved")
        self.assertIn("type: documentation", res["labels"])
        # guess_triage_heuristics returns raw reply; prefix is added in main()
        self.assertTrue(res["reply"].startswith("Thanks"))

        # Doc improvement (without typo) should trigger investigate
        res2 = suggest_triage.guess_triage_heuristics(
            "Improve documentation in README", "The README needs more details."
        )
        self.assertEqual(res2["action"], "investigate")

    def test_guess_triage_heuristics_crash(self):
        # Crash is a bug. Since no repro steps are in description, it triggers needs_info
        res = suggest_triage.guess_triage_heuristics(
            "Fatal crash on startup", "The app crashes immediately with SIGSEGV."
        )
        self.assertEqual(res["priority"], "P2")
        self.assertEqual(res["action"], "needs_info")
        self.assertIn("type: bug", res["labels"])
        self.assertIn("waiting-for-user-response", res["labels"])

    def test_guess_triage_heuristics_needs_info(self):
        # Feature request
        res = suggest_triage.guess_triage_heuristics(
            "Feature request", "Can you add a new button?"
        )
        self.assertEqual(res["action"], "investigate")
        self.assertIn("type: feature/enhancement", res["labels"])

    def test_guess_triage_heuristics_all_components(self):
        # Test all component keyword mappings
        components = [
            ("angular issue", "component: angular renderer"),
            ("react project", "component: react renderer"),
            ("samples demo", "component: samples"),
            ("specification details", "component: specification"),
            ("agent sdk library", "component: agent library"),
        ]
        for text, expected_label in components:
            res = suggest_triage.guess_triage_heuristics(text, "")
            self.assertIn(expected_label, res["labels"])

    @patch("os.path.exists")
    def test_get_suggested_assignees_exact_match(self, mock_exists):
        mock_exists.return_value = True
        # Mock subprocess.run
        with patch("suggest_triage.subprocess.run") as mock_run:
            mock_res = MagicMock()
            mock_res.returncode = 0
            mock_res.stdout = "Varun S <varun-s10@example.com>"
            mock_run.return_value = mock_res

            # Valid assignees must be list of dicts. Email prefix is varun-s10, so let's match with Varun-S10
            assignees = suggest_triage.get_suggested_assignees(
                ["component: lit renderer"],
                "/mock/repo",
                [{"login": "Varun-S10"}, {"login": "gspencer"}],
            )
            self.assertEqual(assignees, ["Varun-S10"])

    @patch("os.path.exists")
    def test_get_suggested_assignees_prefix_match_min_length(self, mock_exists):
        mock_exists.return_value = True
        # Mock subprocess.run
        with patch("suggest_triage.subprocess.run") as mock_run:
            mock_res = MagicMock()
            mock_res.returncode = 0
            mock_res.stdout = "George Spencer <gspencergoog@example.com>"
            mock_run.return_value = mock_res

            assignees = suggest_triage.get_suggested_assignees(
                ["component: agent library"],
                "/mock/repo",
                [{"login": "gspencer"}, {"login": "alex"}],
            )
            self.assertEqual(assignees, ["gspencer"])

            # "al" is < 3 chars, so should NOT match "alex"
            mock_res.stdout = "Al <al@example.com>"
            assignees2 = suggest_triage.get_suggested_assignees(
                ["component: agent library"], "/mock/repo", [{"login": "alex"}]
            )
            self.assertEqual(assignees2, [])

    def test_get_suggested_assignees_empty_valid_assignees(self):
        # Empty valid assignees list should return [] immediately
        assignees = suggest_triage.get_suggested_assignees(
            ["component: lit renderer"], "/mock/repo", []
        )
        self.assertEqual(assignees, [])

    @patch("os.path.exists")
    def test_get_suggested_assignees_missing_directory(self, mock_exists):
        # If target directory doesn't exist, it should skip it and return []
        mock_exists.return_value = False
        assignees = suggest_triage.get_suggested_assignees(
            ["component: lit renderer"], "/mock/repo", [{"login": "gspencer"}]
        )
        self.assertEqual(assignees, [])

    @patch("os.path.exists")
    def test_get_suggested_assignees_git_log_exception(self, mock_exists):
        # If subprocess.run throws exception, it should handle it and return []
        mock_exists.return_value = True
        with patch("suggest_triage.subprocess.run") as mock_run:
            mock_run.side_effect = Exception("Git error")
            assignees = suggest_triage.get_suggested_assignees(
                ["component: lit renderer"], "/mock/repo", [{"login": "gspencer"}]
            )
            self.assertEqual(assignees, [])

    @patch("os.makedirs")
    @patch("argparse.ArgumentParser.parse_args")
    @patch("suggest_triage.subprocess.run")
    @patch("os.path.exists")
    def test_main_flow(self, mock_exists, mock_run, mock_parse_args, mock_makedirs):
        # Mock arguments
        mock_args = MagicMock()
        mock_args.repo_dir = "/mock/repo"
        mock_args.issues_file = "/mock/issues.json"
        mock_args.output_file = "/mock/output.json"
        mock_args.limit = 1
        mock_parse_args.return_value = mock_args

        mock_exists.return_value = True

        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_res.stdout = "gspencer <gspencer@example.com>"
        mock_run.return_value = mock_res

        # Using title/body with "react renderer" to map to component and suggested owners
        mock_issues_data = {
            "repo": "a2ui-project/a2ui",
            "assignees": [{"login": "gspencer"}, {"login": "Varun-S10"}],
            "labels": [],
            "issues": [{
                "id": 123,
                "title": "Crash in react renderer",
                "body": "It crashed.",
                "createdAt": "2026-06-25T00:00:00Z",
                "assignees": [],
            }],
            "total_issues_count": 1,
        }

        # Mock reading issues_file and writing output_file
        m_open = mock_open(read_data=json.dumps(mock_issues_data))
        with patch("suggest_triage.open", m_open):
            suggest_triage.main()

        m_open.assert_any_call("/mock/output.json", "w", encoding="utf-8")

        handle = m_open()
        written_data = "".join([call[0][0] for call in handle.write.call_args_list])
        parsed_output = json.loads(written_data)

        # Verify output structure and draft comment prefix
        self.assertEqual(parsed_output["total_issues_count"], 1)
        issue_suggestions = parsed_output["issues"][0]["suggestions"]
        self.assertEqual(issue_suggestions["priority"], "P2")
        self.assertTrue(issue_suggestions["reply"].startswith("A2UI Triage: "))
        self.assertEqual(
            issue_suggestions["assignee_reason"],
            "Suggesting gspencer because they recently modified related code.",
        )

    @patch("os.makedirs")
    @patch("argparse.ArgumentParser.parse_args")
    @patch("suggest_triage.subprocess.run")
    @patch("os.path.exists")
    def test_main_flow_existing_assignee(
        self, mock_exists, mock_run, mock_parse_args, mock_makedirs
    ):
        # Mock arguments
        mock_args = MagicMock()
        mock_args.repo_dir = "/mock/repo"
        mock_args.issues_file = "/mock/issues.json"
        mock_args.output_file = "/mock/output.json"
        mock_args.limit = 1
        mock_parse_args.return_value = mock_args

        mock_exists.return_value = True

        mock_issues_data = {
            "repo": "a2ui-project/a2ui",
            "assignees": [{"login": "gspencer"}],
            "labels": [],
            "issues": [{
                "id": 124,
                "title": "Trivial issue",
                "body": "Body",
                "createdAt": "2026-06-25",
                # Pre-existing assignee Varun-S10
                "assignees": ["Varun-S10"],
            }],
            "total_issues_count": 1,
        }

        m_open = mock_open(read_data=json.dumps(mock_issues_data))
        with patch("suggest_triage.open", m_open):
            suggest_triage.main()

        handle = m_open()
        written_data = "".join([call[0][0] for call in handle.write.call_args_list])
        parsed_output = json.loads(written_data)

        # Verify that existing assignee is preserved
        suggestions = parsed_output["issues"][0]["suggestions"]
        self.assertEqual(suggestions["assignee"], "Varun-S10")
        self.assertEqual(
            suggestions["assignee_reason"], "Preserving existing assignee: Varun-S10."
        )


if __name__ == "__main__":
    unittest.main()
