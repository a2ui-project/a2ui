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

"""Board actions shared by the scripted and the Gemini agents.

Each action calls the MCP server and returns the texts and A2UI messages for
the turn: opening the board sends the surface, layout changes send an
`updateComponents` message built from `basicCatalog` components (`Column`,
`Row`, `Card`, `Tabs`, `Divider`, `Text`) wrapping the `McpApp`, and every
board mutation sends an `updateDataModel` for `/kanban/board` (channel A).
Per-session state (whether the surface is open) lives in a dict the caller
owns, so the Gemini agent can keep it in the ADK session state and the
scripted agent in memory.
"""

from __future__ import annotations

import asyncio
from typing import Any, MutableMapping

from a2ui_messages import (
    board_surface_messages,
    board_update_message,
    layout_update_message,
    normalize_layout_name,
)
from kanban_mcp import Board, BoardClient
from turns import TurnOutput

SURFACE_OPEN_KEY = "kanban:surface_open"
SURFACE_LAYOUT_KEY = "kanban:surface_layout"


class BoardActions:
    """Board operations that also produce what the surface needs."""

    def __init__(self, mcp: BoardClient):
        self._mcp = mcp
        self._lock = asyncio.Lock()

    async def show_board(
        self, state: MutableMapping[str, Any], layout: str = ""
    ) -> tuple[Board, TurnOutput]:
        """Opens (or refreshes) the board surface with the current board."""
        async with self._lock:
            chosen_layout = (
                normalize_layout_name(layout)
                if layout.strip()
                else str(state.get(SURFACE_LAYOUT_KEY, "default"))
            )
            state[SURFACE_LAYOUT_KEY] = chosen_layout
            board = await self._mcp.call_tool("open_board", {})
            if state.get(SURFACE_OPEN_KEY):
                return board, TurnOutput(
                    a2ui_messages=[
                        board_update_message(board),
                        layout_update_message(layout=chosen_layout),
                    ]
                )
            html = await self._mcp.read_board_app()
            state[SURFACE_OPEN_KEY] = True
            return board, TurnOutput(
                a2ui_messages=board_surface_messages(html, board, layout=chosen_layout)
            )

    async def update_layout(
        self,
        state: MutableMapping[str, Any],
        layout: str = "default",
        custom_components: list[dict[str, Any]] | None = None,
    ) -> TurnOutput:
        """Updates the basic-catalog surface layout that wraps the `McpApp` board."""
        async with self._lock:
            chosen_layout = normalize_layout_name(layout)
            if not custom_components:
                state[SURFACE_LAYOUT_KEY] = chosen_layout
            if not state.get(SURFACE_OPEN_KEY):
                board = await self._mcp.call_tool("open_board", {})
                html = await self._mcp.read_board_app()
                state[SURFACE_OPEN_KEY] = True
                return TurnOutput(
                    a2ui_messages=board_surface_messages(
                        html,
                        board,
                        layout=chosen_layout,
                        custom_components=custom_components,
                    )
                )
            return TurnOutput(
                a2ui_messages=[
                    layout_update_message(
                        layout=chosen_layout, custom_components=custom_components
                    )
                ]
            )

    async def list_board(self) -> Board:
        return await self._mcp.call_tool("list_board", {})

    async def mutate(
        self, state: MutableMapping[str, Any], tool: str, arguments: dict[str, Any]
    ) -> tuple[Board, TurnOutput]:
        """Runs a mutating tool and returns the board update for the surface.

        When the surface is not open yet, the whole surface is sent instead so
        the user sees the result of the first mutation.
        """
        async with self._lock:
            board = await self._mcp.call_tool(tool, arguments)
            if not state.get(SURFACE_OPEN_KEY):
                html = await self._mcp.read_board_app()
                state[SURFACE_OPEN_KEY] = True
                return board, TurnOutput(
                    a2ui_messages=board_surface_messages(html, board)
                )
            return board, TurnOutput(a2ui_messages=[board_update_message(board)])
