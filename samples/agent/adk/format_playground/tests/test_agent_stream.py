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
from inspector_trace import PLAYGROUND_TRACE_MIME_TYPE
from modes import LlmToolTurn, RenderMode
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
    """Extracts dictionary payloads from all `DataPart` entries in `parts`.

    Args:
        parts: List of A2A message parts.

    Returns:
        List of dictionary payloads.
    """
    return [p.root.data for p in parts if isinstance(p.root, DataPart)]


def surface_ids(parts: list[Part]) -> list[str]:
    """Collects `surfaceId` values from all `createSurface` messages in `parts`.

    Args:
        parts: List of A2A message parts.

    Returns:
        Ordered list of created surface identifiers.
    """
    ids: list[str] = []
    for msg in messages_of(parts):
        create = msg.get("createSurface")
        if isinstance(create, dict):
            ids.append(str(create["surfaceId"]))
    return ids


def _component_text(comp: dict[str, Any]) -> str | None:
    """Extracts the `text` string from a `Text` component in either v0.9 or v1.0 shape.

    Args:
        comp: Component dictionary from a surface message.

    Returns:
        The literal text string, or `None` if not a `Text` component.
    """
    kind = comp.get("component")
    props = kind.get("Text") if isinstance(kind, dict) else comp
    text = props.get("text") if isinstance(props, dict) else None
    return text if isinstance(text, str) else None


def _components_of(msg: dict[str, Any]) -> list[dict[str, Any]]:
    """Returns components carried by a `createSurface` or `updateComponents` message.

    Args:
        msg: Single A2UI wire message dictionary.

    Returns:
        List of component dictionaries found in the message.
    """
    found: list[dict[str, Any]] = []
    for key in ("createSurface", "updateComponents"):
        body = msg.get(key)
        if isinstance(body, dict):
            found.extend(body.get("components", []))
    return found


def status_text(parts: list[Part]) -> str:
    """Joins every `Text` literal across `parts` with newlines.

    Args:
        parts: List of A2A message parts.

    Returns:
        Newline-joined text content from all `Text` components.
    """
    texts = [
        text
        for msg in messages_of(parts)
        for comp in _components_of(msg)
        if (text := _component_text(comp)) is not None
    ]
    return "\n".join(texts)


async def collect(
    agent: PlaygroundAgent,
    query: str,
    session: str,
    version: str | None = "0.9",
    *,
    inspector_enabled: bool = False,
) -> list[Part]:
    """Runs a single turn of `agent.stream` and returns the completed task parts.

    Args:
        agent: The `PlaygroundAgent` under test.
        query: User query or slash command.
        session: Session identifier.
        version: Negotiated A2UI protocol version, or `None` for text-only.
        inspector_enabled: Whether the split-screen inspector metadata flag is active.

    Returns:
        The list of A2A `Part` entries emitted for the completed turn.
    """
    items = [
        item
        async for item in agent.stream(
            query, session, version, inspector_enabled=inspector_enabled
        )
    ]
    assert len(items) == 1 and items[0]["is_task_complete"] is True
    return items[0]["parts"]


def trace_parts_of(parts: list[Part]) -> list[dict[str, Any]]:
    """Extracts in-band playground trace payloads from `parts`.

    Args:
        parts: List of A2A message parts.

    Returns:
        List of playground trace dictionaries matching `PLAYGROUND_TRACE_MIME_TYPE`.
    """
    return [
        p.root.data
        for p in parts
        if isinstance(p.root, DataPart)
        and (p.root.metadata or {}).get("mimeType") == PLAYGROUND_TRACE_MIME_TYPE
    ]


@pytest.fixture
def agent(scripted_llm: FakeLlmCaller) -> PlaygroundAgent:
    """Builds a `PlaygroundAgent` wired to `scripted_llm` and `DeterministicMockBackend`.

    Args:
        scripted_llm: Scripted `FakeLlmCaller` fixture.

    Returns:
        A configured `PlaygroundAgent` instance.
    """
    renderers = Renderers(versions=["0.9", "1.0"], backend=DeterministicMockBackend())
    return PlaygroundAgent(
        "http://localhost:10010",
        llm=scripted_llm,
        renderers=renderers,
        model_name="fake-model",
    )


async def test_agent_card_advertises_both_versions(agent: PlaygroundAgent) -> None:
    """Verifies that `agent_card` advertises both v0.9 and v1.0 A2UI extensions."""
    uris = [e.uri for e in agent.agent_card.capabilities.extensions or []]
    assert len(uris) == 2
    assert agent.agent_card.skills[0].id == "render_ui"


async def test_help_mode_and_trace_before_any_render(
    agent: PlaygroundAgent, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verifies `/help`, `/mode`, `/backend`, and `/trace` commands before any render turn."""
    help_parts = await collect(agent, "/help", "s1")
    assert surface_ids(help_parts) == ["turn-0-status"]
    text = status_text(help_parts)
    assert "/compare" in text and "`mock`" in text and "`fake-model`" in text
    assert "/backend" in text

    mode_parts = await collect(agent, "/mode express", "s1")
    assert "Mode set to `express`" in status_text(mode_parts)
    unknown = await collect(agent, "/sparkle", "s1")
    assert "Unknown command `/sparkle`" in status_text(unknown)

    monkeypatch.setenv("JEV_API_KEY", "vcp_test_key")
    backend_parts = await collect(agent, "/backend jev", "s1")
    assert "Decision backend set to `jev`." in status_text(backend_parts)
    nameless = await collect(agent, "/backend", "s1")
    assert "`/backend` needs a backend name" in status_text(nameless)
    remix = await collect(agent, "/remix", "s1")
    assert "Unknown command `/remix`" in status_text(remix)
    reset_parts = await collect(agent, "/backend mock", "s1")
    assert "Decision backend set to `mock`." in status_text(reset_parts)

    trace_parts = await collect(agent, "/trace", "s1")
    assert "No decision turn yet" in status_text(trace_parts)

    text_only = await collect(agent, "hello", "s1", version=None)
    assert isinstance(text_only[0].root, TextPart)


async def test_decision_turn_renders_surface_footer_and_trace(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller
) -> None:
    """Verifies a decision turn renders `main`, a footer surface, and populates `/trace`."""
    scripted_llm.script("stage1", STAGE1_BLOCK)
    parts = await collect(agent, "I want to see the resort", "s2", "1.0")
    ids = surface_ids(parts)
    assert ids == ["main", "turn-1-decision-footer"]
    footer = status_text(parts)
    assert "**decision** · mock · 1 LLM call" in footer
    assert "archetype" in footer
    stage1_call = scripted_llm.calls_for("stage1")[-1]
    assert stage1_call["session_id"] == "s2"
    assert "Format playground" in str(stage1_call["instruction"])

    trace = await collect(agent, "/trace", "s2", "1.0")
    assert "`family`" in status_text(trace)
    assert "**Backend**: `mock`" in status_text(trace)


async def test_decision_mode_needs_a_v10_client(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller
) -> None:
    """Verifies that decision mode returns a v1.0-only error card for v0.9 clients."""
    scripted_llm.script("stage1", STAGE1_BLOCK)
    parts = await collect(agent, "I want to see the resort", "s2-v09", "0.9")
    assert surface_ids(parts) == ["turn-1-decision-footer"]
    assert "v1.0 only" in status_text(parts)


async def test_second_turn_updates_the_main_surface_in_place(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller
) -> None:
    """Verifies `main` surface reuse across `PlanCache` hit and shape-change turns."""
    different_shape_block = (
        "<a2ui>"
        + json.dumps(
            {"intent": "Check host health", "payload": {"host": "prod-1", "cpu": 0.78}}
        )
        + "</a2ui>"
    )
    scripted_llm.script("stage1", STAGE1_BLOCK, STAGE1_BLOCK, different_shape_block)
    first = await collect(agent, "show the resort", "s-reuse", "1.0")
    second = await collect(agent, "show it again", "s-reuse", "1.0")
    third = await collect(agent, "check host health", "s-reuse", "1.0")
    assert surface_ids(first) == ["main", "turn-1-decision-footer"]
    # Turn 2 has the same shape, so PlanCache emits only updateDataModel (`cache hit`).
    assert surface_ids(second) == ["turn-2-decision-footer"]
    data_updates = [
        m
        for m in messages_of(second)
        if m.get("updateDataModel", {}).get("surfaceId") == "main"
    ]
    assert data_updates
    assert not [
        m
        for m in messages_of(second)
        if m.get("updateComponents", {}).get("surfaceId") == "main"
    ]
    assert "cache hit" in status_text(second)
    # Turn 3 changes payload shape, so it re-plans and emits updateComponents (`update_root`).
    assert surface_ids(third) == ["turn-3-decision-footer"]
    comp_updates = [
        m
        for m in messages_of(third)
        if m.get("updateComponents", {}).get("surfaceId") == "main"
    ]
    assert comp_updates
    assert "surface update_root" in status_text(third)
    assert "INTEGRITY_ERROR" not in json.dumps(messages_of(third))


async def test_express_turn_uses_fresh_stage2_session(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller
) -> None:
    """Verifies that Express mode runs Stage 2 in a stateless (`session_id=None`) LLM call."""
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
    """Verifies `/compare` renders decision, express, and direct surfaces and resets afterwards."""
    await collect(agent, "/compare", "s4", "1.0")
    scripted_llm.script("stage1", STAGE1_BLOCK, STAGE1_BLOCK)
    scripted_llm.script("express:1.0", EXPRESS_OK.replace("turn-1", "turn-1-express"))
    scripted_llm.script(
        "direct:1.0",
        direct_json_reply(agent.renderers, "1.0").replace("turn-1", "turn-1-direct"),
    )
    parts = await collect(agent, "compare the resort", "s4", "1.0")
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
    again = await collect(agent, "again", "s4", "1.0")
    assert surface_ids(again) == ["main", "turn-2-decision-footer"]


async def test_prose_from_stage1_and_stage2_failures_never_raise(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller
) -> None:
    """Verifies that Stage 1 and Stage 2 extraction failures emit status surfaces cleanly."""
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
    """Verifies that UI action queries are routed through Stage 1 without JSON pinning."""
    scripted_llm.script("stage1", STAGE1_BLOCK)
    action_text = "User interacted with the UI: action `submit` with context {}."
    parts = await collect(agent, action_text, "s6", "1.0")
    assert surface_ids(parts)[0] == "main"
    assert scripted_llm.calls_for("stage1")[-1]["user_text"] == action_text
    assert action_text.startswith(UI_ACTION_PREFIX)
    assert RenderMode.DECISION.value in status_text(parts)


async def test_default_mode_starts_new_session_in_configured_mode(
    scripted_llm: FakeLlmCaller,
) -> None:
    """Verifies that `PlaygroundAgent(default_mode=...)` initializes new sessions in that mode."""
    renderers = Renderers(versions=["0.9"], backend=DeterministicMockBackend())
    express_agent = PlaygroundAgent(
        "http://localhost:10010",
        llm=scripted_llm,
        renderers=renderers,
        model_name="fake-model",
        default_mode=RenderMode.EXPRESS,
    )
    help_parts = await collect(express_agent, "/help", "s-default-express")
    assert "Active mode: `express`" in status_text(help_parts)


async def test_tool_mode_renders_surface_with_tool_result(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller
) -> None:
    """Verifies that `tool` mode calls a Python tool and synthesizes the result via decision model."""
    await collect(agent, "/mode tool", "s-tool-1")
    scripted_llm.script_tool(
        "tool_mode",
        LlmToolTurn(
            tool_name="get_host_health",
            arguments={"hostname": "prod-01"},
            result={"hostname": "prod-01", "cpu": "98%", "status": "critical"},
            prompt_tokens=150,
            output_tokens=30,
            latency_ms=120.0,
        ),
    )
    parts = await collect(agent, "check host 01 health", "s-tool-1", "1.0")
    ids = surface_ids(parts)
    assert ids == ["main", "turn-1-tool-footer"]
    footer = status_text(parts)
    assert "**tool**" in footer
    assert "1 LLM call (tool call only)" in footer


async def test_tool_mode_plain_text_reply_when_no_tool_called(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller
) -> None:
    """Verifies that `tool` mode renders a status card when the LLM replies without calling a tool."""
    await collect(agent, "/mode tool", "s-tool-2")
    scripted_llm.script_tool(
        "tool_mode",
        LlmToolTurn(
            tool_name=None,
            arguments={},
            result=None,
            text="I can only check host health or ski resorts.",
            prompt_tokens=100,
            output_tokens=20,
            latency_ms=80.0,
        ),
    )
    parts = await collect(agent, "what is the capital of France?", "s-tool-2")
    assert surface_ids(parts) == ["turn-1-status", "turn-1-tool-footer"]
    assert "I can only check host health" in status_text(parts)


async def test_rate_command_records_preference_and_summarizes(
    agent: PlaygroundAgent,
    scripted_llm: FakeLlmCaller,
    tmp_path: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verifies `/rate` validation, JSONL persistence, and `/ratings` tally output."""
    ratings_file = tmp_path / "ratings.jsonl"
    monkeypatch.setattr("agent.RATINGS_PATH", ratings_file)

    # Rate before turn
    unrated = await collect(agent, "/rate decision", "s-rate")
    assert "No previous turn to rate" in status_text(unrated)

    # Valid turn
    scripted_llm.script("stage1", STAGE1_BLOCK)
    await collect(agent, "show resort", "s-rate")

    # Rate invalid mode
    bad_mode = await collect(agent, "/rate glitter", "s-rate")
    assert "Unknown mode `glitter`" in status_text(bad_mode)

    # Rate mode not rendered in previous turn
    unrendered_mode = await collect(agent, "/rate express", "s-rate")
    assert "was not rendered in the previous turn" in status_text(unrendered_mode)

    # Rate with comment
    rated = await collect(agent, "/rate decision Very fast and clean", "s-rate")
    assert (
        "Recorded preference for `decision` with comment: Very fast and clean"
        in status_text(rated)
    )

    # Show ratings
    summary = await collect(agent, "/ratings", "s-rate")
    assert "(1 total vote)" in status_text(summary)
    assert "`decision`: 1 (100.0%)" in status_text(summary)


async def test_action_events_route_by_id_with_context() -> None:
    """Verifies that v1.0 action events are classified and formatted with their context payload."""
    from agent_executor import action_query, build_query, classify_data_part

    event = {
        "version": "1.0",
        "action": {
            "name": "save_profile",
            "surfaceId": "main",
            "sourceComponentId": "actions_action_button_0",
            "timestamp": "2026-11-10T00:00:00Z",
            "context": {"email": "alex@example.com", "name": "Alex"},
        },
    }
    kind, action = classify_data_part(event)
    assert kind == "action"
    query = action_query(action)
    assert query.startswith(UI_ACTION_PREFIX)
    assert "action `save_profile` on surface `main`" in query
    assert '"email": "alex@example.com"' in query
    parts = [Part(root=DataPart(data=event))]
    assert build_query(parts) == query


async def test_set_backend_awaits_old_factory_aclose_and_skips_non_str_part_text() -> (
    None
):
    """Verifies `set_backend` closes the old factory and event text helpers skip non-string parts."""
    from types import SimpleNamespace
    from agent import _append_part_texts, _collect_tool_event_parts

    local_renderers = Renderers(versions=["1.0"], backend=DeterministicMockBackend())
    closed = False

    async def fake_aclose() -> None:
        nonlocal closed
        closed = True

    local_renderers._decision_factory.aclose = fake_aclose  # type: ignore[method-assign]
    await local_renderers.set_backend(DeterministicMockBackend())
    assert closed is True

    chunks: list[str] = []
    mixed_parts = [
        SimpleNamespace(text="hello "),
        SimpleNamespace(text=None),
        SimpleNamespace(text=42),
        SimpleNamespace(),
        SimpleNamespace(text="world"),
    ]
    _append_part_texts(mixed_parts, chunks)
    assert "".join(chunks) == "hello world"

    tool_chunks: list[str] = []
    name, args, resp = _collect_tool_event_parts(
        mixed_parts, tool_chunks, None, {}, None
    )
    assert "".join(tool_chunks) == "hello world"
    assert (name, args, resp) == (None, {}, None)


async def test_adk_llm_caller_runner_for_constructs_llm_agent_with_and_without_tools() -> (
    None
):
    """Verifies `AdkLlmCaller._runner_for` configures `LlmAgent` tools and thinking budget."""
    from agent import AdkLlmCaller
    from tools import TOOLS

    caller = AdkLlmCaller("gemini-3.6-flash", "format_playground")
    plain_runner = caller._runner_for("stage1", "Return a decision block.")
    assert plain_runner.agent.tools == []
    assert plain_runner.agent.generate_content_config is not None
    assert plain_runner.agent.generate_content_config.thinking_config is not None
    assert (
        plain_runner.agent.generate_content_config.thinking_config.thinking_budget
        == 1000
    )

    tool_runner = caller._runner_for("tool_mode", "Call a tool.", tools=TOOLS)
    assert len(tool_runner.agent.tools) == len(TOOLS)


async def test_direct_tool_command_renders_without_llm_calls(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller
) -> None:
    """Verifies `/tool <name>` renders with 0 LLM calls and clears pending `/compare` state."""
    parts = await collect(agent, "/tool host", "s-direct-tool", version="1.0")
    assert scripted_llm.calls == []
    assert surface_ids(parts) == ["main", "turn-1-tool-footer"]
    footer = status_text(parts)
    assert "0 LLM calls" in footer

    cached = await collect(agent, "/tool host", "s-direct-tool", version="1.0")
    assert scripted_llm.calls == []
    assert "cache hit" in status_text(cached)

    missing = await collect(agent, "/tool", "s-direct-tool", version="1.0")
    assert "Usage: `/tool <name>`" in status_text(missing)

    unknown = await collect(agent, "/tool bogus", "s-direct-tool", version="1.0")
    assert "Unknown tool `bogus`" in status_text(unknown)

    # Running /compare followed by /tool <name> resets compare=False and targets 'main' (M1).
    await collect(agent, "/compare", "s-direct-compare", version="1.0")
    after_compare = await collect(
        agent,
        "/tool resort",
        "s-direct-compare",
        version="1.0",
        inspector_enabled=True,
    )
    assert surface_ids(after_compare) == ["main"]
    assert trace_parts_of(after_compare)[0]["compare"] is False
    assert agent._settings["s-direct-compare"].compare is False


async def test_inspector_enabled_omits_footers_and_attaches_trace_part(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller
) -> None:
    """Verifies that `inspector_enabled=True` omits footer surfaces and attaches a trace part."""
    scripted_llm.script("stage1", STAGE1_BLOCK)
    parts = await collect(
        agent,
        "I want to see the resort",
        "s-insp-1",
        "1.0",
        inspector_enabled=True,
    )
    assert surface_ids(parts) == ["main"]
    traces = trace_parts_of(parts)
    assert len(traces) == 1
    trace = traces[0]
    assert trace["schemaVersion"] == 1
    assert trace["turn"] == 1
    assert trace["activeMode"] == "decision"
    assert trace["stage1"]["source"] == "llm"
    assert trace["stage1"]["block"]["intent"] == "Show the resort overview"
    cand = trace["candidates"][0]
    assert cand["mode"] == "decision"
    assert cand["decisionInput"] is not None
    assert cand["decisionOutput"] is not None
    assert cand["wireOutput"]["surfaceId"] == "main"


async def test_inspector_enabled_classifies_pasted_json_vs_ui_action(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller
) -> None:
    """Verifies that Stage 1 source distinguishes `pasted_json` queries from UI actions."""
    scripted_llm.script("stage1", STAGE1_BLOCK, STAGE1_BLOCK)
    pasted_query = 'Use this JSON:\n```json\n{"host": "prod-1", "cpu": 0.5}\n```'
    pasted_parts = await collect(
        agent, pasted_query, "s-insp-src", "1.0", inspector_enabled=True
    )
    assert trace_parts_of(pasted_parts)[0]["stage1"]["source"] == "pasted_json"

    action_query = (
        f'{UI_ACTION_PREFIX} action `save` on surface `main` with context {{"id": 1}}.'
    )
    action_parts = await collect(
        agent, action_query, "s-insp-src", "1.0", inspector_enabled=True
    )
    assert trace_parts_of(action_parts)[0]["stage1"]["source"] == "llm"


async def test_inspector_enabled_direct_tool_and_plan_cache_hit(
    agent: PlaygroundAgent,
) -> None:
    """Verifies that `/tool` turns emit `direct_tool` traces and record `PlanCache` hits."""
    first = await collect(
        agent, "/tool host", "s-insp-tool", "1.0", inspector_enabled=True
    )
    assert surface_ids(first) == ["main"]
    trace1 = trace_parts_of(first)[0]
    assert trace1["stage1"]["source"] == "direct_tool"
    assert trace1["stage1"]["toolName"] == "get_host_health"
    assert trace1["stage1"]["llmCalls"] == 0
    assert trace1["candidates"][0]["decisionInput"]["cacheHit"] is False

    second = await collect(
        agent, "/tool host", "s-insp-tool", "1.0", inspector_enabled=True
    )
    # Turn 2 is a PlanCache hit: only updateDataModel + trace part (no footer surface).
    assert surface_ids(second) == []
    trace2 = trace_parts_of(second)[0]
    assert trace2["candidates"][0]["decisionInput"]["cacheHit"] is True
    assert trace2["candidates"][0]["decisionInput"]["decisionCalls"] == 0


async def test_inspector_enabled_tool_mode_with_and_without_tool_call(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller
) -> None:
    """Verifies `tool` mode trace payloads when the LLM either abstains or calls a tool."""
    await collect(agent, "/mode tool", "s-insp-tm", "1.0", inspector_enabled=True)

    # No-tool prose reply omits turn-N-tool-footer and emits a trace part with candidates=[].
    scripted_llm.script_tool(
        "tool_mode",
        LlmToolTurn(
            tool_name=None,
            arguments={},
            result=None,
            text="I only have host and resort tools.",
            prompt_tokens=90,
            output_tokens=15,
            latency_ms=55.0,
        ),
    )
    no_tool_parts = await collect(
        agent, "tell me a joke", "s-insp-tm", "1.0", inspector_enabled=True
    )
    assert surface_ids(no_tool_parts) == ["turn-1-status"]
    no_tool_trace = trace_parts_of(no_tool_parts)[0]
    assert no_tool_trace["stage1"]["source"] == "tool_call"
    assert no_tool_trace["stage1"]["rawText"] == "I only have host and resort tools."
    assert no_tool_trace["candidates"] == []

    # Tool-calling turn omits turn-N-tool-footer and attaches full candidate trace.
    scripted_llm.script_tool(
        "tool_mode",
        LlmToolTurn(
            tool_name="get_host_health",
            arguments={"hostname": "prod-02"},
            result={"hostname": "prod-02", "cpu": "40%", "status": "healthy"},
            prompt_tokens=120,
            output_tokens=25,
            latency_ms=95.0,
        ),
    )
    tool_parts = await collect(
        agent, "check prod-02", "s-insp-tm", "1.0", inspector_enabled=True
    )
    assert surface_ids(tool_parts) == ["main"]
    tool_trace = trace_parts_of(tool_parts)[0]
    assert tool_trace["stage1"]["source"] == "tool_call"
    assert tool_trace["stage1"]["toolName"] == "get_host_health"
    assert len(tool_trace["candidates"]) == 1
    assert tool_trace["candidates"][0]["decisionInput"] is not None


async def test_inspector_enabled_compare_and_slash_commands_and_error_fallbacks(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller
) -> None:
    """Verifies `/compare` traces, slash-command status cards, and failure fallback cards."""
    # Slash commands emit turn-N-status with zero trace parts even when inspector_enabled=True.
    for cmd in ("/help", "/trace", "/ratings", "/compare"):
        cmd_parts = await collect(
            agent, cmd, "s-insp-cmp", "1.0", inspector_enabled=True
        )
        assert trace_parts_of(cmd_parts) == []

    # Compare render turn omits all footers and the compare summary card, attaching 3 candidates in trace.
    scripted_llm.script("stage1", STAGE1_BLOCK)
    scripted_llm.script("express:1.0", EXPRESS_OK.replace("turn-1", "turn-1-express"))
    scripted_llm.script(
        "direct:1.0",
        direct_json_reply(agent.renderers, "1.0").replace("turn-1", "turn-1-direct"),
    )
    cmp_parts = await collect(
        agent, "compare the resort", "s-insp-cmp", "1.0", inspector_enabled=True
    )
    assert surface_ids(cmp_parts) == [
        "turn-1-decision",
        "turn-1-express",
        "turn-1-direct",
    ]
    cmp_trace = trace_parts_of(cmp_parts)[0]
    assert cmp_trace["compare"] is True
    assert [c["mode"] for c in cmp_trace["candidates"]] == [
        "decision",
        "express",
        "direct",
    ]

    # v0.9 decision render failure emits fallback turn-N-status card + trace part (M2, F1).
    scripted_llm.script("stage1", STAGE1_BLOCK)
    v09_parts = await collect(
        agent, "show resort on v0.9", "s-insp-v09", "0.9", inspector_enabled=True
    )
    assert surface_ids(v09_parts) == ["turn-1-status"]
    assert "v1.0 only" in status_text(v09_parts)
    v09_trace = trace_parts_of(v09_parts)[0]
    assert v09_trace["candidates"][0]["ok"] is False
    assert v09_trace["candidates"][0]["decisionInput"] is None

    # Stage 1 block-extraction failure emits status card + trace part with stage1.error.
    scripted_llm.script("stage1", "Plain text without an a2ui block.")
    bad_s1 = await collect(
        agent, "plain reply", "s-insp-err", "1.0", inspector_enabled=True
    )
    assert surface_ids(bad_s1) == ["turn-1-status"]
    bad_s1_trace = trace_parts_of(bad_s1)[0]
    assert bad_s1_trace["stage1"]["error"] is not None
    assert bad_s1_trace["candidates"] == []


async def test_executor_forwards_inspector_metadata_to_agent_stream(
    agent: PlaygroundAgent, scripted_llm: FakeLlmCaller
) -> None:
    """Verifies that `PlaygroundAgentExecutor.execute` forwards `a2uiPlaygroundInspector` metadata."""
    from types import SimpleNamespace
    from a2a.server.events import EventQueue
    from a2a.types import Message, Role
    from agent_executor import PlaygroundAgentExecutor, _is_inspector_enabled

    executor = PlaygroundAgentExecutor(agent)
    msg_with_meta = Message(
        message_id="m-1",
        role=Role.user,
        parts=[Part(root=TextPart(text="show resort"))],
        metadata={"a2uiPlaygroundInspector": True},
    )
    ctx_enabled = SimpleNamespace(
        message=msg_with_meta,
        current_task=None,
        call_context=None,
        get_user_input=lambda: "show resort",
    )
    assert _is_inspector_enabled(ctx_enabled) is True  # type: ignore[arg-type]

    ctx_disabled = SimpleNamespace(message=None)
    assert _is_inspector_enabled(ctx_disabled) is False  # type: ignore[arg-type]

    captured_flag: list[bool] = []
    original_stream = agent.stream

    async def _spy_stream(
        query: str,
        session_id: str,
        ui_version: str | None,
        *,
        inspector_enabled: bool = False,
    ):
        captured_flag.append(inspector_enabled)
        async for item in original_stream(
            query, session_id, ui_version, inspector_enabled=inspector_enabled
        ):
            yield item

    agent.stream = _spy_stream  # type: ignore[method-assign]
    await executor.execute(ctx_enabled, EventQueue())  # type: ignore[arg-type]
    assert captured_flag == [True]
