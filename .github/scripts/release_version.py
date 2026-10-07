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
import shutil
import subprocess
import sys

if sys.version_info < (3, 11):
    sys.exit(
        "error: release_version.py requires Python 3.11+ for tomllib (found Python"
        f" {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro})."
        " Action needed: run it with a Python 3.11+ interpreter, for example"
        " 'uv run python .github/scripts/release_version.py ...'."
    )

import tomllib
from typing import Callable, Iterable, Sequence

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
    directory="python/a2ui_core",
    tag_prefix="python/a2ui-core/v",
    bootstrap_version="0.1.1",
)

AGENT = Package(
    pypi_name="a2ui-agent-sdk",
    directory="python/a2ui_agent",
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
        f"{CORE.pypi_name} {proposed_core_version} falls outside the"
        f" {CORE.pypi_name}{specifier} range that {AGENT.pypi_name} declares in"
        f" {AGENT.pyproject_path}. Action needed: update the pin in"
        f" {AGENT.pyproject_path} (e.g. to"
        f" '{CORE.pypi_name}>={proposed_core_version},<...') and merge a PR to main"
        " before dispatching the release."
    )


CANONICAL_REPO = "a2ui-project/a2ui"
RELEASE_BRANCH = "main"
RELEASE_PATHS = ("python/a2ui_core", "python/a2ui_agent")

# Matches the owner/repo at the end of a remote URL in any of its usual forms:
# git@github.com:a2ui-project/a2ui.git, https://github.com/a2ui-project/a2ui,
# or a local path ending in a2ui-project/a2ui.git.
_CANONICAL_REMOTE_RE = re.compile(
    r"[:/]" + re.escape(CANONICAL_REPO) + r"(?:\.git)?/?$", re.IGNORECASE
)

Runner = Callable[..., "subprocess.CompletedProcess[str]"]


class NotInRepositoryError(Exception):
    """Raised when the script is not run from inside an a2ui checkout."""


@dataclasses.dataclass
class EnvironmentReport:
    """Outcome of the local environment checks.

    `errors` block the release, `warnings` are printed but do not, and `fatal`
    means the checkout is not an a2ui repository at all, so the package checks
    that read its files must not run.
    """

    errors: list[str] = dataclasses.field(default_factory=list)
    warnings: list[str] = dataclasses.field(default_factory=list)
    fatal: bool = False
    remote: str | None = None


def _run(
    run: Runner, args: Sequence[str], cwd: str
) -> "subprocess.CompletedProcess[str]":
    return run(list(args), cwd=cwd, capture_output=True, text=True)


def find_canonical_remote(repo_root: str, run: Runner = subprocess.run) -> str | None:
    """Returns the name of the remote that points at a2ui-project/a2ui.

    Contributors name it differently (`origin` in a direct clone, `upstream`
    beside a fork), so it is found by URL rather than by name.
    """
    proc = _run(run, ["git", "remote", "-v"], repo_root)
    if proc.returncode != 0:
        return None
    for line in proc.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 2 and _CANONICAL_REMOTE_RE.search(parts[1]):
            return parts[0]
    return None


def check_environment(
    repo_root: str,
    *,
    cwd: str | None = None,
    run: Runner = subprocess.run,
    which: Callable[[str], str | None] = shutil.which,
) -> EnvironmentReport:
    """Validates the local prerequisites for dispatching a release.

    The release itself runs in GitHub Actions against the canonical `main`, so
    these checks make sure the local preview describes that same tree and that
    the tools the release steps need are ready.
    """
    report = EnvironmentReport()

    # 1. The checkout must be an a2ui repository. Every later check, and the
    #    package checks that read changelogs and pyproject files, rely on it.
    missing = [
        pkg.pyproject_path
        for pkg in (CORE, AGENT)
        if not os.path.isfile(os.path.join(repo_root, pkg.pyproject_path))
    ]
    if missing:
        report.errors.append(
            f"{repo_root} is not an a2ui checkout (missing {', '.join(missing)})."
            f" Action needed: cd into your clone of {CANONICAL_REPO} and run the"
            " command again."
        )
        report.fatal = True
        return report

    # 2. The script resolves the repository root itself, so running it from a
    #    subdirectory works. It is only worth a note, because the commands in
    #    the release skill use paths relative to the root.
    if cwd is not None and os.path.realpath(cwd) != os.path.realpath(repo_root):
        report.warnings.append(
            f"running from {cwd}, not the repository root {repo_root}. The checks"
            " use the repository root, but the release skill's commands expect to"
            f" run from it: cd {repo_root}"
        )

    # 3. Git identity, which the workflow uses to author the changelog commit.
    for key, placeholder in (
        ("user.name", "Your Name"),
        ("user.email", "you@example.com"),
    ):
        proc = _run(run, ["git", "config", key], repo_root)
        if proc.returncode != 0 or not proc.stdout.strip():
            report.errors.append(
                f"git config {key} is unset. Action needed: run"
                f" 'git config {key} \"{placeholder}\"' so the changelog commit and"
                " pull request pass CLA verification."
            )

    # 4. GitHub CLI, which dispatches and watches the workflow and opens the
    #    changelog pull request.
    if not which("gh"):
        report.errors.append(
            "'gh' (GitHub CLI) is not installed or not on PATH. Action needed:"
            " install it from https://cli.github.com and run 'gh auth login'."
        )
    else:
        auth = _run(
            run, ["gh", "auth", "status", "--hostname", "github.com"], repo_root
        )
        if auth.returncode != 0:
            report.errors.append(
                "'gh' is not authenticated with github.com. Action needed: run"
                " 'gh auth login --hostname github.com'."
            )
        else:
            perm = _run(
                run,
                ["gh", "api", f"repos/{CANONICAL_REPO}", "--jq", ".permissions.push"],
                repo_root,
            )
            if perm.returncode != 0:
                report.warnings.append(
                    f"could not read your permissions on {CANONICAL_REPO} with 'gh"
                    " api'. Dispatching the workflow needs write access."
                )
            elif perm.stdout.strip() != "true":
                report.errors.append(
                    f"your GitHub account has no write access to {CANONICAL_REPO}."
                    " Action needed: ask a maintainer to dispatch the release, or"
                    " to grant you access."
                )

    # 5. Uncommitted edits to tracked files in the released packages. Untracked
    #    files (local virtualenvs, scratch files) do not affect the release.
    status = _run(
        run,
        ["git", "status", "--porcelain", "--untracked-files=no", "--", *RELEASE_PATHS],
        repo_root,
    )
    if status.returncode == 0 and status.stdout.strip():
        report.errors.append(
            f"uncommitted changes in {' or '.join(RELEASE_PATHS)}. Action needed:"
            " commit or stash them ('git stash'). The workflow releases the"
            f" canonical {RELEASE_BRANCH}, not your working tree."
        )

    # 6. The remote that points at the canonical repository.
    remote = find_canonical_remote(repo_root, run)
    report.remote = remote
    if remote is None:
        report.errors.append(
            f"no git remote points at {CANONICAL_REPO}. Action needed: run 'git"
            f" remote add upstream https://github.com/{CANONICAL_REPO}.git'."
        )
        return report

    # 7. Refresh the remote branch and tags, so the comparison below and the
    #    tag-derived versions are current rather than as old as the last fetch.
    fetch = _run(
        run, ["git", "fetch", "--quiet", "--tags", remote, RELEASE_BRANCH], repo_root
    )
    if fetch.returncode != 0:
        report.errors.append(
            f"could not fetch {remote}/{RELEASE_BRANCH}: {fetch.stderr.strip()}."
            " Action needed: check your network and access to the remote, then"
            " run the command again."
        )
        return report

    # 8. The released packages must match the canonical main exactly. The
    #    workflow builds from there, so a local commit that is not merged yet
    #    (say, a widened dependency pin) would pass here and fail there.
    diff = _run(
        run,
        ["git", "diff", "--quiet", f"{remote}/{RELEASE_BRANCH}", "--", *RELEASE_PATHS],
        repo_root,
    )
    if diff.returncode == 1:
        report.errors.append(
            f"{' and '.join(RELEASE_PATHS)} differ from {remote}/{RELEASE_BRANCH},"
            " which is what the workflow releases. Action needed: merge any"
            f" pending changes to {RELEASE_BRANCH} through a pull request, then run"
            f" 'git checkout {RELEASE_BRANCH} && git pull {remote} {RELEASE_BRANCH}'."
        )
    elif diff.returncode != 0:
        report.errors.append(
            f"could not compare against {remote}/{RELEASE_BRANCH}:"
            f" {diff.stderr.strip()}. Action needed: run 'git fetch {remote}"
            f" {RELEASE_BRANCH} --tags'."
        )

    # 9. A changelog branch left by the previous release means its entries are
    #    still under `## Unreleased` and would be released twice.
    heads = _run(
        run, ["git", "ls-remote", "--heads", remote, "release/changelog-*"], repo_root
    )
    if heads.returncode != 0:
        report.errors.append(
            f"could not list release/changelog-* branches on {remote}:"
            f" {heads.stderr.strip()}. Action needed: check your network and"
            " access to the remote, then run the command again."
        )
    elif heads.stdout.strip():
        branches = [
            line.split()[-1].removeprefix("refs/heads/")
            for line in heads.stdout.splitlines()
            if line.strip()
        ]
        report.errors.append(
            f"changelog branch(es) from a previous release are still on {remote}:"
            f" {', '.join(branches)}. Action needed: open, review and merge that"
            " changelog pull request before starting a new release."
        )

    return report


def target_versions(
    selection: str, bump: BumpLevel, repo_root: str
) -> list[tuple[Package, str]]:
    """Returns each selected package with the version a bump would release.

    a2ui-core is always ordered before a2ui-agent-sdk. When both are released
    together the agent-sdk depends on the core version going out in the same
    run, so the core artifact has to be staged and published first.
    """
    selected = [CORE, AGENT] if selection == "both" else [PACKAGES[selection]]
    return [
        (package, bump_version(current_version(package, repo_root), bump))
        for package in selected
    ]


def build_plan(selection: str, bump: BumpLevel, repo_root: str) -> list[dict[str, str]]:
    """Returns the packages to release, with their new versions and notes."""
    plan = []
    for package, version in target_versions(selection, bump, repo_root):
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
    try:
        return _git(["rev-parse", "--show-toplevel"], os.getcwd()).strip()
    except (subprocess.CalledProcessError, FileNotFoundError) as error:
        raise NotInRepositoryError(
            f"{os.getcwd()} is not inside a git checkout. Action needed: cd into"
            f" your clone of {CANONICAL_REPO} and run the command again."
        ) from error


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
    check.add_argument("--package", required=True, choices=[*sorted(PACKAGES), "both"])
    check.add_argument("--version", default=None, help="Explicit version to check")
    check.add_argument(
        "--bump",
        default=None,
        choices=VALID_BUMPS,
        help="Bump level to compute version from tags",
    )
    check.add_argument(
        "--skip-env-checks",
        action="store_true",
        help=(
            "Skip the local environment checks (a2ui checkout, git identity, gh"
            " auth and write access, sync with the canonical main, pending"
            " changelog branches). They are always skipped in GitHub Actions."
        ),
    )

    plan = subparsers.add_parser(
        "plan", help="Emit the release plan as JSON", parents=[common]
    )
    plan.add_argument("--package", required=True, choices=[*sorted(PACKAGES), "both"])
    plan.add_argument("--bump", required=True, choices=VALID_BUMPS)
    plan.add_argument("--output", default=None)

    args = parser.parse_args(argv)
    custom_root = getattr(args, "repo_root", None)
    try:
        repo_root = custom_root or _repo_root()
    except NotInRepositoryError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    if args.command == "plan":
        entries = build_plan(args.package, args.bump, repo_root)
        rendered = json.dumps(entries, indent=2)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as handle:
                handle.write(rendered + "\n")
        print(rendered)
        return 0

    if args.command == "check":
        # Usage errors come first, so a typo is reported without waiting on
        # the network calls the environment checks make.
        if args.package == "both" and args.version:
            print(
                "error: --version cannot be used with --package both, because"
                " each package has its own version. Use --bump instead.",
                file=sys.stderr,
            )
            return 2
        if args.version and args.bump:
            print(
                "error: specify either --version or --bump, not both", file=sys.stderr
            )
            return 2
        if not args.version and not args.bump:
            print("error: either --version or --bump is required", file=sys.stderr)
            return 2

        all_problems = []

        if not os.environ.get("GITHUB_ACTIONS") and not args.skip_env_checks:
            # With an explicit --repo-root the caller chose the checkout, so
            # where they run from is irrelevant.
            report = check_environment(
                repo_root, cwd=None if custom_root else os.getcwd()
            )
            for warning in report.warnings:
                print(f"warning: {warning}", file=sys.stderr)
            for problem in report.errors:
                print(f"error: {problem}", file=sys.stderr)
            if report.fatal:
                return 1
            all_problems.extend(report.errors)

        if args.bump:
            packages_to_check = target_versions(args.package, args.bump, repo_root)
        else:
            packages_to_check = [(PACKAGES[args.package], args.version)]

        for pkg, ver in packages_to_check:
            problems = []
            if not ver:
                problems.append("version is empty or None")
            else:
                try:
                    parse_version(ver)
                except ValueError as error:
                    problems.append(f"invalid version {ver!r}: {error}")

            if not problems:
                changelog_path = os.path.join(repo_root, pkg.changelog_path)
                with open(changelog_path, encoding="utf-8") as handle:
                    try:
                        if not read_unreleased(handle.read()):
                            problems.append(
                                f"{pkg.changelog_path} has an empty"
                                f" {UNRELEASED_HEADING} section, there is nothing to"
                                " release."
                            )
                    except ValueError as error:
                        problems.append(f"{pkg.changelog_path}: {error}")

                existing = versions_from_tags(pkg, list_tags(pkg, repo_root))
                if ver in existing:
                    problems.append(
                        f"{pkg.tag_for(ver)} already exists. Releasing it "
                        "again would be rejected by PyPI."
                    )

                if pkg is CORE:
                    agent_pyproject = os.path.join(repo_root, AGENT.pyproject_path)
                    with open(agent_pyproject, encoding="utf-8") as handle:
                        error = check_core_constraint(ver, handle.read())
                    if error:
                        problems.append(error)

            if problems:
                for problem in problems:
                    print(f"error: {problem}", file=sys.stderr)
                all_problems.extend(problems)
            else:
                print(f"Preflight checks passed for {pkg.pypi_name} {ver}")

        return 1 if all_problems else 0

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

    raise AssertionError(f"unhandled command {args.command!r}")


if __name__ == "__main__":
    sys.exit(main())
