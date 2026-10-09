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

"""Negotiation of the catalogs that are active for a session."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, TYPE_CHECKING, TypeAlias

from pydantic import BaseModel, ValidationError

from a2ui.core import A2uiCatalogError, A2uiValidationError, Catalog, CatalogApi
from a2ui.core.common import to_protocol_version
from a2ui.core.schema import ProtocolVersion, v0_8, v0_9, v1_0

if TYPE_CHECKING:
    from a2ui.processor import CatalogConfig

_RendererCapabilities: TypeAlias = (
    Mapping[str, Any]
    | v0_8.A2uiClientCapabilities
    | v0_9.A2uiClientCapabilities
    | v1_0.A2uiRendererCapabilities
)

# The key that each protocol version's capabilities are sent under, and the
# model of the capabilities object stored there. v0.9.1 reuses the v0.9 key.
_CAPABILITIES_ENTRIES: dict[ProtocolVersion, tuple[str, type[BaseModel]]] = {
    ProtocolVersion.V0_8: ("v0.8", v0_8.V08Capabilities),
    ProtocolVersion.V0_9: ("v0.9", v0_9.V09Capabilities),
    ProtocolVersion.V0_9_1: ("v0.9", v0_9.V09Capabilities),
    ProtocolVersion.V1_0: ("v1.0", v1_0.V10Capabilities),
}


def resolve_catalogs(
    catalogs: Sequence[CatalogConfig],
    renderer_capabilities: _RendererCapabilities | None,
    accepts_inline_catalogs: bool = False,
) -> list[CatalogApi]:
    """Returns the catalogs that are active for a renderer's capabilities.

    Every registered catalog that the renderer names becomes active, in the
    renderer's order of preference, and ids that the agent doesn't hold are
    ignored. When the agent accepts inline catalogs, each inline catalog
    becomes an active catalog of its own after the registered ones, unless an
    active catalog already has its id. Otherwise inline catalogs are dropped,
    but they are still checked, since a malformed one makes the capabilities
    malformed whether or not the agent uses it.

    Args:
      catalogs: The catalogs that the agent registered. The returned catalogs
        are the transformed ones, so a pruning transformer shows both in the
        prompt and in what validation accepts. Inline catalogs aren't
        transformed.
      renderer_capabilities: The capabilities that the renderer sent, keyed by
        protocol version, for example `{"v1.0": {"supportedCatalogIds": [...]}}`.
        Either a mapping or a capabilities model from `a2ui.core`. `None`, for a
        request that carries no capabilities, activates every registered
        catalog in registration order, and returns an empty list if none is
        registered.
      accepts_inline_catalogs: Whether inline catalogs become active.

    Returns:
      The active catalogs.

    Raises:
      A2uiCatalogError: If capabilities are given and no catalog is active, for
        example because the renderer names none of the registered catalogs or
        sends an empty `supportedCatalogIds` without inline catalogs; if
        `inlineCatalogs` is not a list of valid catalog objects, for example
        because an inline catalog has no non-empty string `catalogId`; or if the
        registered catalogs read different capabilities keys, since one
        capabilities entry can't describe them all.
      A2uiValidationError: If the capabilities have no valid entry for the
        protocol version of the registered catalogs.
    """
    registered = [config.transformed_catalog for config in catalogs]
    if renderer_capabilities is None:
        return registered
    if not registered:
        raise A2uiCatalogError(
            "No catalogs are registered, so none of the renderer's catalogs can be"
            " resolved."
        )

    protocol_version = to_protocol_version(registered[0].protocol_version)
    key, entry_model = _CAPABILITIES_ENTRIES[protocol_version]
    for catalog in registered[1:]:
        other_key, _ = _CAPABILITIES_ENTRIES[
            to_protocol_version(catalog.protocol_version)
        ]
        if other_key != key:
            raise A2uiCatalogError(
                "The registered catalogs read different capabilities entries:"
                f" '{registered[0].catalog_id}' reads '{key}' and"
                f" '{catalog.catalog_id}' reads '{other_key}'."
            )
    entry = _capabilities_entry(renderer_capabilities, key, entry_model)
    # Every inline catalog is parsed, so a malformed one is an error even when
    # the agent doesn't accept inline catalogs.
    inline = [
        Catalog.from_json(document, protocol_version=protocol_version.value)
        for document in entry.get("inlineCatalogs", [])
    ]

    registered_by_id: dict[str, CatalogApi] = {}
    for catalog in registered:
        registered_by_id.setdefault(catalog.catalog_id, catalog)

    active: dict[str, CatalogApi] = {}
    for catalog_id in entry["supportedCatalogIds"]:
        if catalog_id in registered_by_id and catalog_id not in active:
            active[catalog_id] = registered_by_id[catalog_id]
    if accepts_inline_catalogs:
        for catalog in inline:
            active.setdefault(catalog.catalog_id, catalog)

    if not active:
        raise A2uiCatalogError(
            "No client-supported catalog found on the agent side. Agent-supported"
            f" catalogs are: {list(registered_by_id)}"
        )
    return list(active.values())


def _capabilities_entry(
    renderer_capabilities: _RendererCapabilities,
    key: str,
    entry_model: type[BaseModel],
) -> dict[str, Any]:
    """Returns the validated capabilities entry stored under a protocol key.

    An error in `inlineCatalogs` is an `A2uiCatalogError`. Any other error is
    an `A2uiValidationError`, since the capabilities themselves are malformed.
    """
    capabilities = (
        renderer_capabilities.model_dump(by_alias=True, exclude_none=True)
        if isinstance(renderer_capabilities, BaseModel)
        else renderer_capabilities
    )
    if not isinstance(capabilities, Mapping):
        raise A2uiValidationError(
            f"Renderer capabilities must be a mapping, got {type(capabilities)}."
        )
    entry = capabilities.get(key)
    if entry is None:
        raise A2uiValidationError(
            f"The renderer capabilities have no '{key}' entry, which the registered"
            " catalogs read."
        )
    try:
        return entry_model.model_validate(entry).model_dump(
            by_alias=True, exclude_none=True
        )
    except ValidationError as e:
        errors = e.errors()
        if errors and all(
            len(err.get("loc", ())) >= 1
            and err["loc"][0] in ("inlineCatalogs", "inline_catalogs")
            for err in errors
        ):
            raise A2uiCatalogError(
                f"Invalid inline catalog in '{key}' renderer capabilities: {e}"
            ) from e
        raise A2uiValidationError(f"Invalid '{key}' renderer capabilities: {e}") from e
