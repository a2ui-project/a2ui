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
`Card`, `Tabs`, `Divider`, `Text`, `TextField`, `Button`) with the `McpApp`
component and the `callMcpTool`, `transformData` and `updateDataModel`
functions of `@a2ui/catalog-mcp`.
The agent can both push new board state to `/kanban/board` (`updateDataModel`)
and dynamically restructure the surface layout (`updateComponents`), rendering
the `McpApp` and sibling controls inside different basic catalog containers.
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
SELECTION_PATH = "/kanban/selection"
QUICK_ADD_PATH = "/kanban/quickAdd"
QUICK_ADD_TITLE_PATH = f"{QUICK_ADD_PATH}/title"
QUICK_ADD_ASSIGNEE_PATH = f"{QUICK_ADD_PATH}/assignee"

DEFAULT_QUICK_ADD = {"title": "Document MCP catalog", "assignee": "Ana"}

TODO_JMESPATH = (
    "join('', ['Todo: ', to_string(length(columns[?id == 'todo'].cards[]))])"
)
WIP_JMESPATH = (
    "columns[?id == 'review'] | [0] | join('', [title, ' ', "
    "to_string(length(cards)), '/', to_string(wipLimit), "
    "(length(cards) > wipLimit && ' (over limit)' || '')])"
)
DONE_JMESPATH = (
    "join('', ['Done: ', to_string(length(columns[?id == 'done'].cards[]))])"
)
SELECTION_JMESPATH = (
    "(selection.title && join('', ['Selected: ', selection.title, (selection.column &&"
    " join('', [' in ', selection.column]) || ''), (selection.assignee && selection.due"
    " && join('', [' (', selection.assignee, ', due ', selection.due, ')']) ||"
    " selection.assignee && join('', [' (', selection.assignee, ')']) || selection.due"
    " && join('', [' (due ', selection.due, ')']) || '')])) || 'No card selected'"
)
# Writes the board returned by `create_task` to the bound board and hands the
# raw result to the app as its tool result.
CREATE_TASK_JMESPATH = (
    '{"/kanban/board": structuredContent, "/kanban/toolResult": toolResult}'
)

# Tools the board app may call through the host (`tools/call`).
APP_ALLOWED_TOOLS = ["move_task", "create_task", "assign_task", "list_board"]

# Binding keys of the `McpApp`. `toolResult` and `modelContext` are reserved
# keys of the host: the former is delivered to the app as
# `ui/notifications/tool-result`, the latter receives `ui/update-model-context`.
APP_DATA_PATHS = {
    "board": BOARD_PATH,
    "toolResult": "/kanban/toolResult",
    "modelContext": "/kanban/modelContext",
    "selection": SELECTION_PATH,
}

LAYOUT_NAMES = ("default", "cards", "tabs", "split")


def _mcp_call(name: str, args: dict[str, Any]) -> dict[str, Any]:
    """Builds an `@call` invocation against the MCP catalog."""
    return {
        "@call": name,
        "catalogId": MCP_CATALOG_ID,
        "args": args,
    }


def _text(
    component_id: str,
    text_value: str | dict[str, Any],
    *,
    literal: bool = False,
    variant: str = "",
) -> dict[str, Any]:
    comp: dict[str, Any] = {
        "id": component_id,
        "component": "Text",
        "text": (
            text_value
            if literal or isinstance(text_value, dict)
            else {"@path": text_value}
        ),
    }
    if variant:
        comp["variant"] = variant
    return comp


def _transform(data: dict[str, Any], jmespath: str) -> dict[str, Any]:
    """`transformData` evaluating `jmespath` against `data`."""
    return _mcp_call("transformData", {"jmespath": jmespath, "data": data})


def _bound_leaf_components() -> list[dict[str, Any]]:
    """Declarative sibling `Text` badges, behind-the-scenes captions, and Quick-Add bar."""
    return [
        _text(
            "summary_caption",
            "Counts and selection are computed from the board data and update"
            " live as you move or select cards.",
            literal=True,
            variant="caption",
        ),
        _text(
            "todo_count",
            _transform({"@path": BOARD_PATH}, TODO_JMESPATH),
        ),
        _text(
            "wip_badge",
            _transform({"@path": BOARD_PATH}, WIP_JMESPATH),
        ),
        _text(
            "done_count",
            _transform({"@path": BOARD_PATH}, DONE_JMESPATH),
        ),
        _text(
            "selection_text",
            _transform({"@path": "/kanban"}, SELECTION_JMESPATH),
        ),
        {
            "id": "quick_add_card",
            "component": "Card",
            "child": "quick_add_col",
        },
        {
            "id": "quick_add_col",
            "component": "Column",
            "children": ["quick_add_caption", "quick_add_row"],
            "align": "stretch",
        },
        _text(
            "quick_add_caption",
            "Add a task directly: the button calls the create_task tool and the"
            " board updates in place, without a round trip to the agent.",
            literal=True,
            variant="caption",
        ),
        {
            "id": "quick_add_row",
            "component": "Row",
            "children": [
                "quick_add_title",
                "quick_add_assignee",
                "quick_add_button",
            ],
            "align": "center",
        },
        {
            "id": "quick_add_title",
            "component": "TextField",
            "label": "Task title",
            "value": {"@path": QUICK_ADD_TITLE_PATH},
            "weight": 3,
        },
        {
            "id": "quick_add_assignee",
            "component": "TextField",
            "label": "Assignee",
            "value": {"@path": QUICK_ADD_ASSIGNEE_PATH},
            "weight": 1,
        },
        {
            "id": "quick_add_button",
            "component": "Button",
            "child": "quick_add_button_label",
            "variant": "primary",
            "action": {
                "functionCall": _mcp_call(
                    "updateDataModel",
                    {
                        "updates": _transform(
                            _mcp_call(
                                "callMcpTool",
                                {
                                    "name": "create_task",
                                    "arguments": {
                                        "title": {"@path": QUICK_ADD_TITLE_PATH},
                                        "assignee": {"@path": QUICK_ADD_ASSIGNEE_PATH},
                                    },
                                },
                            ),
                            CREATE_TASK_JMESPATH,
                        ),
                    },
                ),
            },
        },
        _text(
            "quick_add_button_label",
            "Add task",
            literal=True,
        ),
        _text(
            "board_caption",
            "The board is an MCP App running in a sandboxed iframe. It shares"
            " its data with the counts and selection above.",
            literal=True,
            variant="caption",
        ),
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
                    "summary_caption",
                    "metrics_row",
                    "selection_card",
                    "quick_add_card",
                    "board_divider",
                    "board_caption",
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
                "children": ["quick_add_card", "board_caption", "board_card"],
                "align": "stretch",
            },
            {"id": "board_card", "component": "Card", "child": "board"},
            {
                "id": "details_tab",
                "component": "Column",
                "children": [
                    "details_heading",
                    "summary_caption",
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
                "children": ["inspector_card", "board_col"],
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
                    "summary_caption",
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
            {
                "id": "board_col",
                "component": "Column",
                "children": ["quick_add_card", "board_caption", "board_card"],
                "align": "stretch",
                "weight": 3,
            },
            {"id": "board_card", "component": "Card", "child": "board"},
            *leaves,
        ]

    return [
        {
            "id": "root",
            "component": "Column",
            "children": [
                "summary_caption",
                "summary",
                "selection_text",
                "quick_add_card",
                "board_caption",
                "board",
            ],
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

    leaf_by_id = {leaf["id"]: leaf for leaf in _bound_leaf_components()}
    added_missing = True
    while added_missing:
        added_missing = False
        for ref_id in list(referenced):
            if ref_id in leaf_by_id and ref_id not in by_id:
                leaf = copy.deepcopy(leaf_by_id[ref_id])
                prepared.append(leaf)
                by_id[ref_id] = leaf
                referenced.update(_referenced_child_ids([leaf]))
                added_missing = True

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
                    "quickAdd": dict(DEFAULT_QUICK_ADD),
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
