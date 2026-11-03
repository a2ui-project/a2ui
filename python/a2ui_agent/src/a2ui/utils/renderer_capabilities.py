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

"""Reads and validates renderer capabilities from transport message metadata."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from a2ui.constants import A2UI_CLIENT_CAPABILITIES_KEY
from a2ui.constants import A2UI_RENDERER_CAPABILITIES_KEY
from a2ui.core import A2uiCatalogError
from a2ui.core.common import to_protocol_version
from a2ui.core.schema import ProtocolVersion

from .catalog_resolver import _CAPABILITIES_ENTRIES
from .catalog_resolver import _V0_8_KEY
from .catalog_resolver import _is_bare_entry


def read_renderer_capabilities(
    metadata: Mapping[str, Any] | None,
    version: ProtocolVersion | str = ProtocolVersion.V1_0,
) -> dict[str, Any] | None:
  """Reads and validates renderer capabilities for ``version`` from ``metadata``.

  Looks up ``a2uiRendererCapabilities`` for v1.0 and ``a2uiClientCapabilities``
  for v0.8 and v0.9 (supporting both the ``v0.8``-keyed and bare v0.8 forms).
  Returns ``None`` when ``metadata`` is ``None`` or the version's capabilities
  entry is absent, and raises :class:`A2uiCatalogError` when the metadata key
  or version entry is malformed.

  Args:
    metadata: The transport message metadata mapping, or ``None``.
    version: The A2UI protocol version to read capabilities for.

  Returns:
    A version-keyed capabilities dictionary accepted unchanged by
    :func:`resolve_catalogs`, or ``None`` if absent.

  Raises:
    A2uiCatalogError: If ``version`` is unsupported, or if the capabilities
      metadata value or version entry is malformed.
  """
  try:
    protocol_version = to_protocol_version(version)
  except ValueError as exc:
    raise A2uiCatalogError(
        f"Unsupported protocol version {version!r}."
    ) from exc

  if metadata is None:
    return None
  if not isinstance(metadata, Mapping):
    raise A2uiCatalogError("Transport metadata must be a mapping.")

  metadata_key = (
      A2UI_RENDERER_CAPABILITIES_KEY
      if protocol_version == ProtocolVersion.V1_0
      else A2UI_CLIENT_CAPABILITIES_KEY
  )
  if metadata_key not in metadata or metadata[metadata_key] is None:
    return None

  raw = metadata[metadata_key]
  if not isinstance(raw, Mapping):
    raise A2uiCatalogError(
        f"The {metadata_key!r} metadata value must be a JSON object."
    )

  key, entry_model = _CAPABILITIES_ENTRIES[protocol_version]
  entry = raw.get(key)
  if entry is None and key == _V0_8_KEY and _is_bare_entry(raw):
    entry = raw
  if entry is None:
    return None
  if not isinstance(entry, Mapping):
    raise A2uiCatalogError(
        f"The {key!r} capabilities entry under {metadata_key!r} must be a JSON"
        " object."
    )

  validated_input = (
      {"supportedCatalogIds": [], **entry}
      if "inlineCatalogs" in entry and "supportedCatalogIds" not in entry
      else entry
  )
  try:
    entry_model.model_validate(validated_input)
  except ValidationError as exc:
    raise A2uiCatalogError(
        f"Invalid {key!r} renderer capabilities under {metadata_key!r}: {exc}"
    ) from exc

  return {key: dict(entry)}
