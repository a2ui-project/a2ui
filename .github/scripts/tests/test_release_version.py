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
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from unittest import mock

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


class DependencySpecifiersTest(unittest.TestCase):

    ADK_PYPROJECT = textwrap.dedent("""\
        [project]
        name = "a2ui-adk"
        dependencies = [
          "a2ui-agent-sdk>0.8.0",
          "google-adk>=1.28.1",
        ]

        [project.optional-dependencies]
        a2a = [
          "a2ui-a2a[extra]>=0.1.0 ; python_version >= '3.10'",
          "google-adk[a2a]>=1.28.1",
        ]
        """)

    def test_reads_required_dependencies(self):
        self.assertEqual(
            rv.dependency_specifiers(self.ADK_PYPROJECT, "a2ui-agent-sdk"), [">0.8.0"]
        )

    def test_reads_optional_dependencies_without_extras_or_markers(self):
        self.assertEqual(
            rv.dependency_specifiers(self.ADK_PYPROJECT, "a2ui-a2a"), [">=0.1.0"]
        )

    def test_missing_dependency_yields_nothing(self):
        self.assertEqual(rv.dependency_specifiers(self.ADK_PYPROJECT, "a2ui-core"), [])

    def test_unversioned_dependency_yields_empty_specifier(self):
        pyproject = '[project]\nname = "x"\ndependencies = ["a2ui-core"]\n'
        self.assertEqual(rv.dependency_specifiers(pyproject, "a2ui-core"), [""])

    def test_empty_specifier_is_always_satisfied(self):
        self.assertTrue(rv.satisfies("0.0.1", ""))

    def test_exclusive_lower_bound(self):
        self.assertFalse(rv.satisfies("0.8.0", ">0.8.0"))
        self.assertTrue(rv.satisfies("0.9.0", ">0.8.0"))


class DependentConstraintTest(unittest.TestCase):

    def test_agent_release_must_satisfy_the_integration_pins(self):
        error = rv.check_dependent_constraint(
            rv.AGENT, "0.8.0", rv.ADK, DependencySpecifiersTest.ADK_PYPROJECT
        )
        self.assertIsNotNone(error)
        self.assertIn("a2ui-agent-sdk 0.8.0 falls outside", error)
        self.assertIn(rv.ADK.pyproject_path, error)

    def test_optional_dependency_pins_are_checked(self):
        error = rv.check_dependent_constraint(
            rv.A2A, "0.0.1", rv.ADK, DependencySpecifiersTest.ADK_PYPROJECT
        )
        self.assertIsNotNone(error)
        self.assertIn("a2ui-a2a>=0.1.0", error)

    def test_version_inside_the_pin_passes(self):
        self.assertIsNone(
            rv.check_dependent_constraint(
                rv.AGENT, "0.9.0", rv.ADK, DependencySpecifiersTest.ADK_PYPROJECT
            )
        )

    def test_package_that_is_not_a_dependency_passes(self):
        self.assertIsNone(
            rv.check_dependent_constraint(
                rv.CORE, "9.0.0", rv.ADK, DependencySpecifiersTest.ADK_PYPROJECT
            )
        )


class DependenciesReleasedTest(unittest.TestCase):

    def _check(self, released, co_released=()):
        return rv.check_dependencies_released(
            rv.ADK,
            DependencySpecifiersTest.ADK_PYPROJECT,
            co_released,
            lambda package: released.get(package.pypi_name),
        )

    def test_released_dependencies_inside_the_pins_pass(self):
        self.assertEqual(
            self._check({"a2ui-agent-sdk": "0.9.0", "a2ui-a2a": "0.1.0"}), []
        )

    def test_unreleased_dependency_is_reported(self):
        problems = self._check({"a2ui-agent-sdk": "0.9.0"})
        self.assertEqual(len(problems), 1)
        self.assertIn("a2ui-a2a, which has not been released yet", problems[0])

    def test_released_dependency_outside_the_pin_is_reported(self):
        problems = self._check({"a2ui-agent-sdk": "0.8.0", "a2ui-a2a": "0.1.0"})
        self.assertEqual(len(problems), 1)
        self.assertIn("requires a2ui-agent-sdk>0.8.0", problems[0])
        self.assertIn("latest release of a2ui-agent-sdk is 0.8.0", problems[0])

    def test_dependencies_released_in_the_same_run_are_skipped(self):
        self.assertEqual(
            self._check({}, co_released=("a2ui-agent-sdk", "a2ui-a2a")), []
        )


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
        # The pin must be satisfied by either the current released core version
        # or an upcoming version being prepared for release.
        current = rv.current_version(rv.CORE, repo_root)
        candidates = [current] + [rv.bump_version(current, b) for b in rv.VALID_BUMPS]
        self.assertTrue(
            any(rv.satisfies(v, specifier) for v in candidates),
            f"no core version in {candidates} satisfies {specifier}",
        )


class RealIntegrationPinsTest(unittest.TestCase):
    """Guards the integration packages' pins against drifting out of reach."""

    def test_integration_pins_accept_the_next_agent_release(self):
        repo_root = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=os.path.dirname(__file__),
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        current = rv.current_version(rv.AGENT, repo_root)
        candidates = [current] + [rv.bump_version(current, b) for b in rv.VALID_BUMPS]
        for package in (rv.A2A, rv.ADK):
            with self.subTest(package=package.pypi_name):
                with open(
                    os.path.join(repo_root, package.pyproject_path), encoding="utf-8"
                ) as handle:
                    specifiers = rv.dependency_specifiers(
                        handle.read(), rv.AGENT.pypi_name
                    )
                self.assertTrue(
                    specifiers, f"{package.pypi_name} must pin the agent SDK"
                )
                for specifier in specifiers:
                    self.assertTrue(
                        any(rv.satisfies(v, specifier) for v in candidates),
                        f"no agent SDK version in {candidates} satisfies {specifier}",
                    )


class ParseSelectionTest(unittest.TestCase):

    def test_all_selects_every_package_in_dependency_order(self):
        self.assertEqual(rv.parse_selection("all"), list(rv.RELEASE_ORDER))

    def test_single_package(self):
        self.assertEqual(rv.parse_selection("a2ui-a2a"), [rv.A2A])

    def test_list_is_ordered_by_dependency_and_deduplicated(self):
        self.assertEqual(
            rv.parse_selection(" a2ui-adk , a2ui-core,a2ui-adk"), [rv.CORE, rv.ADK]
        )

    def test_unknown_package_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "unknown package.*a2ui-nope"):
            rv.parse_selection("a2ui-core,a2ui-nope")

    def test_empty_selection_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "no package selected"):
            rv.parse_selection(" , ")

    def test_command_line_rejects_unknown_package(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(SystemExit) as exit_:
            rv.main(["plan", "--package", "both", "--bump", "patch"])
        self.assertEqual(exit_.exception.code, 2)
        self.assertIn("unknown package(s) both", err.getvalue())


class PlanTest(unittest.TestCase):

    def setUp(self):
        self.repo_root = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=os.path.dirname(__file__),
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()

    def test_listed_packages_are_put_in_dependency_order(self):
        """a2ui-agent-sdk depends on a2ui-core, so core must publish first."""
        plan = rv.build_plan("a2ui-agent-sdk,a2ui-core", "patch", self.repo_root)
        self.assertEqual(
            [entry["pypi_name"] for entry in plan],
            ["a2ui-core", "a2ui-agent-sdk"],
        )

    def test_all_follows_the_dependency_order(self):
        plan = rv.build_plan("all", "minor", self.repo_root)
        self.assertEqual(
            [entry["pypi_name"] for entry in plan],
            ["a2ui-core", "a2ui-agent-sdk", "a2ui-a2a", "a2ui-adk"],
        )

    def test_a2a_is_put_before_adk(self):
        plan = rv.build_plan("a2ui-adk, a2ui-a2a", "minor", self.repo_root)
        self.assertEqual(
            [entry["pypi_name"] for entry in plan], ["a2ui-a2a", "a2ui-adk"]
        )

    def test_integration_tags_use_their_own_series(self):
        for package in (rv.A2A, rv.ADK):
            with self.subTest(package=package.pypi_name):
                entry = rv.build_plan(package.pypi_name, "minor", self.repo_root)[0]
                self.assertEqual(entry["directory"], package.directory)
                self.assertTrue(entry["tag"].startswith(package.tag_prefix))

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


CHANGELOG_WITH_ENTRY = "# Changelog\n\n## Unreleased\n\n- Something new.\n"


class CheckCommandTest(unittest.TestCase):

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repo_root = self.temp_dir.name
        # Seed tags for core and agent.
        subprocess.run(
            ["git", "init", "-b", "main"],
            cwd=self.repo_root,
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test"], cwd=self.repo_root, check=True
        )
        subprocess.run(
            ["git", "config", "user.email", "test@test.local"],
            cwd=self.repo_root,
            check=True,
        )
        subprocess.run(
            ["git", "commit", "--allow-empty", "-m", "Initial"],
            cwd=self.repo_root,
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "tag", "python/a2ui-core/v0.2.0"], cwd=self.repo_root, check=True
        )
        subprocess.run(
            ["git", "tag", "python/a2ui-agent-sdk/v0.7.0"],
            cwd=self.repo_root,
            check=True,
        )

        pyprojects = {
            rv.CORE: '[project]\nname = "a2ui-core"\n',
            rv.AGENT: (
                '[project]\nname = "a2ui-agent-sdk"\ndependencies = [\n'
                '  "a2ui-core>=0.2.0,<0.3.0",\n]\n'
            ),
            rv.A2A: (
                '[project]\nname = "a2ui-a2a"\ndependencies = [\n'
                '  "a2a-sdk>=0.3.0,<0.4.0",\n  "a2ui-agent-sdk>0.7.0",\n]\n'
            ),
            rv.ADK: (
                '[project]\nname = "a2ui-adk"\ndependencies = [\n'
                '  "a2ui-agent-sdk>0.7.0",\n]\n'
                "[project.optional-dependencies]\n"
                'a2a = ["a2ui-a2a>=0.1.0", "google-adk[a2a]>=1.28.1"]\n'
            ),
        }
        for pkg, content in pyprojects.items():
            self._write(pkg.changelog_path, CHANGELOG_WITH_ENTRY)
            self._write(pkg.pyproject_path, content)

    def _write(self, relative_path: str, content: str) -> None:
        path = os.path.join(self.repo_root, relative_path)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(content)

    def _tag(self, tag: str) -> None:
        subprocess.run(["git", "tag", tag], cwd=self.repo_root, check=True)

    def tearDown(self):
        self.temp_dir.cleanup()

    def _run(self, args: list[str]) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = rv.main(
                ["check", *args, "--skip-env-checks", "--repo-root", self.repo_root]
            )
        return code, out.getvalue(), err.getvalue()

    def test_single_package_with_version_success(self):
        code, out, _ = self._run(["--package", "a2ui-core", "--version", "0.2.1"])
        self.assertEqual(code, 0)
        self.assertIn("Preflight checks passed for a2ui-core 0.2.1", out)

    def test_single_package_with_bump_success(self):
        code, out, _ = self._run(["--package", "a2ui-core", "--bump", "patch"])
        self.assertEqual(code, 0)
        self.assertIn("Preflight checks passed for a2ui-core 0.2.1", out)

    def test_both_packages_with_patch_bump_success(self):
        code, out, _ = self._run(
            ["--package", "a2ui-core,a2ui-agent-sdk", "--bump", "patch"]
        )
        self.assertEqual(code, 0)
        self.assertIn("Preflight checks passed for a2ui-core 0.2.1", out)
        self.assertIn("Preflight checks passed for a2ui-agent-sdk 0.7.1", out)

    def test_both_packages_without_bump_errors(self):
        code, _, err = self._run(["--package", "a2ui-core,a2ui-agent-sdk"])
        self.assertEqual(code, 2)
        self.assertIn("either --version or --bump is required", err)

    def test_both_packages_with_version_errors(self):
        code, _, err = self._run(
            ["--package", "a2ui-core,a2ui-agent-sdk", "--version", "0.2.1"]
        )
        self.assertEqual(code, 2)
        self.assertIn("--version cannot be used with more than one package", err)

    def test_version_and_bump_together_errors(self):
        code, _, err = self._run(
            ["--package", "a2ui-core", "--version", "0.2.1", "--bump", "patch"]
        )
        self.assertEqual(code, 2)
        self.assertIn("specify either --version or --bump, not both", err)

    def test_neither_version_nor_bump_errors(self):
        code, _, err = self._run(["--package", "a2ui-core"])
        self.assertEqual(code, 2)
        self.assertIn("either --version or --bump is required", err)

    def test_usage_errors_are_reported_before_environment_checks(self):
        out, err = io.StringIO(), io.StringIO()
        with (
            mock.patch.dict(os.environ, {"GITHUB_ACTIONS": ""}),
            mock.patch.object(rv, "check_environment") as env_check,
            contextlib.redirect_stdout(out),
            contextlib.redirect_stderr(err),
        ):
            code = rv.main(
                ["check", "--package", "a2ui-core", "--repo-root", self.repo_root]
            )
        self.assertEqual(code, 2)
        env_check.assert_not_called()

    def test_environment_checks_are_skipped_in_github_actions(self):
        out, err = io.StringIO(), io.StringIO()
        with (
            mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}),
            mock.patch.object(rv, "check_environment") as env_check,
            contextlib.redirect_stdout(out),
            contextlib.redirect_stderr(err),
        ):
            code = rv.main([
                "check",
                "--package",
                "a2ui-core",
                "--version",
                "0.2.1",
                "--repo-root",
                self.repo_root,
            ])
        self.assertEqual(code, 0)
        env_check.assert_not_called()

    def test_both_packages_with_minor_bump_catches_pin_violation(self):
        code, out, err = self._run(
            ["--package", "a2ui-core,a2ui-agent-sdk", "--bump", "minor"]
        )
        self.assertEqual(code, 1)
        self.assertIn("falls outside the a2ui-core>=0.2.0,<0.3.0 range", err)
        self.assertIn("error: 1 problem(s) found, see above.", err)
        self.assertIn("Preflight checks passed for a2ui-agent-sdk 0.8.0", out)

    def test_all_with_version_errors(self):
        code, _, err = self._run(["--package", "all", "--version", "0.2.1"])
        self.assertEqual(code, 2)
        self.assertIn("--version cannot be used with more than one package", err)

    def test_all_packages_with_patch_bump_success(self):
        self._tag("python/a2ui-a2a/v0.1.0")
        self._tag("python/a2ui-adk/v0.1.0")
        code, out, err = self._run(["--package", "all", "--bump", "patch"])
        self.assertEqual(code, 0, err)
        for name, version in (
            ("a2ui-core", "0.2.1"),
            ("a2ui-agent-sdk", "0.7.1"),
            ("a2ui-a2a", "0.1.1"),
            ("a2ui-adk", "0.1.1"),
        ):
            self.assertIn(f"Preflight checks passed for {name} {version}", out)

    def test_first_integration_release_needs_a_minor_bump(self):
        code, out, err = self._run(["--package", "all", "--bump", "patch"])
        # a2ui-a2a 0.0.1 falls outside the a2ui-a2a>=0.1.0 pin of a2ui-adk.
        self.assertEqual(code, 1)
        self.assertIn("a2ui-a2a 0.0.1 falls outside the a2ui-a2a>=0.1.0 range", err)

    def test_first_integrations_release_after_the_agent_sdk(self):
        self._tag("python/a2ui-agent-sdk/v0.8.0")
        code, out, err = self._run(
            ["--package", "a2ui-a2a,a2ui-adk", "--bump", "minor"]
        )
        self.assertEqual(code, 0, err)
        self.assertIn("Preflight checks passed for a2ui-a2a 0.1.0", out)
        self.assertIn("Preflight checks passed for a2ui-adk 0.1.0", out)

    def test_integration_needs_a_released_agent_sdk_inside_its_pin(self):
        code, _, err = self._run(["--package", "a2ui-a2a", "--bump", "minor"])
        self.assertEqual(code, 1)
        self.assertIn("requires a2ui-agent-sdk>0.7.0", err)
        self.assertIn("latest release of a2ui-agent-sdk is 0.7.0", err)

    def test_integration_needs_its_unreleased_dependency(self):
        self._tag("python/a2ui-agent-sdk/v0.8.0")
        code, _, err = self._run(["--package", "a2ui-adk", "--bump", "minor"])
        self.assertEqual(code, 1)
        self.assertIn("a2ui-a2a, which has not been released yet", err)

    def test_plan_marks_dependencies_as_released_in_the_same_run(self):
        plan = os.path.join(self.repo_root, "release-plan.json")
        with open(plan, "w", encoding="utf-8") as handle:
            json.dump(
                [
                    {"pypi_name": "a2ui-agent-sdk", "version": "0.8.0"},
                    {"pypi_name": "a2ui-a2a", "version": "0.1.0"},
                ],
                handle,
            )
        code, out, err = self._run(
            ["--package", "a2ui-a2a", "--version", "0.1.0", "--plan", plan]
        )
        self.assertEqual(code, 0, err)
        self.assertIn("Preflight checks passed for a2ui-a2a 0.1.0", out)

    def test_agent_release_is_checked_against_the_integration_pins(self):
        code, _, err = self._run(["--package", "a2ui-agent-sdk", "--version", "0.7.0"])
        self.assertEqual(code, 1)
        self.assertIn("a2ui-agent-sdk 0.7.0 falls outside the", err)

    def test_invalid_version_fails_gracefully(self):
        code, out, err = self._run(["--package", "a2ui-core", "--version", "invalid"])
        self.assertEqual(code, 1)
        self.assertIn("invalid version 'invalid'", err)

    def test_malformed_changelog_prefixes_path(self):
        core_changelog = os.path.join(self.repo_root, rv.CORE.changelog_path)
        with open(core_changelog, "w", encoding="utf-8") as handle:
            handle.write("# Broken Changelog\n\nNo unreleased heading.\n")
        code, out, err = self._run(["--package", "a2ui-core", "--version", "0.2.1"])
        self.assertEqual(code, 1)
        self.assertIn(
            f"{rv.CORE.changelog_path}: changelog has no '## Unreleased' heading", err
        )


class CheckEnvironmentTest(unittest.TestCase):
    """Runs the environment checks against a real clone of a local remote.

    The remote lives at <tmp>/a2ui-project/a2ui.git so its URL looks like the
    canonical repository. Git runs for real; `gh` is faked, so the tests need
    no network or GitHub login.
    """

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        base = self.temp_dir.name
        self.remote_url = os.path.join(base, "a2ui-project", "a2ui.git")
        self.repo_root = os.path.join(base, "work")
        os.makedirs(self.repo_root)
        self._git(base, "init", "--bare", "-b", "main", self.remote_url)
        self._git(self.repo_root, "init", "-b", "main")
        self._git(self.repo_root, "config", "user.name", "Test")
        self._git(self.repo_root, "config", "user.email", "test@test.local")
        for pkg in rv.RELEASE_ORDER:
            self._write(pkg.pyproject_path, "[project]\n")
        self._git(self.repo_root, "add", ".")
        self._git(self.repo_root, "commit", "-m", "Initial")
        self._git(self.repo_root, "remote", "add", "origin", self.remote_url)
        self._git(self.repo_root, "push", "origin", "main")

        self.gh_installed = True
        self.gh_auth_rc = 0
        self.gh_push = "true"
        self.fail_ls_remote = False
        self.git_identity_unset = False

    def tearDown(self):
        self.temp_dir.cleanup()

    @staticmethod
    def _git(cwd, *args):
        subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)

    def _write(self, relative_path, content):
        path = os.path.join(self.repo_root, relative_path)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(content)

    def _fake_run(self, cmd, **kwargs):
        def result(returncode=0, stdout="", stderr=""):
            return subprocess.CompletedProcess(cmd, returncode, stdout, stderr)

        if cmd[0] == "gh":
            if cmd[1] == "auth":
                return result(self.gh_auth_rc)
            if cmd[1] == "api":
                return result(stdout=self.gh_push + "\n")
            raise AssertionError(f"unexpected gh call {cmd}")
        if self.git_identity_unset and cmd[:2] == ["git", "config"]:
            return result(1)
        if self.fail_ls_remote and "ls-remote" in cmd:
            return result(128, stderr="fatal: unable to access remote")
        return subprocess.run(cmd, **kwargs)

    def _check(self, cwd=None):
        return rv.check_environment(
            self.repo_root,
            cwd=cwd,
            run=self._fake_run,
            which=lambda name: f"/usr/bin/{name}" if self.gh_installed else None,
        )

    def test_clean_checkout_in_sync_with_main_passes(self):
        report = self._check(cwd=self.repo_root)
        self.assertEqual(report.errors, [])
        self.assertEqual(report.warnings, [])
        self.assertEqual(report.remote, "origin")

    def test_not_an_a2ui_checkout_is_fatal(self):
        os.remove(os.path.join(self.repo_root, rv.CORE.pyproject_path))
        report = self._check()
        self.assertTrue(report.fatal)
        self.assertEqual(len(report.errors), 1)
        self.assertIn("is not an a2ui checkout", report.errors[0])
        self.assertIn("Action needed", report.errors[0])

    def test_running_from_a_subdirectory_only_warns(self):
        subdir = os.path.join(self.repo_root, "python")
        report = self._check(cwd=subdir)
        self.assertEqual(report.errors, [])
        self.assertEqual(len(report.warnings), 1)
        self.assertIn("not the repository root", report.warnings[0])

    def test_unset_git_identity_is_an_error(self):
        self.git_identity_unset = True
        report = self._check()
        self.assertTrue(any("git config user.name" in e for e in report.errors))
        self.assertTrue(any("git config user.email" in e for e in report.errors))

    def test_missing_gh_is_an_error(self):
        self.gh_installed = False
        report = self._check()
        self.assertTrue(any("is not installed" in e for e in report.errors))

    def test_unauthenticated_gh_is_an_error(self):
        self.gh_auth_rc = 1
        report = self._check()
        self.assertTrue(any("not authenticated" in e for e in report.errors))

    def test_no_write_access_is_an_error(self):
        self.gh_push = "false"
        report = self._check()
        self.assertTrue(any("no write access" in e for e in report.errors))

    def test_uncommitted_change_to_a_tracked_file_is_an_error(self):
        self._write(rv.CORE.pyproject_path, "[project]\nname = 'edited'\n")
        report = self._check()
        self.assertEqual(len(report.errors), 1)
        self.assertIn("uncommitted changes", report.errors[0])

    def test_untracked_files_are_ignored(self):
        self._write("python/a2ui_core/.venv/marker", "")
        report = self._check()
        self.assertEqual(report.errors, [])

    def test_local_commit_not_on_main_is_an_error(self):
        self._write(rv.AGENT.pyproject_path, "[project]\ndependencies = []\n")
        self._git(self.repo_root, "commit", "-am", "Widen the pin locally")
        report = self._check()
        self.assertEqual(len(report.errors), 1)
        self.assertIn("differ from origin/main", report.errors[0])

    def test_changes_outside_the_packages_are_ignored(self):
        self._write("docs/notes.md", "local notes\n")
        self._git(self.repo_root, "add", ".")
        self._git(self.repo_root, "commit", "-m", "Unrelated local commit")
        report = self._check()
        self.assertEqual(report.errors, [])

    def test_canonical_remote_is_found_by_url_not_name(self):
        self._git(self.repo_root, "remote", "rename", "origin", "upstream")
        self._git(
            self.repo_root,
            "remote",
            "add",
            "origin",
            "https://github.com/someone/a2ui.git",
        )
        report = self._check()
        self.assertEqual(report.remote, "upstream")
        self.assertEqual(report.errors, [])

    def test_missing_canonical_remote_is_an_error(self):
        self._git(self.repo_root, "remote", "remove", "origin")
        report = self._check()
        self.assertIsNone(report.remote)
        self.assertTrue(any("no git remote points at" in e for e in report.errors))

    def test_outstanding_changelog_branch_is_an_error(self):
        self._git(self.repo_root, "push", "origin", "main:release/changelog-20261007")
        report = self._check()
        self.assertEqual(len(report.errors), 1)
        self.assertIn("release/changelog-20261007", report.errors[0])

    def test_failing_to_list_remote_branches_is_an_error(self):
        self.fail_ls_remote = True
        report = self._check()
        self.assertTrue(
            any("could not list release/changelog-*" in e for e in report.errors)
        )


class CheckCommandEnvironmentTest(unittest.TestCase):
    """How `check` reports environment problems, without the network."""

    def _main(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with (
            mock.patch.dict(os.environ, {"GITHUB_ACTIONS": ""}),
            contextlib.redirect_stdout(out),
            contextlib.redirect_stderr(err),
        ):
            code = rv.main(argv)
        return code, out.getvalue(), err.getvalue()

    def test_outside_a_git_checkout_fails_without_a_traceback(self):
        not_a_repo = subprocess.CalledProcessError(128, ["git", "rev-parse"])
        with mock.patch.object(rv, "_git", side_effect=not_a_repo):
            code, _, err = self._main(
                ["check", "--package", "a2ui-core", "--bump", "patch"]
            )
        self.assertEqual(code, 1)
        self.assertIn("is not inside a git checkout", err)
        self.assertNotIn("Traceback", err)

    def test_repo_root_outside_a_git_checkout_fails_without_a_traceback(self):
        with tempfile.TemporaryDirectory() as plain_dir:
            code, out, err = self._main([
                "check",
                "--package",
                "a2ui-core,a2ui-agent-sdk",
                "--bump",
                "patch",
                "--repo-root",
                plain_dir,
            ])
        self.assertEqual(code, 1)
        self.assertIn("is not inside a git checkout", err)
        self.assertNotIn("Traceback", err)
        self.assertEqual(out, "")

    def test_other_repository_stops_before_package_checks(self):
        with tempfile.TemporaryDirectory() as other:
            subprocess.run(["git", "init"], cwd=other, check=True, capture_output=True)
            code, out, err = self._main([
                "check",
                "--package",
                "a2ui-core,a2ui-agent-sdk",
                "--bump",
                "patch",
                "--repo-root",
                other,
            ])
        self.assertEqual(code, 1)
        self.assertIn("is not an a2ui checkout", err)
        self.assertEqual(out, "")


if __name__ == "__main__":
    unittest.main()
