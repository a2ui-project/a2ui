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

"""Version arithmetic and release preflight checks for the Python SDKs.

Each package's version lives in its own git tag series rather than in a file,
so this module reads the latest tag, computes the next version, cuts the
changelog and validates that the release will not break the dependency between
a2ui-agent-sdk and a2ui-core.

Used by .github/workflows/release-pypi.yml. Runs on the standard library only,
so it can be invoked with a bare `python3` before any dependency sync.
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
import tomllib
from typing import Iterable, Sequence

BumpLevel = str
VALID_BUMPS = ("major", "minor", "patch")

# Only X.Y.Z tags participate in version arithmetic. Anything else (a release
# candidate, a typo, a tag from another language's packages) is ignored when
# working out the latest release, so a stray tag cannot derail a release.
_VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")

# Matches the comparator clauses of a PEP 508 version specifier, for example the
# ">=0.1.1" and "<0.2.0" in "a2ui-core>=0.1.1,<0.2.0".
_CLAUSE_RE = re.compile(r"(?P<op>[<>=!~]=?)\s*(?P<version>[0-9][^,\s]*)")

UNRELEASED_HEADING = "## Unreleased"


@dataclasses.dataclass(frozen=True)
class Package:
    """A releasable Python package in this repository."""

    pypi_name: str
    directory: str
    tag_prefix: str
    # Version to assume when no tag exists yet, used only for the first release
    # after the migration to tag-derived versions.
    bootstrap_version: str

    @property
    def changelog_path(self) -> str:
        return os.path.join(self.directory, "CHANGELOG.md")

    @property
    def pyproject_path(self) -> str:
        return os.path.join(self.directory, "pyproject.toml")

    def tag_for(self, version: str) -> str:
        return f"{self.tag_prefix}{version}"


CORE = Package(
    pypi_name="a2ui-core",
    directory="agent_sdks/python/a2ui_core",
    tag_prefix="python/a2ui-core/v",
    bootstrap_version="0.1.1",
)

AGENT = Package(
    pypi_name="a2ui-agent-sdk",
    directory="agent_sdks/python/a2ui_agent",
    tag_prefix="python/a2ui-agent-sdk/v",
    bootstrap_version="0.6.0",
)

PACKAGES = {p.pypi_name: p for p in (CORE, AGENT)}


def parse_version(version: str) -> tuple[int, int, int]:
    """Parses an X.Y.Z version into a comparable tuple."""
    match = _VERSION_RE.match(version)
    if not match:
        raise ValueError(f"not an X.Y.Z version: {version!r}")
    return (int(match[1]), int(match[2]), int(match[3]))


def format_version(parts: tuple[int, int, int]) -> str:
    return ".".join(str(p) for p in parts)


def bump_version(version: str, level: BumpLevel) -> str:
    """Applies a semver bump, resetting the less significant components."""
    if level not in VALID_BUMPS:
        raise ValueError(f"bump must be one of {VALID_BUMPS}, got {level!r}")
    major, minor, patch = parse_version(version)
    if level == "major":
        return format_version((major + 1, 0, 0))
    if level == "minor":
        return format_version((major, minor + 1, 0))
    return format_version((major, minor, patch + 1))


def _git(args: Sequence[str], repo_root: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def list_tags(package: Package, repo_root: str) -> list[str]:
    """Returns the tag names for a package, newest version first."""
    output = _git(["tag", "--list", f"{package.tag_prefix}*"], repo_root)
    valid_tags = []
    for line in output.splitlines():
        tag = line.strip()
        if not tag:
            continue
        candidate = tag[len(package.tag_prefix) :]
        if _VERSION_RE.match(candidate):
            valid_tags.append(tag)
    return sorted(
        valid_tags,
        key=lambda tag: parse_version(tag[len(package.tag_prefix) :]),
        reverse=True,
    )


def versions_from_tags(package: Package, tags: Iterable[str]) -> list[str]:
    """Extracts well-formed X.Y.Z versions from a package's tag names."""
    versions = []
    for tag in tags:
        if not tag.startswith(package.tag_prefix):
            continue
        candidate = tag[len(package.tag_prefix) :]
        if _VERSION_RE.match(candidate):
            versions.append(candidate)
    return versions


def current_version(package: Package, repo_root: str) -> str:
    """Returns the latest released version, or the bootstrap version.

    Falling back to the bootstrap version covers the first release after the
    migration, when a package may not have a tag yet.
    """
    output = _git(["tag", "--list", f"{package.tag_prefix}*"], repo_root)
    versions = versions_from_tags(package, output.splitlines())
    if not versions:
        return package.bootstrap_version
    return format_version(max(parse_version(v) for v in versions))


def read_unreleased(changelog: str) -> str:
    """Returns the body of the `## Unreleased` section, stripped.

    Raises ValueError if the section is missing, so a malformed changelog stops
    the release rather than producing empty release notes.
    """
    lines = changelog.splitlines()
    try:
        start = next(
            i for i, line in enumerate(lines) if line.strip() == UNRELEASED_HEADING
        )
    except StopIteration:
        raise ValueError(f"changelog has no {UNRELEASED_HEADING!r} heading") from None

    body: list[str] = []
    for line in lines[start + 1 :]:
        if line.startswith("## "):
            break
        body.append(line)
    return "\n".join(body).strip()


def cut_changelog(changelog: str, version: str, today: datetime.date) -> str:
    """Moves the `## Unreleased` body under a new version heading.

    An empty `## Unreleased` section is left in place at the top so the next
    change has somewhere to go.
    """
    body = read_unreleased(changelog)
    if not body:
        raise ValueError(
            f"{UNRELEASED_HEADING} section is empty, there is nothing to release"
        )

    lines = changelog.splitlines()
    start = next(
        i for i, line in enumerate(lines) if line.strip() == UNRELEASED_HEADING
    )
    end = len(lines)
    for i, line in enumerate(lines[start + 1 :], start=start + 1):
        if line.startswith("## "):
            end = i
            break

    replacement = [
        UNRELEASED_HEADING,
        "",
        f"## {version} ({today.isoformat()})",
        "",
        body,
        "",
    ]
    return "\n".join([*lines[:start], *replacement, *lines[end:]]).rstrip() + "\n"


def core_specifier(agent_pyproject: str) -> str:
    """Returns a2ui-agent-sdk's version specifier for a2ui-core.

    For example "a2ui-core>=0.1.1,<0.2.0" yields ">=0.1.1,<0.2.0".
    """
    data = tomllib.loads(agent_pyproject)
    for dependency in data["project"]["dependencies"]:
        match = re.match(r"^\s*([A-Za-z0-9._-]+)\s*(.*)$", dependency)
        if not match:
            continue
        name = match[1].lower().replace("_", "-")
        if name == CORE.pypi_name:
            return match[2].strip()
    raise ValueError(f"{AGENT.pypi_name} does not depend on {CORE.pypi_name}")


def satisfies(version: str, specifier: str) -> bool:
    """Reports whether an X.Y.Z version satisfies a simple PEP 508 specifier.

    Only the comparison operators used by this repository's pins are supported.
    An unrecognised operator raises rather than silently passing.
    """
    target = parse_version(version)
    clauses = _CLAUSE_RE.findall(specifier)
    if not clauses:
        raise ValueError(f"could not parse version specifier: {specifier!r}")

    for op, bound_text in clauses:
        bound = parse_version(bound_text)
        if op == ">=" and not target >= bound:
            return False
        if op == ">" and not target > bound:
            return False
        if op == "<=" and not target <= bound:
            return False
        if op == "<" and not target < bound:
            return False
        if op == "==" and target != bound:
            return False
        if op == "!=" and target == bound:
            return False
        if op not in (">=", ">", "<=", "<", "==", "!="):
            raise ValueError(f"unsupported operator {op!r} in {specifier!r}")
    return True


def check_core_constraint(
    proposed_core_version: str, agent_pyproject: str
) -> str | None:
    """Returns an error message if releasing this a2ui-core version is unsafe.

    a2ui-agent-sdk pins a2ui-core to a range. Publishing a core version outside
    that range would leave the latest agent-sdk unable to resolve against the
    latest core, so the release is stopped instead.
    """
    specifier = core_specifier(agent_pyproject)
    if satisfies(proposed_core_version, specifier):
        return None
    return (
        f"{CORE.pypi_name} {proposed_core_version} falls outside the "
        f"{CORE.pypi_name}{specifier} range that {AGENT.pypi_name} declares in "
        f"{AGENT.pyproject_path}. Widen that pin in the same release, or choose "
        "a different bump level."
    )


def build_plan(selection: str, bump: BumpLevel, repo_root: str) -> list[dict[str, str]]:
    """Returns the packages to release, with their new versions and notes.

    a2ui-core is always ordered before a2ui-agent-sdk. When both are released
    together the agent-sdk depends on the core version going out in the same
    run, so the core artifact has to be staged and published first.
    """
    if selection == "both":
        selected = [CORE, AGENT]
    else:
        selected = [PACKAGES[selection]]

    plan = []
    for package in selected:
        version = bump_version(current_version(package, repo_root), bump)
        changelog = os.path.join(repo_root, package.changelog_path)
        with open(changelog, encoding="utf-8") as handle:
            notes = read_unreleased(handle.read())
        plan.append({
            "pypi_name": package.pypi_name,
            "directory": package.directory,
            "version": version,
            "tag": package.tag_for(version),
            "notes": notes,
        })
    return plan


def _repo_root() -> str:
    return _git(["rev-parse", "--show-toplevel"], os.getcwd()).strip()


def _emit(name: str, value: str) -> None:
    """Prints a value, and appends it to GITHUB_OUTPUT when running in CI."""
    print(value)
    output_file = os.environ.get("GITHUB_OUTPUT")
    if output_file:
        with open(output_file, "a", encoding="utf-8") as handle:
            handle.write(f"{name}={value}\n")


def main(argv: Sequence[str] | None = None) -> int:
    # --repo-root is attached to both the top level and every subcommand, so it
    # works on either side of the subcommand name. SUPPRESS keeps the
    # subcommand's copy from overwriting a value given before it.
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--repo-root", default=argparse.SUPPRESS)

    parser = argparse.ArgumentParser(description=__doc__, parents=[common])
    subparsers = parser.add_subparsers(dest="command", required=True)

    current = subparsers.add_parser(
        "current", help="Print the latest released version", parents=[common]
    )
    current.add_argument("--package", required=True, choices=sorted(PACKAGES))

    nxt = subparsers.add_parser(
        "next", help="Print the next version for a bump level", parents=[common]
    )
    nxt.add_argument("--package", required=True, choices=sorted(PACKAGES))
    nxt.add_argument("--bump", required=True, choices=VALID_BUMPS)

    tag = subparsers.add_parser(
        "tag", help="Print the tag name for a version", parents=[common]
    )
    tag.add_argument("--package", required=True, choices=sorted(PACKAGES))
    tag.add_argument("--version", required=True)

    notes = subparsers.add_parser(
        "notes", help="Print the Unreleased changelog body", parents=[common]
    )
    notes.add_argument("--package", required=True, choices=sorted(PACKAGES))

    cut = subparsers.add_parser(
        "cut-changelog", help="Move Unreleased under a version", parents=[common]
    )
    cut.add_argument("--package", required=True, choices=sorted(PACKAGES))
    cut.add_argument("--version", required=True)
    cut.add_argument("--write", action="store_true")

    check = subparsers.add_parser(
        "check", help="Run release preflight checks", parents=[common]
    )
    check.add_argument("--package", required=True, choices=sorted(PACKAGES))
    check.add_argument("--version", required=True)

    plan = subparsers.add_parser(
        "plan", help="Emit the release plan as JSON", parents=[common]
    )
    plan.add_argument("--package", required=True, choices=[*sorted(PACKAGES), "both"])
    plan.add_argument("--bump", required=True, choices=VALID_BUMPS)
    plan.add_argument("--output", default=None)

    args = parser.parse_args(argv)
    repo_root = getattr(args, "repo_root", None) or _repo_root()

    if args.command == "plan":
        entries = build_plan(args.package, args.bump, repo_root)
        rendered = json.dumps(entries, indent=2)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as handle:
                handle.write(rendered + "\n")
        print(rendered)
        return 0

    package = PACKAGES[args.package]

    if args.command == "current":
        _emit("current_version", current_version(package, repo_root))
        return 0

    if args.command == "next":
        version = bump_version(current_version(package, repo_root), args.bump)
        _emit("next_version", version)
        _emit("next_tag", package.tag_for(version))
        return 0

    if args.command == "tag":
        _emit("tag", package.tag_for(args.version))
        return 0

    changelog_path = os.path.join(repo_root, package.changelog_path)

    if args.command == "notes":
        # A missing heading is a malformed changelog, which is a different
        # answer from "nothing to release" and has to be distinguishable from
        # it. Callers read empty stdout as the latter, so this reports on
        # stderr and exits non-zero rather than raising.
        with open(changelog_path, encoding="utf-8") as handle:
            try:
                print(read_unreleased(handle.read()))
            except ValueError as error:
                print(f"error: {package.changelog_path}: {error}", file=sys.stderr)
                return 1
        return 0

    if args.command == "cut-changelog":
        with open(changelog_path, encoding="utf-8") as handle:
            original = handle.read()
        updated = cut_changelog(original, args.version, datetime.date.today())
        if args.write:
            with open(changelog_path, "w", encoding="utf-8") as handle:
                handle.write(updated)
            print(f"Updated {package.changelog_path} for {args.version}")
        else:
            print(updated)
        return 0

    if args.command == "check":
        problems = []

        with open(changelog_path, encoding="utf-8") as handle:
            try:
                if not read_unreleased(handle.read()):
                    problems.append(
                        f"{package.changelog_path} has an empty "
                        f"{UNRELEASED_HEADING} section, there is nothing to release."
                    )
            except ValueError as error:
                problems.append(str(error))

        existing = versions_from_tags(package, list_tags(package, repo_root))
        if args.version in existing:
            problems.append(
                f"{package.tag_for(args.version)} already exists. Releasing it "
                "again would be rejected by PyPI."
            )

        if package is CORE:
            agent_pyproject = os.path.join(repo_root, AGENT.pyproject_path)
            with open(agent_pyproject, encoding="utf-8") as handle:
                error = check_core_constraint(args.version, handle.read())
            if error:
                problems.append(error)

        if problems:
            for problem in problems:
                print(f"error: {problem}", file=sys.stderr)
            return 1

        print(f"Preflight checks passed for {package.pypi_name} {args.version}")
        return 0

    raise AssertionError(f"unhandled command {args.command!r}")


if __name__ == "__main__":
    sys.exit(main())
