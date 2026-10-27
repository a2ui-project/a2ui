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

"""Stateful resolver that projects a SurfaceModel into a tree of ComponentNodes."""

from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Any

from ..catalog.reference_map import ComponentRefSpec, analyze_child_ref_schema
from ..common import Subscription
from ..common.events import EventSource
from ..state.component_model import ComponentModel
from ..state.surface_model import SurfaceModel
from .component_context import ComponentContext
from .component_node import (
    PLACEHOLDER_TYPE,
    ComponentNode,
    MutableComponentNode,
    NodeState,
    ResolvedBinding,
    WritableBinding,
    is_component_node,
    same_binding,
)
from .data_context import DataContext
from .generic_binder import BehaviorNode, BehaviorType, GenericBinder

ROOT_COMPONENT_ID = "root"
ROOT_DATA_PATH = "/"

_ID_PART_ESCAPES = {
    "~": "~0",
    "#": "~1",
    "[": "~2",
    "]": "~3",
    ">": "~4",
    "@": "~5",
}
_ID_ESCAPE_RE = re.compile(r"[~#\[\]>@]")

_SKIP_BINDER_KEYS = frozenset({
    "weight",
    "checks",
    "isValid",
    "validationErrors",
    "validationResults",
    "validationResult",
})


def _escape_id_part(part: str) -> str:
    return _ID_ESCAPE_RE.sub(lambda m: _ID_PART_ESCAPES[m.group(0)], part)


def _normalize_data_path(data_path: str) -> str:
    return data_path.rstrip("/") or ROOT_DATA_PATH


def _instance_id_for(component_id: str, data_path: str, occurrence: int) -> str:
    trimmed = _normalize_data_path(data_path)
    base = (
        _escape_id_part(component_id)
        if trimmed == ROOT_DATA_PATH
        else f"{_escape_id_part(component_id)}-[{_escape_id_part(trimmed)}]"
    )
    return f"{base}#{occurrence}" if occurrence > 1 else base


@dataclass
class _NodeRecord:
    node: MutableComponentNode
    edge_key: str
    occurrence: int
    ref_spec: ComponentRefSpec
    parent: MutableComponentNode | None = None
    behavior: BehaviorNode | None = None
    component_model: ComponentModel | None = None
    binder: GenericBinder | None = None
    binder_sub: Subscription | None = None
    last_binder_props: dict[str, Any] | None = None
    child_edges: dict[str, MutableComponentNode] = field(default_factory=dict)


def _lookup_component_api(catalog: Any, comp_type: str) -> Any:
    if catalog is None:
        return None
    if hasattr(catalog, "get_component"):
        return catalog.get_component(comp_type)
    comps = getattr(catalog, "components", None)
    if isinstance(comps, dict):
        return comps.get(comp_type)
    return None


def _resolve_ref_spec(
    surface: SurfaceModel, model: ComponentModel | None
) -> ComponentRefSpec:
    if model is None:
        return ComponentRefSpec()
    cat = model.catalog or surface.default_catalog
    if cat is None:
        return ComponentRefSpec()
    get_map = getattr(cat, "get_component_ref_map", None)
    if callable(get_map):
        ref_map = get_map()
        if isinstance(ref_map, dict) and model.type in ref_map:
            spec = ref_map[model.type]
            if isinstance(spec, ComponentRefSpec):
                return spec
    resolve_schema = getattr(cat, "resolved_component_schema", None)
    schema = resolve_schema(model.type) if callable(resolve_schema) else None
    if schema is None:
        comp = _lookup_component_api(cat, model.type)
        schema = getattr(comp, "schema", None) if comp is not None else None
    cat_schema = getattr(cat, "validation_schema", None) or getattr(cat, "schema", None)
    return analyze_child_ref_schema(schema, catalog_schema=cat_schema)


def _extract_validation_fields(
    binder_props: dict[str, Any],
) -> tuple[bool, list[str], list[dict[str, Any]]]:
    is_valid = bool(binder_props.get("isValid", True))
    raw_errs = binder_props.get("validationErrors")
    errs = [str(e) for e in raw_errs] if isinstance(raw_errs, list) else []
    raw_res = binder_props.get("validationResults")
    res = (
        [dict(r) for r in raw_res if isinstance(r, dict)]
        if isinstance(raw_res, list)
        else []
    )
    return is_valid, errs, res


def _get_safe_child_list(val: Any) -> list[Any]:
    if isinstance(val, list):
        return val
    if isinstance(val, dict):
        expl = val.get("explicitList")
        if isinstance(expl, list):
            return list(expl)
    return []


def _extract_binding_path(raw: Any, at_least_v10: bool) -> str | None:
    if not isinstance(raw, dict) or "componentId" in raw:
        return None
    key = "@path" if at_least_v10 else "path"
    val = raw.get(key)
    return val if isinstance(val, str) else None


def _wrap_dynamic_object(
    value: dict[str, Any],
    shape: dict[str, BehaviorNode],
    raw: Any,
    data_context: DataContext,
) -> dict[str, Any]:
    setter_names = {
        f"set{k[0].upper() + k[1:]}"
        for k, b in shape.items()
        if k and b.type == BehaviorType.DYNAMIC
    }
    raw_record = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}
    for key, item in value.items():
        if key in setter_names or key in _SKIP_BINDER_KEYS:
            continue
        child_behavior = shape.get(key) or BehaviorNode(BehaviorType.STATIC)
        out[key] = _wrap_dynamic_values(
            item, child_behavior, raw_record.get(key), data_context
        )
    for key, child_behavior in shape.items():
        if child_behavior.type == BehaviorType.DYNAMIC and key not in out:
            out[key] = ResolvedBinding(None, writable=False)
    return out


def _wrap_dynamic_array(
    value: list[Any],
    behavior: BehaviorNode,
    raw: Any,
    data_context: DataContext,
) -> list[Any]:
    raw_items = raw if isinstance(raw, list) else []
    elem_b = behavior.element or BehaviorNode(BehaviorType.STATIC)
    return [
        _wrap_dynamic_values(
            item,
            elem_b,
            raw_items[idx] if idx < len(raw_items) else None,
            data_context,
        )
        for idx, item in enumerate(value)
    ]


def _wrap_dynamic_values(
    value: Any,
    behavior: BehaviorNode,
    raw: Any,
    data_context: DataContext,
) -> Any:
    if is_component_node(value):
        return value
    if behavior.type == BehaviorType.DYNAMIC:
        path = _extract_binding_path(raw, data_context.at_least_v10)
        if path is None:
            return ResolvedBinding(value, writable=False)

        def _set_val(new_val: Any) -> None:
            data_context.set(path, new_val)

        return WritableBinding(
            value=value,
            set=_set_val,
            path=path,
            writable=True,
        )
    if behavior.type == BehaviorType.ARRAY and isinstance(value, list):
        return _wrap_dynamic_array(value, behavior, raw, data_context)
    if behavior.type == BehaviorType.OBJECT and isinstance(value, dict):
        return _wrap_dynamic_object(value, behavior.shape or {}, raw, data_context)
    return value


def _stabilize_list(prev: list[Any], nxt: list[Any]) -> list[Any]:
    all_same = True
    out: list[Any] = []
    for p_item, n_item in zip(prev, nxt):
        s_item = _stabilize(p_item, n_item)
        out.append(s_item)
        if s_item is not p_item:
            all_same = False
    return prev if all_same else out


def _stabilize_dict(prev: dict[str, Any], nxt: dict[str, Any]) -> dict[str, Any]:
    if len(prev) != len(nxt):
        return nxt
    all_same = True
    out: dict[str, Any] = {}
    for key, n_val in nxt.items():
        s_val = _stabilize(prev.get(key), n_val)
        out[key] = s_val
        if key not in prev or s_val is not prev[key]:
            all_same = False
    return prev if all_same else out


def _stabilize(prev: Any, nxt: Any) -> Any:
    if prev is nxt:
        return nxt
    if isinstance(prev, ResolvedBinding) and isinstance(nxt, ResolvedBinding):
        return prev if same_binding(prev, nxt) else nxt
    if is_component_node(prev) or is_component_node(nxt):
        return nxt
    if isinstance(prev, list) and isinstance(nxt, list) and len(prev) == len(nxt):
        return _stabilize_list(prev, nxt)
    if type(prev) is dict and type(nxt) is dict:
        return _stabilize_dict(prev, nxt)
    return prev if type(prev) is type(nxt) and prev == nxt else nxt


class NodeResolver:
    """Resolves a SurfaceModel's flat ComponentModel map into a reactive ComponentNode tree."""

    def __init__(
        self,
        surface: SurfaceModel,
        catalog: Any = None,
    ) -> None:
        self.surface = surface
        self.root_id = surface.root_id or ROOT_COMPONENT_ID
        self._records: dict[MutableComponentNode, _NodeRecord] = {}
        self._nodes_by_edge: dict[str, MutableComponentNode] = {}
        self._nodes_by_component_id: dict[str, set[MutableComponentNode]] = {}
        self._pending_parents: dict[str, set[MutableComponentNode]] = {}
        self._dispatched_errors: dict[str, dict[str, set[str]]] = {}
        self._model_subs: list[Subscription] = []
        self._root_record: _NodeRecord | None = None
        self._disposed = False
        self.on_root_replaced: EventSource = EventSource()

        cm = surface.components_model
        self._model_subs.append(cm.on_created.subscribe(self._on_component_created))
        self._model_subs.append(cm.on_deleted.subscribe(self._on_component_deleted))

        if cm.get(self.root_id) is not None:
            self._build_root()

    @property
    def root(self) -> ComponentNode | None:
        """Returns the resolved root ComponentNode, or None if absent."""
        return self._root_record.node if self._root_record is not None else None

    @property
    def active_node_count(self) -> int:
        """Returns the total count of active nodes in the tree."""
        return len(self._records)

    @property
    def disposed(self) -> bool:
        """Returns whether the resolver has been disposed."""
        return self._disposed

    def _dispatch_once(
        self, code: str, component_id: str, data_path: str, message: str
    ) -> None:
        by_path = self._dispatched_errors.setdefault(component_id, {})
        codes = by_path.setdefault(data_path, set())
        if code in codes:
            return
        codes.add(code)
        self.surface.dispatch_error({
            "code": code,
            "surfaceId": self.surface.id,
            "message": message,
        })

    def _clear_dispatched(self, component_id: str, data_path: str) -> None:
        by_path = self._dispatched_errors.get(component_id)
        if by_path is not None:
            by_path.pop(data_path, None)
            if not by_path:
                self._dispatched_errors.pop(component_id, None)

    def _build_root(self) -> None:
        if self._root_record is not None:
            return
        esc = _escape_id_part(self.root_id)
        edge_key = f">{esc}>{esc}@/"
        node = self._create_node(self.root_id, ROOT_DATA_PATH, edge_key, None)
        self._root_record = self._records.get(node)
        self.on_root_replaced.emit(node)

    def _on_component_created(self, component: ComponentModel) -> None:
        if self._disposed:
            return
        if component.id == self.root_id:
            self._reconcile_root_on_created()
        waiting = self._pending_parents.pop(component.id, None)
        if waiting:
            for parent in list(waiting):
                rec = self._records.get(parent)
                if rec is not None and not parent.disposed:
                    self._materialize(rec)

    def _reconcile_root_on_created(self) -> None:
        current = self.surface.components_model.get(self.root_id)
        if (
            self._root_record is not None
            and self._root_record.component_model is not current
        ):
            self._dispose_node(self._root_record.node)
            self._root_record = None
            if current is None:
                self.on_root_replaced.emit(None)
        if current is not None:
            self._build_root()

    def _on_component_deleted(self, comp_id: str) -> None:
        if self._disposed:
            return
        self._dispatched_errors.pop(comp_id, None)
        affected = self._nodes_by_component_id.get(comp_id)
        if not affected:
            return
        parents_to_refresh, root_affected = self._collect_affected_parents(affected)
        if root_affected and self._root_record is not None:
            self._reconcile_root_on_deleted(comp_id)
        for parent in parents_to_refresh:
            rec = self._records.get(parent)
            if rec is not None and not parent.disposed:
                self._materialize(rec)

    def _collect_affected_parents(
        self, affected: set[MutableComponentNode]
    ) -> tuple[list[MutableComponentNode], bool]:
        parents: list[MutableComponentNode] = []
        seen: set[MutableComponentNode] = set()
        root_affected = False
        for node in list(affected):
            rec = self._records.get(node)
            if rec is None:
                continue
            if rec.parent is not None:
                if rec.parent not in seen:
                    seen.add(rec.parent)
                    parents.append(rec.parent)
            else:
                root_affected = True
        return parents, root_affected

    def _reconcile_root_on_deleted(self, comp_id: str) -> None:
        if self._root_record is None:
            return
        model = self.surface.components_model.get(comp_id)
        if model is None:
            self._dispose_node(self._root_record.node)
            self._root_record = None
            self.on_root_replaced.emit(None)
        elif self._root_record.component_model is not model:
            self._dispose_node(self._root_record.node)
            self._root_record = None
            self._build_root()

    def _register_node(
        self,
        node: MutableComponentNode,
        *,
        edge_key: str,
        parent: MutableComponentNode | None,
        occurrence: int,
        ref_spec: ComponentRefSpec,
        behavior: BehaviorNode | None = None,
        component_model: ComponentModel | None = None,
        binder: GenericBinder | None = None,
    ) -> _NodeRecord:
        record = _NodeRecord(
            node=node,
            edge_key=edge_key,
            parent=parent,
            occurrence=occurrence,
            ref_spec=ref_spec,
            behavior=behavior,
            component_model=component_model,
            binder=binder,
        )
        self._records[node] = record
        self._nodes_by_edge[edge_key] = node
        self._nodes_by_component_id.setdefault(node.component_id, set()).add(node)
        return record

    def _register_pending_parent(
        self, component_id: str, parent: MutableComponentNode
    ) -> None:
        self._pending_parents.setdefault(component_id, set()).add(parent)

    def _create_node(
        self,
        component_id: str,
        data_path: str,
        edge_key: str,
        parent: MutableComponentNode | None,
        occurrence: int = 1,
    ) -> MutableComponentNode:
        norm_path = _normalize_data_path(data_path)
        model = self.surface.components_model.get(component_id)
        if model is None:
            return self._create_pending_node(
                component_id, norm_path, edge_key, parent, occurrence
            )
        cat = model.catalog or self.surface.default_catalog
        api = _lookup_component_api(cat, model.type)
        if api is None:
            return self._create_unknown_type_node(
                model, norm_path, edge_key, parent, occurrence
            )
        return self._create_resolved_node(
            model, api, norm_path, edge_key, parent, occurrence
        )

    def _create_pending_node(
        self,
        component_id: str,
        data_path: str,
        edge_key: str,
        parent: MutableComponentNode | None,
        occurrence: int,
    ) -> MutableComponentNode:
        node = MutableComponentNode(
            instance_id=_instance_id_for(component_id, data_path, occurrence),
            component_id=component_id,
            type=PLACEHOLDER_TYPE,
            data_path=data_path,
            props={},
            state="pending",
            parent=parent,
        )
        self._register_node(
            node,
            edge_key=edge_key,
            parent=parent,
            occurrence=occurrence,
            ref_spec=ComponentRefSpec(),
        )
        if parent is not None:
            self._register_pending_parent(component_id, parent)
        return node

    def _create_unknown_type_node(
        self,
        model: ComponentModel,
        data_path: str,
        edge_key: str,
        parent: MutableComponentNode | None,
        occurrence: int,
    ) -> MutableComponentNode:
        self._dispatch_once(
            "UNKNOWN_COMPONENT_TYPE",
            model.id,
            data_path,
            f"Component '{model.id}' has unknown type '{model.type}'.",
        )
        node = MutableComponentNode(
            instance_id=_instance_id_for(model.id, data_path, occurrence),
            component_id=model.id,
            type=model.type,
            data_path=data_path,
            props={},
            state="unknown-type",
            parent=parent,
        )
        self._register_node(
            node,
            edge_key=edge_key,
            parent=parent,
            occurrence=occurrence,
            ref_spec=ComponentRefSpec(),
            component_model=model,
        )
        return node

    def _create_resolved_node(
        self,
        model: ComponentModel,
        api: Any,
        data_path: str,
        edge_key: str,
        parent: MutableComponentNode | None,
        occurrence: int,
    ) -> MutableComponentNode:
        self._clear_dispatched(model.id, data_path)
        context = ComponentContext.from_surface(
            self.surface,
            model.id,
            data_path,
        )
        binder = GenericBinder(context, expand_templates=True)
        node = MutableComponentNode(
            instance_id=_instance_id_for(model.id, data_path, occurrence),
            component_id=model.id,
            type=model.type,
            data_path=data_path,
            props={},
            impl=api,
            context=context,
            state="resolved",
            parent=parent,
        )
        record = self._register_node(
            node,
            edge_key=edge_key,
            parent=parent,
            occurrence=occurrence,
            ref_spec=_resolve_ref_spec(self.surface, model),
            behavior=binder.behavior_tree,
            component_model=model,
            binder=binder,
        )

        def on_binder_update(raw: dict[str, Any]) -> None:
            record.last_binder_props = raw
            self._materialize(record)

        record.binder_sub = binder.subscribe(on_binder_update)
        return node

    def _is_cyclic(
        self, component_id: str, data_path: str, parent: MutableComponentNode
    ) -> bool:
        curr: MutableComponentNode | None = parent
        while curr is not None:
            if curr.component_id == component_id and curr.data_path == data_path:
                return True
            rec = self._records.get(curr)
            curr = rec.parent if rec is not None else None
        return False

    def _is_existing_up_to_date(
        self,
        existing: MutableComponentNode,
        record: _NodeRecord | None,
        component_id: str,
        data_path: str,
        occurrence: int,
        model: ComponentModel | None,
    ) -> bool:
        if (
            record is None
            or existing.component_id != component_id
            or existing.data_path != data_path
            or record.occurrence != occurrence
        ):
            return False
        cat = (model.catalog or self.surface.default_catalog) if model else None
        api = _lookup_component_api(cat, model.type) if model else None
        if existing.is_placeholder:
            return (model is None and existing.state == "pending") or (
                model is not None
                and api is None
                and existing.state == "unknown-type"
                and record.component_model is model
            )
        return (
            model is not None
            and existing.type == model.type
            and record.component_model is model
        )

    def _child_node(
        self,
        component_id: str,
        data_path: str,
        edge_key: str,
        parent: MutableComponentNode,
        occurrence: int = 1,
    ) -> MutableComponentNode:
        norm_path = _normalize_data_path(data_path)
        existing = self._nodes_by_edge.get(edge_key)
        model = self.surface.components_model.get(component_id)
        if self._is_cyclic(component_id, norm_path, parent):
            return self._resolve_cyclic_child(
                existing, model, component_id, norm_path, edge_key, parent, occurrence
            )
        if existing is not None and not existing.disposed:
            rec = self._records.get(existing)
            if self._is_existing_up_to_date(
                existing, rec, component_id, norm_path, occurrence, model
            ):
                if existing.state == "pending":
                    self._register_pending_parent(component_id, parent)
                return existing
            self._dispose_node(existing)
        return self._create_node(component_id, norm_path, edge_key, parent, occurrence)

    def _resolve_cyclic_child(
        self,
        existing: MutableComponentNode | None,
        model: ComponentModel | None,
        component_id: str,
        data_path: str,
        edge_key: str,
        parent: MutableComponentNode,
        occurrence: int,
    ) -> MutableComponentNode:
        if (
            existing is not None
            and not existing.disposed
            and existing.state == "cyclic"
            and self._records.get(existing) is not None
            and self._records[existing].occurrence == occurrence
        ):
            return existing
        if existing is not None and not existing.disposed:
            self._dispose_node(existing)
        self._dispatch_once(
            "CYCLIC_REFERENCE",
            component_id,
            data_path,
            f"Component '{component_id}' at '{data_path}' is cyclic.",
        )
        node = MutableComponentNode(
            instance_id=_instance_id_for(component_id, data_path, occurrence),
            component_id=component_id,
            type=model.type if model is not None else PLACEHOLDER_TYPE,
            data_path=data_path,
            props={},
            state="cyclic",
            parent=parent,
        )
        self._register_node(
            node,
            edge_key=edge_key,
            parent=parent,
            occurrence=occurrence,
            ref_spec=ComponentRefSpec(),
        )
        return node

    def _materialize(self, record: _NodeRecord) -> None:
        if record.node.disposed:
            return
        raw = dict(
            record.last_binder_props
            if record.last_binder_props is not None
            else (record.binder.snapshot if record.binder is not None else {})
        )
        self._prune_removed_ref_keys(record, raw)
        is_valid, val_errors, val_results = _extract_validation_fields(raw)
        record.node.is_valid = is_valid
        record.node.validation_errors = val_errors
        record.node.validation_results = val_results

        new_edges = self._resolve_all_child_refs(record, raw)
        self._cleanup_unreferenced_edges(record, new_edges)
        record.child_edges = new_edges

        wrapped = self._wrap_and_stabilize_props(record, raw)
        record.node.set_props(wrapped)

    def _prune_removed_ref_keys(
        self, record: _NodeRecord, next_props: dict[str, Any]
    ) -> None:
        model_props = (
            record.component_model.properties if record.component_model else None
        )
        if model_props is None:
            return
        all_ref_keys = record.ref_spec.single_refs | record.ref_spec.list_refs
        for key in all_ref_keys:
            if key in next_props and key not in model_props:
                next_props.pop(key, None)

    def _resolve_all_child_refs(
        self, record: _NodeRecord, next_props: dict[str, Any]
    ) -> dict[str, MutableComponentNode]:
        new_edges: dict[str, MutableComponentNode] = {}
        occurrences: dict[str, int] = {}

        def resolve_one(slot: str, comp_id: str, path: str) -> ComponentNode:
            norm = _normalize_data_path(path)
            occ_key = f"{_escape_id_part(comp_id)}@{_escape_id_part(norm)}"
            occ = occurrences.get(occ_key, 0) + 1
            occurrences[occ_key] = occ
            edge_key = f"{record.edge_key}>{slot}>{occ_key}#{occ}"
            child = self._child_node(comp_id, norm, edge_key, record.node, occ)
            new_edges[edge_key] = child
            return child

        for key in sorted(record.ref_spec.single_refs):
            val = next_props.get(key)
            if isinstance(val, str) and val:
                next_props[key] = resolve_one(
                    _escape_id_part(key), val, record.node.data_path
                )

        for key in sorted(record.ref_spec.list_refs):
            if key in record.ref_spec.nested_refs:
                self._resolve_nested_ref_list(
                    record,
                    next_props,
                    key,
                    record.ref_spec.nested_refs[key],
                    resolve_one,
                )
            else:
                self._resolve_flat_ref_list(record, next_props, key, resolve_one)

        return new_edges

    def _resolve_flat_ref_list(
        self,
        record: _NodeRecord,
        next_props: dict[str, Any],
        key: str,
        resolve_one: Any,
    ) -> None:
        if key not in next_props:
            return
        safe_list = _get_safe_child_list(next_props[key])
        slot = _escape_id_part(key)
        resolved_items: list[Any] = []
        for item in safe_list:
            if isinstance(item, str) and item:
                resolved_items.append(resolve_one(slot, item, record.node.data_path))
            elif isinstance(item, dict):
                if isinstance(item.get("id"), str) and isinstance(
                    item.get("basePath"), str
                ):
                    resolved_items.append(
                        resolve_one(slot, item["id"], item["basePath"])
                    )
                elif isinstance(item.get("componentId"), str) and item["componentId"]:
                    resolved_items.append(
                        resolve_one(slot, item["componentId"], record.node.data_path)
                    )
                else:
                    resolved_items.append(item)
            else:
                resolved_items.append(item)
        next_props[key] = resolved_items

    def _resolve_nested_ref_list(
        self,
        record: _NodeRecord,
        next_props: dict[str, Any],
        key: str,
        sub_keys: set[str],
        resolve_one: Any,
    ) -> None:
        val = next_props.get(key)
        if not isinstance(val, list):
            return
        esc_key = _escape_id_part(key)
        out_list: list[Any] = []
        for idx, item in enumerate(val):
            if not isinstance(item, dict):
                out_list.append(item)
                continue
            entry = dict(item)
            resolved_any = False
            for sub_k in sorted(sub_keys):
                cid = entry.get(sub_k)
                if isinstance(cid, str) and cid:
                    slot = f"{esc_key}[{idx}].{_escape_id_part(sub_k)}"
                    entry[sub_k] = resolve_one(slot, cid, record.node.data_path)
                    resolved_any = True
            out_list.append(entry if resolved_any else item)
        next_props[key] = out_list

    def _cleanup_unreferenced_edges(
        self,
        record: _NodeRecord,
        new_edges: dict[str, MutableComponentNode],
    ) -> None:
        for edge_key, child in list(record.child_edges.items()):
            if edge_key in new_edges:
                continue
            self._dispose_node(child)
            if child.is_placeholder:
                self._discard_pending_if_unreferenced(
                    record.node, child.component_id, new_edges
                )

    def _discard_pending_if_unreferenced(
        self,
        parent_node: MutableComponentNode,
        component_id: str,
        new_edges: dict[str, MutableComponentNode],
    ) -> None:
        still_waiting = any(
            other.is_placeholder and other.component_id == component_id
            for other in new_edges.values()
        )
        if still_waiting:
            return
        waiting = self._pending_parents.get(component_id)
        if waiting is not None:
            waiting.discard(parent_node)
            if not waiting:
                self._pending_parents.pop(component_id, None)

    def _wrap_and_stabilize_props(
        self, record: _NodeRecord, next_props: dict[str, Any]
    ) -> dict[str, Any]:
        model_props = (
            record.component_model.properties if record.component_model else {}
        )
        if record.behavior is not None and record.node.context is not None:
            raw_wrapped = _wrap_dynamic_values(
                next_props,
                record.behavior,
                model_props,
                record.node.context.data_context,
            )
            wrapped: dict[str, Any] = (
                dict(raw_wrapped)
                if isinstance(raw_wrapped, dict)
                else {k: v for k, v in next_props.items() if k not in _SKIP_BINDER_KEYS}
            )
        else:
            wrapped = {
                k: v for k, v in next_props.items() if k not in _SKIP_BINDER_KEYS
            }
        prev = record.node.props
        for k in list(wrapped.keys()):
            wrapped[k] = _stabilize(prev.get(k), wrapped[k])
        return wrapped

    def _teardown_record(self, node: MutableComponentNode, record: _NodeRecord) -> None:
        for child in list(record.child_edges.values()):
            self._dispose_node(child)
        record.child_edges.clear()
        if record.binder_sub is not None:
            record.binder_sub.unsubscribe()
            record.binder_sub = None
        if record.binder is not None:
            record.binder.dispose()
            record.binder = None
        if self._nodes_by_edge.get(record.edge_key) is node:
            self._nodes_by_edge.pop(record.edge_key, None)

    def _dispose_node(self, node: MutableComponentNode) -> None:
        if node.disposed:
            return
        record = self._records.pop(node, None)
        if record is not None:
            self._teardown_record(node, record)
        by_id = self._nodes_by_component_id.get(node.component_id)
        if by_id is not None:
            by_id.discard(node)
            if not by_id:
                self._nodes_by_component_id.pop(node.component_id, None)
        self._remove_node_from_pending_parents(node)
        if node.state == "cyclic":
            self._clear_dispatched(node.component_id, node.data_path)
        node.dispose()

    def _remove_node_from_pending_parents(self, node: MutableComponentNode) -> None:
        for cid in list(self._pending_parents.keys()):
            waiting = self._pending_parents[cid]
            waiting.discard(node)
            if not waiting:
                self._pending_parents.pop(cid, None)

    def dispose(self) -> None:
        """Tears down the entire node tree and disconnects model event listeners."""
        if self._disposed:
            return
        self._disposed = True
        for sub in self._model_subs:
            sub.unsubscribe()
        self._model_subs.clear()
        for node in list(self._records.keys()):
            self._dispose_node(node)
        self._pending_parents.clear()
        self._dispatched_errors.clear()
        self._root_record = None
        self.on_root_replaced.emit(None)
        self.on_root_replaced.dispose()
