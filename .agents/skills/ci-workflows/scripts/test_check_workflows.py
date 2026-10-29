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

"""Unit tests for check_workflows.py."""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from check_workflows import (
    DEFAULT_WORKFLOWS_DIR,
    check_workflows,
)

VALID = """
name: Example CI

on:
  push:
    branches: [main]
    paths: ["example/**"]
  pull_request:
    paths: ["example/**"]
  schedule:
    - cron: "15 2 * * *"
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.event_name }}-${{ github.ref_name || github.ref }}
  cancel-in-progress: true

jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      example: ${{ steps.filter.outputs.example || 'true' }}
    steps:
      - uses: dorny/paths-filter@0e4a8c6effa4802afeda77dc8d303f8176d7dfad # v3
        id: filter
        if: github.event_name == 'push' || github.event_name == 'pull_request'
  test:
    needs: changes
    if: needs.changes.outputs.example == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo test
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: echo lint

  report-failure:
    needs: [test, lint]
    if: failure() && github.event_name == 'schedule'
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
      issues: write
    steps:
      - run: ./scripts/create_issue.sh "Example CI" "ci_failure"
"""


class CheckWorkflowsTest(unittest.TestCase):

    def check(self, **workflows: str) -> list[str]:
        """Checks the given workflows, keyed by file name without `.yml`."""
        with tempfile.TemporaryDirectory() as workflows_dir:
            for name, content in workflows.items():
                path = os.path.join(workflows_dir, f"{name}.yml")
                with open(path, "w", encoding="utf-8") as f:
                    f.write(content)
            return check_workflows(workflows_dir)

    def assert_one_error(self, content: str, expected: str) -> None:
        errors = self.check(example=content)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn(expected, errors[0])

    def test_valid_workflow_passes(self) -> None:
        self.assertEqual(self.check(example=VALID), [])

    def test_repository_workflows_pass(self) -> None:
        self.assertEqual(check_workflows(DEFAULT_WORKFLOWS_DIR), [])

    def test_exempt_workflow_is_skipped(self) -> None:
        self.assertEqual(self.check(triage="on: issues\njobs: {}\n"), [])

    def test_reusable_workflow_is_skipped(self) -> None:
        self.assertEqual(self.check(reusable="on: workflow_call\njobs: {}\n"), [])

    def test_missing_schedule_fails(self) -> None:
        content = VALID.replace('  schedule:\n    - cron: "15 2 * * *"\n', "")
        self.assert_one_error(content, "has no `schedule` trigger")

    def test_hourly_cron_fails(self) -> None:
        content = VALID.replace('"15 2 * * *"', '"15 * * * *"')
        self.assert_one_error(content, "is not once a day")

    def test_cron_on_the_hour_fails(self) -> None:
        content = VALID.replace('"15 2 * * *"', '"0 2 * * *"')
        self.assert_one_error(content, "starts on the hour")

    def test_missing_workflow_dispatch_fails(self) -> None:
        content = VALID.replace("  workflow_dispatch:\n", "")
        self.assert_one_error(content, "has no `workflow_dispatch` trigger")

    def test_concurrency_without_event_name_fails(self) -> None:
        content = VALID.replace("-${{ github.event_name }}", "")
        self.assert_one_error(content, "does not include `github.event_name`")

    def test_workflow_without_concurrency_passes(self) -> None:
        start = VALID.index("concurrency:")
        content = VALID[:start] + VALID[VALID.index("jobs:") :]
        self.assertEqual(self.check(example=content), [])

    def test_paths_filter_without_event_check_fails(self) -> None:
        content = VALID.replace(
            "        if: github.event_name == 'push' ||"
            " github.event_name == 'pull_request'\n",
            "",
        )
        self.assert_one_error(content, "job `changes` runs dorny/paths-filter")

    def test_missing_report_job_fails(self) -> None:
        content = VALID[: VALID.index("  report-failure:")]
        self.assert_one_error(content, "has no `report-failure` job")

    def test_report_job_on_push_fails(self) -> None:
        content = VALID.replace(
            "failure() && github.event_name == 'schedule'", "failure()"
        )
        self.assert_one_error(content, "does not have `if: failure()")

    def test_report_job_waits_for_ancestors(self) -> None:
        # `changes` is needed by `test`, so waiting for `test` covers it.
        self.assertEqual(self.check(example=VALID), [])
        content = VALID.replace("needs: [test, lint]", "needs: test")
        self.assert_one_error(content, "does not wait for: lint")

    def test_report_job_without_issues_permission_fails(self) -> None:
        content = VALID.replace("      issues: write\n", "")
        self.assert_one_error(content, "lacks `issues: write` permission")

    def test_report_job_with_other_label_fails(self) -> None:
        content = VALID.replace('"ci_failure"', '"eval_failure"')
        self.assert_one_error(content, "does not run ./scripts/create_issue.sh")

    def test_shared_cron_fails(self) -> None:
        other = VALID.replace('"Example CI"', '"Other CI"')
        errors = self.check(example=VALID, other=other)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("is the same as in example.yml", errors[0])

    def test_shared_issue_name_fails(self) -> None:
        other = VALID.replace('"15 2 * * *"', '"30 2 * * *"')
        errors = self.check(example=VALID, other=other)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("as example.yml does", errors[0])


if __name__ == "__main__":
    unittest.main()
