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

"""Unit tests for extract_recommendation.py."""

import os
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from extract_recommendation import (
    extract_recommendation,
    parse_recommendations,
    main,
)


SAMPLE_REPORT = """# Weekly Compliance Audit Report (2026-08-25)

## Summary
Audit summary text here.

## Recommendations

1. **P0**: **Pin Module Blueprint Commits**
   - Detailed explanation for item 1.
   ````markdown
   Please remediate recommendation 1 from issue #2391.
   ````

2. **P1**: **Fix Broken Relative Documentation Links**
   - Detailed explanation for item 2.
   ````markdown
   Please remediate recommendation 2 from issue #2391.
   ````

3. **P2**: **Remediate Swift Core Blueprint Configuration**
   - Detailed explanation for item 3.

---

## Codebase Blueprint Compliance Audit
Audit table here.
"""


class TestExtractRecommendation(unittest.TestCase):

    def test_parse_recommendations(self) -> None:
        recs = parse_recommendations(SAMPLE_REPORT)
        self.assertEqual(len(recs), 3)
        self.assertIn(1, recs)
        self.assertIn(2, recs)
        self.assertIn(3, recs)

        self.assertEqual(recs[1]["priority"], "P0")
        self.assertIn("Pin Module Blueprint Commits", recs[1]["raw_text"])

        self.assertEqual(recs[2]["priority"], "P1")
        self.assertIn("Fix Broken Relative Documentation Links", recs[2]["raw_text"])

        self.assertEqual(recs[3]["priority"], "P2")
        self.assertIn(
            "Remediate Swift Core Blueprint Configuration", recs[3]["raw_text"]
        )

    def test_extract_recommendation_from_file(self) -> None:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as f:
            f.write(SAMPLE_REPORT)
            temp_path = f.name

        try:
            item = extract_recommendation(temp_path, 2)
            self.assertEqual(item["index"], 2)
            self.assertEqual(item["priority"], "P1")
            self.assertIn("Fix Broken Relative Documentation Links", item["content"])
        finally:
            os.remove(temp_path)

    def test_extract_recommendation_invalid_index(self) -> None:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as f:
            f.write(SAMPLE_REPORT)
            temp_path = f.name

        try:
            with self.assertRaisesRegex(ValueError, "Recommendation #99 not found"):
                extract_recommendation(temp_path, 99)
        finally:
            os.remove(temp_path)

    def test_extract_without_index_lists_all(self) -> None:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as f:
            f.write(SAMPLE_REPORT)
            temp_path = f.name

        try:
            res = extract_recommendation(temp_path)
            self.assertEqual(res["type"], "compliance_report")
            self.assertEqual(len(res["recommendations"]), 3)
            self.assertEqual(res["recommendations"][0]["index"], 1)
        finally:
            os.remove(temp_path)

    def test_extract_from_general_issue(self) -> None:
        general_issue_text = "Bug report: The parser fails on nested JSON arrays."
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as f:
            f.write(general_issue_text)
            temp_path = f.name

        try:
            res = extract_recommendation(temp_path)
            self.assertEqual(res["type"], "general_issue")
            self.assertEqual(res["content"], general_issue_text)
        finally:
            os.remove(temp_path)

    @patch("subprocess.run")
    def test_extract_recommendation_via_gh_cli(self, mock_run: MagicMock) -> None:
        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_res.stdout = SAMPLE_REPORT
        mock_run.return_value = mock_res

        item = extract_recommendation("2391", 1, repo="a2ui-project/a2ui")
        self.assertEqual(item["type"], "compliance_recommendation")
        self.assertEqual(item["index"], 1)
        self.assertEqual(item["priority"], "P0")
        self.assertIn("Pin Module Blueprint Commits", item["content"])

        mock_run.assert_called_once()
        args, kwargs = mock_run.call_args
        self.assertEqual(
            args[0],
            [
                "gh",
                "issue",
                "view",
                "2391",
                "--json",
                "body",
                "--jq",
                ".body",
                "--repo",
                "a2ui-project/a2ui",
            ],
        )

    @patch("subprocess.run")
    def test_fetch_issue_body_missing_gh_cli(self, mock_run: MagicMock) -> None:
        mock_run.side_effect = FileNotFoundError("No such file or directory: 'gh'")
        with self.assertRaisesRegex(
            RuntimeError, "The GitHub CLI 'gh' is not installed"
        ):
            extract_recommendation("2391", 1, repo="a2ui-project/a2ui")

    def test_parse_recommendations_with_nested_code_blocks(self) -> None:
        report_with_nested_fences = """# Report
## Recommendations

1. **P0**: **Recommendation with nested fences**
   Details:
   ````markdown
   Here is some inner markdown:
   ---
   2. This is NOT recommendation 2!
   ## Not a header
   ````
   Continued details for recommendation 1.

2. **P1**: **Real Recommendation 2**
   Details for recommendation 2.
"""
        recs = parse_recommendations(report_with_nested_fences)
        self.assertEqual(len(recs), 2)
        self.assertIn(1, recs)
        self.assertIn(2, recs)
        self.assertIn("Continued details for recommendation 1", recs[1]["raw_text"])
        self.assertIn("Details for recommendation 2", recs[2]["raw_text"])


if __name__ == "__main__":
    unittest.main()
