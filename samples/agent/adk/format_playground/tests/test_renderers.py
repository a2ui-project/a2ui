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
        {"url": "https://example.com/casa-verde/1.jpg", "caption": "Pool at dusk"},
        {"url": "https://example.com/casa-verde/2.jpg", "caption": "Garden suite"},
        {"url": "https://example.com/casa-verde/3.jpg", "caption": "Breakfast terrace"},
    ],
}
RESORT_BLOCK = DecisionBlock(intent="Show the resort overview", payload=RESORT_PAYLOAD)

EXPRESS_OK = '<a2ui>surface("turn-1")\nroot = Column([Text("Portfolio")])</a2ui>'
EXPRESS_BAD = "<a2ui>root = Nope(</a2ui>"


def direct_json_reply(renderers: Renderers, version: str) -> str:
    """A valid Direct JSON reply for `version`, built from a compiled surface."""
    parts = renderers.status_surface(
        ["Portfolio"], surface_id="turn-1", version=version
    )
    return f"<a2ui-json>{json.dumps(messages_of(parts))}</a2ui-json>"


def messages_of(parts: list[Part]) -> list[dict[str, Any]]:
    return [p.root.data for p in parts if isinstance(p.root, DataPart)]


def surface_ids(parts: list[Part]) -> list[str]:
    ids: list[str] = []
    for msg in messages_of(parts):
        create = msg.get("createSurface")
        if isinstance(create, dict) and "surfaceId" in create:
            ids.append(str(create["surfaceId"]))
    return ids


@pytest.fixture(scope="module")
def renderers() -> Renderers:
    return Renderers(versions=["0.9", "1.0"], backend=DeterministicMockBackend())


def test_backend_display_name_maps_bundled_backends() -> None:
    assert backend_display_name(DeterministicMockBackend()) == "mock"

    class Custom:
        pass

    assert backend_display_name(Custom()) == "Custom"  # type: ignore[arg-type]


@pytest.mark.parametrize("version", ["0.9", "1.0"])
@pytest.mark.asyncio
async def test_render_decision_produces_a_surface_without_llm_calls(
    renderers: Renderers, version: str
) -> None:
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


@pytest.mark.asyncio
async def test_render_with_llm_express_succeeds_retries_and_fails(
    renderers: Renderers, scripted_llm: FakeLlmCaller
) -> None:
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
    text = stage2_user_text(RESORT_BLOCK, "turn-7")
    assert "Show the resort overview" in text
    assert 'surface id "turn-7"' in text
    assert '"priceFrom": 240' in text


def test_prompt_for_each_mode_is_that_formats_prompt(renderers: Renderers) -> None:
    express = renderers.prompt_for(RenderMode.EXPRESS, "1.0")
    direct = renderers.prompt_for(RenderMode.DIRECT, "1.0")
    assert express != direct
    assert "surface(" in express
    assert renderers.versions == ("0.9", "1.0")
