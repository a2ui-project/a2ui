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

"""Checks codebase compliance against module and feature blueprints.

This script scans codebase blueprint definitions and compares them against
their corresponding module and feature blueprints using Git history to verify
if the implementations are up to date.
"""

from __future__ import annotations

from datetime import datetime
import glob
import os
import subprocess
import sys
from typing import Any

# Add blueprints directory to path so we can import validate_blueprints
sys.path.insert(
    0,
    os.path.abspath(
        os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", "..", "..")
    ),
)
from validate_blueprints import parse_frontmatter


def run_cmd(args: list[str], cwd: str | None = None) -> str | None:
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


def get_latest_commit(file_path: str, cwd: str | None = None) -> str | None:
    """Gets the latest commit hash for a specific file."""
    return run_cmd(
        ["git", "log", "-n", "1", "--pretty=format:%H", "--", file_path], cwd=cwd
    )


def is_valid_ancestor(commit_hash: Any, cwd: str | None = None) -> bool:
    """Returns True if commit_hash is a valid ancestor of HEAD."""
    if not isinstance(commit_hash, str):
        return False
    return (
        run_cmd(["git", "merge-base", "--is-ancestor", commit_hash, "HEAD"], cwd=cwd)
        is not None
    )


def get_commits_since(
    file_path: str, since_commit: str | None = None, cwd: str | None = None
) -> list[str]:
    """Gets commits for a file since a specific hash. If since_commit is None, returns all commits."""
    if since_commit:
        if not is_valid_ancestor(since_commit, cwd=cwd):
            args = ["git", "log", "--oneline", "--", file_path]
        else:
            args = ["git", "log", f"{since_commit}..HEAD", "--oneline", "--", file_path]
    else:
        args = ["git", "log", "--oneline", "--", file_path]

    output = run_cmd(args, cwd=cwd)
    if not output:
        return []
    return [line.strip() for line in output.splitlines() if line.strip()]


def _resolve_feature_path(blueprints_root: str, feat_name: str) -> str:
    """Finds a feature blueprint path in features/ or features/archived/."""
    active_path = os.path.join(blueprints_root, "features", f"{feat_name}.blueprint.md")
    if os.path.exists(active_path):
        return active_path
    archived_path = os.path.join(
        blueprints_root, "features", "archived", f"{feat_name}.blueprint.md"
    )
    if os.path.exists(archived_path):
        return archived_path
    return active_path


def _audit_single_feature_commit(
    feat_name: str,
    feat_commit: Any,
    blueprints_root: str,
    workspace_root: str,
) -> dict[str, Any]:
    """Audits a single feature commit against its feature blueprint."""
    feat_file = _resolve_feature_path(blueprints_root, feat_name)
    feat_rel_path = os.path.relpath(feat_file, workspace_root)
    if not os.path.exists(feat_file):
        return {
            "feature": feat_name,
            "status": "ERROR",
            "reason": f"Feature blueprint {feat_name} does not exist",
            "commits_behind": [],
            "current_commit": feat_commit or "None",
            "latest_commit": "unknown",
        }

    latest_commit = get_latest_commit(feat_rel_path, cwd=workspace_root)
    if not feat_commit:
        commits = get_commits_since(feat_rel_path, cwd=workspace_root)
        return {
            "feature": feat_name,
            "status": "UNTRACKED (null commit)",
            "reason": f"Missing commit hash for feature {feat_name}",
            "commits_behind": commits,
            "current_commit": "None",
            "latest_commit": latest_commit or "unknown",
        }
    if feat_commit == latest_commit:
        return {
            "feature": feat_name,
            "status": "UP-TO-DATE",
            "reason": "Matches the latest feature blueprint version",
            "commits_behind": [],
            "current_commit": feat_commit,
            "latest_commit": latest_commit,
        }
    if not is_valid_ancestor(feat_commit, cwd=workspace_root):
        return {
            "feature": feat_name,
            "status": "UNKNOWN COMMIT",
            "reason": f"Commit {feat_commit} is not a valid ancestor of HEAD",
            "commits_behind": [],
            "current_commit": feat_commit,
            "latest_commit": latest_commit or "unknown",
        }

    commits = run_cmd(
        ["git", "log", f"{feat_commit}..HEAD", "--oneline", "--", feat_rel_path],
        cwd=workspace_root,
    )
    commit_lines = (
        [line.strip() for line in commits.splitlines() if line.strip()]
        if commits
        else []
    )
    return {
        "feature": feat_name,
        "status": (
            f"OUT-OF-SYNC ({len(commit_lines)} commits behind)"
            if commit_lines
            else "UP-TO-DATE"
        ),
        "reason": (
            f"Feature {feat_name} is behind by {len(commit_lines)} commit(s)"
            if commit_lines
            else "No feature blueprint changes since pinned commit"
        ),
        "commits_behind": commit_lines,
        "current_commit": feat_commit,
        "latest_commit": latest_commit or "unknown",
    }


def audit_feature_commits(
    implemented_features: Any,
    blueprints_root: str,
    workspace_root: str,
) -> list[dict[str, Any]]:
    """Audits per-feature commit hashes against feature blueprint files."""
    if not implemented_features:
        return []

    if isinstance(implemented_features, list):
        feature_map: dict[str, Any] = {feat: None for feat in implemented_features}
    elif isinstance(implemented_features, dict):
        feature_map = implemented_features
    else:
        return []

    return [
        _audit_single_feature_commit(
            feat_name, feat_commit, blueprints_root, workspace_root
        )
        for feat_name, feat_commit in feature_map.items()
    ]


def _evaluate_module_commit(
    module_rel_path: str,
    current_commit: Any,
    latest_commit: str | None,
    workspace_root: str,
) -> tuple[str, str, list[str], Any]:
    """Evaluates module blueprint commit synchronization."""
    if not current_commit:
        commits = get_commits_since(module_rel_path, cwd=workspace_root)
        return (
            "🔴 Not Baselined",
            "Missing module_blueprint_commit in codebase.blueprint.md",
            commits,
            "None",
        )
    if current_commit == latest_commit:
        return (
            "🟢 Up to Date",
            "Matches the latest module blueprint version",
            [],
            current_commit,
        )

    commits = get_commits_since(
        module_rel_path, since_commit=current_commit, cwd=workspace_root
    )
    status = "🟡 Out of Date" if commits else "🟢 Up to Date"
    reason = (
        f"Codebase is behind by {len(commits)} commit(s)"
        if commits
        else "No module blueprint changes since pinned commit"
    )
    return status, reason, commits, current_commit


def _audit_single_codebase(
    file_path: str,
    blueprints_root: str,
    workspace_root: str,
) -> dict[str, Any] | None:
    """Audits one codebase blueprint file against its module and feature blueprints."""
    rel_path = os.path.relpath(file_path, blueprints_root)
    data, err = parse_frontmatter(file_path)
    if err or data is None:
        print(
            f"Error parsing {rel_path}: {err or 'No data returned'}",
            file=sys.stderr,
        )
        return None

    associated_module = data.get("associated_module")
    if not associated_module:
        print(f"Skipping {rel_path}: missing associated_module", file=sys.stderr)
        return None

    codebase_path = data.get("codebase_path") or "unknown"
    current_commit = data.get("module_blueprint_commit")
    implemented_features = data.get("implemented_features")
    module_file = os.path.join(
        blueprints_root, "modules", f"{associated_module}.blueprint.md"
    )
    module_rel_path = os.path.relpath(module_file, workspace_root)

    if not os.path.exists(module_file):
        return {
            "codebase": rel_path,
            "codebase_path": codebase_path,
            "module": associated_module,
            "status": "🔴 Error",
            "reason": f"Module blueprint {associated_module} does not exist",
            "commits_behind": [],
            "current_commit": current_commit,
            "latest_commit": "unknown",
            "features": [],
        }

    latest_commit = get_latest_commit(module_rel_path, cwd=workspace_root)
    feature_audits = audit_feature_commits(
        implemented_features, blueprints_root, workspace_root
    )
    status, reason, commits, current_val = _evaluate_module_commit(
        module_rel_path, current_commit, latest_commit, workspace_root
    )

    non_compliant_features = [f for f in feature_audits if f["status"] != "UP-TO-DATE"]
    if status == "🟢 Up to Date" and non_compliant_features:
        status = "🟡 Out of Date"
        feat_reasons = ", ".join(
            f"{f['feature']}: {f['status']}" for f in non_compliant_features
        )
        reason = f"Feature blueprint(s) out of sync ({feat_reasons})"

    return {
        "codebase": rel_path,
        "codebase_path": codebase_path,
        "module": associated_module,
        "status": status,
        "reason": reason,
        "commits_behind": commits,
        "current_commit": current_val,
        "latest_commit": latest_commit,
        "features": feature_audits,
    }


def _short_sha(val: Any, fallback: str) -> str:
    """Formats a commit hash as an 8-character prefix or fallback."""
    if isinstance(val, str) and val not in ("None", "unknown"):
        return val[:8]
    return fallback


def _append_codebase_details(report: list[str], item: dict[str, Any]) -> None:
    """Appends detailed module and feature compliance findings for a codebase."""
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

    for feat in item.get("features", []):
        if feat["status"] == "UP-TO-DATE":
            continue
        report.append(
            f"#### Feature `{feat['feature']}`: {feat['status']}"
            f" (pinned: `{feat['current_commit']}`, latest: `{feat['latest_commit']}`)"
        )
        if feat["commits_behind"]:
            report.append("```text")
            for commit in feat["commits_behind"]:
                report.append(f"  {commit}")
            report.append("```")
        report.append("")


def build_report(compliance_data: list[dict[str, Any]]) -> str:
    """Builds the Markdown compliance report from audited codebase items."""
    date_str = datetime.now().strftime("%Y-%m-%d")
    report = [
        f"# Spec-Driven Development Blueprint Compliance Report ({date_str})",
        "",
        (
            "This report tracks the synchronization status of each platform codebase"
            " against the language-agnostic module and feature blueprints."
        ),
        "",
        "## Summary Status",
        "",
        (
            "| Codebase Implementation | Associated Module | Status | Commits Behind |"
            " Current Commit | Latest Commit |"
        ),
        "|---|---|---|---|---|---|",
    ]

    for item in compliance_data:
        current_short = _short_sha(item["current_commit"], "None")
        latest_short = _short_sha(item["latest_commit"], "unknown")
        commits_behind_str = (
            "All"
            if "Not Baselined" in item["status"]
            else str(len(item["commits_behind"]))
        )
        report.append(
            f"| `{item['codebase_path']}` | `{item['module']}` | {item['status']} |"
            f" {commits_behind_str} | `{current_short}` | `{latest_short}` |"
        )

    report.extend(["", "## Details by Codebase", ""])
    out_of_date = [
        item for item in compliance_data if item["status"] != "🟢 Up to Date"
    ]
    if not out_of_date:
        report.append("🎉 All codebases are currently fully compliant and baselined!")
        report.append("")
    else:
        for item in out_of_date:
            _append_codebase_details(report, item)

    report.extend([
        "---",
        "*Generated automatically by the Weekly Blueprint Compliance Auditor.*",
    ])
    return "\n".join(report)


def main() -> None:
    """Discovers all codebase blueprints and audits their compliance."""
    script_dir = os.path.dirname(os.path.realpath(__file__))
    blueprints_root = os.path.abspath(os.path.join(script_dir, "..", "..", ".."))
    workspace_root = os.path.abspath(os.path.join(blueprints_root, ".."))

    codebases_pattern = os.path.join(
        blueprints_root, "codebases", "**", "codebase.blueprint.md"
    )
    codebase_files = glob.glob(codebases_pattern, recursive=True)

    compliance_data: list[dict[str, Any]] = []
    for file_path in sorted(codebase_files):
        item = _audit_single_codebase(file_path, blueprints_root, workspace_root)
        if item is not None:
            compliance_data.append(item)

    print(build_report(compliance_data))


if __name__ == "__main__":
    main()
