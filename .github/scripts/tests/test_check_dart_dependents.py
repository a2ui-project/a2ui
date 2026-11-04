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

"""Tests for .github/scripts/check_dart_dependents.py."""

import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import check_dart_dependents as cdd  # noqa: E402

V = cdd.Version.parse

AGENT_PUBSPEC = """\
name: a2ui_agent
description: Agent SDK.
version: 0.0.1-wip005

environment:
  sdk: ^3.9.0

dependencies:
  a2ui_core: ^0.4.0
  antlr4: ">=4.13.2 <4.14.0"

dev_dependencies:
  test: ^1.25.0
"""

EXAMPLE_PUBSPEC = """\
name: example
publish_to: "none"

dependencies:
  a2ui_core:
    path: ../../a2ui_core
"""


class AllowsTest(unittest.TestCase):

    def test_caret_before_one_allows_only_one_minor(self):
        self.assertTrue(cdd.allows("^0.4.0", V("0.4.0")))
        self.assertTrue(cdd.allows("^0.4.0", V("0.4.7")))
        self.assertFalse(cdd.allows("^0.4.0", V("0.5.0")))
        self.assertFalse(cdd.allows("^0.4.0", V("0.3.9")))

    def test_caret_on_zero_minor_also_stops_at_next_minor(self):
        self.assertTrue(cdd.allows("^0.0.3", V("0.0.4")))
        self.assertTrue(cdd.allows("^0.0.1-wip002", V("0.0.2")))
        self.assertFalse(cdd.allows("^0.0.3", V("0.1.0-0")))
        self.assertFalse(cdd.allows("^0.0.3", V("0.1.0")))

    def test_caret_from_one_allows_one_major(self):
        self.assertTrue(cdd.allows("^1.2.0", V("1.9.0")))
        self.assertFalse(cdd.allows("^1.2.0", V("2.0.0")))

    def test_upper_bound_excludes_its_prereleases(self):
        self.assertFalse(cdd.allows("^0.4.0", V("0.5.0-dev.1")))
        self.assertTrue(cdd.allows("<0.5.0-dev.2", V("0.5.0-dev.1")))

    def test_prerelease_lower_bound_keeps_prereleases_of_upper_bound(self):
        self.assertTrue(cdd.allows(">=0.5.0-dev.1 <0.5.0", V("0.5.0-dev.3")))

    def test_ranges(self):
        self.assertTrue(cdd.allows(">=0.2.2 <0.5.0", V("0.4.0")))
        self.assertFalse(cdd.allows(">=0.2.2 <0.5.0", V("0.5.0")))
        self.assertFalse(cdd.allows(">0.4.0", V("0.4.0")))
        self.assertTrue(cdd.allows("<=0.5.0", V("0.5.0")))
        self.assertTrue(cdd.allows('">=4.13.2 <4.14.0"', V("4.13.5")))

    def test_exact_version_and_any(self):
        self.assertTrue(cdd.allows("0.5.0", V("0.5.0")))
        self.assertFalse(cdd.allows("0.5.0", V("0.5.1")))
        self.assertTrue(cdd.allows("any", V("9.0.0")))

    def test_rejects_unknown_syntax(self):
        for constraint in ("latest", ">=0.4.0 junk", "^0.4"):
            with self.subTest(constraint), self.assertRaises(ValueError):
                cdd.allows(constraint, V("1.0.0"))


class VersionTest(unittest.TestCase):

    def test_prerelease_sorts_before_release(self):
        self.assertLess(V("0.0.1-wip004"), V("0.0.1"))
        self.assertLess(V("0.0.1-wip004"), V("0.0.1-wip005"))
        self.assertLess(V("1.0.0-dev.2"), V("1.0.0-dev.10"))

    def test_rejects_non_version(self):
        with self.assertRaises(ValueError):
            V("0.5")


class PubspecTest(unittest.TestCase):

    def test_reads_name_version_and_core_constraint(self):
        self.assertEqual(cdd.pubspec_name(AGENT_PUBSPEC), "a2ui_agent")
        self.assertEqual(cdd.pubspec_version(AGENT_PUBSPEC), "0.0.1-wip005")
        self.assertEqual(cdd.core_constraint(AGENT_PUBSPEC), "^0.4.0")

    def test_path_dependency_has_no_constraint(self):
        self.assertIsNone(cdd.core_constraint(EXAMPLE_PUBSPEC))
        self.assertIsNone(cdd.pubspec_version(EXAMPLE_PUBSPEC))
        self.assertEqual(cdd.pubspec_publish_to(EXAMPLE_PUBSPEC), "none")

    def test_ignores_core_outside_dependencies(self):
        pubspec = "name: x\n\ndev_dependencies:\n  a2ui_core: ^0.4.0\n"
        self.assertIsNone(cdd.core_constraint(pubspec))

    def test_reads_through_comments_and_quotes(self):
        pubspec = (
            "name: x\ndependencies: # runtime\n# pinned below\n"
            "  a2ui_core: '^0.4.0' # core\n"
        )
        self.assertEqual(cdd.core_constraint(pubspec), "^0.4.0")

    def test_reads_map_form_version(self):
        pubspec = "name: x\ndependencies:\n  a2ui_core:\n    version: ^0.4.0\n"
        self.assertEqual(cdd.core_constraint(pubspec), "^0.4.0")

    def test_fails_on_unreadable_entry(self):
        pubspec = "name: x\ndependencies:\n  a2ui_core:\n    git: https://x\n"
        with self.assertRaises(ValueError):
            cdd.core_constraint(pubspec)

    def test_version_does_not_continue_on_next_line(self):
        self.assertIsNone(cdd.pubspec_version("name: x\nversion:\n  1.0.0\n"))


class ChangelogTest(unittest.TestCase):

    def test_reads_first_version_heading(self):
        changelog = (
            "# [a2ui_agent](https://pub.dev) Changelog\n\n## Unreleased\n\n- x\n\n"
            "## 0.0.1-wip005\n"
        )
        self.assertEqual(cdd.changelog_top_heading(changelog), "Unreleased")
        self.assertIsNone(cdd.changelog_top_heading("# Changelog\n"))

    def test_skips_empty_unreleased_above_new_version(self):
        changelog = "# Changelog\n\n## Unreleased\n\n## 0.1.0\n\n- x\n"
        self.assertEqual(cdd.changelog_top_heading(changelog), "0.1.0")
        self.assertEqual(
            cdd.changelog_top_heading("## Unreleased\n\n- y\n\n## 0.1.0\n"),
            "Unreleased",
        )


def published(latest, constraint, *older):
    return cdd.Published(frozenset((latest, *older)), latest, constraint)


def package(
    version,
    heading,
    base_version=None,
    base_heading="Unreleased",
    constraint="^0.5.0",
    publish_to=None,
    name="a2ui_agent",
):
    return cdd.Package(
        name=name,
        core_constraint=constraint,
        version=version,
        changelog_top_heading=heading,
        base_version=version if base_version is None else base_version,
        base_changelog_top_heading=base_heading,
        publish_to=publish_to,
    )


AGENT_ON_PUB = published("0.0.1-wip004", "^0.2.2", "0.0.1-wip")


class ReleaseProblemTest(unittest.TestCase):

    def test_new_version_with_matching_heading_is_released(self):
        self.assertIsNone(
            cdd.release_problem(
                package("0.0.1-wip006", "0.0.1-wip006", "0.0.1-wip005"), AGENT_ON_PUB
            )
        )

    def test_folding_unreleased_into_unpublished_heading_is_released(self):
        self.assertIsNone(
            cdd.release_problem(package("0.0.1-wip005", "0.0.1-wip005"), AGENT_ON_PUB)
        )

    def test_unpublished_version_left_by_an_earlier_pull_request_is_not(self):
        # main from 2026-09-29 to 2026-10-05: wip005 with a wip005 heading.
        problem = cdd.release_problem(
            package("0.0.1-wip005", "0.0.1-wip005", base_heading="0.0.1-wip005"),
            AGENT_ON_PUB,
        )
        self.assertIn("changes neither", problem)

    def test_notes_left_under_unreleased_are_not(self):
        problem = cdd.release_problem(
            package("0.0.1-wip006", "Unreleased", "0.0.1-wip005"), AGENT_ON_PUB
        )
        self.assertIn("'Unreleased'", problem)

    def test_version_already_on_pub_is_not(self):
        problem = cdd.release_problem(
            package("0.0.1-wip004", "0.0.1-wip004", "0.0.1-wip003"), AGENT_ON_PUB
        )
        self.assertIn("already on pub.dev", problem)

    def test_version_below_latest_is_not(self):
        problem = cdd.release_problem(
            package("0.0.1-wip003", "0.0.1-wip003", "0.0.1-wip002"), AGENT_ON_PUB
        )
        self.assertIn("would not become the latest", problem)

    def test_prerelease_after_stable_latest_is_not(self):
        problem = cdd.release_problem(
            package("1.1.0-dev.1", "1.1.0-dev.1", "1.0.0"),
            published("1.0.0", "^0.4.0"),
        )
        self.assertIn("would not become the latest", problem)

    def test_unpublishable_package_is_not(self):
        self.assertIn(
            "publish_to",
            cdd.release_problem(
                package(
                    "0.0.1-wip006", "0.0.1-wip006", "0.0.1-wip005", publish_to="none"
                ),
                AGENT_ON_PUB,
            ),
        )
        self.assertIn(
            "no version",
            cdd.release_problem(
                package(None, None, base_version="0.0.1-wip004"), AGENT_ON_PUB
            ),
        )


class CheckTest(unittest.TestCase):

    def run_check(self, new_core, packages, pub):
        with redirect_stdout(io.StringIO()):
            return cdd.check(V(new_core), packages, pub.get)

    def test_fails_for_package_left_unreleased_on_old_minor(self):
        # The #3695 case: core 0.4.0 released while a2ui_agent's notes stayed
        # under Unreleased and pub.dev's wip004 required ^0.2.2.
        packages = [package("0.0.1-wip005", "Unreleased", constraint="^0.4.0")]
        errors = self.run_check("0.4.0", packages, {"a2ui_agent": AGENT_ON_PUB})
        self.assertEqual(len(errors), 1)
        self.assertIn("a2ui_agent 0.0.1-wip004", errors[0])
        self.assertIn("^0.2.2", errors[0])
        self.assertIn("changes neither its version", errors[0])

    def test_passes_when_package_is_released_with_core(self):
        packages = [package("0.0.1-wip005", "0.0.1-wip005")]
        self.assertEqual(
            self.run_check("0.5.0", packages, {"a2ui_agent": AGENT_ON_PUB}), []
        )

    def test_fails_when_released_package_excludes_new_core(self):
        packages = [package("0.0.1-wip005", "0.0.1-wip005", constraint="^0.4.0")]
        errors = self.run_check("0.5.0", packages, {"a2ui_agent": AGENT_ON_PUB})
        self.assertEqual(len(errors), 1)
        self.assertIn("is released here", errors[0])

    def test_passes_when_published_constraint_accepts_new_core(self):
        packages = [package("0.0.1-wip003", "Unreleased", name="a2ui_flutter")]
        pub = {"a2ui_flutter": published("0.0.1-wip003", "^0.4.0")}
        self.assertEqual(self.run_check("0.4.1", packages, pub), [])

    def test_skips_package_not_on_pub(self):
        packages = [package("0.1.0", "Unreleased", name="a2ui_cli")]
        self.assertEqual(self.run_check("0.5.0", packages, {}), [])

    def test_skips_published_version_without_core_dependency(self):
        packages = [package("0.0.1-wip", "Unreleased", name="a2ui_flutter")]
        pub = {"a2ui_flutter": published("0.0.1-wip", None)}
        self.assertEqual(self.run_check("0.5.0", packages, pub), [])


class FakeResponse(io.BytesIO):

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class FetchPublishedTest(unittest.TestCase):

    def test_reads_latest_constraint_and_versions(self):
        body = {
            "name": "a2ui_flutter",
            "latest": {
                "version": "0.0.1-wip003",
                "pubspec": {
                    "dependencies": {
                        "a2ui_core": "^0.4.0",
                        "flutter": {"sdk": "flutter"},
                    }
                },
            },
            "versions": [{"version": "0.0.1-wip002"}, {"version": "0.0.1-wip003"}],
        }
        response = FakeResponse(json.dumps(body).encode())
        with mock.patch("urllib.request.urlopen", return_value=response):
            result = cdd.fetch_published("a2ui_flutter")
        self.assertEqual(
            result,
            cdd.Published(
                frozenset({"0.0.1-wip002", "0.0.1-wip003"}), "0.0.1-wip003", "^0.4.0"
            ),
        )

    def test_missing_package_is_none(self):
        error = urllib.error.HTTPError("u", 404, "Not Found", {}, None)
        with mock.patch("urllib.request.urlopen", side_effect=error):
            self.assertIsNone(cdd.fetch_published("a2ui_cli"))

    def test_other_http_errors_raise(self):
        error = urllib.error.HTTPError("u", 500, "Server Error", {}, None)
        with mock.patch("urllib.request.urlopen", side_effect=error):
            with self.assertRaises(urllib.error.HTTPError):
                cdd.fetch_published("a2ui_agent")


def git(cwd, *args):
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
    )


class MainTest(unittest.TestCase):

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._tmp.name)
        self.write("dart/a2ui_core/pubspec.yaml", "name: a2ui_core\nversion: 0.4.0\n")
        self.write(
            "dart/a2ui_agent/pubspec.yaml",
            "name: a2ui_agent\nversion: 0.0.1-wip004\n"
            "dependencies:\n  a2ui_core: ^0.4.0\n",
        )
        self.write("dart/a2ui_agent/CHANGELOG.md", "# Changelog\n\n## Unreleased\n")
        self.write("dart/example/pubspec.yaml", EXAMPLE_PUBSPEC)
        git(self.root, "init", "-q")
        git(self.root, "add", ".")
        git(self.root, "commit", "-qm", "base")
        self._cwd = os.getcwd()
        os.chdir(self.root)

    def tearDown(self):
        os.chdir(self._cwd)
        self._tmp.cleanup()

    def write(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)

    def run_main(self, pub):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(cdd, "fetch_published", side_effect=pub.get):
            with redirect_stdout(out), redirect_stderr(err):
                code = cdd.main(["--base", "HEAD"])
        return code, out.getvalue(), err.getvalue()

    def test_not_a_core_release(self):
        code, out, _ = self.run_main({})
        self.assertEqual(code, 0)
        self.assertIn("not an a2ui_core release", out)

    def test_fails_for_dependent_left_behind(self):
        self.write("dart/a2ui_core/pubspec.yaml", "name: a2ui_core\nversion: 0.5.0\n")
        self.write(
            "dart/a2ui_agent/pubspec.yaml",
            "name: a2ui_agent\nversion: 0.0.1-wip004\n"
            "dependencies:\n  a2ui_core: ^0.5.0\n",
        )
        code, _, err = self.run_main(
            {"a2ui_agent": published("0.0.1-wip004", "^0.4.0")}
        )
        self.assertEqual(code, 1)
        self.assertIn("a2ui_agent 0.0.1-wip004", err)

    def test_passes_when_dependent_is_released(self):
        self.write("dart/a2ui_core/pubspec.yaml", "name: a2ui_core\nversion: 0.5.0\n")
        self.write(
            "dart/a2ui_agent/pubspec.yaml",
            "name: a2ui_agent\nversion: 0.0.1-wip005\n"
            "dependencies:\n  a2ui_core: ^0.5.0\n",
        )
        self.write("dart/a2ui_agent/CHANGELOG.md", "# Changelog\n\n## 0.0.1-wip005\n")
        code, out, _ = self.run_main(
            {"a2ui_agent": published("0.0.1-wip004", "^0.4.0")}
        )
        self.assertEqual(code, 0)
        self.assertIn("a2ui_agent: released as 0.0.1-wip005", out)
        self.assertNotIn("example", out)

    def test_unknown_base_ref_fails(self):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = cdd.main(["--base", "does-not-exist"])
        self.assertEqual(code, 1)
        self.assertIn("base ref does-not-exist not found", err.getvalue())


if __name__ == "__main__":
    unittest.main()
