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

"""The agent's MCP client to the Kanban server (Streamable HTTP).

Both the agent and the board app mutate the board through the same MCP tools,
so the server stays the single source of truth. This module is the agent's
side of it; `tools.py` wraps it for the LLM and `scripted.py` drives it
directly.
"""

from __future__ import annotations

import json
import os
from typing import Any, Protocol

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

DEFAULT_MCP_URL = "http://localhost:8788/mcp"
BOARD_RESOURCE_URI = "ui://kanban/board"

Board = dict[str, Any]


class BoardClient(Protocol):
    """What the agents need from the MCP server; tests provide a fake."""

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Board:
        """Calls a board tool and returns the board it responded with."""

    async def read_board_app(self) -> str:
        """Returns the HTML of the `ui://kanban/board` MCP App resource."""


class McpToolError(Exception):
    """The server answered a tool call with `isError`."""


def mcp_url_from_env() -> str:
    return os.getenv("KANBAN_MCP_URL", DEFAULT_MCP_URL)


class KanbanMcp:
    """Streamable HTTP client that opens one session per call.

    The server is stateless, so a session per call keeps the agent free of
    connection lifecycle concerns.
    """

    def __init__(self, url: str | None = None):
        self._url = url or mcp_url_from_env()

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Board:
        async with streamable_http_client(self._url) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(name, arguments=arguments)
        if result.is_error:
            raise McpToolError(_text_of(result.content) or f"{name} failed")
        if isinstance(result.structured_content, dict):
            return result.structured_content
        text = _text_of(result.content)
        if text:
            return json.loads(text)
        raise McpToolError(f"{name} returned no board")

    async def read_board_app(self) -> str:
        async with streamable_http_client(self._url) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.read_resource(BOARD_RESOURCE_URI)
        for content in result.contents:
            text = getattr(content, "text", None)
            if isinstance(text, str):
                return text
        raise McpToolError(f"{BOARD_RESOURCE_URI} has no text content")


def _text_of(content: list[Any] | None) -> str:
    if not content:
        return ""
    for block in content:
        text = getattr(block, "text", None)
        if isinstance(text, str):
            return text
    return ""


def find_task(
    board: Board | None, task_id: str
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """Returns `(card, column)` for a task id, or None."""
    if not isinstance(board, dict):
        return None
    for column in board.get("columns", []):
        for card in column.get("cards", []):
            if card.get("id") == task_id:
                return card, column
    return None


def find_task_by_title(
    board: Board | None, title: str
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """Returns `(card, column)` for the first card whose title contains `title`."""
    if not isinstance(board, dict):
        return None
    wanted = title.strip().lower()
    if not wanted:
        return None
    for column in board.get("columns", []):
        for card in column.get("cards", []):
            if wanted in str(card.get("title", "")).lower():
                return card, column
    return None


def find_column(board: Board | None, name: str) -> dict[str, Any] | None:
    """Returns the column whose id or title matches `name`, case-insensitively."""
    if not isinstance(board, dict):
        return None
    wanted = name.strip().lower().replace(" ", "_")
    for column in board.get("columns", []):
        if (
            column.get("id") == wanted
            or str(column.get("title", "")).lower() == name.strip().lower()
        ):
            return column
    return None


def columns_over_limit(board: Board | None) -> list[dict[str, Any]]:
    """The columns holding more cards than their WIP limit."""
    if not isinstance(board, dict):
        return []
    return [
        column
        for column in board.get("columns", [])
        if column.get("wipLimit") is not None
        and len(column.get("cards", [])) > column["wipLimit"]
    ]
