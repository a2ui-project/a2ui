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

"""Tests the changed-file scoping in fix_format.sh.

These exercise `fix_format.sh --plan`, which resolves the changed set and
reports which formatters would run without invoking any of them. That keeps the
suite runnable on machines that have no Dart, Swift, or Kotlin toolchain.
"""

import os
import re
import shutil
import subprocess
import tempfile
import unittest
from typing import Dict, Optional

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FIX_FORMAT = os.path.join(SCRIPT_DIR, "fix_format.sh")

# Any build file mentioning ktfmt marks its directory as a formattable module.
KTFMT_BUILD_FILE = 'plugins { id("com.ncorti.ktfmt.gradle") }\n'


class FixFormatScopingTest(unittest.TestCase):

    def setUp(self):
        self.repo = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.repo, "scripts"))
        shutil.copy(FIX_FORMAT, os.path.join(self.repo, "scripts", "fix_format.sh"))
        self._git("init", "-b", "main")
        self._git("config", "user.email", "test@example.com")
        self._git("config", "user.name", "Test")
        # A baseline commit so that `main` exists as a diff target.
        self.write("README.md", "# baseline\n")
        self._git("add", "-A")
        self._git("commit", "-m", "baseline")

    def tearDown(self):
        shutil.rmtree(self.repo, ignore_errors=True)

    # -- helpers ------------------------------------------------------------

    def _git(self, *args: str) -> str:
        return subprocess.run(
            ["git", *args],
            cwd=self.repo,
            check=True,
            capture_output=True,
            text=True,
        ).stdout

    def write(self, rel_path: str, content: str = "x\n") -> None:
        full = os.path.join(self.repo, rel_path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as handle:
            handle.write(content)

    def plan(self, base: Optional[str] = "main") -> Dict[str, str]:
        """Runs `--plan` and parses the reported per-formatter workload."""
        cmd = [os.path.join(self.repo, "scripts", "fix_format.sh"), "--plan"]
        if base is not None:
            cmd += ["--base", base]
        result = subprocess.run(
            cmd, cwd=self.repo, check=True, capture_output=True, text=True
        )
        plan = {}
        for line in result.stdout.splitlines():
            match = re.match(r"^(mode|prettier|pyink|dart|swift|ktfmt):\s*(.+)$", line)
            if match:
                plan[match.group(1)] = match.group(2).strip()
        return plan

    def counts(self, base: Optional[str] = "main") -> Dict[str, int]:
        """Same as plan(), reduced to integer counts per formatter."""
        plan = self.plan(base)
        return {
            key: int(re.match(r"^(\d+)", value).group(1))
            for key, value in plan.items()
            if key != "mode"
        }

    # -- tests --------------------------------------------------------------

    def test_no_flags_plans_whole_repo(self):
        plan = self.plan(base=None)
        self.assertEqual(plan["mode"], "all")
        for formatter in ("prettier", "pyink", "dart", "swift", "ktfmt"):
            self.assertEqual(plan[formatter], "all")

    def test_clean_tree_schedules_nothing(self):
        self.assertEqual(
            self.counts(),
            {"prettier": 0, "pyink": 0, "dart": 0, "swift": 0, "ktfmt": 0},
        )

    def test_swift_only_change_skips_other_formatters(self):
        """The scenario from the issue: a Swift PR must not run dart format."""
        self.write("swift/Sources/A2UI/Surface.swift", "let a = 1\n")
        counts = self.counts()
        self.assertEqual(counts["swift"], 1)
        self.assertEqual(counts["dart"], 0)
        self.assertEqual(counts["pyink"], 0)
        self.assertEqual(counts["ktfmt"], 0)
        # Also zero, so CI can skip installing Node for this PR.
        self.assertEqual(counts["prettier"], 0)

    def test_files_prettier_cannot_parse_do_not_schedule_it(self):
        self.write("scripts/helper.sh", "echo hi\n")
        self.write("docs/diagram.png", "notreallyapng\n")
        self.assertEqual(self.counts()["prettier"], 0)

    def test_prettier_covers_markdown_yaml_and_json(self):
        self.write("docs/public/guide.md", "# hi\n")
        self.write(".github/workflows/thing.yaml", "on: push\n")
        self.write("renderers/web_core/tsconfig.json", "{}\n")
        self.assertEqual(self.counts()["prettier"], 3)

    def test_root_package_swift_is_in_scope(self):
        self.write("Package.swift", "// swift-tools-version:5.9\n")
        self.assertEqual(self.counts()["swift"], 1)

    def test_typescript_change_only_runs_prettier(self):
        self.write("renderers/web_core/src/index.ts", "export const a = 1;\n")
        counts = self.counts()
        self.assertEqual(counts["prettier"], 1)
        self.assertEqual(counts["pyink"], 0)
        self.assertEqual(counts["dart"], 0)
        self.assertEqual(counts["swift"], 0)
        self.assertEqual(counts["ktfmt"], 0)

    def test_python_change_is_picked_up(self):
        self.write("agent_sdks/python/a2ui_agent/src/a2ui/thing.py", "x = 1\n")
        self.assertEqual(self.counts()["pyink"], 1)

    def test_generated_python_is_excluded(self):
        """pyproject's extend-exclude does not apply to explicit file args."""
        self.write("agent_sdks/python/generated/models.py", "x = 1\n")
        self.assertEqual(self.counts()["pyink"], 0)

    def test_dart_outside_formatted_roots_is_ignored(self):
        """Whole-repo mode only formats two Dart roots; --changed must match."""
        self.write("tools/scratch/thing.dart", "void main() {}\n")
        self.assertEqual(self.counts()["dart"], 0)

    def test_dart_inside_formatted_roots_is_scheduled(self):
        self.write("renderers/flutter/lib/a2ui.dart", "void main() {}\n")
        self.write("samples/client/flutter/lib/main.dart", "void main() {}\n")
        self.assertEqual(self.counts()["dart"], 2)

    def test_kotlin_maps_to_owning_gradle_module(self):
        self.write("kotlin/agent_sdk/build.gradle.kts", KTFMT_BUILD_FILE)
        self.write("kotlin/agent_sdk/src/main/kotlin/Agent.kt", "val a = 1\n")
        self.write("kotlin/agent_sdk/src/main/kotlin/Other.kt", "val b = 2\n")
        # Two files, one owning module.
        self.assertEqual(self.counts()["ktfmt"], 1)

    def test_kotlin_module_without_ktfmt_is_skipped(self):
        self.write("kotlin/no_fmt/build.gradle.kts", "plugins { java }\n")
        self.write("kotlin/no_fmt/src/main/kotlin/Thing.kt", "val a = 1\n")
        self.assertEqual(self.counts()["ktfmt"], 0)

    def test_separate_kotlin_modules_are_counted_separately(self):
        for module in ("kotlin/one", "kotlin/two"):
            self.write(f"{module}/build.gradle.kts", KTFMT_BUILD_FILE)
            self.write(f"{module}/src/main/kotlin/Thing.kt", "val a = 1\n")
        self.assertEqual(self.counts()["ktfmt"], 2)

    def test_staged_changes_are_included(self):
        """Diffing a commit against the working tree already covers the index."""
        self.write("swift/Sources/A2UI/Staged.swift", "let a = 1\n")
        self._git("add", "swift/Sources/A2UI/Staged.swift")
        self.assertEqual(self.counts()["swift"], 1)

    def test_untracked_files_are_included(self):
        self.write("renderers/flutter/lib/new_file.dart", "void main() {}\n")
        # Deliberately not staged or committed.
        self.assertEqual(self.counts()["dart"], 1)

    def test_deleted_files_are_not_scheduled(self):
        self.write("renderers/flutter/lib/gone.dart", "void main() {}\n")
        self._git("add", "-A")
        self._git("commit", "-m", "add dart file")
        os.remove(os.path.join(self.repo, "renderers/flutter/lib/gone.dart"))
        self._git("add", "-A")
        self.assertEqual(self.counts()["dart"], 0)

    def test_committed_and_working_tree_changes_are_unioned(self):
        self._git("checkout", "-b", "feature")
        self.write("swift/Sources/A2UI/Committed.swift", "let a = 1\n")
        self._git("add", "-A")
        self._git("commit", "-m", "committed swift change")
        self.write("swift/Sources/A2UI/Dirty.swift", "let b = 2\n")
        self.assertEqual(self.counts()["swift"], 2)

    def test_on_base_branch_committed_work_is_not_rescheduled(self):
        """On main itself the merge base is HEAD, so only dirty files remain.

        Post-submit runs on main are expected to use whole-repo mode; this
        documents why --changed must not be used there.
        """
        self.write("swift/Sources/A2UI/Committed.swift", "let a = 1\n")
        self._git("add", "-A")
        self._git("commit", "-m", "committed swift change")
        self.assertEqual(self.counts()["swift"], 0)

    def test_unrelated_commits_on_base_are_excluded(self):
        """Diffing against the merge base, not the branch tip."""
        self._git("checkout", "-b", "feature")
        self.write("swift/Sources/A2UI/Feature.swift", "let a = 1\n")
        self._git("add", "-A")
        self._git("commit", "-m", "feature work")

        self._git("checkout", "main")
        self.write("renderers/flutter/lib/unrelated.dart", "void main() {}\n")
        self._git("add", "-A")
        self._git("commit", "-m", "unrelated dart work on main")

        self._git("checkout", "feature")
        counts = self.counts()
        self.assertEqual(counts["swift"], 1)
        self.assertEqual(counts["dart"], 0)

    def test_missing_base_ref_is_a_clear_error(self):
        result = subprocess.run(
            [
                os.path.join(self.repo, "scripts", "fix_format.sh"),
                "--plan",
                "--base",
                "does/not/exist",
            ],
            cwd=self.repo,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("does not exist locally", result.stderr)

    def test_unknown_option_is_rejected(self):
        result = subprocess.run(
            [os.path.join(self.repo, "scripts", "fix_format.sh"), "--bogus"],
            cwd=self.repo,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("Unknown option", result.stderr)


if __name__ == "__main__":
    unittest.main()
