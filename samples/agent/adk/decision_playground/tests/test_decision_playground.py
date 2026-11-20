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

"""Unit tests for the standalone Wave 1 decision playground sample."""

from __future__ import annotations

from collections.abc import Sequence
import json
from typing import Any
from unittest.mock import AsyncMock

from a2a.server.agent_execution import RequestContext
from a2a.types import DataPart, Message, MessageSendParams, Part, Role, TextPart
import pytest

from a2ui.inference_formats.experimental.decision import (
    DecisionAnswer,
    DecisionBatch,
    DecisionQuestion,
    QuestionKind,
)
from a2ui.rpc.experimental.decision import SessionRateLimiter
from agent import PlaygroundAgent
from agent_executor import PlaygroundAgentExecutor, _extract_incoming_parts
from modes import PLAYGROUND_TRACE_MIME_TYPE, LlmToolTurn, LlmTurn, RenderMode
from recording_backend import PlaygroundMockBackend, RecordingDecisionBackend
from renderers import PlaygroundRenderers
from surfaces import RPC_PREDICATE_CATALOG_ID


class _FakeLlmCaller:
    """Deterministic `LlmCaller` for testing express/direct/compare baselines."""

    def __init__(self, reply: str) -> None:
        self._reply = reply
        self.calls: int = 0

    async def __call__(
        self,
        *,
        instruction_key: str,
        instruction: str,
        user_text: str,
        session_id: str | None,
    ) -> LlmTurn:
        del instruction_key, instruction, user_text, session_id
        self.calls += 1
        return LlmTurn(
            text=self._reply,
            prompt_tokens=100,
            output_tokens=40,
            latency_ms=12.0,
        )

    async def call_with_tools(
        self,
        *,
        instruction_key: str,
        instruction: str,
        user_text: str,
        session_id: str | None,
        tools: Sequence[Any],
    ) -> LlmToolTurn:
        del instruction_key, instruction, user_text, session_id, tools
        return LlmToolTurn()


class _FakeEventQueue:
    """Captures A2A events enqueued by `PlaygroundAgentExecutor`."""

    def __init__(self) -> None:
        self.events: list[Any] = []

    async def enqueue_event(self, event: Any) -> None:
        self.events.append(event)


def _make_agent(
    *,
    llm: _FakeLlmCaller | None = None,
    rate_limiter: SessionRateLimiter | None = None,
) -> PlaygroundAgent:
    renderers = PlaygroundRenderers(
        backend=PlaygroundMockBackend(),
        llm=llm,
        rate_limiter=rate_limiter,
    )
    return PlaygroundAgent(renderers, initial_mode=RenderMode.CASCADE)


@pytest.mark.asyncio
async def test_cascade_factual_prompt_routes_to_text_only() -> None:
    agent = _make_agent()
    result = await agent.handle_text_turn(
        "What is the capital of France?",
        context_id="ctx-1",
        include_trace=True,
    )
    assert result.messages
    assert result.trace is not None
    assert result.trace["schemaVersion"] == 1
    assert result.trace["activeMode"] == "cascade"
    candidate = result.trace["candidates"][0]
    assert candidate["mode"] == "cascade"
    assert candidate["decisionOutput"]["stage"] == "abstain_fallback"
    assert candidate["decisionOutput"]["fallbackReason"] == "needs_ui_below_threshold"
    assert candidate["decisionInput"]["questions"]


@pytest.mark.asyncio
async def test_cascade_dashboard_prompt_routes_to_template() -> None:
    agent = _make_agent()
    result = await agent.handle_text_turn(
        "Show host health dashboard metrics",
        context_id="ctx-2",
        include_trace=True,
    )
    assert result.trace is not None
    candidate = result.trace["candidates"][0]
    assert candidate["decisionOutput"]["stage"] == "template_select"
    assert candidate["decisionInput"]["backendKind"] == "mock"
    assert any("createSurface" in m for m in result.messages)


@pytest.mark.asyncio
async def test_budget_command_updates_settings_and_rejects_invalid() -> None:
    agent = _make_agent()
    ok_res = await agent.handle_text_turn(
        "/budget 300", context_id="ctx-3", include_trace=True
    )
    assert agent.get_settings("ctx-3").budget_ms == 300.0
    assert ok_res.trace is not None

    bad_res = await agent.handle_text_turn(
        "/budget -5", context_id="ctx-3", include_trace=True
    )
    assert agent.get_settings("ctx-3").budget_ms == 300.0
    assert bad_res.trace is not None
    assert bad_res.trace["candidates"][0]["ok"] is False

    off_res = await agent.handle_text_turn(
        "/budget off", context_id="ctx-3", include_trace=True
    )
    assert agent.get_settings("ctx-3").budget_ms is None
    assert off_res.trace is not None


@pytest.mark.asyncio
async def test_binder_tool_host_redacts_api_key_in_wire_and_trace() -> None:
    agent = _make_agent()
    await agent.handle_text_turn("/mode binder", context_id="ctx-4", include_trace=True)
    result = await agent.handle_text_turn(
        "/tool host", context_id="ctx-4", include_trace=True
    )
    assert result.trace is not None
    assert result.trace["activeMode"] == "binder"
    records = result.trace["candidates"][0]["decisionOutput"]["records"]
    assert isinstance(records[0]["probabilities"], list)
    assert "option" in records[0]["probabilities"][0]
    assert "prob" in records[0]["probabilities"][0]
    wire_json = json.dumps(result.messages)
    assert "sk-live-secret-do-not-expose" not in wire_json
    stage4_json = json.dumps(result.trace["candidates"][0]["wireOutput"]["messages"])
    assert "sk-live-secret-do-not-expose" not in stage4_json
    assert any("updateDataModel" in m for m in result.messages)


@pytest.mark.asyncio
async def test_tool_command_preserves_non_binder_mode() -> None:
    fake_llm = _FakeLlmCaller(
        '[{"version": "1.0", "createSurface": {"surfaceId": "turn-1-direct",'
        ' "catalogId":'
        ' "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"}}]'
    )
    agent = _make_agent(llm=fake_llm)
    await agent.handle_text_turn(
        "/mode direct", context_id="ctx-direct", include_trace=True
    )
    res = await agent.handle_text_turn(
        "/tool resort", context_id="ctx-direct", include_trace=True
    )
    assert agent.get_settings("ctx-direct").mode is RenderMode.DIRECT
    assert res.trace is not None
    assert res.trace["activeMode"] == "direct"
    assert fake_llm.calls == 1


@pytest.mark.asyncio
async def test_binder_tool_resort_binds_without_llm() -> None:
    agent = _make_agent()
    await agent.handle_text_turn("/mode binder", context_id="ctx-5", include_trace=True)
    result = await agent.handle_text_turn(
        "/tool resort", context_id="ctx-5", include_trace=True
    )
    assert result.trace is not None
    candidate = result.trace["candidates"][0]
    assert candidate["metrics"]["llmCalls"] == 0
    assert any("createSurface" in m for m in result.messages)


@pytest.mark.asyncio
async def test_backend_step0_without_url_rolls_back_cleanly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("STEP0_URL", raising=False)
    monkeypatch.delenv("A2UI_DECISION_URL", raising=False)
    agent = _make_agent()
    res = await agent.handle_text_turn(
        "/backend step0", context_id="ctx-6", include_trace=True
    )
    assert agent.get_settings("ctx-6").backend_kind == "mock"
    assert res.trace is not None
    assert res.trace["candidates"][0]["ok"] is False
    assert "A2UI_DECISION_URL" in (res.trace["candidates"][0]["error"] or "")


@pytest.mark.asyncio
async def test_backend_jev_does_not_inherit_gemini_env_vars(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("A2UI_DECISION_BACKEND", "gemini")
    monkeypatch.setenv(
        "A2UI_DECISION_URL",
        "https://generativelanguage.googleapis.com/v1beta/decisions",
    )
    monkeypatch.setenv("A2UI_DECISION_MODEL", "gemini-decision-1")
    monkeypatch.setenv("A2UI_DECISION_AUTH", "gemini-key")
    monkeypatch.setenv("JEV_API_KEY", "jev-test-key")
    monkeypatch.delenv("JEV_URL", raising=False)
    monkeypatch.delenv("JEV_MODEL", raising=False)

    agent = _make_agent()
    res = await agent.handle_text_turn(
        "/backend jev", context_id="ctx-jev", include_trace=True
    )
    assert res.trace is not None
    assert res.trace["candidates"][0]["ok"] is True
    assert agent._renderers.model_id != "gemini-decision-1"
    assert "generativelanguage" not in (agent._renderers.endpoint_url or "")


@pytest.mark.asyncio
async def test_rpc_form_and_predicate_pass_fail_and_rate_limit() -> None:
    limiter = SessionRateLimiter(max_calls=2, window_seconds=60.0)
    agent = _make_agent(rate_limiter=limiter)

    form_res = await agent.handle_text_turn(
        "/form bug", context_id="ctx-rpc", include_trace=True
    )
    assert form_res.trace is not None
    assert form_res.trace["activeMode"] == "rpc"
    assert any("createSurface" in m for m in form_res.messages)

    pass_call = {
        "version": "1.0",
        "callAgentFunction": {
            "surfaceId": "main",
            "functionCallId": "call-pass",
            "callFunction": {
                "@call": "is_specific_bug_report",
                "catalogId": RPC_PREDICATE_CATALOG_ID,
                "args": {
                    "value": (
                        "Crash on empty payload. Steps: 1. Open app 2. Click submit."
                        " Expected: validation error. Actual: unhandled TypeError."
                    ),
                },
            },
        },
    }
    pass_res = await agent.handle_rpc_messages(
        [pass_call], context_id="ctx-rpc", include_trace=True
    )
    assert len(pass_res.messages) == 1
    pass_body = pass_res.messages[0]["agentFunctionResponse"]
    assert pass_body["functionCallId"] == "call-pass"
    assert pass_body["value"] is True
    assert pass_res.trace is not None
    assert pass_res.trace["candidates"][0]["decisionInput"]["questions"]

    fail_call = {
        "version": "1.0",
        "callAgentFunction": {
            "surfaceId": "main",
            "functionCallId": "call-fail",
            "callFunction": {
                "@call": "is_specific_bug_report",
                "catalogId": RPC_PREDICATE_CATALOG_ID,
                "args": {"value": "broken"},
            },
        },
    }
    fail_res = await agent.handle_rpc_messages(
        [fail_call], context_id="ctx-rpc", include_trace=True
    )
    fail_body = fail_res.messages[0]["agentFunctionResponse"]
    assert fail_body["functionCallId"] == "call-fail"
    assert fail_body["value"] is False

    limited_call = {
        "version": "1.0",
        "callAgentFunction": {
            "surfaceId": "main",
            "functionCallId": "call-limited",
            "callFunction": {
                "@call": "is_specific_bug_report",
                "catalogId": RPC_PREDICATE_CATALOG_ID,
                "args": {"value": "third call"},
            },
        },
    }
    limited_res = await agent.handle_rpc_messages(
        [limited_call], context_id="ctx-rpc", include_trace=True
    )
    limited_body = limited_res.messages[0]["agentFunctionResponse"]
    assert limited_body["error"]["code"] == "RATE_LIMITED"


@pytest.mark.asyncio
async def test_executor_handles_call_agent_function_and_ignores_use_streaming() -> None:
    agent = _make_agent()
    executor = PlaygroundAgentExecutor(agent)
    queue = _FakeEventQueue()

    msg = Message(
        message_id="msg-1",
        context_id="ctx-exec",
        role=Role.user,
        metadata={"a2uiPlaygroundInspector": True},
        parts=[
            Part(root=DataPart(data={"useStreaming": False})),
            Part(
                root=DataPart(
                    data={
                        "version": "1.0",
                        "callAgentFunction": {
                            "surfaceId": "main",
                            "functionCallId": "rpc-1",
                            "callFunction": {
                                "@call": "is_specific_bug_report",
                                "catalogId": RPC_PREDICATE_CATALOG_ID,
                                "args": {
                                    "value": (
                                        "Crash on load. Steps: Open page and click"
                                        " reload twice. Expected: loads cleanly."
                                        " Actual: spinner hangs."
                                    ),
                                },
                            },
                        },
                    }
                )
            ),
        ],
    )
    ctx = RequestContext(
        request=MessageSendParams(message=msg),
        task_id="task-1",
        context_id="ctx-exec",
    )

    rpc_msgs, text_q, pasted = _extract_incoming_parts(list(msg.parts))
    assert len(rpc_msgs) == 1
    assert text_q == ""
    assert pasted is None

    await executor.execute(ctx, queue)  # type: ignore[arg-type]
    status_events = [e for e in queue.events if hasattr(e, "status")]
    assert status_events
    final_msg = status_events[-1].status.message
    assert final_msg is not None
    data_parts = [p.root for p in final_msg.parts if isinstance(p.root, DataPart)]
    assert any("agentFunctionResponse" in p.data for p in data_parts)
    trace_parts = [
        p
        for p in data_parts
        if (p.metadata or {}).get("mimeType") == PLAYGROUND_TRACE_MIME_TYPE
    ]
    assert len(trace_parts) == 1
    assert trace_parts[0].data["schemaVersion"] == 1


@pytest.mark.asyncio
async def test_compare_runs_cascade_express_and_direct() -> None:
    fake_llm = _FakeLlmCaller(
        '[{"version": "v1.0", "createSurface": {"surfaceId": "s", "catalogId":'
        ' "https://a2ui.org/specification/v1_0/basic_catalog.json"}}]'
    )
    agent = _make_agent(llm=fake_llm)
    await agent.handle_text_turn("/compare", context_id="ctx-cmp", include_trace=True)
    res = await agent.handle_text_turn(
        "Show host metrics", context_id="ctx-cmp", include_trace=True
    )
    assert res.trace is not None
    assert res.trace["compare"] is True
    modes = [c["mode"] for c in res.trace["candidates"]]
    assert modes == ["cascade", "express", "direct"]


@pytest.mark.asyncio
async def test_recording_decision_backend_captures_batch_and_answers() -> None:
    inner = PlaygroundMockBackend()
    recorder = RecordingDecisionBackend(inner)
    batch = DecisionBatch(
        state="Show host metrics",
        questions=(
            DecisionQuestion(
                id="gate:needs_ui",
                kind=QuestionKind.BOOLEAN,
                prompt="Does this request benefit from a UI?",
            ),
        ),
    )
    answers = await recorder.answer(batch)
    assert len(answers) == 1
    assert isinstance(answers[0], DecisionAnswer)
    assert len(recorder.calls) == 1
    assert recorder.calls[0].batch is batch
    assert recorder.calls[0].answers == tuple(answers)
