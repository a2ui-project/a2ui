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

from pydantic import BaseModel, ValidationError

from a2ui.constants import A2UI_CLIENT_CAPABILITIES_KEY, A2UI_RENDERER_CAPABILITIES_KEY
from a2ui.core import A2uiCatalogError, A2uiError, Catalog
from a2ui.core.common import to_protocol_version
from a2ui.core.schema import ProtocolVersion

from .catalog_resolver import _CAPABILITIES_ENTRIES, _V0_8_KEYS, _is_bare_entry


def read_renderer_capabilities(
    metadata: Mapping[str, Any] | None,
    version: ProtocolVersion | str = ProtocolVersion.V1_0,
) -> dict[str, Any] | None:
    """Reads and validates renderer capabilities for ``version`` from ``metadata``.

    Looks up ``a2uiRendererCapabilities`` for v1.0 and ``a2uiClientCapabilities``
    for v0.8, v0.9, and v0.9.1 (supporting both the ``v0.8``-keyed and bare
    v0.8 forms). v0.9 and v0.9.1 read the ``v0.9.1`` and ``v0.9`` entries, and
    each one present is validated and returned. Returns ``None`` when
    ``metadata`` is ``None`` or the version has no capabilities entry, and
    raises :class:`A2uiCatalogError` when the metadata key or a version entry
    is malformed.

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
        raise A2uiCatalogError(f"Unsupported protocol version {version!r}.") from exc

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

    keys, entry_model = _CAPABILITIES_ENTRIES[protocol_version]
    present = [(key, raw[key]) for key in keys if raw.get(key) is not None]
    if not present and keys == _V0_8_KEYS and _is_bare_entry(raw):
        present = [(keys[0], raw)]
    if not present:
        return None
    return {
        key: _validated_entry(key, entry, entry_model, metadata_key)
        for key, entry in present
    }


def _validated_entry(
    key: str,
    entry: Any,
    entry_model: type[BaseModel],
    metadata_key: str,
) -> dict[str, Any]:
    """Returns a copy of the capabilities entry under ``key``, once validated.

    An inline catalog targets the protocol version of the entry that declares
    it, as in :func:`resolve_catalogs`.
    """
    if not isinstance(entry, Mapping):
        raise A2uiCatalogError(
            f"The {key!r} capabilities entry under {metadata_key!r} must be a JSON"
            " object."
        )

    try:
        if "inlineCatalogs" in entry and entry["inlineCatalogs"] is None:
            raise A2uiCatalogError(
                f"The 'inlineCatalogs' field in {key!r} renderer capabilities"
                f" under {metadata_key!r} must be an array of catalog objects."
            )
        entry_model.model_validate(entry, by_alias=True, by_name=False)
        for document in entry.get("inlineCatalogs") or []:
            if "protocolVersion" in document:
                raw_doc_version = document["protocolVersion"]
                if not isinstance(raw_doc_version, str):
                    raise A2uiCatalogError(
                        "Inline catalog 'protocolVersion' in"
                        f" {key!r} renderer capabilities under"
                        f" {metadata_key!r} must be a string."
                    )
                try:
                    doc_version = to_protocol_version(raw_doc_version)
                except ValueError as exc:
                    raise A2uiCatalogError(
                        "Unsupported inline catalog protocolVersion"
                        f" {raw_doc_version!r} in {key!r} renderer"
                        f" capabilities under {metadata_key!r}."
                    ) from exc
                if key not in _CAPABILITIES_ENTRIES[doc_version][0]:
                    raise A2uiCatalogError(
                        f"Inline catalog protocolVersion {raw_doc_version!r}"
                        f" is incompatible with {key!r} renderer capabilities"
                        f" under {metadata_key!r}."
                    )
            Catalog.from_json(document, protocol_version=to_protocol_version(key).value)
    except A2uiCatalogError:
        raise
    except (ValidationError, A2uiError) as exc:
        raise A2uiCatalogError(
            f"Invalid {key!r} renderer capabilities under {metadata_key!r}: {exc}"
        ) from exc

    return dict(entry)
