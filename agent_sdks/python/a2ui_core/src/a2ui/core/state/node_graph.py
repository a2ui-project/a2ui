# Copyright 2026 Google LLC
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

import copy
from typing import Any, Dict, List, Optional, TYPE_CHECKING
from ..common.events import Signal, Subscription
from .component_node import ComponentNode
from .component_model import ComponentModel
from .surface_model import SurfaceModel
from ..catalog import Catalog
from ..validating import CatalogSchemaValidator

if TYPE_CHECKING:
    from ..rendering.generic_binder import GenericBinder


class NodeGraph:
    """Manages the lifecycle and resolution of living ComponentNodes for a surface."""

    def __init__(self, surface: SurfaceModel) -> None:
        self.surface = surface

        self.rootNode: Signal[Optional[ComponentNode]] = Signal(None)
        self.active_nodes: Dict[str, ComponentNode] = {}
        self.binders: Dict[str, "GenericBinder"] = {}

        self._comp_created_sub = self.surface.components_model.on_created.subscribe(
            self._on_component_created
        )
        self._comp_deleted_sub = self.surface.components_model.on_deleted.subscribe(
            self._on_component_deleted
        )

        # Reactively bootstrap the root node if it already exists
        if self.surface.components_model.get("root"):
            self.rootNode.value = self.get_or_create_node("root", "/")

    def to_dict(self) -> Optional[Dict[str, Any]]:
        """Returns the serialized dict layout of the root component node tree."""
        root_node = self.rootNode.value
        return root_node.to_dict() if root_node else None

    def get_or_create_node(self, component_id: str, data_path: str) -> ComponentNode:
        """Gets or reactively creates a living Node for a component ID at a given data path."""
        # Calculate unique instance_id
        if data_path == "/":
            instance_id = component_id
        else:
            norm_path = data_path.rstrip("/") if data_path != "/" else "/"
            instance_id = f"{component_id}-[{norm_path}]"

        # Return existing cached node
        if instance_id in self.active_nodes:
            return self.active_nodes[instance_id]

        def collect_nodes(value: Any) -> set[ComponentNode]:
            nodes = set()
            if isinstance(value, ComponentNode):
                nodes.add(value)
            elif isinstance(value, list):
                for item in value:
                    nodes.update(collect_nodes(item))
            elif isinstance(value, dict):
                for v in value.values():
                    nodes.update(collect_nodes(v))
            elif isinstance(value, Signal):
                nodes.update(collect_nodes(value.value))
            return nodes

        component_model = self.surface.components_model.get(component_id)
        props_signal: Signal[Dict[str, Any]] = Signal({})

        if component_model:
            node = ComponentNode(
                instance_id, component_id, component_model.type, data_path, props_signal
            )
        else:
            # Placeholder for progressive rendering
            node = ComponentNode(
                instance_id, component_id, "Placeholder", data_path, props_signal
            )

        self.active_nodes[instance_id] = node

        # If placeholder, it has no properties. It cleans itself from cache on disposal.
        if not component_model:

            def cleanup_placeholder() -> None:
                self.active_nodes.pop(instance_id, None)

            node.add_cleanup(cleanup_placeholder)
            return node

        # Set up reactive context and binder
        from ..rendering.data_context import DataContext
        from ..rendering.component_context import ComponentContext
        from ..rendering.generic_binder import GenericBinder

        data_context = DataContext(
            surface=self.surface,
            path=data_path,
        )
        comp_context = ComponentContext(
            component_model=component_model,
            data_context=data_context,
            surface_components=self.surface.components_model,
            dispatch_action_callback=self.surface.dispatch_action,
        )

        binder = GenericBinder(comp_context)
        self.binders[instance_id] = binder

        child_nodes_by_prop: Dict[str, Any] = {}
        template_subs: Dict[str, Subscription] = {}

        def on_properties_changed(resolved_props: Dict[str, Any]) -> None:
            new_props: Dict[str, Any] = {}
            for k, v in resolved_props.items():
                new_props[k] = v

            current_resolved: Dict[str, Any] = {}

            # Wrap actions into closures
            for k, v in list(new_props.items()):
                if k == "action" or (
                    isinstance(v, dict) and ("event" in v or "functionCall" in v)
                ):
                    action_payload = copy.deepcopy(v)

                    # Create closure wrapping resolution and dispatch
                    def make_action_closure(payload: Any = action_payload) -> None:
                        resolved_payload = data_context.resolve_dynamic_value(payload)
                        self.surface.dispatch_action(resolved_payload, component_id)

                    new_props[k] = make_action_closure

            # Get reference fields from catalog
            ref_map = CatalogSchemaValidator.from_catalog(
                self.surface.catalog
            ).extract_ref_fields()
            comp_type = component_model.type if component_model else ""
            ref_tuple = ref_map.get(comp_type)
            if ref_tuple:
                single_refs, list_refs = ref_tuple[0], ref_tuple[1]
                nested_refs = getattr(ref_tuple, "nested_refs", {})
            else:
                single_refs, list_refs, nested_refs = set(), set(), {}

            # Resolve single-child references
            for single_ref in single_refs:
                if single_ref in new_props:
                    child_id = new_props[single_ref]
                    if isinstance(child_id, str) and child_id:
                        child_node = self.get_or_create_node(child_id, data_path)
                        current_resolved[single_ref] = child_node
                        new_props[single_ref] = child_node
                    elif child_id is None:
                        current_resolved[single_ref] = None
                        new_props[single_ref] = None

            # Resolve list-child references (explicit lists and templated child lists)
            for list_ref in list_refs:
                if list_ref in new_props:
                    val = new_props[list_ref]
                    if isinstance(val, list):
                        child_list: List[Any] = []
                        for item in val:
                            if isinstance(item, str) and item:
                                child_list.append(
                                    self.get_or_create_node(item, data_path)
                                )
                            elif isinstance(item, dict) and "componentId" in item:
                                cid = item["componentId"]
                                if isinstance(cid, str) and cid:
                                    child_list.append(
                                        self.get_or_create_node(cid, data_path)
                                    )
                                else:
                                    child_list.append(item)
                            elif isinstance(item, dict):
                                resolved_item = copy.deepcopy(item)
                                has_resolved = False
                                for sub_key in nested_refs.get(list_ref, {"child"}):
                                    if sub_key in item:
                                        item_child_id = item[sub_key]
                                        if (
                                            isinstance(item_child_id, str)
                                            and item_child_id
                                        ):
                                            resolved_item[sub_key] = (
                                                self.get_or_create_node(
                                                    item_child_id, data_path
                                                )
                                            )
                                            has_resolved = True
                                        elif (
                                            isinstance(item_child_id, dict)
                                            and "componentId" in item_child_id
                                        ):
                                            cid = item_child_id["componentId"]
                                            if isinstance(cid, str) and cid:
                                                resolved_item[sub_key] = (
                                                    self.get_or_create_node(
                                                        cid, data_path
                                                    )
                                                )
                                                has_resolved = True
                                if has_resolved:
                                    child_list.append(resolved_item)
                                else:
                                    child_list.append(item)
                            else:
                                child_list.append(item)
                        current_resolved[list_ref] = child_list
                        new_props[list_ref] = child_list

                    elif (
                        isinstance(val, dict) and "componentId" in val and "path" in val
                    ):
                        template_comp_id = val["componentId"]
                        template_path = data_context.resolve_path(val["path"])

                        if list_ref in template_subs:
                            template_subs[list_ref].unsubscribe()
                            del template_subs[list_ref]

                        spawned_nodes_signal: Signal[List[ComponentNode]] = Signal([])
                        new_props[list_ref] = spawned_nodes_signal

                        def on_array_changed(array_data: Any) -> None:
                            old_spawned = child_nodes_by_prop.get(list_ref, [])
                            if isinstance(old_spawned, list):
                                for old_node in old_spawned:
                                    if isinstance(old_node, ComponentNode):
                                        old_node.dispose()

                            if not isinstance(array_data, list):
                                child_nodes_by_prop[list_ref] = []
                                spawned_nodes_signal.value = []
                                return

                            new_spawned = []
                            for i in range(len(array_data)):
                                scoped_path = f"{template_path}/{i}"
                                node_inst = self.get_or_create_node(
                                    template_comp_id, scoped_path
                                )
                                new_spawned.append(node_inst)

                            child_nodes_by_prop[list_ref] = new_spawned
                            spawned_nodes_signal.value = new_spawned

                        sub = self.surface.data_model.subscribe(
                            template_path, on_array_changed
                        )
                        template_subs[list_ref] = sub
                        on_array_changed(sub.value)
                        current_resolved[list_ref] = spawned_nodes_signal

            # Compare current_resolved with child_nodes_by_prop to dispose of no-longer-referenced nodes

            old_referenced_nodes = collect_nodes(list(child_nodes_by_prop.values()))
            new_referenced_nodes = collect_nodes(list(current_resolved.values()))

            removed_nodes = old_referenced_nodes - new_referenced_nodes
            for removed_node in removed_nodes:
                removed_node.dispose()

            # Update child_nodes_by_prop
            for k, v in current_resolved.items():
                child_nodes_by_prop[k] = v

            node.props.value = new_props

        # Subscribe node to binder updates
        binder_sub = binder.subscribe(on_properties_changed)

        def cleanup_node() -> None:
            binder_sub.unsubscribe()
            binder.dispose()
            for sub in list(template_subs.values()):
                sub.unsubscribe()
            template_subs.clear()

            for child_node in collect_nodes(list(child_nodes_by_prop.values())):
                child_node.dispose()
            child_nodes_by_prop.clear()
            self.binders.pop(instance_id, None)
            self.active_nodes.pop(instance_id, None)

        node.add_cleanup(cleanup_node)
        return node

    def _on_component_created(self, component: ComponentModel) -> None:
        component_id = component.id

        # 1. Identify nodes that need recreation due to a placeholder or type upgrade
        nodes_to_recreate = []
        for node in list(self.active_nodes.values()):
            if node.component_id == component_id:
                if node.type == "Placeholder" or node.type != component.type:
                    nodes_to_recreate.append(node)

        # 2. Recreate identified nodes
        for old_node in nodes_to_recreate:
            data_path = old_node.data_path
            old_node.dispose()
            self.get_or_create_node(component_id, data_path)

        # 3. Update rootNode if root component was created
        if component_id == "root" and not self.rootNode.value:
            self.rootNode.value = self.get_or_create_node("root", "/")

        # 4. Rebuild references on any parents referencing this component
        for active_node in list(self.active_nodes.values()):
            if active_node.component_id == component_id:
                continue
            binder = self.binders.get(active_node.instance_id)
            if binder:
                raw_props = binder.context.component_model.properties
                if self._references_component(raw_props, component_id):
                    binder._rebuild_all_bindings()

    def _on_component_deleted(self, component_id: str) -> None:
        # 1. Dispose all active nodes for the component
        nodes_to_delete = [
            n for n in self.active_nodes.values() if n.component_id == component_id
        ]
        for node in nodes_to_delete:
            node.dispose()

        # 2. Nullify rootNode if root was deleted
        if component_id == "root":
            self.rootNode.value = None

        # 3. Rebuild references on other parents referencing this component
        for active_node in list(self.active_nodes.values()):
            binder = self.binders.get(active_node.instance_id)
            if binder:
                raw_props = binder.context.component_model.properties
                if self._references_component(raw_props, component_id):
                    binder._rebuild_all_bindings()

    def _references_component(self, raw_props: Any, target_id: str) -> bool:
        if raw_props == target_id:
            return True
        if isinstance(raw_props, dict):
            return any(
                self._references_component(v, target_id) for v in raw_props.values()
            )
        if isinstance(raw_props, list):
            return any(
                self._references_component(item, target_id) for item in raw_props
            )
        return False

    def dispose(self) -> None:
        if hasattr(self, "_comp_created_sub") and self._comp_created_sub:
            self._comp_created_sub.unsubscribe()
        if hasattr(self, "_comp_deleted_sub") and self._comp_deleted_sub:
            self._comp_deleted_sub.unsubscribe()

        for node in list(self.active_nodes.values()):
            node.dispose()
        self.active_nodes.clear()
        self.rootNode.value = None
