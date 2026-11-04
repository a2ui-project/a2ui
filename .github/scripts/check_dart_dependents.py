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

"""Checks that a Dart release leaves no package on pub.dev behind.

CI resolves the Dart packages from source through the pub workspace, so it
passes while the versions on pub.dev cannot be used together. This script runs
on a pull request that changes `version:` in `dart/a2ui_core/pubspec.yaml`, from
the repository root.

Every other package directly under `dart/` that constrains `a2ui_core` and is
on pub.dev must either be released by the same pull request, or have a latest
version on pub.dev whose `a2ui_core` constraint accepts the new `a2ui_core`.
The pull request releases a package when it changes the package's `version:`
or the top heading of its CHANGELOG.md, leaves the two equal, and the version
would become the latest on pub.dev.

Runs on the standard library only.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable, Sequence

CORE = "a2ui_core"
PUB_API_URL = "https://pub.dev/api/packages/{name}"

_VERSION_RE = re.compile(
    r"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$"
)


@dataclass(frozen=True)
class Version:
    """A semantic version, compared by semver precedence."""

    major: int
    minor: int
    patch: int
    prerelease: tuple[str, ...] = ()

    @staticmethod
    def parse(text: str) -> "Version":
        match = _VERSION_RE.match(text.strip())
        if not match:
            raise ValueError(f"not a version: {text!r}")
        pre = match.group(4)
        return Version(
            int(match.group(1)),
            int(match.group(2)),
            int(match.group(3)),
            tuple(pre.split(".")) if pre else (),
        )

    def _key(self) -> tuple[int, int, int, bool, tuple[tuple[int, int, str], ...]]:
        # A release sorts after its prereleases. Numeric identifiers sort
        # before alphanumeric ones and compare as numbers.
        pre_key = tuple(
            (0, int(part), "") if part.isdigit() else (1, 0, part)
            for part in self.prerelease
        )
        return (self.major, self.minor, self.patch, not self.prerelease, pre_key)

    def __lt__(self, other: "Version") -> bool:
        return self._key() < other._key()

    def __le__(self, other: "Version") -> bool:
        return self._key() <= other._key()

    def __str__(self) -> str:
        text = f"{self.major}.{self.minor}.{self.patch}"
        return f"{text}-{'.'.join(self.prerelease)}" if self.prerelease else text


def allows(constraint: str, version: Version) -> bool:
    """Reports whether a pub version constraint accepts a version.

    Supports `any`, an exact version, `^x.y.z`, and ranges built from `>=`,
    `>`, `<=` and `<`. As in pub, `^0.y.z` stops below the next minor version
    even when y is 0, and `<x.y.z` also excludes the prereleases of x.y.z
    unless the bound is itself a prerelease or the lower bound is a prerelease
    of x.y.z.
    """
    constraint = constraint.strip().strip("'\"")
    if constraint == "any":
        return True
    if constraint.startswith("^"):
        start = Version.parse(constraint[1:])
        if start.major > 0:
            end = Version(start.major + 1, 0, 0)
        else:
            end = Version(0, start.minor + 1, 0)
        return _in_range(version, start, True, end, False)
    if re.match(r"^\d", constraint):
        return Version.parse(constraint) == version

    if not re.fullmatch(r"(?:\s*(?:>=|<=|>|<)\s*[^\s<>=]+)+\s*", constraint):
        raise ValueError(f"unsupported constraint: {constraint!r}")
    low: Version | None = None
    high: Version | None = None
    include_low = include_high = False
    for op, text in re.findall(r"(>=|<=|>|<)\s*([^\s<>=]+)", constraint):
        bound = Version.parse(text)
        if op.startswith(">"):
            low, include_low = bound, op == ">="
        else:
            high, include_high = bound, op == "<="
    return _in_range(version, low, include_low, high, include_high)


def _same_release(a: Version, b: Version) -> bool:
    return (a.major, a.minor, a.patch) == (b.major, b.minor, b.patch)


def _in_range(
    version: Version,
    low: Version | None,
    include_low: bool,
    high: Version | None,
    include_high: bool,
) -> bool:
    if low is not None and (version < low or (version == low and not include_low)):
        return False
    if high is not None:
        if high < version or (version == high and not include_high):
            return False
        if (
            not include_high
            and not high.prerelease
            and version.prerelease
            and _same_release(version, high)
            and not (low is not None and low.prerelease and _same_release(low, high))
        ):
            return False
    return True


def _top_level_value(pubspec: str, key: str) -> str | None:
    match = re.search(rf"^{key}:[ \t]*['\"]?([^\s'\"#]+)", pubspec, re.MULTILINE)
    return match.group(1) if match else None


def pubspec_version(pubspec: str) -> str | None:
    """Returns the top-level `version:` of a pubspec, if it has one."""
    return _top_level_value(pubspec, "version")


def pubspec_name(pubspec: str) -> str | None:
    """Returns the top-level `name:` of a pubspec."""
    return _top_level_value(pubspec, "name")


def pubspec_publish_to(pubspec: str) -> str | None:
    """Returns the top-level `publish_to:` of a pubspec, if it has one."""
    return _top_level_value(pubspec, "publish_to")


def core_constraint(pubspec: str) -> str | None:
    """Returns the version constraint a pubspec puts on `a2ui_core`.

    Only `dependencies:` is read. Returns None when the pubspec does not
    depend on `a2ui_core` there, or depends on it by path. Raises ValueError
    for an entry it cannot read, so that the package is not skipped silently.
    """
    lines = pubspec.splitlines()
    in_dependencies = False
    for index, line in enumerate(lines):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line[0].isspace():
            in_dependencies = re.match(r"^dependencies:\s*(?:#.*)?$", line) is not None
            continue
        if not in_dependencies:
            continue
        match = re.match(rf"^(\s+){CORE}:\s*(.*?)\s*(?:#.*)?$", line)
        if not match:
            continue
        if match.group(2):
            return match.group(2).strip("'\"")
        indent = len(match.group(1))
        fields = {}
        for nested in lines[index + 1 :]:
            if not nested.strip() or nested.lstrip().startswith("#"):
                continue
            if len(nested) - len(nested.lstrip()) <= indent:
                break
            field = re.match(
                r"^\s+(\w+):\s*['\"]?([^'\"#]*?)['\"]?\s*(?:#.*)?$", nested
            )
            if field:
                fields[field.group(1)] = field.group(2)
        if "path" in fields:
            return None
        if fields.get("version"):
            return fields["version"]
        raise ValueError(f"cannot read the {CORE} dependency: {fields or line.strip()}")
    return None


def changelog_top_heading(changelog: str) -> str | None:
    """Returns the first `## ` heading of a CHANGELOG, such as `Unreleased`."""
    match = re.search(r"^## +(.+?)\s*$", changelog, re.MULTILINE)
    return match.group(1) if match else None


@dataclass(frozen=True)
class Package:
    """A package that constrains `a2ui_core`, at the base and as the pull
    request leaves it."""

    name: str
    core_constraint: str
    version: str | None
    changelog_top_heading: str | None
    base_version: str | None = None
    base_changelog_top_heading: str | None = None
    publish_to: str | None = None


@dataclass(frozen=True)
class Published:
    """What pub.dev has of a package. `latest` is the version pub.dev lists as
    latest, the newest stable version when there is one."""

    versions: frozenset[str]
    latest: str
    latest_core_constraint: str | None


PubLookup = Callable[[str], "Published | None"]


def fetch_published(name: str, timeout: float = 30.0) -> Published | None:
    """Reads a package from pub.dev, or returns None if it is not there."""
    request = urllib.request.Request(
        PUB_API_URL.format(name=name),
        headers={"Accept": "application/vnd.pub.v2+json", "User-Agent": "a2ui-ci"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise
    latest = data["latest"]
    dependencies = latest.get("pubspec", {}).get("dependencies", {}) or {}
    constraint = dependencies.get(CORE)
    return Published(
        versions=frozenset(entry["version"] for entry in data.get("versions", [])),
        latest=latest["version"],
        latest_core_constraint=constraint if isinstance(constraint, str) else None,
    )


def release_problem(package: Package, published: Published) -> str | None:
    """Returns why the pull request does not release a package, or None if it
    does."""
    version, heading = package.version, package.changelog_top_heading
    if package.publish_to == "none":
        return "its pubspec.yaml has publish_to: none"
    if version is None:
        return "its pubspec.yaml has no version"
    if (version, heading) == (package.base_version, package.base_changelog_top_heading):
        return (
            f"this pull request changes neither its version ({version}) nor the"
            " top heading of its CHANGELOG.md"
        )
    if version in published.versions:
        return f"its version {version} is already on pub.dev"
    new, latest = Version.parse(version), Version.parse(published.latest)
    if new < latest or (new.prerelease and not latest.prerelease):
        return (
            f"its version {version} would not become the latest on pub.dev,"
            f" which is {published.latest}"
        )
    if heading != version:
        return f"the top heading of its CHANGELOG.md is {heading!r}, not {version!r}"
    return None


def check(
    new_core: Version, packages: Sequence[Package], lookup: PubLookup
) -> list[str]:
    """Returns one error per package that the release would leave behind."""
    errors = []
    for package in packages:
        published = lookup(package.name)
        if published is None:
            print(f"{package.name}: not on pub.dev, skipped")
            continue
        problem = release_problem(package, published)
        if problem is None:
            if allows(package.core_constraint, new_core):
                print(f"{package.name}: released as {package.version}")
            else:
                errors.append(
                    f"{package.name} {package.version} is released here, but its"
                    f" pubspec.yaml constrains {CORE} to {package.core_constraint},"
                    f" which excludes {new_core}."
                )
            continue
        latest, constraint = published.latest, published.latest_core_constraint
        if constraint is None:
            print(f"{package.name} {latest} on pub.dev: no {CORE} constraint, skipped")
            continue
        if allows(constraint, new_core):
            print(f"{package.name} {latest} on pub.dev accepts {CORE} {new_core}")
            continue
        errors.append(
            f"{package.name} {latest}, the latest version on pub.dev, requires"
            f" {CORE} {constraint}, which excludes {new_core}, and this pull"
            f" request does not release {package.name}: {problem}. Release"
            f" {package.name} in this pull request, as"
            " docs/contributing/release/release.md describes."
        )
    return errors


def _git_show(ref: str, path: pathlib.Path) -> str | None:
    result = subprocess.run(
        ["git", "show", f"{ref}:./{path.as_posix()}"], capture_output=True, text=True
    )
    return result.stdout if result.returncode == 0 else None


def _read(path: pathlib.Path) -> str:
    return path.read_text() if path.exists() else ""


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--base", required=True, help="git ref of the pull request's base"
    )
    parser.add_argument(
        "--dart-dir", default="dart", help="directory of the Dart packages"
    )
    args = parser.parse_args(argv)

    verify = subprocess.run(
        ["git", "rev-parse", "--verify", "--quiet", f"{args.base}^{{commit}}"],
        capture_output=True,
    )
    if verify.returncode != 0:
        print(f"error: base ref {args.base} not found", file=sys.stderr)
        return 1

    dart_dir = pathlib.Path(args.dart_dir)
    core_path = dart_dir / CORE / "pubspec.yaml"
    base_core = pubspec_version(_git_show(args.base, core_path) or "")
    head_core = pubspec_version(_read(core_path))
    if head_core is None:
        print(f"error: no version in {core_path}", file=sys.stderr)
        return 1
    if base_core == head_core:
        print(f"{CORE} stays at {head_core}, so this is not an {CORE} release.")
        return 0

    try:
        new_core = Version.parse(head_core)
        print(f"{CORE} {base_core} -> {new_core}")
        packages = []
        for pubspec_path in sorted(dart_dir.glob("*/pubspec.yaml")):
            if pubspec_path == core_path:
                continue
            pubspec = pubspec_path.read_text()
            constraint = core_constraint(pubspec)
            if constraint is None:
                continue
            changelog_path = pubspec_path.parent / "CHANGELOG.md"
            packages.append(
                Package(
                    name=pubspec_name(pubspec) or pubspec_path.parent.name,
                    core_constraint=constraint,
                    version=pubspec_version(pubspec),
                    changelog_top_heading=changelog_top_heading(_read(changelog_path)),
                    base_version=pubspec_version(
                        _git_show(args.base, pubspec_path) or ""
                    ),
                    base_changelog_top_heading=changelog_top_heading(
                        _git_show(args.base, changelog_path) or ""
                    ),
                    publish_to=pubspec_publish_to(pubspec),
                )
            )
        errors = check(new_core, packages, fetch_published)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    except (urllib.error.URLError, TimeoutError) as error:
        print(f"error: cannot read pub.dev: {error}", file=sys.stderr)
        return 1
    for message in errors:
        print(f"error: {message}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
