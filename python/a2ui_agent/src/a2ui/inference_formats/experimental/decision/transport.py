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

"""Stateless transport lowering bridging `@macro` and Client-Side Templates."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any

from a2ui.core import CatalogApi
from a2ui.core.schema import AgentToRendererMessage
from a2ui.transformers.macros import MacroExpander
from a2ui.utils import RendererState, validate_payload
from a2ui.utils._experimental import experimental


def _macro_name(fn: Callable[..., Any]) -> str | None:
    """Returns the registered A2UI macro name for `fn`, if decorated."""
    meta = getattr(fn, "__a2ui_macro__", None)
    if meta is not None and isinstance(getattr(meta, "name", None), str):
        return str(meta.name)
    return None


def _active_macros(
    transport_catalogs: Sequence[CatalogApi],
    macros: Sequence[Callable[..., Any]],
) -> list[Callable[..., Any]]:
    """Filters out `@macro` functions shadowed by components in `transport_catalogs`."""
    if not macros:
        return []
    transport_names = {
        comp_name for catalog in transport_catalogs for comp_name in catalog.components
    }
    return [fn for fn in macros if (_macro_name(fn) not in transport_names)]


def _record_message_surface_catalog(
    dumped: Mapping[str, Any],
    default_cid: str | None,
    known: dict[str, str | None],
) -> None:
    """Records a message's `surfaceId -> catalogId` mapping into `known`."""
    create_op = dumped.get("createSurface")
    if isinstance(create_op, Mapping):
        sid = create_op.get("surfaceId")
        if isinstance(sid, str):
            cid = create_op.get("catalogId")
            known[sid] = str(cid) if isinstance(cid, str) else default_cid
        return
    update_op = dumped.get("updateComponents")
    if not isinstance(update_op, Mapping) or default_cid is None:
        return
    sid = update_op.get("surfaceId")
    if isinstance(sid, str) and sid not in known:
        known[sid] = default_cid


def _seed_surface_catalogs(
    messages: Sequence[AgentToRendererMessage],
    transport_catalogs: Sequence[CatalogApi],
    surface_catalogs: Mapping[str, str | None] | None,
) -> dict[str, str | None]:
    """Builds a per-call surface-to-catalog map covering `createSurface` and updates."""
    known: dict[str, str | None] = dict(surface_catalogs or {})
    default_cid = (
        transport_catalogs[0].catalog_id if len(transport_catalogs) == 1 else None
    )
    for msg in messages:
        dumped = msg.model_dump(by_alias=True, exclude_none=True)
        _record_message_surface_catalog(dumped, default_cid, known)
    return known


@experimental
def build_inference_catalogs(
    transport_catalogs: Sequence[CatalogApi],
    *,
    macros: Sequence[Callable[..., Any]] = (),
    macro_catalog_id: str | None = None,
) -> list[CatalogApi]:
    """Builds inference catalogs combining `transport_catalogs` and non-shadowed `@macro`s."""
    active = _active_macros(transport_catalogs, macros)
    if not active:
        return list(transport_catalogs)
    scoped = MacroExpander(
        active,
        catalog_id=macro_catalog_id,
        base_catalogs=transport_catalogs,
        on_error="raise",
    )
    return list(scoped.transform_catalogs(transport_catalogs))


@experimental
def lower_for_transport(
    messages: Sequence[AgentToRendererMessage],
    *,
    transport_catalogs: Sequence[CatalogApi],
    macros: Sequence[Callable[..., Any]] = (),
    macro_catalog_id: str | None = None,
    surface_catalogs: Mapping[str, str | None] | None = None,
    renderer_state: RendererState | None = None,
) -> list[AgentToRendererMessage]:
    """Lowers `@macro` components and validates transport messages without mutating shared state."""
    known_surfaces = _seed_surface_catalogs(
        messages, transport_catalogs, surface_catalogs
    )
    active = _active_macros(transport_catalogs, macros)
    lowered: list[AgentToRendererMessage] = list(messages)
    if active:
        scoped = MacroExpander(
            active,
            catalog_id=macro_catalog_id,
            base_catalogs=transport_catalogs,
            on_error="raise",
        )
        lowered = list(
            scoped.transform_to_transport(lowered, surface_catalogs=known_surfaces)
        )
    if renderer_state is not None:
        with renderer_state.transaction():
            touched = renderer_state.apply(lowered)
            renderer_state.check_topology(touched)
    else:
        non_null_surfaces = {
            sid: cid for sid, cid in known_surfaces.items() if cid is not None
        }
        validate_payload(
            transport_catalogs,
            lowered,
            surface_catalog_ids=non_null_surfaces or None,
        )
    return lowered
