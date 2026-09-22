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

"""Tests for .github/scripts/release_version.py."""

import contextlib
import datetime
import io
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import release_version as rv  # noqa: E402


class ParseAndBumpTest(unittest.TestCase):

    def test_parse_version(self):
        self.assertEqual(rv.parse_version("1.2.3"), (1, 2, 3))
        self.assertEqual(rv.parse_version("0.0.0"), (0, 0, 0))
        self.assertEqual(rv.parse_version("10.20.30"), (10, 20, 30))

    def test_parse_version_rejects_non_release_versions(self):
        for bad in ("1.2", "1.2.3.4", "v1.2.3", "1.2.3rc1", "1.2.3.dev4", ""):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                rv.parse_version(bad)

    def test_bump_patch(self):
        self.assertEqual(rv.bump_version("0.1.1", "patch"), "0.1.2")

    def test_bump_minor_resets_patch(self):
        self.assertEqual(rv.bump_version("0.1.9", "minor"), "0.2.0")

    def test_bump_major_resets_minor_and_patch(self):
        self.assertEqual(rv.bump_version("1.4.7", "major"), "2.0.0")

    def test_bump_rejects_unknown_level(self):
        with self.assertRaises(ValueError):
            rv.bump_version("1.0.0", "huge")


class TagTest(unittest.TestCase):

    def test_tag_names_do_not_collide_between_packages(self):
        self.assertEqual(rv.CORE.tag_for("1.2.3"), "python/a2ui-core/v1.2.3")
        self.assertEqual(rv.AGENT.tag_for("1.2.3"), "python/a2ui-agent-sdk/v1.2.3")
        self.assertFalse(rv.AGENT.tag_for("1.2.3").startswith(rv.CORE.tag_prefix))

    def test_versions_from_tags_ignores_other_packages_and_junk(self):
        tags = [
            "python/a2ui-core/v0.1.1",
            "python/a2ui-core/v0.2.0",
            "python/a2ui-agent-sdk/v0.6.0",
            "v0.9",
            "python/a2ui-core/vnot-a-version",
            "",
        ]
        self.assertEqual(rv.versions_from_tags(rv.CORE, tags), ["0.1.1", "0.2.0"])
        self.assertEqual(rv.versions_from_tags(rv.AGENT, tags), ["0.6.0"])


class CurrentVersionTest(unittest.TestCase):
    """Exercises the git-reading path against a real throwaway repository."""

    def setUp(self):
        self.repo = tempfile.mkdtemp()
        self._git("init", "-q")
        self._git("config", "user.email", "test@example.com")
        self._git("config", "user.name", "Test")
        with open(os.path.join(self.repo, "f.txt"), "w") as handle:
            handle.write("x")
        self._git("add", ".")
        self._git("commit", "-q", "-m", "initial")

    def _git(self, *args):
        subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True)

    def test_falls_back_to_bootstrap_when_no_tag_exists(self):
        self.assertEqual(
            rv.current_version(rv.CORE, self.repo), rv.CORE.bootstrap_version
        )

    def test_reads_the_highest_tag_not_the_most_recent(self):
        # Created out of order on purpose: version order must win over tag
        # creation order.
        for version in ("0.1.2", "0.2.0", "0.1.9"):
            self._git("tag", rv.CORE.tag_for(version))
        self.assertEqual(rv.current_version(rv.CORE, self.repo), "0.2.0")

    def test_compares_numerically_not_lexically(self):
        for version in ("0.9.0", "0.10.0"):
            self._git("tag", rv.CORE.tag_for(version))
        self.assertEqual(rv.current_version(rv.CORE, self.repo), "0.10.0")

    def test_packages_do_not_see_each_others_tags(self):
        self._git("tag", rv.AGENT.tag_for("9.9.9"))
        self.assertEqual(
            rv.current_version(rv.CORE, self.repo), rv.CORE.bootstrap_version
        )

    def test_list_tags_ignores_non_conforming_tags(self):
        self._git("tag", "python/a2ui-core/v0.1.1")
        self._git("tag", "python/a2ui-core/v0.1.2")
        self._git("tag", "python/a2ui-core/v0.2.0-alpha")
        self._git("tag", "python/a2ui-core/vnext")
        self.assertEqual(
            rv.list_tags(rv.CORE, self.repo),
            ["python/a2ui-core/v0.1.2", "python/a2ui-core/v0.1.1"],
        )


class ChangelogTest(unittest.TestCase):

    CHANGELOG = textwrap.dedent("""\
        ## Unreleased

        - Added a thing (#1).
        - Fixed another thing (#2).

        ## 0.1.1

        - Older entry.

        ## 0.1.0
        """)

    def test_read_unreleased(self):
        self.assertEqual(
            rv.read_unreleased(self.CHANGELOG),
            "- Added a thing (#1).\n- Fixed another thing (#2).",
        )

    def test_read_unreleased_empty_section(self):
        self.assertEqual(rv.read_unreleased("## Unreleased\n\n## 0.1.0\n"), "")

    def test_read_unreleased_missing_heading(self):
        with self.assertRaises(ValueError):
            rv.read_unreleased("## 0.1.0\n\n- Entry.\n")

    def test_cut_changelog_moves_entries_under_the_new_version(self):
        result = rv.cut_changelog(self.CHANGELOG, "0.1.2", datetime.date(2026, 5, 4))
        self.assertIn("## 0.1.2 (2026-05-04)", result)
        self.assertIn("- Added a thing (#1).", result)
        # The old entries stay where they were.
        self.assertIn("## 0.1.1", result)
        self.assertIn("- Older entry.", result)

    def test_cut_changelog_leaves_an_empty_unreleased_section(self):
        result = rv.cut_changelog(self.CHANGELOG, "0.1.2", datetime.date(2026, 5, 4))
        self.assertEqual(rv.read_unreleased(result), "")
        self.assertTrue(result.startswith("## Unreleased\n"))

    def test_cut_changelog_puts_the_new_version_above_the_previous_one(self):
        result = rv.cut_changelog(self.CHANGELOG, "0.1.2", datetime.date(2026, 5, 4))
        self.assertLess(result.index("## 0.1.2"), result.index("## 0.1.1"))

    def test_cut_changelog_refuses_an_empty_unreleased_section(self):
        with self.assertRaises(ValueError):
            rv.cut_changelog(
                "## Unreleased\n\n## 0.1.0\n", "0.1.1", datetime.date.today()
            )

    def test_cut_changelog_is_not_applied_twice(self):
        once = rv.cut_changelog(self.CHANGELOG, "0.1.2", datetime.date(2026, 5, 4))
        with self.assertRaises(ValueError):
            rv.cut_changelog(once, "0.1.3", datetime.date(2026, 5, 4))


class SpecifierTest(unittest.TestCase):

    AGENT_PYPROJECT = textwrap.dedent("""\
        [project]
        name = "a2ui-agent-sdk"
        dependencies = [
          "a2a-sdk>=0.3.0,<0.4.0",
          "a2ui-core>=0.1.1,<0.2.0",
          "httpx>=0.27.0",
        ]
        """)

    def test_core_specifier(self):
        self.assertEqual(rv.core_specifier(self.AGENT_PYPROJECT), ">=0.1.1,<0.2.0")

    def test_core_specifier_missing_dependency(self):
        with self.assertRaises(ValueError):
            rv.core_specifier('[project]\nname = "x"\ndependencies = ["httpx"]\n')

    def test_satisfies_within_range(self):
        self.assertTrue(rv.satisfies("0.1.2", ">=0.1.1,<0.2.0"))
        self.assertTrue(rv.satisfies("0.1.1", ">=0.1.1,<0.2.0"))
        self.assertTrue(rv.satisfies("0.1.99", ">=0.1.1,<0.2.0"))

    def test_satisfies_outside_range(self):
        self.assertFalse(rv.satisfies("0.2.0", ">=0.1.1,<0.2.0"))
        self.assertFalse(rv.satisfies("0.1.0", ">=0.1.1,<0.2.0"))
        self.assertFalse(rv.satisfies("1.0.0", ">=0.1.1,<0.2.0"))

    def test_satisfies_rejects_unparseable_specifier(self):
        with self.assertRaises(ValueError):
            rv.satisfies("1.0.0", "anything")


class CoreConstraintTest(unittest.TestCase):

    def test_patch_bump_is_allowed(self):
        self.assertIsNone(
            rv.check_core_constraint("0.1.2", SpecifierTest.AGENT_PYPROJECT)
        )

    def test_minor_bump_past_the_pin_is_blocked(self):
        error = rv.check_core_constraint("0.2.0", SpecifierTest.AGENT_PYPROJECT)
        self.assertIsNotNone(error)
        self.assertIn("0.2.0", error)
        self.assertIn("a2ui-agent-sdk", error)

    def test_major_bump_is_blocked(self):
        self.assertIsNotNone(
            rv.check_core_constraint("1.0.0", SpecifierTest.AGENT_PYPROJECT)
        )

    def test_uses_the_real_agent_pyproject(self):
        """Guards against the real pin drifting away from what we can parse."""
        repo_root = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=os.path.dirname(__file__),
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        with open(
            os.path.join(repo_root, rv.AGENT.pyproject_path), encoding="utf-8"
        ) as handle:
            specifier = rv.core_specifier(handle.read())
        self.assertTrue(specifier, "a2ui-agent-sdk must pin a2ui-core")
        # Whatever the pin is, the current core version must satisfy it.
        self.assertTrue(
            rv.satisfies(rv.current_version(rv.CORE, repo_root), specifier),
            f"released a2ui-core does not satisfy {specifier}",
        )


class PlanTest(unittest.TestCase):

    def setUp(self):
        self.repo_root = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=os.path.dirname(__file__),
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()

    def test_both_puts_core_first(self):
        """a2ui-agent-sdk depends on a2ui-core, so core must publish first."""
        plan = rv.build_plan("both", "patch", self.repo_root)
        self.assertEqual(
            [entry["pypi_name"] for entry in plan],
            ["a2ui-core", "a2ui-agent-sdk"],
        )

    def test_single_package_selection(self):
        plan = rv.build_plan("a2ui-core", "patch", self.repo_root)
        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0]["pypi_name"], "a2ui-core")

    def test_tag_matches_version(self):
        for selection in ("a2ui-core", "a2ui-agent-sdk"):
            with self.subTest(selection=selection):
                entry = rv.build_plan(selection, "minor", self.repo_root)[0]
                self.assertTrue(entry["tag"].endswith(entry["version"]))
                rv.parse_version(entry["version"])

    def test_plan_advances_past_the_released_version(self):
        entry = rv.build_plan("a2ui-core", "patch", self.repo_root)[0]
        released = rv.current_version(rv.CORE, self.repo_root)
        self.assertGreater(
            rv.parse_version(entry["version"]), rv.parse_version(released)
        )


class NotesCommandTest(unittest.TestCase):
    """Callers treat empty stdout as "nothing to release".

    A malformed changelog is a different answer and has to be distinguishable,
    so it goes to stderr with a non-zero exit rather than an empty stdout.
    """

    def _run(self, changelog: str) -> tuple[int, str, str]:
        with tempfile.TemporaryDirectory() as root:
            path = os.path.join(root, rv.CORE.changelog_path)
            os.makedirs(os.path.dirname(path))
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(changelog)

            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = rv.main(["notes", "--package", "a2ui-core", "--repo-root", root])
            return code, out.getvalue(), err.getvalue()

    def test_empty_section_succeeds_with_no_output(self):
        code, out, _ = self._run("# Changelog\n\n## Unreleased\n\n## 0.1.1\n\n- Old.\n")
        self.assertEqual(code, 0)
        self.assertEqual(out.strip(), "")

    def test_missing_heading_fails_without_a_traceback(self):
        code, out, err = self._run("# Changelog\n\n## 0.1.1\n\n- Old.\n")
        self.assertEqual(code, 1)
        self.assertEqual(out.strip(), "")
        self.assertIn("## Unreleased", err)
        self.assertNotIn("Traceback", err)

    def test_populated_section_is_printed(self):
        code, out, _ = self._run("# Changelog\n\n## Unreleased\n\n- Fixed a thing.\n")
        self.assertEqual(code, 0)
        self.assertEqual(out.strip(), "- Fixed a thing.")


if __name__ == "__main__":
    unittest.main()
