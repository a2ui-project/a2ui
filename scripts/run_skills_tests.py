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

import os
import sys
import subprocess


def main():
    # The root of the repository is the parent of the scripts directory
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    skills_dir = os.path.join(repo_root, ".agents", "skills")

    if not os.path.exists(skills_dir):
        print(f"Error: Skills directory not found at {skills_dir}")
        sys.exit(1)

    skills = []
    # Find all subdirectories in .agents/skills/
    for item in sorted(os.listdir(skills_dir)):
        item_path = os.path.join(skills_dir, item)
        if os.path.isdir(item_path):
            # Find all directories under item_path that contain .py files
            py_dirs = []
            for root, dirs, files in os.walk(item_path):
                if any(f.endswith(".py") for f in files):
                    py_dirs.append(root)
            if py_dirs:
                skills.append((item, py_dirs))

    if not skills:
        print("No skills with python files found.")
        sys.exit(0)

    print(f"Found {len(skills)} skill(s) with python files:")
    for name, paths in skills:
        rel_paths = [os.path.relpath(p, repo_root) for p in paths]
        print(f"  - {name} ({', '.join(rel_paths)})")
    print("=" * 80)

    failed_skills = []
    passed_skills = []
    no_tests_skills = []

    for name, paths in skills:
        print(f"\nRunning tests for skill: {name}")
        print("-" * 80)

        skill_failed = False
        skill_has_tests = False

        for path in paths:
            # Run unittest discovery in the directory.
            # Run as a separate subprocess to ensure clean process isolation.
            cmd = [sys.executable, "-m", "unittest", "discover", "-s", path]
            result = subprocess.run(cmd, cwd=repo_root)

            if result.returncode == 0:
                skill_has_tests = True
            elif result.returncode == 5:
                # No tests found in this directory
                continue
            else:
                skill_failed = True
                skill_has_tests = True

        if skill_failed:
            failed_skills.append(name)
            print(f"Result: FAILED")
        elif skill_has_tests:
            passed_skills.append(name)
            print(f"Result: SUCCESS")
        else:
            no_tests_skills.append(name)
            print(f"Result: NO TESTS FOUND")
        print("-" * 80)

    print("\n" + "=" * 80)
    print("Test Summary:")
    print("=" * 80)
    total_tested = len(passed_skills) + len(failed_skills)
    print(f"Total skills with tests: {total_tested}")
    print(
        f"Passed: {len(passed_skills)}"
        f" ({', '.join(passed_skills) if passed_skills else 'None'})"
    )
    if failed_skills:
        print(f"Failed: {len(failed_skills)} ({', '.join(failed_skills)})")
        sys.exit(1)
    else:
        print("All skill tests completed successfully.")
        sys.exit(0)


if __name__ == "__main__":
    main()
