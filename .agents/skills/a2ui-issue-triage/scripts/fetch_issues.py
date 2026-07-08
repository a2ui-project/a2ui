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

import subprocess
import json
import sys
import argparse
import os
import re
import shutil


def run_cmd(args):
    try:
        res = subprocess.run(args, capture_output=True, text=True, check=True)
        return res.stdout.strip()
    except subprocess.CalledProcessError as e:
        print(f"Error running command {' '.join(args)}: {e.stderr}", file=sys.stderr)
        return None


def main():
    parser = argparse.ArgumentParser(
        description="Fetch open, untriaged issues and their comments."
    )
    parser.add_argument(
        "--repo", required=True, help="GitHub repository name (owner/repo)."
    )
    parser.add_argument(
        "--output-file", required=True, help="Path to save the fetched issues JSON."
    )
    parser.add_argument(
        "--limit", type=int, default=10, help="Maximum number of issues to fetch."
    )
    args = parser.parse_args()

    # 1. Check if gh CLI is installed and authenticated
    if not shutil.which("gh"):
        print(
            "Error: GitHub CLI ('gh') is not installed or not in PATH.", file=sys.stderr
        )
        sys.exit(1)

    print(f"Fetching assignees for {args.repo}...")
    assignees_json = run_cmd(
        ["gh", "api", f"repos/{args.repo}/assignees", "--paginate", "--jq", ".[].login"]
    )
    assignees = []
    if assignees_json:
        raw_assignees = [a.strip() for a in assignees_json.splitlines() if a.strip()]

        # Build a name mapping from git log history
        name_map = {}
        git_log = run_cmd(["git", "log", "--format=%an <%ae>"])
        if git_log:
            for line in git_log.splitlines():
                line = line.strip()
                if not line:
                    continue
                match = re.match(r"^(.*?)\s*<(.*?)>$", line)
                if match:
                    name = match.group(1).strip()
                    email = match.group(2).strip().lower()
                    email_prefix = email.split("@")[0]
                    cleaned_name = name.lower().replace(" ", "")

                    if "dependabot" in cleaned_name or "github-actions" in cleaned_name:
                        continue

                    name_map[email_prefix] = name
                    name_map[cleaned_name] = name

        # Map assignees to their real names
        for login in raw_assignees:
            login_lower = login.lower()
            real_name = ""
            if login_lower in name_map:
                real_name = name_map[login_lower]
            else:
                # Substring matching fallback
                for key, val in name_map.items():
                    if login_lower.startswith(key) or key.startswith(login_lower):
                        real_name = val
                        break

            # Fallback: Use login name directly to prevent slow API requests and rate-limiting
            if not real_name:
                real_name = login

            assignees.append({"login": login, "name": real_name})

    print(f"Fetching available labels for {args.repo}...")
    labels_json = run_cmd(
        ["gh", "label", "list", "--repo", args.repo, "--limit", "150", "--json", "name"]
    )
    repo_labels = []
    if labels_json:
        try:
            raw_labels = json.loads(labels_json)
            repo_labels = [l["name"] for l in raw_labels if l.get("name")]
        except Exception as e:
            print(f"Warning: Failed to parse repository labels: {e}", file=sys.stderr)

    print(f"Fetching open issues from {args.repo}...")
    # 2. Fetch open issues with key fields
    issues_json = run_cmd([
        "gh",
        "issue",
        "list",
        "--repo",
        args.repo,
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        "number,title,author,body,createdAt,updatedAt,labels,assignees",
    ])

    if not issues_json:
        print("Failed to fetch issues or repository is empty.", file=sys.stderr)
        sys.exit(1)

    issues = json.loads(issues_json)
    priority_labels = {"P0", "P1", "P2", "P3", "P4"}
    untriaged_issues = []

    for issue in issues:
        # Check if the issue has a priority label
        has_priority = False
        labels = issue.get("labels", [])
        for l in labels:
            if l.get("name") in priority_labels:
                has_priority = True
                break

        if not has_priority:
            untriaged_issues.append(issue)

    print(
        f"Found {len(untriaged_issues)} untriaged issues. Fetching comments for up to"
        f" {args.limit}..."
    )

    enriched_issues = []
    for i, issue in enumerate(untriaged_issues[: args.limit]):
        issue_id = issue["number"]
        # Parse author name
        author = issue.get("author", {}).get("login", "unknown")

        # Fetch comments for this specific issue
        comments_json = run_cmd([
            "gh",
            "issue",
            "view",
            str(issue_id),
            "--repo",
            args.repo,
            "--json",
            "comments",
        ])

        comments = []
        if comments_json:
            try:
                comments_data = json.loads(comments_json)
                raw_comments = comments_data.get("comments", [])
                for c in raw_comments:
                    comments.append({
                        "author": c.get("author", {}).get("login", "unknown"),
                        "body": c.get("body", ""),
                    })
            except Exception as e:
                print(
                    f"Failed to parse comments for issue #{issue_id}: {e}",
                    file=sys.stderr,
                )

        existing_assignees = [
            a.get("login") for a in issue.get("assignees", []) if a.get("login")
        ]

        enriched_issues.append({
            "id": issue_id,
            "title": issue.get("title", ""),
            "author": author,
            "body": issue.get("body", ""),
            "createdAt": issue.get("createdAt", ""),
            "updatedAt": issue.get("updatedAt", ""),
            "labels": [l.get("name") for l in issue.get("labels", [])],
            "assignees": existing_assignees,
            "comments": comments,
        })

    # Prepare output payload
    payload = {
        "repo": args.repo,
        "assignees": assignees,
        "labels": repo_labels,
        "issues": enriched_issues,
        "total_issues_count": len(untriaged_issues),
    }

    # Write to output file
    output_path = os.path.abspath(os.path.expanduser(args.output_file))
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    print(f"Successfully saved {len(enriched_issues)} issues to {output_path}")


if __name__ == "__main__":
    main()
