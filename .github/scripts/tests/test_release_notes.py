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

"""Tests for .github/scripts/release_notes.py."""

import glob
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import textwrap
import unittest
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import release_notes as rn  # noqa: E402

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
MANIFEST = os.path.join(REPO_ROOT, rn.MANIFEST_PATH)


def spec(**overrides) -> rn.PackageSpec:
    base = dict(
        id="web_core",
        ecosystem="npm",
        name="@a2ui/web_core",
        paths=("typescript/core/web_core/",),
        exclude=("**/*.test.ts",),
        changelog="typescript/core/web_core/CHANGELOG.md",
        tag="npm/web_core/v{version}",
        internal_deps=(),
        pre_1_0_feature_bump="minor",
        auto_tag=True,
    )
    base.update(overrides)
    return rn.PackageSpec(**base)


class FakeGit:
    """Answers `git tag --list` and records every other call."""

    def __init__(self, tags=(), ancestors=(), later=""):
        self.tags = list(tags)
        self.ancestors = set(ancestors)
        self.later = later
        self.calls = []

    def run(self, args):
        self.calls.append(list(args))
        if args[:2] == ["tag", "--list"]:
            pattern = args[2]
            prefix = pattern.rstrip("*")
            return "\n".join(t for t in self.tags if t.startswith(prefix)) + "\n"
        if args[:1] == ["tag"]:
            self.tags.append(args[1])
            return ""
        if args[:2] == ["merge-base", "--is-ancestor"]:
            if args[2] in self.ancestors:
                return ""
            raise subprocess.CalledProcessError(1, ["git", *args])
        if args[:1] == ["log"] and "-G" in args:
            return "abc123\n"
        if args[:1] == ["log"]:
            return self.later
        if args[:1] == ["remote"]:
            return (
                "origin\tgit@github.com:me/fork"
                " (push)\nupstream\tgit@github.com:a2ui-project/a2ui (push)\n"
            )
        return ""


class ParseTitleTest(unittest.TestCase):

    def test_scope_bang_and_pr(self):
        parsed = rn.parse_title("feat(web_core)!: emit keys (#4044)")
        self.assertEqual(parsed.type, "feat")
        self.assertEqual(parsed.scope, "web_core")
        self.assertTrue(parsed.breaking)
        self.assertEqual(parsed.subject, "emit keys")
        self.assertEqual(parsed.pr, 4044)

    def test_no_scope_no_pr(self):
        parsed = rn.parse_title("fix: handle null children")
        self.assertEqual((parsed.type, parsed.scope, parsed.pr), ("fix", None, None))
        self.assertFalse(parsed.breaking)

    def test_every_allowed_type(self):
        for kind in rn.ALLOWED_TYPES:
            with self.subTest(kind=kind):
                self.assertIsNotNone(rn.parse_title(f"{kind}(x): y"))

    def test_rejects_unknown_type_and_bad_shapes(self):
        for bad in ("Fix bug", "feature: x", "fix:x", "fix(a)(b): x", "", "fix(): "):
            with self.subTest(bad=bad):
                self.assertIsNone(rn.parse_title(bad))

    def test_breaking_footer_ignores_comments(self):
        self.assertTrue(rn.has_breaking_footer("x\n\nBREAKING CHANGE: removed foo\n"))
        self.assertTrue(rn.has_breaking_footer("BREAKING-CHANGE: hyphen form"))
        self.assertFalse(rn.has_breaking_footer("<!-- BREAKING CHANGE: no -->\nok"))
        self.assertFalse(rn.has_breaking_footer("no footer here"))


class ManifestTest(unittest.TestCase):

    def _load(self, entries):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump({"packages": entries}, handle)
        self.addCleanup(os.unlink, handle.name)
        return rn.load_manifest(handle.name)

    def _entry(self, **overrides):
        entry = {
            "id": "p",
            "ecosystem": "npm",
            "name": "@a2ui/p",
            "paths": ["typescript/p/"],
            "changelog": "typescript/p/CHANGELOG.md",
            "tag": "npm/p/v{version}",
        }
        entry.update(overrides)
        return entry

    def test_rejects_swiftpm_shaped_tag_for_npm(self):
        for tag in ("v{version}", "{version}", "v{version}+npm"):
            with self.subTest(tag=tag), self.assertRaises(rn.ManifestError):
                self._load([self._entry(tag=tag)])

    def test_accepts_swiftpm_tag_for_swift(self):
        specs = self._load(
            [self._entry(id="swift", ecosystem="swiftpm", tag="v{version}+swift")]
        )
        self.assertEqual(specs[0].tag_for("0.10.0"), "v0.10.0+swift")

    def test_rejects_invalid_manifest_fields(self):
        with self.assertRaises(rn.ManifestError):
            self._load([self._entry(), self._entry()])
        with self.assertRaises(rn.ManifestError):
            self._load([self._entry(tag="npm/p/latest")])
        with self.assertRaises(rn.ManifestError):
            self._load([self._entry(ecosystem="cargo")])
        with self.assertRaises(rn.ManifestError):
            self._load([self._entry(pre_1_0_feature_bump="major")])

    def test_internal_deps_validation_and_topological_order(self):
        with self.assertRaises(rn.ManifestError):
            self._load([self._entry(id="a", internal_deps=["a"])])
        with self.assertRaises(rn.ManifestError):
            self._load([self._entry(id="a", internal_deps=["missing"])])
        with self.assertRaises(rn.ManifestError):
            self._load([
                self._entry(id="a", ecosystem="npm"),
                self._entry(
                    id="b",
                    ecosystem="python",
                    tag="python/b/v{version}",
                    internal_deps=["a"],
                ),
            ])
        with self.assertRaises(rn.ManifestError):
            self._load([
                self._entry(id="a", internal_deps=["b"]),
                self._entry(id="b", internal_deps=["a"]),
            ])
        specs = self._load([
            self._entry(id="app", internal_deps=["lib"]),
            self._entry(id="lib", internal_deps=["core"]),
            self._entry(id="core", internal_deps=[]),
        ])
        self.assertEqual(
            [s.id for s in rn.topological_order(specs)], ["core", "lib", "app"]
        )

    def test_rejects_wildcard_exclude_ending_in_slash(self):
        for pattern in ("**/Tests/", "src/?ests/", "src/[Tt]ests/"):
            with self.subTest(pattern=pattern):
                with self.assertRaises(rn.ManifestError) as ctx:
                    self._load([self._entry(exclude=[pattern])])
                self.assertIn(pattern + "**", str(ctx.exception))
        specs = self._load(
            [self._entry(exclude=["**/Tests/**", "typescript/p/tests/"])]
        )
        self.assertEqual(specs[0].exclude, ("**/Tests/**", "typescript/p/tests/"))

    def test_repository_manifest_covers_every_changelog_and_is_acyclic(self):
        specs = rn.load_manifest(MANIFEST)
        pattern = os.path.join(REPO_ROOT, "**", "CHANGELOG.md")
        skipped = ("/node_modules/", "/.venv/", "/dist/", "/samples/", "/.git/")
        on_disk = sorted(
            os.path.relpath(path, REPO_ROOT)
            for path in glob.glob(pattern, recursive=True)
            if not any(part in path for part in skipped)
        )
        in_manifest = sorted(spec.changelog for spec in specs)
        self.assertEqual(on_disk, in_manifest)
        self.assertEqual(len(in_manifest), len(set(in_manifest)))
        ordered = rn.topological_order(specs)
        self.assertEqual(len(ordered), len(specs))
        by_id = {s.id: s for s in specs}
        self.assertFalse(by_id["a2ui_cli"].auto_tag)
        self.assertFalse(by_id["swift"].auto_tag)
        self.assertTrue(by_id["web_core"].auto_tag)
        self.assertEqual(by_id["dart-a2ui_core"].pre_1_0_feature_bump, "patch")
        self.assertEqual(by_id["web_core"].pre_1_0_feature_bump, "minor")

    def test_python_entries_keep_dependency_order(self):
        python = [s.id for s in rn.load_manifest(MANIFEST) if s.ecosystem == "python"]
        self.assertEqual(
            python, ["a2ui-core", "a2ui-agent-sdk", "a2ui-a2a", "a2ui-adk"]
        )


class TagTest(unittest.TestCase):

    def test_latest_tag_picks_highest_version_and_ignores_strays(self):
        git = FakeGit(
            tags=[
                "npm/web_core/v0.9.0",
                "npm/web_core/v0.15.0",
                "npm/web_core/v0.15.0-rc1",
                "npm/web_core_x/v9.9.9",
            ]
        )
        self.assertEqual(rn.latest_tag(spec(), git), "npm/web_core/v0.15.0")

    def test_latest_tag_with_suffix(self):
        swift = spec(id="swift", ecosystem="swiftpm", tag="v{version}+swift")
        git = FakeGit(tags=["v0.8", "v0.9", "v0.10.0+swift", "v0.11.0+swift"])
        self.assertEqual(rn.latest_tag(swift, git), "v0.11.0+swift")

    def test_anchor_order(self):
        git = FakeGit(tags=["npm/web_core/v0.15.0"])
        self.assertEqual(rn.resolve_anchor(spec(), "abc", git), "abc")
        self.assertEqual(rn.resolve_anchor(spec(), None, git), "npm/web_core/v0.15.0")
        self.assertEqual(
            rn.resolve_anchor(spec(bootstrap_since="boot"), None, FakeGit()), "boot"
        )
        with self.assertRaises(rn.ReleaseNotesError) as ctx:
            rn.resolve_anchor(spec(), None, FakeGit())
        self.assertEqual(ctx.exception.code, rn.EXIT_NO_ANCHOR)

    def test_anchor_refuses_when_newest_heading_is_untagged(self):
        git = FakeGit(tags=["npm/web_core/v0.15.0"])
        stale = "## 0.16.0\n\n- shipped but never tagged\n\n## 0.15.0\n\n- old\n"
        with self.assertRaises(rn.ReleaseNotesError) as ctx:
            rn.resolve_anchor(spec(), None, git, stale)
        self.assertEqual(ctx.exception.code, rn.EXIT_UNTAGGED)
        self.assertIn("tag --package web_core --version 0.16.0", str(ctx.exception))
        for ok in ("## 0.15.0\n- x\n", "## 0.14.0\n- x\n", "## Unreleased\n- x\n", ""):
            with self.subTest(changelog=ok):
                self.assertEqual(
                    rn.resolve_anchor(spec(), None, git, ok), "npm/web_core/v0.15.0"
                )
        self.assertEqual(rn.resolve_anchor(spec(), "abc", git, stale), "abc")

    def test_bootstrap_anchor_refuses_untagged_heading_after_bootstrap(self):
        boot = spec(bootstrap_since="bootsha")
        stale = "## 0.16.0\n\n- shipped\n\n## 0.15.0\n\n- old\n"
        # Heading commit is NOT an ancestor of bootstrap_since -> EXIT_UNTAGGED.
        with self.assertRaises(rn.ReleaseNotesError) as ctx:
            rn.resolve_anchor(boot, None, FakeGit(ancestors=set()), stale)
        self.assertEqual(ctx.exception.code, rn.EXIT_UNTAGGED)
        # Heading commit IS an ancestor of bootstrap_since -> allowed.
        self.assertEqual(
            rn.resolve_anchor(boot, None, FakeGit(ancestors={"abc123"}), stale),
            "bootsha",
        )

    def test_newest_heading(self):
        self.assertEqual(
            rn.newest_heading("## Unreleased\n\n## 0.6.0 (2026-11-10)\n"), "0.6.0"
        )
        self.assertIsNone(rn.newest_heading("# Title\n\n## Unreleased\n"))


class TruncateDiffTest(unittest.TestCase):

    def test_prioritizes_public_export_files_then_smallest(self):
        big_internal = "diff --git a/src/big.ts b/src/big.ts\n+" + ("x" * 200) + "\n"
        small_internal = "diff --git a/src/small.ts b/src/small.ts\n+tiny\n"
        public_index = "diff --git a/src/index.ts b/src/index.ts\n+" + ("y" * 80) + "\n"
        full = big_internal + small_internal + public_index
        # Under limit: unchanged.
        kept, truncated, omitted = rn.truncate_diff(full, 1000)
        self.assertFalse(truncated)
        self.assertEqual(omitted, [])
        self.assertEqual(kept, full)
        # Tight limit: fits public_index + small_internal, omits big_internal.
        limit = len((public_index + small_internal).encode("utf-8")) + 5
        kept, truncated, omitted = rn.truncate_diff(full, limit)
        self.assertTrue(truncated)
        self.assertIn("src/index.ts", kept)
        self.assertIn("src/small.ts", kept)
        self.assertEqual(omitted, ["src/big.ts"])


class FetchPrBodiesTest(unittest.TestCase):

    def _make_packrat_db(self, rows):
        tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        tmp.close()
        self.addCleanup(os.unlink, tmp.name)
        conn = sqlite3.connect(tmp.name)
        conn.execute("CREATE TABLE repos (repo_id INTEGER PRIMARY KEY, full_name TEXT)")
        conn.execute(
            "CREATE TABLE pull_requests (repo_id INTEGER, number INTEGER, body TEXT)"
        )
        conn.execute("INSERT INTO repos VALUES (1, 'a2ui-project/a2ui')")
        for num, body in rows:
            conn.execute("INSERT INTO pull_requests VALUES (1, ?, ?)", (num, body))
        conn.commit()
        conn.close()
        return Path(tmp.name)

    def test_packrat_then_graphql_fallback(self):
        db = self._make_packrat_db([(10, "from packrat")])
        queries = []

        def fake_gql(query, timeout):
            queries.append(query)
            return {
                "data": {
                    "rateLimit": {"cost": 1, "remaining": 4999, "resetAt": "soon"},
                    "repository": {"pr_20": {"body": "from graphql"}},
                }
            }

        bodies, source, errors = rn.fetch_pr_bodies(
            "a2ui-project/a2ui",
            [10, 20],
            packrat_db=db,
            graphql_runner=fake_gql,
        )
        self.assertEqual(bodies, {10: "from packrat", 20: "from graphql"})
        self.assertEqual(source, "packrat+graphql")
        self.assertEqual(errors, 0)
        self.assertEqual(len(queries), 1)
        self.assertIn("pr_20:", queries[0])
        self.assertNotIn("pr_10:", queries[0])

    def test_graphql_budget_exhaustion_falls_back_to_commit(self):
        db = self._make_packrat_db([])
        now = [0.0]

        def fake_clock():
            return now[0]

        def slow_gql(query, timeout):
            now[0] += 100.0
            return None

        bodies, source, errors = rn.fetch_pr_bodies(
            "a2ui-project/a2ui",
            [1, 2, 3],
            budget_seconds=50.0,
            packrat_db=db,
            graphql_runner=slow_gql,
            clock=fake_clock,
        )
        self.assertEqual(bodies, {})
        self.assertEqual(source, "commit")
        self.assertEqual(errors, 3)

    def test_commit_source_skips_packrat_and_graphql(self):
        bodies, source, errors = rn.fetch_pr_bodies(
            "a2ui-project/a2ui", [1, 2], source="commit"
        )
        self.assertEqual((bodies, source, errors), ({}, "commit", 0))

    def test_next_chunk_size_and_empty_packrat_body_fallback(self):
        self.assertEqual(rn._next_chunk_size(50, 10, 50), 0)
        self.assertEqual(rn._next_chunk_size(50, 200, 200), 25)
        db = self._make_packrat_db([(10, "")])
        bodies, source, errors = rn.fetch_pr_bodies(
            "a2ui-project/a2ui", [10], source="packrat", packrat_db=db
        )
        self.assertEqual(bodies, {})
        self.assertEqual(source, "commit")
        self.assertEqual(errors, 0)


class CheckNotesTest(unittest.TestCase):

    def test_pre_1_0_web_core_breaking_requires_minor_not_major(self):
        api = {
            "status": "ok",
            "removed": [{"symbol": "Surface.catalog", "kind": "property"}],
            "changed": [],
            "added": [],
        }
        ctx = {"package": "web_core", "current_version": "0.15.0"}
        good_gen = {
            "recommended_bump": "MINOR",
            "bullets": ["- **BREAKING CHANGE**: Removed `Surface.catalog`."],
            "human_review_flags": [],
        }
        passed, violations = rn.check_notes(spec(), api, good_gen, ctx)
        self.assertTrue(passed, violations)

        bad_major = {**good_gen, "recommended_bump": "MAJOR"}
        passed, violations = rn.check_notes(spec(), api, bad_major, ctx)
        self.assertFalse(passed)
        self.assertEqual(violations[0]["rule"], "semver_consistency")

        bad_patch = {**good_gen, "recommended_bump": "PATCH"}
        passed, violations = rn.check_notes(spec(), api, bad_patch, ctx)
        self.assertFalse(passed)

    def test_post_1_0_breaking_requires_major(self):
        api = {
            "status": "ok",
            "removed": [{"symbol": "Surface.catalog", "kind": "property"}],
            "changed": [],
            "added": [],
        }
        ctx = {"package": "web_core", "current_version": "1.2.0"}
        gen_minor = {
            "recommended_bump": "MINOR",
            "bullets": ["- **BREAKING CHANGE**: Removed `Surface.catalog`."],
            "human_review_flags": [],
        }
        passed, violations = rn.check_notes(spec(), api, gen_minor, ctx)
        self.assertFalse(passed)
        self.assertEqual(violations[0]["rule"], "semver_consistency")

        gen_major = {**gen_minor, "recommended_bump": "MAJOR"}
        passed, violations = rn.check_notes(spec(), api, gen_major, ctx)
        self.assertTrue(passed, violations)

    def test_pre_1_0_feature_bump_differs_for_npm_vs_dart(self):
        api = {
            "status": "ok",
            "removed": [],
            "changed": [],
            "added": [{"symbol": "NewWidget", "kind": "class"}],
        }
        gen_patch = {
            "recommended_bump": "PATCH",
            "bullets": ["- Add `NewWidget`."],
            "human_review_flags": [],
        }
        # npm (pre_1_0_feature_bump="minor") rejects PATCH for additions.
        passed, _ = rn.check_notes(
            spec(), api, gen_patch, {"current_version": "0.15.0"}
        )
        self.assertFalse(passed)
        # Dart (pre_1_0_feature_bump="patch") accepts PATCH and rejects MINOR for additions.
        dart = spec(
            id="dart-a2ui_core",
            ecosystem="pub",
            pre_1_0_feature_bump="patch",
            breaking_prefix="Breaking: ",
        )
        passed, violations = rn.check_notes(
            dart, api, gen_patch, {"current_version": "0.8.0"}
        )
        self.assertTrue(passed, violations)
        gen_minor = {**gen_patch, "recommended_bump": "MINOR"}
        passed, _ = rn.check_notes(dart, api, gen_minor, {"current_version": "0.8.0"})
        self.assertFalse(passed)

    def test_breaking_hint_enforced_in_degraded_mode_and_word_boundary_symbols(self):
        degraded = {"status": "unavailable", "reason": "ecosystem_not_supported"}
        ctx = {
            "current_version": "0.8.0",
            "commits": [
                {"pr": 99, "sha": "a" * 40, "breaking_hint": True, "net_zero": False}
            ],
        }
        # Missing breaking bullet and missing #99 flag -> FAIL.
        gen = {
            "recommended_bump": "PATCH",
            "bullets": ["- Fix minor bug."],
            "human_review_flags": ["no_static_api_diff"],
        }
        passed, violations = rn.check_notes(spec(), degraded, gen, ctx)
        self.assertFalse(passed)
        self.assertTrue(any("#99" in v["issue"] for v in violations))

        # Word-boundary symbol match: Surface is NOT satisfied by SurfaceManager.
        api = {
            "status": "ok",
            "removed": [{"symbol": "Surface", "kind": "class"}],
            "changed": [],
            "added": [],
        }
        gen_substr = {
            "recommended_bump": "MINOR",
            "bullets": ["- **BREAKING CHANGE**: Updated `SurfaceManager`."],
            "human_review_flags": [],
        }
        passed, _ = rn.check_notes(
            spec(), api, gen_substr, {"current_version": "0.8.0"}
        )
        self.assertFalse(passed)

    def test_missing_symbols_prefix_unknown_flag_and_degraded_mode(self):
        api = {
            "status": "ok",
            "removed": [{"symbol": "OldFn", "kind": "function"}],
            "changed": [
                {"symbol": "StrictFn", "kind": "function", "breaking": True},
                {"symbol": "MaybeFn", "kind": "function", "breaking": "unknown"},
            ],
            "added": [{"symbol": "NewFn", "kind": "function"}],
        }
        gen = {
            "recommended_bump": "MINOR",
            "bullets": [
                "- Removed `OldFn` without breaking prefix.",
                "- Updated `StrictFn` without breaking prefix.",
                "- Updated `MaybeFn`.",
            ],
            "human_review_flags": [],
        }
        passed, violations = rn.check_notes(
            spec(), api, gen, {"current_version": "0.5.0"}
        )
        self.assertFalse(passed)
        issues = "\n".join(v["issue"] for v in violations)
        self.assertIn("OldFn", issues)
        self.assertIn("StrictFn", issues)
        self.assertIn("MaybeFn", issues)
        self.assertIn("NewFn", issues)

        # Degraded mode requires `no_static_api_diff`.
        degraded = {"status": "unavailable", "reason": "ecosystem_not_supported"}
        gen_no_flag = {
            "recommended_bump": "PATCH",
            "bullets": ["- Fix null handling."],
            "human_review_flags": [],
        }
        passed, violations = rn.check_notes(
            spec(), degraded, gen_no_flag, {"current_version": "0.5.0"}
        )
        self.assertFalse(passed)
        self.assertIn("no_static_api_diff", violations[0]["issue"])

        gen_with_flag = {**gen_no_flag, "human_review_flags": ["no_static_api_diff"]}
        passed, violations = rn.check_notes(
            spec(), degraded, gen_with_flag, {"current_version": "0.5.0"}
        )
        self.assertTrue(passed, violations)

    def test_empty_bullets_requires_none_bump(self):
        api = {"status": "ok", "removed": [], "changed": [], "added": []}
        ctx = {"current_version": "0.5.0"}
        passed, _ = rn.check_notes(
            spec(), api, {"recommended_bump": "NONE", "bullets": []}, ctx
        )
        self.assertTrue(passed)
        passed, _ = rn.check_notes(
            spec(), api, {"recommended_bump": "PATCH", "bullets": []}, ctx
        )
        self.assertFalse(passed)


class ChangelogReadingAndWritingTest(unittest.TestCase):

    CHANGELOG = textwrap.dedent("""\
        # Title

        ## Unreleased

        - Old pending note.

        ## 0.16.0

        <!-- release-notes: web_core 0.16.0 range npm/web_core/v0.15.0..abc -->

        - New thing ([#1](https://github.com/a2ui-project/a2ui/pull/1))

        ## 0.15.0 (2026-10-01)

        - Older.
        """)

    def test_read_section_strips_range_comment_and_accepts_legacy_dates(self):
        self.assertEqual(
            rn.read_section(self.CHANGELOG, "0.16.0"),
            "- New thing ([#1](https://github.com/a2ui-project/a2ui/pull/1))",
        )
        self.assertEqual(rn.read_section(self.CHANGELOG, "0.15.0"), "- Older.")
        with self.assertRaises(rn.ReleaseNotesError) as ctx:
            rn.read_section(self.CHANGELOG, "0.14.0")
        self.assertEqual(ctx.exception.code, rn.EXIT_NO_SECTION)

    def test_heading_version_skips_unreleased(self):
        self.assertEqual(rn.heading_version(self.CHANGELOG, "0.15.0"), "0.16.0")
        self.assertEqual(rn.heading_version(self.CHANGELOG, None), "0.16.0")
        with self.assertRaises(rn.ReleaseNotesError):
            rn.heading_version(self.CHANGELOG, "0.16.0")

    def test_write_section_undated_and_carry_unreleased(self):
        python = spec(id="a2ui-core", ecosystem="python")
        updated = rn.write_section(
            python,
            "0.17.0",
            "t1",
            "abc",
            ["- Add streaming support."],
            carry_unreleased=True,
            existing_changelog=self.CHANGELOG,
        )
        self.assertIn(
            "## 0.17.0\n\n<!-- release-notes: a2ui-core 0.17.0 range t1..abc -->",
            updated,
        )
        self.assertIn(rn.CARRIED_MARKER + "\n- Old pending note.", updated)
        self.assertNotIn("## Unreleased", updated)
        # Writing an existing or older version is refused.
        with self.assertRaises(rn.ReleaseNotesError):
            rn.write_section(
                python, "0.17.0", "t1", "abc", ["- dup"], existing_changelog=updated
            )
        # verify_release catches duplicate headings.
        dup = "## 0.17.0\n\n- a\n\n## 0.17.0\n\n- b\n"
        errors, _ = rn.verify_release(python, "0.17.0", dup, FakeGit())
        self.assertTrue(any("duplicate" in e for e in errors))

    def test_github_default_revert_title_pairs(self):
        c1 = rn.Commit("a" * 40, "feat(pkg): add x (#10)", "", ("pkg/a.ts",))
        c2 = rn.Commit(
            "b" * 40,
            'Revert "feat(pkg): add x (#10)" (#11)',
            "This reverts commit " + "a" * 40 + ".",
            ("pkg/a.ts",),
        )
        self.assertEqual(rn._reverted_shas([c1, c2]), {"a" * 40, "b" * 40})


class VerifyReleaseTest(unittest.TestCase):

    GOOD = (
        "## 0.16.0\n\n<!-- release-notes: web_core 0.16.0 range t..u -->\n\n- x\n\n##"
        " 0.15.0\n\n- y\n"
    )

    def test_clean(self):
        git = FakeGit(ancestors={"u"})
        errors, warnings = rn.verify_release(spec(), "0.16.0", self.GOOD, git)
        self.assertEqual((errors, warnings), ([], []))

    def test_later_commits_warn(self):
        git = FakeGit(ancestors={"u"}, later="1234567 feat: later\n")
        errors, warnings = rn.verify_release(spec(), "0.16.0", self.GOOD, git)
        self.assertEqual(errors, [])
        self.assertIn("feat: later", warnings[0])

    def test_errors(self):
        bad = (
            "## Unreleased\n\n## 0.15.0\n\n- y\n\n## 0.16.0\n\n<!-- release-notes:"
            " web_core 0.16.0 range t..u -->\n\n- x\n"
        )
        git = FakeGit(tags=["npm/web_core/v0.16.0"])
        errors, _ = rn.verify_release(spec(), "0.16.0", bad, git)
        joined = "\n".join(errors)
        self.assertIn("Unreleased", joined)
        self.assertIn("descending", joined)
        self.assertIn("already exists", joined)
        self.assertIn("not an ancestor", joined)


class _Response(io.BytesIO):

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def fetch_factory(status_by_url):
    def fetch(url):
        status = status_by_url.get(url, 404)
        if status == 404:
            raise urllib.error.HTTPError(url, 404, "nf", {}, None)
        return _Response(
            json.dumps(status).encode() if not isinstance(status, bytes) else status
        )

    return fetch


class TagReleaseTest(unittest.TestCase):

    def test_refuses_when_registry_lacks_version(self):
        with self.assertRaises(rn.ReleaseNotesError) as ctx:
            rn.tag_release(spec(), "0.16.0", FakeGit(), fetch=fetch_factory({}))
        self.assertEqual(ctx.exception.code, rn.EXIT_TAG_REFUSED)

    def test_tags_when_npm_serves_it(self):
        git = FakeGit()
        url = "https://registry.npmjs.org/@a2ui%2Fweb_core/0.16.0"
        out = rn.tag_release(spec(), "0.16.0", git, fetch=fetch_factory({url: {}}))
        self.assertEqual(out, "tagged abc123 as npm/web_core/v0.16.0")
        self.assertIn(["tag", "npm/web_core/v0.16.0", "abc123"], git.calls)
        self.assertIn(["push", "upstream", "npm/web_core/v0.16.0"], git.calls)

    def test_pub_checks_versions_list(self):
        dart = spec(
            id="d", ecosystem="pub", name="a2ui_core", tag="dart/a2ui_core/v{version}"
        )
        url = "https://pub.dev/api/packages/a2ui_core"
        out = rn.tag_release(
            dart,
            "0.8.0",
            FakeGit(),
            fetch=fetch_factory({url: {"versions": [{"version": "0.8.0"}]}}),
            dry_run=True,
        )
        self.assertEqual(out, "would tag abc123 as dart/a2ui_core/v0.8.0")


class TagPendingTest(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = self.tmp.name

    def _changelog(self, rel, text):
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(text)

    def test_tag_pending_skips_auto_tag_false_including_a2ui_cli(self):
        self._changelog("typescript/core/web_core/CHANGELOG.md", "## 0.16.0\n- x\n")
        self._changelog("dart/a2ui_cli/CHANGELOG.md", "## 0.4.0\n- x\n")
        self._changelog("swift/CHANGELOG.md", "## 0.11.0\n- x\n")
        specs = [
            spec(),
            spec(
                id="a2ui_cli",
                ecosystem="pub",
                name="a2ui_cli",
                changelog="dart/a2ui_cli/CHANGELOG.md",
                tag="cli-v{version}",
                auto_tag=False,
            ),
            spec(
                id="swift",
                ecosystem="swiftpm",
                name="a2ui",
                changelog="swift/CHANGELOG.md",
                tag="v{version}+swift",
                auto_tag=False,
            ),
        ]
        git = FakeGit()
        served = fetch_factory({
            "https://registry.npmjs.org/@a2ui%2Fweb_core/0.16.0": {},
            "https://pub.dev/api/packages/a2ui_cli": {
                "versions": [{"version": "0.4.0"}]
            },
        })
        lines = rn.tag_pending(specs, self.root, git, fetch=served)
        self.assertEqual(
            lines,
            [
                "tagged abc123 as npm/web_core/v0.16.0",
                "skip a2ui_cli 0.4.0: auto_tag is disabled; tag it by hand",
                "skip swift 0.11.0: auto_tag is disabled; tag it by hand",
            ],
        )


class CheckPrTest(unittest.TestCase):

    SPECS = [
        spec(),
        spec(
            id="lit",
            paths=("typescript/renderers/lit/",),
            changelog="typescript/renderers/lit/CHANGELOG.md",
        ),
    ]
    PKG = ["typescript/core/web_core/src/index.ts"]
    CHANGELOG = "typescript/core/web_core/CHANGELOG.md"

    def rules(self, title, body="", labels=(), paths=()):
        return [
            (v.rule, v.level)
            for v in rn.check_pr(title, body, labels, paths, self.SPECS)
        ]

    def test_l1_l2_l6_matrix(self):
        cases = [
            ("Update stuff", "", (), (), [("L1", "error")]),
            ("feat(web_core): x", "", (), self.PKG, []),
            ("feat(web_core)!: x", "", (), self.PKG, [("L2", "error")]),
            ("feat(web_core)!: x", "", ("breaking-change",), self.PKG, []),
            ("feat(web_core)!: x", "BREAKING CHANGE: z", (), self.PKG, []),
            (
                "feat(web_core): x",
                "",
                ("breaking-change",),
                self.PKG,
                [("L2", "error")],
            ),
            (
                "feat(web_core): x",
                "BREAKING CHANGE: z",
                (),
                self.PKG,
                [("L2", "error")],
            ),
            (
                "fix(web_core): x",
                "",
                (),
                [self.CHANGELOG, *self.PKG],
                [("L6", "error")],
            ),
            ("release(npm): web_core 0.16.0", "", (), [self.CHANGELOG], []),
            ("chore(release): bump web_core", "", (), [self.CHANGELOG], []),
            ("docs(web_core): fix typo", "", ("changelog-edit",), [self.CHANGELOG], []),
            ("docs(samples): notes", "", (), ["samples/client/lit/CHANGELOG.md"], []),
        ]
        for title, body, labels, paths, expected in cases:
            with self.subTest(title=title, labels=labels, paths=paths):
                self.assertEqual(self.rules(title, body, labels, paths), expected)

    def test_l6_message_references_title_or_description_not_block(self):
        lit = "typescript/renderers/lit/CHANGELOG.md"
        violations = rn.check_pr(
            "fix(web_core): x", "", (), [lit, self.CHANGELOG], self.SPECS
        )
        self.assertEqual([v.rule for v in violations], ["L6"])
        self.assertIn(f"{self.CHANGELOG}, {lit}", violations[0].message)
        self.assertIn(
            "Describe consumer-facing changes in the PR title or description",
            violations[0].message,
        )
        self.assertNotIn("release-notes block", violations[0].message)

    def test_l1_title_length(self):
        head = "feat(web_core): "
        fits = head + "x" * (rn.MAX_TITLE_LENGTH - len(head))
        self.assertEqual(self.rules(fits, "", (), self.PKG), [])
        self.assertEqual(self.rules(fits + " (#4215)", "", (), self.PKG), [])
        too_long = fits + "y"
        violations = rn.check_pr(too_long, "", (), self.PKG, self.SPECS)
        self.assertEqual([(v.rule, v.level) for v in violations], [("L1", "error")])


class GoldenRepoTest(unittest.TestCase):
    """Runs `context`, `check-notes`, `write-section`, `verify-release`, `tag` end to end."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = cls.tmp.name
        env = {
            **os.environ,
            "GIT_AUTHOR_NAME": "t",
            "GIT_AUTHOR_EMAIL": "t@x",
            "GIT_COMMITTER_NAME": "t",
            "GIT_COMMITTER_EMAIL": "t@x",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
        }
        cls.env = env

        def git(*args):
            return subprocess.run(
                ["git", *args],
                cwd=cls.root,
                env=env,
                check=True,
                capture_output=True,
                text=True,
            ).stdout

        def write(path, text):
            full = os.path.join(cls.root, path)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as handle:
                handle.write(text)

        def commit_file(path, text, title, body=""):
            write(path, text)
            git("add", "-A")
            git("commit", "-q", "-m", title, "-m", body)

        git("init", "-q", "-b", "main")
        manifest = {
            "packages": [
                {
                    "id": "core",
                    "ecosystem": "npm",
                    "name": "@x/core",
                    "paths": ["core/"],
                    "exclude": ["**/*.test.ts", "**/*.md"],
                    "changelog": "core/CHANGELOG.md",
                    "tag": "npm/core/v{version}",
                    "internal_deps": [],
                    "pre_1_0_feature_bump": "minor",
                    "auto_tag": True,
                },
                {
                    "id": "pkg",
                    "ecosystem": "npm",
                    "name": "@x/pkg",
                    "paths": ["pkg/"],
                    "exclude": ["**/*.test.ts", "**/*.md"],
                    "changelog": "pkg/CHANGELOG.md",
                    "tag": "npm/pkg/v{version}",
                    "internal_deps": ["core"],
                    "pre_1_0_feature_bump": "minor",
                    "auto_tag": True,
                },
            ]
        }
        write(".github/release_packages.json", json.dumps(manifest))
        write("core/CHANGELOG.md", "# core\n\n## 0.1.0\n\n- Init.\n")
        commit_file(
            "pkg/CHANGELOG.md",
            "# pkg\n\n## Unreleased\n\n- Pending note.\n\n## 0.1.0\n\n- First.\n",
            "chore: init (#1)",
        )
        git("tag", "npm/core/v0.1.0")
        git("tag", "npm/pkg/v0.1.0")

        commit_file(
            "pkg/src/index.ts", "export const a = 1;\n", "feat(pkg): add a (#2)"
        )
        commit_file("pkg/src/b.ts", "export const b = 2;\n", "fix(pkg): fix b (#3)")
        commit_file("pkg/src/d.ts", "export const d = 1;\n", "feat(pkg): add d (#6)")
        reverted_sha = git("rev-parse", "HEAD").strip()
        os.remove(os.path.join(cls.root, "pkg/src/d.ts"))
        git("add", "-A")
        git(
            "commit",
            "-q",
            "-m",
            "revert: feat(pkg): add d (#6) (#7)",
            "-m",
            f"This reverts commit {reverted_sha}.",
        )
        commit_file("pkg/src/a.test.ts", "t", "test(pkg): cover a (#8)")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def run_cli(self, *args):
        out, err = io.StringIO(), io.StringIO()
        old = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = out, err
        try:
            code = rn.main(["--repo-root", self.root, *args])
        finally:
            sys.stdout, sys.stderr = old
        return code, out.getvalue(), err.getvalue()

    def test_context_dep_changelog_and_net_zero(self):
        dep_file = os.path.join(self.root, "core_draft.md")
        with open(dep_file, "w", encoding="utf-8") as handle:
            handle.write("## 0.2.0\n\n- **BREAKING CHANGE**: Renamed `Core`.\n")
        self.addCleanup(os.unlink, dep_file)

        code, out, err = self.run_cli(
            "context",
            "--package",
            "pkg",
            "--body-source",
            "commit",
            "--carry-unreleased",
            "--dep-changelog",
            f"core={dep_file}",
        )
        self.assertEqual(code, 0, err)
        ctx = json.loads(out)
        self.assertEqual(ctx["package"], "pkg")
        self.assertEqual(ctx["current_version"], "0.1.0")
        self.assertEqual(ctx["since"], "npm/pkg/v0.1.0")
        self.assertEqual(ctx["carried_unreleased"], "- Pending note.")
        self.assertEqual(len(ctx["internal_dep_notes"]), 1)
        self.assertEqual(ctx["internal_dep_notes"][0]["package"], "core")
        self.assertIn("Renamed `Core`", ctx["internal_dep_notes"][0]["markdown"])

        by_pr = {c["pr"]: c for c in ctx["commits"]}
        self.assertFalse(by_pr[2]["net_zero"])
        self.assertEqual(by_pr[2]["files"], ["pkg/src/index.ts"])
        self.assertTrue(by_pr[6]["net_zero"])
        self.assertTrue(by_pr[7]["net_zero"])
        self.assertNotIn(8, by_pr)

    def test_write_section_round_trip_with_verify_release_and_check_notes(self):
        ctx_code, ctx_out, _ = self.run_cli(
            "context", "--package", "pkg", "--body-source", "commit"
        )
        self.assertEqual(ctx_code, 0)
        ctx_data = json.loads(ctx_out)

        with tempfile.TemporaryDirectory() as tmpdir:
            ctx_path = os.path.join(tmpdir, "context.json")
            api_path = os.path.join(tmpdir, "api.json")
            notes_path = os.path.join(tmpdir, "gen.json")
            with open(ctx_path, "w", encoding="utf-8") as h:
                json.dump(ctx_data, h)
            with open(api_path, "w", encoding="utf-8") as h:
                json.dump(
                    {
                        "status": "ok",
                        "removed": [],
                        "changed": [],
                        "added": [{"symbol": "a", "kind": "const"}],
                    },
                    h,
                )
            with open(notes_path, "w", encoding="utf-8") as h:
                json.dump(
                    {
                        "recommended_bump": "MINOR",
                        "bullets": [
                            (
                                "- Add `a`"
                                " ([#2](https://github.com/a2ui-project/a2ui/pull/2))"
                            ),
                            (
                                "- Fix `b`"
                                " ([#3](https://github.com/a2ui-project/a2ui/pull/3))"
                            ),
                        ],
                        "human_review_flags": [],
                    },
                    h,
                )

            code, out, err = self.run_cli(
                "check-notes",
                "--api",
                api_path,
                "--notes",
                notes_path,
                "--context",
                ctx_path,
            )
            self.assertEqual(code, 0, err)
            self.assertEqual(json.loads(out)["verdict"], "PASS")

            code, _, err = self.run_cli(
                "write-section",
                "--package",
                "pkg",
                "--version",
                "0.2.0",
                "--since",
                ctx_data["since"],
                "--until",
                ctx_data["until"],
                "--bullets-file",
                notes_path,
                "--carry-unreleased",
            )
            self.assertEqual(code, 0, err)

        code, out, _ = self.run_cli(
            "read-section", "--package", "pkg", "--version", "0.2.0"
        )
        self.assertEqual(code, 0)
        self.assertIn("- Add `a`", out)

        subprocess.run(
            ["git", "commit", "-qam", "release(pkg): 0.2.0 (#11)"],
            cwd=self.root,
            env=self.env,
            check=True,
        )
        code, _, err = self.run_cli(
            "verify-release", "--package", "pkg", "--version", "0.2.0"
        )
        self.assertEqual(code, 0, err)

        # Generating context again before tagging exits 6.
        code, _, err = self.run_cli(
            "context", "--package", "pkg", "--body-source", "commit"
        )
        self.assertEqual(code, rn.EXIT_UNTAGGED)
        self.assertIn("'## 0.2.0'", err)

    def test_check_pr_cli(self):
        code, _, err = self.run_cli(
            "check-pr",
            "--title",
            "feat(pkg)!: x",
            "--body",
            "",
            "--paths",
            "pkg/src/a.ts",
        )
        self.assertEqual(code, rn.EXIT_USAGE)
        self.assertIn("[L2]", err)
        self.assertNotIn("[L3]", err)
        code, out, _ = self.run_cli(
            "check-pr",
            "--title",
            "fix(pkg): x",
            "--body",
            "",
            "--paths",
            "pkg/src/a.ts",
        )
        self.assertEqual(code, 0)
        self.assertIn("ok:", out)


if __name__ == "__main__":
    unittest.main()
