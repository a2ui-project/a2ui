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

"""Utilities for A2UI schema resolution, loading, and manipulation.

Provides helper functions for locating specification directories, loading
bundled or repository schema assets, and performing schema transformations.
"""

import json
import logging
import os
import importlib.resources
from typing import Any, cast

from .constants import (
    A2UI_ASSET_PACKAGE,
    SPECIFICATION_DIR,
    ENCODING,
    COMMON_TYPES_SCHEMA_KEY,
)
from .catalog_provider import FileSystemCatalogProvider


def find_repo_root(start_path: str | None = None) -> str | None:
    """Finds the repository root by looking for the 'specification' directory.

    Args:
        start_path: Optional starting directory to search upwards from. Defaults to
            the directory of this file.

    Returns:
        The absolute path to the repository root directory, or None if not found.
    """
    if start_path is None:
        start_path = os.path.dirname(__file__)
    current = os.path.abspath(start_path)
    while True:
        if os.path.isdir(os.path.join(current, SPECIFICATION_DIR)):
            return current
        parent = os.path.dirname(current)
        if parent == current:
            return None
        current = parent


def get_spec_dir(version: str = "v1_0", start_path: str | None = None) -> str:
    """Returns the path to the specification directory for a given version.

    Args:
        version: The protocol version string (e.g. 'v1_0', '1.0', 'v0_9_1',
            '1.0.0-alpha.1'). Defaults to 'v1_0'.
        start_path: Optional starting directory to search for the repository root.

    Returns:
        The absolute path to the specification directory for the resolved version.

    Raises:
        FileNotFoundError: If the repository root containing 'specification'
            cannot be found.
    """
    root = find_repo_root(start_path)
    if not root:
        raise FileNotFoundError(
            "Could not find repository root containing 'specification'"
        )

    from a2ui.core.common.semver import normalize_version_string, parse_semver

    # The on-disk 'specification/' hierarchy is organized strictly by base protocol
    # versions (e.g. 'v1_0', 'v0_9_1', 'v0_8'). Pre-release tags ('-alpha') and build
    # metadata ('+build') are stripped so that requests for pre-release or development
    # versions consistently map to the corresponding base specification directory.
    clean_version = version.split("-")[0].split("+")[0]

    # Format canonical specification directory names: versions with patch > 0
    # use 'vMAJOR_MINOR_PATCH' (e.g. 'v0_9_1'), while zero-patch versions use
    # 'vMAJOR_MINOR' (e.g. 'v1_0').
    parsed = parse_semver(normalize_version_string(clean_version))
    if parsed:
        if parsed.patch > 0:
            norm_version = f"v{parsed.major}_{parsed.minor}_{parsed.patch}"
        else:
            norm_version = f"v{parsed.major}_{parsed.minor}"
    else:
        norm_version = clean_version.replace(".", "_")
        if norm_version.startswith(("v", "V")):
            norm_version = f"v{norm_version[1:]}"
        else:
            norm_version = f"v{norm_version}"
    return os.path.join(root, SPECIFICATION_DIR, norm_version)


def get_basic_catalog_path(version: str = "v1_0", start_path: str | None = None) -> str:
    """Returns the path to the basic catalog.json file for a given version.

    Args:
        version: The protocol version string. Defaults to 'v1_0'.
        start_path: Optional starting directory to search for the repository root.

    Returns:
        The absolute path to the basic catalog.json file.

    Raises:
        FileNotFoundError: If the repository root containing 'specification'
            cannot be found.
    """
    return os.path.join(
        get_spec_dir(version, start_path), "catalogs", "basic", "catalog.json"
    )


def get_basic_examples_dir(version: str = "v1_0", start_path: str | None = None) -> str:
    """Returns the path to the basic examples directory for a given version.

    Args:
        version: The protocol version string. Defaults to 'v1_0'.
        start_path: Optional starting directory to search for the repository root.

    Returns:
        The absolute path to the basic examples directory.

    Raises:
        FileNotFoundError: If the repository root containing 'specification'
            cannot be found.
    """
    return os.path.join(
        get_spec_dir(version, start_path), "catalogs", "basic", "examples"
    )


def load_from_bundled_resource(
    version: str,
    resource_key: str,
    spec_map: dict[str, dict[str, str]],
) -> dict[str, Any]:
    """Loads a schema resource from bundled package resources or local fallbacks.

    Attempts to load the schema from bundled package resources first, falling back
    to local asset directories, and finally to the source repository.

    Args:
        version: The protocol version string (e.g. 'v1_0', 'v0_9').
        resource_key: Key identifying the resource in spec_map.
        spec_map: Mapping of version names to dictionaries of resource keys and
            relative file paths.

    Returns:
        The parsed schema JSON content as a dictionary.

    Raises:
        A2uiCatalogError: If the version is not found in spec_map, or if resource_key
            is not found in the specification map for the version.
        IOError: If the schema resource file cannot be located or loaded from any source.
    """
    from a2ui.core.common.semver import to_canonical_version

    canonical = to_canonical_version(version)
    version_spec_map = spec_map.get(canonical or version)
    if not version_spec_map:
        from a2ui.core import A2uiCatalogError

        raise A2uiCatalogError(f"Unknown A2UI version: {version}")

    if resource_key not in version_spec_map:
        if resource_key == COMMON_TYPES_SCHEMA_KEY:
            return {}
        from a2ui.core import A2uiCatalogError

        raise A2uiCatalogError(
            f"Resource key '{resource_key}' not found in specification map for version"
            f" {version}"
        )

    rel_path = version_spec_map[resource_key]
    filename = os.path.basename(rel_path)
    version_dir = canonical or version

    # 1. Try to load from the bundled package resources.
    try:
        traversable = importlib.resources.files(A2UI_ASSET_PACKAGE)
        traversable = traversable.joinpath(version_dir).joinpath(filename)
        with traversable.open("r", encoding=ENCODING) as f:
            return cast(dict[str, Any], json.load(f))
    except Exception as e:
        logging.debug("Could not load '%s' from package resources: %s", filename, e)

    # 2. Fallback to local assets
    # This handles cases where assets might be present in src but not installed
    try:
        # The assets are located at a2ui/assets/<version_dir>/<filename>
        # This file is at a2ui/inference/schema/manager.py
        # So, we need to go up 3 directories to 'a2ui', then down to 'assets'
        potential_path = os.path.abspath(
            os.path.join(
                os.path.dirname(__file__),
                "..",
                "..",
                "assets",
                version_dir,
                filename,
            )
        )
        if os.path.exists(potential_path):
            provider = FileSystemCatalogProvider(potential_path)
            return provider.load()
    except Exception as e:
        logging.debug("Could not load schema '%s' from local assets: %s", filename, e)

    # 3. Fallback: Source Repository (specification/...)
    # This handles cases where we are running directly from source tree
    # And assets are not yet copied to src/a2ui/assets
    # manager.py is at a2a_agents/python/a2ui_agent/src/a2ui/inference/schema/manager.py
    # Dynamically find repo root by looking for "specification" directory
    try:
        repo_root = find_repo_root(os.path.dirname(__file__))
        if repo_root:
            source_path = os.path.join(repo_root, rel_path)
            if os.path.exists(source_path):
                provider = FileSystemCatalogProvider(source_path)
                return provider.load()
    except Exception as e:
        logging.debug("Could not load schema from source repo: %s", e)

    raise IOError(f"Could not load schema {filename} for version {version}")


def wrap_as_json_array(a2ui_schema: dict[str, Any]) -> dict[str, Any]:
    """Wraps an A2UI schema in a JSON array schema to support message sequences.

    Used when prompting language models to generate a sequence of messages rather
    than a single message object.

    Args:
        a2ui_schema: The base A2UI JSON schema dictionary to wrap.

    Returns:
        The wrapped JSON schema specifying an array of the given schema items.

    Raises:
        A2uiCatalogError: If a2ui_schema is empty.
    """
    if not a2ui_schema:
        from a2ui.core import A2uiCatalogError

        raise A2uiCatalogError("A2UI schema is empty")
    return {"type": "array", "items": a2ui_schema}


def deep_update(base: dict[str, Any], updates: dict[str, Any]) -> dict[str, Any]:
    """Recursively updates a dictionary with another dictionary.

    Args:
        base: The base dictionary to be updated in-place.
        updates: The dictionary containing updates to recursively merge into the base dictionary.

    Returns:
        The updated base dictionary.
    """
    for key, value in updates.items():
        if isinstance(value, dict):
            base[key] = deep_update(base.get(key, {}), value)
        else:
            base[key] = value
    return base
