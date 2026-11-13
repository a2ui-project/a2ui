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

"""Tests for stage 2: decision, express, and direct renderers plus status surfaces."""

from __future__ import annotations

import json
from typing import Any

from a2a.types import DataPart, Part
import pytest

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import DecisionBlock, DeterministicMockBackend
from a2ui.utils import validate_payload
from fakes import FakeLlmCaller
from modes import RenderMode
from renderers import Renderers, backend_display_name, stage2_user_text

RESORT_PAYLOAD: dict[str, Any] = {
    "name": "Casa Verde",
    "logoUrl": "https://example.com/casa-verde/logo.png",
    "rating": 4.6,
    "priceFrom": 240,
    "about": (
        "A quiet hillside resort twenty minutes from the old town, with a"
        " spring-fed pool, garden suites, and a breakfast terrace that looks"
        " over the valley. Families and walkers come back year after year."
    ),
    "photos": [
        {
            "url": "https://example.com/casa-verde/1.jpg",
            "caption": "Pool at dusk",
        },
        {
            "url": "https://example.com/casa-verde/2.jpg",
            "caption": "Garden suite",
        },
        {
            "url": "https://example.com/casa-verde/3.jpg",
            "caption": "Breakfast terrace",
        },
    ],
}
RESORT_BLOCK = DecisionBlock(intent="Show the resort overview", payload=RESORT_PAYLOAD)

EXPRESS_OK = '<a2ui>surface("turn-1")\nroot = Column([Text("Portfolio")])</a2ui>'
EXPRESS_BAD = "<a2ui>root = Nope(</a2ui>"


def direct_json_reply(renderers: Renderers, version: str) -> str:
    """Builds a valid Direct JSON reply for `version` from a compiled surface.

    Args:
        renderers: Playground renderers instance used to build a status surface.
        version: Target A2UI protocol version.

    Returns:
        An `<a2ui-json>` tagged JSON array string.
    """
    parts = renderers.status_surface(
        ["Portfolio"], surface_id="turn-1", version=version
    )
    return f"<a2ui-json>{json.dumps(messages_of(parts))}</a2ui-json>"


def messages_of(parts: list[Part]) -> list[dict[str, Any]]:
    """Extracts the raw dictionary payloads from all `DataPart` entries.

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
        if isinstance(create, dict) and "surfaceId" in create:
            ids.append(str(create["surfaceId"]))
    return ids


@pytest.fixture(scope="module")
def renderers() -> Renderers:
    """Provides a module-scoped `Renderers` instance backed by `DeterministicMockBackend`.

    Returns:
        A configured `Renderers` instance for versions 0.9 and 1.0.
    """
    return Renderers(versions=["0.9", "1.0"], backend=DeterministicMockBackend())


def test_backend_display_name_maps_bundled_backends(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verifies that `backend_display_name` and `build_named_backend` format backend labels."""
    from a2ui.inference_formats.decision import JevHttpBackend
    from renderers import build_named_backend

    assert backend_display_name(DeterministicMockBackend()) == "mock"
    assert (
        backend_display_name(
            JevHttpBackend("https://api.typesafe.ai/v1/systemone", model="jev-1.14.0")
        )
        == "jev (jev-1.14.0)"
    )
    assert (
        backend_display_name(
            JevHttpBackend(
                "https://generativelanguage.googleapis.com/v1beta/decisions",
                model="gemini-decision-1",
            )
        )
        == "gemini (gemini-decision-1)"
    )

    monkeypatch.setenv("JEV_API_KEY", "vcp_test_key")
    jev_b = build_named_backend("jev")
    assert backend_display_name(jev_b) == "jev"
    monkeypatch.setenv("GEMINI_API_KEY", "gem_test_key")
    gemini_b = build_named_backend("gemini")
    assert backend_display_name(gemini_b) == "gemini (gemini-decision-1)"

    class Custom:
        pass

    assert backend_display_name(Custom()) == "Custom"  # type: ignore[arg-type]


def test_build_named_backend_isolates_preset_env_vars(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verifies that `/backend` preset switching ignores `A2UI_DECISION_*` for other presets."""
    from a2ui.inference_formats.decision import JevHttpBackend
    from renderers import build_named_backend

    # Simulate starting with A2UI_DECISION_BACKEND=gemini and Gemini-specific A2UI_DECISION_* vars.
    monkeypatch.setenv("A2UI_DECISION_BACKEND", "gemini")
    monkeypatch.setenv(
        "A2UI_DECISION_URL",
        "https://generativelanguage.googleapis.com/v1beta/decisions",
    )
    monkeypatch.setenv("A2UI_DECISION_MODEL", "models/gemini-3.1-flash-lite-preview")
    monkeypatch.setenv("A2UI_DECISION_AUTH", "gemini-startup-secret")
    monkeypatch.setenv("JEV_API_KEY", "vcp_jev_secret")
    monkeypatch.setenv("JEV_MODEL", "jev-custom-model")

    # Switching to jev at runtime must not inherit the Gemini A2UI_DECISION_* variables (H2).
    jev_backend = build_named_backend("jev")
    assert isinstance(jev_backend, JevHttpBackend)
    assert (
        jev_backend.endpoint_url == "https://ai-gateway.vercel.sh/typesafe/v1/systemone"
    )
    assert jev_backend.model_id == "jev-custom-model"

    # Building gemini when A2UI_DECISION_BACKEND=gemini honors the matching A2UI_DECISION_* vars.
    gemini_backend = build_named_backend("gemini")
    assert isinstance(gemini_backend, JevHttpBackend)
    assert (
        gemini_backend.endpoint_url
        == "https://generativelanguage.googleapis.com/v1beta/decisions"
    )
    assert gemini_backend.model_id == "models/gemini-3.1-flash-lite-preview"

    # Now flip A2UI_DECISION_BACKEND=jev and verify build_named_backend("gemini") uses Gemini defaults.
    monkeypatch.setenv("A2UI_DECISION_BACKEND", "jev")
    monkeypatch.setenv("A2UI_DECISION_URL", "https://api.typesafe.ai/v1/systemone")
    monkeypatch.setenv("A2UI_DECISION_MODEL", "systemone-default")
    monkeypatch.setenv("A2UI_DECISION_AUTH", "vcp_startup_secret")
    monkeypatch.setenv("GEMINI_API_KEY", "gem_runtime_secret")
    monkeypatch.delenv("GEMINI_DECISION_MODEL", raising=False)

    gemini_from_jev = build_named_backend("gemini")
    assert isinstance(gemini_from_jev, JevHttpBackend)
    assert (
        gemini_from_jev.endpoint_url
        == "https://generativelanguage.googleapis.com/v1beta/decisions"
    )
    assert gemini_from_jev.model_id == "gemini-decision-1"


def test_renderers_state_for_evicts_oldest_conversation_states() -> None:
    """Verifies that `Renderers.state_for` bounds `_states` to 100 entries with LRU eviction."""
    local_renderers = Renderers(versions=["1.0"], backend=DeterministicMockBackend())
    for i in range(100):
        local_renderers.state_for(f"conv-{i}")
    assert len(local_renderers._states) == 100

    # Touch conv-0 so conv-1 becomes the least-recently-used entry.
    local_renderers.state_for("conv-0")
    local_renderers.state_for("conv-100")

    assert len(local_renderers._states) == 100
    assert "conv-0" in local_renderers._states
    assert "conv-1" not in local_renderers._states
    assert "conv-100" in local_renderers._states


@pytest.mark.asyncio
async def test_render_decision_rejects_v09_clients(renderers: Renderers) -> None:
    """Verifies that `render_decision` returns an error for v0.9 clients."""
    result = await renderers.render_decision(
        RESORT_BLOCK, surface_id="turn-1", version="0.9"
    )
    assert not result.ok
    assert result.error is not None and "v1.0 only" in result.error


@pytest.mark.parametrize("version", ["1.0"])
@pytest.mark.asyncio
async def test_render_decision_produces_a_surface_without_llm_calls(
    renderers: Renderers, version: str
) -> None:
    """Verifies that `render_decision` synthesizes a valid v1.0 surface with 0 LLM calls."""
    result = await renderers.render_decision(
        RESORT_BLOCK, surface_id="turn-1", version=version
    )
    assert result.ok, result.error
    assert surface_ids(result.parts) == ["turn-1"]
    validate_payload([BasicCatalog(version)], messages_of(result.parts))
    assert result.metrics is not None
    assert result.metrics.llm_calls == 0
    assert result.metrics.backend == "mock"
    assert result.metrics.mode is RenderMode.DECISION
    assert any("`family`" in line for line in result.trace_lines)
    assert "**decision** · mock · 0 LLM calls" in result.metrics.footer()
    assert len(result.messages) >= 2
    assert 'surface("turn-1")' in result.decompiled_express
    assert renderers.backend.backend_kind == "mock"
    assert renderers.synthesizer_or_none("1.0") is not None
    assert renderers.synthesizer_or_none("0.9") is None


@pytest.mark.asyncio
async def test_render_with_llm_express_succeeds_retries_and_fails(
    renderers: Renderers, scripted_llm: FakeLlmCaller
) -> None:
    """Verifies `render_with_llm` in Express mode across first-pass, retry, and failure paths."""
    scripted_llm.script("express:1.0", EXPRESS_OK)
    ok = await renderers.render_with_llm(
        RenderMode.EXPRESS,
        RESORT_BLOCK,
        surface_id="turn-1",
        version="1.0",
        llm=scripted_llm,
    )
    assert ok.ok, ok.error
    assert surface_ids(ok.parts) == ["turn-1"]
    assert ok.metrics is not None and ok.metrics.llm_calls == 1
    assert ok.metrics.backend == "llm" and ok.metrics.fallback is None
    assert len(ok.messages) == 1
    assert ok.raw_stage2_text == EXPRESS_OK
    assert 'surface("turn-1")' in ok.decompiled_express
    call = scripted_llm.calls_for("express:1.0")[0]
    assert call["session_id"] is None
    assert "Casa Verde" in str(call["user_text"]) and "turn-1" in str(call["user_text"])
    assert "Express" in str(call["instruction"]) or "surface(" in str(
        call["instruction"]
    )

    scripted_llm.script("express:1.0", EXPRESS_BAD, EXPRESS_OK)
    retried = await renderers.render_with_llm(
        RenderMode.EXPRESS,
        RESORT_BLOCK,
        surface_id="turn-1",
        version="1.0",
        llm=scripted_llm,
    )
    assert retried.ok
    assert retried.metrics is not None and retried.metrics.llm_calls == 2
    assert retried.metrics.fallback == "validation_retry"
    assert "previous reply was invalid" in str(
        scripted_llm.calls_for("express:1.0")[-1]["user_text"]
    )

    scripted_llm.script("express:1.0", EXPRESS_BAD, EXPRESS_BAD)
    failed = await renderers.render_with_llm(
        RenderMode.EXPRESS,
        RESORT_BLOCK,
        surface_id="turn-1",
        version="1.0",
        llm=scripted_llm,
    )
    assert not failed.ok and failed.error and failed.parts == []
    assert failed.metrics is not None and failed.metrics.llm_calls == 2


@pytest.mark.asyncio
async def test_render_with_llm_direct_and_prose_reply(
    renderers: Renderers, scripted_llm: FakeLlmCaller
) -> None:
    """Verifies `render_with_llm` in Direct JSON mode for valid JSON and prose-only failures."""
    scripted_llm.script("direct:1.0", direct_json_reply(renderers, "1.0"))
    ok = await renderers.render_with_llm(
        RenderMode.DIRECT,
        RESORT_BLOCK,
        surface_id="turn-1",
        version="1.0",
        llm=scripted_llm,
    )
    assert ok.ok, ok.error
    assert surface_ids(ok.parts) == ["turn-1"]
    validate_payload([BasicCatalog("1.0")], messages_of(ok.parts))

    scripted_llm.script("direct:1.0", "Here is a nice card.", "Still prose.")
    prose = await renderers.render_with_llm(
        RenderMode.DIRECT,
        RESORT_BLOCK,
        surface_id="turn-1",
        version="1.0",
        llm=scripted_llm,
    )
    assert not prose.ok
    assert prose.error == "The reply contained no A2UI block."


@pytest.mark.asyncio
async def test_render_with_llm_rejects_decision_mode(
    renderers: Renderers, scripted_llm: FakeLlmCaller
) -> None:
    """Verifies that `render_with_llm` raises `ValueError` for non-LLM render modes."""
    with pytest.raises(ValueError, match="express or direct"):
        await renderers.render_with_llm(
            RenderMode.DECISION,
            RESORT_BLOCK,
            surface_id="t",
            version="1.0",
            llm=scripted_llm,
        )


@pytest.mark.parametrize("version", ["0.9", "1.0"])
def test_status_surface_validates_and_escapes(
    renderers: Renderers, version: str
) -> None:
    """Verifies that `status_surface` escapes quotes and backslashes into valid A2UI messages."""
    lines = [
        "**decision** · mock · 1 LLM call",
        'He said "hi" \\ bye',
        "`gate:prose` · yes p=0.90",
    ]
    parts = renderers.status_surface(lines, surface_id="turn-1-status", version=version)
    msgs = messages_of(parts)
    validate_payload([BasicCatalog(version)], msgs)
    assert surface_ids(parts) == ["turn-1-status"]
    flat = json.dumps(msgs, ensure_ascii=False)
    assert 'He said \\"hi\\" \\\\ bye' in flat
    assert "`gate:prose` · yes p=0.90" in flat


def test_stage2_user_text_mentions_intent_surface_and_payload() -> None:
    """Verifies that `stage2_user_text` includes the intent, target surface ID, and JSON payload."""
    text = stage2_user_text(RESORT_BLOCK, "turn-7")
    assert "Show the resort overview" in text
    assert 'surface id "turn-7"' in text
    assert '"priceFrom": 240' in text


def test_prompt_for_each_mode_is_that_formats_prompt(
    renderers: Renderers,
) -> None:
    """Verifies that `prompt_for` returns distinct format-specific system instructions."""
    express = renderers.prompt_for(RenderMode.EXPRESS, "1.0")
    direct = renderers.prompt_for(RenderMode.DIRECT, "1.0")
    assert express != direct
    assert "surface(" in express
    assert renderers.versions == ("0.9", "1.0")


@pytest.mark.asyncio
async def test_render_decision_login_form_forwards_mutable_paths() -> None:
    """Verifies that `render_decision` forwards `mutablePaths` to synthesize a form archetype."""
    backend = DeterministicMockBackend(
        scripted={
            "family": {"input": 0.92, "browse": 0.02},
            "archetype:input": {"form": 0.88, "settings": 0.12},
            "gate:form": {"yes": 0.95, "no": 0.05},
            "gate:actions": {"yes": 0.95, "no": 0.05},
        }
    )
    form_renderers = Renderers(versions=["1.0"], backend=backend)
    # Only blocks that list their editable pointers get a form; nothing is
    # promoted to mutable behind the block's back.
    for mutable_paths in (["/email", "/password", "/rememberMe"],):
        login_block = DecisionBlock.from_mapping({
            "intent": "Render a login form with email, password, and sign in button",
            "payload": {
                "title": "Welcome Back",
                "email": "alex.smith@example.com",
                "password": "",
                "rememberMe": False,
            },
            "actions": {"sign_in": "Sign In"},
            "mutablePaths": mutable_paths,
        })
        res = await form_renderers.render_decision(
            login_block, surface_id="turn-login", version="1.0"
        )
        assert res.ok, res.error
        validate_payload([BasicCatalog("1.0")], messages_of(res.parts))
        assert res.metrics is not None
        assert res.metrics.archetype == "form"
        assert res.metrics.stage == "archetype"
        assert (
            res.metrics.decision_latency_ms is not None
            and res.metrics.decision_latency_ms > 0.0
        )
        assert "path: decision model · archetype form" in res.metrics.footer()
        assert "decision " in res.metrics.footer()
        assert res.trace_lines[0].startswith("**Path**: decision model · archetype")
        assert "**Decision time**:" in res.trace_lines[0]

    read_only = await form_renderers.render_decision(
        DecisionBlock.from_mapping({
            "intent": "Render a login form",
            "payload": {"title": "Welcome Back", "email": "alex.smith@example.com"},
        }),
        surface_id="turn-login-ro",
        version="1.0",
    )
    assert read_only.ok, read_only.error
    assert read_only.metrics is not None and read_only.metrics.archetype != "form"


@pytest.mark.asyncio
async def test_render_tool_result_synthesizes_with_zero_llm_calls() -> None:
    """Verifies `render_tool_result` synthesis, `PlanCache` reuse, and explicit `fallbackDsl`."""
    backend = DeterministicMockBackend(
        scripted={
            "family": {"dashboard": 0.95, "browse": 0.05},
            "archetype:dashboard": {"status": 0.90, "summary": 0.10},
            "gate:headline": {"yes": 0.95, "no": 0.05},
            "gate:facts": {"yes": 0.95, "no": 0.05},
            "gate:actions": {"yes": 0.95, "no": 0.05},
        }
    )
    tool_renderers = Renderers(versions=["1.0"], backend=backend)
    res = await tool_renderers.render_tool_result(
        "Show host health status",
        {"hostname": "server-1", "cpu": "98%", "status": "critical"},
        surface_id="turn-tool-test",
        version="1.0",
        mutable_paths=["/status"],
    )
    assert res.ok, res.error
    assert res.metrics is not None
    assert res.metrics.mode is RenderMode.TOOL
    assert res.metrics.llm_calls == 0
    assert res.metrics.decision_latency_ms is not None
    assert "0 LLM calls" in res.metrics.footer()
    assert len(res.messages) >= 2
    assert 'surface("turn-tool-test")' in res.decompiled_express

    # Second call with the same conversation_id hits PlanCache (updateDataModel-only)
    cache_renderers = Renderers(versions=["1.0"], backend=DeterministicMockBackend())
    cached_first = await cache_renderers.render_tool_result(
        "Show host health status",
        {"hostname": "server-1", "cpu": "98%", "status": "critical"},
        surface_id="main",
        version="1.0",
        mutable_paths=["/status"],
        conversation_id="conv-cache-test",
    )
    assert cached_first.ok
    cached_second = await cache_renderers.render_tool_result(
        "Show host health status",
        {"hostname": "server-2", "cpu": "40%", "status": "healthy"},
        surface_id="main",
        version="1.0",
        mutable_paths=["/status"],
        conversation_id="conv-cache-test",
    )
    assert cached_second.ok
    assert cached_second.metrics is not None and cached_second.metrics.cache_hit
    assert len(cached_second.messages) == 1
    assert "updateDataModel" in cached_second.messages[0]
    assert 'surface("main")' in cached_second.decompiled_express
    assert 'hostname: "server-2"' in cached_second.decompiled_express

    # Verify render_decision forwards fallback_dsl/title/summary via to_synthesis_kwargs (M22)
    abstain_renderers = Renderers(
        versions=["1.0"],
        backend=DeterministicMockBackend(
            scripted={"family": {"browse": 0.0}, "root": {"Card": 0.0}}
        ),
    )
    block_with_fallback = DecisionBlock.from_mapping({
        "intent": "Show metric count",
        "payload": {"count": 42},
        "fallbackDsl": (
            'surface("turn-title")\nroot = Column([Text("Explicit Fallback DSL")])'
        ),
    })
    with_fallback = await abstain_renderers.render_decision(
        block_with_fallback, surface_id="turn-title", version="1.0"
    )
    assert with_fallback.ok
    assert "Explicit Fallback DSL" in json.dumps(messages_of(with_fallback.parts))
