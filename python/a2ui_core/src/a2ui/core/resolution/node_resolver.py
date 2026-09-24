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

import copy
from typing import Any, Generic, TYPE_CHECKING
from ..catalog.catalog import Catalog, TComponent, TFunction
from ..common.events import Signal, Subscription
from ..exceptions import A2uiStateError
from .component_node import ComponentNode
from ..state.component_model import (
    ComponentModel,
    V0_8_LIST_REF_FIELDS,
    is_v0_8_heuristic_child_prop_key,
)
from ..state.surface_model import SurfaceModel

if TYPE_CHECKING:
    from .data_context import DataContext
    from .generic_binder import GenericBinder


def _collect_nodes(value: Any) -> set[ComponentNode]:
    """Recursively extracts all ComponentNode instances from a resolved property value."""
    nodes: set[ComponentNode] = set()
    if isinstance(value, ComponentNode):
        nodes.add(value)
    elif isinstance(value, list):
        for item in value:
            nodes.update(_collect_nodes(item))
    elif isinstance(value, dict):
        for v in value.values():
            nodes.update(_collect_nodes(v))
    elif isinstance(value, Signal):
        nodes.update(_collect_nodes(value.value))
    return nodes


def _is_action_prop(key: str, val: Any) -> bool:
    """Checks if a component property represents an interactive action definition."""
    if key == "action":
        return True
    return isinstance(val, dict) and ("event" in val or "functionCall" in val)


def _wrap_action_closures(
    new_props: dict[str, Any],
    data_context: "DataContext[Any, Any]",
    surface: SurfaceModel[Any, Any],
    component_id: str,
) -> None:
    """Replaces action definition dicts in new_props with bound execution closures."""
    for k, v in list(new_props.items()):
        if _is_action_prop(k, v):
            action_payload = copy.deepcopy(v)

            def make_action_closure(payload: Any = action_payload) -> None:
                resolved_payload = data_context.resolve_dynamic_value(payload)
                surface.dispatch_action(resolved_payload, component_id)

            new_props[k] = make_action_closure


def _infer_v08_ref_specs(
    new_props: dict[str, Any], known_ids: set[str]
) -> tuple[set[str], set[str]]:
    """Infers single and list child reference keys for legacy v0.8 schemas."""
    single_refs: set[str] = set()
    list_refs: set[str] = set()
    for key, val in list(new_props.items()):
        if key in ("id", "component"):
            continue
        if not is_v0_8_heuristic_child_prop_key(key, val, known_ids):
            continue
        is_list_or_tpl = (
            key in V0_8_LIST_REF_FIELDS
            or isinstance(val, list)
            or (isinstance(val, dict) and "componentId" in val and "path" in val)
        )
        if is_list_or_tpl:
            list_refs.add(key)
        else:
            single_refs.add(key)
    return single_refs, list_refs


def _extract_ref_specs(
    component_model: ComponentModel,
    surface: SurfaceModel[Any, Any],
    new_props: dict[str, Any],
) -> tuple[set[str], set[str], dict[str, Any]]:
    """Resolves single_refs, list_refs, and nested_refs for a component model."""
    cat = component_model.catalog or surface.default_catalog
    ref_spec = (
        cat.get_component_ref_spec(component_model.type)
        if cat is not None and hasattr(cat, "get_component_ref_spec")
        else None
    )
    if ref_spec is not None and (ref_spec.single_refs or ref_spec.list_refs):
        return (
            set(ref_spec.single_refs),
            set(ref_spec.list_refs),
            dict(ref_spec.nested_refs),
        )
    known_ids = set(surface.components_model.get_all().keys())
    single_refs, list_refs = _infer_v08_ref_specs(new_props, known_ids)
    return single_refs, list_refs, {}


def _cleanup_stale_template_subs(
    template_subs: dict[str, Subscription], active_template_refs: set[str]
) -> None:
    """Unsubscribes and removes any template subscriptions no longer active in props."""
    for stale_ref in list(template_subs.keys()):
        if stale_ref not in active_template_refs:
            template_subs[stale_ref].unsubscribe()
            del template_subs[stale_ref]


class NodeResolver(Generic[TComponent, TFunction]):
    """Manages the lifecycle and resolution of living ComponentNodes for a surface."""

    def __init__(
        self,
        surface: SurfaceModel[TComponent, TFunction],
        catalog: Catalog[TComponent, TFunction] | None = None,
    ) -> None:
        if catalog is not None and catalog is not surface.default_catalog:
            raise A2uiStateError(
                "NodeResolver catalog must match surface.default_catalog."
            )
        self.surface = surface
        self._root_id: str = getattr(surface, "root_id", None) or "root"

        self.rootNode: Signal[ComponentNode | None] = Signal(None)
        self.active_nodes: dict[str, ComponentNode] = {}
        self.binders: dict[str, "GenericBinder"] = {}

        self._comp_created_sub = self.surface.components_model.on_created.subscribe(
            self._on_component_created
        )
        self._comp_deleted_sub = self.surface.components_model.on_deleted.subscribe(
            self._on_component_deleted
        )

        # Reactively bootstrap the root node if it already exists
        if self.surface.components_model.get(self._root_id):
            self.rootNode.value = self.get_or_create_node(self._root_id, "/")

    def to_dict(self) -> dict[str, Any] | None:
        """Returns the serialized dict layout of the root component node tree."""
        root_node = self.rootNode.value
        return root_node.to_dict() if root_node else None

    def _resolve_single_refs(
        self,
        single_refs: set[str],
        new_props: dict[str, Any],
        current_resolved: dict[str, Any],
        data_path: str,
    ) -> None:
        """Resolves single-child component ID references into ComponentNodes."""
        for single_ref in single_refs:
            if single_ref not in new_props:
                continue
            child_id = new_props[single_ref]
            if isinstance(child_id, str) and child_id:
                child_node = self.get_or_create_node(child_id, data_path)
                current_resolved[single_ref] = child_node
                new_props[single_ref] = child_node
            elif child_id is None:
                current_resolved[single_ref] = None
                new_props[single_ref] = None

    def _resolve_nested_dict_item(
        self, item: dict[str, Any], sub_keys: set[str], data_path: str
    ) -> dict[str, Any]:
        """Resolves nested child references inside a dictionary list item (such as tabs)."""
        resolved_item = copy.deepcopy(item)
        has_resolved = False
        for sub_key in sub_keys:
            if sub_key not in item:
                continue
            item_child = item[sub_key]
            cid = (
                item_child
                if isinstance(item_child, str)
                else (
                    item_child.get("componentId")
                    if isinstance(item_child, dict)
                    else None
                )
            )
            if isinstance(cid, str) and cid:
                resolved_item[sub_key] = self.get_or_create_node(cid, data_path)
                has_resolved = True
        return resolved_item if has_resolved else item

    def _resolve_list_item(self, item: Any, sub_keys: set[str], data_path: str) -> Any:
        """Resolves a single item within a static list-child reference."""
        if isinstance(item, str) and item:
            return self.get_or_create_node(item, data_path)
        if isinstance(item, dict) and "componentId" in item:
            cid = item["componentId"]
            return (
                self.get_or_create_node(cid, data_path)
                if isinstance(cid, str) and cid
                else item
            )
        if isinstance(item, dict):
            return self._resolve_nested_dict_item(item, sub_keys, data_path)
        return item

    def _resolve_explicit_child_list(
        self, val: list[Any], sub_keys: set[str], data_path: str
    ) -> list[Any]:
        """Resolves an explicit list of child component references."""
        return [self._resolve_list_item(item, sub_keys, data_path) for item in val]

    def _refresh_disposed_template_nodes(
        self, existing_nodes: list[Any], template_comp_id: str
    ) -> list[Any] | None:
        """Re-creates any template child nodes that were disposed due to component upgrades."""
        if not any(isinstance(n, ComponentNode) and n.disposed for n in existing_nodes):
            return None
        return [
            self.get_or_create_node(template_comp_id, n.data_path)
            if isinstance(n, ComponentNode) and n.disposed
            else n
            for n in existing_nodes
        ]

    def _reconcile_spawned_nodes(
        self,
        old_spawned: list[Any],
        array_data: list[Any],
        tpl_comp_id: str,
        tpl_path: str,
    ) -> list[ComponentNode]:
        """Reconciles template child nodes against updated array data in-place."""
        if len(old_spawned) > len(array_data):
            for old_node in old_spawned[len(array_data) :]:
                if isinstance(old_node, ComponentNode):
                    old_node.dispose()

        base_tpl_path = tpl_path.rstrip("/")
        new_spawned: list[ComponentNode] = []
        for i in range(len(array_data)):
            scoped_path = f"{base_tpl_path}/{i}"
            existing = old_spawned[i] if i < len(old_spawned) else None
            if (
                isinstance(existing, ComponentNode)
                and not existing.disposed
                and existing.component_id == tpl_comp_id
                and existing.data_path == scoped_path
            ):
                new_spawned.append(existing)
            else:
                if isinstance(existing, ComponentNode) and not existing.disposed:
                    existing.dispose()
                new_spawned.append(self.get_or_create_node(tpl_comp_id, scoped_path))
        return new_spawned

    def _apply_template_array_change(
        self,
        array_data: Any,
        list_ref: str,
        tpl_comp_id: str,
        tpl_path: str,
        sig: Signal[list[ComponentNode]],
        child_nodes_by_prop: dict[str, Any],
    ) -> None:
        """Applies a DataModel array change to a template child list Signal."""
        raw_old = child_nodes_by_prop.get(f"{list_ref}_nodes", [])
        old_spawned = raw_old if isinstance(raw_old, list) else []
        if not isinstance(array_data, list):
            for old_node in old_spawned:
                if isinstance(old_node, ComponentNode):
                    old_node.dispose()
            child_nodes_by_prop[f"{list_ref}_nodes"] = []
            sig.value = []
            return

        new_spawned = self._reconcile_spawned_nodes(
            old_spawned, array_data, tpl_comp_id, tpl_path
        )
        child_nodes_by_prop[f"{list_ref}_nodes"] = new_spawned
        sig.value = new_spawned

    def _resolve_template_child_list(
        self,
        list_ref: str,
        val: dict[str, Any],
        data_context: "DataContext[Any, Any]",
        child_nodes_by_prop: dict[str, Any],
        template_subs: dict[str, Subscription],
        new_props: dict[str, Any],
        current_resolved: dict[str, Any],
    ) -> None:
        """Resolves or reuses a reactive template child list Signal and subscription."""
        template_comp_id = val["componentId"]
        template_path = data_context.resolve_path(val["path"])

        existing_def = child_nodes_by_prop.get(f"{list_ref}_def")
        if existing_def == val and f"{list_ref}_signal" in child_nodes_by_prop:
            sig = child_nodes_by_prop[f"{list_ref}_signal"]
            existing_nodes = child_nodes_by_prop.get(f"{list_ref}_nodes", [])
            refreshed = self._refresh_disposed_template_nodes(
                existing_nodes, template_comp_id
            )
            if refreshed is not None:
                child_nodes_by_prop[f"{list_ref}_nodes"] = refreshed
                sig.value = refreshed
            new_props[list_ref] = sig
            current_resolved[list_ref] = sig
            current_resolved[f"{list_ref}_signal"] = sig
            current_resolved[f"{list_ref}_def"] = val
            current_resolved[f"{list_ref}_nodes"] = child_nodes_by_prop.get(
                f"{list_ref}_nodes", []
            )
            return

        current_resolved[f"{list_ref}_def"] = val
        if list_ref in template_subs:
            template_subs[list_ref].unsubscribe()
            del template_subs[list_ref]

        spawned_nodes_signal: Signal[list[ComponentNode]] = Signal([])
        new_props[list_ref] = spawned_nodes_signal
        current_resolved[f"{list_ref}_signal"] = spawned_nodes_signal

        def on_array_changed(array_data: Any) -> None:
            self._apply_template_array_change(
                array_data,
                list_ref,
                template_comp_id,
                template_path,
                spawned_nodes_signal,
                child_nodes_by_prop,
            )

        sub = self.surface.data_model.subscribe(template_path, on_array_changed)
        template_subs[list_ref] = sub
        on_array_changed(sub.value)
        current_resolved[list_ref] = spawned_nodes_signal
        current_resolved[f"{list_ref}_nodes"] = child_nodes_by_prop.get(
            f"{list_ref}_nodes", []
        )

    def _resolve_list_refs(
        self,
        list_refs: set[str],
        nested_refs: dict[str, Any],
        data_path: str,
        data_context: "DataContext[Any, Any]",
        child_nodes_by_prop: dict[str, Any],
        template_subs: dict[str, Subscription],
        new_props: dict[str, Any],
        current_resolved: dict[str, Any],
    ) -> None:
        """Resolves all static and templated list-child references on a component."""
        active_template_refs: set[str] = set()
        for list_ref in list_refs:
            if list_ref not in new_props:
                continue
            val = new_props[list_ref]
            if isinstance(val, list):
                sub_keys = set(nested_refs.get(list_ref, {"child"}))
                child_list = self._resolve_explicit_child_list(val, sub_keys, data_path)
                current_resolved[list_ref] = child_list
                new_props[list_ref] = child_list
            elif isinstance(val, dict) and "componentId" in val and "path" in val:
                active_template_refs.add(list_ref)
                self._resolve_template_child_list(
                    list_ref,
                    val,
                    data_context,
                    child_nodes_by_prop,
                    template_subs,
                    new_props,
                    current_resolved,
                )
        _cleanup_stale_template_subs(template_subs, active_template_refs)

    def get_or_create_node(self, component_id: str, data_path: str) -> ComponentNode:
        """Gets or reactively creates a living Node for a component ID at a given data path."""
        norm_path = data_path.rstrip("/") if data_path != "/" else "/"
        instance_id = (
            component_id if data_path == "/" else f"{component_id}-[{norm_path}]"
        )
        if instance_id in self.active_nodes:
            return self.active_nodes[instance_id]

        component_model = self.surface.components_model.get(component_id)
        props_signal: Signal[dict[str, Any]] = Signal({})
        node_type = component_model.type if component_model else "Placeholder"
        node = ComponentNode(
            instance_id, component_id, node_type, data_path, props_signal
        )
        self.active_nodes[instance_id] = node

        if not component_model:

            def _cleanup_placeholder() -> None:
                self.active_nodes.pop(instance_id, None)

            node.add_cleanup(_cleanup_placeholder)
            return node

        from .data_context import DataContext
        from .component_context import ComponentContext
        from .generic_binder import GenericBinder

        data_context = DataContext(surface=self.surface, path=data_path)
        comp_context = ComponentContext(
            component_model=component_model,
            data_context=data_context,
            surface_components=self.surface.components_model,
            dispatch_action_callback=self.surface.dispatch_action,
        )
        binder = GenericBinder(comp_context)
        self.binders[instance_id] = binder

        child_nodes_by_prop: dict[str, Any] = {}
        template_subs: dict[str, Subscription] = {}

        def on_properties_changed(resolved_props: dict[str, Any]) -> None:
            new_props = dict(resolved_props)
            current_resolved: dict[str, Any] = {}

            _wrap_action_closures(new_props, data_context, self.surface, component_id)
            single_refs, list_refs, nested_refs = _extract_ref_specs(
                component_model, self.surface, new_props
            )
            self._resolve_single_refs(
                single_refs, new_props, current_resolved, data_path
            )
            self._resolve_list_refs(
                list_refs,
                nested_refs,
                data_path,
                data_context,
                child_nodes_by_prop,
                template_subs,
                new_props,
                current_resolved,
            )

            old_referenced_nodes = _collect_nodes(list(child_nodes_by_prop.values()))
            new_referenced_nodes = _collect_nodes(list(current_resolved.values()))
            for removed_node in old_referenced_nodes - new_referenced_nodes:
                removed_node.dispose()

            child_nodes_by_prop.clear()
            child_nodes_by_prop.update(current_resolved)
            node.props.value = new_props

        binder_sub = binder.subscribe(on_properties_changed)

        def cleanup_node() -> None:
            binder_sub.unsubscribe()
            binder.dispose()
            for sub in list(template_subs.values()):
                sub.unsubscribe()
            template_subs.clear()
            for child_node in _collect_nodes(list(child_nodes_by_prop.values())):
                child_node.dispose()
            child_nodes_by_prop.clear()
            self.binders.pop(instance_id, None)
            self.active_nodes.pop(instance_id, None)

        node.add_cleanup(cleanup_node)
        return node

    def _rebuild_referencing_parents(
        self, component_id: str, skip_same_id: bool = True
    ) -> None:
        """Rebuilds bindings on active parent nodes that reference component_id."""
        for active_node in list(self.active_nodes.values()):
            if skip_same_id and active_node.component_id == component_id:
                continue
            binder = self.binders.get(active_node.instance_id)
            if binder and self._references_component(
                binder.context.component_model.properties, component_id
            ):
                binder._rebuild_all_bindings()

    def _on_component_created(self, component: ComponentModel) -> None:
        component_id = component.id
        nodes_to_recreate = [
            node
            for node in list(self.active_nodes.values())
            if node.component_id == component_id
            and (node.type == "Placeholder" or node.type != component.type)
        ]
        for old_node in nodes_to_recreate:
            data_path = old_node.data_path
            old_node.dispose()
            self.get_or_create_node(component_id, data_path)

        if component_id == self._root_id and not self.rootNode.value:
            self.rootNode.value = self.get_or_create_node(self._root_id, "/")

        self._rebuild_referencing_parents(component_id, skip_same_id=True)

    def _on_component_deleted(self, component_id: str) -> None:
        nodes_to_delete = [
            n for n in self.active_nodes.values() if n.component_id == component_id
        ]
        for node in nodes_to_delete:
            node.dispose()

        if component_id == self._root_id:
            self.rootNode.value = None

        self._rebuild_referencing_parents(component_id, skip_same_id=False)

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


NodeGraph = NodeResolver

__all__ = ["NodeResolver", "NodeGraph"]
