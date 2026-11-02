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

"""The A2UI v1.0 messages the agent sends.

The surface mixes `basicCatalog` layout and display components (`Column`, `Row`,
`Card`, `Tabs`, `Divider`, `Text`) with the `McpApp` component (`id: "board"`)
that hosts the interactive Kanban board resource and its `data.paths` bindings.
The agent can both push new board state to `/kanban/board` (`updateDataModel`)
and dynamically restructure the surface layout (`updateComponents`), rendering
the `McpApp` inside different basic catalog containers.
"""

from __future__ import annotations

import copy
import urllib.parse
from typing import Any

SURFACE_ID = "kanban"
BASIC_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
MCP_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json"
PROTOCOL_VERSION = "1.0"

BOARD_PATH = "/kanban/board"

# Tools the board app may call through the host (`tools/call`).
APP_ALLOWED_TOOLS = ["move_task", "create_task", "assign_task", "list_board"]

# Binding keys of the `McpApp`. `toolResult` and `modelContext` are reserved
# keys of the host: the former is delivered to the app as
# `ui/notifications/tool-result`, the latter receives `ui/update-model-context`.
APP_DATA_PATHS = {
    "board": BOARD_PATH,
    "toolResult": "/kanban/toolResult",
    "modelContext": "/kanban/modelContext",
    "selection": "/kanban/selection",
}

LAYOUT_NAMES = ("default", "cards", "tabs", "split")


def _text(
    component_id: str, path_or_literal: str, *, literal: bool = False, variant: str = ""
) -> dict[str, Any]:
    comp: dict[str, Any] = {
        "id": component_id,
        "component": "Text",
        "text": path_or_literal if literal else {"@path": path_or_literal},
    }
    if variant:
        comp["variant"] = variant
    return comp


def _bound_leaf_components() -> list[dict[str, Any]]:
    """Standard `Text` components bound to `/kanban/summary/*`."""
    return [
        _text("todo_count", "/kanban/summary/todoText"),
        _text("wip_badge", "/kanban/summary/wipText"),
        _text("done_count", "/kanban/summary/doneText"),
        _text("selection_text", "/kanban/summary/selectionText"),
    ]


def _mcp_app_component(app_html: str) -> dict[str, Any]:
    """The `McpApp` component that embeds the Kanban board inside the surface."""
    return {
        "id": "board",
        "component": "McpApp",
        "catalogId": MCP_CATALOG_ID,
        "title": "Kanban board",
        "htmlContent": "url_encoded:" + urllib.parse.quote(app_html),
        "allowedTools": APP_ALLOWED_TOOLS,
        "data": {"paths": dict(APP_DATA_PATHS)},
    }


def normalize_layout_name(layout: str) -> str:
    """Maps user/model layout descriptions to one of the canonical layout presets."""
    cleaned = layout.strip().lower()
    if cleaned in ("tab", "tabs", "tabbed"):
        return "tabs"
    if cleaned in ("card", "cards", "dashboard"):
        return "cards"
    if cleaned in ("split", "sidebar", "inspector", "side-by-side", "two-column"):
        return "split"
    return "default"


def layout_components(layout: str = "default") -> list[dict[str, Any]]:
    """Basic catalog components for a named layout preset embedding `board` (`McpApp`)."""
    preset = normalize_layout_name(layout)
    leaves = _bound_leaf_components()

    if preset == "cards":
        return [
            {
                "id": "root",
                "component": "Column",
                "children": [
                    "metrics_row",
                    "selection_card",
                    "board_divider",
                    "board_card",
                ],
                "align": "stretch",
            },
            {
                "id": "metrics_row",
                "component": "Row",
                "children": ["todo_card", "wip_card", "done_card"],
                "justify": "spaceBetween",
                "align": "stretch",
            },
            {
                "id": "todo_card",
                "component": "Card",
                "child": "todo_count",
                "weight": 1,
            },
            {"id": "wip_card", "component": "Card", "child": "wip_badge", "weight": 1},
            {
                "id": "done_card",
                "component": "Card",
                "child": "done_count",
                "weight": 1,
            },
            {"id": "selection_card", "component": "Card", "child": "selection_text"},
            {"id": "board_divider", "component": "Divider", "axis": "horizontal"},
            {"id": "board_card", "component": "Card", "child": "board"},
            *leaves,
        ]

    if preset == "tabs":
        return [
            {
                "id": "root",
                "component": "Column",
                "children": ["workspace_tabs"],
                "align": "stretch",
            },
            {
                "id": "workspace_tabs",
                "component": "Tabs",
                "tabs": [
                    {"title": "Sprint Board", "child": "board_tab"},
                    {"title": "Sprint Summary & Selection", "child": "details_tab"},
                ],
            },
            {
                "id": "board_tab",
                "component": "Column",
                "children": ["board_card"],
                "align": "stretch",
            },
            {"id": "board_card", "component": "Card", "child": "board"},
            {
                "id": "details_tab",
                "component": "Column",
                "children": [
                    "details_heading",
                    "metrics_card",
                    "details_divider",
                    "selection_card",
                ],
                "align": "stretch",
            },
            _text(
                "details_heading",
                "Live Sprint Telemetry",
                literal=True,
                variant="caption",
            ),
            {"id": "metrics_card", "component": "Card", "child": "metrics_col"},
            {
                "id": "metrics_col",
                "component": "Column",
                "children": ["todo_count", "wip_badge", "done_count"],
                "align": "stretch",
            },
            {"id": "details_divider", "component": "Divider", "axis": "horizontal"},
            {"id": "selection_card", "component": "Card", "child": "selection_text"},
            *leaves,
        ]

    if preset == "split":
        return [
            {
                "id": "root",
                "component": "Row",
                "children": ["inspector_card", "board_card"],
                "justify": "spaceBetween",
                "align": "start",
            },
            {
                "id": "inspector_card",
                "component": "Card",
                "child": "inspector_col",
                "weight": 1,
            },
            {
                "id": "inspector_col",
                "component": "Column",
                "children": [
                    "inspector_title",
                    "inspector_divider_1",
                    "todo_count",
                    "wip_badge",
                    "done_count",
                    "inspector_divider_2",
                    "selection_heading",
                    "selection_text",
                ],
                "align": "stretch",
            },
            _text(
                "inspector_title",
                "Sprint Inspector",
                literal=True,
                variant="caption",
            ),
            {"id": "inspector_divider_1", "component": "Divider", "axis": "horizontal"},
            {"id": "inspector_divider_2", "component": "Divider", "axis": "horizontal"},
            _text(
                "selection_heading",
                "Selected Card",
                literal=True,
                variant="caption",
            ),
            {"id": "board_card", "component": "Card", "child": "board", "weight": 3},
            *leaves,
        ]

    return [
        {
            "id": "root",
            "component": "Column",
            "children": ["summary", "selection_text", "board"],
            "align": "stretch",
        },
        {
            "id": "summary",
            "component": "Row",
            "children": ["todo_count", "wip_badge", "done_count"],
            "justify": "spaceBetween",
        },
        *leaves,
    ]


def _referenced_child_ids(components: list[dict[str, Any]]) -> set[str]:
    referenced: set[str] = set()
    for comp in components:
        child = comp.get("child")
        if isinstance(child, str):
            referenced.add(child)
        children = comp.get("children")
        if isinstance(children, list):
            for item in children:
                if isinstance(item, str):
                    referenced.add(item)
        tabs = comp.get("tabs")
        if isinstance(tabs, list):
            for tab in tabs:
                if isinstance(tab, dict) and isinstance(tab.get("child"), str):
                    referenced.add(tab["child"])
    return referenced


def prepare_custom_components(
    custom_components: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Normalizes custom basic-catalog components so `root` and `board` are always valid."""
    prepared = [
        copy.deepcopy(c)
        for c in custom_components
        if isinstance(c, dict)
        and isinstance(c.get("id"), str)
        and c.get("id") != "board"
    ]
    by_id = {c["id"]: c for c in prepared}
    if "root" not in by_id:
        return layout_components("default")

    referenced = _referenced_child_ids(prepared)
    if "board" not in referenced:
        root = by_id["root"]
        if isinstance(root.get("children"), list):
            root["children"].append("board")
            referenced.add("board")
        else:
            previous_root_copy = copy.deepcopy(root)
            previous_root_copy["id"] = "custom_header"
            prepared.append(previous_root_copy)
            by_id["root"] = {
                "id": "root",
                "component": "Column",
                "children": ["custom_header", "board"],
                "align": "stretch",
            }
            for idx, comp in enumerate(prepared):
                if comp["id"] == "root":
                    prepared[idx] = by_id["root"]
                    break
            referenced.update({"custom_header", "board"})

    for leaf in _bound_leaf_components():
        leaf_id = leaf["id"]
        if leaf_id in referenced and leaf_id not in by_id:
            prepared.append(leaf)

    return prepared


def board_surface_messages(
    app_html: str,
    board: dict[str, Any],
    *,
    layout: str = "default",
    custom_components: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """The messages that create the board surface with the app and its basic-catalog layout."""
    basic_components = (
        prepare_custom_components(custom_components)
        if custom_components
        else layout_components(layout)
    )
    return [
        {
            "version": PROTOCOL_VERSION,
            "createSurface": {"surfaceId": SURFACE_ID, "catalogId": BASIC_CATALOG_ID},
        },
        {
            "version": PROTOCOL_VERSION,
            "updateDataModel": {
                "surfaceId": SURFACE_ID,
                "path": "/kanban",
                "value": {
                    "board": board,
                    "toolResult": board,
                    "selection": None,
                    "summary": {
                        "todoText": "",
                        "doneText": "",
                        "wipText": "",
                        "selectionText": "No card selected",
                    },
                },
            },
        },
        {
            "version": PROTOCOL_VERSION,
            "updateComponents": {
                "surfaceId": SURFACE_ID,
                "components": [
                    *basic_components,
                    _mcp_app_component(app_html),
                ],
            },
        },
    ]


def layout_update_message(
    layout: str = "default",
    custom_components: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """An `updateComponents` message that restructures the basic catalog layout around `board`."""
    basic_components = (
        prepare_custom_components(custom_components)
        if custom_components
        else layout_components(layout)
    )
    return {
        "version": PROTOCOL_VERSION,
        "updateComponents": {
            "surfaceId": SURFACE_ID,
            "components": basic_components,
        },
    }


def board_update_message(board: dict[str, Any]) -> dict[str, Any]:
    """The `updateDataModel` that pushes a new board to the surface (channel A)."""
    return {
        "version": PROTOCOL_VERSION,
        "updateDataModel": {
            "surfaceId": SURFACE_ID,
            "path": BOARD_PATH,
            "value": board,
        },
    }
