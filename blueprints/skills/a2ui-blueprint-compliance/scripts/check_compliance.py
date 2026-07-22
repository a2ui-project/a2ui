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

"""Checks codebase compliance against module blueprints.

This script scans codebase blueprint definitions and compares them against
their corresponding module blueprints using Git history to verify if the
implementations are up to date.
"""

import os
import sys
import subprocess
import glob
from datetime import datetime
from typing import List, Optional

# Add blueprints directory to path so we can import validate_blueprints
sys.path.insert(
    0,
    os.path.abspath(
        os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", "..", "..")
    ),
)
from validate_blueprints import parse_frontmatter


def run_cmd(args: List[str], cwd: Optional[str] = None) -> Optional[str]:
    """Runs a shell command and returns output, or None on error."""
    try:
        result = subprocess.run(
            args, capture_output=True, text=True, cwd=cwd, check=False
        )
        if result.returncode != 0:
            return None
        return result.stdout.strip()
    except FileNotFoundError as e:
        print(
            f"Error running command {args}: executable not found. Details: {e}",
            file=sys.stderr,
        )
        return None


def get_latest_commit(file_path: str, cwd: Optional[str] = None) -> Optional[str]:
    """Gets the latest commit hash for a specific file."""
    return run_cmd(
        ["git", "log", "-n", "1", "--pretty=format:%H", "--", file_path], cwd=cwd
    )


def get_commits_since(
    file_path: str, since_commit: Optional[str] = None, cwd: Optional[str] = None
) -> List[str]:
    """Gets commits for a file since a specific hash. If since_commit is None, returns all commits."""
    if since_commit:
        # Check if the commit exists in the history of the file first
        contains_commit = run_cmd(
            ["git", "merge-base", "--is-ancestor", since_commit, "HEAD"], cwd=cwd
        )
        if contains_commit is None:
            # Commit not found or invalid ancestor, default to all commits
            args = ["git", "log", "--oneline", "--", file_path]
        else:
            args = ["git", "log", f"{since_commit}..HEAD", "--oneline", "--", file_path]
    else:
        args = ["git", "log", "--oneline", "--", file_path]

    output = run_cmd(args, cwd=cwd)
    if not output:
        return []
    return [line.strip() for line in output.splitlines() if line.strip()]


def main() -> None:
    """Discovers all codebase blueprints and audits their compliance.

    Compares the pinned module commit of each codebase blueprint against the
    latest commit in the corresponding module blueprint, building a markdown
    report showing compliance statuses.
    """
    script_dir = os.path.dirname(os.path.realpath(__file__))
    blueprints_root = os.path.abspath(os.path.join(script_dir, "..", "..", ".."))
    workspace_root = os.path.abspath(os.path.join(blueprints_root, ".."))

    # 1. Discover all codebase blueprints
    codebases_pattern = os.path.join(
        blueprints_root, "codebases", "**", "codebase.blueprint.md"
    )
    codebase_files = glob.glob(codebases_pattern, recursive=True)

    compliance_data = []

    for file_path in sorted(codebase_files):
        rel_path = os.path.relpath(file_path, blueprints_root)
        data, err = parse_frontmatter(file_path)
        if err or data is None:
            print(
                f"Error parsing {rel_path}: {err or 'No data returned'}",
                file=sys.stderr,
            )
            continue

        associated_module = data.get("associated_module")
        codebase_path = data.get("codebase_path")
        current_commit = data.get("module_blueprint_commit")
        implemented_features = data.get("implemented_features") or []

        if not associated_module:
            print(f"Skipping {rel_path}: missing associated_module", file=sys.stderr)
            continue

        module_file = os.path.join(
            blueprints_root, "modules", f"{associated_module}.blueprint.md"
        )
        module_rel_path = os.path.relpath(module_file, workspace_root)

        if not os.path.exists(module_file):
            compliance_data.append({
                "codebase": rel_path,
                "codebase_path": codebase_path or "unknown",
                "module": associated_module,
                "status": "🔴 Error",
                "reason": f"Module blueprint {associated_module} does not exist",
                "commits_behind": [],
                "current_commit": current_commit,
                "latest_commit": "unknown",
            })
            continue

        latest_commit = get_latest_commit(module_rel_path, cwd=workspace_root)

        if not current_commit:
            commits = get_commits_since(module_rel_path, cwd=workspace_root)
            compliance_data.append({
                "codebase": rel_path,
                "codebase_path": codebase_path or "unknown",
                "module": associated_module,
                "status": "🔴 Not Baselined",
                "reason": "Missing module_blueprint_commit in codebase.blueprint.md",
                "commits_behind": commits,
                "current_commit": "None",
                "latest_commit": latest_commit,
            })
        elif current_commit == latest_commit:
            compliance_data.append({
                "codebase": rel_path,
                "codebase_path": codebase_path or "unknown",
                "module": associated_module,
                "status": "🟢 Up to Date",
                "reason": "Matches the latest module blueprint version",
                "commits_behind": [],
                "current_commit": current_commit,
                "latest_commit": latest_commit,
            })
        else:
            commits = get_commits_since(
                module_rel_path, since_commit=current_commit, cwd=workspace_root
            )
            compliance_data.append({
                "codebase": rel_path,
                "codebase_path": codebase_path or "unknown",
                "module": associated_module,
                "status": "🟡 Out of Date",
                "reason": f"Codebase is behind by {len(commits)} commit(s)",
                "commits_behind": commits,
                "current_commit": current_commit,
                "latest_commit": latest_commit,
            })

    # 2. Build Markdown Report
    date_str = datetime.now().strftime("%Y-%m-%d")
    report = []
    report.append(f"# Spec-Driven Development Blueprint Compliance Report ({date_str})")
    report.append("")
    report.append(
        "This report tracks the synchronization status of each platform codebase"
        " against the language-agnostic module blueprints."
    )
    report.append("")

    # Summary Table
    report.append("## Summary Status")
    report.append("")
    report.append(
        "| Codebase Implementation | Associated Module | Status | Commits Behind |"
        " Current Commit | Latest Commit |"
    )
    report.append("|---|---|---|---|---|---|")

    for item in compliance_data:
        codebase_name = os.path.dirname(item["codebase"]).replace("codebases/", "")
        current_val = item["current_commit"]
        current_short = (
            current_val[:8]
            if isinstance(current_val, str) and current_val != "None"
            else "None"
        )
        latest_val = item["latest_commit"]
        latest_short = (
            latest_val[:8]
            if isinstance(latest_val, str) and latest_val != "unknown"
            else "unknown"
        )
        commits_behind_str = (
            "All"
            if "Not Baselined" in item["status"]
            else str(len(item["commits_behind"]))
        )
        report.append(
            f"| `{item['codebase_path']}` | `{item['module']}` | {item['status']} |"
            f" {commits_behind_str} | `{current_short}` | `{latest_short}` |"
        )

    report.append("")

    # Detailed Section
    report.append("## Details by Codebase")
    report.append("")

    has_issues = False

    for item in compliance_data:
        if item["status"] == "🟢 Up to Date":
            continue

        has_issues = True
        codebase_name = os.path.dirname(item["codebase"]).replace("codebases/", "")
        report.append(f"### 📦 `{item['codebase_path']}` ({item['status']})")
        report.append(f"- **Module**: `{item['module']}`")
        report.append(f"- **Current Pinned Commit**: `{item['current_commit']}`")
        report.append(f"- **Latest Module Commit**: `{item['latest_commit']}`")
        report.append(f"- **Reason/Info**: {item['reason']}")
        report.append("")

        if item["commits_behind"]:
            report.append("#### Missing Commits/Specification Diffs:")
            report.append("```text")
            for commit in item["commits_behind"]:
                report.append(f"  {commit}")
            report.append("```")
            report.append("")

    if not has_issues:
        report.append("🎉 All codebases are currently fully compliant and baselined!")
        report.append("")

    report.append("---")
    report.append(
        "*Generated automatically by the Weekly Blueprint Compliance Auditor.*"
    )

    report_content = "\n".join(report)

    # 3. Output
    print(report_content)


if __name__ == "__main__":
    main()
