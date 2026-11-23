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

"""Release notes context, validation, writing, and tagging per published package.

Feature pull requests do not edit CHANGELOG.md. At release time this script
builds a ground-truth bundle (`context`) from the `<last_tag>..HEAD` net diff,
commit history, PR descriptions, and internal dependency changelogs. It also
runs deterministic checks (`check-notes`) on generated bullets, writes the
`## X.Y.Z` section (`write-section`), lints PRs (`check-pr`), verifies release
changelogs (`verify-release`), reads sections (`read-section`), and creates
post-registry tags (`tag`).

Subcommands:

  context         Build the JSON ground-truth bundle for a package release.
  check-notes     Deterministically validate generated bullets and SemVer bump.
  write-section   Render and insert a `## X.Y.Z` section into CHANGELOG.md.
  check-pr        Lint a pull request's title, labels, and paths (L1, L2, L6).
  read-section    Print the body of a `## X.Y.Z` section.
  verify-release  Check a CHANGELOG before publishing a version.
  tag             Create the release tag once the public registry has it, or
                  `tag --pending` to tag every published release that still
                  lacks one (meant for a scheduled workflow).

Packages, their directories, dependencies, changelogs, and tag patterns live in
.github/release_packages.json. Runs on the standard library only, so it can be
invoked with a bare `python3`.

Tags are read from the local checkout. In a workflow, check out with
`fetch-depth: 0` and `fetch-tags: true`; otherwise `context` falls back to the
manifest's `bootstrap_since` and `verify-release` cannot see existing tags.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import time
from typing import Callable, Iterable, Sequence
import urllib.error
import urllib.request

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
EXIT_UNTAGGED = 6
EXIT_CHECK_FAILED = 7

# Longest title `check-pr` accepts, measured without the `(#NNNN)` suffix.
MAX_TITLE_LENGTH = 120
DEFAULT_MAX_DIFF_BYTES = 120_000
DEFAULT_BODY_BUDGET_SECONDS = 90.0
GRAPHQL_MIN_REMAINING = 100
GRAPHQL_DEFAULT_CHUNK = 50
NETWORK_TIMEOUT_SECONDS = 60

ECOSYSTEMS = ("python", "npm", "pub", "swiftpm", "github")
PRE_1_0_BUMPS = ("minor", "patch")
VALID_BUMPS = ("MAJOR", "MINOR", "PATCH", "NONE")
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

BREAKING_LABEL = "breaking-change"
# Lets a non-release PR fix an already released CHANGELOG section (L6).
CHANGELOG_EDIT_LABEL = "changelog-edit"
RELEASE_TYPE = "release"
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
REVERT_SHA_RE = re.compile(r"This reverts commit ([0-9a-f]{7,40})")
REVERT_PR_RE = re.compile(r"\(#(\d+)\)")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
DIFF_HEADER_RE = re.compile(r"^diff --git a/(.+?) b/(.+)$")
ADDITION_BULLET_RE = re.compile(r"^-\s+(?:Adds?|Introduces?|Supports?|Exposes?|New)\b")


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
    breaking_prefix: str = "**BREAKING CHANGE**: "
    internal_deps: tuple[str, ...] = ()
    pre_1_0_feature_bump: str = "minor"
    auto_tag: bool = True

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
    """Rejects excludes that git would never match."""
    if any(char in pattern for char in "*?[") and pattern.endswith("/"):
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
    feature_bump = raw.get("pre_1_0_feature_bump", "minor")
    if feature_bump not in PRE_1_0_BUMPS:
        raise ManifestError(
            f"{raw['id']}: invalid pre_1_0_feature_bump {feature_bump!r}"
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
        breaking_prefix=raw.get("breaking_prefix", "**BREAKING CHANGE**: "),
        internal_deps=tuple(raw.get("internal_deps", ())),
        pre_1_0_feature_bump=feature_bump,
        auto_tag=bool(raw.get("auto_tag", True)),
    )


def topological_order(specs: Sequence[PackageSpec]) -> list[PackageSpec]:
    """Returns specs in dependency-first order; raises ManifestError on cycles."""
    by_id = {spec.id: spec for spec in specs}
    visiting: set[str] = set()
    visited: set[str] = set()
    ordered: list[PackageSpec] = []

    def visit(pkg_id: str) -> None:
        if pkg_id in visited:
            return
        if pkg_id in visiting:
            raise ManifestError(f"cycle detected in internal_deps involving {pkg_id!r}")
        visiting.add(pkg_id)
        for dep in by_id[pkg_id].internal_deps:
            visit(dep)
        visiting.remove(pkg_id)
        visited.add(pkg_id)
        ordered.append(by_id[pkg_id])

    for spec in specs:
        visit(spec.id)
    return ordered


def _validate_internal_deps(specs: Sequence[PackageSpec]) -> None:
    by_id = {spec.id: spec for spec in specs}
    for spec in specs:
        for dep_id in spec.internal_deps:
            if dep_id == spec.id:
                raise ManifestError(f"{spec.id}: internal_deps cannot reference itself")
            if dep_id not in by_id:
                raise ManifestError(
                    f"{spec.id}: unknown internal_dep {dep_id!r} in manifest"
                )
            if by_id[dep_id].ecosystem != spec.ecosystem:
                raise ManifestError(
                    f"{spec.id}: internal_dep {dep_id!r} is in ecosystem"
                    f" {by_id[dep_id].ecosystem!r}, expected {spec.ecosystem!r}"
                )
    topological_order(specs)


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
    _validate_internal_deps(specs)
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


def strip_html_comments(text: str) -> str:
    """Removes `<!-- ... -->` spans, including multi-line ones."""
    return HTML_COMMENT_SPAN_RE.sub("", text)


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


def _validate_ref(ref: str, label: str) -> str:
    if not ref or ref.startswith("-"):
        raise ReleaseNotesError(f"invalid {label} ref {ref!r}", EXIT_USAGE)
    return ref


def _check_bootstrap_untagged(spec: PackageSpec, newest: str, git: Git) -> None:
    try:
        commit = heading_commit(spec, newest, git)
    except ReleaseNotesError:
        return
    if commit and not _is_ancestor(git, commit, spec.bootstrap_since or ""):
        raise ReleaseNotesError(
            f"{spec.id}: {spec.changelog} has '## {newest}' added after"
            f" bootstrap_since ({(spec.bootstrap_since or '')[:12]}) with no"
            " tag. Action needed: run 'release_notes.py tag --package"
            f" {spec.id} --version {newest}' before generating the next"
            " release.",
            EXIT_UNTAGGED,
        )


def resolve_anchor(
    spec: PackageSpec,
    since: str | None,
    git: Git,
    changelog: str | None = None,
) -> str:
    """Picks the commit the range starts after: --since, the tag, or bootstrap.

    When the changelog already has a newer `## X.Y.Z` heading than the anchor,
    that release was never tagged; generating notes from the old anchor would
    repeat its entries, so this refuses until the tag exists.
    """
    if since:
        return _validate_ref(since, "--since")
    tag = latest_tag(spec, git)
    newest = newest_heading(changelog) if changelog else None
    if tag:
        if newest and parse_version(newest) > spec.version_of_tag(tag):
            raise ReleaseNotesError(
                f"{spec.id}: {spec.changelog} has '## {newest}' but the newest tag is"
                f" {tag}. Action needed: run 'release_notes.py tag --package"
                f" {spec.id} --version {newest}' (or wait for the scheduled tag"
                " run) before generating the next release.",
                EXIT_UNTAGGED,
            )
        return tag
    if spec.bootstrap_since:
        if newest:
            _check_bootstrap_untagged(spec, newest, git)
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
    files: tuple[str, ...] = ()

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


def _commit_files_map(
    spec: PackageSpec, since: str, until: str, git: Git
) -> dict[str, tuple[str, ...]]:
    """Maps commit sha to the sorted package-scoped files touched by that commit."""
    output = git.run([
        "log",
        "--first-parent",
        "--reverse",
        "--name-only",
        "--format=COMMIT:%H",
        f"{since}..{until}",
        "--",
        *pathspecs(spec),
    ])
    files_by_sha: dict[str, list[str]] = {}
    current_sha: str | None = None
    for line in output.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("COMMIT:") and SHA_RE.match(stripped[7:]):
            current_sha = stripped[7:]
            files_by_sha.setdefault(current_sha, [])
        elif current_sha is not None:
            files_by_sha[current_sha].append(stripped)
    return {sha: tuple(sorted(set(paths))) for sha, paths in files_by_sha.items()}


def commits_in_range(
    spec: PackageSpec, since: str, until: str, git: Git
) -> list[Commit]:
    """Lists first-parent commits in since..until touching the package, oldest first."""
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
    files_by_sha = _commit_files_map(spec, since, until, git)
    commits = []
    for sha, title, body in zip(fields[0::3], fields[1::3], fields[2::3]):
        sha = sha.strip()
        if not SHA_RE.match(sha):
            raise ReleaseNotesError(f"unexpected git log record {sha!r}", EXIT_USAGE)
        commits.append(
            Commit(sha, title.strip(), body.strip(), files_by_sha.get(sha, ()))
        )
    return commits


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
    return bool(
        (parsed and parsed.type == "revert") or commit.title.startswith('Revert "')
    )


def _reverted_shas(commits: Sequence[Commit]) -> set[str]:
    """Returns shas of revert/target pairs cancelled inside the range."""
    by_sha = {commit.sha: commit for commit in commits}
    by_pr = {commit.pr: commit for commit in commits if commit.pr}
    dropped: set[str] = set()
    for commit in reversed(commits):
        if commit.sha in dropped or not _is_revert(commit):
            continue
        target = _revert_target(commit, by_sha, by_pr)
        if target is not None and target.sha not in dropped:
            dropped.update({commit.sha, target.sha})
    return dropped


# --- Three-tier PR body fetching ---------------------------------------------


def _default_packrat_db() -> Path:
    xdg = os.environ.get("XDG_DATA_HOME")
    base = Path(xdg) if xdg else Path.home() / ".local" / "share"
    return base / "packrat" / "repos.sqlite"


def _fetch_packrat_bodies(
    repo: str, pr_numbers: Sequence[int], db_path: Path | None = None
) -> dict[int, str]:
    """Reads PR bodies from local packrat SQLite if available and tracking repo."""
    if not pr_numbers:
        return {}
    path = db_path or _default_packrat_db()
    if not path.exists():
        return {}
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2.0)
    except sqlite3.Error:
        return {}
    try:
        placeholders = ",".join("?" for _ in pr_numbers)
        query = (
            "SELECT p.number, p.body FROM pull_requests p "
            "JOIN repos r ON r.repo_id = p.repo_id "
            f"WHERE r.full_name = ? AND p.number IN ({placeholders})"
        )
        rows = conn.execute(query, [repo, *pr_numbers]).fetchall()
        return {int(num): body for num, body in rows if body}
    except sqlite3.Error:
        return {}
    finally:
        conn.close()


GraphQLRunner = Callable[[str, float], "dict | None"]


def _default_graphql_runner(query: str, timeout: float) -> dict | None:
    try:
        result = subprocess.run(
            ["gh", "api", "graphql", "-f", f"query={query}"],
            capture_output=True,
            text=True,
            check=False,
            timeout=max(1.0, min(timeout, float(NETWORK_TIMEOUT_SECONDS))),
        )
        if not result.stdout.strip():
            return None
        payload = json.loads(result.stdout)
        return payload if isinstance(payload, dict) and "data" in payload else None
    except (
        subprocess.TimeoutExpired,
        FileNotFoundError,
        OSError,
        json.JSONDecodeError,
    ):
        return None


def _build_pr_graphql_query(owner: str, name: str, numbers: Sequence[int]) -> str:
    fields = "\n".join(
        f"    pr_{num}: pullRequest(number: {num}) {{ body }}" for num in numbers
    )
    return (
        "query {\n"
        "  rateLimit { cost remaining resetAt }\n"
        f'  repository(owner: "{owner}", name: "{name}") {{\n'
        f"{fields}\n"
        "  }\n"
        "}"
    )


def _next_chunk_size(current: int, cost: int, remaining: int) -> int:
    """Adjusts chunk size from observed GraphQL rateLimit cost and remaining."""
    usable = max(0, remaining - GRAPHQL_MIN_REMAINING)
    if usable <= 0:
        return 0
    if cost > 0 and cost > usable:
        scaled = max(1, (current * usable) // cost)
        return min(current, scaled)
    return current


def _parse_graphql_batch(
    repo_data: dict, batch: Sequence[int]
) -> tuple[dict[int, str], int]:
    bodies: dict[int, str] = {}
    errors = 0
    for num in batch:
        node = repo_data.get(f"pr_{num}")
        if isinstance(node, dict) and node.get("body") is not None:
            bodies[num] = str(node["body"])
        else:
            errors += 1
    return bodies, errors


def _fetch_graphql_bodies(
    repo: str,
    pr_numbers: Sequence[int],
    budget_seconds: float,
    graphql_runner: GraphQLRunner,
    clock: Callable[[], float],
) -> tuple[dict[int, str], int]:
    """Fetches PR bodies in GraphQL chunks bounded by rateLimit and wall-clock."""
    if not pr_numbers or "/" not in repo:
        return {}, 0
    owner, name = repo.split("/", 1)
    deadline = clock() + budget_seconds
    bodies: dict[int, str] = {}
    errors = 0
    chunk_size = GRAPHQL_DEFAULT_CHUNK
    idx = 0
    while idx < len(pr_numbers):
        remaining_time = deadline - clock()
        if remaining_time <= 0 or chunk_size <= 0:
            errors += len(pr_numbers) - idx
            break
        batch = pr_numbers[idx : idx + chunk_size]
        payload = graphql_runner(
            _build_pr_graphql_query(owner, name, batch), remaining_time
        )
        if not isinstance(payload, dict) or "data" not in payload:
            errors += len(pr_numbers) - idx
            break
        data = payload.get("data") or {}
        batch_bodies, batch_errors = _parse_graphql_batch(
            data.get("repository") or {}, batch
        )
        bodies.update(batch_bodies)
        errors += batch_errors
        idx += len(batch)
        rate = data.get("rateLimit") or {}
        if "remaining" in rate:
            chunk_size = _next_chunk_size(
                chunk_size, int(rate.get("cost", 1)), int(rate["remaining"])
            )
    return bodies, errors


def fetch_pr_bodies(
    repo: str,
    pr_numbers: Sequence[int],
    budget_seconds: float = DEFAULT_BODY_BUDGET_SECONDS,
    source: str = "auto",
    packrat_db: Path | None = None,
    graphql_runner: GraphQLRunner | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> tuple[dict[int, str], str, int]:
    """Fetches PR bodies via packrat -> batched GraphQL -> squash fallback."""
    unique_prs = sorted(set(pr_numbers))
    if not unique_prs or source == "commit":
        return {}, "commit", 0
    bodies: dict[int, str] = {}
    used_sources: list[str] = []
    if source in ("auto", "packrat"):
        packrat_hits = _fetch_packrat_bodies(repo, unique_prs, packrat_db)
        if packrat_hits:
            bodies.update(packrat_hits)
            used_sources.append("packrat")
    missing = [num for num in unique_prs if num not in bodies]
    errors = 0
    if missing and source in ("auto", "graphql"):
        runner = graphql_runner or _default_graphql_runner
        gql_hits, errors = _fetch_graphql_bodies(
            repo, missing, budget_seconds, runner, clock
        )
        if gql_hits:
            bodies.update(gql_hits)
            used_sources.append("graphql")
    if len(bodies) < len(unique_prs) and "commit" not in used_sources:
        used_sources.append("commit")
    return bodies, "+".join(used_sources) if used_sources else "commit", errors


# --- Diff truncation & context building --------------------------------------


def _is_public_export_file(path: str) -> bool:
    """True when `path` is likely a package public entrypoint or type surface."""
    name = os.path.basename(path)
    if name in ("index.ts", "public-api.ts", "__init__.py", "Package.swift"):
        return True
    if name.endswith(".d.ts"):
        return True
    if (
        "/lib/" in f"/{path}"
        and "/lib/src/" not in f"/{path}"
        and name.endswith(".dart")
    ):
        return True
    return False


def _split_diff_chunks(diff_text: str) -> list[tuple[str, str]]:
    """Splits a unified `git diff` into `(path, chunk_text)` pairs."""
    chunks: list[tuple[str, list[str]]] = []
    for line in diff_text.splitlines(keepends=True):
        match = DIFF_HEADER_RE.match(line)
        if match:
            chunks.append((match.group(2), [line]))
        elif chunks:
            chunks[-1][1].append(line)
    return [(path, "".join(lines)) for path, lines in chunks]


def truncate_diff(diff_text: str, max_diff_bytes: int) -> tuple[str, bool, list[str]]:
    """Caps diff size, keeping public-export files first, then smallest files."""
    if len(diff_text.encode("utf-8")) <= max_diff_bytes:
        return diff_text, False, []
    chunks = _split_diff_chunks(diff_text)
    prioritized = sorted(
        chunks,
        key=lambda item: (
            0 if _is_public_export_file(item[0]) else 1,
            len(item[1].encode("utf-8")),
            item[0],
        ),
    )
    kept: list[str] = []
    omitted: list[str] = []
    used_bytes = 0
    for path, chunk in prioritized:
        size = len(chunk.encode("utf-8"))
        if used_bytes + size <= max_diff_bytes:
            kept.append(chunk)
            used_bytes += size
        else:
            omitted.append(path)
    return "".join(kept), True, sorted(omitted)


def _current_version(spec: PackageSpec, changelog: str, git: Git) -> str:
    tag = latest_tag(spec, git)
    if tag:
        ver = spec.version_of_tag(tag)
        if ver is not None:
            return ".".join(str(part) for part in ver)
    newest = newest_heading(changelog) if changelog else None
    if newest:
        return newest
    return spec.bootstrap_version or "0.0.0"


def _read_git_file(git: Git, ref: str, path: str) -> str:
    try:
        return git.run(["show", f"{ref}:{path}"])
    except subprocess.CalledProcessError:
        return ""


def _dep_notes_from_file(dep_id: str, path: Path) -> dict[str, object] | None:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return None
    newest = newest_heading(text)
    if newest:
        try:
            section = read_section(text, newest)
            return {"package": dep_id, "versions": [newest], "markdown": section}
        except ReleaseNotesError:
            return None
    return {"package": dep_id, "versions": [], "markdown": text}


def _dep_notes_from_git(
    dep_spec: PackageSpec, since: str, until: str, git: Git
) -> dict[str, object] | None:
    old_text = _read_git_file(git, since, dep_spec.changelog)
    new_text = _read_git_file(git, until, dep_spec.changelog)
    if not new_text:
        return None
    old_versions = {
        match.group("version")
        for heading, _ in _sections(old_text)
        if (match := HEADING_RE.match(heading))
    }
    added_versions: list[str] = []
    blocks: list[str] = []
    for heading, _ in _sections(new_text):
        match = HEADING_RE.match(heading)
        if not match:
            continue
        version = match.group("version")
        if version in old_versions:
            continue
        try:
            body = read_section(new_text, version)
        except ReleaseNotesError:
            continue
        added_versions.append(version)
        blocks.append(f"## {version}\n\n{body}")
    if not added_versions:
        return None
    return {
        "package": dep_spec.id,
        "versions": added_versions,
        "markdown": "\n\n".join(blocks),
    }


def _collect_internal_dep_notes(
    spec: PackageSpec,
    specs: Sequence[PackageSpec],
    since: str,
    until: str,
    dep_changelogs: dict[str, Path],
    git: Git,
) -> list[dict[str, object]]:
    by_id = {item.id: item for item in specs}
    notes: list[dict[str, object]] = []
    for dep_id in spec.internal_deps:
        if dep_id in dep_changelogs:
            entry = _dep_notes_from_file(dep_id, dep_changelogs[dep_id])
        elif dep_id in by_id:
            entry = _dep_notes_from_git(by_id[dep_id], since, until, git)
        else:
            entry = None
        if entry:
            notes.append(entry)
    return notes


def _build_commit_records(
    commits: Sequence[Commit],
    pr_bodies: dict[int, str],
    reverted: set[str],
    changed_files: set[str],
) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for commit in commits:
        fetched_body = pr_bodies.get(commit.pr) if commit.pr else None
        body = fetched_body if fetched_body else commit.body
        parsed = commit.parsed
        breaking_hint = (
            bool(parsed and parsed.breaking)
            or has_breaking_footer(body)
            or has_breaking_footer(commit.body)
        )
        net_zero = commit.sha in reverted or (
            bool(commit.files) and not any(f in changed_files for f in commit.files)
        )
        records.append({
            "pr": commit.pr,
            "sha": commit.sha,
            "title": commit.title,
            "body": body,
            "breaking_hint": breaking_hint,
            "files": list(commit.files),
            "net_zero": net_zero,
        })
    return records


def build_context(
    spec: PackageSpec,
    since: str | None,
    until: str,
    dep_changelogs: dict[str, Path],
    max_diff_bytes: int = DEFAULT_MAX_DIFF_BYTES,
    carry_unreleased: bool = False,
    body_budget_seconds: float = DEFAULT_BODY_BUDGET_SECONDS,
    *,
    specs: Sequence[PackageSpec] = (),
    git: Git,
    changelog: str = "",
    body_source: str = "auto",
    packrat_db: Path | None = None,
    graphql_runner: GraphQLRunner | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, object]:
    """Builds the deterministic JSON ground-truth bundle for a package release."""
    anchor = resolve_anchor(spec, since, git, changelog)
    until_ref = _validate_ref(until, "--until")
    until_sha = git.run(["rev-parse", "--verify", f"{until_ref}^{{commit}}"]).strip()
    pspecs = pathspecs(spec)
    diff_stat = git.run(
        ["diff", "--stat=1000", f"{anchor}..{until_sha}", "--", *pspecs]
    ).strip()
    changed_files = {
        line.strip()
        for line in git.run(
            ["diff", "--name-only", f"{anchor}..{until_sha}", "--", *pspecs]
        ).splitlines()
        if line.strip()
    }
    full_diff = git.run(["diff", f"{anchor}..{until_sha}", "--", *pspecs])
    net_diff, diff_truncated, omitted_files = truncate_diff(full_diff, max_diff_bytes)

    commits = commits_in_range(spec, anchor, until_sha, git)
    reverted = _reverted_shas(commits)
    pr_numbers = [commit.pr for commit in commits if commit.pr is not None]
    pr_bodies, resolved_source, body_errors = fetch_pr_bodies(
        REPO,
        pr_numbers,
        budget_seconds=body_budget_seconds,
        source=body_source,
        packrat_db=packrat_db,
        graphql_runner=graphql_runner,
        clock=clock,
    )

    commit_records = _build_commit_records(commits, pr_bodies, reverted, changed_files)

    dep_notes = _collect_internal_dep_notes(
        spec, specs, anchor, until_sha, dep_changelogs, git
    )
    carried = read_unreleased(changelog) if carry_unreleased and changelog else ""
    return {
        "package": spec.id,
        "current_version": _current_version(spec, changelog, git),
        "pre_1_0_feature_bump": spec.pre_1_0_feature_bump,
        "since": anchor,
        "until": until_sha,
        "diff_stat": diff_stat,
        "diff_truncated": diff_truncated,
        "omitted_files": omitted_files,
        "body_source": resolved_source,
        "body_fetch_errors": body_errors,
        "net_diff": net_diff,
        "commits": commit_records,
        "internal_dep_notes": dep_notes,
        "carried_unreleased": carried,
    }


# --- Deterministic release-notes checker (Gates 1 & 3) -----------------------


def _mentions_symbol(text: str, symbol: str) -> bool:
    return bool(
        re.search(rf"(?<![A-Za-z0-9_]){re.escape(symbol)}(?![A-Za-z0-9_])", text)
    )


def _check_removed_symbols(
    spec: PackageSpec,
    removed: Sequence[dict],
    bullets: Sequence[str],
) -> list[dict[str, str]]:
    violations: list[dict[str, str]] = []
    for item in removed:
        symbol = str(item.get("symbol", ""))
        if not symbol:
            continue
        matching = [b for b in bullets if _mentions_symbol(b, symbol)]
        if not matching:
            violations.append({
                "rule": "api_diff_completeness",
                "issue": f"Removed public symbol {symbol!r} is missing from bullets.",
                "fix": (
                    f"Add a bullet starting with '- {spec.breaking_prefix}' naming"
                    f" {symbol}."
                ),
            })
        elif not any(spec.breaking_prefix in b for b in matching):
            violations.append({
                "rule": "api_diff_completeness",
                "issue": (
                    f"Removed symbol {symbol!r} lacks breaking prefix"
                    f" {spec.breaking_prefix!r}."
                ),
                "fix": (
                    f"Prefix the bullet mentioning {symbol} with"
                    f" {spec.breaking_prefix!r}."
                ),
            })
    return violations


def _check_changed_symbols(
    spec: PackageSpec,
    changed: Sequence[dict],
    bullets: Sequence[str],
    joined_flags: str,
) -> list[dict[str, str]]:
    violations: list[dict[str, str]] = []
    for item in changed:
        symbol = str(item.get("symbol", ""))
        if not symbol:
            continue
        breaking = item.get("breaking")
        matching = [b for b in bullets if _mentions_symbol(b, symbol)]
        if not matching:
            violations.append({
                "rule": "api_diff_completeness",
                "issue": f"Changed public symbol {symbol!r} is missing from bullets.",
                "fix": f"Document the change to {symbol} in bullets.",
            })
        elif breaking is True and not any(spec.breaking_prefix in b for b in matching):
            violations.append({
                "rule": "api_diff_completeness",
                "issue": (
                    f"Breaking change to {symbol!r} lacks prefix"
                    f" {spec.breaking_prefix!r}."
                ),
                "fix": (
                    f"Prefix the bullet mentioning {symbol} with"
                    f" {spec.breaking_prefix!r}."
                ),
            })
        if breaking == "unknown" and not _mentions_symbol(joined_flags, symbol):
            violations.append({
                "rule": "api_diff_completeness",
                "issue": (
                    f"Uncertain breaking change to {symbol!r} is missing from"
                    " human_review_flags."
                ),
                "fix": f"Add {symbol} to human_review_flags for manual verification.",
            })
    return violations


def _check_added_symbols(
    added: Sequence[dict], joined_bullets: str
) -> list[dict[str, str]]:
    violations: list[dict[str, str]] = []
    for item in added:
        symbol = str(item.get("symbol", ""))
        if symbol and not _mentions_symbol(joined_bullets, symbol):
            violations.append({
                "rule": "api_diff_completeness",
                "issue": f"Added public symbol {symbol!r} is missing from bullets.",
                "fix": f"Add a bullet naming {symbol}.",
            })
    return violations


def _check_api_diff_completeness(
    spec: PackageSpec,
    api_surface: dict[str, object],
    bullets: Sequence[str],
    flags: Sequence[str],
) -> list[dict[str, str]]:
    """Gate 1: static API symbol coverage, breaking prefixes, degraded flag."""
    status = api_surface.get("status")
    joined_flags = "\n".join(flags)
    if status == "unavailable":
        if "no_static_api_diff" not in joined_flags:
            return [{
                "rule": "api_diff_completeness",
                "issue": (
                    "api_surface is unavailable but human_review_flags lacks"
                    " 'no_static_api_diff'"
                ),
                "fix": "Add 'no_static_api_diff' to human_review_flags.",
            }]
        return []
    if status != "ok":
        return []
    return [
        *_check_removed_symbols(spec, api_surface.get("removed", []), bullets),
        *_check_changed_symbols(
            spec, api_surface.get("changed", []), bullets, joined_flags
        ),
        *_check_added_symbols(api_surface.get("added", []), "\n".join(bullets)),
    ]


def _active_breaking_commits(context: dict[str, object]) -> list[dict]:
    return [
        commit
        for commit in context.get("commits", [])
        if isinstance(commit, dict)
        and commit.get("breaking_hint")
        and not commit.get("net_zero")
    ]


def _check_breaking_commit_hints(
    spec: PackageSpec,
    context: dict[str, object],
    bullets: Sequence[str],
    flags: Sequence[str],
) -> list[dict[str, str]]:
    """Ensures non-net_zero breaking_hint commits are documented or flagged."""
    active = _active_breaking_commits(context)
    if not active:
        return []
    has_breaking_bullet = any(spec.breaking_prefix in b for b in bullets)
    if has_breaking_bullet:
        return []
    joined_flags = "\n".join(flags)
    violations: list[dict[str, str]] = []
    for commit in active:
        ref = (
            f"#{commit['pr']}" if commit.get("pr") else str(commit.get("sha", ""))[:12]
        )
        if ref and ref not in joined_flags:
            violations.append({
                "rule": "api_diff_completeness",
                "issue": (
                    f"Commit {ref} has breaking_hint=true but no bullet uses"
                    f" {spec.breaking_prefix!r} and {ref} is not in"
                    " human_review_flags."
                ),
                "fix": (
                    f"Add a breaking bullet with {spec.breaking_prefix!r} or"
                    f" explain why {ref} is non-breaking in human_review_flags."
                ),
            })
    return violations


def _has_breaking_signal(
    spec: PackageSpec,
    api_surface: dict[str, object],
    bullets: Sequence[str],
    context: dict[str, object],
) -> bool:
    if any(spec.breaking_prefix in bullet for bullet in bullets):
        return True
    if _active_breaking_commits(context):
        return True
    if api_surface.get("status") != "ok":
        return False
    if api_surface.get("removed"):
        return True
    return any(item.get("breaking") is True for item in api_surface.get("changed", []))


def _has_addition_signal(
    api_surface: dict[str, object], bullets: Sequence[str]
) -> bool:
    if api_surface.get("status") == "ok" and api_surface.get("added"):
        return True
    return any(ADDITION_BULLET_RE.match(bullet.strip()) for bullet in bullets)


def _expected_bump(
    spec: PackageSpec,
    current_version: str,
    breaking: bool,
    addition: bool,
) -> str:
    parsed_ver = parse_version(current_version) or (0, 0, 0)
    if parsed_ver < (1, 0, 0):
        if breaking:
            return "MINOR"
        if addition:
            return spec.pre_1_0_feature_bump.upper()
        return "PATCH"
    if breaking:
        return "MAJOR"
    if addition:
        return "MINOR"
    return "PATCH"


def _check_semver_consistency(
    spec: PackageSpec,
    api_surface: dict[str, object],
    bullets: Sequence[str],
    recommended_bump: str,
    context: dict[str, object],
) -> list[dict[str, str]]:
    """Gate 3: version-aware pre-1.0 vs post-1.0 SemVer bump rules."""
    bump = recommended_bump.strip().upper()
    if bump not in VALID_BUMPS:
        return [{
            "rule": "semver_consistency",
            "issue": f"Invalid recommended_bump {recommended_bump!r}.",
            "fix": "Set recommended_bump to one of MAJOR, MINOR, PATCH, NONE.",
        }]
    if not bullets:
        if bump != "NONE":
            return [{
                "rule": "semver_consistency",
                "issue": f"Empty bullets require NONE bump, got {bump}.",
                "fix": "Set recommended_bump to NONE when bullets is empty.",
            }]
        return []
    current_version = str(context.get("current_version", "0.0.0"))
    breaking = _has_breaking_signal(spec, api_surface, bullets, context)
    addition = _has_addition_signal(api_surface, bullets)
    expected = _expected_bump(spec, current_version, breaking, addition)
    if bump != expected:
        return [{
            "rule": "semver_consistency",
            "issue": (
                f"{spec.id} ({current_version}) requires {expected} bump, got {bump}."
            ),
            "fix": f"Set recommended_bump to {expected}.",
        }]
    return []


def check_notes(
    spec: PackageSpec,
    api_surface: dict[str, object],
    gen_output: dict[str, object],
    context: dict[str, object],
) -> tuple[bool, list[dict[str, str]]]:
    """Runs deterministic Gates 1 (API diff) and 3 (SemVer) on generator output."""
    bullets = [str(b) for b in gen_output.get("bullets", [])]
    flags = [str(f) for f in gen_output.get("human_review_flags", [])]
    recommended_bump = str(gen_output.get("recommended_bump", ""))

    violations = [
        *_check_api_diff_completeness(spec, api_surface, bullets, flags),
        *_check_breaking_commit_hints(spec, context, bullets, flags),
        *_check_semver_consistency(
            spec, api_surface, bullets, recommended_bump, context
        ),
    ]
    return not violations, violations


# --- Rendering and CHANGELOG writing -----------------------------------------


def range_comment(spec: PackageSpec, version: str, since: str, until: str) -> str:
    return f"<!-- release-notes: {spec.id} {version} range {since}..{until} -->"


def heading_for(version: str) -> str:
    """Renders an undated `## X.Y.Z` heading for all packages."""
    return f"## {version}"


def render_markdown(
    spec: PackageSpec,
    version: str,
    since: str,
    until: str,
    bullets: Sequence[str],
    carried: str = "",
) -> str:
    """Renders a release section: heading, range comment, carried notes, bullets."""
    lines = [
        heading_for(version),
        "",
        range_comment(spec, version, since, until),
        "",
    ]
    if carried.strip():
        lines.extend([CARRIED_MARKER, carried.strip(), ""])
    cleaned = [bullet.strip() for bullet in bullets if bullet.strip()]
    for bullet in cleaned:
        lines.append(bullet if bullet.startswith("- ") else f"- {bullet}")
    if not cleaned and not carried.strip():
        lines.append("- No consumer-facing changes.")
    return "\n".join(lines).rstrip() + "\n"


def write_section(
    spec: PackageSpec,
    version: str,
    since: str,
    until: str,
    bullets: Sequence[str],
    carry_unreleased: bool = False,
    *,
    changelog_path: str | None = None,
    existing_changelog: str | None = None,
) -> str:
    """Renders and inserts a release section; writes to disk if path is given."""
    if existing_changelog is None:
        existing = (
            _read(changelog_path)
            if changelog_path and os.path.exists(changelog_path)
            else ""
        )
    else:
        existing = existing_changelog
    target_ver = parse_version(version)
    if target_ver is None:
        raise ReleaseNotesError(f"invalid version {version!r}", EXIT_USAGE)
    newest = newest_heading(existing) if existing else None
    if newest and target_ver <= parse_version(newest):
        raise ReleaseNotesError(
            f"{spec.changelog} already has '## {newest}'; new version"
            f" {version!r} must be strictly greater",
            EXIT_USAGE,
        )
    carried = read_unreleased(existing) if carry_unreleased and existing else ""
    section = render_markdown(spec, version, since, until, bullets, carried)
    base = strip_unreleased(existing) if existing else ""
    updated = insert_section(base, section)
    if changelog_path:
        with open(changelog_path, "w", encoding="utf-8") as handle:
            handle.write(updated)
    return updated


def _parse_markdown_bullets(raw: str) -> list[str]:
    bullets: list[str] = []
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith(("- ", "* ")):
            bullets.append("- " + stripped[2:].strip())
        elif bullets:
            bullets[-1] = f"{bullets[-1]} {stripped}"
        else:
            bullets.append(f"- {stripped}")
    return bullets


def _load_bullets_file(path: str) -> list[str]:
    """Reads bullets from a generator JSON file or a Markdown bullet list."""
    raw = _read(path).strip()
    if not raw:
        return []
    if raw[0] in ("{", "["):
        data = json.loads(raw)
        if isinstance(data, dict):
            return [str(item) for item in data.get("bullets", [])]
        if isinstance(data, list):
            return [str(item) for item in data]
    return _parse_markdown_bullets(raw)


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


def newest_heading(changelog: str) -> str | None:
    """Returns the first `## X.Y.Z` heading's version, skipping `## Unreleased`."""
    for heading, _ in _sections(changelog):
        match = HEADING_RE.match(heading)
        if match:
            return match.group("version")
    return None


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


def _heading_versions(changelog: str) -> list[tuple[int, int, int]]:
    """Returns the parsed version of every `## X.Y.Z` heading, in file order."""
    versions = []
    for heading, _ in _sections(changelog):
        match = HEADING_RE.match(heading)
        if match:
            versions.append(parse_version(match.group("version")))
    return versions


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
    versions = _heading_versions(changelog)
    if len(versions) != len(set(versions)):
        errors.append("duplicate version headings found")
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
    """True/False when the registry answered; None when it has no registry."""
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


def pending_releases(
    specs: Sequence[PackageSpec], root: str, git: Git
) -> list[tuple[PackageSpec, str]]:
    """Packages whose newest changelog heading has no tag yet."""
    pending = []
    for spec in specs:
        path = os.path.join(root, spec.changelog)
        if not os.path.exists(path):
            continue
        version = newest_heading(_read(path))
        if version and not tag_exists(spec, version, git):
            pending.append((spec, version))
    return pending


def tag_pending(
    specs: Sequence[PackageSpec],
    root: str,
    git: Git,
    fetch: Fetch = _default_fetch,
    registry: bool = True,
    remote: str | None = None,
    dry_run: bool = False,
) -> list[str]:
    """Tags every pending release the registry already serves; reports the rest.

    Skips packages with `auto_tag: false` (such as `a2ui_cli` and `swift`) and
    ecosystems without a registry.
    """
    lines = []
    for spec, version in pending_releases(specs, root, git):
        if not spec.auto_tag:
            lines.append(
                f"skip {spec.id} {version}: auto_tag is disabled; tag it by hand"
            )
            continue
        if registry and spec.ecosystem not in REGISTRIES:
            lines.append(f"skip {spec.id} {version}: no registry; tag it by hand")
            continue
        try:
            served = _registry_has_version(spec, version, fetch) if registry else True
            if served is False:
                lines.append(f"wait {spec.id} {version}: not on the registry yet")
                continue
            lines.append(
                tag_release(spec, version, git, fetch, registry, remote, dry_run)
            )
        except ReleaseNotesError as error:
            lines.append(f"error {spec.id} {version}: {error}")
    return lines or ["nothing pending: every changelog heading has a tag"]


# --- PR lint (L1, L2, L6) ----------------------------------------------------


@dataclasses.dataclass(frozen=True)
class Violation:
    rule: str
    level: str
    message: str


def _check_breaking_consistency(
    parsed: ParsedTitle, body: str, labels: Iterable[str]
) -> list[Violation]:
    """L2: `!` in the title if and only if a label or footer marks it breaking."""
    labeled = BREAKING_LABEL in labels
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


def _is_release_pr(parsed: ParsedTitle) -> bool:
    return parsed.type == RELEASE_TYPE or (
        parsed.type == "chore" and parsed.scope == "release"
    )


def _check_changelog_edits(
    parsed: ParsedTitle,
    labels: Sequence[str],
    touched_paths: Sequence[str],
    specs: Sequence[PackageSpec],
) -> list[Violation]:
    """L6: only release PRs (or a labeled exception) may edit a CHANGELOG.md."""
    if _is_release_pr(parsed) or CHANGELOG_EDIT_LABEL in labels:
        return []
    changelogs = {spec.changelog for spec in specs}
    touched = sorted(path for path in touched_paths if path in changelogs)
    if not touched:
        return []
    return [
        Violation(
            "L6",
            "error",
            "CHANGELOG.md is generated at release time; do not edit "
            + ", ".join(touched)
            + ". Describe consumer-facing changes in the PR title or description"
            f" instead, or add the '{CHANGELOG_EDIT_LABEL}' label for a fix to an"
            " already released section.",
        )
    ]


def _check_title_length(title: str) -> list[Violation]:
    """L1: the title without its `(#NNNN)` suffix fits in MAX_TITLE_LENGTH."""
    bare = re.sub(r"\s+\(#\d+\)\s*$", "", title.strip())
    if len(bare) <= MAX_TITLE_LENGTH:
        return []
    return [
        Violation(
            "L1",
            "error",
            f"title is {len(bare)} characters; keep it to {MAX_TITLE_LENGTH} or"
            " fewer and move detail into the description",
        )
    ]


def check_pr(
    title: str,
    body: str,
    labels: Iterable[str],
    touched_paths: Iterable[str],
    specs: Sequence[PackageSpec],
) -> list[Violation]:
    """Applies pull request rules L1, L2, and L6."""
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
        *_check_title_length(title),
        *_check_breaking_consistency(parsed, body, labels),
        *_check_changelog_edits(parsed, labels, touched_paths, specs),
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


def _parse_dep_changelogs(raw_items: Sequence[str]) -> dict[str, Path]:
    mapping: dict[str, Path] = {}
    for item in raw_items:
        if "=" not in item:
            raise ReleaseNotesError(
                f"invalid --dep-changelog {item!r}; expected <pkg_id>=<path>",
                EXIT_USAGE,
            )
        pkg_id, path_str = item.split("=", 1)
        mapping[pkg_id.strip()] = Path(path_str.strip())
    return mapping


def _cmd_context(args: argparse.Namespace, specs: list[PackageSpec], root: str) -> int:
    spec = find_package(specs, args.package)
    git = Git(root)
    changelog_path = os.path.join(root, spec.changelog)
    changelog = _read(changelog_path) if os.path.exists(changelog_path) else ""
    dep_changelogs = _parse_dep_changelogs(args.dep_changelog or ())
    ctx = build_context(
        spec,
        args.since,
        args.until,
        dep_changelogs,
        max_diff_bytes=args.max_diff_bytes,
        carry_unreleased=args.carry_unreleased,
        body_budget_seconds=args.body_budget_seconds,
        specs=specs,
        git=git,
        changelog=changelog,
        body_source=args.body_source,
    )
    print(json.dumps(ctx, indent=2))
    return EXIT_OK


def _read_json_file(path: str, label: str) -> dict[str, object]:
    try:
        data = json.loads(_read(path))
    except (OSError, json.JSONDecodeError) as error:
        raise ReleaseNotesError(
            f"failed to read {label} ({path}): {error}", EXIT_USAGE
        ) from error
    if not isinstance(data, dict):
        raise ReleaseNotesError(
            f"{label} ({path}) must contain a JSON object", EXIT_USAGE
        )
    return data


def _cmd_check_notes(args: argparse.Namespace, specs: list[PackageSpec]) -> int:
    api_surface = _read_json_file(args.api, "--api")
    gen_output = _read_json_file(args.notes, "--notes")
    context = _read_json_file(args.context, "--context")
    package_id = args.package or context.get("package")
    if not package_id:
        raise ReleaseNotesError(
            "check-notes needs --package or a 'package' field in --context",
            EXIT_USAGE,
        )
    spec = find_package(specs, str(package_id))
    passed, violations = check_notes(spec, api_surface, gen_output, context)
    result = {
        "verdict": "PASS" if passed else "FAIL",
        "hard_violations": violations,
    }
    print(json.dumps(result, indent=2))
    return EXIT_OK if passed else EXIT_CHECK_FAILED


def _cmd_write_section(
    args: argparse.Namespace, specs: list[PackageSpec], root: str
) -> int:
    spec = find_package(specs, args.package)
    try:
        bullets = _load_bullets_file(args.bullets_file)
    except (OSError, json.JSONDecodeError) as error:
        raise ReleaseNotesError(
            f"failed to read --bullets-file ({args.bullets_file}): {error}",
            EXIT_USAGE,
        ) from error
    git = Git(root)
    since = _validate_ref(args.since, "--since")
    until_ref = _validate_ref(args.until, "--until")
    until_sha = git.run(["rev-parse", "--verify", f"{until_ref}^{{commit}}"]).strip()
    changelog_path = os.path.join(root, spec.changelog)
    if args.stdout:
        existing = _read(changelog_path) if os.path.exists(changelog_path) else ""
        carried = (
            read_unreleased(existing) if args.carry_unreleased and existing else ""
        )
        sys.stdout.write(
            render_markdown(spec, args.version, since, until_sha, bullets, carried)
        )
        return EXIT_OK
    write_section(
        spec,
        args.version,
        since,
        until_sha,
        bullets,
        carry_unreleased=args.carry_unreleased,
        changelog_path=changelog_path,
    )
    print(f"wrote '## {args.version}' to {spec.changelog}")
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
    print("ok: pull request passes L1, L2, and L6")
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
    git = Git(root)
    if args.pending:
        for line in tag_pending(
            specs,
            root,
            git,
            registry=not args.no_registry,
            remote=args.remote,
            dry_run=args.dry_run,
        ):
            print(line)
        return EXIT_OK
    if not (args.package and args.version):
        raise ReleaseNotesError(
            "tag needs --package and --version, or --pending", EXIT_USAGE
        )
    spec = find_package(specs, args.package)
    print(
        tag_release(
            spec,
            args.version,
            git,
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

    ctx = sub.add_parser("context", help="build JSON context bundle for a package")
    ctx.add_argument("--package", required=True)
    ctx.add_argument("--since", default=None, help="commit or tag to start after")
    ctx.add_argument("--until", default="HEAD")
    ctx.add_argument(
        "--dep-changelog",
        action="append",
        default=[],
        help="upstream changelog override in <pkg_id>=<path> form (repeatable)",
    )
    ctx.add_argument("--max-diff-bytes", type=int, default=DEFAULT_MAX_DIFF_BYTES)
    ctx.add_argument("--carry-unreleased", action="store_true")
    ctx.add_argument(
        "--body-source",
        choices=("auto", "packrat", "graphql", "commit"),
        default="auto",
    )
    ctx.add_argument(
        "--body-budget-seconds", type=float, default=DEFAULT_BODY_BUDGET_SECONDS
    )
    ctx.add_argument("--format", choices=("json",), default="json")

    cn = sub.add_parser(
        "check-notes", help="deterministically validate generated bullets and bump"
    )
    cn.add_argument("--package", default=None)
    cn.add_argument("--api", required=True, help="path to api_surface.json")
    cn.add_argument("--notes", required=True, help="path to generator output JSON")
    cn.add_argument("--context", required=True, help="path to context.json")

    ws = sub.add_parser("write-section", help="render and insert a CHANGELOG section")
    ws.add_argument("--package", required=True)
    ws.add_argument("--version", required=True)
    ws.add_argument("--since", required=True)
    ws.add_argument("--until", required=True)
    ws.add_argument(
        "--bullets-file",
        required=True,
        help="path to generator JSON or Markdown bullet list",
    )
    ws.add_argument("--carry-unreleased", action="store_true")
    ws.add_argument(
        "--stdout",
        action="store_true",
        help="print rendered section instead of writing CHANGELOG.md",
    )

    check = sub.add_parser("check-pr", help="lint a pull request title and paths")
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
    tag.add_argument("--package", default=None)
    tag.add_argument("--version", default=None)
    tag.add_argument(
        "--pending",
        action="store_true",
        help="tag every package whose newest changelog heading the registry serves",
    )
    tag.add_argument("--no-registry", action="store_true")
    tag.add_argument("--remote", default=None)
    tag.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        root = _repo_root(args.repo_root)
        specs = load_manifest(args.manifest or os.path.join(root, MANIFEST_PATH))
        if args.command == "context":
            return _cmd_context(args, specs, root)
        if args.command == "check-notes":
            return _cmd_check_notes(args, specs)
        if args.command == "write-section":
            return _cmd_write_section(args, specs, root)
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
