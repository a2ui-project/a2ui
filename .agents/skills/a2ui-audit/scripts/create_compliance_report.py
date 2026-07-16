#!/usr/bin/env python3
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

"""Publishes the weekly blueprint compliance report as a GitHub issue.

This script parses command-line arguments to locate the compiled markdown report
and post it as a new GitHub issue in the target repository using the `gh` CLI.
"""

import argparse
import datetime
import os
import subprocess
import sys


def main() -> None:
    """Parses arguments and creates a GitHub issue with the compliance report.

    Validates that the input report exists, formats the issue title, and invokes
    the GitHub CLI (`gh`) to file the issue under the target repository with
    the required labels.
    """
    parser = argparse.ArgumentParser(
        description="Post blueprint compliance report as a GitHub issue."
    )
    parser.add_argument("report_path", help="Path to the markdown report file")
    parser.add_argument(
        "--repo", help="Target GitHub repository (e.g., 'a2ui-project/a2ui')"
    )
    args = parser.parse_args()

    report_path = args.report_path
    if not os.path.exists(report_path):
        print(f"Error: Report file not found at '{report_path}'")
        sys.exit(1)

    today = datetime.date.today().isoformat()
    issue_title = f"Weekly A2UI Compliance Report ({today})"

    cmd = [
        "gh",
        "issue",
        "create",
        "--title",
        issue_title,
        "--body-file",
        report_path,
        "--label",
        "status: needs review",
        "--label",
        "component: specification",
    ]
    if args.repo:
        cmd.extend(["--repo", args.repo])

    print(f"Running: {' '.join(cmd)}")
    env = os.environ.copy()
    if env.get("GITHUB_TOKEN") in ("", "dummy", "empty"):
        env.pop("GITHUB_TOKEN", None)

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, check=False, env=env
        )
    except FileNotFoundError:
        print(
            "Error: 'gh' CLI tool not found. Please install the GitHub CLI (gh) and"
            " ensure it is in your PATH."
        )
        sys.exit(1)

    if result.returncode != 0:
        print("Error: Failed to create GitHub issue via gh CLI.")
        print(result.stderr)
        sys.exit(1)

    print("Success: Compliance report issue posted successfully.")
    print(result.stdout.strip())


if __name__ == "__main__":
    main()
