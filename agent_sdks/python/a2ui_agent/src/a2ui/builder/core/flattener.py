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

"""Tree traversal and flattener converting hierarchical builder nodes to flat wire dicts."""

from __future__ import annotations

from typing import Any, Mapping, Optional, Sequence, Union
from pydantic import BaseModel

from .base_node import ComponentBuilderNode, ExternalComponentBuilderNode
from .id_allocator import IdAllocator


def flatten_component_tree(
    root: Union[ComponentBuilderNode, Sequence[ComponentBuilderNode]],
    root_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Flattens a tree or list of ComponentBuilderNode objects into flat A2UI dictionaries.

    Implements:
    1. Root ID anchor stitching (returned root node inherits root_id).
    2. Sub-component namespacing (f"{root_id}__{local_id}").
    3. Slot boundary preservation (ExternalComponentBuilderNode IDs are untouched).
    4. Reference rewriting for child / children slots.
    """
    flat_list: list[dict[str, Any]] = []

    if isinstance(root, Sequence) and not isinstance(
        root, (str, bytes, ComponentBuilderNode)
    ):
        # List of roots (e.g. table rows)
        for i, item in enumerate(root):
            item_root_id = f"{root_id}_{i}" if root_id else None
            flat_list.extend(flatten_component_tree(item, root_id=item_root_id))
        return flat_list

    if isinstance(root, ExternalComponentBuilderNode):
        # External components are already on surface
        return []

    prefix = root_id or (root.id if root.id else "root")
    allocator = IdAllocator(scope_prefix=prefix)
    id_map: dict[int, str] = {}

    # Phase 1: Assign IDs to all nodes
    def assign_ids(node: ComponentBuilderNode, is_root: bool = False) -> str:
        node_key = id(node)
        if node_key in id_map:
            return id_map[node_key]

        if isinstance(node, ExternalComponentBuilderNode):
            # Preserved verbatim
            assigned = node.id or ""
            id_map[node_key] = assigned
            return assigned

        comp_name = node.component_name or node.component
        if is_root:
            assigned = (
                root_id
                if root_id
                else (node.id if node.id else allocator.allocate(comp_name))
            )
        else:
            assigned = allocator.allocate(comp_name, preferred_id=node.id)

        id_map[node_key] = assigned

        # Recurse through children
        def traverse(val: Any) -> None:
            if isinstance(val, ComponentBuilderNode):
                assign_ids(val, is_root=False)
            elif isinstance(val, Mapping):
                for v in val.values():
                    traverse(v)
            elif isinstance(val, Sequence) and not isinstance(val, (str, bytes)):
                for item in val:
                    traverse(item)
            elif hasattr(val, "template") and isinstance(
                val.template, ComponentBuilderNode
            ):
                traverse(val.template)

        attrs = dict(node.__dict__)
        extra = getattr(node, "__pydantic_extra__", None)
        if extra is not None:
            attrs.update(extra)
        for attr_name, attr_val in attrs.items():
            if attr_name not in ("component_name", "component", "id"):
                traverse(attr_val)

        return assigned

    assign_ids(root, is_root=True)

    # Phase 2: Emit component dictionaries with rewritten references
    visited_nodes: set[int] = set()

    def serialize_node(node: ComponentBuilderNode) -> None:
        node_key = id(node)
        if node_key in visited_nodes or isinstance(node, ExternalComponentBuilderNode):
            return
        visited_nodes.add(node_key)

        comp_name = node.component_name or node.component
        d: dict[str, Any] = {"component": comp_name, "id": id_map[node_key]}

        def traverse_and_serialize(val: Any) -> Any:
            if isinstance(val, ComponentBuilderNode):
                serialize_node(val)
                return id_map[id(val)]
            elif isinstance(val, Mapping):
                return {k: traverse_and_serialize(v) for k, v in val.items()}
            elif isinstance(val, Sequence) and not isinstance(val, (str, bytes)):
                return [traverse_and_serialize(item) for item in val]
            elif hasattr(val, "template") and isinstance(
                val.template, ComponentBuilderNode
            ):
                serialize_node(val.template)
                if isinstance(val, BaseModel):
                    return val.model_dump(exclude_none=True, by_alias=True)
                return val.to_dict() if hasattr(val, "to_dict") else val
            elif isinstance(val, BaseModel):
                return val.model_dump(exclude_none=True, by_alias=True)
            elif hasattr(val, "to_dict"):
                return val.to_dict()
            else:
                return val

        attrs = dict(node.__dict__)
        extra = getattr(node, "__pydantic_extra__", None)
        if extra is not None:
            attrs.update(extra)
        for attr_name, attr_val in attrs.items():
            if attr_name in ("component_name", "component", "id"):
                continue
            if attr_val is None:
                continue
            d[attr_name] = traverse_and_serialize(attr_val)

        flat_list.append(d)

    serialize_node(root)
    return flat_list
