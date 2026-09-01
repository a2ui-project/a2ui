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

"""
Automated Release PR Creator for A2UI Monorepo.

Algorithm:
 1. Scans CHANGELOG.md for packages with unreleased entries.
 2. Audits git log since the previous release tag for each package.
 3. Computes strict SemVer version bump (MINOR vs PATCH vs MAJOR).
 4. Bumps version in package.json / version.py and renames CHANGELOG ## Unreleased section.
 5. Runs `yarn install` to update lockfiles.
 6. Opens/updates GitHub PR with Commit Audit Table in description.
"""

import os
import re
import sys
import json
import subprocess
from pathlib import Path

# Add script directory to sys.path
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from check_status import (
    PACKAGES,
    WORKSPACE_ROOT,
    get_local_version,
    get_unreleased_changelog_entries,
    evaluate_semver_bump,
    get_latest_git_tag,
    get_tag_name_for_package,
)


def compute_next_version(current_v, bump_type):
    parts = [int(p) for p in re.split(r"[.-]", current_v)[:3]]
    major, minor, patch = parts[0], parts[1], parts[2]

    if major == 0:  # Pre-1.0 SemVer rules
        if bump_type in ("MAJOR_OR_MINOR", "MINOR"):
            return f"0.{minor + 1}.0"
        else:
            return f"0.{minor}.{patch + 1}"
    else:  # Post-1.0 SemVer rules
        if bump_type == "MAJOR_OR_MINOR":
            return f"{major + 1}.0.0"
        elif bump_type == "MINOR":
            return f"{major}.{minor + 1}.0"
        else:
            return f"{major}.{minor}.{patch + 1}"


def update_package_version(pkg, new_version):
    rel_p = pkg["dir"].relative_to(WORKSPACE_ROOT)
    if pkg["type"] == "typescript":
        pkg_json = pkg["dir"] / "package.json"
        content = pkg_json.read_text(encoding="utf-8")
        updated = re.sub(r'("version"\s*:\s*")([^"]+)(")', f"\\g<1>{new_version}\\g<3>", content, count=1)
        pkg_json.write_text(updated, encoding="utf-8")
    else:
        vfile = pkg["dir"] / "version.py"
        if vfile.exists():
            content = vfile.read_text(encoding="utf-8")
            updated = re.sub(r'(__version__\s*=\s*")([^"]+)(")', f"\\g<1>{new_version}\\g<3>", content, count=1)
            vfile.write_text(updated, encoding="utf-8")


def update_changelog_header(pkg, new_version):
    cl = pkg["changelog"]
    if not cl.exists():
        return
    content = cl.read_text(encoding="utf-8")
    # Replace the top ## Unreleased header with ## Unreleased\n\n## <new_version>
    pattern = r"## Unreleased"
    replacement = f"## Unreleased\n\n## {new_version}"
    updated = re.sub(pattern, replacement, content, count=1)
    cl.write_text(updated, encoding="utf-8")


def get_git_commits_since_tag(pkg, baseline_tag):
    rel_path = str(pkg["dir"].relative_to(WORKSPACE_ROOT))
    cmd = ["git", "log", "--oneline", f"{baseline_tag}..HEAD", "--", rel_path]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, cwd=WORKSPACE_ROOT)
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip().splitlines()
    except Exception:
        pass
    return []


def main():
    dry_run = "--dry-run" in sys.argv

    print("==================================================================")
    print("             A2UI Automated Release PR Creator                    ")
    print("==================================================================")
    if dry_run:
        print("⚠️  DRY RUN MODE ENABLED (No Git branches or PRs will be created)\n")

    packages_to_release = []

    for pkg in PACKAGES:
        entries = get_unreleased_changelog_entries(pkg)
        if not entries:
            continue

        local_v = get_local_version(pkg)
        bump_type = evaluate_semver_bump(entries)
        next_v = compute_next_version(local_v, bump_type)
        baseline_tag = get_latest_git_tag(pkg) or get_tag_name_for_package(pkg)
        commits = get_git_commits_since_tag(pkg, baseline_tag)

        packages_to_release.append({
            "pkg": pkg,
            "current_version": local_v,
            "next_version": next_v,
            "bump_type": bump_type,
            "entries": entries,
            "baseline_tag": baseline_tag,
            "commits": commits,
        })

    if not packages_to_release:
        print("✅ No unreleased changes found across any package. No release PR needed.")
        sys.exit(0)

    print(f"📦 Found {len(packages_to_release)} packages with unreleased changes:\n")

    pr_body_lines = [
        "### 📦 Automated Release PR: Prepare Package Version Bumps",
        "",
        "Please cross-reference the **Commits Since Last Release** below against the human-authored notes in each package's `CHANGELOG.md`. If any significant notes are missing, edit `CHANGELOG.md` directly on this branch before merging.",
        "",
        "---",
        "",
        "### Package Release Details & Commit Audit",
        "",
    ]

    for item in packages_to_release:
        pkg = item["pkg"]
        rel_p = pkg["dir"].relative_to(WORKSPACE_ROOT)
        print(f"  • {pkg['name']} ({rel_p}): {item['current_version']} -> {item['next_version']} ({item['bump_type']} bump)")

        pr_body_lines.append(f"#### 📦 `{pkg['name']}` (`{rel_p}`)")
        pr_body_lines.append(f"- **Proposed Version**: `{item['current_version']}` -> `{item['next_version']}` ({item['bump_type']} bump)")
        pr_body_lines.append("- **Human Release Notes in `CHANGELOG.md`**:")
        for e in item["entries"]:
            pr_body_lines.append(f"  {e}")
        pr_body_lines.append(f"- **Commits Since Last Release (`{item['baseline_tag']}`..HEAD)**:")
        if item["commits"]:
            for c in item["commits"]:
                pr_body_lines.append(f"  - `{c}`")
        else:
            pr_body_lines.append("  - *(No commits detected in package folder since baseline tag)*")
        pr_body_lines.append("")

    if dry_run:
        print("\n--- GENERATED PR BODY (DRY-RUN) ---")
        print("\n".join(pr_body_lines[:30]))
        print("... (truncated)")
        print("==================================================================")
        sys.exit(0)

    # Perform actual file mutations
    print("\nUpdating version strings and changelogs...")
    for item in packages_to_release:
        update_package_version(item["pkg"], item["next_version"])
        update_changelog_header(item["pkg"], item["next_version"])

    # Update lockfiles
    print("Running yarn install to update lockfiles...")
    subprocess.run(["yarn", "install"], check=True, cwd=WORKSPACE_ROOT)

    # Git operations
    branch_name = "release/sdks-weekly"
    print(f"Creating git branch {branch_name}...")
    subprocess.run(["git", "checkout", "-B", branch_name], check=True, cwd=WORKSPACE_ROOT)
    subprocess.run(["git", "add", "-u"], check=True, cwd=WORKSPACE_ROOT)
    subprocess.run(
        ["git", "commit", "-m", "release: prepare package releases"],
        check=True,
        cwd=WORKSPACE_ROOT,
    )
    subprocess.run(["git", "push", "-f", "origin", branch_name], check=True, cwd=WORKSPACE_ROOT)

    # Create PR via gh CLI
    pr_body_text = "\n".join(pr_body_lines)
    gh_token = os.environ.get("A2UI_UPSTREAM_TOKEN") or os.environ.get("GH_TOKEN")
    env = dict(os.environ)
    if gh_token:
        env["GH_TOKEN"] = gh_token

    print("Opening GitHub Release PR...")
    cmd = [
        "gh", "pr", "create",
        "-R", "a2ui-project/a2ui",
        "--base", "main",
        "--head", f"jacobsimionato:{branch_name}",
        "--title", "release: prepare SDK package releases",
        "--body", pr_body_text,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, cwd=WORKSPACE_ROOT, env=env)
    if res.returncode == 0:
        print(f"✅ Release PR created: {res.stdout.strip()}")
    else:
        print(f"⚠️  PR Creation message: {res.stderr.strip() or res.stdout.strip()}")

    print("==================================================================")


if __name__ == "__main__":
    main()
