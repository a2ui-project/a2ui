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

"""Converts hierarchical builder nodes into the flat A2UI wire component list."""

from __future__ import annotations

from typing import Any, Optional, Sequence, Union

from .base_node import ComponentBuilderNode, ComponentRef
from .child import FlattenContext, dump_component, emit_component
from .id_allocator import IdAllocator


def flatten_component_tree(
    root: Union[ComponentBuilderNode, Sequence[ComponentBuilderNode]],
    root_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Flattens a builder subtree (or sequence of roots) into post-order A2UI component dicts."""
    if isinstance(root, Sequence) and not isinstance(
        root, (str, bytes, ComponentBuilderNode)
    ):
        # A list of roots, e.g. table rows: each is flattened into its own scope.
        components: list[dict[str, Any]] = []
        for index, item in enumerate(root):
            item_root_id = f"{root_id}_{index}" if root_id else None
            components.extend(flatten_component_tree(item, root_id=item_root_id))
        return components

    if isinstance(root, ComponentRef):
        # Already on the surface; there is nothing to emit.
        return []

    prefix = root_id or root.id or "root"

    # Pass 1: reserve author-supplied IDs so allocation cannot collide with one.
    scan = FlattenContext(prefix=prefix)
    emit_component(root, scan)
    reserved = scan.reserved
    if root_id:
        reserved.add(root_id)

    # Pass 2: allocate and emit.
    context = FlattenContext(
        prefix=prefix,
        allocator=IdAllocator(scope_prefix=prefix, existing_ids=reserved),
        reserved=reserved,
    )
    assert context.allocator is not None
    resolved_root_id = root_id or root.id or context.allocator.allocate(root.component)
    context.assigned[id(root)] = resolved_root_id

    # dump_component emits the root's descendants first, so the root lands last.
    payload = dump_component(root, resolved_root_id, context)
    context.components.append(payload)
    return context.components
