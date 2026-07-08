#!/usr/bin/env python3
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

import json
import sys
import argparse
import os
import re
import subprocess
import time
from collections import Counter

# Directory mapping for repo components to run git checks
COMPONENT_DIRS = {
    "component: lit renderer": "renderers/lit",
    "component: angular renderer": "renderers/angular",
    "component: react renderer": "renderers/react",
    "component: standard catalog specification": "specification",
    "component: specification": "specification",
    "component: samples": "samples",
    "component: agent library": "agent_sdks",
}


def safe_prefix_match(s1, s2):
    if len(s1) < 3 or len(s2) < 3:
        return False
    return s1.startswith(s2) or s2.startswith(s1)


def get_suggested_assignees(component_labels, repo_dir, valid_assignees):
    if not valid_assignees:
        return []

    assignee_logins = [a["login"] for a in valid_assignees]

    # Find directories related to these components
    target_dirs = []
    for label in component_labels:
        if label in COMPONENT_DIRS:
            target_dirs.append(COMPONENT_DIRS[label])

    if not target_dirs:
        return []

    # Run git log in each target directory to collect commit authors
    authors = []
    for target_dir in target_dirs:
        full_path = os.path.join(repo_dir, target_dir)
        if not os.path.exists(full_path):
            continue

        try:
            # Run: git log -n 30 --format="%an <%ae>" -- <path>
            res = subprocess.run(
                ["git", "log", "-n", "30", "--format=%an <%ae>", "--", target_dir],
                cwd=repo_dir,
                capture_output=True,
                text=True,
            )
            if res.returncode == 0:
                for line in res.stdout.splitlines():
                    if line.strip():
                        authors.append(line.strip())
        except Exception:
            pass

    if not authors:
        return []

    # Count occurrences of each author (excluding bots)
    author_counts = Counter()
    for author in authors:
        author_lower = author.lower()
        if "dependabot" in author_lower or "github-actions" in author_lower:
            continue

        # Parse name and email prefix
        match = re.match(r"^(.*?)\s*<(.*?)>$", author)
        if match:
            author_counts[author] += 1

    if not author_counts:
        return []

    # Sort authors by frequency
    sorted_authors = [a for a, _ in author_counts.most_common()]

    suggested = []
    # Map the top authors to valid GitHub assignees
    for author_info in sorted_authors:
        match = re.match(r"^(.*?)\s*<(.*?)>$", author_info)
        if not match:
            continue
        name = match.group(1).strip().lower().replace(" ", "")
        email = match.group(2).strip().lower()
        email_prefix = email.split("@")[0]

        # First pass: try to find an exact match
        found_exact = False
        for login in assignee_logins:
            if login in suggested:
                continue
            login_lower = login.lower()
            if login_lower == email_prefix or login_lower == name:
                suggested.append(login)
                found_exact = True
                break

        if found_exact:
            continue

        # Second pass: fallback to prefix/substring match, requiring a minimum length of 3
        for login in assignee_logins:
            if login in suggested:
                continue
            login_lower = login.lower()

            if safe_prefix_match(login_lower, email_prefix) or safe_prefix_match(
                login_lower, name
            ):
                suggested.append(login)
                break

    return suggested


def guess_triage_heuristics(title, body):
    # Default suggestions
    priority = "None"
    action = "investigate"
    labels = []
    reply = ""

    text = (title + " " + body).lower()

    # Guess Component Labels
    if "lit" in text:
        labels.append("component: lit renderer")
    elif "angular" in text:
        labels.append("component: angular renderer")
    elif "react" in text:
        labels.append("component: react renderer")
    elif "samples" in text or "demo" in text:
        labels.append("component: samples")
    elif "specification" in text or "spec" in text or "schema" in text:
        labels.append("component: specification")
    elif "agent" in text or "sdk" in text:
        labels.append("component: agent library")

    # Guess Type Labels
    if "typo" in text or "documentation" in text or "readme" in text or "docs" in text:
        labels.append("type: documentation")
        priority = "P3"
        action = "close_resolved" if "typo" in text else "investigate"
        reply = "Thanks. We will update the documentation."
    elif "feature" in text or "enhancement" in text or "request" in text:
        labels.append("type: feature/enhancement")
        priority = "P3"
        action = "investigate"
        reply = "Thanks for the suggestion. We will evaluate this against our roadmap."
    else:
        # Default to bug if not documentation/feature and contains words like error, fail, crash, bug
        if any(
            w in text
            for w in ["error", "fail", "crash", "bug", "exception", "broken", "issue"]
        ):
            labels.append("type: bug")
            priority = "P2"
            action = "investigate"
            reply = (
                "Thanks for reporting. We will investigate the code and logs to"
                " diagnose this."
            )

    # Guess waiting-for-user-response if repro steps are obviously missing in bug reports
    if "type: bug" in labels:
        if not any(w in text for w in ["reproduce", "repro", "steps", "run", "how to"]):
            labels.append("waiting-for-user-response")
            action = "needs_info"
            reply = (
                "Please provide a minimal reproduction schema or code snippet to help"
                " us investigate."
            )

    return {
        "priority": priority,
        "action": action,
        "labels": list(set(labels)),
        "reply": reply,
    }


def main():
    default_repo_dir = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "../../../")
    )

    parser = argparse.ArgumentParser(
        description="Generate initial triage suggestions and data for subagents."
    )
    parser.add_argument("--input-file", required=True, help="Path to raw issues JSON.")
    parser.add_argument(
        "--output-file", required=True, help="Path to save enriched issues JSON."
    )
    parser.add_argument(
        "--repo-dir",
        default=default_repo_dir,
        help="Path to the local A2UI repository root.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=10,
        help="Maximum number of issues to review in this session.",
    )
    args = parser.parse_args()

    input_path = os.path.abspath(os.path.expanduser(args.input_file))
    if not os.path.exists(input_path):
        print(f"Error: Input file {input_path} does not exist.", file=sys.stderr)
        sys.exit(1)

    repo_dir = os.path.abspath(os.path.expanduser(args.repo_dir))

    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    all_issues = data["issues"]
    valid_assignees = data["assignees"]

    total_issues_count = data["total_issues_count"]
    issues = all_issues[: args.limit]

    print(f"Generating initial suggestions and data for {len(issues)} issues...")

    for issue in issues:
        # 1. Run heuristics for priority, action, labels, and reply
        suggestions = guess_triage_heuristics(
            issue.get("title", ""), issue.get("body", "")
        )

        # 2. Run git history check to find suggested assignees dynamically sorted by likelihood
        suggested = get_suggested_assignees(
            suggestions["labels"], repo_dir, valid_assignees
        )
        suggestions["suggested_assignees"] = suggested

        # If the issue already has an assignee, preserve it!
        existing_assignees = issue.get("assignees", [])
        if existing_assignees:
            suggestions["assignee"] = existing_assignees[0]
            suggestions["assignee_reason"] = (
                f"Preserving existing assignee: {existing_assignees[0]}."
            )
        else:
            # 3. Add assignee reason
            if suggested:
                suggestions["assignee_reason"] = (
                    f"Suggesting {suggested[0]} because they recently modified related"
                    " code."
                )
            else:
                suggestions["assignee_reason"] = ""

            # Only recommend assignment for P0 and P1 issues
            is_high_priority = suggestions["priority"] in ["P0", "P1"]
            if is_high_priority and suggested:
                suggestions["assignee"] = suggested[0]
            else:
                suggestions["assignee"] = ""
                # For lower priority issues, add an @mention in the comment for the recommended owner
                if suggested and suggestions["reply"]:
                    suggestions["reply"] = (
                        suggestions["reply"].strip() + f" cc @{suggested[0]}"
                    )

        # Ensure draft reply starts with "A2UI Triage: " prefix
        if suggestions["reply"]:
            reply_text = suggestions["reply"].strip()
            prefix = "A2UI Triage: "
            if not reply_text.startswith(prefix):
                suggestions["reply"] = prefix + reply_text

        issue["suggestions"] = suggestions

    # Write the final compiled suggestions to the output file
    data["issues"] = issues
    data["total_issues_count"] = total_issues_count

    output_path = os.path.abspath(os.path.expanduser(args.output_file))
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    print(f"Successfully generated data and saved to {output_path}")


if __name__ == "__main__":
    main()
