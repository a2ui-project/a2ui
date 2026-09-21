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

"""Tests for .github/scripts/confirm_pypi.py."""

import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import confirm_pypi as cp  # noqa: E402

PLAN = [
    {
        "pypi_name": "a2ui-core",
        "version": "0.1.2",
        "tag": "python/a2ui-core/v0.1.2",
        "notes": "- Fixed a thing.",
    },
    {
        "pypi_name": "a2ui-agent-sdk",
        "version": "0.6.1",
        "tag": "python/a2ui-agent-sdk/v0.6.1",
        "notes": "- Added a thing.",
    },
]


class FakeClock:
    """A monotonic clock that only advances when sleep is called."""

    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class WaitForAllTest(unittest.TestCase):

    def test_returns_immediately_when_already_published(self):
        clock = FakeClock()
        calls = []

        def checker(name, version):
            calls.append((name, version))
            return True

        result = cp.wait_for_all(
            PLAN, 600, 30, sleep=clock.sleep, clock=clock, checker=checker
        )
        self.assertEqual(result, {"a2ui-core": True, "a2ui-agent-sdk": True})
        self.assertEqual(len(calls), 2)
        self.assertEqual(clock.now, 0.0, "should not have slept")

    def test_waits_until_a_late_package_appears(self):
        clock = FakeClock()

        def checker(name, version):
            if name == "a2ui-core":
                return True
            return clock.now >= 90

        result = cp.wait_for_all(
            PLAN, 600, 30, sleep=clock.sleep, clock=clock, checker=checker
        )
        self.assertTrue(all(result.values()))
        self.assertGreaterEqual(clock.now, 90)

    def test_stops_checking_a_package_once_it_is_published(self):
        clock = FakeClock()
        calls = []

        def checker(name, version):
            calls.append((name, clock.now))
            return name == "a2ui-core"

        cp.wait_for_all(PLAN, 90, 30, sleep=clock.sleep, clock=clock, checker=checker)
        core_calls = [c for c in calls if c[0] == "a2ui-core"]
        self.assertEqual(len(core_calls), 1)

    def test_gives_up_at_the_timeout(self):
        clock = FakeClock()
        result = cp.wait_for_all(
            PLAN,
            60,
            30,
            sleep=clock.sleep,
            clock=clock,
            checker=lambda name, version: False,
        )
        self.assertEqual(result, {"a2ui-core": False, "a2ui-agent-sdk": False})
        self.assertLessEqual(clock.now, 90)

    def test_partial_success_is_reported_per_package(self):
        clock = FakeClock()
        result = cp.wait_for_all(
            PLAN,
            60,
            30,
            sleep=clock.sleep,
            clock=clock,
            checker=lambda name, version: name == "a2ui-core",
        )
        self.assertTrue(result["a2ui-core"])
        self.assertFalse(result["a2ui-agent-sdk"])


class ReleaseNotesTest(unittest.TestCase):

    def test_published_notes_include_the_pypi_link_and_install_command(self):
        body = cp.release_notes(PLAN[0], published=True)
        self.assertIn("- Fixed a thing.", body)
        self.assertIn("https://pypi.org/project/a2ui-core/0.1.2/", body)
        self.assertIn("pip install a2ui-core==0.1.2", body)

    def test_unpublished_notes_say_so(self):
        body = cp.release_notes(PLAN[0], published=False)
        self.assertIn("- Fixed a thing.", body)
        self.assertNotIn("pip install", body)
        self.assertIn("has not completed", body)

    def test_original_changelog_entries_are_preserved(self):
        for published in (True, False):
            with self.subTest(published=published):
                body = cp.release_notes(PLAN[1], published=published)
                self.assertIn("- Added a thing.", body)

    def test_notes_end_with_a_single_newline(self):
        body = cp.release_notes(PLAN[0], published=True)
        self.assertTrue(body.endswith("\n"))
        self.assertFalse(body.endswith("\n\n"))

    def test_handles_missing_notes_field(self):
        entry = {"pypi_name": "a2ui-core", "version": "0.1.2", "tag": "t"}
        body = cp.release_notes(entry, published=True)
        self.assertIn("pip install a2ui-core==0.1.2", body)


class ParseTagTest(unittest.TestCase):

    def test_parses_both_package_tags(self):
        self.assertEqual(
            cp.parse_tag("python/a2ui-core/v0.1.2"), ("a2ui-core", "0.1.2")
        )
        self.assertEqual(
            cp.parse_tag("python/a2ui-agent-sdk/v0.6.1"),
            ("a2ui-agent-sdk", "0.6.1"),
        )

    def test_ignores_protocol_specification_tags(self):
        """`v0.8` and `v0.9` are spec versions, not package releases."""
        for tag in ("v0.8", "v0.9", "v1.0"):
            with self.subTest(tag=tag):
                self.assertIsNone(cp.parse_tag(tag))

    def test_ignores_malformed_tags(self):
        for tag in (
            "python/a2ui-core/v0.1",
            "python/a2ui-core/0.1.2",
            "python-a2ui-core-v0.1.2",
            "a2ui-core-v0.1.2",
            "python/a2ui-core/vnext",
            "",
        ):
            with self.subTest(tag=tag):
                self.assertIsNone(cp.parse_tag(tag))

    def test_round_trips_with_multi_digit_versions(self):
        self.assertEqual(
            cp.parse_tag("python/a2ui-core/v10.20.30"), ("a2ui-core", "10.20.30")
        )


class PendingMarkerTest(unittest.TestCase):

    def test_pending_notes_contain_the_marker(self):
        """The backstop finds work by searching for this exact string."""
        body = cp.release_notes(PLAN[0], published=False)
        self.assertIn(cp.PENDING_MARKER, body)

    def test_published_notes_drop_the_marker(self):
        body = cp.release_notes(PLAN[0], published=True)
        self.assertNotIn(cp.PENDING_MARKER, body)

    def test_changelog_survives_a_pending_to_published_rewrite(self):
        """The backstop recovers notes by splitting on the separator."""
        pending = cp.release_notes(PLAN[0], published=False)
        recovered = pending.split("\n---\n")[0].strip()
        self.assertEqual(recovered, "- Fixed a thing.")


class DiscoverPendingTest(unittest.TestCase):

    @mock.patch("subprocess.run")
    def test_parses_releases_and_filters_pending(self, mock_run):
        mock_releases = [
            {
                "tagName": "python/a2ui-core/v0.1.2",
                "body": "- Fixed bug.\n---\n" + cp.PENDING_MARKER,
            },
            {
                "tagName": "python/a2ui-core/v0.1.1",
                "body": "- Older release.\n---\nPublished to PyPI.",
            },
            {
                "tagName": "v0.9",
                "body": "Spec release.\n---\n" + cp.PENDING_MARKER,
            },
        ]
        mock_run.return_value = mock.Mock(stdout=json.dumps(mock_releases))
        pending = cp.discover_pending(limit=50)
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["pypi_name"], "a2ui-core")
        self.assertEqual(pending[0]["version"], "0.1.2")
        self.assertEqual(pending[0]["notes"], "- Fixed bug.")

    @mock.patch("subprocess.run")
    def test_handles_invalid_json(self, mock_run):
        mock_run.return_value = mock.Mock(stdout="not valid json")
        self.assertEqual(cp.discover_pending(limit=50), [])

    @mock.patch("subprocess.run")
    def test_excludes_drafts(self, mock_run):
        """A draft has no tag yet, so it can only crowd out real releases."""
        mock_run.return_value = mock.Mock(stdout="[]")
        cp.discover_pending()
        self.assertIn("--exclude-drafts", mock_run.call_args.args[0])


class UpdateReleaseTest(unittest.TestCase):

    @mock.patch("subprocess.run")
    def test_does_not_claim_the_latest_badge(self, mock_run):
        """Two packages confirm in publication order, so --latest is arbitrary."""
        cp.update_release(PLAN[0], published=True)
        self.assertNotIn("--latest", mock_run.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
