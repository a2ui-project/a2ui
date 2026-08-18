# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Unit tests for .github/scripts/parse_remediation_command.py."""

import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

script_path = REPO_ROOT / ".github" / "scripts" / "parse_remediation_command.py"
spec = importlib.util.spec_from_file_location("parse_remediation_command", script_path)
assert spec is not None
assert spec.loader is not None
parse_remediation_command = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parse_remediation_command)
parse_recommendation_index = parse_remediation_command.parse_recommendation_index
main = parse_remediation_command.main


class TestParseRemediationCommand(unittest.TestCase):

    def test_empty_or_none_comment(self) -> None:
        self.assertIsNone(parse_recommendation_index(""))
        self.assertIsNone(parse_recommendation_index("   \n\n  "))

    def test_simple_unquoted_fix_command(self) -> None:
        self.assertEqual(parse_recommendation_index("/fix 1"), "1")
        self.assertEqual(parse_recommendation_index("/fix 42"), "42")
        self.assertEqual(
            parse_recommendation_index("Please run /fix 100 on this"), "100"
        )

    def test_ignores_single_line_quote(self) -> None:
        self.assertIsNone(parse_recommendation_index("> /fix 1"))
        self.assertIsNone(parse_recommendation_index(" > /fix 2"))
        self.assertIsNone(parse_recommendation_index("   > /fix 3"))
        self.assertIsNone(parse_recommendation_index(">> /fix 4"))

    def test_ignores_multiline_quote(self) -> None:
        comment = "\n".join([
            "> User wrote:",
            "> /fix 1",
            "> /fix 2",
        ])
        self.assertIsNone(parse_recommendation_index(comment))

    def test_ignores_lazy_quote_paragraph(self) -> None:
        comment = "\n".join([
            "> Quote header",
            "continuation line with /fix 1",
        ])
        self.assertIsNone(parse_recommendation_index(comment))

    def test_extracts_fix_outside_quote(self) -> None:
        comment = "\n".join([
            "> User wrote:",
            "> /fix 1",
            "",
            "I disagree with 1, let's execute /fix 2 instead.",
        ])
        self.assertEqual(parse_recommendation_index(comment), "2")

    def test_extracts_fix_before_quote(self) -> None:
        comment = "\n".join([
            "/fix 5",
            "",
            "> Earlier discussion:",
            "> /fix 99",
        ])
        self.assertEqual(parse_recommendation_index(comment), "5")

    def test_no_fix_command(self) -> None:
        self.assertIsNone(parse_recommendation_index("Looks great, thanks!"))
        self.assertIsNone(parse_recommendation_index("/fix notanumber"))
        self.assertIsNone(parse_recommendation_index("http://example.com/fix 123"))
        self.assertIsNone(parse_recommendation_index("some/path/fix 123"))
        self.assertIsNone(parse_recommendation_index("```\n/fix 123\n```"))
        self.assertIsNone(parse_recommendation_index("~~~\n/fix 123\n~~~"))

    def test_code_block_with_unquoted_command_after(self) -> None:
        comment = "\n".join([
            "```",
            "Example usage:",
            "/fix 1",
            "```",
            "",
            "Please apply /fix 2",
        ])
        self.assertEqual(parse_recommendation_index(comment), "2")

    def test_main_with_valid_command(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            env_file = os.path.join(tmpdir, "github_env")
            output_file = os.path.join(tmpdir, "github_output")
            open(env_file, "w").close()
            open(output_file, "w").close()

            comment = "> /fix 1\n\n/fix 7"
            with patch.dict(
                os.environ,
                {
                    "COMMENT_BODY": comment,
                    "GITHUB_ENV": env_file,
                    "GITHUB_OUTPUT": output_file,
                },
                clear=True,
            ):
                main()

            with open(env_file, "r", encoding="utf-8") as f:
                env_content = f.read()
            with open(output_file, "r", encoding="utf-8") as f:
                output_content = f.read()

            self.assertIn("RECOMMENDATION_INDEX=7\n", env_content)
            self.assertIn("triggered=true\n", output_content)
            self.assertIn("recommendation_index=7\n", output_content)

    def test_main_with_only_quoted_command(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            env_file = os.path.join(tmpdir, "github_env")
            output_file = os.path.join(tmpdir, "github_output")
            open(env_file, "w").close()
            open(output_file, "w").close()

            comment = "> /fix 1\n> quoted text"
            with patch.dict(
                os.environ,
                {
                    "COMMENT_BODY": comment,
                    "GITHUB_ENV": env_file,
                    "GITHUB_OUTPUT": output_file,
                },
                clear=True,
            ):
                main()

            with open(env_file, "r", encoding="utf-8") as f:
                env_content = f.read()
            with open(output_file, "r", encoding="utf-8") as f:
                output_content = f.read()

            self.assertEqual(env_content, "")
            self.assertIn("triggered=false\n", output_content)


if __name__ == "__main__":
    unittest.main()
