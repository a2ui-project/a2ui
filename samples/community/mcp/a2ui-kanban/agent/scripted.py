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

"""The deterministic agent behind `KANBAN_AGENT=scripted`.

It follows the README storyline with an intent matcher instead of a model, so
the demo and the client tests run without an API key. It exercises the same
`BoardActions` and MCP tools as the Gemini agent.
"""

from __future__ import annotations

import re
from typing import Any

from a2ui_messages import normalize_layout_name
from board_actions import BoardActions
from kanban_mcp import (
    Board,
    BoardClient,
    columns_over_limit,
    find_column,
    find_task,
    find_task_by_title,
)
from turns import TurnInput, TurnOutput

PENDING_SPLIT_KEY = "kanban:pending_split"

_LAYOUT = re.compile(
    r"\b(?:layout|arrange|rearrange|switch to|put .* in|wrap .* in|use)\b.*"
    r"\b(?P<layout>tabs?|tabbed|cards?|dashboard|split|sidebar|inspector|default|stacked)\b"
    r"|\b(?P<layout_alt>tabs?|cards?|split|sidebar|inspector|default)\s+layout\b",
    re.I,
)
_SHOW = re.compile(r"\b(show|open|display|see)\b.*\bboard\b|\bsprint board\b", re.I)
_MOVE = re.compile(
    r"\bmove\b\s+(?P<title>.+?)\s+(?:back\s+)?(?:to|into)\s+(?P<column>[\w ]+?)[.!?]?$",
    re.I,
)
_SELECTED = re.compile(r"\bselected\b", re.I)
_YES = re.compile(r"^\s*(yes|yep|sure|ok|okay|do it|go ahead|please do)\b", re.I)
_PERSON = re.compile(r"\b(?P<name>Ana|Ben|Chloe)\b", re.I)

HELP = (
    "I can show the sprint board, change the surface layout (tabs, cards,"
    " split, or default), move or create cards, tell you about the selected"
    " card, and list what someone is working on."
)

_LAYOUT_DESCRIPTIONS = {
    "default": (
        "Switched the surface to the default stacked Column layout with a"
        " summary Row above the MCP App."
    ),
    "cards": (
        "Updated the surface to the Cards layout: the Todo/WIP/Done counters,"
        " selection status, and the MCP App board are now wrapped in Basic"
        " Catalog Card and Divider components."
    ),
    "tabs": (
        "Updated the surface to use Basic Catalog Tabs: 'Sprint Board' embeds"
        " the MCP App inside a Card, and 'Sprint Summary & Selection' displays"
        " the bound telemetry Cards."
    ),
    "split": (
        "Updated the surface to a side-by-side Row layout with a Basic Catalog"
        " 'Sprint Inspector' Card next to the MCP App Card."
    ),
}


def split_proposal(card: dict[str, Any]) -> list[str]:
    """Three subtasks for a card; deterministic so the storyline is repeatable."""
    title = card.get("title", "task")
    return [f"Plan {title}", f"Implement {title}", f"Verify {title}"]


def _column_title(column: dict[str, Any] | None) -> str:
    return str(column.get("title")) if column else "the board"


class ScriptedKanbanAgent:
    """Intent matcher over the storyline; see the README's "Try it" section."""

    def __init__(self, mcp: BoardClient):
        self._actions = BoardActions(mcp)
        self._sessions: dict[str, dict[str, Any]] = {}

    def _state(self, session_id: str) -> dict[str, Any]:
        return self._sessions.setdefault(session_id, {})

    async def run(self, turn: TurnInput) -> TurnOutput:
        state = self._state(turn.session_id)
        event = turn.app_event()
        if event is not None:
            return await self._handle_app_event(state, event)
        text = turn.text.strip()
        if match := _LAYOUT.search(text):
            raw_layout = match.group("layout") or match.group("layout_alt") or "default"
            preset = normalize_layout_name(raw_layout)
            output = await self._actions.update_layout(state, layout=preset)
            output.texts.append(_LAYOUT_DESCRIPTIONS[preset])
            return output
        if _SHOW.search(text):
            _, output = await self._actions.show_board(state)
            output.texts.append(
                "Here is the sprint board. Drag a card, click one to select it,"
                " or ask me to move things around."
            )
            return output
        if _YES.match(text) and state.get(PENDING_SPLIT_KEY):
            return await self._create_split(state)
        if match := _MOVE.search(text):
            return await self._move(state, match.group("title"), match.group("column"))
        if _SELECTED.search(text):
            return self._describe_selection(turn)
        if match := _PERSON.search(text):
            return await self._workload(match.group("name").capitalize())
        return TurnOutput(texts=[HELP])

    async def _handle_app_event(
        self, state: dict[str, Any], event: dict[str, Any]
    ) -> TurnOutput:
        kind = event.get("event")
        if kind == "moved":
            board = await self._actions.list_board()
            found = find_task(board, str(event.get("taskId")))
            title = found[0].get("title") if found else event.get("taskId")
            to_column = _column_title(find_column(board, str(event.get("to"))))
            over = columns_over_limit(board)
            if over:
                column = over[0]
                return TurnOutput(
                    texts=[
                        f"{column['title']} now has {len(column['cards'])} cards, over"
                        f" its WIP limit of {column['wipLimit']}. Want me to move one"
                        " back?"
                    ]
                )
            return TurnOutput(texts=[f"Noted: {title} is now in {to_column}."])
        if kind == "split-request":
            task = event.get("task") or {}
            proposal = split_proposal(task)
            state[PENDING_SPLIT_KEY] = {"task": task, "subtasks": proposal}
            listed = ", ".join(f'"{item}"' for item in proposal)
            return TurnOutput(
                texts=[
                    f'I would split "{task.get("title")}" into {listed}. Shall I create'
                    " them?"
                ]
            )
        return TurnOutput(
            texts=[f"The board app sent an event I do not handle: {kind}."]
        )

    async def _move(
        self, state: dict[str, Any], title: str, column_name: str
    ) -> TurnOutput:
        board = await self._actions.list_board()
        found = find_task_by_title(board, title.strip(" \"'"))
        if not found:
            return TurnOutput(texts=[f'I could not find a card called "{title}".'])
        card, _ = found
        column = find_column(board, column_name)
        if not column:
            return TurnOutput(texts=[f'There is no column called "{column_name}".'])
        new_board, output = await self._actions.mutate(
            state, "move_task", {"taskId": card["id"], "toColumn": column["id"]}
        )
        output.texts.append(f"Moved {card['title']} to {column['title']}.")
        return self._with_wip_note(new_board, output)

    def _describe_selection(self, turn: TurnInput) -> TurnOutput:
        context = turn.model_context() or {}
        selection = context.get("selection")
        if not isinstance(selection, dict):
            return TurnOutput(
                texts=["No card is selected. Click one on the board and ask again."]
            )
        owner = selection.get("assignee") or "nobody"
        due = selection.get("due") or "no date"
        return TurnOutput(
            texts=[
                f"{selection.get('title')} is owned by {owner} and due {due}"
                f" (in {selection.get('column', 'the board')})."
            ]
        )

    async def _workload(self, name: str) -> TurnOutput:
        board = await self._actions.list_board()
        open_cards = [
            f"{card['title']} ({column['title']}, due {card.get('due', 'n/a')})"
            for column in board.get("columns", [])
            if column.get("id") != "done"
            for card in column.get("cards", [])
            if card.get("assignee") == name
        ]
        if not open_cards:
            return TurnOutput(texts=[f"{name} has nothing open."])
        return TurnOutput(texts=[f"{name} still has: " + "; ".join(open_cards) + "."])

    async def _create_split(self, state: dict[str, Any]) -> TurnOutput:
        pending = state.pop(PENDING_SPLIT_KEY)
        task = pending["task"]
        board = await self._actions.list_board()
        found = find_task(board, str(task.get("id")))
        column = found[1]["id"] if found else "todo"
        output = TurnOutput()
        for subtask in pending["subtasks"]:
            arguments: dict[str, Any] = {"title": subtask, "column": column}
            if task.get("assignee"):
                arguments["assignee"] = task["assignee"]
            if task.get("due"):
                arguments["due"] = task["due"]
            _, step = await self._actions.mutate(state, "create_task", arguments)
            output = step
        output.texts.append(
            f"Created {len(pending['subtasks'])} subtasks next to {task.get('title')}."
        )
        return output

    @staticmethod
    def _with_wip_note(board: Board, output: TurnOutput) -> TurnOutput:
        for column in columns_over_limit(board):
            output.texts.append(
                f"Heads up: {column['title']} has {len(column['cards'])} cards, over"
                f" its WIP limit of {column['wipLimit']}."
            )
        return output
