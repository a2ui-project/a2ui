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

"""What a check found about a surface's component graph, for checking the next batch.

`SurfaceComponentsModel.validate_components_update` uses a `ComponentGraphBound`
under a validation config that defers the graph checks, so that a batch is
checked against the components it changes rather than the whole surface.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Callable, Iterable, Mapping

from ..exceptions import A2uiValidationError
from .component_model import ComponentModel
from .validation_helpers import (
    check_allowed_children,
    check_allowed_parent,
    composition_api,
)

__all__ = ["ComponentGraphBound"]


class _AnyId:
    """A container holding every string, passed as the known component ids.

    A component whose catalog declares no reference fields for its type has its
    children guessed from its properties (the legacy v0.8 heuristic). A string
    property, or a list holding one, then counts as a reference only when it
    names a component the surface holds. Reading the references as if every id
    were held gives a superset of them; dropping the ids the surface does not
    hold gives the references a check of the whole surface reads.
    """

    def __contains__(self, item: object) -> bool:
        return isinstance(item, str)


_ANY_ID = _AnyId()


def possible_children(model: ComponentModel) -> list[str]:
    """Returns the ids a component may reference, whichever ids the surface holds.

    The ids among them that the surface holds are the children the topology
    check (`analyze_topology`) follows.
    """
    return [ref_id for ref_id, _ in model.get_child_references(_ANY_ID)]


def declared_children(model: ComponentModel) -> list[str]:
    """Returns the children the composition check reads, in property order.

    These are the references `validate_composition_constraints` reads, which do
    not depend on the ids the surface holds.
    """
    return [ref_id for ref_id, _ in model.get_child_references()]


def _set_edges(
    children_of: dict[str, list[str]],
    parents_of: dict[str, set[str]],
    comp_id: str,
    children: list[str],
) -> None:
    """Sets the children of `comp_id`, and updates the parents of each child.

    A child no component references any more is dropped from `parents_of`.
    """
    for child in children_of.get(comp_id, ()):
        parents = parents_of.get(child)
        if parents is not None:
            parents.discard(comp_id)
            if not parents:
                del parents_of[child]
    for child in children:
        parents_of.setdefault(child, set()).add(comp_id)
    children_of[comp_id] = children


class ComponentGraphBound:
    """The references of a surface's components and a bound on their depth.

    The bound describes a graph that passed the composition and topology
    checks. It holds the children and parents of each component, for the
    composition check and for the topology check, the position of each
    component on the surface, and for each component an upper bound on the
    number of references in the longest chain below it.

    The bound lets a batch be checked without walking the whole graph. A
    cycle the batch makes passes through one of its components, and only the
    chains through its components grow, so only those components and the ones
    above them are revisited. The composition constraints of a component
    depend on its type, its children, their types and its parent, so only the
    batch, the children it adds or drops, and the components referencing it
    are checked again.
    """

    def __init__(self) -> None:
        # The ids each component may reference (see `possible_children`), and
        # the components that may reference each id.
        self._children: dict[str, list[str]] = {}
        self._parents: dict[str, set[str]] = {}
        # The same for the references the composition check reads.
        self._declared: dict[str, list[str]] = {}
        self._declared_parents: dict[str, set[str]] = {}
        # For each component, at least the number of references in the
        # longest chain below it, and at least the largest of these.
        self._heights: dict[str, int] = {}
        self._max_height: float = 0
        # The position of each component on the surface, which decides the
        # parent `validate_composition_constraints` picks.
        self._order: dict[str, int] = {}
        self._next_order = 0

    @classmethod
    def of(cls, components: Mapping[str, ComponentModel]) -> ComponentGraphBound:
        """Returns the bound of a graph that passed the checks, in surface order.

        A graph with a cycle among components the topology check does not
        reach can pass it. Its bound does not hold, so `admits` refuses every
        batch.
        """
        bound = cls()
        for comp_id, model in components.items():
            bound._order[comp_id] = bound._next_order
            bound._next_order += 1
            bound._set_children(comp_id, possible_children(model))
            bound._set_declared(comp_id, declared_children(model))
        bound._compute_heights(components.keys())
        return bound

    def _set_children(self, comp_id: str, children: list[str]) -> None:
        _set_edges(self._children, self._parents, comp_id, children)

    def _set_declared(self, comp_id: str, children: list[str]) -> None:
        _set_edges(self._declared, self._declared_parents, comp_id, children)

    def _compute_heights(self, ids: Iterable[str]) -> None:
        """Sets each height to the longest chain below it, children first."""
        held = self._children.keys()
        heights = self._heights
        for start in ids:
            if start in heights:
                continue
            stack = [(start, iter(self._children[start]))]
            on_stack = {start}
            while stack:
                comp_id, pending = stack[-1]
                for child in pending:
                    if child not in held or child in heights:
                        continue
                    if child in on_stack:
                        # A cycle: no bound holds.
                        self._max_height = float("inf")
                        return
                    on_stack.add(child)
                    stack.append((child, iter(self._children[child])))
                    break
                else:
                    stack.pop()
                    on_stack.discard(comp_id)
                    height = max(
                        (
                            heights[child] + 1
                            for child in self._children[comp_id]
                            if child in held
                        ),
                        default=0,
                    )
                    heights[comp_id] = height
                    if height > self._max_height:
                        self._max_height = height

    def composition_holds(
        self,
        batch: Mapping[str, ComponentModel],
        held: Mapping[str, ComponentModel],
    ) -> bool:
        """Whether the composition constraints hold on what the batch changes.

        `held` is the surface before the batch, which passed the check when
        this bound was made. A component whose type, children, children's
        types and parent are unchanged still passes, so only the others are
        checked. False means one of them fails; the caller then checks the
        whole surface with `validate_composition_constraints`, which raises
        the error it reports for the first component that fails.
        """

        def model_of(comp_id: str) -> ComponentModel | None:
            model = batch.get(comp_id)
            return model if model is not None else held.get(comp_id)

        def type_of(comp_id: str) -> str | None:
            model = model_of(comp_id)
            return model.type if model is not None else None

        new_order = {
            comp_id: self._next_order + position
            for position, comp_id in enumerate(c for c in batch if c not in held)
        }

        def order_of(comp_id: str) -> int:
            return self._order[comp_id] if comp_id in held else new_order[comp_id]

        declared = {comp_id: declared_children(m) for comp_id, m in batch.items()}
        batch_parents: dict[str, set[str]] = {}
        for comp_id, children in declared.items():
            for child in children:
                batch_parents.setdefault(child, set()).add(comp_id)

        def parent_of(comp_id: str) -> str | None:
            """The last component on the surface that references `comp_id`."""
            parents = {
                p for p in self._declared_parents.get(comp_id, ()) if p not in batch
            }
            parents.update(batch_parents.get(comp_id, ()))
            return max(parents, key=order_of) if parents else None

        # Components outside the batch whose parent may have changed, and
        # those that reference a component of the batch, which may now be of a
        # type they do not allow, with the components of the batch they
        # reference.
        moved: set[str] = set()
        holding: dict[str, list[str]] = {}
        for comp_id in batch:
            moved.update(self._declared.get(comp_id, ()))
            moved.update(declared[comp_id])
            for parent in self._declared_parents.get(comp_id, ()):
                if parent not in batch:
                    holding.setdefault(parent, []).append(comp_id)
        try:
            for comp_id in (*batch, *moved, *holding):
                model = model_of(comp_id)
                if model is None:
                    continue
                component_api = composition_api(model)
                if component_api is None:
                    continue
                if comp_id in batch or comp_id in moved:
                    parent_id = parent_of(comp_id)
                    check_allowed_parent(
                        comp_id,
                        model,
                        component_api,
                        parent_id,
                        type_of(parent_id) if parent_id is not None else None,
                    )
                if comp_id in batch:
                    check_allowed_children(
                        comp_id, model, component_api, declared[comp_id], type_of
                    )
                elif comp_id in holding:
                    check_allowed_children(
                        comp_id, model, component_api, holding[comp_id], type_of
                    )
        except A2uiValidationError:
            return False
        return True

    def admits(
        self,
        batch: Mapping[str, ComponentModel],
        limit: int,
        held: Callable[[str], bool],
    ) -> bool:
        """Whether this bound shows the graph with the batch passes the topology check.

        The graph passes when it has no self-reference, no cycle and no chain
        of more than `limit` references, which the bound shows when it holds
        after the batch. `held` tells whether the graph holds an id after the
        batch. On True the bound describes the graph with the batch. False
        means the bound cannot show that the graph passes, not that it fails,
        and leaves the bound unusable.
        """
        if self._max_height > limit:
            return False
        for comp_id, model in batch.items():
            children = possible_children(model)
            if comp_id in children:
                return False
            self._set_children(comp_id, children)
        # Raises the bound of each component above one whose bound rose, until
        # none rises. A cycle would raise its bounds past any limit.
        rising: deque[str] = deque()
        heights = self._heights
        for comp_id in batch:
            height = 0
            for child in self._children[comp_id]:
                below = heights.get(child, 0)
                if held(child) and below >= height:
                    height = below + 1
            heights[comp_id] = height
            rising.append(comp_id)
        while rising:
            comp_id = rising.popleft()
            height = heights[comp_id]
            if height > limit:
                return False
            if height > self._max_height:
                self._max_height = height
            for parent in self._parents.get(comp_id, ()):
                if heights.get(parent, 0) <= height:
                    heights[parent] = height + 1
                    rising.append(parent)
        return True

    def record_batch(
        self,
        batch: Mapping[str, ComponentModel],
        held: Mapping[str, ComponentModel],
    ) -> None:
        """Records the composition references and positions of an admitted batch.

        A new component takes the next position, as it is added at the end of
        the surface.
        """
        for comp_id, model in batch.items():
            self._set_declared(comp_id, declared_children(model))
            if comp_id not in held:
                self._order[comp_id] = self._next_order
                self._next_order += 1
