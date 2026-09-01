#!/usr/bin/env python3
"""
Release State Inspection Script for A2UI Packages.

Evaluates each Python and TypeScript package independently and reports its active release state:
- STATE_IDLE
- STATE_UNRELEASED_CHANGES_EXIST
- STATE_RELEASE_PR_PENDING
- STATE_MAIN_READY_FOR_PUBLISHING
"""

import json
import os
import re
import subprocess
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
        # Check version.py if pyproject.toml uses dynamic versioning
        vpy = pkg["dir"] / "src/a2ui/version.py"
        if not vpy.exists():
            vpy = pkg["dir"] / "src/a2ui/core/version.py"
        if vpy.exists():
            vcontent = vpy.read_text(encoding="utf-8")
            vmatch = re.search(r'__version__\s*=\s*"([^"]+)"', vcontent)
            if vmatch:
                return vmatch.group(1)
        return "unknown"


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
                return data.get("version")
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
                # Reached next section header (e.g. ## 0.1.1)
                break
        if in_unreleased:
            if stripped.startswith("-") or stripped.startswith("*"):
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


def main():
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

        if registry_v and local_tuple > reg_tuple:
            state = "STATE_MAIN_READY_FOR_PUBLISHING"
            rel_p = pkg["dir"].relative_to(WORKSPACE_ROOT)
            script_path = "./renderers/release.sh" if pkg["type"] == "typescript" else "./agent_sdks/python/release.sh"
            action = f"Run release script: {script_path} {rel_p}"
        elif open_pr_url:
            state = "STATE_RELEASE_PR_PENDING"
            action = f"Wait for maintainer review on PR: {open_pr_url}"
        elif len(unreleased_entries) > 0:
            state = "STATE_UNRELEASED_CHANGES_EXIST"
            action = "Create version bump PR"
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


if __name__ == "__main__":
    main()
