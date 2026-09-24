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

"""Verifies built distributions and writes the OSS Exit Gate manifest.

Two jobs, both of which guard against publishing the wrong thing:

`verify` reads the name and version back out of every built artifact and
compares them against the release plan. The package versions come from git
tags, and a release job that somehow ran without tags would quietly build a
fallback version instead, so the built artifacts are checked rather than
trusted.

`manifest` writes the publishing manifest that triggers the Exit Gate, naming
exactly the packages and versions that were built. The alternative,
`{"publish_all": true}`, would also publish anything stale left behind in the
Artifact Registry by an earlier failed run.

Runs on the standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tarfile
import zipfile
from typing import Sequence

_METADATA_FIELD_RE = re.compile(r"^(Name|Version):\s*(.+)$")


def normalize_name(name: str) -> str:
    """Applies PEP 503 name normalization, which is what PyPI records."""
    return re.sub(r"[-_.]+", "-", name).lower()


def _parse_metadata(text: str) -> tuple[str, str]:
    fields: dict[str, str] = {}
    for line in text.splitlines():
        # The metadata headers end at the first blank line; the long
        # description follows and can contain anything.
        if not line.strip():
            break
        match = _METADATA_FIELD_RE.match(line)
        if match:
            fields.setdefault(match[1], match[2].strip())
    if "Name" not in fields or "Version" not in fields:
        raise ValueError("distribution metadata is missing Name or Version")
    return normalize_name(fields["Name"]), fields["Version"]


def read_wheel_metadata(path: str) -> tuple[str, str]:
    """Returns the normalized name and version recorded in a wheel."""
    with zipfile.ZipFile(path) as archive:
        names = [n for n in archive.namelist() if n.endswith(".dist-info/METADATA")]
        if not names:
            raise ValueError(f"{path} contains no .dist-info/METADATA")
        return _parse_metadata(archive.read(names[0]).decode("utf-8"))


def read_sdist_metadata(path: str) -> tuple[str, str]:
    """Returns the normalized name and version recorded in an sdist."""
    with tarfile.open(path) as archive:
        names = [n for n in archive.getnames() if n.endswith("PKG-INFO")]
        if not names:
            raise ValueError(f"{path} contains no PKG-INFO")
        # The top-level PKG-INFO has the shortest path.
        member = archive.extractfile(min(names, key=len))
        if member is None:
            raise ValueError(f"could not read PKG-INFO from {path}")
        return _parse_metadata(member.read().decode("utf-8"))


def read_metadata(path: str) -> tuple[str, str]:
    if path.endswith(".whl"):
        return read_wheel_metadata(path)
    if path.endswith(".tar.gz"):
        return read_sdist_metadata(path)
    raise ValueError(f"unrecognised distribution: {path}")


def list_artifacts(dist_dir: str) -> list[str]:
    if not os.path.isdir(dist_dir):
        return []
    return sorted(
        os.path.join(dist_dir, name)
        for name in os.listdir(dist_dir)
        if name.endswith((".whl", ".tar.gz"))
    )


def verify(plan: list[dict[str, str]], repo_root: str) -> list[str]:
    """Returns a list of problems found in the built artifacts.

    Every planned package must have produced both a wheel and an sdist, and
    every artifact must carry exactly the planned name and version.
    """
    problems: list[str] = []

    for entry in plan:
        expected_name = normalize_name(entry["pypi_name"])
        expected_version = entry["version"]
        dist_dir = os.path.join(repo_root, entry["directory"], "dist")
        artifacts = list_artifacts(dist_dir)

        if not artifacts:
            problems.append(f"{expected_name}: no artifacts found in {dist_dir}")
            continue

        suffixes = {".whl" if a.endswith(".whl") else ".tar.gz" for a in artifacts}
        if ".whl" not in suffixes:
            problems.append(f"{expected_name}: no wheel was built")
        if ".tar.gz" not in suffixes:
            problems.append(f"{expected_name}: no sdist was built")

        for artifact in artifacts:
            try:
                name, version = read_metadata(artifact)
            except (ValueError, OSError, tarfile.TarError) as error:
                problems.append(f"{os.path.basename(artifact)}: {error}")
                continue
            if name != expected_name:
                problems.append(
                    f"{os.path.basename(artifact)}: expected package "
                    f"{expected_name}, found {name}"
                )
            if version != expected_version:
                problems.append(
                    f"{os.path.basename(artifact)}: expected version "
                    f"{expected_version}, found {version}. The build did not "
                    "pick up the release tag."
                )

    return problems


def build_manifest(plan: list[dict[str, str]]) -> dict:
    """Builds a selective OSS Exit Gate publishing manifest.

    The namespace field is omitted because PyPI is a flat registry.
    """
    packages = [
        {"name": normalize_name(entry["pypi_name"]), "version": entry["version"]}
        for entry in plan
    ]
    return {"publish_all": False, "publishing_groups": [{"packages": packages}]}


def _load_plan(path: str) -> list[dict[str, str]]:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--repo-root", default=".")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("verify", help="Check artifacts against the plan")

    manifest = subparsers.add_parser("manifest", help="Write the Exit Gate manifest")
    manifest.add_argument("--output", required=True)

    args = parser.parse_args(argv)
    plan = _load_plan(args.plan)

    if args.command == "verify":
        problems = verify(plan, args.repo_root)
        if problems:
            for problem in problems:
                print(f"error: {problem}", file=sys.stderr)
            return 1
        for entry in plan:
            print(f"verified {entry['pypi_name']} {entry['version']}")
        return 0

    if args.command == "manifest":
        rendered = json.dumps(build_manifest(plan), indent=2)
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write(rendered + "\n")
        print(rendered)
        return 0

    raise AssertionError(f"unhandled command {args.command!r}")


if __name__ == "__main__":
    sys.exit(main())
