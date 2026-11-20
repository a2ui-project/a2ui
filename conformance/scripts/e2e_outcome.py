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

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from a2ui.core import (
    A2uiError,
    Catalog,
    ComponentNode,
    MessageProcessor,
    NodeResolver,
)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

_ID_KEYS = frozenset(
    {"id", "surfaceId", "functionCallId", "sourceComponentId", "targetNode"}
)
_SHARED_ID_KEYS = frozenset({"id", "sourceComponentId", "targetNode"})
_PATH_BINDING_KEYS = frozenset({"@path", "path"})


def _map_ordinal(ordinals: dict[str, dict[str, str]], namespace: str, raw: str) -> str:
    id_map = ordinals.setdefault(namespace, {})
    if raw not in id_map:
        id_map[raw] = f"{namespace}_{len(id_map)}"
    return id_map[raw]


def _normalize_dict(
    mapping: dict[str, Any], ordinals: dict[str, dict[str, str]]
) -> dict[str, Any]:
    if len(mapping) == 1:
        only_key, only_val = next(iter(mapping.items()))
        if only_key in _PATH_BINDING_KEYS and isinstance(only_val, str):
            return {only_key: _map_ordinal(ordinals, "path", only_val)}

    result: dict[str, Any] = {}
    for key, val in mapping.items():
        if key == "timestamp":
            continue
        if key in _ID_KEYS and isinstance(val, str):
            namespace = "id" if key in _SHARED_ID_KEYS else key
            result[key] = _map_ordinal(ordinals, namespace, val)
        else:
            result[key] = normalize_ids(val, ordinals)
    return result


def normalize_ids(value: Any, ordinals: dict[str, dict[str, str]] | None = None) -> Any:
    """Replaces model-chosen IDs and binding pointers with first-seen ordinals."""
    active_ordinals = ordinals if ordinals is not None else {}
    if isinstance(value, dict):
        return _normalize_dict(value, active_ordinals)
    if isinstance(value, list):
        return [normalize_ids(item, active_ordinals) for item in value]
    return value


def _extract_binding_value(val: Any) -> Any:
    """Extracts raw value from a resolved binding or returns val directly."""
    return getattr(val, "value") if hasattr(val, "value") else val


def _extract_string_or_bound_prop(
    key: str,
    node_props: dict[str, Any],
    raw_props: dict[str, Any],
    *,
    require_str_fallback: bool = True,
) -> tuple[bool, Any]:
    if key in node_props:
        return True, _extract_binding_value(node_props[key])
    if key in raw_props:
        raw_val = raw_props[key]
        if not require_str_fallback or isinstance(raw_val, str):
            return True, _extract_binding_value(raw_val)
    return False, None


def _extract_enabled_flag(node: ComponentNode, props: dict[str, Any]) -> bool | None:
    if "enabled" in node.props:
        return bool(_extract_binding_value(node.props["enabled"]))
    if "disabled" in node.props:
        return not bool(_extract_binding_value(node.props["disabled"]))
    if "disabled" in props:
        return not bool(props["disabled"])
    return None


def _extract_action_outcome(
    action: Any,
    ordinals: dict[str, dict[str, str]],
    *,
    structural: bool,
) -> tuple[str, Any]:
    if structural and isinstance(action, dict):
        if "event" in action:
            return "actionKind", "event"
        if "functionCall" in action:
            return "actionKind", "functionCall"
        return "actionKind", "other"
    return "action", normalize_ids(action, ordinals)


def _extract_node_outcome(
    node: ComponentNode,
    surface: Any,
    ordinals: dict[str, dict[str, str]],
    *,
    structural: bool = False,
) -> dict[str, Any]:
    """Builds the canonical outcome dict for a resolved node."""
    outcome: dict[str, Any] = {"type": node.type}
    comp = surface.components_model.get(node.component_id)
    props = comp.properties if comp is not None else {}

    if not structural:
        for prop_name, str_only in (
            ("text", True),
            ("label", True),
            ("value", False),
        ):
            found, resolved = _extract_string_or_bound_prop(
                prop_name,
                node.props,
                props,
                require_str_fallback=str_only,
            )
            if found:
                outcome[prop_name] = resolved

    if _extract_enabled_flag(node, props) is False:
        outcome["enabled"] = False

    action = props.get("action") or getattr(node, "action", None)
    if action is not None:
        action_key, action_val = _extract_action_outcome(
            action, ordinals, structural=structural
        )
        outcome[action_key] = action_val

    return outcome


def _append_component_nodes(target: list[ComponentNode], candidate: Any) -> None:
    if isinstance(candidate, ComponentNode):
        target.append(candidate)
    elif isinstance(candidate, list):
        target.extend(item for item in candidate if isinstance(item, ComponentNode))


def _get_child_nodes(node: ComponentNode) -> list[ComponentNode]:
    """Finds all child ComponentNode instances in declared hierarchy order."""
    children: list[ComponentNode] = []
    if "child" in node.props:
        _append_component_nodes(children, node.props["child"])
    if "children" in node.props:
        _append_component_nodes(children, node.props["children"])
    for key, val in node.props.items():
        if key not in ("child", "children"):
            _append_component_nodes(children, val)
    return children


def _walk_tree(
    node: ComponentNode,
    surface: Any,
    ordinals: dict[str, dict[str, str]],
    *,
    structural: bool = False,
) -> list[dict[str, Any]]:
    """Walks the resolved tree depth-first, producing ordered node outcomes."""
    nodes = [_extract_node_outcome(node, surface, ordinals, structural=structural)]
    for child in _get_child_nodes(node):
        nodes.extend(_walk_tree(child, surface, ordinals, structural=structural))
    return nodes


def _load_catalogs(catalog_paths: list[str]) -> list[Catalog]:
    """Loads Catalog objects from repository-relative paths."""
    catalogs: list[Catalog] = []
    for cat_path in catalog_paths:
        path_obj = Path(cat_path)
        full_path = path_obj if path_obj.is_absolute() else REPO_ROOT / path_obj
        data = json.loads(full_path.read_text(encoding="utf-8"))
        catalogs.append(Catalog.from_json(data))
    return catalogs


def _structural_outbound_summary(env: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {"version": env.get("version")}
    if isinstance(env.get("action"), dict):
        summary["kind"] = "action"
        summary["surfaceId"] = env["action"].get("surfaceId")
    elif isinstance(env.get("error"), dict):
        summary["kind"] = "error"
        summary["code"] = env["error"].get("code")
        summary["surfaceId"] = env["error"].get("surfaceId")
    else:
        summary["kind"] = "other"
    return summary


def _apply_turn_wire(processor: MessageProcessor, wire_parts: list[Any]) -> None:
    for wire_part in wire_parts:
        if isinstance(wire_part, dict) and "a2ui" in wire_part:
            try:
                processor.process_messages(wire_part["a2ui"])
            except A2uiError:
                pass


def _extract_surfaces_outcome(
    processor: MessageProcessor,
    default_catalog: Catalog | None,
    ordinals: dict[str, dict[str, str]],
    *,
    structural: bool,
) -> dict[str, list[dict[str, Any]]]:
    surfaces_outcome: dict[str, list[dict[str, Any]]] = {}
    for surface_id in processor.model.surfaces:
        surface = processor.model.get_surface(surface_id)
        if surface is None:
            continue
        cat = surface.default_catalog or default_catalog
        root = NodeResolver(surface, catalog=cat).root
        norm_surface_id = _map_ordinal(ordinals, "surfaceId", surface_id)
        surfaces_outcome[norm_surface_id] = (
            _walk_tree(root, surface, ordinals, structural=structural)
            if root is not None
            else []
        )
    return surfaces_outcome


def outcome_of(
    scenario: dict[str, Any], *, structural: bool = False
) -> list[dict[str, Any]]:
    """Calculates the renderer-visible outcome across all turns of an e2e scenario."""
    catalogs = _load_catalogs(scenario.get("catalogPaths", []))
    processor = MessageProcessor(catalogs=catalogs)
    default_catalog = catalogs[0] if catalogs else None

    ordinals: dict[str, dict[str, str]] = {}
    turn_outcomes: list[dict[str, Any]] = []

    for turn in scenario.get("turns", []):
        _apply_turn_wire(processor, turn.get("expectWire", []))
        surfaces_outcome = _extract_surfaces_outcome(
            processor, default_catalog, ordinals, structural=structural
        )
        normalized_outbound = [
            normalize_ids(env, ordinals) for env in turn.get("expectOutbound", [])
        ]
        if structural:
            normalized_outbound = [
                _structural_outbound_summary(env)
                for env in normalized_outbound
                if isinstance(env, dict)
            ]
        turn_outcomes.append({
            "surfaces": surfaces_outcome,
            "outbound": normalized_outbound,
        })

    return turn_outcomes
