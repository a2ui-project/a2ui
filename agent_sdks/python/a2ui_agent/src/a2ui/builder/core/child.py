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

"""Child slot type and Pydantic serializer for flattening nested builder components."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Annotated, Any, Optional

from pydantic import PlainSerializer, SerializationInfo

from .base_node import ComponentBuilderNode, ComponentRef
from .id_allocator import IdAllocator

FLATTEN_CONTEXT_KEY = "a2ui.flatten"


@dataclass
class FlattenContext:
    """State threaded through Pydantic serialization context during a two-pass flatten."""

    prefix: str
    allocator: Optional[IdAllocator] = None
    reserved: set[str] = field(default_factory=set)
    components: list[dict[str, Any]] = field(default_factory=list)
    assigned: dict[int, str] = field(default_factory=dict)
    visited: set[int] = field(default_factory=set)

    @property
    def scanning(self) -> bool:
        """True while reserving author-supplied IDs, before any ID is allocated."""
        return self.allocator is None

    def as_serialization_context(self) -> dict[str, Any]:
        return {FLATTEN_CONTEXT_KEY: self}


def flatten_context_of(info: SerializationInfo) -> Optional[FlattenContext]:
    """Extracts the active flatten context, or None for a plain ``model_dump``."""
    context = info.context
    if isinstance(context, dict):
        found = context.get(FLATTEN_CONTEXT_KEY)
        if isinstance(found, FlattenContext):
            return found
    return None


def dump_component(
    node: ComponentBuilderNode,
    component_id: str,
    context: FlattenContext,
) -> dict[str, Any]:
    """Dumps a single component, with ``component`` and ``id`` leading the payload."""
    payload = node.model_dump(
        by_alias=True,
        exclude_none=True,
        context=context.as_serialization_context(),
    )
    rest = {k: v for k, v in payload.items() if k not in ("component", "id")}
    return {
        "component": payload.get("component", node.component),
        "id": component_id,
        **rest,
    }


def emit_component(node: ComponentBuilderNode, context: FlattenContext) -> str:
    """Resolves a node to its wire ID, emitting its subtree during the emit pass.

    Children are emitted before their parent, so the flat list is in depth-first
    post-order and every reference points at a component already in the list.
    """
    if isinstance(node, ComponentRef):
        # Slot boundary: the component already exists on the surface and keeps its
        # address. It is referenced, never redefined or namespaced.
        return node.id or ""

    key = id(node)

    if context.scanning:
        if key in context.visited:
            return node.id or ""
        context.visited.add(key)
        if node.id:
            # Reserve both the bare and namespaced forms: an author-supplied ID
            # must never be handed out again by the allocator.
            context.reserved.add(node.id)
            context.reserved.add(f"{context.prefix}__{node.id}")
        node.model_dump(
            by_alias=True,
            exclude_none=True,
            context=context.as_serialization_context(),
        )
        return node.id or ""

    assigned = context.assigned.get(key)
    if assigned is not None:
        # The same object appearing in two slots is one component, referenced twice.
        return assigned

    assert context.allocator is not None
    allocated = context.allocator.allocate(node.component, preferred_id=node.id)
    context.assigned[key] = allocated
    context.components.append(dump_component(node, allocated, context))
    return allocated


def serialize_child(node: ComponentBuilderNode, info: SerializationInfo) -> Any:
    """Serializes a child slot as its component ID during a flatten pass.

    Outside a flatten pass (a bare ``model_dump``) the child is dumped inline
    instead, so builder trees stay inspectable without a surrounding flatten.
    """
    context = flatten_context_of(info)
    if context is None:
        return node.model_dump(by_alias=True, exclude_none=True)
    return emit_component(node, context)


Child = Annotated[
    ComponentBuilderNode,
    PlainSerializer(serialize_child, return_type=Any),
]
"""A nested child component that serializes to its allocated component ID."""
