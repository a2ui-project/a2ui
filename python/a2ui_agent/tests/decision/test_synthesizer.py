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

"""Unit tests for DecisionSynthesizer: planning, operations, fallbacks, stamps."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from typing import Any

import pytest

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import (
    BackendCapabilities,
    DecisionAnswer,
    DecisionBackendError,
    DecisionBatch,
    DecisionRenderTool,
    DecisionSynthesizer,
    DeterministicMockBackend,
    FallbackSource,
    LintCode,
    SurfaceOperation,
    SurfaceTemplate,
    SynthesisStage,
    TemplateRegistry,
    lint_components,
)
from a2ui.parser import A2uiCompilationError
from a2ui.parser.messages import to_message_dicts
from a2ui.utils import validate_payload

from .layout_fixtures import HOST, ScriptedValue, mock_backend

HOST_SCRIPTED: dict[str, ScriptedValue] = {
    "family": ("monitor", 0.90),
    "stakes": 1.0,
    "urgency": 1.4,
    "archetype:monitor": ("dashboard", 0.85),
    "gate:banner": 0.80,
    "gate:headline": 0.90,
    "gate:facts": 0.80,
    "anatomy:headline.deltas": 0.85,
    "salience:/cpu": 2.8,
    "salience:/status": 2.1,
    "salience:/uptimeHours": 1.2,
    "salience:/host": 0.4,
    "instance:banner.tone:/status": ("warning", 0.90),
    "instance:headline.news:/cpu": ("bad", 0.85),
    "instance:headline.state_tone:/status": ("warning", 0.80),
}

HOST_DETAIL_SCRIPTED: dict[str, ScriptedValue] = {
    **HOST_SCRIPTED,
    "family": ("inspect", 0.90),
    "archetype:inspect": ("detail", 0.85),
    "gate:picture": 0.10,
    "gate:prose": 0.85,
    "gate:media": 0.10,
    "gate:collection": 0.10,
    "gate:actions": 0.10,
}

ABSTAIN: dict[str, ScriptedValue] = {
    "family": {
        "browse": 0.20,
        "monitor": 0.20,
        "inspect": 0.20,
        "act": 0.20,
        "input": 0.10,
        "follow": 0.10,
        "none": 0.0,
    }
}

NO_FIT_SCRIPTED: dict[str, ScriptedValue] = {"family": ("none", 0.90)}

CATALOG = BasicCatalog("v1.0")


def _synth(scripted: dict[str, ScriptedValue], **kwargs: Any) -> DecisionSynthesizer:
    return DecisionSynthesizer([CATALOG], mock_backend(**scripted), **kwargs)


def _kinds(messages: Any) -> list[str]:
    """The envelope kind of each message, in order."""
    return [next(k for k in d if k != "version") for d in to_message_dicts(messages)]


def _components(messages: Any) -> list[dict[str, Any]]:
    for d in to_message_dicts(messages):
        if "updateComponents" in d:
            return list(d["updateComponents"]["components"])
        if "components" in d.get("createSurface", {}):
            return list(d["createSurface"]["components"])
    return []


def _create_body(messages: Any) -> dict[str, Any]:
    return next(
        d["createSurface"] for d in to_message_dicts(messages) if "createSurface" in d
    )


class _FailingBackend(DeterministicMockBackend):
    """Raises the error a timed-out HTTP backend raises."""

    async def answer(self, batch: DecisionBatch) -> tuple[DecisionAnswer, ...]:
        raise DecisionBackendError(
            "request timed out after 30 s", backend_kind="jev", model_id="jev-1.14.0"
        )


# --- Construction --------------------------------------------------------------


def test_constructor_requires_a_backend_and_v10_catalogs() -> None:
    with pytest.raises(TypeError, match="requires a decision backend"):
        DecisionSynthesizer([CATALOG], None)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="v1.0 only"):
        DecisionSynthesizer([BasicCatalog("v0.9")], mock_backend())


def test_from_env_builds_the_configured_backend_or_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("A2UI_DECISION_BACKEND", raising=False)
    with pytest.raises(ValueError, match="A2UI_DECISION_BACKEND"):
        DecisionSynthesizer.from_env([CATALOG])
    monkeypatch.setenv("A2UI_DECISION_BACKEND", "mock")
    synth = DecisionSynthesizer.from_env([CATALOG])
    assert isinstance(synth.backend, DeterministicMockBackend)


# --- Planned synthesis and observability ----------------------------------------


@pytest.mark.asyncio
async def test_planned_surface_is_created_and_stamped() -> None:
    out = await _synth(HOST_SCRIPTED).synthesize(
        HOST.intent, HOST.payload, surface_id="s1"
    )
    assert out.stage is SynthesisStage.ARCHETYPE
    assert out.layout_plan is not None
    assert out.layout_plan.block_ids() == ("banner", "headline", "facts")
    assert _kinds(out.messages) == [
        "createSurface",
        "updateComponents",
        "updateDataModel",
    ]
    assert "sendDataModel" not in _create_body(out.messages)
    assert out.operation is SurfaceOperation.CREATE
    assert (out.backend_kind, out.model_id) == ("mock", "mock")
    assert out.decision_calls == 1
    assert out.fallback_source is None and out.fallback_reason is None
    validate_payload([CATALOG], out.messages)


@pytest.mark.asyncio
async def test_two_stage_backends_get_two_calls() -> None:
    backend = DeterministicMockBackend(
        scripted_answers=HOST_SCRIPTED,
        capabilities=BackendCapabilities(two_stage=True),
    )
    out = await DecisionSynthesizer([CATALOG], backend).synthesize(
        HOST.intent, HOST.payload
    )
    assert out.stage is SynthesisStage.ARCHETYPE
    assert out.decision_calls == len(backend.batches) == 2


@pytest.mark.asyncio
async def test_payload_accepts_json_strings_and_arrays() -> None:
    synth = _synth(HOST_SCRIPTED)
    out = await synth.synthesize(HOST.intent, '{"host": "prod-1", "cpu": 0.5}')
    assert out.messages
    rows = [{"name": "a", "size": 1}, {"name": "b", "size": 2}]
    out_array = await synth.synthesize("List files", rows)
    data_model = next(
        d["updateDataModel"]["value"]
        for d in to_message_dicts(out_array.messages)
        if "updateDataModel" in d
    )
    assert data_model == {"items": rows}


@pytest.mark.asyncio
async def test_exclude_keeps_pointers_out_of_the_plan() -> None:
    synth = _synth(HOST_SCRIPTED)
    full = await synth.synthesize(HOST.intent, HOST.payload)
    assert full.layout_plan is not None
    assert "/uptimeHours" in _plan_pointers(full.layout_plan)

    excluded = await synth.synthesize(
        HOST.intent, HOST.payload, exclude=["/uptimeHours"]
    )
    assert excluded.layout_plan is not None
    assert "/uptimeHours" not in _plan_pointers(excluded.layout_plan)


def _plan_pointers(plan: Any) -> set[str]:
    return {p for block in plan.blocks for p in block.bindings.pointers()}


@pytest.mark.asyncio
async def test_authored_title_replaces_intent_in_page_title() -> None:
    title = "Production Cluster Health"
    out = await _synth(HOST_SCRIPTED).synthesize(HOST.intent, HOST.payload, title=title)
    assert out.layout_plan is not None
    assert out.layout_plan.page.title.literal == title
    assert any(title in str(c.get("text", "")) for c in _components(out.messages))


@pytest.mark.asyncio
async def test_authored_summary_fills_prose_unless_the_payload_has_text() -> None:
    summary = "Host is running with normal CPU utilization."
    out = await _synth(HOST_DETAIL_SCRIPTED).synthesize(
        "Inspect host details", HOST.payload, summary=summary
    )
    assert out.layout_plan is not None
    prose = {b.block_id: b for b in out.layout_plan.blocks}["prose"]
    body = prose.bindings.get("body")
    assert body is not None and body.literal == summary

    payload = {**HOST.payload, "about": "Pre-existing telemetry description."}
    out_about = await _synth({**HOST_DETAIL_SCRIPTED, "gate:banner": 0.10}).synthesize(
        "Inspect host details", payload, summary=summary
    )
    assert out_about.layout_plan is not None
    prose_about = {b.block_id: b for b in out_about.layout_plan.blocks}["prose"]
    body_about = prose_about.bindings.get("body")
    assert body_about is not None
    assert (body_about.pointer, body_about.literal) == ("/about", None)


def test_synthesize_sync_runs_with_and_without_a_running_loop() -> None:
    synth = _synth(HOST_SCRIPTED)
    assert synth.synthesize_sync(HOST.intent, HOST.payload).messages

    async def inside_loop() -> int:
        return len(synth.synthesize_sync(HOST.intent, HOST.payload).messages)

    assert asyncio.run(inside_loop()) == 3


# --- Surface operations -----------------------------------------------------------


@pytest.mark.asyncio
async def test_update_root_reuses_component_ids_without_create_surface() -> None:
    synth = _synth(HOST_SCRIPTED)
    created = await synth.synthesize(HOST.intent, HOST.payload, surface_id="s1")
    updated = await synth.synthesize(
        HOST.intent,
        HOST.payload,
        surface_id="s1",
        operation=SurfaceOperation.UPDATE_ROOT,
    )
    assert _kinds(updated.messages) == ["updateComponents", "updateDataModel"]
    assert updated.operation is SurfaceOperation.UPDATE_ROOT
    assert [c["id"] for c in _components(updated.messages)] == [
        c["id"] for c in _components(created.messages)
    ]
    assert _components(updated.messages)[0]["id"] == "root"


@pytest.mark.asyncio
async def test_replace_deletes_then_creates() -> None:
    out = await _synth(HOST_SCRIPTED).synthesize(
        HOST.intent,
        HOST.payload,
        surface_id="s1",
        operation=SurfaceOperation.REPLACE,
    )
    assert _kinds(out.messages) == [
        "deleteSurface",
        "createSurface",
        "updateComponents",
        "updateDataModel",
    ]
    assert out.operation is SurfaceOperation.REPLACE


@pytest.mark.parametrize(
    ("surface_sends_data_model", "expected"),
    [(False, SurfaceOperation.REPLACE), (True, SurfaceOperation.UPDATE_ROOT)],
)
@pytest.mark.asyncio
async def test_update_needing_send_data_model_escalates_to_replace(
    monkeypatch: pytest.MonkeyPatch,
    surface_sends_data_model: bool,
    expected: SurfaceOperation,
) -> None:
    synth = _synth(HOST_SCRIPTED)
    expand = synth._expand_plan
    monkeypatch.setattr(
        synth,
        "_expand_plan",
        lambda plan: replace(expand(plan), send_data_model=True),
    )
    out = await synth.synthesize(
        HOST.intent,
        HOST.payload,
        operation=SurfaceOperation.UPDATE_ROOT,
        surface_sends_data_model=surface_sends_data_model,
    )
    assert out.operation is expected
    if expected is SurfaceOperation.REPLACE:
        assert _kinds(out.messages)[0] == "deleteSurface"
        assert _create_body(out.messages)["sendDataModel"] is True
    else:
        assert "createSurface" not in _kinds(out.messages)


# --- Templates --------------------------------------------------------------------


def _host_template() -> SurfaceTemplate:
    return SurfaceTemplate(
        template_id="host_card",
        description="Approved host card",
        surface_id="default_surface",
        catalog_id=CATALOG.catalog_id,
        protocol_version="1.0",
        components=({"id": "root", "component": "Text", "text": {"@path": "/host"}},),
        required_pointers=("/host",),
    )


@pytest.mark.parametrize(
    ("operation", "kinds"),
    [
        (
            SurfaceOperation.CREATE,
            ["createSurface", "updateComponents", "updateDataModel"],
        ),
        (SurfaceOperation.UPDATE_ROOT, ["updateComponents", "updateDataModel"]),
    ],
)
@pytest.mark.asyncio
async def test_plan_template_id_renders_the_registered_template(
    monkeypatch: pytest.MonkeyPatch,
    operation: SurfaceOperation,
    kinds: list[str],
) -> None:
    registry = TemplateRegistry()
    registry.register(_host_template())
    synth = _synth(HOST_SCRIPTED, registry=registry)
    read = synth.planner.read

    def read_with_template(state: Any, answers: Any) -> Any:
        outcome = read(state, answers)
        return replace(outcome, plan=replace(outcome.plan, template_id="host_card"))

    monkeypatch.setattr(synth.planner, "read", read_with_template)
    out = await synth.synthesize(
        HOST.intent, HOST.payload, surface_id="s1", operation=operation
    )
    assert out.stage is SynthesisStage.TEMPLATE_SELECT
    assert out.selected_template_id == "host_card"
    assert out.layout_plan is not None and out.layout_plan.template_id == "host_card"
    assert _kinds(out.messages) == kinds
    assert _components(out.messages) == [
        {"id": "root", "component": "Text", "text": {"@path": "/host"}}
    ]
    validate_payload([CATALOG], out.messages)


# --- Fallback chain --------------------------------------------------------------


@pytest.mark.asyncio
async def test_fallback_dsl_runs_first_and_records_the_reason() -> None:
    calls: list[str] = []

    def fallback_fn(intent: str, payload: Any, surface_id: str) -> Any:
        calls.append(surface_id)
        return []

    out = await _synth(ABSTAIN, fallback_fn=fallback_fn).synthesize(
        HOST.intent,
        HOST.payload,
        surface_id="s1",
        fallback_dsl='root = Text("Host unavailable")',
    )
    assert out.stage is SynthesisStage.ABSTAIN_FALLBACK
    assert out.fallback_source is FallbackSource.DSL
    assert out.fallback_reason == "no_family"
    assert calls == []
    assert _kinds(out.messages) == ["createSurface", "updateDataModel"]
    assert (out.backend_kind, out.model_id) == ("mock", "mock")
    validate_payload([CATALOG], out.messages)


@pytest.mark.asyncio
async def test_fallback_fn_runs_when_there_is_no_dsl() -> None:
    seen: list[tuple[str, str]] = []

    async def fallback_fn(intent: str, payload: Any, surface_id: str) -> Any:
        seen.append((intent, surface_id))
        return [{
            "version": "1.0",
            "createSurface": {
                "surfaceId": surface_id,
                "catalogId": CATALOG.catalog_id,
                "components": [{"id": "root", "component": "Text", "text": "Fallback"}],
            },
        }]

    out = await _synth(ABSTAIN, fallback_fn=fallback_fn).synthesize(
        HOST.intent, HOST.payload, surface_id="s2"
    )
    assert out.fallback_source is FallbackSource.CALLBACK
    assert out.fallback_reason == "no_family"
    assert seen == [(HOST.intent, "s2")]


@pytest.mark.asyncio
async def test_facts_pattern_renders_the_payload_last() -> None:
    out = await _synth(ABSTAIN).synthesize(HOST.intent, HOST.payload, title="prod-1")
    assert out.stage is SynthesisStage.ABSTAIN_FALLBACK
    assert out.fallback_source is FallbackSource.FACTS
    assert out.fallback_reason == "no_family"
    ids = [c["id"] for c in _components(out.messages)]
    assert ids[0] == "root" and any(i.startswith("facts") for i in ids)
    assert any("prod-1" in str(c.get("text", "")) for c in _components(out.messages))
    validate_payload([CATALOG], out.messages)


@pytest.mark.asyncio
async def test_abstention_with_nothing_to_render_raises() -> None:
    with pytest.raises(A2uiCompilationError, match="abstained"):
        await _synth(ABSTAIN).synthesize("Show nothing", {})


@pytest.mark.asyncio
async def test_fallback_that_creates_an_existing_surface_becomes_replace() -> None:
    out = await _synth(ABSTAIN).synthesize(
        HOST.intent,
        HOST.payload,
        surface_id="s1",
        fallback_dsl='root = Text("Host unavailable")',
        operation=SurfaceOperation.UPDATE_ROOT,
    )
    assert out.operation is SurfaceOperation.REPLACE
    assert _kinds(out.messages)[:2] == ["deleteSurface", "createSurface"]


@pytest.mark.asyncio
async def test_facts_fallback_updates_an_existing_surface_in_place() -> None:
    out = await _synth(ABSTAIN).synthesize(
        HOST.intent, HOST.payload, operation=SurfaceOperation.UPDATE_ROOT
    )
    assert out.fallback_source is FallbackSource.FACTS
    assert out.operation is SurfaceOperation.UPDATE_ROOT
    assert _kinds(out.messages) == ["updateComponents", "updateDataModel"]


@pytest.mark.asyncio
async def test_backend_errors_propagate_without_any_fallback() -> None:
    calls: list[str] = []
    synth = DecisionSynthesizer(
        [CATALOG],
        _FailingBackend(),
        fallback_fn=lambda intent, payload, surface_id: calls.append(intent) or [],
    )
    with pytest.raises(DecisionBackendError, match="timed out") as info:
        await synth.synthesize(
            HOST.intent, HOST.payload, fallback_dsl='root = Text("unused")'
        )
    assert info.value.backend_kind == "jev"
    assert calls == []


@pytest.mark.asyncio
async def test_empty_fallback_fn_result_passes_to_the_facts_link() -> None:
    out = await _synth(ABSTAIN, fallback_fn=lambda *args: []).synthesize(
        HOST.intent, HOST.payload
    )
    assert out.fallback_source is FallbackSource.FACTS


def test_lint_uses_catalog_child_slots_so_empty_containers_are_caught() -> None:
    synth = _synth(HOST_SCRIPTED)
    assert {"children", "child"} <= synth._child_slot_keys
    empty = [{"id": "root", "component": "Column", "children": []}]
    findings = lint_components(empty, child_slot_keys=synth._child_slot_keys)
    assert any(f.code == LintCode.EMPTY_CONTAINER for f in findings)


@pytest.mark.asyncio
async def test_no_fit_routes_through_fallback_chain_in_order() -> None:
    calls: list[str] = []

    async def fallback_fn(intent: str, payload: Any, surface_id: str) -> Any:
        calls.append(surface_id)
        return [{
            "version": "1.0",
            "createSurface": {
                "surfaceId": surface_id,
                "catalogId": CATALOG.catalog_id,
                "components": [
                    {"id": "root", "component": "Text", "text": "Callback UI"}
                ],
            },
        }]

    # 1. fallback_dsl wins first when supplied.
    dsl_out = await _synth(NO_FIT_SCRIPTED, fallback_fn=fallback_fn).synthesize(
        HOST.intent,
        HOST.payload,
        surface_id="s1",
        fallback_dsl='root = Text("Free-form canvas")',
    )
    assert dsl_out.stage is SynthesisStage.ABSTAIN_FALLBACK
    assert dsl_out.fallback_source is FallbackSource.DSL
    assert dsl_out.fallback_reason == "no_fit"
    assert calls == []

    # 2. fallback_fn runs next when fallback_dsl is absent.
    fn_out = await _synth(NO_FIT_SCRIPTED, fallback_fn=fallback_fn).synthesize(
        HOST.intent, HOST.payload, surface_id="s2"
    )
    assert fn_out.stage is SynthesisStage.ABSTAIN_FALLBACK
    assert fn_out.fallback_source is FallbackSource.CALLBACK
    assert fn_out.fallback_reason == "no_fit"
    assert calls == ["s2"]

    # 3. facts fallback runs when neither fallback_dsl nor fallback_fn applies.
    facts_out = await _synth(NO_FIT_SCRIPTED).synthesize(HOST.intent, HOST.payload)
    assert facts_out.stage is SynthesisStage.ABSTAIN_FALLBACK
    assert facts_out.fallback_source is FallbackSource.FACTS
    assert facts_out.fallback_reason == "no_fit"

    # 4. Raises A2uiCompilationError when no fallback produces messages
    # (for example, a payload whose only scalar is a secret pointer that
    # `_facts_plan` refuses to render).
    with pytest.raises(A2uiCompilationError, match="no_fit"):
        await _synth(NO_FIT_SCRIPTED).synthesize(
            "Draw a game canvas",
            {"apiToken": "secret-token"},
            mutable_paths=["/apiToken"],
        )
    with pytest.raises(A2uiCompilationError, match="no eligible archetype"):
        await _synth(NO_FIT_SCRIPTED).synthesize(
            "Draw a game canvas", {"apiToken": "secret-token"}
        )


@pytest.mark.asyncio
async def test_labels_override_humanized_keys_in_rendered_components() -> None:
    out = await _synth(HOST_SCRIPTED).synthesize(
        HOST.intent,
        HOST.payload,
        labels={"/cpu": "Processor load", "/host": "Database node"},
    )
    texts = [str(c.get("text", "")) for c in _components(out.messages)]
    assert any("Processor load" in t for t in texts)
    assert any("Database node" in t for t in texts)


@pytest.mark.asyncio
async def test_tool_mode_cache_and_promote_exports_cached_plan() -> None:
    backend = mock_backend(**HOST_SCRIPTED)
    tool = DecisionRenderTool.create([CATALOG], backend=backend, surface_id="ops")

    with pytest.raises(ValueError, match="No cached plan"):
        tool.promote("host_tpl", "Host status template")

    first = await tool.run_async({"intent": HOST.intent, "payload": dict(HOST.payload)})
    assert first.cache_hit is False
    assert first.decision_calls == 1
    assert len(backend.batches) == 1

    second = await tool.run_async(
        {"intent": HOST.intent, "payload": {**HOST.payload, "cpu": 0.35}}
    )
    assert second.cache_hit is True
    assert second.decision_calls == 0
    assert len(backend.batches) == 1

    template = tool.promote("host_tpl", "Host status template")
    assert tool.synthesizer.registry.get("host_tpl") is template
    assert template.surface_id == "ops"
    assert template.catalog_id == CATALOG.catalog_id
    assert "/cpu" in template.required_pointers
    assert "/host" in template.required_pointers
    rendered = template.render_messages(HOST.payload)
    validate_payload([CATALOG], rendered)


@pytest.mark.asyncio
async def test_compare_archetype_binds_repeated_attributes_and_validates() -> None:
    compare_scripted = {
        "family": {"browse": 0.90, "inspect": 0.05},
        "archetype:browse": {"compare": 0.85, "feed": 0.10},
        "gate:comparison": {"yes": 0.95, "no": 0.05},
    }
    payload = {
        "tiers": [
            {
                "id": "a100",
                "name": "A100 80GB",
                "vram_gb": "80 GB",
                "hourly_usd": 3.67,
            },
            {
                "id": "h100",
                "name": "H100 80GB",
                "vram_gb": "80 GB",
                "hourly_usd": 4.95,
            },
        ]
    }
    out = await _synth(compare_scripted).synthesize(
        "Compare cloud GPU instance tiers side by side",
        payload,
    )
    assert out.stage is SynthesisStage.ARCHETYPE
    assert out.layout_plan is not None
    assert out.layout_plan.archetype == "compare"
    validate_payload([CATALOG], out.messages)
    comps = {c["id"]: c for c in _components(out.messages)}
    assert "comparison_0_cmp_attr_label" in comps
    assert comps["comparison_0_cmp_attr_label"]["text"] == "Vram gb"
    assert comps["comparison_0_cmp_attr_value"]["text"] == {"@path": "vram_gb"}


@pytest.mark.asyncio
async def test_synthesizer_uses_server_reported_last_call_latency_ms() -> None:
    class _DelayedServerReportedBackend(DeterministicMockBackend):

        def __init__(self) -> None:
            super().__init__(scripted_answers=HOST_SCRIPTED)
            self.last_call_latency_ms = 0.05

        async def answer(self, batch: Any) -> Any:
            import asyncio

            await asyncio.sleep(0.02)
            return await super().answer(batch)

    synth = DecisionSynthesizer([CATALOG], _DelayedServerReportedBackend())
    out = await synth.synthesize(HOST.intent, HOST.payload)
    assert out.decision_calls == 1
    assert out.decision_latency_ms == pytest.approx(0.05)


@pytest.mark.asyncio
async def test_non_mutable_secret_pointers_excluded_from_batches_and_facts() -> None:
    backend = mock_backend(**HOST_SCRIPTED)
    synth = DecisionSynthesizer([CATALOG], backend)
    payload_with_secrets = {
        **HOST.payload,
        "api_key": "sk-live-secret",
        "password": "hunter2-password",
    }
    out = await synth.synthesize(HOST.intent, payload_with_secrets)
    assert out.stage is SynthesisStage.ARCHETYPE
    assert len(backend.batches) == 1
    batch = backend.batches[0]
    assert "/api_key" not in batch.shared_context.get("pointers", [])
    assert "/password" not in batch.shared_context.get("pointers", [])
    for q in batch.questions:
        assert "/api_key" not in q.id and "api_key" not in q.prompt
        assert "/password" not in q.id and "password" not in q.prompt
    assert out.layout_plan is not None
    bound_ptrs = {ptr for b in out.layout_plan.blocks for ptr in b.bindings.pointers()}
    assert "/api_key" not in bound_ptrs
    assert "/password" not in bound_ptrs


@pytest.mark.asyncio
async def test_mutable_template_sets_send_data_model_and_escalates_update_root() -> (
    None
):
    registry = TemplateRegistry()
    registry.register(
        SurfaceTemplate(
            template_id="edit_host_tpl",
            description="Editable host settings template",
            surface_id="ops",
            catalog_id=CATALOG.catalog_id,
            protocol_version="1.0",
            required_pointers=("/host", "/cpu"),
            is_mutable=True,
            components=(
                {
                    "id": "root",
                    "component": "Text",
                    "text": {"path": "/host"},
                },
            ),
        )
    )
    scripted = {**HOST_SCRIPTED, "template": {"edit_host_tpl": 0.99, "compose": 0.01}}
    synth = DecisionSynthesizer([CATALOG], mock_backend(**scripted), registry=registry)

    created = await synth.synthesize(
        HOST.intent,
        HOST.payload,
        surface_id="ops",
        operation=SurfaceOperation.CREATE,
    )
    assert created.stage is SynthesisStage.TEMPLATE_SELECT
    assert created.operation is SurfaceOperation.CREATE
    created_dicts = to_message_dicts(created.messages)
    assert created_dicts[0]["createSurface"].get("sendDataModel") is True

    escalated = await synth.synthesize(
        HOST.intent,
        HOST.payload,
        surface_id="ops",
        operation=SurfaceOperation.UPDATE_ROOT,
        surface_sends_data_model=False,
    )
    assert escalated.stage is SynthesisStage.TEMPLATE_SELECT
    assert escalated.operation is SurfaceOperation.REPLACE
    escalated_dicts = to_message_dicts(escalated.messages)
    assert "deleteSurface" in escalated_dicts[0]
    assert escalated_dicts[1]["createSurface"].get("sendDataModel") is True


@pytest.mark.asyncio
async def test_without_excluded_strips_excluded_subpaths_from_array_sample_pointers() -> (
    None
):
    payload = {
        "items": [
            {
                "name": "Node A",
                "status": "ok",
                "secretToken": "tok-a",
                "photoUrl": "https://example.com/a.png",
            },
            {
                "name": "Node B",
                "status": "ok",
                "secretToken": "tok-b",
                "photoUrl": "https://example.com/b.png",
            },
        ]
    }
    scripted: dict[str, ScriptedValue] = {
        "family": ("browse", 0.90),
        "stakes": 0.4,
        "urgency": 0.2,
        "archetype:browse": ("feed", 0.90),
        "gate:collection": 0.95,
    }
    synth = DecisionSynthesizer([CATALOG], mock_backend(**scripted))
    out = await synth.synthesize(
        "Browse cluster nodes",
        payload,
        exclude=["/items/0/secretToken", "/items/0/photoUrl"],
    )
    assert out.layout_plan is not None
    bound_ptrs = {ptr for b in out.layout_plan.blocks for ptr in b.bindings.pointers()}
    assert "/items/0/secretToken" not in bound_ptrs
    assert "/items/0/photoUrl" not in bound_ptrs
    comp_messages = [
        d for d in to_message_dicts(out.messages) if "updateComponents" in d
    ]
    assert "secretToken" not in str(comp_messages)
    assert "photoUrl" not in str(comp_messages)
