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

The surface is one `Column`: a `Row` of sibling `Text` components bound to
`/kanban/summary/*` (which the chat host derives from the board) and the
`McpApp` that hosts the board resource with its `data.paths` bindings. The
agent only ever writes `/kanban/board`; everything else is derived by the host
or written by the app.
"""

from __future__ import annotations

import urllib.parse
from typing import Any

SURFACE_ID = "kanban"
BASIC_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
MCP_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json"
PROTOCOL_VERSION = "v1.0"

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


def _text(component_id: str, path: str) -> dict[str, Any]:
    return {"id": component_id, "component": "Text", "text": {"@path": path}}


def board_surface_messages(
    app_html: str, board: dict[str, Any]
) -> list[dict[str, Any]]:
    """The messages that create the board surface with the app and its siblings."""
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
                    _text("todo_count", "/kanban/summary/todoText"),
                    _text("wip_badge", "/kanban/summary/wipText"),
                    _text("done_count", "/kanban/summary/doneText"),
                    _text("selection_text", "/kanban/summary/selectionText"),
                    {
                        "id": "board",
                        "component": "McpApp",
                        "catalogId": MCP_CATALOG_ID,
                        "title": "Kanban board",
                        "htmlContent": "url_encoded:" + urllib.parse.quote(app_html),
                        "allowedTools": APP_ALLOWED_TOOLS,
                        "data": {"paths": dict(APP_DATA_PATHS)},
                    },
                ],
            },
        },
    ]


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
