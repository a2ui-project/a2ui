# Copyright 2026 Google LLC
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

"""Tests for the turn runner, with a scripted model."""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from typing import Literal

from react_app_demo_agent.model import ChatMessage, ModelCall, Usage
from react_app_demo_agent.prompt import build_catalogs
from react_app_demo_agent.turn import Conversation, SseEvent, TurnRunner

GOOD_APP = '''Here is your planner.
<a2ui>
surface("trip")
$/trip/stops = ["Louvre", "Eiffel Tower"]
root = Column(children=[title, planner])
title = Text(text="## Trip")
planner = ReactApp(title="Reorder", height=300, source=r"""
import { useData } from "a2ui";
export default function App() {
  const [stops] = useData<string[]>("/trip/stops", []);
  return <ol>{stops.map((s) => <li key={s}>{s}</li>)}</ol>;
}
""")
</a2ui>'''

BAD_APP = GOOD_APP.replace('import { useData } from "a2ui";', 'import _ from "lodash";')


class ScriptedModel:
    """Answers each attempt with a fixed text, cut into small chunks."""

    def __init__(self, *answers: str) -> None:
        self.answers = list(answers)
        self.histories: list[list[ChatMessage]] = []

    @property
    def name(self) -> str:
        return "scripted"

    @property
    def mode(self) -> Literal["live", "replay"]:
        return "replay"

    def stream(
        self,
        system_prompt: str,
        history: Sequence[ChatMessage],
        *,
        key: str,
        attempt: int,
    ) -> ModelCall:
        self.histories.append(list(history))
        text = self.answers[attempt - 1]
        return ModelCall(
            chunks=_chunks(text), usage=Usage(prompt_tokens=10, output_tokens=5)
        )


async def _chunks(text: str) -> AsyncIterator[str]:
    for i in range(0, len(text), 17):
        yield text[i : i + 17]


async def _run(model: ScriptedModel, conversation: Conversation) -> list[SseEvent]:
    runner = TurnRunner(model, build_catalogs(), "system")
    return [
        event
        async for event in runner.run(conversation, "plan my trip", key="plan my trip")
    ]


async def test_streams_messages_and_records_the_turn() -> None:
    conversation = Conversation("c1")
    events = await _run(ScriptedModel(GOOD_APP), conversation)

    kinds = [e.event for e in events]
    assert kinds[0] == "turn"
    assert kinds[-2:] == ["debug", "done"]
    assert "app_pending" in kinds
    assert kinds.index("app_pending") < max(
        i for i, e in enumerate(events) if e.event == "a2ui"
    )
    checkpoints = [e.data["checkpoint"] for e in events if e.event == "timing"]
    assert checkpoints == ["firstToken", "firstA2ui", "reactAppSource", "streamDone"]
    debug = events[-2].data
    assert debug["ok"] is True and debug["retries"] == 0
    assert debug["reactApps"][0]["id"] == "planner"
    assert 'useData<string[]>("/trip/stops"' in debug["reactApps"][0]["source"]
    assert [m.role for m in conversation.history] == ["user", "model"]
    assert conversation.committed == debug["messages"]


async def test_retries_once_with_the_errors_and_removes_the_failed_surface() -> None:
    model = ScriptedModel(BAD_APP, GOOD_APP)
    conversation = Conversation("c1")
    events = await _run(model, conversation)

    retry = next(e for e in events if e.event == "retry")
    assert retry.data["attempt"] == 2
    assert any("lodash" in error for error in retry.data["errors"])
    deletes = [
        e.data["message"]["deleteSurface"]
        for e in events
        if e.event == "a2ui" and "deleteSurface" in e.data["message"]
    ]
    assert deletes == [{"surfaceId": "trip"}]
    retry_history = model.histories[1]
    assert [m.role for m in retry_history] == ["user", "model", "user"]
    assert "lodash" in retry_history[-1].text
    debug = next(e for e in events if e.event == "debug").data
    assert debug["ok"] is True and debug["retries"] == 1
    assert [a["ok"] for a in debug["attempts"]] == [False, True]


async def test_gives_up_after_the_second_failure() -> None:
    conversation = Conversation("c1")
    events = await _run(ScriptedModel(BAD_APP, BAD_APP), conversation)

    assert [e.event for e in events].count("retry") == 1
    assert any(e.event == "error" for e in events)
    assert events[-1].data["ok"] is False
    assert conversation.history == [] and conversation.committed == []


async def test_a_later_turn_can_update_an_earlier_surface() -> None:
    conversation = Conversation("c1")
    await _run(ScriptedModel(GOOD_APP), conversation)
    update = '<a2ui>\nsurface("trip")\ntitle = Text(text="## Your trip")\n</a2ui>'
    events = await _run(ScriptedModel(update), conversation)

    messages = [e.data["message"] for e in events if e.event == "a2ui"]
    assert messages and all("createSurface" not in m for m in messages)
    assert events[-1].data["ok"] is True
