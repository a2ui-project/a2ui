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


def get_registry_version(pkg):
    try:
        if pkg["type"] == "python":
            url = f"https://pypi.org/pypi/{pkg['registry_name']}/json"
            req = urllib.request.Request(url, headers={"User-Agent": "A2UI-Release-Checker/1.0"})
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read().decode())
                return data["info"]["version"]
        else:  # typescript npm
            res = subprocess.run(
                ["npm", "view", pkg["registry_name"], "version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if res.returncode == 0 and res.stdout.strip():
                return res.stdout.strip()
    except Exception:
        pass
    return None


def get_unreleased_changelog_entries(pkg):
    cl = pkg["changelog"]
    if not cl.exists():
        return []

    content = cl.read_text(encoding="utf-8")
    unreleased_match = re.search(r"## Unreleased\s*\n(.*?)(?=\n## |\Z)", content, re.DOTALL)
    if not unreleased_match:
        return []

    lines = [
        line.strip()
        for line in unreleased_match.group(1).splitlines()
        if line.strip().startswith("-") or line.strip().startswith("*")
    ]
    return lines


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


def main():
    print("==================================================================")
    print("             A2UI Package Release Status Checker                  ")
    print("==================================================================")

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
            # Check git log for unreleased commits
            rel_path = pkg["dir"].relative_to(WORKSPACE_ROOT)
            res = subprocess.run(
                ["git", "log", "-n", "5", "--oneline", "--", str(rel_path)],
                capture_output=True,
                text=True,
                cwd=WORKSPACE_ROOT,
            )
            commits = [line for line in res.stdout.splitlines() if line.strip()]
            if commits and registry_v and local_v == registry_v:
                # Commits exist but no changelog entries
                state = "STATE_UNRELEASED_CHANGES_EXIST"
                action = f"Update CHANGELOG.md from {len(commits)} recent commits and create version bump PR"
            else:
                state = "STATE_IDLE"
                action = "No release action needed"

        print(f"\n📦 Package: {pkg['name']}")
        print(f"   Directory:       {pkg['dir'].relative_to(WORKSPACE_ROOT)}")
        print(f"   State:           \033[1m{state}\033[0m")
        print(f"   Local Version:   {local_v}")
        print(f"   Registry Version:{registry_v if registry_v else 'Not Found / Unpublished'}")
        print(f"   Unreleased Entries: {len(unreleased_entries)}")
        print(f"   Action:          {action}")

    print("\n==================================================================")


if __name__ == "__main__":
    main()
