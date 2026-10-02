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
in-memory or repository schema assets, and performing schema transformations.
"""

import json
import os
from typing import Any, cast

from .constants import (
    SPECIFICATION_DIR,
)


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


def _is_at_least_v1(version: str) -> bool:
    """Checks whether the requested protocol version is >= v1.0.

    A version string that does not parse as semver is treated as v1.0 or later
    unless it starts with "0" (after stripping a leading "v"), so labels such as
    "latest" select the v1 catalog.
    """
    from a2ui.core.common.semver import normalize_version_string, parse_semver

    clean_version = version.split("-")[0].split("+")[0]
    parsed = parse_semver(normalize_version_string(clean_version))
    if parsed:
        return parsed.major >= 1
    norm = clean_version.lstrip("vV")
    return not norm.startswith("0")


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
    if _is_at_least_v1(version):
        root = find_repo_root(start_path)
        if root:
            canonical = os.path.join(root, "catalogs", "basic", "v1", "catalog.json")
            if os.path.exists(canonical):
                return canonical
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
    if _is_at_least_v1(version):
        root = find_repo_root(start_path)
        if root:
            canonical = os.path.join(root, "catalogs", "basic", "v1", "examples")
            if os.path.exists(canonical):
                return canonical
    return os.path.join(
        get_spec_dir(version, start_path), "catalogs", "basic", "examples"
    )


def load_agent_to_renderer_schema(version: str) -> dict[str, Any]:
    """Returns the agent-to-renderer (server-to-client) schema for a protocol version.

    Args:
        version: The protocol version string (e.g. '1.0', '0.9.1', 'v0_9').

    Returns:
        The agent-to-renderer JSON schema as a dictionary.

    Raises:
        A2uiCatalogError: If the version is not a known protocol version.
    """
    from a2ui.core import A2uiCatalogError, get_agent_to_renderer_schema_json
    from a2ui.core.common import to_protocol_version

    try:
        protocol_version = to_protocol_version(version)
    except ValueError as e:
        raise A2uiCatalogError(str(e)) from e
    return cast(
        dict[str, Any],
        json.loads(get_agent_to_renderer_schema_json(protocol_version)),
    )


def load_common_types_schema(version: str) -> dict[str, Any]:
    """Returns the common types schema for a protocol version.

    a2ui-core generates the schema from the same Pydantic models it validates
    payloads with, so prompts, pruning, and streaming validation share one
    source of truth with payload validation.

    Args:
        version: The protocol version string (e.g. '1.0', '0.9.1', 'v0_9').

    Returns:
        The common types JSON schema, or an empty dictionary for versions that
        predate common types (v0.8).

    Raises:
        A2uiCatalogError: If the version is not a known protocol version.
    """
    from a2ui.core import A2uiCatalogError, get_common_types_schema_map
    from a2ui.core.common import to_protocol_version
    from a2ui.core.schema import ProtocolVersion

    try:
        protocol_version = to_protocol_version(version)
    except ValueError as e:
        raise A2uiCatalogError(str(e)) from e
    if protocol_version is ProtocolVersion.V0_8:
        return {}
    return get_common_types_schema_map(protocol_version)


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
        updates: The dictionary containing updates to recursively merge into
            the base dictionary.

    Returns:
        The updated base dictionary.
    """
    for key, value in updates.items():
        if isinstance(value, dict):
            base[key] = deep_update(base.get(key, {}), value)
        else:
            base[key] = value
    return base
