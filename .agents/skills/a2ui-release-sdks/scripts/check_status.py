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
A2UI Package Release Status & PR Creator Tool.

Evaluates each Python and TypeScript package independently and reports its active release state:
 - STATE_IDLE
 - STATE_UNRELEASED_CHANGES_EXIST
 - STATE_RELEASE_PR_PENDING
 - STATE_MAIN_READY_FOR_PUBLISHING

Usage:
  ./check_status.py                 # Prints release status report
  ./check_status.py --create-pr     # Generates Version Bump PR for packages with unreleased changes
  ./check_status.py --create-pr --dry-run  # Dry-run PR creation
"""

import json
import os
import re
import sys
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

# Find workspace root by looking for AGENTS.md or package.json
SCRIPT_DIR = Path(__file__).resolve().parent
curr = SCRIPT_DIR
while curr != curr.parent:
    if (curr / "AGENTS.md").exists() or (curr / "package.json").exists():
        WORKSPACE_ROOT = curr
        break
    curr = curr.parent
else:
    WORKSPACE_ROOT = SCRIPT_DIR.parents[3]

PACKAGES = [
    {
        "name": "a2ui-core",
        "type": "python",
        "dir": WORKSPACE_ROOT / "agent_sdks/python/a2ui_core",
        "changelog": WORKSPACE_ROOT / "agent_sdks/python/a2ui_core/CHANGELOG.md",
        "version_file": WORKSPACE_ROOT / "agent_sdks/python/a2ui_core/pyproject.toml",
        "registry_name": "a2ui-core",
    },
    {
        "name": "a2ui-agent-sdk",
        "type": "python",
        "dir": WORKSPACE_ROOT / "agent_sdks/python/a2ui_agent",
        "changelog": WORKSPACE_ROOT / "agent_sdks/python/a2ui_agent/CHANGELOG.md",
        "version_file": WORKSPACE_ROOT / "agent_sdks/python/a2ui_agent/pyproject.toml",
        "registry_name": "a2ui-agent-sdk",
    },
    {
        "name": "@a2ui/web_core",
        "type": "typescript",
        "dir": WORKSPACE_ROOT / "renderers/web_core",
        "changelog": WORKSPACE_ROOT / "renderers/web_core/CHANGELOG.md",
        "version_file": WORKSPACE_ROOT / "renderers/web_core/package.json",
        "registry_name": "@a2ui/web_core",
        "short_name": "web_core",
    },
    {
        "name": "@a2ui/lit",
        "type": "typescript",
        "dir": WORKSPACE_ROOT / "renderers/lit",
        "changelog": WORKSPACE_ROOT / "renderers/lit/CHANGELOG.md",
        "version_file": WORKSPACE_ROOT / "renderers/lit/package.json",
        "registry_name": "@a2ui/lit",
        "short_name": "lit",
    },
    {
        "name": "@a2ui/angular",
        "type": "typescript",
        "dir": WORKSPACE_ROOT / "renderers/angular",
        "changelog": WORKSPACE_ROOT / "renderers/angular/CHANGELOG.md",
        "version_file": WORKSPACE_ROOT / "renderers/angular/package.json",
        "registry_name": "@a2ui/angular",
        "short_name": "angular",
    },
    {
        "name": "@a2ui/react",
        "type": "typescript",
        "dir": WORKSPACE_ROOT / "renderers/react",
        "changelog": WORKSPACE_ROOT / "renderers/react/CHANGELOG.md",
        "version_file": WORKSPACE_ROOT / "renderers/react/package.json",
        "registry_name": "@a2ui/react",
        "short_name": "react",
    },
    {
        "name": "@a2ui/markdown-it",
        "type": "typescript",
        "dir": WORKSPACE_ROOT / "renderers/markdown/markdown-it",
        "changelog": WORKSPACE_ROOT / "renderers/markdown/markdown-it/CHANGELOG.md",
        "version_file": WORKSPACE_ROOT / "renderers/markdown/markdown-it/package.json",
        "registry_name": "@a2ui/markdown-it",
        "short_name": "markdown-it",
    },
]

SHORT_NAME_MAP = {
    "agent_sdks/python/a2ui_core": "a2ui_core",
    "agent_sdks/python/a2ui_agent": "a2ui_agent",
    "renderers/web_core": "web_core",
    "renderers/lit": "lit",
    "renderers/angular": "angular",
    "renderers/react": "react",
    "renderers/markdown/markdown-it": "markdown-it",
}


def get_short_name(pkg):
    rel_path = str(pkg["dir"].relative_to(WORKSPACE_ROOT))
    return SHORT_NAME_MAP.get(rel_path, pkg["dir"].name)


def get_local_version(pkg):
    vf = pkg["version_file"]
    if not vf.exists():
        return "unknown"

    if pkg["type"] == "typescript":
        with open(vf, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("version", "unknown")
    else:  # python
        content = vf.read_text(encoding="utf-8")
        match = re.search(r'version\s*=\s*"([^"]+)"', content)
        if match:
            return match.group(1)
        for vpath in ["src/a2ui/version.py", "src/a2ui/core/version.py"]:
            vpy = pkg["dir"] / vpath
            if vpy.exists():
                vcontent = vpy.read_text(encoding="utf-8")
                vmatch = re.search(r'__version__\s*=\s*"([^"]+)"', vcontent)
                if vmatch:
                    return vmatch.group(1)
        return "unknown"


def get_tag_name_for_package(pkg, version=None):
    if version is None:
        version = get_local_version(pkg)
    short_name = get_short_name(pkg)
    eco = "javascript" if pkg["type"] == "typescript" else "python"
    return f"{eco}/{short_name}/v{version}"


def get_latest_git_tag(pkg):
    short_name = get_short_name(pkg)
    eco = "javascript" if pkg["type"] == "typescript" else "python"
    pattern = f"{eco}/{short_name}/v*"
    try:
        res = subprocess.run(
            ["git", "tag", "-l", pattern, "--sort=-v:refname"],
            capture_output=True,
            text=True,
            cwd=WORKSPACE_ROOT,
        )
        if res.returncode == 0 and res.stdout.strip():
            tags = res.stdout.strip().splitlines()
            return tags[0]
    except Exception:
        pass
    return None


def get_latest_changelog_version(pkg):
    cl = pkg["changelog"]
    if not cl.exists():
        return None
    content = cl.read_text(encoding="utf-8")
    matches = re.findall(r"## (\d+\.\d+\.\d+)", content)
    if matches:
        return matches[0]
    return None


def get_registry_version(pkg):
    try:
        if pkg["type"] == "python":
            url = f"https://pypi.org/pypi/{pkg['registry_name']}/json"
            req = urllib.request.Request(url, headers={"User-Agent": "A2UI-Release-Checker/1.0"})
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read().decode())
                return data["info"]["version"]
        else:  # typescript npm
            url = f"https://registry.npmjs.org/{pkg['registry_name']}/latest"
            req = urllib.request.Request(url, headers={"User-Agent": "A2UI-Release-Checker/1.0"})
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read().decode())
                return data["version"]
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
    except Exception:
        pass
    return get_latest_changelog_version(pkg)


def evaluate_semver_bump(entries):
    has_breaking = False
    has_feat = False

    for entry in entries:
        line = entry.strip()
        if line.startswith("### "):
            sec = line[4:].strip().lower()
            if "breaking" in sec:
                has_breaking = True
            elif "feature" in sec or "feat" in sec:
                has_feat = True
        else:
            if "BREAKING CHANGE:" in line:
                has_breaking = True
            elif line.startswith("- FEAT:") or line.startswith("* FEAT:") or line.startswith("- feat:") or line.startswith("* feat:"):
                has_feat = True

    if has_breaking:
        return "MAJOR_OR_MINOR"
    elif has_feat:
        return "MINOR"
    return "PATCH"


def parse_semver(v):
    if not v:
        return (0, 0, 0)
    parts = re.split(r"[.-]", v)
    nums = []
    for p in parts:
        if p.isdigit():
            nums.append(int(p))
        else:
            break
    while len(nums) < 3:
        nums.append(0)
    return tuple(nums[:3])


def compute_next_version(current_v, bump_type):
    parts = parse_semver(current_v)
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
    if pkg["type"] == "typescript":
        pkg_json = pkg["dir"] / "package.json"
        content = pkg_json.read_text(encoding="utf-8")
        updated = re.sub(r'("version"\s*:\s*")([^"]+)(")', f"\\g<1>{new_version}\\g<3>", content, count=1)
        pkg_json.write_text(updated, encoding="utf-8")
    else:  # python
        pyproject = pkg["dir"] / "pyproject.toml"
        if pyproject.exists():
            content = pyproject.read_text(encoding="utf-8")
            updated = re.sub(r'(version\s*=\s*")([^"]+)(")', f"\\g<1>{new_version}\\g<3>", content, count=1)
            pyproject.write_text(updated, encoding="utf-8")
        for vpath in ["src/a2ui/version.py", "src/a2ui/core/version.py"]:
            vfile = pkg["dir"] / vpath
            if vfile.exists():
                content = vfile.read_text(encoding="utf-8")
                updated = re.sub(r'(__version__\s*=\s*")([^"]+)(")', f"\\g<1>{new_version}\\g<3>", content, count=1)
                vfile.write_text(updated, encoding="utf-8")


def update_changelog_header(pkg, new_version):
    cl = pkg["changelog"]
    if not cl.exists():
        return
    content = cl.read_text(encoding="utf-8")
    updated = re.sub(r"## Unreleased", f"## Unreleased\n\n## {new_version}", content, count=1)
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


def get_unreleased_changelog_entries(pkg):
    cl = pkg["changelog"]
    if not cl.exists():
        return []

    content = cl.read_text(encoding="utf-8")
    lines = content.splitlines()
    unreleased_lines = []
    in_unreleased = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("## "):
            if stripped.lower() == "## unreleased":
                in_unreleased = True
                continue
            elif in_unreleased:
                break
        if in_unreleased:
            if stripped.startswith("-") or stripped.startswith("*") or stripped.startswith("### "):
                unreleased_lines.append(stripped)

    return unreleased_lines


def check_open_prs_for_pkg(pkg):
    try:
        res = subprocess.run(
            ["gh", "pr", "list", "--search", f"release {pkg['name']}", "--json", "number,title,url"],
            capture_output=True,
            text=True,
            timeout=5,
            cwd=WORKSPACE_ROOT,
        )
        if res.returncode == 0 and res.stdout.strip():
            prs = json.loads(res.stdout.strip())
            if prs:
                return prs[0]["url"]
    except Exception:
        pass
    return None


def check_git_sync():
    warnings = []
    try:
        branch = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            cwd=WORKSPACE_ROOT,
        ).stdout.strip()

        remote_name = "origin"
        remotes = subprocess.run(
            ["git", "remote"],
            capture_output=True,
            text=True,
            cwd=WORKSPACE_ROOT,
        ).stdout.splitlines()
        if "upstream" in remotes:
            remote_name = "upstream"

        main_ref = f"{remote_name}/main"

        subprocess.run(
            ["git", "fetch", remote_name, "main", "--quiet"],
            capture_output=True,
            cwd=WORKSPACE_ROOT,
            timeout=5,
        )

        local_commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            cwd=WORKSPACE_ROOT,
        ).stdout.strip()

        remote_commit = subprocess.run(
            ["git", "rev-parse", main_ref],
            capture_output=True,
            text=True,
            cwd=WORKSPACE_ROOT,
        ).stdout.strip()

        if branch != "main":
            warnings.append(f"Current branch is '{branch}' (not 'main').")

        if local_commit != remote_commit:
            rev_list = subprocess.run(
                ["git", "rev-list", "--left-right", "--count", f"HEAD...{main_ref}"],
                capture_output=True,
                text=True,
                cwd=WORKSPACE_ROOT,
            ).stdout.strip()
            if rev_list:
                ahead, behind = rev_list.split()
                warnings.append(f"Local HEAD is out of sync with {main_ref} (ahead: {ahead}, behind: {behind}).")
            else:
                warnings.append(f"Local HEAD is not synced with {main_ref}.")
    except Exception:
        pass
    return warnings


def create_release_pr(dry_run=False):
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
        return

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
        return

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

    # Create PR via gh CLI (Portable --head branch_name)
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
        "--head", branch_name,
        "--title", "release: prepare SDK package releases",
        "--body", pr_body_text,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, cwd=WORKSPACE_ROOT, env=env)
    if res.returncode == 0:
        print(f"✅ Release PR created: {res.stdout.strip()}")
    else:
        print(f"⚠️  PR Creation message: {res.stderr.strip() or res.stdout.strip()}")

    print("==================================================================")


def print_status_report():
    print("==================================================================")
    print("             A2UI Package Release Status Checker                  ")
    print("==================================================================")

    git_warnings = check_git_sync()
    if git_warnings:
        print("\033[33m⚠️  GIT SYNCHRONIZATION WARNING:\033[0m")
        for w in git_warnings:
            print(f"   • {w}")
        print("   \033[2mPlease ensure your local branch is synced with main for full accuracy.\033[0m\n")

    for pkg in PACKAGES:
        local_v = get_local_version(pkg)
        registry_v = get_registry_version(pkg)
        unreleased_entries = get_unreleased_changelog_entries(pkg)
        open_pr_url = check_open_prs_for_pkg(pkg)

        local_tuple = parse_semver(local_v)
        reg_tuple = parse_semver(registry_v) if registry_v else (0, 0, 0)

        if local_tuple > reg_tuple:
            state = "STATE_MAIN_READY_FOR_PUBLISHING"
            rel_p = pkg["dir"].relative_to(WORKSPACE_ROOT)
            script_path = "./renderers/release.sh" if pkg["type"] == "typescript" else "./agent_sdks/python/release.sh"
            action = f"Run release script: {script_path} {rel_p}"
        elif open_pr_url:
            state = "STATE_RELEASE_PR_PENDING"
            action = f"Wait for maintainer review on PR: {open_pr_url}"
        elif len(unreleased_entries) > 0:
            state = "STATE_UNRELEASED_CHANGES_EXIST"
            action = "Create version bump PR via `./check_status.py --create-pr`"
        else:
            state = "STATE_IDLE"
            action = "No release action needed"

        print(f"\n📦 Package: {pkg['name']}")
        print(f"   Directory:       {pkg['dir'].relative_to(WORKSPACE_ROOT)}")
        print(f"   State:           \033[1m{state}\033[0m")
        print(f"   Local Version:   {local_v}")
        print(f"   Registry Version:{registry_v if registry_v else 'Not Found / Unpublished'}")
        print(f"   Unreleased Entries: {len(unreleased_entries)}")
        if unreleased_entries:
            print("   Unreleased Changes:")
            for entry in unreleased_entries:
                clean_entry = re.sub(r"^[-*]\s*", "", entry)
                print(f"     • {clean_entry}")
        print(f"   Action:          {action}")

    print("\n==================================================================")


def main():
    if "--create-pr" in sys.argv:
        dry_run = "--dry-run" in sys.argv
        create_release_pr(dry_run=dry_run)
    else:
        print_status_report()


if __name__ == "__main__":
    main()
