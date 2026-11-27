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
import copy
import functools
import logging
import re
from typing import Any, TYPE_CHECKING

from pydantic import BaseModel, ValidationError

from a2ui.core import (
    A2uiCatalogError,
    A2uiValidationError,
    Catalog,
    CatalogApi,
    is_catalog_document,
    parse_catalog_document,
)
from a2ui.core.common import to_protocol_version
from a2ui.core.schema import (
    A2uiRendererCapabilities,
    ProtocolVersion,
    v0_8,
    v0_9,
    v1_0,
)

from .schemas import load_common_types_schema

if TYPE_CHECKING:
    from a2ui.processor import CatalogConfig

# The keys that each protocol version's capabilities are read from, in order,
# and the model of the capabilities object stored there. A v0.9 catalog also
# serves v0.9.1, so v0.9 and v0.9.1 catalogs read the v0.9.1 entry, then the
# v0.9 entry.
_CAPABILITIES_ENTRIES: dict[
    ProtocolVersion, tuple[tuple[str, ...], type[BaseModel]]
] = {
    ProtocolVersion.V0_8: (("v0.8",), v0_8.V08Capabilities),
    ProtocolVersion.V0_9: (("v0.9.1", "v0.9"), v0_9.V09Capabilities),
    ProtocolVersion.V0_9_1: (("v0.9.1", "v0.9"), v0_9.V09Capabilities),
    ProtocolVersion.V1_0: (("1.0",), v1_0.V10Capabilities),
}
_V0_8_KEYS = _CAPABILITIES_ENTRIES[ProtocolVersion.V0_8][0]
# The fields of a capabilities entry, as the specification names them.
_ENTRY_FIELDS = frozenset({"supportedCatalogIds", "inlineCatalogs"})
_logger = logging.getLogger(__name__)

_ARRAY_INDEX_RE = re.compile(r"^(?:0|[1-9][0-9]*)\Z")
_INVALID_ESCAPE_RE = re.compile(r"~(?![01])")
_LITERAL_VALUE_KEYWORDS = frozenset({"const", "default", "enum", "examples"})
_SCHEMA_COMPOSITE_KEYWORDS = ("allOf", "anyOf", "oneOf", "not")
_SCHEMA_MAP_KEYWORDS = frozenset({
    "$defs",
    "components",
    "definitions",
    "dependencies",
    "dependentSchemas",
    "functions",
    "patternProperties",
    "properties",
    "styles",
})


@functools.cache
def _common_type_defs(protocol_version: ProtocolVersion) -> frozenset[str]:
    """Returns the published ``common_types.json`` ``$defs`` names for ``protocol_version``."""
    return frozenset(load_common_types_schema(protocol_version).get("$defs", ()))


def _follow_pointer(document: Mapping[str, Any], segments: list[str]) -> Any:
    """Returns the node that ``segments`` name in ``document``, or ``None``."""
    curr: Any = document
    for segment in segments:
        if isinstance(curr, Mapping) and segment in curr:
            curr = curr[segment]
        elif (
            isinstance(curr, list)
            and _ARRAY_INDEX_RE.fullmatch(segment) is not None
            and len(segment) <= len(str(len(curr)))
            and int(segment) < len(curr)
        ):
            curr = curr[int(segment)]
        else:
            return None
    return curr


def _is_resolvable_local_ref(
    document: Mapping[str, Any],
    ref: str,
    common_defs: frozenset[str],
) -> bool:
    """Returns whether ``ref`` resolves inside ``document`` or ``common_types.json``."""
    if ref == "#":
        return True
    if not ref.startswith("#/"):
        return False
    raw_tokens = ref[2:].split("/")
    if any(_INVALID_ESCAPE_RE.search(token) for token in raw_tokens):
        return False
    segments = [token.replace("~1", "/").replace("~0", "~") for token in raw_tokens]
    if isinstance(_follow_pointer(document, segments), Mapping):
        return True
    return len(segments) == 2 and segments[0] == "$defs" and segments[1] in common_defs


def _is_flat_theme_map(value: Mapping[str, Any]) -> bool:
    """Returns whether a root ``theme`` object is a v0.9 flat property map."""
    if isinstance(value.get("$ref"), str):
        return False
    if isinstance(value.get("type"), (str, list)):
        return False
    if isinstance(value.get("properties"), Mapping):
        return False
    return not any(key in value for key in _SCHEMA_COMPOSITE_KEYWORDS)


def _is_schema_map_child(
    parent: Mapping[str, Any],
    document: Mapping[str, Any],
    key: str,
    value: Any,
) -> bool:
    """Returns whether ``value`` maps user-chosen names to sub-schemas."""
    if not isinstance(value, Mapping):
        return False
    if key in _SCHEMA_MAP_KEYWORDS:
        return True
    return parent is document and key == "theme" and _is_flat_theme_map(value)


def _enqueue_object_children(
    node: Mapping[str, Any],
    document: Mapping[str, Any],
    in_schema_map: bool,
    stack: list[tuple[Any, bool]],
) -> None:
    """Pushes child schema nodes of ``node`` onto ``stack``."""
    if in_schema_map:
        stack.extend((value, False) for value in reversed(list(node.values())))
        return
    for key, value in reversed(list(node.items())):
        if key not in _LITERAL_VALUE_KEYWORDS:
            stack.append((value, _is_schema_map_child(node, document, key, value)))


def validate_inline_catalog_local_refs(
    document: Mapping[str, Any],
    catalog_id: str,
    protocol_version: ProtocolVersion,
) -> None:
    """Validates that every local ``#...`` ``$ref`` in ``document`` resolves.

    Allows ``#/$defs/<CommonType>`` pointers defined in the protocol version's
    ``common_types.json`` so pre-1.0 inline catalogs emitted without ``$defs``
    remain valid, while rejecting undefined catalog-local pointers.

    Args:
      document: The raw inline catalog dictionary.
      catalog_id: Identifier of the inline catalog for error reporting.
      protocol_version: Target protocol version for ``common_types.json`` lookup.

    Raises:
      A2uiCatalogError: If ``document`` contains an unresolvable local ``$ref``.
    """
    common_defs = _common_type_defs(protocol_version)
    stack: list[tuple[Any, bool]] = [(document, False)]
    while stack:
        node, in_schema_map = stack.pop()
        if isinstance(node, list):
            stack.extend((item, False) for item in reversed(node))
            continue
        if not isinstance(node, Mapping):
            continue
        if not in_schema_map:
            ref = node.get("$ref")
            if (
                isinstance(ref, str)
                and ref.startswith("#")
                and not _is_resolvable_local_ref(document, ref, common_defs)
            ):
                raise A2uiCatalogError(
                    f"Inline catalog '{catalog_id}' contains an unresolvable"
                    f" local $ref '{ref}'."
                )
        _enqueue_object_children(node, document, in_schema_map, stack)


def resolve_catalogs(
    catalogs: Sequence[CatalogConfig],
    renderer_capabilities: A2uiRendererCapabilities | None,
    accepts_inline_catalogs: bool = False,
) -> list[CatalogApi]:
    """Returns the catalogs that are active for a renderer's capabilities.

    Every registered catalog that the renderer names becomes active, in the
    renderer's order of preference, and ids that the agent doesn't hold are
    ignored. When the agent accepts inline catalogs, each inline catalog
    becomes an active catalog of its own after the registered ones, unless an
    active catalog already has its id. Otherwise inline catalogs are dropped,
    but they are still checked, since a malformed one makes the capabilities
    malformed whether or not the agent uses it. An inline catalog targets the
    protocol version of the entry that declares it.

    Args:
      catalogs: The catalogs that the agent registered. The returned catalogs
        are the transformed ones, so a pruning transformer shows both in the
        prompt and in what validation accepts. Inline catalogs aren't
        transformed.
      renderer_capabilities: The capabilities that the renderer sent, keyed by
        protocol version, for example `{"1.0": {"supportedCatalogIds": [...]}}`.
        The v0.8 specification sends the entry itself, as
        `{"supportedCatalogIds": [...]}`, so v0.8 catalogs read that shape too.
        v0.9 and v0.9.1 catalogs read the `v0.9.1` entry, and the `v0.9` entry
        when there is no `v0.9.1` entry or it activates no catalog. Either a
        mapping or a capabilities model from `a2ui.core`. The `a2ui.core` v0.9
        model holds only a `v0.9` entry, so capabilities with a `v0.9.1` entry
        are passed as a mapping. `None`, for a request that carries no
        capabilities, activates every registered catalog in registration order,
        and returns an empty list if none is registered.
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
      A2uiValidationError: If the capabilities have no entry for the protocol
        version of the registered catalogs, or an entry that they read is
        malformed.
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
    keys, entry_model = _CAPABILITIES_ENTRIES[protocol_version]
    for catalog in registered[1:]:
        other_keys, _ = _CAPABILITIES_ENTRIES[
            to_protocol_version(catalog.protocol_version)
        ]
        if other_keys != keys:
            raise A2uiCatalogError(
                "The registered catalogs read different capabilities entries:"
                f" '{registered[0].catalog_id}' reads {_quote_keys(keys)} and"
                f" '{catalog.catalog_id}' reads {_quote_keys(other_keys)}."
            )
    entries = _capabilities_entries(renderer_capabilities, keys, entry_model)
    # Every inline catalog of every entry is parsed and checked for local $ref
    # integrity, so a malformed one is an error even when the agent doesn't
    # accept inline catalogs or doesn't reach its entry.
    candidates: list[tuple[dict[str, Any], list[CatalogApi]]] = []
    for key, entry in entries:
        entry_version = to_protocol_version(key).value
        inline: list[CatalogApi] = []
        for document in entry.get("inlineCatalogs", []):
            parsed = Catalog.from_json(document, protocol_version=entry_version)
            if not is_catalog_document(document):
                validate_inline_catalog_local_refs(
                    document,
                    parsed.catalog_id,
                    to_protocol_version(parsed.protocol_version),
                )
            inline.append(parsed)
        candidates.append((entry, inline))

    registered_by_id: dict[str, CatalogApi] = {}
    for catalog in registered:
        registered_by_id.setdefault(catalog.catalog_id, catalog)

    # The first entry that activates a catalog is the one the session uses.
    for entry, inline in candidates:
        active: dict[str, CatalogApi] = {}
        for catalog_id in entry["supportedCatalogIds"]:
            if catalog_id in registered_by_id and catalog_id not in active:
                active[catalog_id] = registered_by_id[catalog_id]
        if accepts_inline_catalogs:
            for catalog in inline:
                if catalog.catalog_id in active:
                    _logger.warning(
                        "Dropping inline catalog '%s': a catalog with this ID is"
                        " already active.",
                        catalog.catalog_id,
                    )
                    continue
                active[catalog.catalog_id] = catalog
        if active:
            return list(active.values())

    raise A2uiCatalogError(
        "No client-supported catalog found on the agent side. Agent-supported"
        f" catalogs are: {list(registered_by_id)}"
    )


def _capabilities_entries(
    renderer_capabilities: A2uiRendererCapabilities,
    keys: Sequence[str],
    entry_model: type[BaseModel],
) -> list[tuple[str, dict[str, Any]]]:
    """Returns the key and validated entry of each key present, in key order.

    Every entry present is validated, so a malformed one is an error even when
    an earlier entry activates a catalog. An error in `inlineCatalogs` is an
    `A2uiCatalogError`. Any other error is an `A2uiValidationError`, since the
    capabilities themselves are malformed.
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
    present = [(key, capabilities[key]) for key in keys if key in capabilities]
    if not present and keys == _V0_8_KEYS and _is_bare_entry(capabilities):
        # v0.8 capabilities aren't keyed by protocol version.
        present = [(keys[0], capabilities)]
    if not present:
        raise A2uiValidationError(
            f"The renderer capabilities have no {_quote_keys(keys)} entry, which the"
            " registered catalogs read."
        )
    return [(key, _validated_entry(key, entry, entry_model)) for key, entry in present]


def _validated_entry(
    key: str, entry: Any, entry_model: type[BaseModel]
) -> dict[str, Any]:
    """Returns the capabilities entry under `key`, validated by `entry_model`."""
    raw_inlines = (
        entry.get("inlineCatalogs")
        if isinstance(entry, Mapping) and isinstance(entry.get("inlineCatalogs"), list)
        else None
    )
    has_catalog_docs = raw_inlines is not None and any(
        is_catalog_document(item) for item in raw_inlines
    )
    if has_catalog_docs and isinstance(entry, Mapping) and raw_inlines is not None:
        # Validate Catalog Document entries via `parse_catalog_document` and
        # validate the remaining capability fields via `entry_model`.
        validated_positions: dict[int, Any] = {}
        legacy_inlines: list[Any] = []
        entry_ver: ProtocolVersion | None
        try:
            entry_ver = to_protocol_version(key)
        except ValueError:
            entry_ver = None
        for idx, item in enumerate(raw_inlines):
            if is_catalog_document(item):
                try:
                    parsed_doc = parse_catalog_document(item)
                    if entry_ver is not None and "protocolVersion" in item:
                        doc_ver = to_protocol_version(parsed_doc.protocol_version)
                        same_family = doc_ver == entry_ver or (
                            doc_ver in (ProtocolVersion.V0_9, ProtocolVersion.V0_9_1)
                            and entry_ver
                            in (ProtocolVersion.V0_9, ProtocolVersion.V0_9_1)
                        )
                        if not same_family:
                            raise A2uiCatalogError(
                                "Catalog Document protocolVersion"
                                f" {parsed_doc.protocol_version!r} is incompatible"
                                f" with '{key}' capabilities."
                            )
                except (A2uiCatalogError, A2uiValidationError, ValueError) as e:
                    raise A2uiCatalogError(
                        f"Invalid inline catalog in '{key}' renderer capabilities: {e}"
                    ) from e
                validated_positions[idx] = copy.deepcopy(dict(item))
            else:
                legacy_inlines.append(item)
        sanitized = dict(entry)
        sanitized["inlineCatalogs"] = legacy_inlines
        try:
            dumped = entry_model.model_validate(sanitized).model_dump(
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
            raise A2uiValidationError(
                f"Invalid '{key}' renderer capabilities: {e}"
            ) from e
        rebuilt: list[Any] = []
        legacy_iter = iter(dumped.get("inlineCatalogs", []))
        for idx in range(len(raw_inlines)):
            if idx in validated_positions:
                rebuilt.append(validated_positions[idx])
            else:
                rebuilt.append(next(legacy_iter))
        dumped["inlineCatalogs"] = rebuilt
        return dumped

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


def _is_bare_entry(capabilities: Mapping[str, Any]) -> bool:
    """Whether capabilities are one entry rather than entries keyed by version.

    The v0.8 specification sends `a2uiClientCapabilities` as the entry itself,
    so capabilities that hold a field of an entry are one. Other fields are
    left to the entry model, which reports them.
    """
    return any(field in capabilities for field in _ENTRY_FIELDS)


def _quote_keys(keys: Sequence[str]) -> str:
    """Names capabilities keys for a message, for example `'v0.9.1' or 'v0.9'`."""
    return " or ".join(f"'{key}'" for key in keys)
