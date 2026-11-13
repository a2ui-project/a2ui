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

import datetime
import glob
import io
import json
import os
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


class ReleaseNotesBlockTest(unittest.TestCase):

    BODY = textwrap.dedent("""\
        ## Summary
        Something.

        ```release-notes
        - [web_core] `dispose()` now disposes surfaces.
          Read state first.
        - [lit] Replace `surface.catalog` with `surface.defaultCatalog`.
        - Fix `Image.fit` semantics.
        ```

        ```release-notes
        - second block is ignored
        ```
        """)

    def test_parses_scoped_and_unscoped_bullets(self):
        bullets = rn.release_notes_block(self.BODY)
        self.assertEqual(
            bullets,
            [
                rn.Bullet(
                    "web_core", "`dispose()` now disposes surfaces. Read state first."
                ),
                rn.Bullet(
                    "lit", "Replace `surface.catalog` with `surface.defaultCatalog`."
                ),
                rn.Bullet(None, "Fix `Image.fit` semantics."),
            ],
        )

    def test_no_block(self):
        self.assertEqual(rn.release_notes_block("plain body"), [])
        self.assertFalse(rn.has_release_notes_block("plain body"))

    def test_breaking_footer(self):
        self.assertTrue(rn.has_breaking_footer("x\n\nBREAKING CHANGE: removed foo\n"))
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

    def test_rejects_duplicate_id_missing_version_and_unknown_ecosystem(self):
        with self.assertRaises(rn.ManifestError):
            self._load([self._entry(), self._entry()])
        with self.assertRaises(rn.ManifestError):
            self._load([self._entry(tag="npm/p/latest")])
        with self.assertRaises(rn.ManifestError):
            self._load([self._entry(ecosystem="cargo")])

    def test_rejects_wildcard_exclude_ending_in_slash(self):
        with self.assertRaises(rn.ManifestError) as ctx:
            self._load([self._entry(exclude=["**/Tests/"])])
        self.assertIn("**/Tests/**", str(ctx.exception))
        specs = self._load(
            [self._entry(exclude=["**/Tests/**", "typescript/p/tests/"])]
        )
        self.assertEqual(specs[0].exclude, ("**/Tests/**", "typescript/p/tests/"))

    def test_fix_with_empty_scope_fails_l1(self):
        self.assertIsNone(rn.parse_title("fix(): x"))

    def test_repository_manifest_covers_every_changelog(self):
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
        for entry in specs:
            self.assertTrue(
                os.path.exists(os.path.join(REPO_ROOT, entry.changelog)), entry.id
            )

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


def commit(sha, title, body=""):
    return rn.Commit(sha, title, body)


class BuildDraftTest(unittest.TestCase):

    TODAY = datetime.date(2026, 11, 12)

    def test_groups_and_links(self):
        commits = [
            commit("a1", "docs(web_core): tweak readme (#1)"),
            commit("a2", "fix(web_core): handle null (#2)"),
            commit("a3", "feat(web_core): add thing (#3)"),
            commit(
                "a4",
                "refactor(web_core)!: rename api (#4)",
                "```release-notes\n- Rename `a` to `b`. Migration: call `b`.\n```",
            ),
            commit(
                "a5",
                "chore: bump deps (#5)",
                "```release-notes\n- [web_core] Drop Node 18.\n```",
            ),
            commit("a6", "Non conventional title (#6)"),
        ]
        draft = rn.build_draft(spec(), commits, "since", "until")
        self.assertEqual(
            [(e.group, e.text, e.pr) for e in draft.entries],
            [
                ("Breaking", "Rename `a` to `b`. Migration: call `b`.", 4),
                ("Added", "Add thing", 3),
                ("Changed", "Drop Node 18.", 5),
                ("Changed", "Non conventional title", 6),
                ("Fixed", "Handle null", 2),
            ],
        )
        self.assertEqual([u["pr"] for u in draft.unnoted], [2, 3, 6])
        self.assertIsNone(draft.unnoted[2]["type"])
        rendered = rn.render_markdown(spec(), draft, "0.16.0", self.TODAY)
        self.assertIn(
            "## 0.16.0\n\n<!-- release-notes: web_core 0.16.0 range since..until -->",
            rendered,
        )
        self.assertIn(
            "- **BREAKING CHANGE**: Rename `a` to `b`. Migration: call `b`."
            " ([#4](https://github.com/a2ui-project/a2ui/pull/4))",
            rendered,
        )
        self.assertNotIn("readme", rendered)

    def test_scoped_and_unscoped_bullets_combine_and_other_scopes_are_ignored(self):
        body = "```release-notes\n- [lit] lit only\n- everyone\n```"
        draft = rn.build_draft(
            spec(), [commit("s1", "feat(x): y (#9)", body)], "a", "b"
        )
        self.assertEqual([e.text for e in draft.entries], ["everyone"])
        lit = spec(id="lit")
        draft = rn.build_draft(lit, [commit("s1", "feat(x): y (#9)", body)], "a", "b")
        self.assertEqual([e.text for e in draft.entries], ["lit only", "everyone"])

    def test_markdown_link_at_bullet_start_is_not_a_scope(self):
        body = "```release-notes\n- [Foo](https://x) was removed.\n```"
        self.assertEqual(
            rn.release_notes_block(body),
            [rn.Bullet(None, "[Foo](https://x) was removed.")],
        )

    def test_scope_lists_and_markdown_escapes(self):
        cases = {
            # Comma-separated lists, with and without spaces, expand to one
            # bullet per id in the order written.
            "- [web_core, lit] shared": [("web_core", "shared"), ("lit", "shared")],
            "- [web_core,lit,react] shared": [
                ("web_core", "shared"),
                ("lit", "shared"),
                ("react", "shared"),
            ],
            "- [ web_core , lit ] shared": [("web_core", "shared"), ("lit", "shared")],
            # Markdown-escaped underscores, backticks, and trailing commas.
            r"- [web\_core] escaped": [("web_core", "escaped")],
            r"- [web\_core, a2ui\_cli] escaped": [
                ("web_core", "escaped"),
                ("a2ui_cli", "escaped"),
            ],
            "- [`web_core`, `lit`] ticked": [("web_core", "ticked"), ("lit", "ticked")],
            "- [web_core,] trailing comma": [("web_core", "trailing comma")],
            # Ids with the other allowed characters.
            "- [dart-a2ui_core, markdown-it, catalog.v2] ok": [
                ("dart-a2ui_core", "ok"),
                ("markdown-it", "ok"),
                ("catalog.v2", "ok"),
            ],
            # Brackets that are not an id list stay literal text.
            "- [web_core lit] no comma": [(None, "[web_core lit] no comma")],
            "- [] empty": [(None, "[] empty")],
            "- [ , ] only commas": [(None, "[ , ] only commas")],
            "- [see issue #12] prose": [(None, "[see issue #12] prose")],
            "- [x] task box": [("x", "task box")],
            # A scope with no text is dropped, like any empty bullet.
            "- [web_core]": [],
            "- [web_core]   ": [],
        }
        for line, expected in cases.items():
            with self.subTest(line=line):
                bullets = rn.release_notes_block(f"```release-notes\n{line}\n```")
                self.assertEqual([(b.scope, b.text) for b in bullets], expected)

    def test_scope_list_feeds_draft_and_lint(self):
        body = "```release-notes\n- [web_core, lit] shared note\n- [lit, nope] bad\n```"
        for package, expected in (
            ("web_core", ["shared note"]),
            ("lit", ["shared note", "bad"]),
        ):
            with self.subTest(package=package):
                draft = rn.build_draft(
                    spec(id=package), [commit("s1", "feat(x): y (#9)", body)], "a", "b"
                )
                self.assertEqual([e.text for e in draft.entries], expected)
        specs = [spec(), spec(id="lit", paths=("typescript/renderers/lit/",))]
        violations = rn.check_pr(
            "fix(x): y", body, (), ["typescript/renderers/lit/a.ts"], specs
        )
        self.assertEqual([(v.rule, v.level) for v in violations], [("L4", "error")])
        self.assertIn("[nope]", violations[0].message)
        # Escaped ids pass L4 because they are unescaped before the lookup.
        clean = rn.check_pr(
            "fix(x): y",
            "```release-notes\n- [web\\_core, `lit`] fine\n```",
            (),
            ["typescript/renderers/lit/a.ts"],
            specs,
        )
        self.assertEqual(clean, [])

    def test_commented_out_block_and_footer_are_ignored(self):
        body = (
            "<!--\n```release-notes\n- Example bullet\n```\nBREAKING CHANGE: no\n-->\n"
            "Real text."
        )
        self.assertEqual(rn.release_notes_block(body), [])
        self.assertFalse(rn.has_release_notes_block(body))
        self.assertFalse(rn.has_breaking_footer(body))
        self.assertTrue(rn.has_breaking_footer("BREAKING-CHANGE: hyphen form"))

    def test_breaking_footer_and_unnoted_ordering(self):
        commits = [
            commit("b1", "fix(web_core): x (#1)"),
            commit("b2", "feat(web_core): y (#2)", "BREAKING CHANGE: y removed"),
        ]
        draft = rn.build_draft(spec(), commits, "a", "b")
        self.assertEqual(draft.entries[0].group, "Breaking")
        self.assertEqual([u["pr"] for u in draft.unnoted], [2, 1])

    FULL_SHA = "c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1"

    def test_revert_inside_range_folds_both(self):
        commits = [
            commit(self.FULL_SHA, "feat(web_core): add x (#10)"),
            commit(
                "c2",
                "revert: feat(web_core): add x (#10) (#11)",
                f"This reverts commit {self.FULL_SHA[:12]}.",
            ),
            commit("c3", "fix(web_core): z (#12)"),
        ]
        draft = rn.build_draft(spec(), commits, "a", "b")
        self.assertEqual([e.pr for e in draft.entries], [12])

    def test_revert_of_a_revert_keeps_the_original_change(self):
        commits = [
            commit("a" * 40, "feat(web_core): add x (#10)"),
            commit(
                "b" * 40,
                "revert: feat(web_core): add x (#10) (#11)",
                "This reverts commit " + "a" * 40 + ".",
            ),
            commit(
                "c" * 40,
                "revert: revert: feat(web_core): add x (#10) (#11) (#12)",
                "This reverts commit " + "b" * 40 + ".",
            ),
        ]
        draft = rn.build_draft(spec(), commits, "a", "b")
        self.assertEqual([e.pr for e in draft.entries], [10])

    def test_revert_outside_range_is_listed(self):
        commits = [
            commit(
                "d1",
                "revert: feat(web_core): old (#5) (#13)",
                "This reverts commit ffff.",
            )
        ]
        draft = rn.build_draft(spec(), commits, "a", "b")
        self.assertEqual(
            [(e.group, e.text) for e in draft.entries],
            [("Changed", "Revert: feat(web_core): old (#5)")],
        )

    def test_body_lookup_overrides_commit_body(self):
        lookup = {7: "```release-notes\n- From the API.\n```"}.get
        draft = rn.build_draft(
            spec(), [commit("e1", "feat(a): b (#7)")], "a", "b", lookup
        )
        self.assertEqual(draft.body_source, "api")
        self.assertEqual([e.text for e in draft.entries], ["From the API."])
        self.assertEqual(draft.unnoted, [])

    def test_render_dated_heading_dart_prefix_carried_and_empty(self):
        dart = spec(id="dart", heading_date=False, breaking_prefix="Breaking: ")
        draft = rn.build_draft(
            dart,
            [commit("f1", "feat!: x (#1)", "```release-notes\n- gone\n```")],
            "a",
            "b",
            carried="- Old pending note.",
        )
        rendered = rn.render_markdown(dart, draft, "0.8.0", self.TODAY)
        self.assertIn(
            rn.CARRIED_MARKER + "\n- Old pending note.\n\n- Breaking: gone", rendered
        )
        python = spec(id="py", heading_date=True)
        rendered = rn.render_markdown(
            python, rn.build_draft(python, [], "a", "b"), "0.7.0", self.TODAY
        )
        self.assertTrue(rendered.startswith("## 0.7.0 (2026-11-12)\n"))
        self.assertIn("- No consumer-facing changes.", rendered)


class ChangelogReadingTest(unittest.TestCase):

    CHANGELOG = textwrap.dedent("""\
        # Title

        ## Unreleased

        ## 0.16.0

        <!-- release-notes: web_core 0.16.0 range npm/web_core/v0.15.0..abc -->

        - New thing ([#1](https://github.com/a2ui-project/a2ui/pull/1))

        ## 0.15.0 (2026-10-01)

        - Older.
        """)

    def test_read_section_strips_range_comment_and_accepts_dates(self):
        self.assertEqual(
            rn.read_section(self.CHANGELOG, "0.16.0"),
            "- New thing ([#1](https://github.com/a2ui-project/a2ui/pull/1))",
        )
        self.assertEqual(rn.read_section(self.CHANGELOG, "0.15.0"), "- Older.")
        with self.assertRaises(rn.ReleaseNotesError) as ctx:
            rn.read_section(self.CHANGELOG, "0.14.0")
        self.assertEqual(ctx.exception.code, rn.EXIT_NO_SECTION)
        with self.assertRaises(rn.ReleaseNotesError):
            rn.read_section("## 0.1.0\n\n## 0.0.1\n- x\n", "0.1.0")

    def test_heading_version_skips_unreleased(self):
        self.assertEqual(rn.heading_version(self.CHANGELOG, "0.15.0"), "0.16.0")
        self.assertEqual(rn.heading_version(self.CHANGELOG, None), "0.16.0")
        with self.assertRaises(rn.ReleaseNotesError):
            rn.heading_version(self.CHANGELOG, "0.16.0")
        with self.assertRaises(rn.ReleaseNotesError):
            rn.heading_version("## Unreleased\n\n- pending\n", None)

    def test_strip_unreleased_and_insert_section(self):
        stripped = rn.strip_unreleased(
            "# T\n\n## Unreleased\n\n- pending\n\n## 0.1.0\n\n- old\n"
        )
        self.assertEqual(stripped, "# T\n\n## 0.1.0\n\n- old\n")
        inserted = rn.insert_section(stripped, "## 0.2.0\n\n- new\n")
        self.assertEqual(inserted, "# T\n\n## 0.2.0\n\n- new\n\n## 0.1.0\n\n- old\n")
        self.assertEqual(
            rn.insert_section("", "## 0.1.0\n\n- first\n"), "## 0.1.0\n\n- first\n"
        )
        self.assertEqual(
            rn.insert_section("## 0.1.0\n- a\n", "## 0.2.0\n- b\n"),
            "## 0.2.0\n- b\n\n## 0.1.0\n- a\n",
        )


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
        errors, _ = rn.verify_release(spec(), "0.17.0", self.GOOD, FakeGit())
        self.assertIn("no '## 0.17.0' section", errors[0])


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

    def test_registry_errors_refuse_instead_of_crashing(self):
        def server_error(url):
            raise urllib.error.HTTPError(url, 503, "down", {}, None)

        def offline(url):
            raise urllib.error.URLError("no network")

        for fetch in (server_error, offline):
            with self.subTest(fetch=fetch.__name__):
                with self.assertRaises(rn.ReleaseNotesError) as ctx:
                    rn.tag_release(spec(), "0.16.0", FakeGit(), fetch=fetch)
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
        with self.assertRaises(rn.ReleaseNotesError):
            rn.tag_release(
                dart,
                "0.8.0",
                FakeGit(),
                fetch=fetch_factory({url: {"versions": [{"version": "0.7.0"}]}}),
            )
        out = rn.tag_release(
            dart,
            "0.8.0",
            FakeGit(),
            fetch=fetch_factory({url: {"versions": [{"version": "0.8.0"}]}}),
            dry_run=True,
        )
        self.assertEqual(out, "would tag abc123 as dart/a2ui_core/v0.8.0")

    def test_existing_tag_and_no_registry(self):
        with self.assertRaises(rn.ReleaseNotesError):
            rn.tag_release(
                spec(),
                "0.16.0",
                FakeGit(tags=["npm/web_core/v0.16.0"]),
                fetch=fetch_factory({}),
            )
        swift = spec(
            id="swift", ecosystem="swiftpm", name="a2ui", tag="v{version}+swift"
        )
        out = rn.tag_release(
            swift,
            "0.11.0",
            FakeGit(),
            fetch=fetch_factory({}),
            registry=False,
            dry_run=True,
        )
        self.assertEqual(out, "would tag abc123 as v0.11.0+swift")


class CheckPrTest(unittest.TestCase):

    SPECS = [spec(), spec(id="lit", paths=("typescript/renderers/lit/",))]
    NOTES = "```release-notes\n- [web_core] x. Migration: y.\n```"
    PKG = ["typescript/core/web_core/src/index.ts"]

    def rules(self, title, body="", labels=(), paths=()):
        return [
            (v.rule, v.level)
            for v in rn.check_pr(title, body, labels, paths, self.SPECS)
        ]

    def test_matrix(self):
        cases = [
            ("Update stuff", "", (), (), [("L1", "error")]),
            ("feat(web_core): x", "", (), self.PKG, []),
            (
                "feat(web_core)!: x",
                "",
                (),
                self.PKG,
                [("L2", "error"), ("L3", "error")],
            ),
            ("feat(web_core)!: x", self.NOTES, ("breaking-change",), self.PKG, []),
            (
                "feat(web_core)!: x",
                "BREAKING CHANGE: z\n" + self.NOTES,
                (),
                self.PKG,
                [],
            ),
            (
                "feat(web_core)!: x",
                "BREAKING CHANGE: z",
                (),
                self.PKG,
                [("L3", "error")],
            ),
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
                "fix(x): y",
                "```release-notes\n- [nope] z\n```",
                (),
                self.PKG,
                [("L4", "error")],
            ),
            ("fix(x): y", self.NOTES, (), ["docs/readme.md"], [("L5", "warning")]),
            ("docs: y", "", (), ["docs/readme.md"], []),
            (
                "fix(x): y",
                "```release-notes\n- [lit] z\n- plain\n```",
                (),
                ["typescript/renderers/lit/src/a.ts"],
                [],
            ),
        ]
        for title, body, labels, paths, expected in cases:
            with self.subTest(title=title, body=body[:20], labels=labels):
                self.assertEqual(self.rules(title, body, labels, paths), expected)


class GoldenRepoTest(unittest.TestCase):
    """Runs `draft` end to end against a scripted git repository."""

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
            # Ignore the developer's global config (signing, hooks, templates).
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
        }
        cls.env = env

        def git(*args):
            subprocess.run(
                ["git", *args], cwd=cls.root, env=env, check=True, capture_output=True
            )

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
                    "id": "pkg",
                    "ecosystem": "npm",
                    "name": "@x/pkg",
                    "paths": ["pkg/"],
                    "exclude": ["**/*.test.ts", "**/*.md"],
                    "changelog": "pkg/CHANGELOG.md",
                    "tag": "npm/pkg/v{version}",
                },
                {
                    "id": "other",
                    "ecosystem": "npm",
                    "name": "@x/other",
                    "paths": ["other/"],
                    "changelog": "other/CHANGELOG.md",
                    "tag": "npm/other/v{version}",
                },
            ]
        }
        write(".github/release_packages.json", json.dumps(manifest))
        commit_file(
            "pkg/CHANGELOG.md",
            "# pkg\n\n## Unreleased\n\n- Pending note.\n\n## 0.1.0\n\n- First.\n",
            "chore: init (#1)",
        )
        git("tag", "npm/pkg/v0.1.0")
        commit_file("pkg/src/a.ts", "a", "feat(pkg): add a (#2)")
        commit_file("pkg/src/b.ts", "b", "fix(pkg): fix b (#3)")
        commit_file(
            "pkg/src/c.ts",
            "c",
            "feat(pkg)!: change c (#4)",
            "```release-notes\n- [pkg] `c` is now async. Migration: await it.\n-"
            " [other] unrelated\n```",
        )
        commit_file("pkg/README.md", "docs", "docs(pkg): readme (#5)")
        commit_file("pkg/src/d.ts", "d", "feat(pkg): add d (#6)")
        commit_file(
            "pkg/src/d.ts",
            "",
            "revert: feat(pkg): add d (#6) (#7)",
            "This reverts commit "
            + subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=cls.root,
                env=env,
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip()
            + ".",
        )
        commit_file("pkg/src/a.test.ts", "t", "test(pkg): cover a (#8)")
        commit_file("other/src/x.ts", "x", "feat(other): only other (#9)")
        commit_file("pkg/src/e.ts", "e", "Legacy title without type (#10)")
        # Control characters in a body must not break record parsing, and a
        # body that is only a template comment must not produce notes.
        commit_file(
            "pkg/src/g.ts",
            "g",
            "fix(pkg): control bytes (#13)",
            "with \x1f unit and \x1e record separators\n<!-- ```release-notes\n-"
            " nope\n``` -->",
        )

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

    def test_draft_markdown_matches_golden(self):
        code, out, err = self.run_cli(
            "draft",
            "--package",
            "pkg",
            "--version",
            "0.2.0",
            "--body-source",
            "commit",
            "--carry-unreleased",
        )
        self.assertEqual(code, 0, err)
        body = out.split("-->\n\n", 1)[1]
        expected = textwrap.dedent(f"""\
            {rn.CARRIED_MARKER}
            - Pending note.

            - **BREAKING CHANGE**: `c` is now async. Migration: await it. ([#4](https://github.com/a2ui-project/a2ui/pull/4))
            - Add a ([#2](https://github.com/a2ui-project/a2ui/pull/2))
            - Legacy title without type ([#10](https://github.com/a2ui-project/a2ui/pull/10))
            - Fix b ([#3](https://github.com/a2ui-project/a2ui/pull/3))
            - Control bytes ([#13](https://github.com/a2ui-project/a2ui/pull/13))
            """)
        self.assertEqual(body, expected)
        self.assertTrue(
            out.startswith(
                "## 0.2.0\n\n<!-- release-notes: pkg 0.2.0 range npm/pkg/v0.1.0.."
            )
        )

    def test_draft_json_lists_unnoted(self):
        code, out, _ = self.run_cli(
            "draft", "--package", "pkg", "--format", "json", "--body-source", "commit"
        )
        self.assertEqual(code, 0)
        data = json.loads(out)
        self.assertEqual([u["pr"] for u in data["unnoted"]], [2, 3, 10, 13])
        self.assertEqual(data["body_source"], "commit")
        self.assertEqual(data["since"], "npm/pkg/v0.1.0")
        self.assertTrue(all(len(u["sha"]) == 40 for u in data["unnoted"]))

    def test_write_with_json_is_a_usage_error(self):
        code, _, err = self.run_cli(
            "draft",
            "--package",
            "pkg",
            "--format",
            "json",
            "--write",
            "--version",
            "9.9.9",
        )
        self.assertEqual(code, rn.EXIT_USAGE)
        self.assertIn("--format md", err)

    def test_no_anchor_exit_code(self):
        code, _, err = self.run_cli("draft", "--package", "other")
        self.assertEqual(code, rn.EXIT_NO_ANCHOR)
        self.assertIn("--since", err)

    def test_write_then_read_and_verify(self):
        code, _, err = self.run_cli(
            "draft",
            "--package",
            "pkg",
            "--version",
            "0.2.0",
            "--body-source",
            "commit",
            "--carry-unreleased",
            "--write",
        )
        self.assertEqual(code, 0, err)
        with open(
            os.path.join(self.root, "pkg/CHANGELOG.md"), encoding="utf-8"
        ) as handle:
            text = handle.read()
        self.assertTrue(text.startswith("# pkg\n\n## 0.2.0\n"))
        self.assertNotIn("## Unreleased", text)
        self.assertIn("## 0.1.0\n\n- First.\n", text)
        code, out, _ = self.run_cli(
            "read-section", "--package", "pkg", "--version", "0.2.0"
        )
        self.assertEqual(code, 0)
        self.assertNotIn("<!--", out.split("\n")[0])
        subprocess.run(
            ["git", "commit", "-qam", "release(pkg): 0.2.0 (#11)"],
            cwd=self.root,
            env=self.env,
            check=True,
        )
        # The release commit only touches the excluded CHANGELOG, so verify
        # stays silent until a package source file changes after the range.
        code, out, err = self.run_cli(
            "verify-release", "--package", "pkg", "--version", "0.2.0"
        )
        self.assertEqual(code, 0, err)
        self.assertNotIn("commits after the drafted range", out)
        with open(
            os.path.join(self.root, "pkg/src/f.ts"), "w", encoding="utf-8"
        ) as handle:
            handle.write("f")
        subprocess.run(["git", "add", "-A"], cwd=self.root, env=self.env, check=True)
        subprocess.run(
            ["git", "commit", "-qm", "feat(pkg): after the range (#12)"],
            cwd=self.root,
            env=self.env,
            check=True,
        )
        code, out, err = self.run_cli(
            "verify-release", "--package", "pkg", "--version", "0.2.0"
        )
        self.assertEqual(code, 0, err)
        self.assertIn("warning: commits after the drafted range", out)
        self.assertIn("after the range", out)
        code, out, _ = self.run_cli(
            "tag",
            "--package",
            "pkg",
            "--version",
            "0.2.0",
            "--no-registry",
            "--dry-run",
        )
        self.assertEqual(code, 0)
        self.assertIn("would tag", out)

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
        self.assertIn("[L3]", err)
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
