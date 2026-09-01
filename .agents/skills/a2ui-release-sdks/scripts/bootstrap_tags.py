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
Bootstrap initial Git tags for all A2UI monorepo packages.

Tag format:
  JavaScript/TypeScript: javascript/<short_name>/v<version>
  Python:                python/<short_name>/v<version>
"""

import sys
import subprocess
from pathlib import Path

# Add script directory to sys.path to import check_status
SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from check_status import PACKAGES, get_local_version, WORKSPACE_ROOT

SHORT_NAME_MAP = {
    "agent_sdks/python/a2ui_core": "a2ui_core",
    "agent_sdks/python/a2ui_agent": "a2ui_agent",
    "renderers/web_core": "web_core",
    "renderers/lit": "lit",
    "renderers/angular": "angular",
    "renderers/react": "react",
    "renderers/markdown/markdown-it": "markdown-it",
}


def get_tag_name_for_package(pkg):
    rel_path = str(pkg["dir"].relative_to(WORKSPACE_ROOT))
    short_name = SHORT_NAME_MAP.get(rel_path, pkg["dir"].name)
    version = get_local_version(pkg)
    eco = "javascript" if pkg["type"] == "typescript" else "python"
    return f"{eco}/{short_name}/v{version}"


def main():
    push_tags = "--push" in sys.argv
    force = "--force" in sys.argv or "-f" in sys.argv

    print("==================================================================")
    print("             A2UI Package Tag Bootstrapper                        ")
    print("==================================================================")

    created_tags = []
    for pkg in PACKAGES:
        tag_name = get_tag_name_for_package(pkg)
        rel_path = pkg["dir"].relative_to(WORKSPACE_ROOT)

        cmd = ["git", "tag"]
        if force:
            cmd.append("-f")
        cmd.extend([tag_name, "HEAD"])

        res = subprocess.run(cmd, capture_output=True, text=True, cwd=WORKSPACE_ROOT)
        if res.returncode == 0:
            print(f"✅ Tagged {pkg['name']} ({rel_path}) -> {tag_name}")
            created_tags.append(tag_name)
        else:
            err = res.stderr.strip()
            print(f"⚠️  Tag {tag_name} ({rel_path}) -> {err}")

    if push_tags and created_tags:
        print("\nPushing tags to origin...")
        subprocess.run(["git", "push", "origin"] + created_tags, check=True, cwd=WORKSPACE_ROOT)
        print("✅ Tags successfully pushed to origin.")
    elif created_tags:
        print("\nRun `git push origin --tags` to push created tags upstream.")

    print("==================================================================")


if __name__ == "__main__":
    main()
