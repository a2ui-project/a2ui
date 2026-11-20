# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Unit tests for `DecisionCascadeRouter` and cascade routing types."""

from __future__ import annotations

from typing import Any
import warnings

import pytest

from a2ui.core import Catalog, CatalogApi
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.core.schema import ProtocolVersion
from a2ui.inference_formats.experimental.decision import (
    DecisionAnswer,
    DecisionBackendError,
    DecisionBatch,
    DecisionDistribution,
    DeterministicMockBackend,
)
from a2ui.inference_formats.experimental.decision_cascade import (
    CascadeConfig,
    CascadeTier,
    DecisionCascadeRouter,
    ExpressSurfaceSpec,
    RouteDecision,
)
from a2ui.utils._experimental import SUPPRESS_ENV_VAR


def _basic_v1() -> CatalogApi:
    return BasicCatalog("v1.0")


def _custom_catalog(
    components: dict[str, dict[str, Any]],
    *,
    catalog_id: str = "urn:test:cascade",
    defs: dict[str, Any] | None = None,
) -> CatalogApi:
    payload: dict[str, Any] = {
        "catalogId": catalog_id,
        "components": {
            name: {
                "type": "object",
                "properties": {
                    "component": {"const": name},
                    **spec.get("properties", {}),
                },
                **{k: v for k, v in spec.items() if k != "properties"},
            }
            for name, spec in components.items()
        },
    }
    if defs is not None:
        payload["$defs"] = defs
    return Catalog.from_json(payload, protocol_version=ProtocolVersion.V1_0)


def _templates() -> tuple[ExpressSurfaceSpec, ...]:
    return (
        ExpressSurfaceSpec(
            id="weather_card",
            description="Show weather forecast card",
            dsl='surface "s1" { root = Text("Sunny") }',
        ),
        ExpressSurfaceSpec(
            id="flight_status",
            description="Show flight status summary",
            dsl='surface "s1" { root = Text("On time") }',
        ),
    )


class _RecordingTimeoutBackend(DeterministicMockBackend):

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.timeouts: list[float | None] = []

    async def answer(
        self,
        batch: DecisionBatch,
        *,
        timeout_seconds: float | None = None,
    ) -> tuple[DecisionAnswer, ...]:
        self.timeouts.append(timeout_seconds)
        return await super().answer(batch, timeout_seconds=timeout_seconds)


class _FailingBackend(DeterministicMockBackend):

    async def answer(
        self,
        batch: DecisionBatch,
        *,
        timeout_seconds: float | None = None,
    ) -> tuple[DecisionAnswer, ...]:
        del batch, timeout_seconds
        raise DecisionBackendError(
            "backend timed out", backend_kind="jev", model_id="jev-1.14.0"
        )


class _OmittingBackend(DeterministicMockBackend):

    async def answer(
        self,
        batch: DecisionBatch,
        *,
        timeout_seconds: float | None = None,
    ) -> tuple[DecisionAnswer, ...]:
        answers = await super().answer(batch, timeout_seconds=timeout_seconds)
        return answers[1:]


@pytest.mark.asyncio
async def test_gate_below_threshold_returns_text_only() -> None:
    backend = _RecordingTimeoutBackend(
        scripted_answers={
            "gate:needs_ui": 0.49,
            "route:tier": "full_express",
        }
    )
    router = DecisionCascadeRouter(backend, templates=_templates())
    decision = await router.route(
        "What is the capital of France?",
        [_basic_v1()],
        latency_budget_ms=1200.0,
    )

    assert isinstance(decision, RouteDecision)
    assert decision.tier is CascadeTier.TEXT_ONLY
    assert decision.catalogs == ()
    assert decision.template is None
    assert decision.template_id is None
    assert decision.needs_ui_probability == pytest.approx(0.49)
    assert backend.timeouts == [None]
    assert len(backend.batches) == 1
    assert backend.batches[0].state is not None
    assert backend.batches[0].shared_context == {}


@pytest.mark.asyncio
async def test_tight_latency_budget_selects_confident_template_or_text_only() -> None:
    templates = _templates()
    backend_hit = _RecordingTimeoutBackend(
        scripted_answers={
            "gate:needs_ui": 0.90,
            "route:tier": "full_express",
            "route:template": ("flight_status", 0.72),
        }
    )
    router_hit = DecisionCascadeRouter(backend_hit, templates=templates)
    hit = await router_hit.route(
        "Check flight UA 100", [_basic_v1()], latency_budget_ms=300.0
    )

    assert hit.tier is CascadeTier.TEMPLATE
    assert hit.template_id == "flight_status"
    assert hit.template == templates[1]
    assert hit.template_confidence == pytest.approx(0.72)
    # Tight routing budget does not shorten the decision backend transport timeout.
    assert backend_hit.timeouts == [None]

    explicit = await router_hit.route(
        "Check flight UA 100",
        [_basic_v1()],
        latency_budget_ms=300.0,
        timeout_seconds=2.5,
    )
    assert explicit.tier is CascadeTier.TEMPLATE
    assert backend_hit.timeouts == [None, 2.5]
    q_ids = [q.id for q in backend_hit.batches[0].questions]
    assert not any(qid.startswith("prune:") for qid in q_ids)

    backend_miss = _RecordingTimeoutBackend(
        scripted_answers={
            "gate:needs_ui": 0.90,
            "route:tier": "full_express",
            "route:template": ("weather_card", 0.69),
        }
    )
    router_miss = DecisionCascadeRouter(backend_miss, templates=templates)
    miss = await router_miss.route(
        "Show complex analytics", [_basic_v1()], latency_budget_ms=499.0
    )
    assert miss.tier is CascadeTier.TEXT_ONLY
    assert miss.catalogs == ()

    # At exactly 500.0 ms, normal routing applies rather than tight-budget restriction.
    backend_boundary = DeterministicMockBackend(
        scripted_answers={
            "gate:needs_ui": 0.90,
            "route:tier": "full_express",
            "route:template": ("weather_card", 0.69),
        }
    )
    router_boundary = DecisionCascadeRouter(backend_boundary, templates=templates)
    boundary = await router_boundary.route(
        "Show complex analytics", [_basic_v1()], latency_budget_ms=500.0
    )
    assert boundary.tier is CascadeTier.FULL_EXPRESS


@pytest.mark.asyncio
async def test_tight_budget_with_no_templates_returns_text_only() -> None:
    backend = DeterministicMockBackend(
        scripted_answers={
            "gate:needs_ui": 0.95,
            "route:tier": "full_express",
        }
    )
    router = DecisionCascadeRouter(backend)
    decision = await router.route("Show chart", [_basic_v1()], latency_budget_ms=200.0)
    assert decision.tier is CascadeTier.TEXT_ONLY
    q_ids = [q.id for q in backend.batches[0].questions]
    assert "route:template" not in q_ids
    tier_q = next(q for q in backend.batches[0].questions if q.id == "route:tier")
    assert "template" not in tier_q.options
    assert "sandbox_app" not in tier_q.options


@pytest.mark.asyncio
async def test_normal_budget_template_none_falls_back_to_next_tier_and_sandbox_app() -> (
    None
):
    backend = DeterministicMockBackend(
        scripted_answers={
            "gate:needs_ui": 0.90,
            "route:tier": {
                "template": 0.50,
                "sandbox_app": 0.35,
                "pruned_express": 0.10,
                "full_express": 0.05,
            },
            "route:template": ("none", 0.85),
        }
    )
    router = DecisionCascadeRouter(backend, templates=_templates())
    decision = await router.route(
        "Open interactive whiteboard", [_basic_v1()], allow_sandbox_app=True
    )
    assert decision.tier is CascadeTier.SANDBOX_APP
    tier_q = next(q for q in backend.batches[0].questions if q.id == "route:tier")
    assert "sandbox_app" in tier_q.options


@pytest.mark.asyncio
async def test_over_max_components_routes_pruned_express_to_full_express() -> None:
    comps = {f"Comp{i}": {} for i in range(129)}
    large_catalog = _custom_catalog(comps, catalog_id="urn:test:large")
    backend = DeterministicMockBackend(
        scripted_answers={
            "gate:needs_ui": 0.95,
            "route:tier": "pruned_express",
        }
    )
    router = DecisionCascadeRouter(backend)
    decision = await router.route("Build a dashboard", [large_catalog])

    assert decision.tier is CascadeTier.FULL_EXPRESS
    assert decision.reason == "catalog_exceeds_max_components"
    assert len(decision.catalogs) == 1
    assert len(decision.catalogs[0].components) == 129
    q_ids = [q.id for q in backend.batches[0].questions]
    assert not any(qid.startswith("prune:") for qid in q_ids)


@pytest.mark.asyncio
async def test_exact_128_components_still_runs_pruned_express() -> None:
    comps = {f"Comp{i}": {} for i in range(128)}
    boundary_catalog = _custom_catalog(comps, catalog_id="urn:test:boundary")
    backend = DeterministicMockBackend(
        scripted_answers={
            "gate:needs_ui": 0.95,
            "route:tier": "pruned_express",
            "prune:0:Comp0": 0.90,
            **{f"prune:0:Comp{i}": 0.05 for i in range(1, 128)},
        }
    )
    router = DecisionCascadeRouter(backend)
    decision = await router.route("Show item 0", [boundary_catalog])

    assert decision.tier is CascadeTier.PRUNED_EXPRESS
    assert set(decision.catalogs[0].components) == {"Comp0"}


@pytest.mark.asyncio
async def test_pruned_express_upward_and_downward_closure_and_floor() -> None:
    # Multi-hop upward closure: Leaf -> Section -> Page (Surface-eligible).
    # DeadEndParent has allowedParents: ["MissingRoot"] so it cannot reach Surface.
    # Container TabGroup has allowedChildren: ["TabItemA", "TabItemB"] both < 0.25.
    # Layout floor ("Column", "Text") is preserved even below 0.25, while "Unused"
    # and "UnusedDef" are pruned out by ComponentPruningTransformer.
    catalog = _custom_catalog(
        {
            "Page": {"allowedParents": ["Surface"]},
            "DeadEndParent": {"allowedParents": ["MissingRoot"]},
            "Section": {"allowedParents": ["Page", "DeadEndParent"]},
            "Leaf": {"allowedParents": ["Section"]},
            "TabGroup": {
                "allowedParents": ["Surface"],
                "allowedChildren": ["TabItemA", "TabItemB"],
            },
            "TabItemA": {"allowedParents": ["TabGroup"]},
            "TabItemB": {"allowedParents": ["TabGroup"]},
            "Column": {},
            "Text": {},
            "Unused": {
                "properties": {"extra": {"$ref": "#/$defs/UnusedDef"}},
            },
        },
        defs={"UnusedDef": {"type": "string"}},
    )
    backend = DeterministicMockBackend(
        scripted_answers={
            "gate:needs_ui": 0.95,
            "route:tier": "pruned_express",
            "prune:0:Page": 0.05,
            "prune:0:DeadEndParent": 0.24,
            "prune:0:Section": 0.10,
            "prune:0:Leaf": 0.80,
            "prune:0:TabGroup": 0.70,
            "prune:0:TabItemA": 0.10,
            "prune:0:TabItemB": 0.20,
            "prune:0:Column": 0.05,
            "prune:0:Text": 0.05,
            "prune:0:Unused": 0.05,
        }
    )
    router = DecisionCascadeRouter(backend)
    decision = await router.route("Show leaf and tabs", [catalog])

    assert decision.tier is CascadeTier.PRUNED_EXPRESS
    pruned = decision.catalogs[0]
    kept = set(pruned.components)
    assert kept == {
        "Page",
        "Section",
        "Leaf",
        "TabGroup",
        "TabItemB",
        "Column",
        "Text",
    }
    assert "UnusedDef" not in pruned.validation_schema.get("$defs", {})
    # Original catalog stays untouched.
    assert "Unused" in catalog.components


@pytest.mark.asyncio
async def test_multi_catalog_pruning_uses_cid_idx_isolation() -> None:
    cat0 = _custom_catalog({"SharedName": {}, "Text": {}}, catalog_id="urn:test:cat0")
    cat1 = _custom_catalog(
        {"SharedName": {}, "OnlyOne": {}}, catalog_id="urn:test:cat1"
    )
    backend = DeterministicMockBackend(
        scripted_answers={
            "gate:needs_ui": 0.90,
            "route:tier": "pruned_express",
            "prune:0:SharedName": 0.80,
            "prune:0:Text": 0.05,
            "prune:1:SharedName": 0.05,
            "prune:1:OnlyOne": 0.75,
        }
    )
    router = DecisionCascadeRouter(backend)
    decision = await router.route("Use SharedName from cat0", [cat0, cat1])

    assert decision.tier is CascadeTier.PRUNED_EXPRESS
    assert set(decision.catalogs[0].components) == {"SharedName", "Text"}
    assert set(decision.catalogs[1].components) == {"OnlyOne"}


@pytest.mark.asyncio
async def test_deterministic_tie_breaking_on_tier_template_and_children() -> None:
    # Ties within 1e-6 must resolve strictly by declaration index, even when
    # dict insertion order is reversed and probabilities differ at 1e-7.
    catalog = _custom_catalog({
        "Holder": {"allowedChildren": ["FirstChild", "SecondChild"]},
        "FirstChild": {"allowedParents": ["Holder"]},
        "SecondChild": {"allowedParents": ["Holder"]},
    })
    templates = _templates()

    # 1. route:tier tie -> "template" (idx 0) beats "pruned_express" (idx 1)
    #    route:template tie -> "weather_card" (idx 0) beats "flight_status" (idx 1)
    tier_dist = DecisionAnswer(
        question_id="route:tier",
        distribution=DecisionDistribution(
            probabilities={
                "full_express": 0.10,
                "pruned_express": 0.4500002,
                "template": 0.4500001,
            }
        ),
    )
    tmpl_dist = DecisionAnswer(
        question_id="route:template",
        distribution=DecisionDistribution(
            probabilities={
                "none": 0.10,
                "flight_status": 0.4500002,
                "weather_card": 0.4500001,
            }
        ),
    )
    backend = DeterministicMockBackend(
        scripted_answers={
            "gate:needs_ui": 0.90,
            "route:tier": tier_dist,
            "route:template": tmpl_dist,
        }
    )
    router = DecisionCascadeRouter(backend, templates=templates)
    res_tmpl = await router.route("Tie break test", [catalog])
    assert res_tmpl.tier is CascadeTier.TEMPLATE
    assert res_tmpl.template_id == "weather_card"

    # 2. Downward closure child tie -> FirstChild (decl idx 1) beats SecondChild (decl idx 2)
    prune_backend = DeterministicMockBackend(
        scripted_answers={
            "gate:needs_ui": 0.90,
            "route:tier": "pruned_express",
            "prune:0:Holder": 0.80,
            "prune:0:FirstChild": 0.1000001,
            "prune:0:SecondChild": 0.1000002,
        }
    )
    prune_router = DecisionCascadeRouter(prune_backend)
    res_prune = await prune_router.route("Child tie test", [catalog])
    assert set(res_prune.catalogs[0].components) == {"Holder", "FirstChild"}


@pytest.mark.asyncio
async def test_backend_errors_and_omitted_answers_propagate() -> None:
    router = DecisionCascadeRouter(_FailingBackend())
    with pytest.raises(DecisionBackendError, match="backend timed out"):
        await router.route("Show chart", [_basic_v1()])

    omitting_router = DecisionCascadeRouter(_OmittingBackend())
    with pytest.raises(DecisionBackendError, match="omitted answers"):
        await omitting_router.route("Show chart", [_basic_v1()])


@pytest.mark.asyncio
async def test_validation_and_experimental_warning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(SUPPRESS_ENV_VAR, raising=False)
    with pytest.warns(UserWarning, match=r"\[EXPERIMENTAL\] DecisionCascadeRouter"):
        router = DecisionCascadeRouter(DeterministicMockBackend())

    with pytest.raises(ValueError, match="at least one catalog"):
        await router.route("hi", [])
    with pytest.raises(ValueError, match="latency_budget_ms must be positive"):
        await router.route("hi", [_basic_v1()], latency_budget_ms=0.0)
    with pytest.raises(ValueError, match="timeout_seconds must be positive"):
        await router.route("hi", [_basic_v1()], timeout_seconds=0.0)
    with pytest.raises(TypeError, match="DecisionBackend"):
        DecisionCascadeRouter("not-a-backend")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="Duplicate ExpressSurfaceSpec"):
        DecisionCascadeRouter(
            DeterministicMockBackend(),
            templates=(
                ExpressSurfaceSpec(id="dup", description="First", dsl="x"),
                ExpressSurfaceSpec(id="dup", description="Second", dsl="y"),
            ),
        )
    with pytest.raises(ValueError, match="needs_ui_threshold"):
        CascadeConfig(needs_ui_threshold=1.5)
    with pytest.raises(ValueError, match="max_components"):
        CascadeConfig(max_components=0)


@pytest.mark.asyncio
async def test_nested_downward_closure_and_kept_parent_short_circuit() -> None:
    catalog = _custom_catalog({
        "Outer": {
            "allowedParents": ["Surface"],
            "allowedChildren": ["Inner"],
        },
        "Inner": {
            "allowedParents": ["Outer"],
            "allowedChildren": ["DeepLeaf"],
        },
        "DeepLeaf": {"allowedParents": ["Inner"]},
        "AltParent": {"allowedParents": ["Surface"]},
        "KeptParent": {"allowedParents": ["Surface"]},
        "ChildWithTwoParents": {
            "allowedParents": ["AltParent", "KeptParent"],
        },
    })
    backend = DeterministicMockBackend(
        scripted_answers={
            "gate:needs_ui": 0.90,
            "route:tier": "pruned_express",
            "prune:0:Outer": 0.80,
            "prune:0:Inner": 0.10,
            "prune:0:DeepLeaf": 0.05,
            "prune:0:AltParent": 0.20,
            "prune:0:KeptParent": 0.60,
            "prune:0:ChildWithTwoParents": 0.70,
        }
    )
    router = DecisionCascadeRouter(backend)
    decision = await router.route("Nested closure", [catalog])

    assert decision.tier is CascadeTier.PRUNED_EXPRESS
    assert set(decision.catalogs[0].components) == {
        "Outer",
        "Inner",
        "DeepLeaf",
        "KeptParent",
        "ChildWithTwoParents",
    }


@pytest.mark.asyncio
async def test_all_zero_template_distribution_does_not_pick_first_template() -> None:
    catalog = BasicCatalog(ProtocolVersion.V1_0)
    template = ExpressSurfaceSpec(
        id="weather",
        description="Weather summary",
        dsl='root = Text("Sunny")',
    )
    backend = DeterministicMockBackend(
        scripted_answers={
            "gate:needs_ui": 0.90,
            "route:tier": ("template", 0.90),
            "route:template": {"weather": 0.0, "none": 0.0},
        }
    )
    router = DecisionCascadeRouter(backend, templates=(template,))
    decision = await router.route("Show weather", [catalog])
    assert decision.tier is not CascadeTier.TEMPLATE
    assert decision.template is None


@pytest.mark.asyncio
async def test_empty_pruned_catalog_falls_back_to_full_express() -> None:
    catalog = _custom_catalog(
        {
            "Alpha": {"properties": {"id": {"type": "string"}}},
            "Beta": {"properties": {"id": {"type": "string"}}},
        },
        catalog_id="https://example.com/empty_prune/catalog.json",
    )
    backend = DeterministicMockBackend(
        scripted_answers={
            "gate:needs_ui": 0.90,
            "route:tier": ("pruned_express", 0.90),
            "prune:0:Alpha": 0.05,
            "prune:0:Beta": 0.05,
        }
    )
    router = DecisionCascadeRouter(
        backend,
        config=CascadeConfig(layout_floor=(), prune_threshold=0.50),
    )
    decision = await router.route("Render custom", [catalog])
    assert decision.tier is CascadeTier.FULL_EXPRESS
    assert decision.reason == "pruned_catalog_empty"
    assert set(decision.catalogs[0].components) == {"Alpha", "Beta"}


def test_cascade_config_rejects_bare_str_layout_floor() -> None:
    with pytest.raises(TypeError, match="layout_floor"):
        CascadeConfig(layout_floor="Column")  # type: ignore[arg-type]
