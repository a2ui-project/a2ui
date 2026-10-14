# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Test-only helpers that locate specification and catalog files in the repository.

These paths only exist in a repository checkout, so they live with the tests
rather than in the published package.
"""

from __future__ import annotations

import os

from a2ui.core.common.semver import normalize_version_string, parse_semver

_SPECIFICATION_DIR = "specification"


def find_repo_root(start_path: str | None = None) -> str | None:
    """Returns the repository root, the first ancestor with a `specification` directory.

    Args:
        start_path: The directory to search upwards from. Defaults to the
            directory of this file.

    Returns:
        The absolute path of the repository root, or None if there is none.
    """
    current = os.path.abspath(start_path or os.path.dirname(__file__))
    while True:
        if os.path.isdir(os.path.join(current, _SPECIFICATION_DIR)):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            return None
        current = parent


def _repo_root() -> str:
    root = find_repo_root()
    if not root:
        raise FileNotFoundError(
            "Could not find repository root containing 'specification'"
        )
    return root


def _base_version(version: str) -> str:
    """Strips pre-release tags (`-alpha`) and build metadata (`+build`)."""
    return version.split("-")[0].split("+")[0]


def get_spec_dir(version: str = "v1_0") -> str:
    """Returns the specification directory for a protocol version.

    The directories are named after base versions (`v1_0`, `v0_9_1`, `v0_8`),
    so pre-release and build suffixes map to their base version.

    Args:
        version: The protocol version, such as `v1_0`, `1.0`, `v0_9_1` or
            `1.0.0-alpha.1`.

    Returns:
        The absolute path of the specification directory.
    """
    clean_version = _base_version(version)
    parsed = parse_semver(normalize_version_string(clean_version))
    if parsed:
        if parsed.patch > 0:
            dir_name = f"v{parsed.major}_{parsed.minor}_{parsed.patch}"
        else:
            dir_name = f"v{parsed.major}_{parsed.minor}"
    else:
        dir_name = "v" + clean_version.lstrip("vV").replace(".", "_")
    return os.path.join(_repo_root(), _SPECIFICATION_DIR, dir_name)


def _basic_catalog_dir(version: str) -> str:
    """Returns the directory of the basic catalog for a protocol version.

    From v1.0 the basic catalog lives under `catalogs/`; earlier versions keep
    it in their specification directory.
    """
    parsed = parse_semver(normalize_version_string(_base_version(version)))
    if parsed and parsed.major >= 1:
        return os.path.join(_repo_root(), "catalogs", "basic", "v1")
    return os.path.join(get_spec_dir(version), "catalogs", "basic")


def get_basic_catalog_path(version: str = "v1_0") -> str:
    """Returns the path of the basic `catalog.json` for a protocol version."""
    return os.path.join(_basic_catalog_dir(version), "catalog.json")


def get_basic_examples_dir(version: str = "v1_0") -> str:
    """Returns the basic catalog's examples directory for a protocol version."""
    return os.path.join(_basic_catalog_dir(version), "examples")
