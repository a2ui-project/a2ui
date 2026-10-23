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

"""End-to-end tests for `PlaygroundAgent.stream` with a scripted model."""

from __future__ import annotations

import json
from typing import Any

from a2a.types import DataPart, Part, TextPart
import pytest

from a2ui.inference_formats.decision import DeterministicMockBackend
from agent import PlaygroundAgent
from fakes import FakeLlmCaller
from modes import RenderMode
from renderers import Renderers
from stage1 import UI_ACTION_PREFIX
from test_renderers import EXPRESS_BAD, EXPRESS_OK, RESORT_PAYLOAD, direct_json_reply

pytestmark = pytest.mark.asyncio

STAGE1_BLOCK = (
    "<a2ui>"
    + json.dumps({"intent": "Show the resort overview", "payload": RESORT_PAYLOAD})
    + "</a2ui>"
)


def messages_of(parts: list[Part]) -> list[dict[str, Any]]:
    return [p.root.data for p in parts if isinstance(p.root, DataPart)]


def surface_ids(parts: list[Part]) -> list[str]:
    ids: list[str] = []
    for msg in messages_of(parts):
        create = msg.get("createSurface")
        if isinstance(create, dict):
            ids.append(str(create["surfaceId"]))
    return ids


def _component_text(comp: dict[str, Any]) -> str | None:
    """The `text` of a `Text` component in either the v0.9 or v1.0 shape."""
    kind = comp.get("component")
    props = kind.get("Text") if isinstance(kind, dict) else comp
    text = props.get("text") if isinstance(props, dict) else None
    return text if isinstance(text, str) else None


def _components_of(msg: dict[str, Any]) -> list[dict[str, Any]]:
    """Components carried by a `createSurface` (v1.0) or `updateComponents` message."""
    found: list[dict[str, Any]] = []
    for key in ("createSurface", "updateComponents"):
        body = msg.get(key)
        if isinstance(body, dict):
            found.extend(body.get("components", []))
    return found


def status_text(parts: list[Part]) -> str:
    """Joins every `Text` literal in the parts, in order."""
    texts = [
        text
        for msg in messages_of(parts)
        for comp in _components_of(msg)
        if (text := _component_text(comp)) is not None
    ]
    return "\n".join(texts)


async def collect(
    agent: PlaygroundAgent, query: str, session: str, version: str | None = "0.9"
) -> list[Part]:
    items = [item async for item in agent.stream(query, session, version)]
    assert len(items) == 1 and items[0]["is_task_complete"] is True
    return items[0]["parts"]


@pytest.fixture
def agent(scripted_llm: FakeLlmCaller) -> PlaygroundAgent:
    renderers = Renderers(versions=["0.9", "1.0"], backend=DeterministicMockBackend())
    return PlaygroundAgent(
        "http://localhost:10010",
        llm=scripted_llm,
        renderers=renderers,
        model_name="fake-model",
    )


async def test_agent_card_advertises_both_versions(agent: PlaygroundAgent) -> None:
    uris = [e.uri for e in agent.agent_card.capabilities.extensions or []]
    assert len(uris) == 2
    assert agent.agent_card.skills[0].id == "render_ui"


async def test_help_mode_and_trace_before_any_render(agent: PlaygroundAgent) -> None:
    help_parts = await collect(agent, "/help", "s1")
    assert surface_ids(help_parts) == ["turn-0-status"]
    text = status_text(help_parts)
    assert "/compare" in text and "`mock`" in text and "`fake-model`" in text

    mode_parts = await collect(agent, "/mode express", "s1")
    assert "Mode set to `express`" in status_text(mode_parts)
    unknown = await collect(agent, "/sparkle", "s1")
    assert "Unknown command `/sparkle`" in status_text(unknown)

    trace_parts = await collect(agent, "/trace", "s1")
    assert "No decision turn yet" in status_text(trace_parts)

    text_only = await collect(agent, "hello", "s1", version=None)
    assert isinstance(text_only[0].root, TextPart)


@pytest.mark.parametrize("version", ["0.9", "1.0"])
async def test_decision_turn_renders_surface_footer_and_trace(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller, version: str
) -> None:
    scripted_llm.script("stage1", STAGE1_BLOCK)
    parts = await collect(agent, "I want to see the resort", "s2", version)
    ids = surface_ids(parts)
    assert ids == ["turn-1", "turn-1-decision-footer"]
    footer = status_text(parts)
    assert "**decision** · mock · 1 LLM call" in footer
    assert "archetype" in footer
    stage1_call = scripted_llm.calls_for("stage1")[-1]
    assert stage1_call["session_id"] == "s2"
    assert "Format playground" in str(stage1_call["instruction"])

    trace = await collect(agent, "/trace", "s2", version)
    assert "`family`" in status_text(trace)


async def test_express_turn_uses_fresh_stage2_session(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller
) -> None:
    await collect(agent, "/mode express", "s3")
    scripted_llm.script("stage1", STAGE1_BLOCK)
    scripted_llm.script("express:0.9", EXPRESS_OK.replace("turn-1", "turn-1"))
    parts = await collect(agent, "show the resort", "s3")
    assert surface_ids(parts) == ["turn-1", "turn-1-express-footer"]
    assert "**express** · llm · 2 LLM calls" in status_text(parts)
    stage2_call = scripted_llm.calls_for("express:0.9")[-1]
    assert stage2_call["session_id"] is None
    assert "Casa Verde" in str(stage2_call["user_text"])


async def test_compare_renders_three_surfaces_and_resets(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller
) -> None:
    await collect(agent, "/compare", "s4")
    scripted_llm.script("stage1", STAGE1_BLOCK, STAGE1_BLOCK)
    scripted_llm.script("express:0.9", EXPRESS_OK.replace("turn-1", "turn-1-express"))
    scripted_llm.script(
        "direct:0.9",
        direct_json_reply(agent.renderers, "0.9").replace("turn-1", "turn-1-direct"),
    )
    parts = await collect(agent, "compare the resort", "s4")
    assert surface_ids(parts) == [
        "turn-1-decision",
        "turn-1-decision-footer",
        "turn-1-express",
        "turn-1-express-footer",
        "turn-1-direct",
        "turn-1-direct-footer",
        "turn-1-compare",
    ]
    summary = status_text(parts)
    assert "**Compare**" in summary and "`decision`: 1 call" in summary
    assert "`express`: 2 calls" in summary and "`direct`: 2 calls" in summary
    assert len(scripted_llm.calls_for("stage1")) == 1

    # The next turn is back to the single default mode.
    again = await collect(agent, "again", "s4")
    assert surface_ids(again) == ["turn-2", "turn-2-decision-footer"]


async def test_prose_from_stage1_and_stage2_failures_never_raise(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller
) -> None:
    scripted_llm.script("stage1", "I would show a card with the resort name.")
    prose = await collect(agent, "show the resort", "s5")
    assert surface_ids(prose) == ["turn-1-status"]
    assert "could not turn that into a decision block" in status_text(prose)

    await collect(agent, "/mode express", "s5")
    scripted_llm.script("stage1", STAGE1_BLOCK)
    scripted_llm.script("express:0.9", EXPRESS_BAD, EXPRESS_BAD)
    failed = await collect(agent, "show the resort", "s5")
    assert surface_ids(failed) == ["turn-2-express-footer"]
    text = status_text(failed)
    assert "3 LLM calls" in text and "Render failed" in text


async def test_ui_action_text_goes_through_stage1(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller
) -> None:
    scripted_llm.script("stage1", STAGE1_BLOCK)
    action_text = "User interacted with the UI: action `submit` with context {}."
    parts = await collect(agent, action_text, "s6")
    assert surface_ids(parts)[0] == "turn-1"
    assert scripted_llm.calls_for("stage1")[-1]["user_text"] == action_text
    assert action_text.startswith(UI_ACTION_PREFIX)
    assert RenderMode.DECISION.value in status_text(parts)
