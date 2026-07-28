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


def run_cmd(args):
    res = subprocess.run(args, capture_output=True, text=True, check=True)
    return res.stdout.strip()


def main():
    parser = argparse.ArgumentParser(
        description="Apply approved triage decisions to GitHub."
    )
    parser.add_argument(
        "--decisions-file", required=True, help="Path to triage_decisions.json."
    )
    args = parser.parse_args()

    decisions_path = os.path.abspath(os.path.expanduser(args.decisions_file))
    if not os.path.exists(decisions_path):
        print(
            f"Error: Decisions file '{decisions_path}' does not exist.", file=sys.stderr
        )
        sys.exit(1)

    with open(decisions_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    decisions = data["decisions"]
    approved_decisions = [d for d in decisions if d["approved"]]

    print(f"Applying {len(approved_decisions)} approved triage decisions to GitHub...")

    failed_issues = []

    for i, dec in enumerate(approved_decisions):
        issue_id = str(dec["id"])
        priority = dec["priority"]
        assignee = dec["assignee"]
        action = dec["action"]
        labels = dec["labels"]
        reply = dec["reply"]

        print(f"\n[{i+1}/{len(approved_decisions)}] Processing Issue #{issue_id}...")

        try:
            # 1. Update Labels (Priority and component/type labels)
            current_labels = []
            issue_info_json = run_cmd(
                ["gh", "issue", "view", issue_id, "--json", "labels"]
            )
            if issue_info_json:
                try:
                    issue_info = json.loads(issue_info_json)
                    current_labels = [
                        l.get("name")
                        for l in issue_info.get("labels", [])
                        if l.get("name")
                    ]
                except Exception as e:
                    print(
                        f"  Warning: Failed to parse current labels: {e}",
                        file=sys.stderr,
                    )

            # Identify existing priority labels
            priority_labels = {"P0", "P1", "P2", "P3", "P4"}
            existing_p_labels = {l for l in current_labels if l in priority_labels}

            # Determine priority labels to add and remove
            remove_labels = []
            add_labels = []

            if priority in priority_labels:
                # Remove any other priority label
                remove_labels.extend(list(existing_p_labels - {priority}))
                # Add the new priority label if not already present
                if priority not in existing_p_labels:
                    add_labels.append(priority)
            else:
                # If new priority is "None", remove any existing priority label
                remove_labels.extend(list(existing_p_labels))

            # Determine other non-priority component/type labels to add
            for l in labels:
                if l and l not in current_labels:
                    add_labels.append(l)

            # Apply label changes via gh CLI
            if remove_labels:
                remove_str = ",".join(remove_labels)
                print(f"  Removing conflicting priority labels: {remove_str}")
                run_cmd(["gh", "issue", "edit", issue_id, "--remove-label", remove_str])

            if add_labels:
                add_str = ",".join(add_labels)
                print(f"  Adding labels: {add_str}")
                run_cmd(["gh", "issue", "edit", issue_id, "--add-label", add_str])

            # 2. Assignee
            if assignee:
                print(f"  Assigning to: @{assignee}")
                run_cmd(["gh", "issue", "edit", issue_id, "--add-assignee", assignee])

            # 3. Post Response Comment
            if reply:
                # Prepend the mandatory triage prefix if not already present
                prefix = "A2UI Triage: "
                comment_body = reply.strip()
                if not comment_body.startswith(prefix):
                    comment_body = prefix + comment_body

                already_posted = False
                comments_json = run_cmd(
                    ["gh", "issue", "view", issue_id, "--json", "comments"]
                )
                if comments_json:
                    try:
                        comments_data = json.loads(comments_json)
                        existing_comments = comments_data.get("comments", [])
                        for c in existing_comments:
                            if c["body"].strip() == comment_body:
                                already_posted = True
                                break
                    except Exception as e:
                        print(
                            f"  Warning: Failed to parse existing comments: {e}",
                            file=sys.stderr,
                        )

                if already_posted:
                    print(f"  Comment already posted. Skipping to prevent duplicate.")
                else:
                    print(f"  Posting comment...")
                    run_cmd(
                        ["gh", "issue", "comment", issue_id, "--body", comment_body]
                    )

            # 4. Close Issue if action dictates it
            if action in ["close_duplicate", "close_invalid", "close_resolved"]:
                if action == "close_duplicate":
                    reason = "duplicate"
                elif action == "close_invalid":
                    reason = "not planned"
                else:
                    reason = "completed"
                print(f"  Closing issue (reason: {reason})...")
                run_cmd(["gh", "issue", "close", issue_id, "--reason", reason])

        except subprocess.CalledProcessError as e:
            print(
                f"  Error: Command '{' '.join(e.cmd)}' failed with exit code"
                f" {e.returncode}.",
                file=sys.stderr,
            )
            print(f"  Stderr: {e.stderr.strip()}", file=sys.stderr)
            print(
                f"  Skipping remaining updates for Issue #{issue_id}.", file=sys.stderr
            )
            failed_issues.append(issue_id)
            continue
        except Exception as e:
            print(
                f"  Error: Unexpected error updating Issue #{issue_id}: {e}",
                file=sys.stderr,
            )
            print(
                f"  Skipping remaining updates for Issue #{issue_id}.", file=sys.stderr
            )
            failed_issues.append(issue_id)
            continue

    if failed_issues:
        print(
            f"\nFinished with errors. Failed to apply updates for {len(failed_issues)}"
            f" issues: {', '.join(failed_issues)}"
        )
        sys.exit(1)
    else:
        print(
            "\nAll approved triage decisions have been successfully applied to GitHub!"
        )
        sys.exit(0)


if __name__ == "__main__":
    main()
