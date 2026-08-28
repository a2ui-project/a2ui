#!/usr/bin/env python3
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

"""Publishes the weekly blueprint compliance report as a GitHub issue.

This script parses command-line arguments to locate the compiled markdown report
and post it as a new GitHub issue in the target repository using the `gh` CLI.
It then automatically injects copyable remediation prompt blocks with the newly
created issue URL under each recommendation item and updates the issue body.
"""

from __future__ import annotations

import argparse
import datetime
import os
import re
import subprocess
import sys


def inject_recommendation_prompts(report_content: str, issue_url: str) -> str:
    """Injects copyable agent prompt blocks under each recommendation item."""
    lines = report_content.splitlines()
    new_lines: list[str] = []
    in_recommendations = False
    rec_pattern = re.compile(r"^(\d+)\.\s+(.*)")

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if stripped.startswith("## Recommendations"):
            in_recommendations = True
            new_lines.append(line)
            i += 1
            continue
        elif in_recommendations and (stripped.startswith("## ") or stripped == "---"):
            if stripped.startswith("## "):
                in_recommendations = False
            new_lines.append(line)
            i += 1
            continue

        if in_recommendations:
            match = rec_pattern.match(stripped)
            if match:
                idx = int(match.group(1))
                new_lines.append(line)
                i += 1

                # Collect subsequent lines belonging to this recommendation
                rec_lines: list[str] = []
                while i < len(lines):
                    next_stripped = lines[i].strip()
                    if (
                        rec_pattern.match(next_stripped)
                        or next_stripped.startswith("## ")
                        or next_stripped == "---"
                    ):
                        break
                    # If an existing prompt block or label is found, skip it
                    if next_stripped.startswith("Copy this prompt"):
                        i += 1
                        continue
                    if next_stripped.startswith("````") or next_stripped.startswith(
                        "```"
                    ):
                        fence = (
                            next_stripped[:4]
                            if next_stripped.startswith("````")
                            else next_stripped[:3]
                        )
                        i += 1
                        while i < len(lines) and not lines[i].strip().startswith(fence):
                            i += 1
                        if i < len(lines):
                            i += 1
                        continue
                    rec_lines.append(lines[i])
                    i += 1

                while rec_lines and rec_lines[-1].strip() == "":
                    rec_lines.pop()

                new_lines.extend(rec_lines)

                prompt_block = f"""   Copy this prompt to implement this recommendation:
   ````markdown
   Read the A2UI issue at {issue_url} and use the `a2ui-remediate-problem` skill to implement recommendation {idx} described in the issue's Recommendation section.
   ````"""
                new_lines.append(prompt_block)
                new_lines.append("")
                continue

        new_lines.append(line)
        i += 1

    return "\n".join(new_lines).rstrip() + "\n"


def main() -> None:
    """Parses arguments and creates a GitHub issue with the compliance report.

    Validates that the input report exists, formats the issue title, and invokes
    the GitHub CLI (`gh`) to file the issue under the target repository with
    the required labels. Then injects copyable prompt blocks with the generated
    issue URL and updates the issue body.
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

    with open(report_path, "r", encoding="utf-8") as f:
        original_content = f.read()

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

    issue_url = result.stdout.strip()
    print("Success: Compliance report issue posted successfully.")
    print(issue_url)

    # Post-process report to inject recommendation prompt blocks and update issue
    enhanced_content = inject_recommendation_prompts(original_content, issue_url)
    if enhanced_content != original_content:
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(enhanced_content)

        issue_id = issue_url.rstrip("/").split("/")[-1]
        edit_cmd = [
            "gh",
            "issue",
            "edit",
            issue_id,
            "--body-file",
            report_path,
        ]
        if args.repo:
            edit_cmd.extend(["--repo", args.repo])

        print(f"Updating issue with remediation prompt blocks: {' '.join(edit_cmd)}")
        edit_result = subprocess.run(
            edit_cmd, capture_output=True, text=True, check=False, env=env
        )
        if edit_result.returncode != 0:
            print(
                "Warning: Failed to update issue description with prompt blocks:"
                f" {edit_result.stderr}",
                file=sys.stderr,
            )


if __name__ == "__main__":
    main()
