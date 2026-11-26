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

"""Reads A2UI renderer capabilities from an inbound A2A message."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from a2a.types import Message

from a2ui.core.schema import ProtocolVersion
from a2ui.utils import read_renderer_capabilities

from . import _compat


def _capabilities_from_legacy_data(
    data_parts: list[tuple[Any, Any]],
    version: ProtocolVersion | str,
) -> dict[str, Any] | None:
    for data, _ in data_parts:
        if not isinstance(data, Mapping):
            continue
        legacy_metadata = data.get("metadata")
        if not isinstance(legacy_metadata, Mapping):
            continue
        capabilities = read_renderer_capabilities(legacy_metadata, version)
        if capabilities is not None:
            return capabilities
    return None


def renderer_capabilities_from_message(
    message: Message | None,
    version: ProtocolVersion | str = ProtocolVersion.V1_0,
) -> dict[str, Any] | None:
    """Reads and validates renderer capabilities for ``version`` from an A2A ``Message``.

    Checks ``message.metadata`` first, then each data part's ``metadata``, and
    finally each data part's ``data["metadata"]`` (legacy fallback). Works with
    both a2a-sdk 0.3 and 1.x messages.
    The first source carrying the version's capabilities key wins.

    Args:
      message: The inbound A2A message, or ``None``.
      version: The A2UI protocol version to read capabilities for.

    Returns:
      A version-keyed capabilities dictionary accepted unchanged by
      :func:`resolve_catalogs`, or ``None`` if absent.

    Raises:
      A2uiCatalogError: If ``version`` is unsupported or a capabilities entry is
        malformed.
    """
    if message is None:
        return read_renderer_capabilities(None, version)

    message_metadata = _compat.metadata_dict(message.metadata)
    if message_metadata is not None:
        capabilities = read_renderer_capabilities(message_metadata, version)
        if capabilities is not None:
            return capabilities

    data_parts = _compat.data_parts_of(message)
    for _, part_metadata in data_parts:
        if part_metadata is not None:
            capabilities = read_renderer_capabilities(part_metadata, version)
            if capabilities is not None:
                return capabilities

    legacy = _capabilities_from_legacy_data(data_parts, version)
    if legacy is not None:
        return legacy

    return read_renderer_capabilities(None, version)
