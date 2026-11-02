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

"""Tests of the scripted agent against an in-memory stand-in for the MCP server."""

from __future__ import annotations

import copy
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import importlib.util
from a2ui_messages import BOARD_PATH, SURFACE_ID  # noqa: E402
from board_actions import BoardActions  # noqa: E402

_agent_spec = importlib.util.spec_from_file_location(
    "agent_module", Path(__file__).resolve().parent.parent / "agent.py"
)
assert _agent_spec and _agent_spec.loader
_agent_module = importlib.util.module_from_spec(_agent_spec)
_agent_spec.loader.exec_module(_agent_module)
build_tools = _agent_module.build_tools
turn_prompt = _agent_module.turn_prompt
from kanban_mcp import (  # noqa: E402
    McpToolError,
    _text_of,
    columns_over_limit,
    find_column,
    find_task,
    find_task_by_title,
)
from scripted import ScriptedKanbanAgent  # noqa: E402
from turns import TurnInput  # noqa: E402

APP_HTML = "<!doctype html><html><body>board</body></html>"


def seed_board() -> dict[str, Any]:
    return {
        "columns": [
            {
                "id": "todo",
                "title": "Todo",
                "cards": [
                    {
                        "id": "t3",
                        "title": "Migrate DB",
                        "assignee": "Ana",
                        "due": "2026-10-17",
                    },
                    {"id": "t4", "title": "Design onboarding", "assignee": "Chloe"},
                ],
            },
            {
                "id": "in_progress",
                "title": "In progress",
                "cards": [
                    {
                        "id": "t1",
                        "title": "Fix login",
                        "assignee": "Ana",
                        "due": "2026-10-16",
                    },
                    {"id": "t5", "title": "Upgrade CI runners", "assignee": "Ben"},
                ],
            },
            {
                "id": "review",
                "title": "Review",
                "wipLimit": 3,
                "cards": [
                    {
                        "id": "t2",
                        "title": "Write docs",
                        "assignee": "Ben",
                        "due": "2026-10-20",
                    },
                    {"id": "t6", "title": "Audit permissions", "assignee": "Chloe"},
                    {"id": "t7", "title": "Add dark mode", "assignee": "Ana"},
                ],
            },
            {
                "id": "done",
                "title": "Done",
                "cards": [{"id": "t8", "title": "Release 1.2"}],
            },
        ]
    }


class FakeKanbanMcp:
    """Implements the server's tools on a dict, recording every call."""

    def __init__(self) -> None:
        self.board = seed_board()
        self.calls: list[tuple[str, dict[str, Any]]] = []

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((name, arguments))
        if name in ("list_board", "open_board"):
            return copy.deepcopy(self.board)
        if name == "move_task":
            return self._move(arguments["taskId"], arguments["toColumn"])
        if name == "create_task":
            return self._create(arguments)
        raise McpToolError(f"unexpected tool {name}")

    async def read_board_app(self) -> str:
        return APP_HTML

    def _move(self, task_id: str, to_column: str) -> dict[str, Any]:
        card = None
        for column in self.board["columns"]:
            for candidate in column["cards"]:
                if candidate["id"] == task_id:
                    card = candidate
            column["cards"] = [c for c in column["cards"] if c["id"] != task_id]
        if card is None:
            raise McpToolError(f"Unknown task id: {task_id}")
        for column in self.board["columns"]:
            if column["id"] == to_column:
                column["cards"].append(card)
                return copy.deepcopy(self.board)
        raise McpToolError(f"Unknown column: {to_column}")

    def _create(self, arguments: dict[str, Any]) -> dict[str, Any]:
        ids = [
            card["id"] for column in self.board["columns"] for card in column["cards"]
        ]
        card = {"id": f"t{len(ids) + 1}", "title": arguments["title"]}
        for key in ("assignee", "due"):
            if arguments.get(key):
                card[key] = arguments[key]
        for column in self.board["columns"]:
            if column["id"] == arguments.get("column", "todo"):
                column["cards"].append(card)
        return copy.deepcopy(self.board)


def app_turn(text: str, event: dict[str, Any], session: str = "s1") -> TurnInput:
    return TurnInput(
        session_id=session,
        text=text,
        app_message={
            "role": "user",
            "content": [{"type": "text", "text": text, "_meta": {"kanban": event}}],
        },
    )


@pytest.fixture
def mcp() -> FakeKanbanMcp:
    return FakeKanbanMcp()


@pytest.fixture
def agent(mcp: FakeKanbanMcp) -> ScriptedKanbanAgent:
    return ScriptedKanbanAgent(mcp)


async def test_show_board_sends_the_surface(
    agent: ScriptedKanbanAgent, mcp: FakeKanbanMcp
):
    output = await agent.run(
        TurnInput(session_id="s1", text="Show me the sprint board")
    )
    assert mcp.calls == [("open_board", {})]
    assert [next(iter(m.keys() - {"version"})) for m in output.a2ui_messages] == [
        "createSurface",
        "updateDataModel",
        "updateComponents",
    ]
    assert output.a2ui_messages[0]["createSurface"]["surfaceId"] == SURFACE_ID
    components = {
        c["id"]: c for c in output.a2ui_messages[2]["updateComponents"]["components"]
    }
    board = components["board"]
    assert board["component"] == "McpApp"
    assert board["data"]["paths"]["board"] == BOARD_PATH
    assert board["data"]["paths"]["modelContext"] == "/kanban/modelContext"
    assert "move_task" in board["allowedTools"]
    assert board["htmlContent"].startswith("url_encoded:")
    assert components["wip_badge"]["text"] == {"@path": "/kanban/summary/wipText"}
    assert output.a2ui_messages[1]["updateDataModel"]["value"]["board"] == seed_board()
    assert output.texts and "sprint board" in output.texts[0]


async def test_move_updates_the_board_path(
    agent: ScriptedKanbanAgent, mcp: FakeKanbanMcp
):
    await agent.run(TurnInput(session_id="s1", text="show the board"))
    output = await agent.run(
        TurnInput(session_id="s1", text="OK, move Write docs back to Todo")
    )
    assert mcp.calls[-1] == ("move_task", {"taskId": "t2", "toColumn": "todo"})
    assert len(output.a2ui_messages) == 1
    update = output.a2ui_messages[0]["updateDataModel"]
    assert update["surfaceId"] == SURFACE_ID
    assert update["path"] == BOARD_PATH
    assert [c["id"] for c in update["value"]["columns"][0]["cards"]] == [
        "t3",
        "t4",
        "t2",
    ]
    assert output.texts == ["Moved Write docs to Todo."]


async def test_move_before_show_opens_the_surface(agent: ScriptedKanbanAgent):
    output = await agent.run(
        TurnInput(session_id="fresh", text="move Fix login to Done")
    )
    assert "createSurface" in output.a2ui_messages[0]
    assert output.texts == ["Moved Fix login to Done."]


async def test_unknown_card_or_column(agent: ScriptedKanbanAgent, mcp: FakeKanbanMcp):
    output = await agent.run(TurnInput(session_id="s1", text="move Nothing to Done"))
    assert output.texts == ['I could not find a card called "Nothing".']
    output = await agent.run(
        TurnInput(session_id="s1", text="move Fix login to Archive")
    )
    assert output.texts == ['There is no column called "Archive".']
    assert all(name != "move_task" for name, _ in mcp.calls)


async def test_moved_event_reports_the_wip_overrun(
    agent: ScriptedKanbanAgent, mcp: FakeKanbanMcp
):
    mcp._move("t1", "review")  # The app already moved the card through the server.
    output = await agent.run(
        app_turn(
            'Moved "Fix login" from In progress to Review.',
            {"event": "moved", "taskId": "t1", "from": "in_progress", "to": "review"},
        )
    )
    assert mcp.calls == [("list_board", {})]
    assert output.texts == [
        "Review now has 4 cards, over its WIP limit of 3. Want me to move one back?"
    ]
    assert output.a2ui_messages == []


async def test_moved_event_within_limits_is_acknowledged(
    agent: ScriptedKanbanAgent, mcp: FakeKanbanMcp
):
    mcp._move("t1", "done")
    output = await agent.run(
        app_turn(
            'Moved "Fix login" from In progress to Done.',
            {"event": "moved", "taskId": "t1", "from": "in_progress", "to": "done"},
        )
    )
    assert output.texts == ["Noted: Fix login is now in Done."]


async def test_selected_card_is_answered_from_the_model_context(
    agent: ScriptedKanbanAgent, mcp: FakeKanbanMcp
):
    turn = TurnInput(
        session_id="s1",
        text="Who owns the selected card and when is it due?",
        data_model={
            "kanban": {
                "modelContext": {
                    "selection": {
                        "taskId": "t3",
                        "title": "Migrate DB",
                        "assignee": "Ana",
                        "due": "2026-10-17",
                        "column": "Todo",
                    },
                    "filter": None,
                    "columns": [],
                }
            }
        },
    )
    output = await agent.run(turn)
    assert output.texts == ["Migrate DB is owned by Ana and due 2026-10-17 (in Todo)."]
    assert mcp.calls == []

    output = await agent.run(TurnInput(session_id="s1", text="what is selected?"))
    assert output.texts == [
        "No card is selected. Click one on the board and ask again."
    ]


async def test_split_request_then_confirmation_creates_subtasks(
    agent: ScriptedKanbanAgent, mcp: FakeKanbanMcp
):
    await agent.run(TurnInput(session_id="s1", text="show board"))
    task = {"id": "t3", "title": "Migrate DB", "assignee": "Ana", "due": "2026-10-17"}
    proposal = await agent.run(
        app_turn(
            'Please split "Migrate DB" into smaller subtasks.',
            {"event": "split-request", "task": task},
        )
    )
    assert proposal.texts == [
        'I would split "Migrate DB" into "Plan Migrate DB", "Implement Migrate DB",'
        ' "Verify Migrate DB". Shall I create them?'
    ]
    created = await agent.run(TurnInput(session_id="s1", text="Yes please"))
    creates = [args for name, args in mcp.calls if name == "create_task"]
    assert creates == [
        {
            "title": "Plan Migrate DB",
            "column": "todo",
            "assignee": "Ana",
            "due": "2026-10-17",
        },
        {
            "title": "Implement Migrate DB",
            "column": "todo",
            "assignee": "Ana",
            "due": "2026-10-17",
        },
        {
            "title": "Verify Migrate DB",
            "column": "todo",
            "assignee": "Ana",
            "due": "2026-10-17",
        },
    ]
    assert len(created.a2ui_messages) == 1
    todo = created.a2ui_messages[0]["updateDataModel"]["value"]["columns"][0]["cards"]
    assert [c["title"] for c in todo][-3:] == [
        "Plan Migrate DB",
        "Implement Migrate DB",
        "Verify Migrate DB",
    ]
    assert created.texts == ["Created 3 subtasks next to Migrate DB."]

    again = await agent.run(TurnInput(session_id="s1", text="yes"))
    assert again.texts and "I can show the sprint board" in again.texts[0]


async def test_workload_lists_open_cards(agent: ScriptedKanbanAgent):
    output = await agent.run(
        TurnInput(session_id="s1", text="What's left for Ana this week?")
    )
    assert output.texts == [
        "Ana still has: Migrate DB (Todo, due 2026-10-17); Fix login (In progress, due"
        " 2026-10-16); Add dark mode (Review, due n/a)."
    ]


async def test_fallback_help(agent: ScriptedKanbanAgent):
    output = await agent.run(TurnInput(session_id="s1", text="tell me a joke"))
    assert output.texts and output.texts[0].startswith("I can show the sprint board")


def test_defensive_board_helpers():
    assert _text_of(None) == ""
    assert _text_of([]) == ""
    assert find_task(None, "t1") is None
    assert find_task_by_title(None, "Fix") is None
    assert find_column(None, "todo") is None
    assert columns_over_limit(None) == []


async def test_gemini_build_tools_emits_a2ui_messages(mcp: FakeKanbanMcp):
    emitted: dict[str, list[dict[str, Any]]] = {}

    def emit(session_id: str, messages: list[dict[str, Any]]) -> None:
        emitted.setdefault(session_id, []).extend(messages)

    tools = {fn.__name__: fn for fn in build_tools(BoardActions(mcp), emit)}

    class FakeSession:
        id = "s-gemini"

    class FakeToolContext:
        session = FakeSession()
        state: dict[str, Any] = {}

    ctx = FakeToolContext()
    res = await tools["show_board"](ctx)
    assert res["status"] == "The board is now displayed to the user."
    assert len(emitted["s-gemini"]) == 3

    emitted["s-gemini"].clear()
    res2 = await tools["move_task"]("t2", "todo", ctx)
    assert res2["status"] == "Done; the user sees the updated board."
    assert len(emitted["s-gemini"]) == 1
    assert emitted["s-gemini"][0]["updateDataModel"]["path"] == BOARD_PATH

    emitted["s-gemini"].clear()
    res3 = await tools["update_surface_layout"](ctx, layout="tabs")
    assert res3["layout"] == "tabs"
    assert len(emitted["s-gemini"]) == 1
    tab_components = {
        c["id"]: c for c in emitted["s-gemini"][0]["updateComponents"]["components"]
    }
    assert tab_components["workspace_tabs"]["component"] == "Tabs"
    assert tab_components["board_card"] == {
        "id": "board_card",
        "component": "Card",
        "child": "board",
    }

    emitted["s-gemini"].clear()
    custom_json = (
        '[{"id": "root", "component": "Card", "child": "custom_col"},'
        ' {"id": "custom_col", "component": "Column", "children": ["todo_count"]}]'
    )
    res4 = await tools["update_surface_layout"](ctx, components_json=custom_json)
    assert res4["layout"] == "custom"
    custom_components = {
        c["id"]: c for c in emitted["s-gemini"][0]["updateComponents"]["components"]
    }
    assert custom_components["root"]["component"] == "Column"
    assert "board" in custom_components["root"]["children"]


async def test_scripted_agent_updates_surface_layouts(agent: ScriptedKanbanAgent):
    # Calling a layout intent before show_board opens the full surface with that layout.
    initial = await agent.run(
        TurnInput(session_id="layout-s", text="Switch to the tabs layout")
    )
    assert "createSurface" in initial.a2ui_messages[0]
    first_components = {
        c["id"]: c for c in initial.a2ui_messages[2]["updateComponents"]["components"]
    }
    assert first_components["workspace_tabs"]["component"] == "Tabs"
    assert first_components["board"]["component"] == "McpApp"

    # Subsequent layout changes emit a compact `updateComponents` wrapping `board`.
    for prompt, expected_id, expected_type in [
        ("Use the split inspector layout", "inspector_card", "Card"),
        ("Wrap the board in cards layout", "board_divider", "Divider"),
        ("Switch to the default layout", "summary", "Row"),
    ]:
        step = await agent.run(TurnInput(session_id="layout-s", text=prompt))
        assert len(step.a2ui_messages) == 1
        updated = {
            c["id"]: c for c in step.a2ui_messages[0]["updateComponents"]["components"]
        }
        assert updated[expected_id]["component"] == expected_type


def test_turn_prompt_includes_user_move_guidance():
    prompt = turn_prompt(
        app_turn(
            'Moved "Upgrade CI runners" from In progress to Todo.',
            {"event": "moved", "taskId": "t5", "from": "in_progress", "to": "todo"},
        )
    )
    assert "The user already moved this card directly in the board UI" in prompt
    assert "Do NOT call move_task" in prompt
