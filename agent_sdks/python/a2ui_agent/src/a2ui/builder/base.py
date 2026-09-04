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
from typing import Any, Mapping, Optional, Sequence, TypeAlias, Union
from pydantic import BaseModel, ConfigDict, Field


class ComponentBuilderNode(BaseModel):
    """Base class for all generated A2UI component builders."""

    model_config = ConfigDict(
        extra="forbid",
        arbitrary_types_allowed=True,
        populate_by_name=True,
        validate_assignment=True,
    )

    component: str = ""
    id: Optional[str] = None

    @property
    def component_name(self) -> str:
        return self.component

    @component_name.setter
    def component_name(self, value: str) -> None:
        self.component = value

    def to_dict(self) -> dict[str, Any]:
        """Serializes this component into an A2UI wire format dictionary."""
        d: dict[str, Any] = {"component": self.component_name or self.component}
        if self.id is not None:
            d["id"] = self.id
        return d

    def to_components(self, prefix: Optional[str] = None) -> list[dict[str, Any]]:
        """Flattens this component subtree into A2UI wire-format dictionaries."""
        return flatten_component_tree(self, root_id=prefix)


class ExternalComponentBuilderNode(ComponentBuilderNode):
    """Represents a component defined outside the current macro (slot reference).

    External components are referenced strictly by ID. They are never assigned
    namespaced IDs during macro expansion, preserving outer component addresses.
    """

    def __init__(self, id: str, **kwargs: Any):
        super().__init__(id=id, component="ExternalComponent", **kwargs)

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id}


# Ergonomic alias for referencing external/existing components
ComponentRef = ExternalComponentBuilderNode


class DataBinding(BaseModel):
    """A two-way binding to a path in the client data model."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str

    def to_dict(self) -> dict[str, Any]:
        norm_path = self.path if self.path.startswith("/") else f"/{self.path}"
        return {"path": norm_path}


def bind(path: str) -> DataBinding:
    """Ergonomic helper to construct a DataBinding."""
    return DataBinding(path=path)


class AccessibilityAttributes(BaseModel):
    """Attributes to enhance accessibility when using assistive technologies."""

    model_config = ConfigDict(extra="forbid")

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


class FunctionCall(BaseModel):
    """Invocation of a client-side catalog function."""

    model_config = ConfigDict(extra="forbid")

    call: str
    args: dict[str, Any] = Field(default_factory=dict)
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


class Action(BaseModel):
    """An interaction handler dispatching a server event or client function."""

    model_config = ConfigDict(extra="forbid")

    event: Optional[Union[str, dict[str, Any]]] = None
    function: Optional[FunctionCall] = None
    context: Optional[dict[str, Any]] = None

    def to_dict(self) -> dict[str, Any]:
        if self.event is not None:
            if isinstance(self.event, str):
                d: dict[str, Any] = {"name": self.event}
                if self.context:
                    d["context"] = self.context
                return {"event": d}
            elif isinstance(self.event, dict):
                ev = dict(self.event)
                if self.context and "context" not in ev:
                    ev["context"] = self.context
                if "name" in ev:
                    return {"event": ev}
                return {"event": {"name": ev.get("name", "action"), **ev}}
            return {"event": self.event}
        if self.function is not None:
            return {"function": self.function.to_dict()}
        return {}


class CheckRule(BaseModel):
    """A client-side validation check (condition + error message)."""

    model_config = ConfigDict(extra="forbid")

    condition: FunctionCall
    message: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "condition": self.condition.to_dict(),
            "message": self.message,
        }


class DynamicChildList(BaseModel):
    """Generates dynamic children from a collection in the data model."""

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

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
            elif isinstance(val, DynamicChildList):
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
            elif isinstance(val, DynamicChildList):
                if isinstance(val.template, ComponentBuilderNode):
                    serialize_node(val.template)
                return val.to_dict()
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


class ComponentTree:
    """An in-memory hierarchy of components, containing a primary root and any unlinked subtrees."""

    def __init__(
        self,
        root: ComponentBuilderNode,
        unlinked_roots: Sequence[ComponentBuilderNode] | None = None,
        surface_id: str | None = None,
    ):
        self.root = root
        self.unlinked_roots = list(unlinked_roots or [])
        self.surface_id = surface_id

    def to_components(self) -> list[dict[str, Any]]:
        """Serializes the primary tree and all unlinked subtrees into flat component dicts."""
        comps = flatten_component_tree(self.root, root_id=self.root.id or "root")
        for sub_tree in self.unlinked_roots:
            comps.extend(flatten_component_tree(sub_tree, root_id=sub_tree.id or "sub"))
        return comps

    def to_json(self, indent: Optional[int] = None) -> str:
        """Serializes the component list into a JSON string."""
        return json.dumps(self.to_components(), indent=indent)

    def to_update(self, surface_id: str | None = None) -> dict[str, Any]:
        """Packages the tree into an updateComponents envelope for incremental updates."""
        target_id = surface_id or self.surface_id or "main"
        return {
            "updateComponents": {
                "surfaceId": target_id,
                "components": self.to_components(),
            }
        }

    def to_surface(
        self,
        surface_id: str | None = None,
        catalog_id: str | None = None,
        data_model: Optional[dict[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        """Packages the tree into createSurface, updateComponents, and optional updateDataModel envelopes."""
        target_id = surface_id or self.surface_id or "main"
        create_env: dict[str, Any] = {"createSurface": {"surfaceId": target_id}}
        if catalog_id:
            create_env["createSurface"]["catalogId"] = catalog_id
        messages: list[dict[str, Any]] = [create_env, self.to_update(target_id)]
        if data_model:
            for path, val in data_model.items():
                norm_path = path if path.startswith("/") else f"/{path}"
                messages.append({
                    "updateDataModel": {
                        "surfaceId": target_id,
                        "path": norm_path,
                        "value": val,
                    }
                })
        return messages

    def prune_unlinked(self) -> None:
        """Clears all unlinked subtrees from the container."""
        self.unlinked_roots.clear()


def create_surface(
    surface_id: str,
    root: ComponentBuilderNode,
    *,
    catalog_id: str | None = None,
    data_model: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    """Creates messages to establish a new surface (createSurface + updateComponents + optional updateDataModel)."""
    return ComponentTree(root=root).to_surface(
        surface_id=surface_id, catalog_id=catalog_id, data_model=data_model
    )


def update_components(
    surface_id: str,
    root: ComponentBuilderNode,
) -> list[dict[str, Any]]:
    """Creates an incremental surface update message (updateComponents only)."""
    return [ComponentTree(root=root).to_update(surface_id=surface_id)]


# ---------------------------------------------------------------------------
# Canonical Protocol Type Aliases
# ---------------------------------------------------------------------------
DynamicString = Union[str, DataBinding, FunctionCall]
DynamicNumber = Union[int, float, DataBinding, FunctionCall]
DynamicBoolean = Union[bool, DataBinding, FunctionCall]
DynamicStringList = Union[Sequence[str], DataBinding, FunctionCall]
DynamicValue = Union[Any, DataBinding, FunctionCall]

Slot: TypeAlias = ComponentBuilderNode
SlotList: TypeAlias = Sequence[Slot]
Child = Slot
ChildList = Union[Sequence[ComponentBuilderNode], DynamicChildList]
