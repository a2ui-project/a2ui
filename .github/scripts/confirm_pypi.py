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

"""Waits for released versions to appear on PyPI and links them from GitHub.

The OSS Exit Gate publishes asynchronously and exposes no status API, webhook
or queryable state; it only emails the project when a release finishes. PyPI
itself is therefore the thing to watch, and this polls it directly, which also
avoids needing any Google credentials.

On success the matching GitHub release is updated to replace the
publishing-in-progress note with a link to the published version.

Runs on the standard library only, apart from the `gh` CLI which is present on
GitHub-hosted runners.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from typing import Sequence

PYPI_JSON_URL = "https://pypi.org/pypi/{name}/{version}/json"
PYPI_PAGE_URL = "https://pypi.org/project/{name}/{version}/"

# Written into release notes while publishing is outstanding, and searched for
# by the scheduled backstop to find releases that still need confirming. The
# two must stay in step, so both read this constant.
PENDING_MARKER = "Publishing to PyPI has not completed yet"

# Matches the release tags created by release-pypi.yml, for example
# `python/a2ui-core/v0.1.2`, and ignores unrelated tags such as `v0.9`.
TAG_RE = re.compile(r"^python/(?P<name>[a-z0-9-]+?)/v(?P<version>\d+\.\d+\.\d+)$")


def is_published(name: str, version: str, timeout: float = 15.0) -> bool:
    """Reports whether an exact version is live on PyPI."""
    url = PYPI_JSON_URL.format(name=name, version=version)
    request = urllib.request.Request(url, headers={"User-Agent": "a2ui-release"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status == 200
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return False
        # Treat anything else (rate limiting, a 5xx) as "not yet", so a blip
        # does not fail a release that actually succeeded.
        print(f"  {name} {version}: HTTP {error.code}, will retry")
        return False
    except (urllib.error.URLError, TimeoutError) as error:
        print(f"  {name} {version}: {error}, will retry")
        return False


def wait_for_all(
    plan: Sequence[dict],
    timeout_seconds: float,
    poll_seconds: float,
    sleep=time.sleep,
    clock=time.monotonic,
    checker=is_published,
) -> dict[str, bool]:
    """Polls until every planned version is on PyPI or the timeout expires."""
    pending = {entry["pypi_name"]: entry["version"] for entry in plan}
    published: dict[str, bool] = {name: False for name in pending}
    deadline = clock() + timeout_seconds

    while True:
        for name, version in list(pending.items()):
            if checker(name, version):
                published[name] = True
                del pending[name]
                print(f"  {name} {version} is live on PyPI")
        if not pending:
            return published
        if clock() >= deadline:
            return published
        sleep(poll_seconds)


def release_notes(entry: dict, published: bool) -> str:
    """Builds the final GitHub release body."""
    name = entry["pypi_name"]
    version = entry["version"]
    parts = [entry.get("notes", "").strip(), "", "---", ""]
    if published:
        url = PYPI_PAGE_URL.format(name=name, version=version)
        parts.append(f"Published to PyPI: [{name} {version}]({url})")
        parts.append("")
        parts.append("```sh")
        parts.append(f"pip install {name}=={version}")
        parts.append("```")
    else:
        parts.append(
            f"{PENDING_MARKER}. The scheduled `release-verify-pypi` workflow "
            "will update this release once the version is live. Check the "
            "Exit Gate notification email if it stays this way."
        )
    return "\n".join(parts).strip() + "\n"


def _write_notes(body: str) -> str:
    with tempfile.NamedTemporaryFile(
        "w", suffix=".md", delete=False, encoding="utf-8"
    ) as handle:
        handle.write(body)
        return handle.name


def create_release(entry: dict, repo_root: str = ".") -> None:
    """Creates the GitHub release for a package, with the artifacts attached."""
    notes_path = _write_notes(release_notes(entry, published=False))
    dist = os.path.join(repo_root, entry["directory"], "dist")
    artifacts = sorted(
        os.path.join(dist, name)
        for name in os.listdir(dist)
        if name.endswith((".whl", ".tar.gz"))
    )
    subprocess.run(
        [
            "gh",
            "release",
            "create",
            entry["tag"],
            "--title",
            f"{entry['pypi_name']} {entry['version']}",
            "--notes-file",
            notes_path,
            *artifacts,
        ],
        check=True,
    )


def update_release(entry: dict, published: bool, run: bool = True) -> None:
    """Rewrites the GitHub release body for a package."""
    body = release_notes(entry, published)
    if not run:
        return
    notes_path = _write_notes(body)
    # Notes only. Which release carries the repository's "Latest" badge is left
    # alone: this repository publishes several independent packages, and
    # marking one here would hand the badge to whichever package PyPI happened
    # to publish last.
    subprocess.run(
        ["gh", "release", "edit", entry["tag"], "--notes-file", notes_path],
        check=True,
    )


def parse_tag(tag: str) -> tuple[str, str] | None:
    """Splits a release tag into its package name and version.

    Returns None for tags that are not Python SDK release tags, such as the
    `v0.9` protocol specification tags.
    """
    match = TAG_RE.match(tag)
    if not match:
        return None
    return match["name"], match["version"]


def discover_pending(limit: int = 200) -> list[dict]:
    """Finds GitHub releases still waiting on PyPI.

    Used by the scheduled backstop, which has no release plan to work from
    because it did not run the release.

    The listing is date-ordered across every package in the repository, not
    just the Python ones, so the limit has to leave room for releases in other
    languages to sit in front of a pending Python release.
    """
    result = subprocess.run(
        [
            "gh",
            "release",
            "list",
            "--exclude-drafts",
            "--limit",
            str(limit),
            "--json",
            "tagName,body",
        ],
        capture_output=True,
        text=True,
        check=True,
    )

    pending = []
    try:
        releases = json.loads(result.stdout)
    except json.JSONDecodeError:
        return pending

    for release in releases:
        tag = release.get("tagName", "")
        body = release.get("body", "")
        parsed = parse_tag(tag)
        if not parsed:
            continue
        name, version = parsed
        if PENDING_MARKER not in body:
            continue
        # Keep the original changelog entries, which sit above the separator.
        notes = body.split("\n---\n")[0].strip()
        pending.append({
            "pypi_name": name,
            "version": version,
            "tag": tag,
            "notes": notes,
        })
    return pending


def _load_plan(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _confirm(
    plan: Sequence[dict],
    timeout_seconds: float,
    poll_seconds: float,
) -> int:
    """Polls PyPI for a set of releases and rewrites their release notes."""
    if not plan:
        print("Nothing to confirm.")
        return 0

    print(f"Waiting up to {timeout_seconds:.0f}s for PyPI to catch up.")
    published = wait_for_all(plan, timeout_seconds, poll_seconds)

    missing = []
    for entry in plan:
        ok = published.get(entry["pypi_name"], False)
        update_release(entry, ok)
        if not ok:
            missing.append(f"{entry['pypi_name']} {entry['version']}")

    if missing:
        # Not an error. Publishing is asynchronous, and the scheduled backstop
        # will pick these up on its next run.
        print("Still waiting on: " + ", ".join(missing), file=sys.stderr)
        return 0

    print("All released versions are live on PyPI.")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create", help="Create GitHub releases for a plan")
    create.add_argument("--plan", required=True)
    create.add_argument("--repo-root", default=".")

    wait = subparsers.add_parser("wait", help="Poll PyPI for a plan")
    wait.add_argument("--plan", required=True)
    wait.add_argument("--timeout-seconds", type=float, default=1200.0)
    wait.add_argument("--poll-seconds", type=float, default=30.0)

    backfill = subparsers.add_parser(
        "backfill", help="Confirm any releases still marked as pending"
    )
    backfill.add_argument("--timeout-seconds", type=float, default=60.0)
    backfill.add_argument("--poll-seconds", type=float, default=30.0)
    backfill.add_argument("--limit", type=int, default=200)

    args = parser.parse_args(argv)

    if args.command == "create":
        for entry in _load_plan(args.plan):
            create_release(entry, args.repo_root)
            print(f"created release {entry['tag']}")
        return 0

    if args.command == "wait":
        return _confirm(_load_plan(args.plan), args.timeout_seconds, args.poll_seconds)

    if args.command == "backfill":
        pending = discover_pending(args.limit)
        if not pending:
            print("No releases are waiting on PyPI.")
            return 0
        print("Pending: " + ", ".join(e["tag"] for e in pending))
        return _confirm(pending, args.timeout_seconds, args.poll_seconds)

    raise AssertionError(f"unhandled command {args.command!r}")


if __name__ == "__main__":
    sys.exit(main())
