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

"""Unit tests for `inspector_trace`: wire parity, pruning, cache keys, and URL scrubbing."""

from __future__ import annotations

import json
from typing import Any

from a2a.types import DataPart
import httpx
import pytest

from a2ui.inference_formats.decision import (
    BackendCapabilities,
    DecisionBlock,
    DeterministicMockBackend,
    JevHttpBackend,
    inspect_payload_pointers,
)
from inspector_trace import (
    PLAYGROUND_TRACE_MIME_TYPE,
    build_turn_trace,
    create_trace_part,
    format_wire_request,
    resolve_wire_format,
    sanitize_endpoint_url,
)
from modes import LlmTurn, RenderMode, RenderResult, TurnMetrics
from renderers import Renderers
from test_renderers import RESORT_BLOCK, RESORT_PAYLOAD

pytestmark = pytest.mark.asyncio

HOST_BLOCK = DecisionBlock(
    intent="Check host health",
    payload={"host": "prod-1", "cpu": 0.78, "status": "ok"},
)


async def test_sanitize_endpoint_url_strips_userinfo_query_and_fragment() -> None:
    """Verifies `sanitize_endpoint_url` strips credentials, query strings, and fragments."""
    raw = (
        "https://user:super_secret@jev.example.com:8443/v1beta/decisions"
        "?key=AIzaSySecretKey123&alt=json#frag"
    )
    assert sanitize_endpoint_url(raw) == "https://jev.example.com:8443/v1beta/decisions"
    assert (
        sanitize_endpoint_url("http://[::1]:9000/v1/systemone?token=abc")
        == "http://[::1]:9000/v1/systemone"
    )
    assert sanitize_endpoint_url(None) is None
    assert sanitize_endpoint_url("") is None
    assert sanitize_endpoint_url("   ") is None
    assert sanitize_endpoint_url("not-a-url") is None
    assert sanitize_endpoint_url("https://host:badport/path") is None


async def test_format_wire_request_matches_jev_http_backend_for_gemini_decisions_and_systemone() -> (
    None
):
    """Verifies `format_wire_request` matches `JevHttpBackend` wire payloads across formats."""
    renderers = Renderers(versions=["1.0"], backend=DeterministicMockBackend())
    synthesizer = renderers.synthesizer_or_none("1.0")
    assert synthesizer is not None
    pointers = inspect_payload_pointers(RESORT_PAYLOAD)
    batch, _ = synthesizer.planner.build_batch(
        RESORT_BLOCK.intent,
        pointers,
        payload=RESORT_PAYLOAD,
    )
    assert len(batch.questions) > 5

    captured_bodies: list[dict[str, Any]] = []

    def _mock_handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        captured_bodies.append(body)
        questions = body.get("questions", {})
        answers: dict[str, Any] = {}
        for qid, qspec in questions.items():
            qtype = qspec.get("type")
            if qtype == "noul":
                answers[qid] = {"true": 0.8, "false": 0.2}
            elif qtype == "score":
                answers[qid] = {"1": 0.1, "2": 0.2, "3": 0.7}
            else:
                criteria = qspec.get("criteria", {})
                first = next(iter(criteria.keys()), "none")
                answers[qid] = {k: 0.9 if k == first else 0.1 for k in criteria}
        return httpx.Response(200, json={"answers": answers})

    transport = httpx.MockTransport(_mock_handler)
    async with httpx.AsyncClient(transport=transport) as client:
        gemini_backend = JevHttpBackend(
            endpoint_url="https://generativelanguage.googleapis.com/v1beta/decisions",
            auth="SECRET",
            model="models/gemini-3.1-flash-lite-preview",
            client=client,
        )
        assert resolve_wire_format(gemini_backend) == "gemini_decisions"
        await gemini_backend.answer(batch)
        expected_gemini = captured_bodies[-1]
        actual_gemini = format_wire_request(gemini_backend, batch, "gemini_decisions")
        assert actual_gemini == expected_gemini
        assert "input" in actual_gemini
        assert "q_0" in actual_gemini["questions"]

        systemone_backend = JevHttpBackend(
            endpoint_url="https://api.systemone.ai/v1/systemone",
            auth="vcp_test",
            model="systemone-default",
            client=client,
        )
        assert resolve_wire_format(systemone_backend) == "systemone"
        await systemone_backend.answer(batch)
        expected_systemone = captured_bodies[-1]
        actual_systemone = format_wire_request(systemone_backend, batch, "systemone")
        assert actual_systemone == expected_systemone
        assert "state" in actual_systemone
        assert batch.questions[0].id in actual_systemone["questions"]

        native_backend = JevHttpBackend(
            endpoint_url="https://jev.internal/v1/decide",
            auth="jev_key",
            model="jev-v1",
            client=client,
        )
        assert resolve_wire_format(native_backend) == "jev"
        native_req = format_wire_request(native_backend, batch, "jev")
        assert native_req is not None
        assert native_req["shared_context"] == dict(batch.shared_context)
        assert len(native_req["questions"]) == len(batch.questions)
        assert native_req["questions"][0]["id"] == batch.questions[0].id


async def test_build_turn_trace_marks_pruned_questions_and_excludes_synthetic_fit_score() -> (
    None
):
    """Verifies `build_turn_trace` marks pruned questions and excludes synthetic `fit_score` rows."""
    renderers = Renderers(versions=["1.0"], backend=DeterministicMockBackend())
    result = await renderers.render_decision(
        RESORT_BLOCK, surface_id="main", version="1.0", conversation_id="conv-1"
    )
    assert result.ok and result.output is not None
    assert result.metrics is not None

    stage1_turn = LlmTurn(
        text="<a2ui>{}</a2ui>",
        prompt_tokens=110,
        output_tokens=45,
        latency_ms=85.5,
    )
    metrics = result.metrics.plus_stage1(stage1_turn)
    trace = build_turn_trace(
        turn=1,
        query="Show the resort",
        compare=False,
        active_mode=RenderMode.DECISION,
        stage1_source="llm",
        model_name="gemini-3.6-flash",
        stage1_turn=stage1_turn,
        tool_name=None,
        tool_args=None,
        block=RESORT_BLOCK,
        stage1_error=None,
        candidates=[(RenderMode.DECISION, "main", result, metrics)],
        synthesizer=renderers.synthesizer_or_none("1.0"),
    )

    assert trace["schemaVersion"] == 1
    assert trace["turn"] == 1
    assert trace["stage1"]["source"] == "llm"
    assert trace["stage1"]["block"]["intent"] == RESORT_BLOCK.intent

    cand = trace["candidates"][0]
    d_in = cand["decisionInput"]
    d_out = cand["decisionOutput"]
    assert d_in is not None and d_out is not None

    # Speculative batch has more questions than non-synthetic trace rows, so pruned questions exist.
    non_synthetic_ids = {
        r.question.id for r in result.output.trace if r.answer is not None
    }
    assert d_in["questionCount"] == len(d_in["questions"])
    assert d_in["questionCount"] > len(non_synthetic_ids)

    pruned_in = [q for q in d_in["questions"] if q["pruned"]]
    active_in = [q for q in d_in["questions"] if not q["pruned"]]
    assert len(pruned_in) > 0
    assert {q["id"] for q in active_in} == non_synthetic_ids

    # Synthetic fit_score (answer=None) is excluded from records and surfaced on decisionOutput.fitScore.
    record_ids = {r["questionId"] for r in d_out["records"]}
    assert "fit_score" not in record_ids
    assert d_out["fitScore"] is not None
    assert any(r["pruned"] for r in d_out["records"])
    assert d_out["layoutPlan"] is not None
    assert d_out["layoutPlan"]["family"] == result.output.layout_plan.family

    part = create_trace_part(trace)
    assert isinstance(part.root, DataPart)
    assert part.root.metadata == {"mimeType": PLAYGROUND_TRACE_MIME_TYPE}


async def test_build_turn_trace_handles_list_payload_exclude_and_labels_cache_key_parity() -> (
    None
):
    """Verifies list payload normalization and `exclude`/`labels` cache key parity."""
    renderers = Renderers(versions=["1.0"], backend=DeterministicMockBackend())
    synthesizer = renderers.synthesizer_or_none("1.0")
    assert synthesizer is not None

    # 1. List/array payload normalized to {"items": ...}
    list_block = DecisionBlock(
        intent="Show top resorts",
        payload=[
            {"name": "Casa Verde", "rating": 4.9},
            {"name": "Mont Blanc", "rating": 4.7},
        ],
    )
    list_res = await renderers.render_decision(
        list_block, surface_id="list-surf", version="1.0"
    )
    assert list_res.ok and list_res.metrics is not None
    list_trace = build_turn_trace(
        turn=1,
        query="list resorts",
        compare=False,
        active_mode=RenderMode.DECISION,
        stage1_source="pasted_json",
        model_name="fake-model",
        stage1_turn=None,
        tool_name=None,
        tool_args=None,
        block=list_block,
        stage1_error=None,
        candidates=[(RenderMode.DECISION, "list-surf", list_res, list_res.metrics)],
        synthesizer=synthesizer,
    )
    list_pointers = list_trace["candidates"][0]["decisionInput"]["pointers"]
    assert any(p["path"].startswith("/items") for p in list_pointers)

    # 2. block.exclude and block.labels parity with synthesizer.make_cache_key
    filtered_block = DecisionBlock(
        intent="Show resort summary",
        payload={
            "name": "Casa Verde",
            "location": "Taos, NM",
            "debug_token": "drop-me",
            "internal": {"trace_id": "123"},
        },
        exclude=("/debug_token", "/internal"),
        labels={"/name": "Property Title"},
    )
    filt_res = await renderers.render_decision(
        filtered_block, surface_id="filt-surf", version="1.0"
    )
    assert filt_res.ok and filt_res.metrics is not None
    filt_trace = build_turn_trace(
        turn=2,
        query="filtered resort",
        compare=False,
        active_mode=RenderMode.DECISION,
        stage1_source="llm",
        model_name="fake-model",
        stage1_turn=None,
        tool_name=None,
        tool_args=None,
        block=filtered_block,
        stage1_error=None,
        candidates=[(RenderMode.DECISION, "filt-surf", filt_res, filt_res.metrics)],
        synthesizer=synthesizer,
    )
    d_in = filt_trace["candidates"][0]["decisionInput"]
    paths = {p["path"]: p for p in d_in["pointers"]}
    assert "/debug_token" not in paths
    assert not any(path.startswith("/internal") for path in paths)
    assert paths["/name"]["label"] == "Property Title"


async def test_build_turn_trace_plan_cache_hit_and_region_update_and_two_stage() -> (
    None
):
    """Verifies `PlanCache` hit traces, region-update batches, and two-stage decision batches."""
    renderers = Renderers(versions=["1.0"], backend=DeterministicMockBackend())
    synthesizer = renderers.synthesizer_or_none("1.0")
    assert synthesizer is not None

    # Turn 1: initial render of HOST_BLOCK
    res1 = await renderers.render_decision(
        HOST_BLOCK, surface_id="main", version="1.0", conversation_id="c-cache"
    )
    assert res1.ok and res1.metrics is not None
    trace1 = build_turn_trace(
        turn=1,
        query="/tool host",
        compare=False,
        active_mode=RenderMode.TOOL,
        stage1_source="direct_tool",
        model_name="fake-model",
        stage1_turn=None,
        tool_name="get_host_health",
        tool_args={},
        block=HOST_BLOCK,
        stage1_error=None,
        candidates=[(RenderMode.TOOL, "main", res1, res1.metrics)],
        synthesizer=synthesizer,
    )
    sig1 = trace1["candidates"][0]["decisionInput"]["shapeSignature"]
    assert trace1["candidates"][0]["decisionInput"]["cacheHit"] is False

    # Turn 2: identical shape triggers PlanCache hit
    res2 = await renderers.render_decision(
        HOST_BLOCK, surface_id="main", version="1.0", conversation_id="c-cache"
    )
    assert res2.ok and res2.metrics is not None
    trace2 = build_turn_trace(
        turn=2,
        query="/tool host",
        compare=False,
        active_mode=RenderMode.TOOL,
        stage1_source="direct_tool",
        model_name="fake-model",
        stage1_turn=None,
        tool_name="get_host_health",
        tool_args={},
        block=HOST_BLOCK,
        stage1_error=None,
        candidates=[(RenderMode.TOOL, "main", res2, res2.metrics)],
        synthesizer=synthesizer,
    )
    cand2 = trace2["candidates"][0]
    assert cand2["decisionInput"]["cacheHit"] is True
    assert cand2["decisionInput"]["decisionCalls"] == 0
    assert cand2["decisionInput"]["shapeSignature"] == sig1
    assert cand2["wireOutput"]["messageKinds"] == ["updateDataModel"]

    # Region update block on existing surface
    assert res1.output is not None and res1.output.layout_plan is not None
    target_region = res1.output.layout_plan.blocks[0].block_id
    region_block = DecisionBlock(
        intent=HOST_BLOCK.intent,
        payload=HOST_BLOCK.payload,
        region=target_region,
    )
    res_region = await renderers.render_decision(
        region_block, surface_id="main", version="1.0", conversation_id="c-cache"
    )
    assert res_region.ok and res_region.metrics is not None
    trace_region = build_turn_trace(
        turn=3,
        query="refresh region",
        compare=False,
        active_mode=RenderMode.DECISION,
        stage1_source="llm",
        model_name="fake-model",
        stage1_turn=None,
        tool_name=None,
        tool_args=None,
        block=region_block,
        stage1_error=None,
        candidates=[(RenderMode.DECISION, "main", res_region, res_region.metrics)],
        synthesizer=synthesizer,
    )
    region_q_ids = [
        q["id"] for q in trace_region["candidates"][0]["decisionInput"]["questions"]
    ]
    assert "family" not in region_q_ids
    assert all(
        qid.startswith(
            (f"anatomy:{target_region}.", f"instance:{target_region}.", "salience:")
        )
        for qid in region_q_ids
    )

    # Two-stage backend reconstruction
    two_stage_backend = DeterministicMockBackend(
        capabilities=BackendCapabilities(two_stage=True)
    )
    two_stage_renderers = Renderers(versions=["1.0"], backend=two_stage_backend)
    res_two = await two_stage_renderers.render_decision(
        RESORT_BLOCK, surface_id="main", version="1.0"
    )
    assert res_two.ok and res_two.metrics is not None
    trace_two = build_turn_trace(
        turn=1,
        query="two stage resort",
        compare=False,
        active_mode=RenderMode.DECISION,
        stage1_source="llm",
        model_name="fake-model",
        stage1_turn=None,
        tool_name=None,
        tool_args=None,
        block=RESORT_BLOCK,
        stage1_error=None,
        candidates=[(RenderMode.DECISION, "main", res_two, res_two.metrics)],
        synthesizer=two_stage_renderers.synthesizer_or_none("1.0"),
    )
    assert trace_two["candidates"][0]["decisionInput"]["decisionCalls"] == 2
    assert trace_two["candidates"][0]["decisionInput"]["questionCount"] > 3


async def test_build_turn_trace_express_candidate_populates_llm_stage2() -> None:
    """Verifies that Express mode candidates populate `llmStage2` and omit decision stages."""
    metrics = TurnMetrics(
        mode=RenderMode.EXPRESS,
        backend="llm",
        llm_calls=2,
        latency_ms=420.0,
        prompt_tokens=300,
        output_tokens=120,
    )
    result = RenderResult(
        parts=[],
        metrics=metrics,
        messages=({"version": "1.0", "createSurface": {"surfaceId": "turn-1"}},),
        raw_stage2_text="<a2ui-express>surface turn-1</a2ui-express>",
        decompiled_express="surface turn-1",
    )
    trace = build_turn_trace(
        turn=1,
        query="show resort",
        compare=False,
        active_mode=RenderMode.EXPRESS,
        stage1_source="llm",
        model_name="fake-model",
        stage1_turn=LlmTurn(text="<a2ui>{}</a2ui>", latency_ms=100.0),
        tool_name=None,
        tool_args=None,
        block=RESORT_BLOCK,
        stage1_error=None,
        candidates=[(RenderMode.EXPRESS, "turn-1", result, metrics)],
        synthesizer=None,
    )
    cand = trace["candidates"][0]
    assert cand["decisionInput"] is None
    assert cand["decisionOutput"] is None
    assert cand["llmStage2"] is not None
    assert cand["llmStage2"]["attempts"] == 2
    assert cand["llmStage2"]["retries"] == 1
    assert cand["llmStage2"]["validationRetry"] is True
    assert (
        cand["llmStage2"]["rawReply"] == "<a2ui-express>surface turn-1</a2ui-express>"
    )
    assert cand["wireOutput"]["decompiledExpress"] == "surface turn-1"


async def test_build_turn_trace_abstention_marks_unreached_questions_pruned() -> None:
    """Verifies that abstention turns (`layout_plan is None`) mark unreached questions as pruned."""
    # Force an early family abstention so output.layout_plan is None while output.trace is non-empty (M2).
    abstain_backend = DeterministicMockBackend(
        scripted={"family": {"browse": 0.05, "monitor": 0.05}}
    )
    abstain_renderers = Renderers(versions=["1.0"], backend=abstain_backend)
    synthesizer = abstain_renderers.synthesizer_or_none("1.0")
    assert synthesizer is not None

    res = await abstain_renderers.render_decision(
        RESORT_BLOCK, surface_id="main", version="1.0"
    )
    assert res.ok and res.output is not None and res.metrics is not None
    assert res.output.layout_plan is None

    trace = build_turn_trace(
        turn=1,
        query="abstain resort",
        compare=False,
        active_mode=RenderMode.DECISION,
        stage1_source="llm",
        model_name="fake-model",
        stage1_turn=None,
        tool_name=None,
        tool_args=None,
        block=RESORT_BLOCK,
        stage1_error=None,
        candidates=[(RenderMode.DECISION, "main", res, res.metrics)],
        synthesizer=synthesizer,
    )
    cand = trace["candidates"][0]
    d_in = cand["decisionInput"]
    d_out = cand["decisionOutput"]
    assert d_in is not None and d_out is not None
    assert d_out["layoutPlan"] is None
    assert any(q["pruned"] for q in d_in["questions"])
    assert any(not q["pruned"] for q in d_in["questions"])
    assert any(r["pruned"] for r in d_out["records"])


async def test_build_turn_trace_empty_payload_returns_zero_questions_when_no_archetype_eligible() -> (
    None
):
    """Verifies that `_build_planner_batch` returns an empty batch when no archetype is eligible."""
    renderers = Renderers(versions=["1.0"], backend=DeterministicMockBackend())
    synthesizer = renderers.synthesizer_or_none("1.0")
    assert synthesizer is not None

    # Excluding the only field leaves 0 pointers and 0 eligible archetypes (L1).
    empty_after_exclude = DecisionBlock.from_mapping({
        "intent": "Show empty payload",
        "payload": {"internal_only": "secret"},
        "exclude": ["/internal_only"],
        "fallbackDsl": 'surface("main")\nroot = Column([Text("Empty")])',
    })
    res = await renderers.render_decision(
        empty_after_exclude, surface_id="main", version="1.0"
    )
    assert res.ok and res.metrics is not None
    trace = build_turn_trace(
        turn=1,
        query="empty payload",
        compare=False,
        active_mode=RenderMode.DECISION,
        stage1_source="llm",
        model_name="fake-model",
        stage1_turn=None,
        tool_name=None,
        tool_args=None,
        block=empty_after_exclude,
        stage1_error=None,
        candidates=[(RenderMode.DECISION, "main", res, res.metrics)],
        synthesizer=synthesizer,
    )
    d_in = trace["candidates"][0]["decisionInput"]
    assert d_in is not None
    assert d_in["questionCount"] == 0
    assert d_in["questions"] == []
