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

from a2ui.core import Catalog, MessageProcessor, NodeResolver
from a2ui.core.resolution.component_node import ComponentNode, is_component_node

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

_ID_KEYS = frozenset(
    {"id", "surfaceId", "functionCallId", "sourceComponentId", "targetNode"}
)


def normalize_ids(value: Any, ordinals: dict[str, dict[str, str]] | None = None) -> Any:
    """Replaces model-chosen IDs with first-seen canonical ordinals, dropping timestamp."""
    if ordinals is None:
        ordinals = {}

    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, val in value.items():
            if key == "timestamp":
                continue
            if key in _ID_KEYS and isinstance(val, str):
                namespace = (
                    "id" if key in ("id", "sourceComponentId", "targetNode") else key
                )
                id_map = ordinals.setdefault(namespace, {})
                if val not in id_map:
                    id_map[val] = f"{namespace}_{len(id_map)}"
                result[key] = id_map[val]
            else:
                result[key] = normalize_ids(val, ordinals)
        return result

    if isinstance(value, list):
        return [normalize_ids(item, ordinals) for item in value]

    return value


def _extract_binding_value(val: Any) -> Any:
    """Extracts raw value from a resolved binding or returns val directly."""
    if hasattr(val, "value"):
        return getattr(val, "value")
    return val


def _extract_node_outcome(
    node: ComponentNode, surface: Any, ordinals: dict[str, dict[str, str]]
) -> dict[str, Any]:
    """Builds the canonical outcome dict {type, text?, label?, value?, enabled?, action?} for a node."""
    outcome: dict[str, Any] = {"type": node.type}

    comp = surface.components_model.get(node.component_id)
    props = comp.properties if comp is not None else {}

    # Extract text if present
    if "text" in node.props:
        outcome["text"] = _extract_binding_value(node.props["text"])
    elif "text" in props and isinstance(props["text"], str):
        outcome["text"] = props["text"]

    # Extract label if present
    if "label" in node.props:
        outcome["label"] = _extract_binding_value(node.props["label"])
    elif "label" in props and isinstance(props["label"], str):
        outcome["label"] = props["label"]

    # Extract value if present
    if "value" in node.props:
        outcome["value"] = _extract_binding_value(node.props["value"])
    elif "value" in props:
        outcome["value"] = _extract_binding_value(props["value"])

    # Extract enabled state if present
    if "enabled" in node.props:
        outcome["enabled"] = bool(_extract_binding_value(node.props["enabled"]))
    elif "disabled" in node.props:
        outcome["enabled"] = not bool(_extract_binding_value(node.props["disabled"]))
    elif "disabled" in props:
        outcome["enabled"] = not bool(props["disabled"])

    # Extract action if present
    action = props.get("action") or getattr(node, "action", None)
    if action is not None:
        outcome["action"] = normalize_ids(action, ordinals)

    return outcome


def _get_child_nodes(node: ComponentNode) -> list[ComponentNode]:
    """Finds all child ComponentNode instances in declared hierarchy order."""
    children: list[ComponentNode] = []

    if "child" in node.props and is_component_node(node.props["child"]):
        children.append(node.props["child"])

    if "children" in node.props and isinstance(node.props["children"], list):
        for child in node.props["children"]:
            if is_component_node(child):
                children.append(child)

    for key, val in node.props.items():
        if key in ("child", "children"):
            continue
        if is_component_node(val):
            children.append(val)
        elif isinstance(val, list):
            for item in val:
                if is_component_node(item):
                    children.append(item)

    return children


def _walk_tree(
    node: ComponentNode, surface: Any, ordinals: dict[str, dict[str, str]]
) -> list[dict[str, Any]]:
    """Walks the resolved tree depth-first, producing ordered node outcomes."""
    nodes = [_extract_node_outcome(node, surface, ordinals)]
    for child in _get_child_nodes(node):
        nodes.extend(_walk_tree(child, surface, ordinals))
    return nodes


def _load_catalogs(catalog_paths: list[str]) -> list[Catalog]:
    """Loads Catalog objects from repository-relative paths."""
    catalogs: list[Catalog] = []
    for cat_path in catalog_paths:
        full_path = (
            REPO_ROOT / cat_path if not Path(cat_path).is_absolute() else Path(cat_path)
        )
        data = json.loads(full_path.read_text(encoding="utf-8"))
        catalogs.append(Catalog.from_json(data))
    return catalogs


def outcome_of(scenario: dict[str, Any]) -> list[dict[str, Any]]:
    """Calculates the renderer-visible outcome across all turns of an e2e scenario."""
    catalogs = _load_catalogs(scenario.get("catalogPaths", []))
    processor = MessageProcessor(catalogs=catalogs)
    default_catalog = catalogs[0] if catalogs else None

    ordinals: dict[str, dict[str, str]] = {}
    turn_outcomes: list[dict[str, Any]] = []

    for turn in scenario.get("turns", []):
        # 1. Process all a2ui messages for this turn
        for wire_part in turn.get("expectWire", []):
            if isinstance(wire_part, dict) and "a2ui" in wire_part:
                processor.process_messages(wire_part["a2ui"])

        # 2. Extract resolved node trees for all current surfaces
        surfaces_outcome: dict[str, list[dict[str, Any]]] = {}
        for surface_id in sorted(processor.model.surfaces):
            surface = processor.model.get_surface(surface_id)
            if surface is None:
                continue
            cat = surface.default_catalog or default_catalog
            resolver = NodeResolver(surface, catalog=cat)
            root = resolver.root
            norm_surface_id = normalize_ids({"surfaceId": surface_id}, ordinals)[
                "surfaceId"
            ]
            if root is not None:
                surfaces_outcome[norm_surface_id] = _walk_tree(root, surface, ordinals)
            else:
                surfaces_outcome[norm_surface_id] = []

        # 3. Extract and normalize outbound envelopes
        raw_outbound = turn.get("expectOutbound", [])
        normalized_outbound = [normalize_ids(env, ordinals) for env in raw_outbound]

        turn_outcomes.append({
            "surfaces": surfaces_outcome,
            "outbound": normalized_outbound,
        })

    return turn_outcomes
