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

"""The Gemini agent: an ADK `LlmAgent` whose tools wrap the MCP server.

The tools return a short result to the model and append the A2UI messages for
the surface to a per-session inbox, which `GeminiKanbanAgent.run` drains into
the turn output alongside the model's final text, so the model never has to
produce A2UI JSON itself.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from google.adk.agents.llm_agent import LlmAgent
from google.adk.models import Gemini
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools.tool_context import ToolContext
from google.genai import types

from board_actions import BoardActions
from kanban_mcp import BoardClient, McpToolError
from prompts import INSTRUCTION
from turns import TurnInput, TurnOutput

logger = logging.getLogger(__name__)

APP_NAME = "kanban_agent"
USER_ID = "chat_host"


def build_tools(
    actions: BoardActions,
    emit: Callable[[str, list[dict[str, Any]]], None],
) -> list[Any]:
    """The ADK function tools of the agent, closed over the board actions."""

    def _stash(tool_context: ToolContext, output: TurnOutput) -> None:
        if output.a2ui_messages:
            emit(tool_context.session.id, output.a2ui_messages)

    async def show_board(tool_context: ToolContext) -> dict[str, Any]:
        """Shows the interactive Kanban board to the user and returns its content."""
        board, output = await actions.show_board(tool_context.state)
        _stash(tool_context, output)
        return {"status": "The board is now displayed to the user.", "board": board}

    async def list_board() -> dict[str, Any]:
        """Returns the current board: columns with WIP limits and their cards."""
        return {"board": await actions.list_board()}

    async def move_task(
        task_id: str, to_column: str, tool_context: ToolContext
    ) -> dict[str, Any]:
        """Moves a task to another column.

        Args:
          task_id: The id of the task, such as "t1".
          to_column: The target column id or title, such as "review" or "Done".
        """
        return await _mutate(
            tool_context, "move_task", {"taskId": task_id, "toColumn": to_column}
        )

    async def create_task(
        title: str,
        tool_context: ToolContext,
        column: str = "todo",
        assignee: str = "",
        due: str = "",
    ) -> dict[str, Any]:
        """Adds a task to the board.

        Args:
          title: The title of the new task.
          column: The column id or title; "todo" by default.
          assignee: Who owns the task; empty for nobody.
          due: Due date as YYYY-MM-DD; empty for none.
        """
        arguments: dict[str, Any] = {"title": title, "column": column}
        if assignee:
            arguments["assignee"] = assignee
        if due:
            arguments["due"] = due
        return await _mutate(tool_context, "create_task", arguments)

    async def assign_task(
        task_id: str, assignee: str, tool_context: ToolContext
    ) -> dict[str, Any]:
        """Changes who owns a task.

        Args:
          task_id: The id of the task, such as "t3".
          assignee: The new owner.
        """
        return await _mutate(
            tool_context, "assign_task", {"taskId": task_id, "assignee": assignee}
        )

    async def _mutate(
        tool_context: ToolContext, tool: str, arguments: dict[str, Any]
    ) -> dict[str, Any]:
        try:
            board, output = await actions.mutate(tool_context.state, tool, arguments)
        except McpToolError as error:
            return {"error": str(error)}
        _stash(tool_context, output)
        return {"status": "Done; the user sees the updated board.", "board": board}

    return [show_board, list_board, move_task, create_task, assign_task]


def turn_prompt(turn: TurnInput) -> str:
    """The text the model receives: the user's words plus the app state."""
    sections = [turn.text or "(no text)"]
    event = turn.app_event()
    if event is not None:
        sections.append("Event from the board app: " + json.dumps(event))
    context = turn.model_context()
    if context is not None:
        sections.append("Current board app state: " + json.dumps(context))
    return "\n\n".join(sections)


class GeminiKanbanAgent:
    """Runs the ADK agent for one turn at a time, keyed by A2A context id."""

    def __init__(self, mcp: BoardClient, model: str):
        self._session_service = InMemorySessionService()
        self._pending_messages: dict[str, list[dict[str, Any]]] = {}

        def emit(session_id: str, messages: list[dict[str, Any]]) -> None:
            self._pending_messages.setdefault(session_id, []).extend(messages)

        self._runner = Runner(
            app_name=APP_NAME,
            agent=LlmAgent(
                model=Gemini(model=model),
                name=APP_NAME,
                description="Manages a sprint Kanban board through MCP tools.",
                instruction=INSTRUCTION,
                tools=build_tools(BoardActions(mcp), emit),
            ),
            session_service=self._session_service,
        )

    async def run(self, turn: TurnInput) -> TurnOutput:
        session = await self._session_service.get_session(
            app_name=APP_NAME, user_id=USER_ID, session_id=turn.session_id
        )
        if session is None:
            await self._session_service.create_session(
                app_name=APP_NAME, user_id=USER_ID, session_id=turn.session_id
            )
        self._pending_messages.pop(turn.session_id, None)
        output = TurnOutput()
        async for event in self._runner.run_async(
            user_id=USER_ID,
            session_id=turn.session_id,
            new_message=types.Content(
                role="user", parts=[types.Part.from_text(text=turn_prompt(turn))]
            ),
        ):
            if event.is_final_response() and event.content and event.content.parts:
                for part in event.content.parts:
                    if part.text and not part.thought:
                        output.texts.append(part.text)
        output.a2ui_messages.extend(self._pending_messages.pop(turn.session_id, []))
        if not output.texts and not output.a2ui_messages:
            output.texts.append(
                "I did not get a response from the model; please try again."
            )
        return output
