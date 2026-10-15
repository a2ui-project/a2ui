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

"""Loads the protocol JSON schemas that prompts and pruning work from."""

from __future__ import annotations

from typing import Any

from a2ui.core import (
    A2uiCatalogError,
    get_agent_to_renderer_schema_map,
    get_common_types_schema_map,
)
from a2ui.core.common import to_protocol_version
from a2ui.core.schema import ProtocolVersion


def load_agent_to_renderer_schema(version: ProtocolVersion | str) -> dict[str, Any]:
    """Returns the agent-to-renderer (server-to-client) schema for a protocol version.

    Args:
        version: A `ProtocolVersion`, or a version string such as '1.0',
            '0.9.1' or 'v0_9'.

    Returns:
        The agent-to-renderer JSON schema as a dictionary.

    Raises:
        A2uiCatalogError: If the version is not a known protocol version.
    """
    try:
        protocol_version = to_protocol_version(version)
    except ValueError as e:
        raise A2uiCatalogError(str(e)) from e
    return get_agent_to_renderer_schema_map(protocol_version)


def load_common_types_schema(version: ProtocolVersion | str) -> dict[str, Any]:
    """Returns the common types schema for a protocol version.

    a2ui-core generates the schema from the same Pydantic models it validates
    payloads with, so prompts, pruning, and streaming validation share one
    source of truth with payload validation.

    Args:
        version: A `ProtocolVersion`, or a version string such as '1.0',
            '0.9.1' or 'v0_9'.

    Returns:
        The common types JSON schema, or an empty dictionary for versions that
        predate common types (v0.8).

    Raises:
        A2uiCatalogError: If the version is not a known protocol version.
    """
    try:
        protocol_version = to_protocol_version(version)
    except ValueError as e:
        raise A2uiCatalogError(str(e)) from e
    if protocol_version is ProtocolVersion.V0_8:
        return {}
    return get_common_types_schema_map(protocol_version)
