#!/usr/bin/env python3
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

import subprocess
import json
import sys
import argparse
import os


def run_cmd(args):
    res = subprocess.run(args, capture_output=True, text=True, check=True)
    return res.stdout.strip()


def apply_decisions(decisions, on_progress=None):
    approved_decisions = [d for d in decisions if d.get("approved")]
    print(f"Applying {len(approved_decisions)} approved triage decisions to GitHub...")
    failed_issues = []
    logs = []

    def log(msg, to_stderr=False):
        logs.append(msg)
        if to_stderr:
            print(msg, file=sys.stderr)
        else:
            print(msg)

    total_count = len(approved_decisions)
    for i, dec in enumerate(approved_decisions):
        issue_id = str(dec["id"])
        priority = dec.get("priority", "None")
        assignee = dec.get("assignee")
        action = dec.get("action", "investigate")
        labels = dec.get("labels", [])
        reply = dec.get("reply", "")

        log(f"\n[{i+1}/{total_count}] Processing Issue #{issue_id}...")
        is_success = True
        err_msg = None

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
                    log(
                        f"  Warning: Failed to parse current labels: {e}",
                        to_stderr=True,
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

            # Ensure status: first-line-handled is added to all triaged issues
            if (
                "status: first-line-handled" not in current_labels
                and "status: first-line-handled" not in add_labels
            ):
                add_labels.append("status: first-line-handled")

            # Handle status: waiting-for-author-response based on action
            if action == "needs_info":
                if (
                    "status: waiting-for-author-response" not in current_labels
                    and "status: waiting-for-author-response" not in add_labels
                ):
                    add_labels.append("status: waiting-for-author-response")
            else:
                if (
                    "status: waiting-for-author-response" in current_labels
                    and "status: waiting-for-author-response" not in remove_labels
                ):
                    remove_labels.append("status: waiting-for-author-response")

            # Determine other non-priority component/type labels to add
            for l in labels:
                if l == "status: waiting-for-author-response":
                    continue
                if l and l not in current_labels and l not in add_labels:
                    add_labels.append(l)

            # Apply label changes via gh CLI
            if remove_labels:
                remove_str = ",".join(remove_labels)
                log(f"  Removing conflicting priority labels: {remove_str}")
                run_cmd(["gh", "issue", "edit", issue_id, "--remove-label", remove_str])

            if add_labels:
                add_str = ",".join(add_labels)
                log(f"  Adding labels: {add_str}")
                run_cmd(["gh", "issue", "edit", issue_id, "--add-label", add_str])

            # 2. Assignee
            if assignee:
                log(f"  Assigning to: @{assignee}")
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
                        log(
                            f"  Warning: Failed to parse existing comments: {e}",
                            to_stderr=True,
                        )

                if already_posted:
                    log(f"  Comment already posted. Skipping to prevent duplicate.")
                else:
                    log(f"  Posting comment...")
                    run_cmd(
                        ["gh", "issue", "comment", issue_id, "--body", comment_body]
                    )

            # 4. Update Milestone if specified
            if dec.get("milestone"):
                log(f"  Setting milestone to: '{dec['milestone']}'")
                run_cmd(
                    ["gh", "issue", "edit", issue_id, "--milestone", dec["milestone"]]
                )
            elif dec.get("remove_milestone"):
                log(f"  Removing milestone...")
                run_cmd(["gh", "issue", "edit", issue_id, "--remove-milestone"])

            # 5. Close Issue if action dictates it
            if action in ["close_duplicate", "close_invalid", "close_resolved"]:
                if action == "close_duplicate":
                    reason = "duplicate"
                elif action == "close_invalid":
                    reason = "not planned"
                else:
                    reason = "completed"
                log(f"  Closing issue (reason: {reason})...")
                run_cmd(["gh", "issue", "close", issue_id, "--reason", reason])

        except subprocess.CalledProcessError as e:
            log(
                f"  Error: Command '{' '.join(e.cmd)}' failed with exit code"
                f" {e.returncode}.",
                to_stderr=True,
            )
            log(f"  Stderr: {e.stderr.strip()}", to_stderr=True)
            log(
                f"  Skipping remaining updates for Issue #{issue_id}.",
                to_stderr=True,
            )
            is_success = False
            err_msg = str(e)
            failed_issues.append(issue_id)
        except Exception as e:
            log(
                f"  Error: Unexpected error updating Issue #{issue_id}: {e}",
                to_stderr=True,
            )
            log(
                f"  Skipping remaining updates for Issue #{issue_id}.",
                to_stderr=True,
            )
            is_success = False
            err_msg = str(e)
            failed_issues.append(issue_id)
        finally:
            if on_progress:
                try:
                    on_progress(issue_id, i + 1, total_count, is_success, err_msg)
                except Exception:
                    pass

    return len(failed_issues) == 0, failed_issues, logs


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
    success, failed_issues, _ = apply_decisions(decisions)

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
