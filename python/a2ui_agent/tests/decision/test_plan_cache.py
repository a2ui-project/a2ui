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

"""Unit tests for `PlanCache` and cached data-only updates."""

from __future__ import annotations

from dataclasses import replace
import json
from typing import Any

import pytest

from a2ui.core import Catalog
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import (
    ActionSpec,
    ArchetypeGrammar,
    DecisionFormat,
    DecisionSynthesizer,
    LayoutPlan,
    PlanCache,
    PlanCacheKey,
    SurfaceOperation,
)
from a2ui.parser import A2uiPart
from a2ui.parser.messages import to_message_dicts
from a2ui.utils import RendererState

from .layout_fixtures import HOST, ScriptedValue, mock_backend

CATALOG = BasicCatalog("v1.0")

HOST_SCRIPTED: dict[str, ScriptedValue] = {
    "family": ("monitor", 0.90),
    "stakes": 1.0,
    "urgency": 1.4,
    "archetype:monitor": ("dashboard", 0.85),
    "gate:banner": 0.80,
    "gate:headline": 0.90,
    "gate:facts": 0.80,
}


def _wrapped(block: dict[str, Any]) -> str:
    return f"<a2ui>{json.dumps(block)}</a2ui>"


def _messages(parts: list[Any]) -> list[dict[str, Any]]:
    return [
        d for p in parts if isinstance(p, A2uiPart) for d in to_message_dicts(p.a2ui)
    ]


def _kinds(dicts: list[dict[str, Any]]) -> list[str]:
    return [next(k for k in d if k != "version") for d in dicts]


@pytest.mark.asyncio
async def test_same_shape_twice_emits_only_update_data_model_with_zero_calls() -> None:
    backend = mock_backend(**HOST_SCRIPTED)
    synth = DecisionSynthesizer([CATALOG], backend)
    state = RendererState([CATALOG])

    first = await synth.synthesize(
        HOST.intent, HOST.payload, surface_id="ops", state=state
    )
    assert first.cache_hit is False
    assert first.decision_calls == 1
    assert len(backend.batches) == 1
    assert _kinds(to_message_dicts(first.messages)) == [
        "createSurface",
        "updateComponents",
        "updateDataModel",
    ]
    state.apply(first.messages)

    updated_payload = {**HOST.payload, "cpu": 0.42, "status": "healthy"}
    second = await synth.synthesize(
        HOST.intent,
        updated_payload,
        surface_id="ops",
        operation=SurfaceOperation.UPDATE_ROOT,
        state=state,
    )
    assert second.cache_hit is True
    assert second.decision_calls == 0
    assert second.decision_latency_ms == 0.0
    assert len(backend.batches) == 1
    second_dicts = to_message_dicts(second.messages)
    assert _kinds(second_dicts) == ["updateDataModel"]
    assert second_dicts[0]["updateDataModel"]["value"] == updated_payload
    state.apply(second.messages)


@pytest.mark.asyncio
async def test_changed_shape_replans_and_updates_components() -> None:
    backend = mock_backend(**HOST_SCRIPTED)
    synth = DecisionSynthesizer([CATALOG], backend)
    state = RendererState([CATALOG])

    first = await synth.synthesize(
        HOST.intent, HOST.payload, surface_id="ops", state=state
    )
    state.apply(first.messages)
    assert len(backend.batches) == 1

    changed = await synth.synthesize(
        HOST.intent,
        {**HOST.payload, "region": "us-east-1"},
        surface_id="ops",
        operation=SurfaceOperation.UPDATE_ROOT,
        state=state,
    )
    assert changed.cache_hit is False
    assert changed.decision_calls == 1
    assert len(backend.batches) == 2
    assert _kinds(to_message_dicts(changed.messages)) == [
        "updateComponents",
        "updateDataModel",
    ]


@pytest.mark.asyncio
async def test_same_shape_with_new_action_replans() -> None:
    backend = mock_backend(**HOST_SCRIPTED)
    synth = DecisionSynthesizer([CATALOG], backend)
    state = RendererState([CATALOG])

    first = await synth.synthesize(
        HOST.intent, HOST.payload, surface_id="ops", state=state
    )
    state.apply(first.messages)
    assert len(backend.batches) == 1

    with_action = await synth.synthesize(
        HOST.intent,
        HOST.payload,
        surface_id="ops",
        actions=[ActionSpec(id="refresh", label="Refresh")],
        operation=SurfaceOperation.UPDATE_ROOT,
        state=state,
    )
    assert with_action.cache_hit is False
    assert with_action.decision_calls == 1
    assert len(backend.batches) == 2
    assert _kinds(to_message_dicts(with_action.messages)) == [
        "updateComponents",
        "updateDataModel",
    ]


@pytest.mark.asyncio
async def test_same_shape_with_new_exclude_replans() -> None:
    backend = mock_backend(**HOST_SCRIPTED)
    synth = DecisionSynthesizer([CATALOG], backend)
    state = RendererState([CATALOG])

    first = await synth.synthesize(
        HOST.intent, HOST.payload, surface_id="ops", state=state
    )
    state.apply(first.messages)
    assert len(backend.batches) == 1

    with_exclude = await synth.synthesize(
        HOST.intent,
        HOST.payload,
        surface_id="ops",
        exclude=["/uptimeHours"],
        operation=SurfaceOperation.UPDATE_ROOT,
        state=state,
    )
    assert with_exclude.cache_hit is False
    assert with_exclude.decision_calls == 1
    assert len(backend.batches) == 2
    assert _kinds(to_message_dicts(with_exclude.messages)) == [
        "updateComponents",
        "updateDataModel",
    ]


@pytest.mark.asyncio
async def test_two_states_with_same_surface_id_do_not_share_entries() -> None:
    backend = mock_backend(**HOST_SCRIPTED)
    synth = DecisionSynthesizer([CATALOG], backend)
    state_a = RendererState([CATALOG])
    state_b = RendererState([CATALOG])

    out_a1 = await synth.synthesize(
        HOST.intent, HOST.payload, surface_id="ops", state=state_a
    )
    state_a.apply(out_a1.messages)
    assert len(backend.batches) == 1

    # `state_b` has never planned `"ops"`, even if its surface is populated externally.
    state_b.apply(out_a1.messages)
    out_b1 = await synth.synthesize(
        HOST.intent,
        HOST.payload,
        surface_id="ops",
        operation=SurfaceOperation.UPDATE_ROOT,
        state=state_b,
    )
    assert out_b1.cache_hit is False
    assert out_b1.decision_calls == 1
    assert len(backend.batches) == 2


@pytest.mark.asyncio
async def test_hit_is_rejected_when_surface_components_changed() -> None:
    backend = mock_backend(**HOST_SCRIPTED)
    synth = DecisionSynthesizer([CATALOG], backend)
    state = RendererState([CATALOG])

    first = await synth.synthesize(
        HOST.intent, HOST.payload, surface_id="ops", state=state
    )
    state.apply(first.messages)
    assert len(backend.batches) == 1

    # Mutate the surface's components on the state (adding a component and
    # changing `root`'s children), so the cached plan no longer matches.
    state.apply([{
        "version": "1.0",
        "updateComponents": {
            "surfaceId": "ops",
            "components": [{
                "id": "root",
                "component": "Text",
                "text": "Manual override",
            }],
        },
    }])

    second = await synth.synthesize(
        HOST.intent,
        HOST.payload,
        surface_id="ops",
        operation=SurfaceOperation.UPDATE_ROOT,
        state=state,
    )
    assert second.cache_hit is False
    assert second.decision_calls == 1
    assert len(backend.batches) == 2
    assert _kinds(to_message_dicts(second.messages)) == [
        "updateComponents",
        "updateDataModel",
    ]


@pytest.mark.asyncio
async def test_lru_bound_evicts_oldest_entry_per_state() -> None:
    backend = mock_backend(**HOST_SCRIPTED)
    synth = DecisionSynthesizer([CATALOG], backend, plan_cache=PlanCache(max_entries=2))
    state = RendererState([CATALOG])

    for sid in ("s1", "s2", "s3"):
        created = await synth.synthesize(
            HOST.intent, HOST.payload, surface_id=sid, state=state
        )
        state.apply(created.messages)
    assert len(backend.batches) == 3

    # `s2` and `s3` are still in the size-2 LRU; `s1` was evicted.
    hit_s2 = await synth.synthesize(
        HOST.intent,
        HOST.payload,
        surface_id="s2",
        operation=SurfaceOperation.UPDATE_ROOT,
        state=state,
    )
    assert hit_s2.cache_hit is True
    assert len(backend.batches) == 3

    miss_s1 = await synth.synthesize(
        HOST.intent,
        HOST.payload,
        surface_id="s1",
        operation=SurfaceOperation.UPDATE_ROOT,
        state=state,
    )
    assert miss_s1.cache_hit is False
    assert miss_s1.decision_calls == 1
    assert len(backend.batches) == 4


def test_replace_invalidates_cached_plan_in_parser() -> None:
    backend = mock_backend(**HOST_SCRIPTED)
    fmt = DecisionFormat([CATALOG], backend=backend)
    parser = fmt.create_parser(conversation_id="conv-replace")
    block = {"intent": HOST.intent, "payload": dict(HOST.payload), "surfaceId": "ops"}

    first = _messages(parser.parse_response(_wrapped(block)))
    assert _kinds(first) == ["createSurface", "updateComponents", "updateDataModel"]
    assert len(backend.batches) == 1

    second = _messages(
        parser.parse_response(
            _wrapped({**block, "payload": {**HOST.payload, "cpu": 0.25}})
        )
    )
    assert _kinds(second) == ["updateDataModel"]
    assert parser.last_output is not None and parser.last_output.cache_hit is True
    assert len(backend.batches) == 1

    replaced = _messages(parser.parse_response(_wrapped({**block, "replace": True})))
    assert _kinds(replaced) == [
        "deleteSurface",
        "createSurface",
        "updateComponents",
        "updateDataModel",
    ]
    assert parser.last_output is not None and parser.last_output.cache_hit is False
    assert len(backend.batches) == 2


@pytest.mark.asyncio
async def test_cache_never_serves_across_catalogs_or_grammar_versions() -> None:
    backend = mock_backend(**HOST_SCRIPTED)
    synth_basic = DecisionSynthesizer([CATALOG], backend)
    state = RendererState([CATALOG])

    first = await synth_basic.synthesize(
        HOST.intent, HOST.payload, surface_id="ops", state=state
    )
    state.apply(first.messages)
    assert len(backend.batches) == 1

    # A synthesizer with a different grammar version does not reuse the cached plan.
    synth_v2 = DecisionSynthesizer(
        [CATALOG],
        backend,
        plan_cache=synth_basic.plan_cache,
    )
    synth_v2.archetypes = replace(ArchetypeGrammar.default(), version="2")
    out_v2 = await synth_v2.synthesize(
        HOST.intent,
        HOST.payload,
        surface_id="ops",
        operation=SurfaceOperation.UPDATE_ROOT,
        state=state,
    )
    assert out_v2.cache_hit is False
    assert out_v2.decision_calls == 1
    assert len(backend.batches) == 2

    # A key for a different catalog id also misses on the same state and cache.
    other_catalog = Catalog.from_json({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/other/v1/catalog.json",
        "protocolVersion": "1.0",
        "components": {},
        "functions": {},
    })
    other_key = PlanCacheKey(
        surface_id="ops",
        catalog_id=other_catalog.catalog_id,
        grammar_version=ArchetypeGrammar.default().version,
        shape_signature="any",
    )
    assert synth_basic.plan_cache.get(state, other_key) is None
    assert LayoutPlan(archetype="dashboard", family="monitor", blocks=()) is not None


@pytest.mark.asyncio
async def test_unrolled_array_length_change_misses_cache_and_replans() -> None:
    steps_scripted: dict[str, ScriptedValue] = {
        "family": ("follow", 0.90),
        "stakes": 0.2,
        "urgency": 0.2,
        "archetype:follow": ("guide", 0.92),
        "gate:steps": 0.95,
    }
    backend = mock_backend(**steps_scripted)
    synth = DecisionSynthesizer([CATALOG], backend)
    state = RendererState([CATALOG])

    payload_2 = {
        "title": "Deploy guide",
        "steps": [
            {"title": "Build", "detail": "Run build"},
            {"title": "Test", "detail": "Run pytest"},
        ],
    }
    first = await synth.synthesize(
        "Show the deployment guide steps",
        payload_2,
        surface_id="guide",
        state=state,
    )
    state.apply(first.messages)
    assert first.cache_hit is False
    assert len(backend.batches) == 1

    # Adding a third step stays in the `"2..6"` cardinality bucket, but because
    # `steps` statically unrolls its items, it must miss the cache and re-plan.
    payload_3 = {
        "title": "Deploy guide",
        "steps": [
            {"title": "Build", "detail": "Run build"},
            {"title": "Test", "detail": "Run pytest"},
            {"title": "Ship", "detail": "Tag release"},
        ],
    }
    second = await synth.synthesize(
        "Show the deployment guide steps",
        payload_3,
        surface_id="guide",
        operation=SurfaceOperation.UPDATE_ROOT,
        state=state,
    )
    state.apply(second.messages)
    assert second.cache_hit is False
    assert len(backend.batches) == 2
    assert _kinds(to_message_dicts(second.messages)) == [
        "updateComponents",
        "updateDataModel",
    ]

    # Updating step text while keeping 3 steps hits the cache as data-only.
    payload_3_edited = {
        "title": "Deploy guide",
        "steps": [
            {"title": "Build", "detail": "Run fast build"},
            {"title": "Test", "detail": "Run pytest"},
            {"title": "Ship", "detail": "Tag release"},
        ],
    }
    third = await synth.synthesize(
        "Show the deployment guide steps",
        payload_3_edited,
        surface_id="guide",
        operation=SurfaceOperation.UPDATE_ROOT,
        state=state,
    )
    assert third.cache_hit is True
    assert len(backend.batches) == 2
    assert _kinds(to_message_dicts(third.messages)) == ["updateDataModel"]
