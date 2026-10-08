# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Catalog list checks and per-catalog schema helper lookup for inference formats."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Literal

from a2ui.core import A2uiCatalogError, CatalogApi
from a2ui.core.common import is_at_least_version, to_protocol_version
from a2ui.core.schema import ProtocolVersion

from .schema_helper import CatalogSchemaHelper


def _check_unique_ids(catalogs: Sequence[CatalogApi]) -> None:
    seen: set[str] = set()
    for c in catalogs:
        cat_id = c.catalog_id
        if cat_id in seen:
            raise A2uiCatalogError(f"Duplicate catalog ID: '{cat_id}'.")
        seen.add(cat_id)


def check_catalogs(catalogs: Sequence[CatalogApi]) -> list[CatalogApi]:
    """Checks the catalogs that a format, parser or compiler works with.

    Args:
        catalogs: The catalogs, default catalog first.

    Returns:
        A new list of the catalogs, in the order given.

    Raises:
        TypeError: If `catalogs` is not a sequence of catalogs.
        A2uiCatalogError: If no catalog is given, two catalogs share a catalog
            ID, or the catalogs target different protocol versions.
    """
    if not isinstance(catalogs, Sequence) or isinstance(catalogs, (str, bytes)):
        raise TypeError(
            "Expected `catalogs` to be a Sequence[CatalogApi], got"
            f" {type(catalogs).__name__}."
        )
    items = list(catalogs)
    if not items:
        raise A2uiCatalogError("At least one catalog must be provided.")
    _check_unique_ids(items)
    versions = {to_protocol_version(c.protocol_version) for c in items}
    if len(versions) > 1:
        raise A2uiCatalogError(
            "The catalogs target incompatible protocol versions:"
            f" {sorted(v.value for v in versions)}."
        )
    return items


def check_dsl_catalogs(catalogs: Sequence[CatalogApi]) -> list[CatalogApi]:
    """Checks the catalogs of an Express, Elemental or Atom format.

    These formats name catalogs per component and function call when they hold
    more than one, which only A2UI v1.0 and later allow.

    Args:
        catalogs: The catalogs.

    Returns:
        A new list of the catalogs, in the order given.

    Raises:
        TypeError: If `catalogs` is not a sequence of catalogs.
        A2uiCatalogError: If `check_catalogs` rejects the catalogs, or there
            are several catalogs and they target a version before v1.0.
    """
    items = check_catalogs(catalogs)
    if len(items) > 1 and not is_at_least_version(
        to_protocol_version(items[0].protocol_version), ProtocolVersion.V1_0
    ):
        raise A2uiCatalogError(
            "Several catalogs need A2UI v1.0 or later, but the catalogs target"
            f" {to_protocol_version(items[0].protocol_version).value}."
        )
    return items


def surface_catalog_id(catalogs: Sequence[CatalogApi]) -> str | None:
    """Returns the `catalogId` for a compiled `createSurface`, if it has one.

    A surface names its catalog only when there is a single catalog. With
    several, `createSurface` names none, so the surface has no default catalog
    and every component and function call names its own catalog.

    Args:
        catalogs: The checked catalogs.

    Returns:
        The single catalog's ID, or None when there are several catalogs.
    """
    return catalogs[0].catalog_id if len(catalogs) == 1 else None


def catalogs_defining(
    helpers: Mapping[str, CatalogSchemaHelper],
    kind: Literal["component", "function"],
    name: str,
) -> list[str]:
    """Returns the IDs of the catalogs that define a component or function.

    Args:
        helpers: The schema helpers keyed by catalog ID, in catalog order.
        kind: Whether `name` is a component or a function.
        name: The component or function name.

    Returns:
        The IDs of the defining catalogs, in catalog order.
    """
    return [
        cat_id
        for cat_id, helper in helpers.items()
        if name in (helper.components if kind == "component" else helper.functions)
    ]


def catalogs_protocol_version(catalogs: Sequence[CatalogApi]) -> str:
    """Returns the protocol version that the catalogs target, such as `"v1.0"`.

    Args:
        catalogs: The catalogs, default catalog first.

    Raises:
        TypeError: If `catalogs` is not a sequence of catalogs.
        A2uiCatalogError: If no catalog is given, two catalogs share a catalog
            ID, or the catalogs target different protocol versions.
    """
    items = check_catalogs(catalogs)
    return to_protocol_version(items[0].protocol_version).value


def build_catalog_helpers(
    catalogs: Sequence[CatalogApi],
) -> dict[str, CatalogSchemaHelper]:
    """Builds an insertion-ordered catalog ID to CatalogSchemaHelper mapping.

    Each helper is keyed by its catalog's `catalog_id`, so the first key is the
    primary catalog's ID.

    Args:
        catalogs: The catalogs, primary catalog first.

    Returns:
        The helpers keyed by catalog ID.

    Raises:
        A2uiCatalogError: If two catalogs share a catalog ID.
    """
    _check_unique_ids(catalogs)
    return {c.catalog_id: CatalogSchemaHelper(c) for c in catalogs}
