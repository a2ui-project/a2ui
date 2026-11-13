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

"""Release notes drafted from pull request history, per published package.

Feature pull requests do not edit CHANGELOG.md. The pull request title (a
conventional commit title, `!` for a breaking change) and an optional fenced
`release-notes` block in its description are the source. A bullet in that
block may start with `[id]` or `[id1, id2]` to target specific packages
(Markdown-escaped underscores and backticked ids are accepted); a bullet
without a scope applies to every package the pull request touched. At release
time this script lists the squash commits that touched a package since its
last release tag, drafts the `## X.Y.Z` section from them, and checks the
result before publishing.

Subcommands:

  draft           Draft a package's next CHANGELOG section as Markdown or JSON.
  check-pr        Lint a pull request's title, body, and labels (L1 to L5).
  read-section    Print the body of a `## X.Y.Z` section.
  verify-release  Check a CHANGELOG before publishing a version.
  tag             Create the release tag once the public registry has it.

Packages, their directories, changelogs, and tag patterns live in
.github/release_packages.json. Runs on the standard library only, so it can be
invoked with a bare `python3`.

Tags are read from the local checkout. In a workflow, check out with
`fetch-depth: 0` and `fetch-tags: true`; otherwise `draft` falls back to the
manifest's `bootstrap_since` and `verify-release` cannot see existing tags.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Callable, Iterable, Sequence

MANIFEST_PATH = ".github/release_packages.json"
REPO = "a2ui-project/a2ui"
PR_URL = f"https://github.com/{REPO}/pull/{{pr}}"

# Exit codes shared with the workflows that call this script.
EXIT_OK = 0
EXIT_USAGE = 1
EXIT_NO_ANCHOR = 2
EXIT_NO_SECTION = 3
EXIT_TAG_REFUSED = 4
EXIT_MANIFEST = 5

ECOSYSTEMS = ("python", "npm", "pub", "swiftpm", "github")
REGISTRIES = {
    "npm": "https://registry.npmjs.org/{name}/{version}",
    "pub": "https://pub.dev/api/packages/{name}",
    "python": "https://pypi.org/pypi/{name}/{version}/json",
}

ALLOWED_TYPES = (
    "feat",
    "fix",
    "perf",
    "refactor",
    "docs",
    "test",
    "ci",
    "chore",
    "build",
    "style",
    "a11y",
    "release",
    "revert",
)
# Commit types that only reach the changelog with a release-notes bullet or `!`.
SILENT_TYPES = frozenset({"docs", "test", "ci", "chore", "build", "style", "release"})
GROUPS = ("Breaking", "Added", "Changed", "Fixed")
GROUP_BY_TYPE = {"feat": "Added", "fix": "Fixed"}

BREAKING_LABEL = "breaking-change"
BREAKING_FOOTERS = ("BREAKING CHANGE:", "BREAKING-CHANGE:")
BREAKING_FOOTER = BREAKING_FOOTERS[0]

TITLE_RE = re.compile(
    r"^(?P<type>[a-z][a-z0-9]*)(?:\((?P<scope>[^()]+)\))?(?P<bang>!)?:\s+"
    r"(?P<subject>.+?)(?:\s+\(#(?P<pr>\d+)\))?\s*$"
)
HEADING_RE = re.compile(r"^## (?P<version>\d+\.\d+\.\d+)(?:\s+\(.*\))?\s*$")
UNRELEASED_HEADING = "## Unreleased"
RANGE_COMMENT_RE = re.compile(
    r"^<!-- release-notes: (?P<id>\S+) (?P<version>\S+) range"
    r" (?P<since>\S+)\.\.(?P<until>\S+) -->$"
)
CARRIED_MARKER = "<!-- carried from the Unreleased section; review and merge -->"
HTML_COMMENT_RE = re.compile(r"^<!--.*-->$")
HTML_COMMENT_SPAN_RE = re.compile(r"<!--.*?-->", re.DOTALL)
# SwiftPM reads every tag shaped like a version, with or without a leading `v`
# or trailing build metadata, as a version of the Swift package.
SWIFTPM_TAG_RE = re.compile(r"^v?\d+\.\d+(\.\d+)?(\+.*)?$")
FENCE_OPEN_RE = re.compile(r"^```\s*release-notes\s*$")
FENCE_CLOSE_RE = re.compile(r"^```\s*$")
# `[web_core] text`, but not a Markdown link such as `[Foo](https://...)`.
# A scope prefix is `[ids] text` where `ids` is one package id or a
# comma-separated list. A Markdown link (`[Foo](https://...)`) is not a scope.
SCOPE_PREFIX_RE = re.compile(r"^\[(?P<scopes>[^\]\n]*)\](?!\()\s*(?P<text>.*)$")
SCOPE_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
REVERT_SHA_RE = re.compile(r"This reverts commit ([0-9a-f]{7,40})")
REVERT_PR_RE = re.compile(r"\(#(\d+)\)")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
NETWORK_TIMEOUT_SECONDS = 60


class ManifestError(Exception):
    """The package manifest is malformed."""


class ReleaseNotesError(Exception):
    """A release-notes operation cannot continue; `code` is the exit code."""

    def __init__(self, message: str, code: int):
        super().__init__(message)
        self.code = code


@dataclasses.dataclass(frozen=True)
class PackageSpec:
    """One published package from the manifest."""

    id: str
    ecosystem: str
    name: str
    paths: tuple[str, ...]
    exclude: tuple[str, ...]
    changelog: str
    tag: str
    bootstrap_since: str | None = None
    bootstrap_version: str | None = None
    heading_date: bool = False
    breaking_prefix: str = "**BREAKING CHANGE**: "

    def tag_for(self, version: str) -> str:
        return self.tag.replace("{version}", version)

    @property
    def tag_prefix(self) -> str:
        return self.tag.split("{version}", 1)[0]

    @property
    def tag_suffix(self) -> str:
        return self.tag.split("{version}", 1)[1]

    def version_of_tag(self, tag: str) -> tuple[int, int, int] | None:
        """Returns the version a tag of this package carries, else None."""
        if not tag.startswith(self.tag_prefix) or not tag.endswith(self.tag_suffix):
            return None
        middle = tag[len(self.tag_prefix) : len(tag) - len(self.tag_suffix)]
        return parse_version(middle)


def parse_version(text: str) -> tuple[int, int, int] | None:
    """Parses `X.Y.Z` into a comparable tuple; None for anything else."""
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", text)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


def _check_exclude(package_id: str, pattern: str) -> None:
    """Rejects excludes that git would never match.

    A pathspec without `:(glob)` magic is matched against whole paths, so a
    wildcard pattern that ends in `/` (such as `**/Tests/`) matches no file.
    Write `**/Tests/**` instead. Literal directory prefixes are fine.
    """
    if "*" in pattern and pattern.endswith("/"):
        raise ManifestError(
            f"{package_id}: exclude {pattern!r} ends in '/' but contains a wildcard,"
            f" so git matches nothing; use {pattern + '**'!r}"
        )


def _manifest_entry(raw: dict) -> PackageSpec:
    required = ("id", "ecosystem", "name", "paths", "changelog", "tag")
    missing = [key for key in required if key not in raw]
    if missing:
        raise ManifestError(f"entry {raw.get('id', '?')!r} lacks {', '.join(missing)}")
    if raw["ecosystem"] not in ECOSYSTEMS:
        raise ManifestError(f"{raw['id']}: unknown ecosystem {raw['ecosystem']!r}")
    if "{version}" not in raw["tag"]:
        raise ManifestError(f"{raw['id']}: tag pattern lacks {{version}}")
    sample = raw["tag"].replace("{version}", "0.0.0")
    if raw["ecosystem"] != "swiftpm" and SWIFTPM_TAG_RE.match(sample):
        raise ManifestError(
            f"{raw['id']}: tag pattern {raw['tag']!r} would be read by SwiftPM as a"
            " Swift package version; prefix it with the ecosystem"
        )
    for pattern in raw.get("exclude", ()):
        _check_exclude(raw["id"], pattern)
    return PackageSpec(
        id=raw["id"],
        ecosystem=raw["ecosystem"],
        name=raw["name"],
        paths=tuple(raw["paths"]),
        exclude=tuple(raw.get("exclude", ())),
        changelog=raw["changelog"],
        tag=raw["tag"],
        bootstrap_since=raw.get("bootstrap_since"),
        bootstrap_version=raw.get("bootstrap_version"),
        heading_date=bool(raw.get("heading_date", False)),
        breaking_prefix=raw.get("breaking_prefix", "**BREAKING CHANGE**: "),
    )


def load_manifest(path: str) -> list[PackageSpec]:
    """Loads and validates the package manifest, preserving file order."""
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    specs = [_manifest_entry(raw) for raw in data.get("packages", [])]
    seen: set[str] = set()
    for spec in specs:
        if spec.id in seen:
            raise ManifestError(f"duplicate package id {spec.id!r}")
        seen.add(spec.id)
    return specs


def find_package(specs: Sequence[PackageSpec], package_id: str) -> PackageSpec:
    """Returns the manifest entry with this id, or raises a usage error."""
    for spec in specs:
        if spec.id == package_id:
            return spec
    known = ", ".join(spec.id for spec in specs)
    raise ReleaseNotesError(
        f"unknown package {package_id!r}; known packages: {known}", EXIT_USAGE
    )


class Git:
    """Runs git in a repository; tests substitute a fake with the same `run`."""

    def __init__(self, repo_root: str):
        self.repo_root = repo_root

    def run(self, args: Sequence[str]) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=self.repo_root,
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout


# --- Pull request parsing ----------------------------------------------------


@dataclasses.dataclass(frozen=True)
class ParsedTitle:
    type: str
    scope: str | None
    breaking: bool
    subject: str
    pr: int | None


def parse_title(title: str) -> ParsedTitle | None:
    """Parses a conventional title; None when it fails rule L1."""
    match = TITLE_RE.match(title.strip())
    if not match or match.group("type") not in ALLOWED_TYPES:
        return None
    pr = match.group("pr")
    return ParsedTitle(
        type=match.group("type"),
        scope=match.group("scope"),
        breaking=match.group("bang") == "!",
        subject=match.group("subject").strip(),
        pr=int(pr) if pr else None,
    )


@dataclasses.dataclass(frozen=True)
class Bullet:
    scope: str | None
    text: str


def _block_lines(body: str) -> list[str] | None:
    """Returns the lines of the first `release-notes` fence, or None.

    HTML comments are removed first, so an example block left inside a PR
    template comment is not mistaken for real notes.
    """
    lines = strip_html_comments(body).splitlines()
    for index, line in enumerate(lines):
        if FENCE_OPEN_RE.match(line.strip()):
            block: list[str] = []
            for inner in lines[index + 1 :]:
                if FENCE_CLOSE_RE.match(inner.strip()):
                    return block
                block.append(inner)
            return block
    return None


def strip_html_comments(text: str) -> str:
    """Removes `<!-- ... -->` spans, including multi-line ones."""
    return HTML_COMMENT_SPAN_RE.sub("", text)


def has_release_notes_block(body: str) -> bool:
    return _block_lines(body) is not None


def parse_scopes(raw: str) -> list[str] | None:
    """Parses the inside of a `[...]` prefix into package ids.

    Accepts `web_core`, `web_core, lit`, Markdown-escaped `web\\_core`, and
    ids wrapped in backticks. Returns None when the brackets hold anything
    that is not an id list, so the bullet is treated as plain text.
    """
    ids: list[str] = []
    for part in raw.split(","):
        candidate = part.strip().strip("`").replace("\\", "").strip()
        if not candidate:
            continue
        if not SCOPE_ID_RE.match(candidate):
            return None
        ids.append(candidate)
    return ids or None


def _bullets_from(raw: str) -> list[Bullet]:
    """Expands one raw bullet into one Bullet per scope (or one unscoped)."""
    match = SCOPE_PREFIX_RE.match(raw)
    scopes = parse_scopes(match.group("scopes")) if match else None
    if match and scopes:
        text = match.group("text").strip()
        return [Bullet(scope, text) for scope in scopes]
    return [Bullet(None, raw)]


def release_notes_block(body: str) -> list[Bullet]:
    """Parses the bullets of the first `release-notes` fence in a PR body."""
    lines = _block_lines(body)
    if lines is None:
        return []
    raw_bullets: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped[:2] in ("- ", "* "):
            raw_bullets.append(stripped[2:].strip())
        elif raw_bullets:
            raw_bullets[-1] = f"{raw_bullets[-1]} {stripped}"
        else:
            raw_bullets.append(stripped)
    bullets = [bullet for raw in raw_bullets for bullet in _bullets_from(raw)]
    return [bullet for bullet in bullets if bullet.text]


def has_breaking_footer(body: str) -> bool:
    """True when a line of the body (outside comments) starts a breaking footer."""
    return any(
        line.strip().startswith(BREAKING_FOOTERS)
        for line in strip_html_comments(body).splitlines()
    )


# --- Tags and commit ranges --------------------------------------------------


def latest_tag(spec: PackageSpec, git: Git) -> str | None:
    """Returns the package's highest release tag by version, or None."""
    output = git.run(["tag", "--list", f"{spec.tag_prefix}*"])
    best: tuple[tuple[int, int, int], str] | None = None
    for line in output.splitlines():
        tag = line.strip()
        version = spec.version_of_tag(tag) if tag else None
        if version is not None and (best is None or version > best[0]):
            best = (version, tag)
    return best[1] if best else None


def resolve_anchor(spec: PackageSpec, since: str | None, git: Git) -> str:
    """Picks the commit the draft starts after: --since, the tag, or bootstrap."""
    if since:
        return since
    tag = latest_tag(spec, git)
    if tag:
        return tag
    if spec.bootstrap_since:
        return spec.bootstrap_since
    raise ReleaseNotesError(
        f"{spec.id}: no release tag matching {spec.tag!r} and no bootstrap_since in"
        " the manifest. Action needed: pass --since <commit> for the first release.",
        EXIT_NO_ANCHOR,
    )


@dataclasses.dataclass(frozen=True)
class Commit:
    sha: str
    title: str
    body: str

    @property
    def parsed(self) -> ParsedTitle | None:
        return parse_title(self.title)

    @property
    def pr(self) -> int | None:
        parsed = self.parsed
        if parsed and parsed.pr:
            return parsed.pr
        match = re.search(r"\(#(\d+)\)\s*$", self.title)
        return int(match.group(1)) if match else None


def pathspecs(spec: PackageSpec) -> list[str]:
    return [*spec.paths, *(f":(exclude){pattern}" for pattern in spec.exclude)]


def commits_in_range(
    spec: PackageSpec, since: str, until: str, git: Git
) -> list[Commit]:
    """Lists first-parent commits in since..until that touch the package, oldest first.

    Fields and records are NUL-separated (`-z`), which no commit message can
    contain, so bodies with control characters cannot corrupt the parse.
    """
    output = git.run([
        "log",
        "-z",
        "--first-parent",
        "--reverse",
        "--format=%H%x00%s%x00%b",
        f"{since}..{until}",
        "--",
        *pathspecs(spec),
    ])
    fields = output.split("\x00")
    if fields and fields[-1].strip() == "":
        fields.pop()
    if len(fields) % 3:
        raise ReleaseNotesError(
            f"unexpected git log output for {spec.id}: {len(fields)} fields", EXIT_USAGE
        )
    commits = []
    for sha, title, body in zip(fields[0::3], fields[1::3], fields[2::3]):
        sha = sha.strip()
        if not SHA_RE.match(sha):
            raise ReleaseNotesError(f"unexpected git log record {sha!r}", EXIT_USAGE)
        commits.append(Commit(sha, title.strip(), body.strip()))
    return commits


def fetch_pr_body(pr: int) -> str | None:
    """Reads a PR body through `gh api`; None when gh or the token is missing."""
    if not (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")):
        return None
    try:
        result = subprocess.run(
            ["gh", "api", f"repos/{REPO}/pulls/{pr}", "--jq", ".body"],
            capture_output=True,
            text=True,
            check=True,
            timeout=NETWORK_TIMEOUT_SECONDS,
        )
    except (
        subprocess.CalledProcessError,
        subprocess.TimeoutExpired,
        FileNotFoundError,
        OSError,
    ):
        return None
    return result.stdout


BodyLookup = Callable[[int], "str | None"]


# --- Drafting ----------------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class Entry:
    group: str
    text: str
    pr: int | None
    sha: str
    scoped: bool


@dataclasses.dataclass
class Draft:
    package: str
    since: str
    until: str
    body_source: str
    entries: list[Entry] = dataclasses.field(default_factory=list)
    unnoted: list[dict] = dataclasses.field(default_factory=list)
    carried_unreleased: str = ""

    def to_json(self) -> dict:
        return {
            "package": self.package,
            "since": self.since,
            "until": self.until,
            "body_source": self.body_source,
            "entries": [dataclasses.asdict(entry) for entry in self.entries],
            "unnoted": self.unnoted,
            "carried_unreleased": self.carried_unreleased,
        }


def _subject_text(parsed: ParsedTitle | None, title: str) -> str:
    text = parsed.subject if parsed else re.sub(r"\s+\(#\d+\)\s*$", "", title)
    if parsed and parsed.type == "revert" and not text.lower().startswith("revert"):
        text = f"Revert: {text}"
    return text[:1].upper() + text[1:] if text else text


def _group_for(parsed: ParsedTitle | None, breaking: bool) -> str:
    if breaking:
        return "Breaking"
    if parsed is None:
        return "Changed"
    return GROUP_BY_TYPE.get(parsed.type, "Changed")


def _bullets_for(spec: PackageSpec, bullets: Sequence[Bullet]) -> list[str]:
    """Bullets scoped to this package plus the unscoped ones, in body order."""
    return [b.text for b in bullets if b.scope is None or b.scope == spec.id]


def _revert_target(
    commit: Commit, by_sha: dict[str, Commit], by_pr: dict[int, Commit]
) -> Commit | None:
    """Finds the in-range commit a `revert:` commit undoes, by sha then by PR."""
    sha_match = REVERT_SHA_RE.search(commit.body)
    if sha_match:
        prefix = sha_match.group(1)
        target = next((c for s, c in by_sha.items() if s.startswith(prefix)), None)
        if target is not None:
            return target
    for pr_match in REVERT_PR_RE.finditer(commit.title + "\n" + commit.body):
        candidate = by_pr.get(int(pr_match.group(1)))
        if candidate and candidate.sha != commit.sha:
            return candidate
    return None


def _is_revert(commit: Commit) -> bool:
    parsed = commit.parsed
    return bool(parsed and parsed.type == "revert")


def _fold_reverts(commits: list[Commit]) -> list[Commit]:
    """Drops a revert and its target when both are inside the range.

    Reverts are resolved newest first, so a revert of a revert cancels the
    inner revert and the original change stays visible.
    """
    by_sha = {commit.sha: commit for commit in commits}
    by_pr = {commit.pr: commit for commit in commits if commit.pr}
    dropped: set[str] = set()
    for commit in reversed(commits):
        if commit.sha in dropped or not _is_revert(commit):
            continue
        target = _revert_target(commit, by_sha, by_pr)
        if target is not None and target.sha not in dropped:
            dropped.update({commit.sha, target.sha})
    return [commit for commit in commits if commit.sha not in dropped]


def _entry_for(
    spec: PackageSpec, commit: Commit, body_lookup: BodyLookup | None
) -> tuple[str, list[str], bool, bool] | None:
    """Returns (group, texts, breaking, noted) for a commit, or None to skip it."""
    parsed = commit.parsed
    body = commit.body
    if body_lookup and commit.pr:
        body = body_lookup(commit.pr) or body
    breaking = bool(parsed and parsed.breaking) or has_breaking_footer(body)
    bullets = _bullets_for(spec, release_notes_block(body))
    if not bullets and not breaking and parsed and parsed.type in SILENT_TYPES:
        return None
    texts = bullets or [_subject_text(parsed, commit.title)]
    return _group_for(parsed, breaking), texts, breaking, bool(bullets)


def build_draft(
    spec: PackageSpec,
    commits: Sequence[Commit],
    since: str,
    until: str,
    body_lookup: BodyLookup | None = None,
    carried: str = "",
) -> Draft:
    """Groups commits into changelog entries and lists the ones without notes."""
    draft = Draft(spec.id, since, until, "api" if body_lookup else "commit")
    draft.carried_unreleased = carried
    for commit in _fold_reverts(list(commits)):
        entry = _entry_for(spec, commit, body_lookup)
        if entry is None:
            continue
        group, texts, breaking, noted = entry
        for text in texts:
            draft.entries.append(Entry(group, text, commit.pr, commit.sha, noted))
        if not noted:
            parsed = commit.parsed
            draft.unnoted.append({
                "pr": commit.pr,
                "sha": commit.sha,
                "type": parsed.type if parsed else None,
                "title": commit.title,
                "breaking": breaking,
            })
    draft.entries.sort(key=lambda entry: GROUPS.index(entry.group))
    draft.unnoted.sort(key=lambda item: not item["breaking"])
    return draft


def range_comment(spec: PackageSpec, version: str, since: str, until: str) -> str:
    return f"<!-- release-notes: {spec.id} {version} range {since}..{until} -->"


def heading_for(spec: PackageSpec, version: str, today: datetime.date) -> str:
    if spec.heading_date:
        return f"## {version} ({today.isoformat()})"
    return f"## {version}"


def render_markdown(
    spec: PackageSpec, draft: Draft, version: str, today: datetime.date
) -> str:
    """Renders the section: heading, range comment, carried notes, entries."""
    lines = [
        heading_for(spec, version, today),
        "",
        range_comment(spec, version, draft.since, draft.until),
        "",
    ]
    if draft.carried_unreleased.strip():
        lines.extend([CARRIED_MARKER, draft.carried_unreleased.strip(), ""])
    for entry in draft.entries:
        prefix = spec.breaking_prefix if entry.group == "Breaking" else ""
        link = f" ([#{entry.pr}]({PR_URL.format(pr=entry.pr)}))" if entry.pr else ""
        lines.append(f"- {prefix}{entry.text}{link}")
    if not draft.entries and not draft.carried_unreleased.strip():
        lines.append("- No consumer-facing changes.")
    return "\n".join(lines).rstrip() + "\n"


# --- CHANGELOG reading -------------------------------------------------------


def _sections(changelog: str) -> list[tuple[str, list[str]]]:
    """Splits a changelog into (heading line, body lines) for each `## `."""
    sections: list[tuple[str, list[str]]] = []
    for line in changelog.splitlines():
        if line.startswith("## "):
            sections.append((line.rstrip(), []))
        elif sections:
            sections[-1][1].append(line)
    return sections


def read_unreleased(changelog: str) -> str:
    """Returns the body of an `## Unreleased` section, or an empty string."""
    for heading, body in _sections(changelog):
        if heading.strip() == UNRELEASED_HEADING:
            return "\n".join(body).strip()
    return ""


def read_section(changelog: str, version: str) -> str:
    """Returns the body of `## <version>` without HTML comments."""
    for heading, body in _sections(changelog):
        match = HEADING_RE.match(heading)
        if match and match.group("version") == version:
            kept = [line for line in body if not HTML_COMMENT_RE.match(line.strip())]
            text = "\n".join(kept).strip()
            if not text:
                raise ReleaseNotesError(
                    f"section '## {version}' is empty", EXIT_NO_SECTION
                )
            return text
    raise ReleaseNotesError(f"no '## {version}' section found", EXIT_NO_SECTION)


def heading_version(changelog: str, released: str | None) -> str:
    """Returns the newest `## X.Y.Z` heading above the released version."""
    for heading, _ in _sections(changelog):
        match = HEADING_RE.match(heading)
        if not match:
            continue
        version = match.group("version")
        if released and parse_version(version) <= parse_version(released):
            break
        return version
    raise ReleaseNotesError(
        f"no '## X.Y.Z' heading newer than {released or 'the first release'}",
        EXIT_NO_SECTION,
    )


def strip_unreleased(changelog: str) -> str:
    """Removes an `## Unreleased` section and its body."""
    out: list[str] = []
    skipping = False
    for line in changelog.splitlines():
        if line.startswith("## "):
            skipping = line.strip() == UNRELEASED_HEADING
        if not skipping:
            out.append(line)
    return "\n".join(out).rstrip() + "\n"


def insert_section(changelog: str, section: str) -> str:
    """Puts a rendered section above the first `## ` heading."""
    lines = changelog.splitlines()
    for index, line in enumerate(lines):
        if line.startswith("## "):
            head = "\n".join(lines[:index]).rstrip()
            tail = "\n".join(lines[index:])
            prefix = f"{head}\n\n" if head else ""
            return f"{prefix}{section.rstrip()}\n\n{tail}".rstrip() + "\n"
    return (
        f"{changelog.rstrip()}\n\n{section.rstrip()}\n"
        if changelog.strip()
        else section
    )


# --- Verification and tagging ------------------------------------------------


def _parsed_range(changelog: str, version: str) -> tuple[str, str] | None:
    for heading, body in _sections(changelog):
        match = HEADING_RE.match(heading)
        if match and match.group("version") == version:
            for line in body:
                comment = RANGE_COMMENT_RE.match(line.strip())
                if comment:
                    return comment.group("since"), comment.group("until")
    return None


def _is_ancestor(git: Git, commit: str, head: str = "HEAD") -> bool:
    try:
        git.run(["merge-base", "--is-ancestor", commit, head])
    except subprocess.CalledProcessError:
        return False
    return True


def tag_exists(spec: PackageSpec, version: str, git: Git) -> bool:
    """True when the local checkout already has the tag for this version."""
    return bool(git.run(["tag", "--list", spec.tag_for(version)]).strip())


def verify_release(
    spec: PackageSpec, version: str, changelog: str, git: Git
) -> tuple[list[str], list[str]]:
    """Returns (errors, warnings) for releasing `version` from this changelog."""
    errors: list[str] = []
    warnings: list[str] = []
    try:
        read_section(changelog, version)
    except ReleaseNotesError as error:
        errors.append(str(error))
    if any(h.strip() == UNRELEASED_HEADING for h, _ in _sections(changelog)):
        errors.append("an '## Unreleased' heading is still present; remove it")
    if CARRIED_MARKER in changelog:
        warnings.append(
            "the carried-notes marker is still present; merge the carried entries"
            " into the section and delete the marker"
        )
    versions = [
        parse_version(HEADING_RE.match(h).group("version"))
        for h, _ in _sections(changelog)
        if HEADING_RE.match(h)
    ]
    if versions != sorted(versions, reverse=True):
        errors.append("version headings are not in descending order")
    if tag_exists(spec, version, git):
        errors.append(f"tag {spec.tag_for(version)} already exists")
    parsed = _parsed_range(changelog, version)
    if parsed:
        _, until = parsed
        if not _is_ancestor(git, until):
            errors.append(f"range end {until} is not an ancestor of HEAD")
        else:
            later = git.run([
                "log",
                "--first-parent",
                "--format=%h %s",
                f"{until}..HEAD",
                "--",
                *pathspecs(spec),
            ]).strip()
            if later:
                warnings.append(
                    "commits after the drafted range roll into the next release:\n"
                    + later
                )
    return errors, warnings


Fetch = Callable[[str], object]


def _default_fetch(url: str) -> object:
    return urllib.request.urlopen(url, timeout=NETWORK_TIMEOUT_SECONDS)


def _registry_has_version(spec: PackageSpec, version: str, fetch: Fetch) -> bool | None:
    """True/False when the registry answered; None when it has no registry.

    Raises ReleaseNotesError for any registry failure other than 404, so a
    5xx or an offline machine never leads to a tag.
    """
    template = REGISTRIES.get(spec.ecosystem)
    if template is None:
        return None
    url = template.format(name=spec.name.replace("/", "%2F"), version=version)
    try:
        with fetch(url) as response:  # type: ignore[attr-defined]
            payload = response.read()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return False
        raise ReleaseNotesError(
            f"registry returned HTTP {error.code} for {url}", EXIT_TAG_REFUSED
        ) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise ReleaseNotesError(
            f"could not reach the registry at {url}: {error}", EXIT_TAG_REFUSED
        ) from error
    if spec.ecosystem != "pub":
        return True
    data = json.loads(payload)
    return any(item.get("version") == version for item in data.get("versions", []))


def _canonical_remote(git: Git) -> str:
    for line in git.run(["remote", "-v"]).splitlines():
        parts = line.split()
        if len(parts) >= 2 and f"{REPO}" in parts[1] and "(push)" in line:
            return parts[0]
    return "origin"


def heading_commit(spec: PackageSpec, version: str, git: Git) -> str:
    """Finds the commit that added the `## <version>` heading."""
    output = git.run([
        "log",
        "-1",
        "--format=%H",
        "-G",
        rf"^## {re.escape(version)}\b",
        "--",
        spec.changelog,
    ]).strip()
    if not output:
        raise ReleaseNotesError(
            f"no commit adds '## {version}' to {spec.changelog}", EXIT_TAG_REFUSED
        )
    return output


def tag_release(
    spec: PackageSpec,
    version: str,
    git: Git,
    fetch: Fetch = _default_fetch,
    registry: bool = True,
    remote: str | None = None,
    dry_run: bool = False,
) -> str:
    """Creates and pushes the release tag; refuses when the registry lacks it."""
    tag = spec.tag_for(version)
    if tag_exists(spec, version, git):
        raise ReleaseNotesError(f"tag {tag} already exists", EXIT_TAG_REFUSED)
    if registry:
        served = _registry_has_version(spec, version, fetch)
        if served is False:
            raise ReleaseNotesError(
                f"{spec.name} {version} is not on the public registry yet; publish"
                " first, or pass --no-registry for an ecosystem without one",
                EXIT_TAG_REFUSED,
            )
    commit = heading_commit(spec, version, git)
    if dry_run:
        return f"would tag {commit[:12]} as {tag}"
    git.run(["tag", tag, commit])
    git.run(["push", remote or _canonical_remote(git), tag])
    return f"tagged {commit[:12]} as {tag}"


# --- PR lint -----------------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class Violation:
    rule: str
    level: str
    message: str


def _touches_package(touched: Iterable[str], specs: Sequence[PackageSpec]) -> bool:
    paths = [path for spec in specs for path in spec.paths]
    return any(any(file.startswith(prefix) for prefix in paths) for file in touched)


def _check_breaking_consistency(
    parsed: ParsedTitle, body: str, labels: Iterable[str]
) -> list[Violation]:
    """L2: `!` in the title if and only if a label or footer marks it breaking."""
    labeled = BREAKING_LABEL in set(labels)
    footer = has_breaking_footer(body)
    if parsed.breaking and not (labeled or footer):
        return [
            Violation(
                "L2",
                "error",
                f"title has '!' but the PR has neither the '{BREAKING_LABEL}' label nor"
                f" a '{BREAKING_FOOTER}' line; add one, or drop the '!'",
            )
        ]
    if (labeled or footer) and not parsed.breaking:
        return [
            Violation(
                "L2",
                "error",
                "the PR is marked breaking (label or footer) but the title lacks '!'",
            )
        ]
    return []


def _check_bullets(
    parsed: ParsedTitle,
    bullets: Sequence[Bullet],
    touched_paths: Iterable[str],
    specs: Sequence[PackageSpec],
) -> list[Violation]:
    """L3 to L5: notes on breaking PRs, known scopes, notes without a package."""
    violations: list[Violation] = []
    if parsed.breaking and not bullets:
        violations.append(
            Violation(
                "L3",
                "error",
                "a breaking PR needs a ```release-notes block describing the change and"
                " how to migrate",
            )
        )
    known = {spec.id for spec in specs}
    for bullet in bullets:
        if bullet.scope and bullet.scope not in known:
            violations.append(
                Violation(
                    "L4",
                    "error",
                    f"unknown package scope [{bullet.scope}]; known:"
                    f" {', '.join(sorted(known))}",
                )
            )
    if bullets and not _touches_package(touched_paths, specs):
        violations.append(
            Violation(
                "L5",
                "warning",
                "release-notes block present but no published package path changed",
            )
        )
    return violations


def check_pr(
    title: str,
    body: str,
    labels: Iterable[str],
    touched_paths: Iterable[str],
    specs: Sequence[PackageSpec],
) -> list[Violation]:
    """Applies the title and body rules L1 to L5."""
    parsed = parse_title(title)
    if parsed is None:
        types = ", ".join(ALLOWED_TYPES)
        return [
            Violation(
                "L1",
                "error",
                f"title must be '<type>(<scope>)!: <subject>' with type in {types}",
            )
        ]
    labels = list(labels)
    touched_paths = list(touched_paths)
    return [
        *_check_breaking_consistency(parsed, body, labels),
        *_check_bullets(parsed, release_notes_block(body), touched_paths, specs),
    ]


# --- Command line ------------------------------------------------------------


def _repo_root(path: str | None) -> str:
    target = path or os.getcwd()
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=target,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def _read_opt(path: str | None, fallback: str) -> str:
    if path is None or path == "-":
        return fallback
    if path == "/dev/null":
        return ""
    return _read(path)


def _body_lookup(body_source: str) -> BodyLookup | None:
    """Picks the PR body source: the API when asked for or when a token exists."""
    has_token = bool(os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN"))
    if body_source == "api" or (body_source == "auto" and has_token):
        return fetch_pr_body
    return None


def _write_section(
    spec: PackageSpec, changelog_path: str, section: str, carry: bool
) -> None:
    """Inserts a rendered section into the changelog on disk."""
    existing = _read(changelog_path) if os.path.exists(changelog_path) else ""
    if carry:
        existing = strip_unreleased(existing)
    with open(changelog_path, "w", encoding="utf-8") as handle:
        handle.write(insert_section(existing, section))


def _cmd_draft(args: argparse.Namespace, specs: list[PackageSpec], root: str) -> int:
    spec = find_package(specs, args.package)
    git = Git(root)
    since = resolve_anchor(spec, args.since, git)
    until = git.run(["rev-parse", args.until]).strip()
    commits = commits_in_range(spec, since, until, git)
    changelog_path = os.path.join(root, spec.changelog)
    carried = ""
    if args.carry_unreleased and os.path.exists(changelog_path):
        carried = read_unreleased(_read(changelog_path))
    lookup = _body_lookup(args.body_source)
    draft = build_draft(spec, commits, since, until, lookup, carried)
    if args.write and (args.format != "md" or not args.version):
        raise ReleaseNotesError(
            "--write requires --format md and --version", EXIT_USAGE
        )
    if args.format == "json":
        print(json.dumps(draft.to_json(), indent=2))
        return EXIT_OK
    version = args.version or "X.Y.Z"
    section = render_markdown(spec, draft, version, datetime.date.today())
    if args.write:
        _write_section(spec, changelog_path, section, args.carry_unreleased)
        print(f"wrote '## {version}' to {spec.changelog}")
        return EXIT_OK
    sys.stdout.write(section)
    return EXIT_OK


def _cmd_check_pr(args: argparse.Namespace, specs: list[PackageSpec]) -> int:
    title = _read_opt(args.title_file, args.title or "").strip()
    body = _read_opt(args.body_file, args.body or "")
    labels = [
        label.strip() for label in (args.labels or "").split(",") if label.strip()
    ]
    paths = [
        p.strip()
        for p in (
            _read_opt(args.paths_file, args.paths or "").replace(",", "\n").splitlines()
        )
        if p.strip()
    ]
    violations = check_pr(title, body, labels, paths, specs)
    for violation in violations:
        stream = sys.stderr if violation.level == "error" else sys.stdout
        print(f"{violation.level}: [{violation.rule}] {violation.message}", file=stream)
    if any(v.level == "error" for v in violations):
        return EXIT_USAGE
    print("ok: title and release notes pass L1 to L5")
    return EXIT_OK


def _cmd_read_section(
    args: argparse.Namespace, specs: list[PackageSpec], root: str
) -> int:
    spec = find_package(specs, args.package)
    print(read_section(_read(os.path.join(root, spec.changelog)), args.version))
    return EXIT_OK


def _cmd_verify(args: argparse.Namespace, specs: list[PackageSpec], root: str) -> int:
    spec = find_package(specs, args.package)
    changelog = _read(os.path.join(root, spec.changelog))
    errors, warnings = verify_release(spec, args.version, changelog, Git(root))
    for warning in warnings:
        print(f"warning: {warning}")
    for error in errors:
        print(f"error: {error}", file=sys.stderr)
    if errors:
        return EXIT_NO_SECTION
    print(f"ok: {spec.changelog} is ready to release {args.version}")
    return EXIT_OK


def _cmd_tag(args: argparse.Namespace, specs: list[PackageSpec], root: str) -> int:
    spec = find_package(specs, args.package)
    print(
        tag_release(
            spec,
            args.version,
            Git(root),
            registry=not args.no_registry,
            remote=args.remote,
            dry_run=args.dry_run,
        )
    )
    return EXIT_OK


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--repo-root", default=None)
    parser.add_argument(
        "--manifest", default=None, help=f"default: <repo>/{MANIFEST_PATH}"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    draft = sub.add_parser("draft", help="draft the next CHANGELOG section")
    draft.add_argument("--package", required=True)
    draft.add_argument("--since", default=None, help="commit or tag to start after")
    draft.add_argument("--until", default="HEAD")
    draft.add_argument("--version", default=None, help="version for the heading")
    draft.add_argument("--format", choices=("md", "json"), default="md")
    draft.add_argument(
        "--body-source", choices=("auto", "api", "commit"), default="auto"
    )
    draft.add_argument("--carry-unreleased", action="store_true")
    draft.add_argument("--write", action="store_true", help="insert into CHANGELOG.md")

    check = sub.add_parser("check-pr", help="lint a pull request title and body")
    check.add_argument("--title", default=None)
    check.add_argument("--title-file", default=None)
    check.add_argument("--body", default=None)
    check.add_argument("--body-file", default=None)
    check.add_argument("--labels", default="", help="comma-separated label names")
    check.add_argument("--paths", default=None, help="comma-separated changed files")
    check.add_argument("--paths-file", default=None)

    section = sub.add_parser("read-section", help="print a version's notes")
    section.add_argument("--package", required=True)
    section.add_argument("--version", required=True)

    verify = sub.add_parser(
        "verify-release", help="check a CHANGELOG before publishing"
    )
    verify.add_argument("--package", required=True)
    verify.add_argument("--version", required=True)

    tag = sub.add_parser("tag", help="tag a published version")
    tag.add_argument("--package", required=True)
    tag.add_argument("--version", required=True)
    tag.add_argument("--no-registry", action="store_true")
    tag.add_argument("--remote", default=None)
    tag.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        root = _repo_root(args.repo_root)
        specs = load_manifest(args.manifest or os.path.join(root, MANIFEST_PATH))
        if args.command == "draft":
            return _cmd_draft(args, specs, root)
        if args.command == "check-pr":
            return _cmd_check_pr(args, specs)
        if args.command == "read-section":
            return _cmd_read_section(args, specs, root)
        if args.command == "verify-release":
            return _cmd_verify(args, specs, root)
        return _cmd_tag(args, specs, root)
    except ManifestError as error:
        print(f"error: manifest: {error}", file=sys.stderr)
        return EXIT_MANIFEST
    except ReleaseNotesError as error:
        print(f"error: {error}", file=sys.stderr)
        return error.code
    except subprocess.CalledProcessError as error:
        print(
            f"error: {' '.join(error.cmd)} failed: {error.stderr.strip()}",
            file=sys.stderr,
        )
        return EXIT_USAGE


if __name__ == "__main__":
    sys.exit(main())
