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

"""Tests for the shared playground contracts."""

from __future__ import annotations

from modes import (
    LlmTurn,
    PlaygroundSettings,
    RenderMode,
    RenderResult,
    TurnMetrics,
    as_mode,
    surface_id_for,
)


def test_render_mode_round_trips_and_formats_as_value() -> None:
    assert RenderMode("express") is RenderMode.EXPRESS
    assert str(RenderMode.DECISION) == "decision"
    assert f"{RenderMode.DIRECT}" == "direct"
    assert as_mode(" Express ") is RenderMode.EXPRESS
    assert as_mode("sparkles") is None


def test_footer_with_every_field() -> None:
    metrics = TurnMetrics(
        mode=RenderMode.DECISION,
        backend="mock",
        llm_calls=1,
        latency_ms=1840.0,
        prompt_tokens=120,
        output_tokens=45,
        archetype="detail",
        confidence=0.82,
        block_count=4,
        fallback=None,
    )
    assert metrics.footer() == (
        "**decision** · mock · 1 LLM call · 1.8 s · 120 in / 45 out tokens"
        " · archetype detail (0.82) · 4 blocks"
    )


def test_footer_minimal_and_plural_forms() -> None:
    metrics = TurnMetrics(
        mode=RenderMode.EXPRESS, backend="llm", llm_calls=2, latency_ms=4100.0
    )
    assert metrics.footer() == "**express** · llm · 2 LLM calls · 4.1 s"
    with_fallback = TurnMetrics(
        mode=RenderMode.DIRECT,
        backend="llm",
        llm_calls=0,
        latency_ms=0.0,
        block_count=1,
        fallback="validation_retry",
    )
    assert with_fallback.footer().endswith("· 1 block · fallback: validation_retry")


def test_plus_stage1_folds_the_first_call_in() -> None:
    base = TurnMetrics(
        mode=RenderMode.DECISION, backend="mock", llm_calls=0, latency_ms=12.0
    )
    folded = base.plus_stage1(
        LlmTurn(text="x", prompt_tokens=300, output_tokens=80, latency_ms=900.0)
    )
    assert folded.llm_calls == 1
    assert folded.latency_ms == 912.0
    assert (folded.prompt_tokens, folded.output_tokens) == (300, 80)
    assert base.llm_calls == 0


def test_surface_ids_and_turn_counter() -> None:
    settings = PlaygroundSettings().next_turn()
    assert settings.turn == 1
    assert surface_id_for(settings) == "turn-1"
    assert surface_id_for(settings, RenderMode.EXPRESS) == "turn-1"
    comparing = PlaygroundSettings(compare=True, turn=3)
    assert surface_id_for(comparing, RenderMode.EXPRESS) == "turn-3-express"
    assert surface_id_for(comparing) == "turn-3"


def test_render_result_ok_requires_parts_and_no_error() -> None:
    assert not RenderResult().ok
    assert not RenderResult(parts=[object()], error="boom").ok  # type: ignore[list-item]
    assert RenderResult(parts=[object()]).ok  # type: ignore[list-item]


def test_path_summary_and_decision_timing_across_stages() -> None:
    archetype_m = TurnMetrics(
        mode=RenderMode.DECISION,
        backend="jev",
        llm_calls=0,
        latency_ms=415.0,
        decision_latency_ms=412.0,
        decision_calls=1,
        stage="archetype",
        archetype="form",
        confidence=0.86,
        block_count=2,
    ).plus_stage1(
        LlmTurn(text="x", prompt_tokens=600, output_tokens=90, latency_ms=1800.0)
    )
    assert archetype_m.footer() == (
        "**decision** · jev · 1 LLM call · decision 412 ms (total 2.2 s)"
        " · 600 in / 90 out tokens · path: decision model · archetype form"
        " (0.86) · 2 blocks"
    )

    template_m = TurnMetrics(
        mode=RenderMode.DECISION,
        backend="local",
        llm_calls=0,
        latency_ms=19.0,
        decision_latency_ms=18.2,
        stage="template_select",
        template_id="login_card",
        confidence=0.91,
    )
    assert template_m.footer() == (
        "**decision** · local · 0 LLM calls · decision 18 ms"
        " · path: templates · template login_card (0.91)"
    )

    container_m = TurnMetrics(
        mode=RenderMode.DECISION,
        backend="jev",
        llm_calls=0,
        latency_ms=385.0,
        decision_latency_ms=380.0,
        stage="container_2pass",
        root_component="Column",
        confidence=0.74,
    )
    assert "path: decision model · 2-pass container Column (0.74)" in (
        container_m.footer()
    )

    leaf_m = TurnMetrics(
        mode=RenderMode.DECISION,
        backend="mock",
        llm_calls=0,
        latency_ms=0.5,
        decision_latency_ms=0.42,
        stage="fast_1pass_leaf",
        root_component="Text",
        confidence=0.83,
    )
    assert "decision 0.42 ms · path: decision model · 1-pass leaf Text (0.83)" in (
        leaf_m.footer()
    )

    fallback_m = TurnMetrics(
        mode=RenderMode.DECISION,
        backend="jev",
        llm_calls=0,
        latency_ms=345.0,
        decision_latency_ms=340.0,
        stage="abstain_fallback",
        fallback="card",
        confidence=0.31,
    )
    assert (
        "path: fallback (card) · decision model abstained (0.31)" in fallback_m.footer()
    )
