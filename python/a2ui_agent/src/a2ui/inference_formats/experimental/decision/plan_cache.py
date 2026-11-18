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

"""Plan cache for decision-model synthesis, scoped per `RendererState`."""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Mapping, Sequence
import copy
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any
import weakref

from .models import (
    DecisionAnswer,
    DecisionRecord,
    LayoutPlan,
    PlanCacheKey,
)

if TYPE_CHECKING:
    from a2ui.core.state.surface_model import SurfaceModel
    from a2ui.utils import RendererState

DEFAULT_MAX_ENTRIES = 64
"""Default maximum number of cached plans kept per `RendererState` (and in tool mode)."""

_COMPONENT_ENVELOPE_KEYS = frozenset(
    {"id", "component", "catalogId", "metadata", "@catalogId", "@metadata"}
)


def _component_properties(comp: Mapping[str, Any]) -> dict[str, Any]:
    """Returns the component property dict as stored on `ComponentModel.properties`."""
    return {
        key: value for key, value in comp.items() if key not in _COMPONENT_ENVELOPE_KEYS
    }


@dataclass(frozen=True)
class CachedPlan:
    """A cached `LayoutPlan` together with the flat A2UI components it expanded into.

    Attributes:
        plan: The validated layout plan.
        components: The expanded component dicts, deep-copied so callers cannot
            mutate the cached snapshot.
        send_data_model: Whether expanding `plan` required `sendDataModel` on
            `createSurface`.
        trace: The decision trace recorded when `plan` was built.
        decision_answers: The backend answers that produced `plan`.
        entropy: Normalized entropy of the winning archetype or family answer.
        all_surface_ids: All component ids present on the surface in
            `RendererState` after `components` were applied, including any
            orphan ids left behind by earlier in-place updates on the same
            surface. Defaults to the component ids in `components`.
    """

    plan: LayoutPlan
    components: tuple[dict[str, Any], ...]
    send_data_model: bool = False
    trace: tuple[DecisionRecord, ...] = ()
    decision_answers: tuple[DecisionAnswer, ...] = ()
    entropy: float = 0.0
    all_surface_ids: frozenset[str] = field(default_factory=frozenset)

    def __post_init__(self) -> None:
        copied = tuple(copy.deepcopy(dict(comp)) for comp in self.components)
        object.__setattr__(self, "components", copied)
        object.__setattr__(self, "trace", tuple(self.trace))
        object.__setattr__(self, "decision_answers", tuple(self.decision_answers))
        comp_ids = frozenset(
            str(comp["id"]) for comp in copied if isinstance(comp.get("id"), str)
        )
        surface_ids = (
            frozenset(self.all_surface_ids) | comp_ids
            if self.all_surface_ids
            else comp_ids
        )
        object.__setattr__(self, "all_surface_ids", surface_ids)

    @property
    def component_ids(self) -> frozenset[str]:
        """The component ids defined by `self.components`."""
        return frozenset(
            str(comp["id"])
            for comp in self.components
            if isinstance(comp.get("id"), str)
        )

    @property
    def root_id(self) -> str:
        """The root component id in `self.components` (defaults to ``'root'``)."""
        for comp in self.components:
            if comp.get("id") == "root":
                return "root"
        if self.components and isinstance(self.components[0].get("id"), str):
            return str(self.components[0]["id"])
        return "root"


def _one_component_matches(surface: SurfaceModel, comp: Mapping[str, Any]) -> bool:
    """Checks that one cached component dict matches `surface.components_model`."""
    cid = comp.get("id")
    if not isinstance(cid, str):
        return False
    model_comp = surface.components_model.get(cid)
    if model_comp is None or model_comp.type != comp.get("component"):
        return False
    return bool(model_comp.properties == _component_properties(comp))


def _surface_matches(surface: SurfaceModel | None, entry: CachedPlan) -> bool:
    """Checks whether `surface` exists and its root and component ids match `entry`."""
    if surface is None or surface.disposed or not entry.components:
        return False
    if (surface.root_id or "root") != entry.root_id:
        return False
    if set(surface.components_model.keys) != entry.all_surface_ids:
        return False
    return all(_one_component_matches(surface, comp) for comp in entry.components)


class PlanCache:
    """Bounded LRU cache of layout plans, isolated per `RendererState`.

    Conversation entries live in a `weakref.WeakKeyDictionary` keyed by
    `RendererState`, so two conversations never share entries and finished
    conversations are garbage-collected automatically. A cache hit is valid
    only when the target surface still exists on that `RendererState` and its
    root and component ids match the cached components.

    Tool mode has no `RendererState` and keeps one LRU keyed with the tool
    name as `PlanCacheKey.surface_id`.
    """

    def __init__(
        self,
        max_entries: int = DEFAULT_MAX_ENTRIES,
        *,
        maxsize: int | None = None,
    ) -> None:
        """Creates a plan cache.

        Args:
            max_entries: Maximum entries retained per `RendererState` (and in
                the tool-mode LRU). Defaults to 64.
            maxsize: Optional alias for `max_entries`.

        Raises:
            ValueError: If the entry bound is less than 1.
        """
        bound = maxsize if maxsize is not None else max_entries
        if bound < 1:
            raise ValueError(f"max_entries must be >= 1, got {bound}.")
        self.max_entries = bound
        self._by_state: weakref.WeakKeyDictionary[
            RendererState, OrderedDict[PlanCacheKey, CachedPlan]
        ] = weakref.WeakKeyDictionary()
        self._tool_entries: OrderedDict[PlanCacheKey, CachedPlan] = OrderedDict()

    def _evict(self, lru: OrderedDict[PlanCacheKey, CachedPlan]) -> None:
        """Evicts oldest entries from `lru` until its length is at most `max_entries`."""
        while len(lru) > self.max_entries:
            lru.popitem(last=False)

    def get(self, state: RendererState | None, key: PlanCacheKey) -> CachedPlan | None:
        """Returns the cached plan for `(state, key)`, or None on a miss.

        When `state` is a `RendererState`, a hit is returned only if the
        surface named by `key.surface_id` exists in `state` and its root and
        component ids match the cached components. When `state` is None,
        looks up `key` in the tool-mode LRU.
        """
        if state is None:
            return self.get_tool(key)
        lru = self._by_state.get(state)
        if lru is None or key not in lru:
            return None
        entry = lru[key]
        if not _surface_matches(state.get_surface(key.surface_id), entry):
            del lru[key]
            return None
        lru.move_to_end(key)
        return entry

    def put(
        self,
        state: RendererState | None,
        key: PlanCacheKey,
        entry: CachedPlan,
    ) -> None:
        """Stores `entry` under `(state, key)`, evicting the oldest entry if full."""
        if state is None:
            self.put_tool(key, entry)
            return
        lru = self._by_state.get(state)
        if lru is None:
            lru = OrderedDict()
            self._by_state[state] = lru
        lru[key] = entry
        lru.move_to_end(key)
        self._evict(lru)

    def invalidate(self, state: RendererState | None, surface_id: str) -> None:
        """Removes every cached plan for `surface_id` on `state`."""
        if state is None:
            self.invalidate_tool(surface_id)
            return
        lru = self._by_state.get(state)
        if lru is None:
            return
        for key in [k for k in lru if k.surface_id == surface_id]:
            del lru[key]

    def get_for_surface(
        self,
        state: RendererState,
        surface_id: str,
        *,
        catalog_id: str | None = None,
        grammar_version: str | None = None,
    ) -> tuple[PlanCacheKey, CachedPlan] | None:
        """Returns the most recent valid `(key, CachedPlan)` for `surface_id` on `state`.

        Used by `region` updates, where the payload or intent for the target
        block changed so the new `shape_signature` differs from the full-page
        plan's signature, but the surface's active layout plan is still the
        one on `state`.
        """
        lru = self._by_state.get(state)
        if lru is None:
            return None
        surface = state.get_surface(surface_id)
        for key in reversed(list(lru.keys())):
            if key.surface_id != surface_id:
                continue
            if catalog_id is not None and key.catalog_id != catalog_id:
                continue
            if grammar_version is not None and key.grammar_version != grammar_version:
                continue
            entry = lru[key]
            if _surface_matches(surface, entry):
                lru.move_to_end(key)
                return key, entry
        return None

    def get_tool(self, key: PlanCacheKey) -> CachedPlan | None:
        """Looks up `key` in the tool-mode LRU."""
        entry = self._tool_entries.get(key)
        if entry is None:
            return None
        self._tool_entries.move_to_end(key)
        return entry

    def put_tool(self, key: PlanCacheKey, entry: CachedPlan) -> None:
        """Stores `entry` in the tool-mode LRU, evicting the oldest entry if full."""
        self._tool_entries[key] = entry
        self._tool_entries.move_to_end(key)
        self._evict(self._tool_entries)

    def invalidate_tool(self, surface_id: str) -> None:
        """Removes every tool-mode entry whose `key.surface_id == surface_id`."""
        for key in [k for k in self._tool_entries if k.surface_id == surface_id]:
            del self._tool_entries[key]

    def last_tool_entry(self, surface_id: str) -> CachedPlan | None:
        """Returns the most recently used tool-mode entry for `surface_id`, if any."""
        for key in reversed(list(self._tool_entries.keys())):
            if key.surface_id == surface_id:
                return self._tool_entries[key]
        return None


def replace_block_components(
    existing: Sequence[Mapping[str, Any]],
    block_prefix: str,
    new_block_components: Sequence[Mapping[str, Any]],
) -> tuple[dict[str, Any], ...]:
    """Replaces one block's components (ids starting with ``<block_prefix>_``) in place."""
    prefix_match = f"{block_prefix}_"
    replaced: list[dict[str, Any]] = []
    inserted = False
    for comp in existing:
        cid = str(comp.get("id", ""))
        if cid.startswith(prefix_match):
            if not inserted:
                replaced.extend(copy.deepcopy(dict(c)) for c in new_block_components)
                inserted = True
        else:
            replaced.append(copy.deepcopy(dict(comp)))
    if not inserted:
        replaced.extend(copy.deepcopy(dict(c)) for c in new_block_components)
    return tuple(replaced)


__all__ = [
    "DEFAULT_MAX_ENTRIES",
    "CachedPlan",
    "PlanCache",
    "replace_block_components",
]
