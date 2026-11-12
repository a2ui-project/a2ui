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

from a2a.types import DataPart, Message, Part

from a2ui.core.schema import ProtocolVersion
from a2ui.utils import read_renderer_capabilities


def _data_parts_from_message(message: Message) -> list[DataPart]:
    data_parts: list[DataPart] = []
    for part in message.parts or []:
        inner = part.root if isinstance(part, Part) else part
        if isinstance(inner, DataPart):
            data_parts.append(inner)
    return data_parts


def _capabilities_from_legacy_data(
    data_parts: list[DataPart],
    version: ProtocolVersion | str,
) -> dict[str, Any] | None:
    for data_part in data_parts:
        if not isinstance(data_part.data, Mapping):
            continue
        legacy_metadata = data_part.data.get("metadata")
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

    Checks ``message.metadata`` first, then each :class:`DataPart`'s ``metadata``,
    and finally each :class:`DataPart`'s ``data["metadata"]`` (legacy fallback).
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

    if message.metadata is not None:
        capabilities = read_renderer_capabilities(message.metadata, version)
        if capabilities is not None:
            return capabilities

    data_parts = _data_parts_from_message(message)
    for data_part in data_parts:
        if data_part.metadata is not None:
            capabilities = read_renderer_capabilities(data_part.metadata, version)
            if capabilities is not None:
                return capabilities

    legacy = _capabilities_from_legacy_data(data_parts, version)
    if legacy is not None:
        return legacy

    return read_renderer_capabilities(None, version)
