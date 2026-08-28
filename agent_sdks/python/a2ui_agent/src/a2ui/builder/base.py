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

"""Base runtime classes and tree flattener for typesafe A2UI builders."""

import json
from dataclasses import dataclass, field
from typing import Any, Mapping, Optional, Sequence, Union


@dataclass(kw_only=True)
class ComponentBuilderNode:
    """Base class for all generated A2UI component builders."""

    id: Optional[str] = None
    component_name: str = field(default="", init=False)

    def to_dict(self) -> dict[str, Any]:
        """Serializes this component into an A2UI wire format dictionary."""
        d: dict[str, Any] = {"component": self.component_name}
        if self.id is not None:
            d["id"] = self.id
        return d


class ExternalComponentBuilderNode(ComponentBuilderNode):
    """Represents a component defined outside the current macro (slot reference).

    External components are referenced strictly by ID. They are never assigned
    namespaced IDs during macro expansion, preserving outer component addresses.
    """

    def __init__(self, id: str):
        super().__init__(id=id)
        self.component_name = "ExternalComponent"

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id}


# Ergonomic alias for referencing external/existing components
ComponentRef = ExternalComponentBuilderNode


@dataclass(frozen=True)
class DataBinding:
    """A two-way binding to a path in the client data model."""

    path: str

    def to_dict(self) -> dict[str, Any]:
        norm_path = self.path if self.path.startswith("/") else f"/{self.path}"
        return {"path": norm_path}


def bind(path: str) -> DataBinding:
    """Ergonomic helper to construct a DataBinding."""
    return DataBinding(path=path)


@dataclass(kw_only=True)
class AccessibilityAttributes:
    """Attributes to enhance accessibility when using assistive technologies."""

    label: Optional[Union[str, DataBinding]] = None
    description: Optional[Union[str, DataBinding]] = None
    live: Optional[str] = None
    hidden: Optional[Union[bool, DataBinding]] = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {}
        if self.label is not None:
            d["label"] = (
                self.label.to_dict() if hasattr(self.label, "to_dict") else self.label
            )
        if self.description is not None:
            d["description"] = (
                self.description.to_dict()
                if hasattr(self.description, "to_dict")
                else self.description
            )
        if self.live is not None:
            d["live"] = self.live
        if self.hidden is not None:
            d["hidden"] = (
                self.hidden.to_dict()
                if hasattr(self.hidden, "to_dict")
                else self.hidden
            )
        return d


@dataclass(kw_only=True)
class FunctionCall:
    """Invocation of a client-side catalog function."""

    call: str
    args: dict[str, Any] = field(default_factory=dict)
    call_id: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "call": self.call,
            "args": {
                k: v.to_dict() if hasattr(v, "to_dict") else v
                for k, v in self.args.items()
                if v is not None
            },
        }
        if self.call_id is not None:
            d["callId"] = self.call_id
        return d


@dataclass(kw_only=True)
class Action:
    """An interaction handler dispatching a server event or client function."""

    event: Optional[Union[str, dict[str, Any]]] = None
    function: Optional[FunctionCall] = None

    def to_dict(self) -> dict[str, Any]:
        if self.event is not None:
            if isinstance(self.event, str):
                return {"event": {"name": self.event}}
            elif isinstance(self.event, dict):
                if "name" in self.event:
                    return {"event": self.event}
                return {"event": {"name": self.event.get("name", "action")}}
            return {"event": self.event}
        if self.function is not None:
            return {"function": self.function.to_dict()}
        return {}


@dataclass(kw_only=True)
class CheckRule:
    """A client-side validation check (condition + error message)."""

    condition: FunctionCall
    message: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "condition": self.condition.to_dict(),
            "message": self.message,
        }


@dataclass(kw_only=True)
class DynamicChildList:
    """Generates dynamic children from a collection in the data model."""

    data_model_path: str
    template: ComponentBuilderNode

    def to_dict(self) -> dict[str, Any]:
        norm_path = (
            self.data_model_path
            if self.data_model_path.startswith("/")
            else f"/{self.data_model_path}"
        )
        return {
            "dataModelPath": norm_path,
            "template": self.template.to_dict(),
        }


class IdAllocator:
    """Deterministic allocator generating scoped component IDs."""

    def __init__(self, scope_prefix: str = "c"):
        self.scope_prefix = scope_prefix
        self.counters: dict[str, int] = {}

    def allocate(self, component_name: str, preferred_id: Optional[str] = None) -> str:
        if preferred_id:
            return f"{self.scope_prefix}__{preferred_id}"
        prefix = component_name.lower()
        self.counters[prefix] = self.counters.get(prefix, 0) + 1
        return f"{self.scope_prefix}__{prefix}_{self.counters[prefix]}"


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

        if is_root:
            assigned = (
                root_id
                if root_id
                else (node.id if node.id else allocator.allocate(node.component_name))
            )
        else:
            assigned = allocator.allocate(node.component_name, preferred_id=node.id)

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
            elif isinstance(val, DynamicChildList):
                traverse(val.template)

        for attr_name, attr_val in vars(node).items():
            if attr_name not in ("component_name", "id"):
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

        d: dict[str, Any] = {"component": node.component_name, "id": id_map[node_key]}

        def traverse_and_serialize(val: Any) -> Any:
            if isinstance(val, ComponentBuilderNode):
                serialize_node(val)
                return id_map[id(val)]
            elif isinstance(val, Mapping):
                return {k: traverse_and_serialize(v) for k, v in val.items()}
            elif isinstance(val, Sequence) and not isinstance(val, (str, bytes)):
                return [traverse_and_serialize(item) for item in val]
            elif isinstance(val, DynamicChildList):
                if isinstance(val.template, ComponentBuilderNode):
                    serialize_node(val.template)
                return val.to_dict()
            elif hasattr(val, "to_dict"):
                return val.to_dict()
            else:
                return val

        for attr_name, attr_val in vars(node).items():
            if attr_name in ("component_name", "id"):
                continue
            if attr_val is None:
                continue
            d[attr_name] = traverse_and_serialize(attr_val)

        flat_list.append(d)

    serialize_node(root)
    return flat_list


@dataclass(kw_only=True)
class Surface:
    """Represents a complete A2UI surface for payload serialization and message dispatch."""

    surface_id: str
    root: ComponentBuilderNode
    catalog_id: Optional[str] = None
    data_model: Optional[dict[str, Any]] = None

    def to_dict(self) -> dict[str, Any]:
        """Serializes the surface into standard A2UI dictionary format."""
        components = flatten_component_tree(self.root, root_id=self.root.id or "root")
        d: dict[str, Any] = {
            "surfaceId": self.surface_id,
            "components": components,
        }
        if self.catalog_id is not None:
            d["catalogId"] = self.catalog_id
        if self.data_model is not None:
            d["dataModel"] = self.data_model
        return d

    def to_json(self, indent: Optional[int] = None) -> str:
        """Serializes the surface into a JSON string."""
        return json.dumps(self.to_dict(), indent=indent)

    def to_messages(self, spec_version: str = "v0.9.1") -> list[dict[str, Any]]:
        """Emits standard A2UI protocol messages for surface rendering."""
        components = flatten_component_tree(self.root, root_id=self.root.id or "root")
        surface_update: dict[str, Any] = {
            "surfaceId": self.surface_id,
            "components": components,
        }
        if self.catalog_id is not None:
            surface_update["catalogId"] = self.catalog_id
        messages: list[dict[str, Any]] = [{"surfaceUpdate": surface_update}]
        if self.data_model:
            for path, val in self.data_model.items():
                norm_path = path if path.startswith("/") else f"/{path}"
                messages.append({
                    "dataModelUpdate": {
                        "surfaceId": self.surface_id,
                        "path": norm_path,
                        "value": val,
                    }
                })
        return messages


# ---------------------------------------------------------------------------
# Canonical Protocol Type Aliases
# ---------------------------------------------------------------------------
DynamicString = Union[str, DataBinding, FunctionCall]
DynamicNumber = Union[int, float, DataBinding, FunctionCall]
DynamicBoolean = Union[bool, DataBinding, FunctionCall]
DynamicStringList = Union[Sequence[str], DataBinding, FunctionCall]
DynamicValue = Union[Any, DataBinding, FunctionCall]
Child = Union[ComponentBuilderNode, str]
ChildList = Union[Sequence[Union[ComponentBuilderNode, str]], DynamicChildList]
