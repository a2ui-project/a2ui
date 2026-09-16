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

"""Extracts recommendation details and audit context from A2UI compliance reports.

This helper script parses a compliance report (either a local file or fetched from
GitHub via the `gh` CLI) and extracts the target recommendation item and its
associated details.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from typing import Any


def fetch_issue_body(issue_ref: str, repo: str | None = None) -> str:
    """Fetches the body of a GitHub issue using the gh CLI."""
    cmd = ["gh", "issue", "view", issue_ref, "--json", "body", "--jq", ".body"]
    if repo:
        cmd.extend(["--repo", repo])
    env = os.environ.copy()
    if env.get("GITHUB_TOKEN") in ("", "dummy", "empty"):
        env.pop("GITHUB_TOKEN", None)
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, check=False, env=env
        )
    except FileNotFoundError as err:
        raise RuntimeError(
            "The GitHub CLI 'gh' is not installed or not found in the system PATH. "
            "Please install it to fetch issues dynamically."
        ) from err
    if result.returncode != 0:
        raise RuntimeError(
            f"Failed to fetch issue {issue_ref} via gh CLI: {result.stderr.strip()}"
        )
    return result.stdout


def parse_recommendations(report_text: str) -> dict[int, dict[str, str]]:
    """Parses all numbered recommendations from report markdown text."""
    recommendations: dict[int, dict[str, str]] = {}
    lines = report_text.splitlines()
    in_recommendations = False
    current_index: int | None = None
    current_lines: list[str] = []
    in_code_block = False
    code_block_fence = ""

    item_header_pattern = re.compile(r"^(\d+)\.\s+(.*)")

    for line in lines:
        stripped = line.strip()

        # Track markdown code blocks to avoid false positives inside them
        if in_code_block:
            if stripped.startswith(code_block_fence):
                in_code_block = False
            if current_index is not None:
                current_lines.append(line)
            continue
        else:
            fence_match = re.match(r"^(~{3,}|\x60{3,})", stripped)
            if fence_match:
                in_code_block = True
                code_block_fence = fence_match.group(1)
                if current_index is not None:
                    current_lines.append(line)
                continue

        if stripped.startswith("## Recommendations"):
            in_recommendations = True
            continue
        elif in_recommendations and (stripped.startswith("## ") or stripped == "---"):
            if current_index is not None:
                recommendations[current_index] = _build_rec_entry(current_lines)
                current_lines = []
                current_index = None
            if stripped.startswith("## "):
                in_recommendations = False

        if in_recommendations:
            match = item_header_pattern.match(stripped)
            if match:
                if current_index is not None:
                    recommendations[current_index] = _build_rec_entry(current_lines)
                    current_lines = []
                current_index = int(match.group(1))
                current_lines.append(stripped)
            elif current_index is not None:
                current_lines.append(line)

    if current_index is not None:
        recommendations[current_index] = _build_rec_entry(current_lines)

    return recommendations


def _build_rec_entry(lines: list[str]) -> dict[str, str]:
    """Extracts priority, title, and raw text from lines of a single recommendation."""
    raw_text = "\n".join(lines).strip()
    first_line = lines[0] if lines else ""
    prio_match = re.search(r"\*\*(P[0-4])\*\*", first_line)
    priority = prio_match.group(1) if prio_match else "P2"

    return {
        "priority": priority,
        "raw_text": raw_text,
    }


def extract_recommendation(
    source: str, index: int | None = None, repo: str | None = None
) -> dict[str, Any]:
    """Extracts recommendation or general issue context from a file path or GitHub issue number."""
    if os.path.isfile(source):
        with open(source, "r", encoding="utf-8") as f:
            content = f.read()
    else:
        content = fetch_issue_body(source, repo=repo)

    recs = parse_recommendations(content)
    if not recs:
        # General issue (not an audit compliance report)
        return {
            "type": "general_issue",
            "content": content.strip(),
        }

    if index is None:
        # Return summary of all available recommendations
        items = []
        for idx in sorted(recs.keys()):
            items.append({
                "index": idx,
                "priority": recs[idx]["priority"],
                "content": recs[idx]["raw_text"],
            })
        return {
            "type": "compliance_report",
            "recommendations": items,
        }

    if index not in recs:
        available = sorted(recs.keys())
        raise ValueError(
            f"Recommendation #{index} not found in report. Available indices:"
            f" {available}"
        )

    rec = recs[index]
    return {
        "type": "compliance_recommendation",
        "index": index,
        "priority": rec["priority"],
        "content": rec["raw_text"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract recommendation item or issue context for A2UI remediation."
    )
    parser.add_argument(
        "source",
        help="Path to report markdown file or GitHub issue number (e.g. '2391')",
    )
    parser.add_argument(
        "index",
        nargs="?",
        type=int,
        default=None,
        help="Optional 1-based recommendation index (e.g. 1)",
    )
    parser.add_argument(
        "--repo",
        default="a2ui-project/a2ui",
        help=(
            "GitHub repository when fetching by issue number (default:"
            " 'a2ui-project/a2ui')"
        ),
    )
    parser.add_argument(
        "--json", action="store_true", help="Output details in JSON format"
    )
    args = parser.parse_args()

    try:
        data = extract_recommendation(args.source, args.index, repo=args.repo)
    except Exception as err:
        print(f"Error: {err}", file=sys.stderr)
        sys.exit(1)

    if args.json:
        print(json.dumps(data, indent=2))
    elif data["type"] == "general_issue":
        print("=== General Issue Context ===")
        print(data["content"])
    elif data["type"] == "compliance_report":
        print(
            f"=== Compliance Report ({len(data['recommendations'])} recommendations"
            " found) ==="
        )
        for item in data["recommendations"]:
            print(
                f"- Recommendation {item['index']} ({item['priority']}):"
                f" {item['content'].splitlines()[0]}"
            )
    else:
        print(f"=== Recommendation {data['index']} ({data['priority']}) ===")
        print(data["content"])


if __name__ == "__main__":
    main()
