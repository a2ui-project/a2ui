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

"""Conformance runner for node_resolution.yaml test cases."""

from __future__ import annotations

from dataclasses import dataclass
import inspect
import json
from pathlib import Path
from typing import Any, Callable
import yaml

from a2ui.core.catalog import Catalog, FunctionImplementation
from a2ui.core.processing import MessageProcessor
from a2ui.core.resolution.component_node import (
    ComponentNode,
    ResolvedBinding,
    is_component_node,
    is_writable,
)
from a2ui.core.resolution.node_resolver import NodeResolver
from a2ui.core.state import ComponentModel, SurfaceModel


@dataclass
class _Watch:
    path: str
    emissions: int = 0
    destroyed: int = 0
    last_props: Any = None
    stop: Callable[[], None] = lambda: None


def _normalize(value: Any, path: str) -> Any:
    if is_component_node(value):
        return {"node": path}
    if isinstance(value, ResolvedBinding):
        return {"value": _normalize(value.value, path), "writable": is_writable(value)}
    if callable(value):
        return {"action": True}
    if isinstance(value, list):
        return [_normalize(item, f"{path}/{i}") for i, item in enumerate(value)]
    if isinstance(value, dict):
        return {k: _normalize(v, f"{path}/{k}") for k, v in value.items()}
    return value


def _mounted_nodes(resolver: NodeResolver) -> dict[str, ComponentNode]:
    nodes: dict[str, ComponentNode] = {}
    seen: set[ComponentNode] = set()

    def visit(node: ComponentNode, path: str) -> None:
        assert (
            node not in seen
        ), f"{path}: each mounted position must have a distinct node"
        assert not node.disposed, f"{path}: mounted node is disposed"
        seen.add(node)
        nodes[path] = node
        sibling_ids: set[str] = set()

        def children(val: Any, child_path: str) -> None:
            if is_component_node(val):
                assert (
                    val.instance_id not in sibling_ids
                ), f"{child_path}: duplicate sibling instance_id"
                sibling_ids.add(val.instance_id)
                visit(val, child_path)
            elif isinstance(val, list):
                for i, item in enumerate(val):
                    children(item, f"{child_path}/{i}")
            elif isinstance(val, dict) and not isinstance(val, ResolvedBinding):
                for k, item in val.items():
                    children(item, f"{child_path}/{k}")

        children(node.props, path)

    if resolver.root is not None:
        visit(resolver.root, "root")
    return nodes


def _required_node(nodes: dict[str, ComponentNode], path: str) -> ComponentNode:
    assert path in nodes, f"No node at {path}"
    return nodes[path]


def _check_nodes(
    nodes: dict[str, ComponentNode],
    expected: dict[str, Any],
    reason: str,
) -> None:
    expected_nodes = expected.get("nodes") or {}
    assert sorted(nodes.keys()) == sorted(
        expected_nodes.keys()
    ), f"{reason}: node paths {sorted(nodes.keys())} != {sorted(expected_nodes.keys())}"
    for path, fields in expected_nodes.items():
        node = _required_node(nodes, path)
        actual = {
            "component_id": node.component_id,
            "type": node.type,
            "state": node.state,
            "data_path": node.data_path,
            "isValid": node.is_valid,
            "validationErrors": node.validation_errors,
            "validationResults": node.validation_results,
        }
        for key in (
            "component_id",
            "type",
            "state",
            "data_path",
            "isValid",
            "validationErrors",
            "validationResults",
        ):
            if key in fields:
                assert actual[key] == fields[key], (
                    f"{reason}: {path}.{key} expected {fields[key]!r}, got"
                    f" {actual[key]!r}"
                )
        for key, expected_val in (fields.get("props") or {}).items():
            assert key in node.props, f"{reason}: {path}.{key} is absent"
            norm_actual = _normalize(node.props[key], f"{path}/{key}")
            assert (
                norm_actual == expected_val
            ), f"{reason}: {path}.{key} expected {expected_val!r}, got {norm_actual!r}"


def _update_components(
    surface: SurfaceModel,
    catalog: Catalog,
    components: list[dict[str, Any]],
) -> None:
    for comp in components:
        comp_id = comp["id"]
        comp_type = comp["component"]
        properties = {k: v for k, v in comp.items() if k not in ("id", "component")}
        existing = surface.components_model.get(comp_id)
        if existing is not None:
            assert (
                existing.type == comp_type
            ), f"update_components cannot change {comp_id}'s type"
            existing.properties = properties
        else:
            surface.components_model.add_component(
                ComponentModel(comp_id, comp_type, catalog, properties)
            )


def _save_bindings(
    nodes: dict[str, ComponentNode],
) -> list[tuple[ResolvedBinding[Any], Any]]:
    saved: list[tuple[ResolvedBinding[Any], Any]] = []

    def visit(val: Any) -> None:
        if isinstance(val, ResolvedBinding):
            saved.append((val, _normalize(val.value, "")))
        elif isinstance(val, list):
            for item in val:
                visit(item)
        elif isinstance(val, dict) and not is_component_node(val):
            for item in val.values():
                visit(item)

    for node in nodes.values():
        visit(node.props)
    return saved


def _build_recording_catalog(
    catalog_json_path: Path, functions_log: list[dict[str, Any]]
) -> Catalog:
    raw_json = json.loads(catalog_json_path.read_text(encoding="utf-8"))
    parsed = Catalog.from_json(raw_json)
    wrapped_functions: dict[str, Any] = {}
    for fn_name, fn_api in (parsed.functions or {}).items():

        def make_impl(name: str) -> Callable[..., Any]:
            def _impl(args: dict[str, Any], _ctx: Any = None, _sig: Any = None) -> Any:
                functions_log.append({"name": name, "args": _normalize(args, "")})
                return None

            return _impl

        wrapped_functions[fn_name] = FunctionImplementation(
            name=fn_api.name,
            description=getattr(fn_api, "description", None),
            return_type=getattr(fn_api, "return_type", "any"),
            schema=getattr(fn_api, "schema", None),
            execute=make_impl(fn_name),
        )
    parsed.functions = wrapped_functions
    return parsed


def _watch_nodes(
    nodes: dict[str, ComponentNode], watches: dict[ComponentNode, _Watch]
) -> None:
    for path, node in nodes.items():
        existing = watches.get(node)
        if existing is not None:
            existing.path = path
            continue
        w = _Watch(path=path)

        def on_props(props: dict[str, Any], watch: _Watch = w) -> None:
            watch.emissions += 1
            watch.last_props = _normalize(props, watch.path)

        def on_destroy(_: Any, watch: _Watch = w) -> None:
            watch.destroyed += 1

        sub_props = node.on_updated.subscribe(on_props)
        sub_destroy = node.on_destroyed.subscribe(on_destroy)
        w.stop = lambda sp=sub_props, sd=sub_destroy: (
            sp.unsubscribe(),
            sd.unsubscribe(),
        )
        watches[node] = w


def _collect_watch_counts(
    watches: dict[ComponentNode, _Watch],
    surviving: set[ComponentNode],
    reason: str,
) -> tuple[dict[str, int], dict[str, int]]:
    emissions: dict[str, int] = {}
    destroyed: dict[str, int] = {}
    for node, w in watches.items():
        if w.emissions and node in surviving:
            emissions[w.path] = emissions.get(w.path, 0) + w.emissions
            assert w.last_props == _normalize(
                node.props, w.path
            ), f"{reason}: {w.path} last emission"
        if w.destroyed:
            destroyed[w.path] = destroyed.get(w.path, 0) + w.destroyed
            assert node.disposed, f"{reason}: {w.path} destruction without disposal"
    return emissions, destroyed


def _check_errors(
    errors: list[dict[str, Any]], expected: dict[str, Any], reason: str
) -> None:
    if "errors" not in expected:
        return
    exp_errors = expected["errors"] or []
    assert len(errors) == len(
        exp_errors
    ), f"{reason}: errors count expected {len(exp_errors)}, got {len(errors)}: {errors}"
    for actual_err, exp_err in zip(errors, exp_errors):
        for k, v in exp_err.items():
            assert (
                actual_err.get(k) == v
            ), f"{reason}: error.{k} expected {v!r}, got {actual_err.get(k)!r}"


def _check_step_state(
    resolver: NodeResolver,
    surface: SurfaceModel,
    watches: dict[ComponentNode, _Watch],
    events: list[dict[str, Any]],
    functions: list[dict[str, Any]],
    errors: list[dict[str, Any]],
    expected: dict[str, Any],
    before: dict[str, ComponentNode],
    reason: str,
) -> None:
    after = _mounted_nodes(resolver)
    _check_nodes(after, expected, reason)
    emissions, destroyed = _collect_watch_counts(watches, set(after.values()), reason)
    assert emissions == (expected.get("emissions") or {}), (
        f"{reason}: emissions expected {expected.get('emissions') or {}}, got"
        f" {emissions}"
    )
    assert destroyed == (expected.get("destroyed") or {}), (
        f"{reason}: destroyed expected {expected.get('destroyed') or {}}, got"
        f" {destroyed}"
    )
    for path in expected.get("same_nodes") or []:
        assert _required_node(after, path) is _required_node(
            before, path
        ), f"{reason}: {path} identity"
    for path in expected.get("replaced_nodes") or []:
        assert _required_node(after, path) is not _required_node(
            before, path
        ), f"{reason}: {path} replacement"
    for path, val in (expected.get("data") or {}).items():
        assert (
            _normalize(surface.data_model.get(path), path) == val
        ), f"{reason}: data {path}"
    assert events == (
        expected.get("events") or []
    ), f"{reason}: events expected {expected.get('events') or []}, got {events}"
    assert functions == (expected.get("functions") or []), (
        f"{reason}: functions expected {expected.get('functions') or []}, got"
        f" {functions}"
    )
    _check_errors(errors, expected, reason)


def _execute_step_op(
    step: dict[str, Any],
    before: dict[str, ComponentNode],
    surface: SurfaceModel,
    catalog: Catalog,
    processor: MessageProcessor,
    resolver: NodeResolver,
    reason: str,
) -> None:
    op = step["op"]
    if op == "set_data":
        surface.data_model.set(step["path"], step["value"])
    elif op == "update_components":
        _update_components(surface, catalog, step["components"])
    elif op == "remove_component":
        surface.components_model.remove_component(step["component_id"])
    elif op == "process_messages":
        processor.process_messages(step["messages"])
    elif op == "write":
        binding = _required_node(before, step["node"]).props.get(step["property"])
        assert isinstance(binding, ResolvedBinding) and is_writable(
            binding
        ), f"{reason}: not a writable binding"
        binding.set(step["value"])
    elif op == "invoke":
        action = _required_node(before, step["node"]).props.get(step["property"])
        assert callable(action), f"{reason}: not an action"
        res = action()
        if inspect.isawaitable(res):
            import asyncio

            asyncio.run(res)
    elif op == "dispose":
        resolver.dispose()
    else:
        raise AssertionError(f"Unknown node operation: {op}")


def run_node_resolution_case(test_case: dict[str, Any], conformance_root: Path) -> None:
    """Executes a single resolve_nodes conformance test case."""
    assert test_case.get("action") == "resolve_nodes"
    fixture_path = conformance_root / test_case["fixture"]
    fixture = yaml.safe_load(fixture_path.read_text(encoding="utf-8"))
    functions: list[dict[str, Any]] = []
    events: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    catalog = _build_recording_catalog(conformance_root / fixture["catalog"], functions)
    surface = SurfaceModel(
        surface_id="s",
        default_catalog=catalog,
        available_catalogs={catalog.catalog_id: catalog},
        protocol_version=catalog.protocol_version,
    )
    surface.data_model.set("/", fixture.get("data") or {})
    _update_components(surface, catalog, fixture.get("components") or [])

    processor = MessageProcessor([catalog])
    processor.model.add_surface(surface)

    resolver = NodeResolver(surface, catalog)
    watches: dict[ComponentNode, _Watch] = {}

    stop_actions = surface.on_action.subscribe(
        lambda action: events.append({
            "name": action.get("name"),
            "source_component_id": action.get("sourceComponentId"),
            "context": _normalize(action.get("context") or {}, ""),
        })
    )
    stop_errors = surface.on_error.subscribe(lambda err: errors.append(dict(err)))

    try:
        _check_step_state(
            resolver,
            surface,
            watches,
            events,
            functions,
            errors,
            test_case["expect"],
            {},
            f"{test_case['name']} initial",
        )
        for index, step in enumerate(test_case.get("steps") or []):
            op = step["op"]
            reason = f"{test_case['name']} step {index} ({op})"
            before = _mounted_nodes(resolver)
            _watch_nodes(before, watches)
            for w in watches.values():
                w.emissions = 0
                w.destroyed = 0
                w.last_props = None
            events.clear()
            functions.clear()
            errors.clear()
            bindings = _save_bindings(before)

            _execute_step_op(
                step, before, surface, catalog, processor, resolver, reason
            )

            _check_step_state(
                resolver,
                surface,
                watches,
                events,
                functions,
                errors,
                step["expect"],
                before,
                reason,
            )
            for binding, saved_val in bindings:
                assert (
                    _normalize(binding.value, "") == saved_val
                ), f"{reason}: prior binding snapshot changed"
    finally:
        resolver.dispose()
        surface.dispose()
        for w in watches.values():
            w.stop()
        stop_actions.unsubscribe()
        stop_errors.unsubscribe()
