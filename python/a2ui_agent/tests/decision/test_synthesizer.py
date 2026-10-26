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

"""Unit tests for DecisionSynthesizer across all synthesis stages and gates."""

from __future__ import annotations

from typing import Any

import pytest

from a2ui.core import Catalog
from a2ui.inference_formats import (
    CatalogDecisionGraph,
    DecisionBackend,
    DecisionSynthesizer,
    SynthesisConfig,
    SynthesisOutput,
    SynthesisStage,
    TemplateRegistry,
    calibrate_thresholds,
)
from a2ui.inference_formats.decision import (
    DecisionDistribution,
    DecisionQuery,
    DeterministicMockBackend,
    SurfaceTemplate,
)
from a2ui.parser.messages import to_message_dicts
from a2ui.utils import validate_payload


def _make_domain_catalog(protocol_version: str = "1.0") -> Catalog:
    """Builds a custom domain catalog with leaf, container, and switcher nodes."""
    is_v1 = protocol_version.lstrip("v").startswith("1.")
    call_key = "@call" if is_v1 else "call"
    schema: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/catalogs/ops/v1/catalog.json",
        "protocolVersion": protocol_version,
        "components": {
            "TelemetryBadge": {
                "type": "object",
                "description": "Read-only telemetry badge.",
                "properties": {
                    "component": {"const": "TelemetryBadge"},
                    "serviceName": {"$ref": "common_types.json#/$defs/DynamicString"},
                    "latencyMs": {"$ref": "common_types.json#/$defs/DynamicNumber"},
                    "severity": {
                        "type": "string",
                        "enum": ["INFO", "WARN", "CRITICAL"],
                    },
                },
                "required": ["component", "serviceName", "latencyMs"],
            },
            "ActionableControl": {
                "type": "object",
                "description": "Mutable control leaf with action and checkable.",
                "allOf": [
                    {"$ref": "common_types.json#/$defs/Checkable"},
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "ActionableControl"},
                            "targetHost": {
                                "$ref": "common_types.json#/$defs/DynamicString"
                            },
                            "replicaCount": {
                                "$ref": "common_types.json#/$defs/DynamicNumber"
                            },
                            "onExecute": {"$ref": "common_types.json#/$defs/Action"},
                        },
                        "required": ["component", "targetHost", "onExecute"],
                    },
                ],
            },
            "EventStreamList": {
                "type": "object",
                "description": "Container with a repeating ChildList.",
                "properties": {
                    "component": {"const": "EventStreamList"},
                    "clusterTitle": {"$ref": "common_types.json#/$defs/DynamicString"},
                    "records": {"$ref": "common_types.json#/$defs/ChildList"},
                },
                "required": ["component", "records"],
            },
            "AlertFrame": {
                "type": "object",
                "description": "Container wrapping a single child component.",
                "properties": {
                    "component": {"const": "AlertFrame"},
                    "innerWidget": {"$ref": "common_types.json#/$defs/ComponentId"},
                },
                "required": ["component", "innerWidget"],
            },
            "WorkspaceDeck": {
                "type": "object",
                "description": "Multi-view switcher for competing views.",
                "properties": {
                    "component": {"const": "WorkspaceDeck"},
                    "views": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "tabTitle": {"type": "string"},
                                "viewComponent": {
                                    "$ref": "common_types.json#/$defs/ComponentId"
                                },
                            },
                            "required": ["tabTitle", "viewComponent"],
                        },
                    },
                },
                "required": ["component", "views"],
            },
        },
        "functions": {
            "isHostReachable": {
                "type": "object",
                "returnType": "boolean",
                "properties": {
                    call_key: {"const": "isHostReachable"},
                    "args": {
                        "type": "object",
                        "properties": {
                            "host": {"$ref": "common_types.json#/$defs/DynamicString"},
                            "minReplicas": {"type": "integer"},
                        },
                        "required": ["host", "minReplicas"],
                    },
                },
                "required": [call_key, "args"],
            },
        },
    }
    return Catalog.from_json(schema)


def test_public_facade_exports() -> None:
    """Verifies top-level and subpackage facade exports."""
    assert CatalogDecisionGraph is not None
    assert DecisionBackend is not None
    assert DecisionSynthesizer is not None
    assert SynthesisConfig is not None
    assert SynthesisOutput is not None
    assert SynthesisStage is not None
    assert TemplateRegistry is not None
    assert calibrate_thresholds is not None


@pytest.mark.asyncio
async def test_stage1_template_hit_and_miss() -> None:
    """Verifies Stage 1 template selection hit and pointer-mismatch fallback."""
    catalog = _make_domain_catalog("1.0")
    registry = TemplateRegistry()
    registry.register(
        SurfaceTemplate(
            template_id="badge_tpl",
            description="Pre-approved telemetry badge",
            surface_id="default_surface",
            catalog_id=catalog.catalog_id,
            protocol_version="v1.0",
            components=(
                {
                    "id": "root",
                    "component": "TelemetryBadge",
                    "serviceName": {"@path": "/serviceName"},
                    "latencyMs": {"@path": "/latencyMs"},
                },
            ),
            required_pointers=("/serviceName", "/latencyMs"),
        )
    )

    backend = DeterministicMockBackend(
        scripted={
            "template_select": {"badge_tpl": 0.90},
            "root_component": {"TelemetryBadge": 0.88},
        }
    )
    synth = DecisionSynthesizer([catalog], backend, registry=registry)

    hit_out = await synth.synthesize(
        "Show service telemetry",
        {"serviceName": "auth-api", "latencyMs": 12.4},
        surface_id="custom_s1",
    )
    assert hit_out.stage == SynthesisStage.TEMPLATE_SELECT
    assert hit_out.selected_template_id == "badge_tpl"
    assert hit_out.confidence == pytest.approx(0.90)
    assert hit_out.component_tree_spec == {
        "template_id": "badge_tpl",
        "root_component": "TelemetryBadge",
    }
    validate_payload([catalog], hit_out.messages)
    express_str = hit_out.to_express([catalog])
    assert "TelemetryBadge" in express_str

    # Missing required pointer '/latencyMs' bypasses Stage 1 and uses Stage 2A.
    miss_out = await synth.synthesize(
        "Show service telemetry",
        {"serviceName": "auth-api"},
    )
    assert miss_out.stage == SynthesisStage.FAST_1PASS_LEAF
    assert miss_out.selected_template_id is None


@pytest.mark.asyncio
async def test_mutability_risk_tiers_across_stages() -> None:
    """Verifies stricter threshold gating for mutable templates, paths, and actions."""
    catalog = _make_domain_catalog("1.0")
    registry = TemplateRegistry()
    registry.register(
        SurfaceTemplate(
            template_id="readonly_tpl",
            description="Read-only telemetry template",
            surface_id="s1",
            catalog_id=catalog.catalog_id,
            protocol_version="v1.0",
            components=(
                {
                    "id": "root",
                    "component": "TelemetryBadge",
                    "serviceName": {"@path": "/serviceName"},
                    "latencyMs": {"@path": "/latencyMs"},
                },
            ),
            required_pointers=("/serviceName", "/latencyMs"),
            is_mutable=False,
        )
    )
    registry.register(
        SurfaceTemplate(
            template_id="other_tpl",
            description="Alternative template",
            surface_id="s2",
            catalog_id=catalog.catalog_id,
            protocol_version="v1.0",
            components=(
                {
                    "id": "root",
                    "component": "TelemetryBadge",
                    "serviceName": {"@path": "/serviceName"},
                    "latencyMs": {"@path": "/latencyMs"},
                },
            ),
            required_pointers=("/serviceName", "/latencyMs"),
            is_mutable=True,
        )
    )

    # Top probability 0.80 is >= template_confidence_threshold (0.75)
    # but < mutable_confidence_threshold (0.85).
    backend = DeterministicMockBackend(
        scripted={
            "template_select": {"readonly_tpl": 0.80, "other_tpl": 0.20},
            "root_component": {"ActionableControl": 0.80, "TelemetryBadge": 0.20},
        }
    )
    config = SynthesisConfig(
        template_confidence_threshold=0.75,
        mutable_confidence_threshold=0.85,
        abstain_threshold=0.40,
    )
    synth = DecisionSynthesizer([catalog], backend, registry=registry, config=config)

    # Read-only call succeeds in Stage 1 at 0.80 >= 0.75.
    ro_out = await synth.synthesize(
        "Show telemetry",
        {"serviceName": "payments", "latencyMs": 42},
    )
    assert ro_out.stage == SynthesisStage.TEMPLATE_SELECT

    # Passing mutable_paths elevates Stage 1 threshold to 0.85 -> Stage 1 rejected,
    # and Stage 2A ActionableControl also requires 0.85 -> abstains!
    mut_out = await synth.synthesize(
        "Update telemetry control",
        {"serviceName": "payments", "latencyMs": 42},
        mutable_paths=["/latencyMs"],
    )
    assert mut_out.stage == SynthesisStage.ABSTAIN_FALLBACK
    assert mut_out.messages == []


@pytest.mark.asyncio
async def test_uncalibrated_logit_margin_rejection() -> None:
    """Verifies uncalibrated backend distributions require min top_logit_margin."""
    catalog = _make_domain_catalog("1.0")
    registry = TemplateRegistry()
    registry.register(
        SurfaceTemplate(
            template_id="badge_tpl",
            description="Telemetry template",
            surface_id="s1",
            catalog_id=catalog.catalog_id,
            protocol_version="v1.0",
            components=(
                {
                    "id": "root",
                    "component": "TelemetryBadge",
                    "serviceName": {"@path": "/serviceName"},
                    "latencyMs": {"@path": "/latencyMs"},
                },
            ),
            required_pointers=("/serviceName", "/latencyMs"),
        )
    )

    low_margin_backend = DeterministicMockBackend(
        scripted={
            "template_select": {"badge_tpl": 0.95},
            "root_component": {"TelemetryBadge": 0.95},
        },
        calibrated=False,
        default_logit_margin=0.5,
    )
    synth_low = DecisionSynthesizer(
        [catalog],
        low_margin_backend,
        registry=registry,
        config=SynthesisConfig(uncalibrated_min_logit_margin=1.5),
    )
    rejected = await synth_low.synthesize(
        "Show telemetry",
        {"serviceName": "api", "latencyMs": 10},
    )
    assert rejected.stage == SynthesisStage.ABSTAIN_FALLBACK

    high_margin_backend = DeterministicMockBackend(
        scripted={"root_component": {"TelemetryBadge": 0.95}},
        calibrated=False,
        default_logit_margin=2.2,
    )
    synth_high = DecisionSynthesizer(
        [catalog],
        high_margin_backend,
        config=SynthesisConfig(uncalibrated_min_logit_margin=1.5),
    )
    accepted = await synth_high.synthesize(
        "Show telemetry",
        {"serviceName": "api", "latencyMs": 10},
    )
    assert accepted.stage == SynthesisStage.FAST_1PASS_LEAF


@pytest.mark.asyncio
async def test_stage2a_leaf_fast_path_bindings_and_checks() -> None:
    """Verifies Stage 2A binds DATA_VALUE, STATIC_ENUM, ACTION, and checks."""
    catalog = _make_domain_catalog("1.0")
    backend = DeterministicMockBackend(
        scripted={
            "root_component:critical badge": {
                "TelemetryBadge": 0.92,
                "ActionableControl": 0.08,
            },
            "root_component:execute control": {
                "ActionableControl": 0.94,
                "TelemetryBadge": 0.06,
            },
        }
    )
    synth = DecisionSynthesizer([catalog], backend)

    badge_out = await synth.synthesize(
        "critical badge",
        {"serviceName": "billing", "latencyMs": 85.0},
    )
    assert badge_out.stage == SynthesisStage.FAST_1PASS_LEAF
    validate_payload([catalog], badge_out.messages)
    badge_dicts = to_message_dicts(badge_out.messages)
    root_comp = badge_dicts[1]["updateComponents"]["components"][0]
    assert root_comp["component"] == "TelemetryBadge"
    assert root_comp["serviceName"] == {"@path": "/serviceName"}
    assert root_comp["latencyMs"] == {"@path": "/latencyMs"}
    assert root_comp["severity"] == "CRITICAL"

    ctrl_out = await synth.synthesize(
        "execute control",
        {"targetHost": "node-1", "replicaCount": 3},
    )
    assert ctrl_out.stage == SynthesisStage.FAST_1PASS_LEAF
    validate_payload([catalog], ctrl_out.messages)
    ctrl_dicts = to_message_dicts(ctrl_out.messages)
    ctrl_comp = ctrl_dicts[1]["updateComponents"]["components"][0]
    assert ctrl_comp["component"] == "ActionableControl"
    assert ctrl_comp["onExecute"] == {"event": {"name": "onExecute"}}
    assert len(ctrl_comp["checks"]) == 1
    assert ctrl_comp["checks"][0]["condition"]["@call"] == "isHostReachable"
    assert "ActionableControl" in ctrl_out.to_express([catalog])


@pytest.mark.asyncio
async def test_stage2b_container_child_list_and_single_child() -> None:
    """Verifies Stage 2B synthesizes CHILD_LIST with relative paths and CHILD slots."""
    catalog = _make_domain_catalog("1.0")
    backend = DeterministicMockBackend(
        scripted={
            "root_component:stream list": {
                "EventStreamList": 0.90,
                "TelemetryBadge": 0.10,
            },
            "root_component:alert frame": {
                "AlertFrame": 0.90,
                "TelemetryBadge": 0.10,
            },
            "child_component": {
                "TelemetryBadge": 0.90,
                "ActionableControl": 0.10,
            },
        }
    )
    synth = DecisionSynthesizer([catalog], backend)

    list_out = await synth.synthesize(
        "stream list",
        {
            "clusterTitle": "us-central1",
            "records": [
                {"serviceName": "frontend", "latencyMs": 11.2},
                {"serviceName": "checkout", "latencyMs": 24.8},
            ],
        },
    )
    assert list_out.stage == SynthesisStage.CONTAINER_2PASS
    validate_payload([catalog], list_out.messages)
    list_dicts = to_message_dicts(list_out.messages)
    comps = list_dicts[1]["updateComponents"]["components"]
    assert len(comps) == 2
    assert comps[0]["component"] == "EventStreamList"
    assert comps[0]["records"] == {
        "path": "/records",
        "componentId": "item_1",
    }
    assert comps[1]["id"] == "item_1"
    assert comps[1]["serviceName"] == {"@path": "serviceName"}
    assert comps[1]["latencyMs"] == {"@path": "latencyMs"}
    assert "EventStreamList" in list_out.to_express([catalog])

    frame_out = await synth.synthesize(
        "alert frame",
        {"serviceName": "search", "latencyMs": 19.0},
    )
    assert frame_out.stage == SynthesisStage.CONTAINER_2PASS
    validate_payload([catalog], frame_out.messages)
    frame_comps = to_message_dicts(frame_out.messages)[1]["updateComponents"][
        "components"
    ]
    assert frame_comps[0]["component"] == "AlertFrame"
    assert frame_comps[0]["innerWidget"] == "child_1"
    assert frame_comps[1]["id"] == "child_1"
    assert frame_comps[1]["serviceName"] == {"@path": "/serviceName"}


@pytest.mark.asyncio
async def test_high_entropy_multi_view_switcher_wrapping() -> None:
    """Verifies high-entropy distributions wrap top competing views in switcher."""
    catalog = _make_domain_catalog("1.0")

    def high_entropy_scorer(query: DecisionQuery) -> DecisionDistribution:
        if query.task == "root_component":
            # Near-uniform over 2 viable non-switcher candidates -> high entropy.
            probs = {c: 0.0 for c in query.candidates}
            probs["TelemetryBadge"] = 0.52
            probs["AlertFrame"] = 0.48
            return DecisionDistribution(probabilities=probs, calibrated=True)
        return DecisionDistribution(
            probabilities={"TelemetryBadge": 0.9, "ActionableControl": 0.1},
            calibrated=True,
        )

    backend = DeterministicMockBackend(scorer=high_entropy_scorer)
    config = SynthesisConfig(
        abstain_threshold=0.40,
        entropy_switch_margin=0.65,
    )
    synth = DecisionSynthesizer([catalog], backend, config=config)

    out = await synth.synthesize(
        "Ambiguous telemetry or alert view",
        {"serviceName": "edge-proxy", "latencyMs": 31.0},
    )
    assert out.stage == SynthesisStage.CONTAINER_2PASS
    assert out.component_tree_spec is not None
    assert out.component_tree_spec["root_component"] == "WorkspaceDeck"
    assert out.component_tree_spec["views"] == ["TelemetryBadge", "AlertFrame"]
    validate_payload([catalog], out.messages)
    assert "WorkspaceDeck" in out.to_express([catalog])


@pytest.mark.asyncio
async def test_stage3_abstain_fallback_and_cqs_promotion() -> None:
    """Verifies Stage 3 abstention and Command-Query Separation promotion."""
    catalog = _make_domain_catalog("1.0")
    registry = TemplateRegistry()

    backend = DeterministicMockBackend(
        scripted={
            "root_component:low confidence": {
                "TelemetryBadge": 0.30,
                "ActionableControl": 0.25,
                "EventStreamList": 0.25,
                "AlertFrame": 0.20,
            },
            "root_component:high confidence": {
                "TelemetryBadge": 0.92,
                "ActionableControl": 0.08,
            },
            "template_select": {"promoted_badge": 0.95},
        }
    )
    config = SynthesisConfig(
        abstain_threshold=0.45,
        entropy_switch_margin=0.01,
    )
    synth = DecisionSynthesizer([catalog], backend, registry=registry, config=config)

    abstain_out = await synth.synthesize(
        "low confidence",
        {"serviceName": "cache", "latencyMs": 5.0},
    )
    assert abstain_out.stage == SynthesisStage.ABSTAIN_FALLBACK
    assert abstain_out.messages == []
    assert registry.list_templates() == ()

    # Synthesize high-confidence leaf: CQS guarantees registry is still empty.
    leaf_out = await synth.synthesize(
        "high confidence",
        {"serviceName": "cache", "latencyMs": 5.0},
    )
    assert leaf_out.stage == SynthesisStage.FAST_1PASS_LEAF
    assert registry.list_templates() == ()

    # Explicit command promotes synthesized output into the registry.
    registry.promote_synthesized(
        "promoted_badge",
        "Promoted cache telemetry badge",
        leaf_out,
        required_pointers=["/serviceName", "/latencyMs"],
    )
    assert len(registry.list_templates()) == 1

    # Subsequent query now hits Stage 1 TEMPLATE_SELECT.
    stage1_out = await synth.synthesize(
        "high confidence",
        {"serviceName": "cache-2", "latencyMs": 7.5},
    )
    assert stage1_out.stage == SynthesisStage.TEMPLATE_SELECT
    assert stage1_out.selected_template_id == "promoted_badge"


@pytest.mark.asyncio
async def test_switcher_mutable_gate_and_tree_limits_and_static_primitives() -> None:
    """Verifies H1 (switcher mutable gate), H4 (static primitives not bound), M1 (tree limits), and M4 (SynthesisConfig validation)."""
    with pytest.raises(ValueError, match="mutable_confidence_threshold"):
        SynthesisConfig(
            template_confidence_threshold=0.80,
            mutable_confidence_threshold=0.70,
        )
    with pytest.raises(ValueError, match="max_tree_depth"):
        SynthesisConfig(max_tree_depth=0)
    with pytest.raises(ValueError, match="max_children_per_container"):
        SynthesisConfig(max_children_per_container=0)

    schema: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/catalogs/strict/v1/catalog.json",
        "protocolVersion": "1.0",
        "components": {
            "StaticNoteLeaf": {
                "type": "object",
                "properties": {
                    "component": {"const": "StaticNoteLeaf"},
                    "title": {"$ref": "common_types.json#/$defs/DynamicString"},
                    "staticTag": {"type": "string"},
                },
                "required": ["component", "title"],
            },
            "ActionView": {
                "type": "object",
                "properties": {
                    "component": {"const": "ActionView"},
                    "title": {"$ref": "common_types.json#/$defs/DynamicString"},
                    "onFire": {"$ref": "common_types.json#/$defs/Action"},
                },
                "required": ["component", "title", "onFire"],
            },
            "DeckSwitcher": {
                "type": "object",
                "properties": {
                    "component": {"const": "DeckSwitcher"},
                    "tabs": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "child": {
                                    "$ref": "common_types.json#/$defs/ComponentId"
                                },
                            },
                            "required": ["label", "child"],
                        },
                    },
                },
                "required": ["component", "tabs"],
            },
        },
    }
    cat = Catalog.from_json(schema)

    # High-entropy distribution between StaticNoteLeaf (0.52) and ActionView (0.48)
    # has top_prob=0.52 < mutable_confidence_threshold=0.85 -> H1 must abstain!
    def ambiguous_action_scorer(query: DecisionQuery) -> DecisionDistribution:
        del query
        return DecisionDistribution(
            probabilities={
                "StaticNoteLeaf": 0.52,
                "ActionView": 0.48,
                "DeckSwitcher": 0.0,
            },
            calibrated=True,
        )

    synth_h1 = DecisionSynthesizer(
        [cat],
        DeterministicMockBackend(scorer=ambiguous_action_scorer),
        config=SynthesisConfig(
            abstain_threshold=0.40,
            mutable_confidence_threshold=0.85,
            entropy_switch_margin=0.80,
        ),
    )
    abstained = await synth_h1.synthesize("ambiguous action", {"title": "hello"})
    assert abstained.stage == SynthesisStage.ABSTAIN_FALLBACK

    # StaticNoteLeaf should NOT bind plain string property 'staticTag' to a DataBinding (H4).
    synth_h4 = DecisionSynthesizer(
        [cat],
        DeterministicMockBackend(scripted={"root_component": {"StaticNoteLeaf": 0.92}}),
    )
    leaf_out = await synth_h4.synthesize(
        "show note", {"title": "hello", "staticTag": "raw"}
    )
    assert leaf_out.stage == SynthesisStage.FAST_1PASS_LEAF
    comp_dict = to_message_dicts(leaf_out.messages)[1]["updateComponents"][
        "components"
    ][0]
    assert "staticTag" not in comp_dict
    validate_payload([cat], leaf_out.messages)

    # M1: max_children_per_container=1 limits DeckSwitcher to 1 child view.
    synth_m1 = DecisionSynthesizer(
        [cat],
        DeterministicMockBackend(scripted={"root_component": {"DeckSwitcher": 0.92}}),
        config=SynthesisConfig(max_children_per_container=1),
    )
    deck_out = await synth_m1.synthesize("show deck", {"title": "hello"})
    deck_comps = to_message_dicts(deck_out.messages)[1]["updateComponents"][
        "components"
    ]
    assert len(deck_comps[0]["tabs"]) == 1
    assert len(deck_comps) == 2


@pytest.mark.asyncio
async def test_any_slot_ranking_and_check_arg_binding_and_camelcase_checks() -> None:
    """Verifies token-overlap ranking for 'any' slots, check arg pointer selection, camelCase check messages, and per-call config overrides."""
    schema: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/catalogs/review_fixes/v1/catalog.json",
        "protocolVersion": "1.0",
        "components": {
            "OrderInspector": {
                "type": "object",
                "allOf": [{"$ref": "common_types.json#/$defs/Checkable"}],
                "properties": {
                    "component": {"const": "OrderInspector"},
                    "title": {"$ref": "common_types.json#/$defs/DynamicString"},
                    "summaryPayload": {"$ref": "common_types.json#/$defs/DynamicValue"},
                },
                "required": ["component", "title"],
            },
        },
        "functions": {
            "isValidTickerSymbol": {
                "type": "object",
                "properties": {
                    "call": {"const": "isValidTickerSymbol"},
                    "args": {
                        "type": "object",
                        "properties": {
                            "tickerSymbol": {
                                "description": "Unconstrained parameter schema."
                            },
                        },
                        "required": ["tickerSymbol"],
                    },
                    "returnType": {"const": "boolean"},
                },
                "required": ["call", "args", "returnType"],
            },
        },
    }
    cat = Catalog.from_json(schema)
    synth = DecisionSynthesizer(
        [cat],
        DeterministicMockBackend(scripted={"root_component": {"OrderInspector": 0.60}}),
        config=SynthesisConfig(abstain_threshold=0.70),
    )
    payload = {
        "unrelatedObject": {},
        "title": "Order View",
        "summaryPayload": {},
        "tickerSymbol": "GOOG",
    }

    # Default config has abstain_threshold=0.70, so 0.60 abstains.
    abstained = await synth.synthesize("inspect order", payload)
    assert abstained.stage == SynthesisStage.ABSTAIN_FALLBACK

    # Per-call config override allows 0.60 without mutating synth.config.
    override_cfg = SynthesisConfig(abstain_threshold=0.50)
    out = await synth.synthesize("inspect order", payload, config=override_cfg)
    assert synth.config.abstain_threshold == pytest.approx(0.70)
    assert out.stage == SynthesisStage.FAST_1PASS_LEAF

    comp = to_message_dicts(out.messages)[1]["updateComponents"]["components"][0]
    # Optional DynamicValue ('any') slot selects /summaryPayload over /unrelatedObject.
    assert comp["summaryPayload"] == {"@path": "/summaryPayload"}
    # Check function argument 'tickerSymbol' binds to /tickerSymbol instead of first pointer,
    # and camelCase function name 'isValidTickerSymbol' is preserved in message.
    assert comp["checks"] == [{
        "condition": {
            "@call": "isValidTickerSymbol",
            "args": {"tickerSymbol": {"@path": "/tickerSymbol"}},
        },
        "message": "IsValidTickerSymbol check failed",
    }]
    validate_payload([cat], out.messages)


@pytest.mark.asyncio
async def test_named_child_array_queries_backend_and_filters_incompatible_leaves() -> (
    None
):
    """Verifies NAMED_CHILD_ARRAY queries backend per view and filters array-only/static leaves."""
    schema: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/catalogs/tabs_filter/v1/catalog.json",
        "protocolVersion": "1.0",
        "components": {
            "StaticIcon": {
                "type": "object",
                "properties": {
                    "component": {"const": "StaticIcon"},
                    "glyph": {"type": "string", "enum": ["star", "check"]},
                },
                "required": ["component", "glyph"],
            },
            "ArrayPicker": {
                "type": "object",
                "properties": {
                    "component": {"const": "ArrayPicker"},
                    "selected": {"$ref": "common_types.json#/$defs/DynamicStringList"},
                },
                "required": ["component", "selected"],
            },
            "ScalarText": {
                "type": "object",
                "properties": {
                    "component": {"const": "ScalarText"},
                    "text": {"$ref": "common_types.json#/$defs/DynamicString"},
                },
                "required": ["component", "text"],
            },
            "ScalarMetric": {
                "type": "object",
                "properties": {
                    "component": {"const": "ScalarMetric"},
                    "label": {"$ref": "common_types.json#/$defs/DynamicString"},
                },
                "required": ["component", "label"],
            },
            "TabContainer": {
                "type": "object",
                "properties": {
                    "component": {"const": "TabContainer"},
                    "tabs": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "child": {
                                    "$ref": "common_types.json#/$defs/ComponentId"
                                },
                            },
                            "required": ["title", "child"],
                        },
                    },
                },
                "required": ["component", "tabs"],
            },
        },
    }
    cat = Catalog.from_json(schema)
    seen_candidates: list[tuple[str, ...]] = []

    def scorer(query: DecisionQuery) -> DecisionDistribution:
        if query.task == "root_component":
            return DecisionDistribution(
                probabilities={"TabContainer": 0.90, "ScalarText": 0.10},
                calibrated=True,
            )
        seen_candidates.append(query.candidates)
        slot = query.context.get("slot", "")
        if slot == "tabs[0]":
            return DecisionDistribution(
                probabilities={"ScalarText": 0.85, "ScalarMetric": 0.15},
                calibrated=True,
            )
        return DecisionDistribution(
            probabilities={"ScalarMetric": 0.85, "ScalarText": 0.15},
            calibrated=True,
        )

    synth = DecisionSynthesizer([cat], DeterministicMockBackend(scorer=scorer))
    out = await synth.synthesize(
        "Show tabs for summary and logs",
        {"overview_summary": "All systems operational", "recent_logs": "OK"},
    )
    assert out.stage == SynthesisStage.CONTAINER_2PASS
    # StaticIcon (no DATA_VALUE slot) and ArrayPicker (requires array pointer) are filtered out.
    for cand_tuple in seen_candidates:
        assert "StaticIcon" not in cand_tuple
        assert "ArrayPicker" not in cand_tuple
        assert set(cand_tuple) == {"ScalarText", "ScalarMetric"}

    comps = to_message_dicts(out.messages)[1]["updateComponents"]["components"]
    assert comps[0]["tabs"] == [
        {"title": "Overview Summary", "child": "view_1"},
        {"title": "Recent Logs", "child": "view_2"},
    ]
    assert comps[1]["component"] == "ScalarText"
    assert comps[1]["text"] == {"@path": "/overview_summary"}
    assert comps[2]["component"] == "ScalarMetric"
    assert comps[2]["label"] == {"@path": "/recent_logs"}
    validate_payload([cat], out.messages)


@pytest.mark.asyncio
async def test_decision_query_context_enrichment() -> None:
    """Verifies that DecisionQuery.context includes candidate and slot descriptions."""
    cat = _make_domain_catalog("1.0")
    reg = TemplateRegistry()
    reg.register(
        SurfaceTemplate(
            template_id="ops_badge_tpl",
            description="Ops telemetry badge summary",
            surface_id="s1",
            catalog_id=cat.catalog_id,
            protocol_version="v1.0",
            components=(
                {
                    "id": "root",
                    "component": "TelemetryBadge",
                    "serviceName": {"@path": "/serviceName"},
                    "latencyMs": {"@path": "/latencyMs"},
                },
            ),
            required_pointers=("/serviceName", "/latencyMs"),
        )
    )

    captured_queries: list[DecisionQuery] = []

    def capturing_scorer(q: DecisionQuery) -> DecisionDistribution:
        captured_queries.append(q)
        if q.task == "template_select":
            return DecisionDistribution(probabilities={q.candidates[0]: 0.10})
        if q.task == "root_component":
            return DecisionDistribution(probabilities={"AlertFrame": 0.90})
        return DecisionDistribution(probabilities={q.candidates[0]: 0.90})

    synth = DecisionSynthesizer(
        [cat], DeterministicMockBackend(scorer=capturing_scorer), registry=reg
    )
    await synth.synthesize(
        "Display ops latency badge",
        {"serviceName": "auth", "latencyMs": 15},
    )

    by_task = {q.task: q for q in captured_queries}
    assert "template_select" in by_task
    assert "candidate_descriptions" in by_task["template_select"].context
    assert (
        by_task["template_select"].context["candidate_descriptions"]["ops_badge_tpl"]
        == "Ops telemetry badge summary"
    )

    assert "root_component" in by_task
    assert "candidate_descriptions" in by_task["root_component"].context
    assert (
        "TelemetryBadge" in by_task["root_component"].context["candidate_descriptions"]
    )
    telemetry_desc = by_task["root_component"].context["candidate_descriptions"][
        "TelemetryBadge"
    ]
    assert "Read-only telemetry badge" in telemetry_desc
    assert "serviceName" in telemetry_desc

    assert "child_component" in by_task
    child_q = by_task["child_component"]
    assert "candidate_descriptions" in child_q.context
    assert "parent_description" in child_q.context
    assert "slot_description" in child_q.context


@pytest.mark.asyncio
async def test_stage2b_action_filtering_and_all_action_leaf_catalog_abstention() -> (
    None
):
    """Verifies M10 (Stage 2B child action filtering below mutable_confidence_threshold), H2 (no action fallback when all leaves have actions), M5 (template/fallback_fn validation), and M6 (container-only catalog abstention)."""
    from a2ui.core import A2uiValidationError

    cat = _make_domain_catalog("1.0")
    low_mut_backend = DeterministicMockBackend(
        scripted={
            "root_component": {"AlertFrame": 0.70, "TelemetryBadge": 0.30},
            "child_component": {"ActionableControl": 0.95, "TelemetryBadge": 0.05},
        }
    )
    low_mut_synth = DecisionSynthesizer(
        [cat],
        low_mut_backend,
        config=SynthesisConfig(
            abstain_threshold=0.50,
            template_confidence_threshold=0.60,
            mutable_confidence_threshold=0.85,
            entropy_switch_margin=0.01,
        ),
    )
    low_mut_out = await low_mut_synth.synthesize(
        "Show alert frame",
        {"serviceName": "billing-api", "latencyMs": 42.5},
    )
    assert low_mut_out.stage == SynthesisStage.CONTAINER_2PASS
    assert low_mut_out.component_tree_spec is not None
    child_names = [
        c["component"] for c in low_mut_out.component_tree_spec["components"]
    ]
    assert "ActionableControl" not in child_names

    # H2: When all leaves in a catalog have required action slots and confidence
    # is below mutable_confidence_threshold, Stage 2B abstains and fallback_card
    # returns [] rather than emitting an action-bearing leaf.
    action_only_cat = Catalog.from_json({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/catalogs/action_only/v1",
        "protocolVersion": "1.0",
        "components": {
            "TradePanel": {
                "type": "object",
                "properties": {
                    "component": {"const": "TradePanel"},
                    "child": {"$ref": "common_types.json#/$defs/ComponentId"},
                },
                "required": ["component", "child"],
            },
            "TradeTicket": {
                "type": "object",
                "properties": {
                    "component": {"const": "TradeTicket"},
                    "symbol": {"$ref": "common_types.json#/$defs/DynamicString"},
                    "onSubmit": {"$ref": "common_types.json#/$defs/Action"},
                },
                "required": ["component", "symbol", "onSubmit"],
            },
        },
    })
    action_only_synth = DecisionSynthesizer(
        [action_only_cat],
        DeterministicMockBackend(scripted={"root_component": {"TradePanel": 0.60}}),
        config=SynthesisConfig(
            abstain_threshold=0.50,
            template_confidence_threshold=0.55,
            mutable_confidence_threshold=0.85,
            entropy_switch_margin=0.01,
        ),
        fallback_card=True,
    )
    action_only_out = await action_only_synth.synthesize(
        "Show trade panel", {"symbol": "GOOG"}
    )
    assert action_only_out.stage == SynthesisStage.ABSTAIN_FALLBACK
    assert action_only_out.messages == []

    # M6: Container-only catalog abstains cleanly without raising A2uiValidationError.
    container_only_cat = Catalog.from_json({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/catalogs/container_only/v1",
        "protocolVersion": "1.0",
        "components": {
            "OuterBox": {
                "type": "object",
                "properties": {
                    "component": {"const": "OuterBox"},
                    "childId": {"$ref": "common_types.json#/$defs/ComponentId"},
                },
                "required": ["component", "childId"],
            },
        },
    })
    container_only_synth = DecisionSynthesizer(
        [container_only_cat],
        DeterministicMockBackend(scripted={"root_component": {"OuterBox": 0.90}}),
        fallback_card=True,
    )
    container_only_out = await container_only_synth.synthesize(
        "Show outer box", {"title": "x"}
    )
    assert container_only_out.stage == SynthesisStage.ABSTAIN_FALLBACK
    assert container_only_out.messages == []

    # M5: Template rendering and fallback_fn validate against active catalogs.
    bad_reg = TemplateRegistry()
    bad_reg.register(
        SurfaceTemplate(
            template_id="bad_comp_tpl",
            description="Template with component not in catalog",
            surface_id="s1",
            catalog_id=cat.catalog_id,
            protocol_version="v1.0",
            components=({"id": "root", "component": "NonExistentWidget"},),
        )
    )
    bad_tpl_synth = DecisionSynthesizer(
        [cat],
        DeterministicMockBackend(scripted={"template_select": {"bad_comp_tpl": 0.95}}),
        registry=bad_reg,
    )
    with pytest.raises(A2uiValidationError):
        await bad_tpl_synth.synthesize("Show widget", {"serviceName": "a"})
    with pytest.raises(A2uiValidationError):
        await bad_tpl_synth.synthesize(
            "Show widget", {"serviceName": "a"}, template_id="bad_comp_tpl"
        )


@pytest.mark.asyncio
async def test_basic_catalog_default_config_attempts_archetype_path_and_flat_opt_out() -> (
    None
):
    """Verifies BasicCatalog attempts the archetype path by default and flat path when use_archetypes=False."""
    from a2ui.core.basic_catalog import BasicCatalog
    from .layout_fixtures import RESORT, ScriptedAnswers

    basic = BasicCatalog("v1.0")
    sa = ScriptedAnswers(
        answers={
            "family": ("inspect", 0.80),
            "stakes": 0.2,
            "urgency": 0.1,
            "archetype:inspect": ("detail", 0.85),
            "gate:picture": 0.90,
            "gate:banner": 0.10,
            "gate:headline": 0.80,
            "gate:prose": 0.90,
            "gate:facts": 0.40,
            "gate:collection": 0.85,
            "gate:actions": 0.30,
            "anatomy:picture.framing": ("banner", 0.80),
            "anatomy:picture.prominence": 2.2,
            "anatomy:collection.layout": ("reel", 0.70),
            "anatomy:collection.leading": ("thumbnail", 0.80),
            "anatomy:collection.trailing": ("none", 0.80),
            "salience:/rating": 2.4,
            "salience:/priceFrom": 2.6,
        }
    )
    synth = DecisionSynthesizer([basic], sa.backend())
    out = await synth.synthesize(RESORT.intent, RESORT.payload)
    assert out.stage == SynthesisStage.ARCHETYPE
    assert out.trace
    assert out.trace[0].question.id == "family"
    validate_payload([basic], out.messages)

    flat_synth = DecisionSynthesizer(
        [basic],
        DeterministicMockBackend(scripted={"root_component": {"Text": 0.90}}),
        config=SynthesisConfig(use_archetypes=False),
    )
    flat_out = await flat_synth.synthesize("Show title", {"title": "Coral Bay Resort"})
    assert flat_out.stage == SynthesisStage.FAST_1PASS_LEAF
    assert flat_out.layout_plan is None


@pytest.mark.asyncio
async def test_input_family_promotes_mutable_pointers_and_scalar_child_list_is_static() -> (
    None
):
    """Verifies automatic mutable promotion when family chooses 'input' and static [item_id] for scalar CHILD_LIST."""
    from a2ui.core.basic_catalog import BasicCatalog
    from .layout_fixtures import ScriptedAnswers

    basic = BasicCatalog("v0.9")
    sa = ScriptedAnswers(
        answers={
            "family": ("input", 0.92),
            "stakes": 1.0,
            "urgency": 0.3,
            "archetype:input": ("form", 0.88),
            "gate:prose": 0.10,
            "gate:form": 0.98,
            "gate:actions": 0.95,
            "instance:form.control:/email": ("shortText", 0.95),
            "instance:form.required:/email": 0.99,
            "instance:form.control:/password": ("obscured", 0.99),
            "instance:form.required:/password": 0.99,
            "instance:form.control:/rememberMe": ("toggle", 0.99),
            "instance:form.required:/rememberMe": 0.05,
            "instance:actions.primary:/actions": ("Sign In", 0.98),
            "instance:actions.destructive:0": 0.01,
        }
    )
    synth = DecisionSynthesizer([basic], sa.backend())
    login_out = await synth.synthesize(
        "Make me a login form",
        {
            "title": "Welcome Back",
            "email": "alex.smith@example.com",
            "password": "",
            "rememberMe": False,
            "actions": ["Sign In"],
        },
    )
    assert login_out.stage == SynthesisStage.ARCHETYPE
    assert login_out.layout_plan is not None
    assert login_out.layout_plan.archetype == "form"
    validate_payload([basic], login_out.messages)

    # Scalar-only payload with a CHILD_LIST container (Column) emits static [item_id],
    # not a template object referencing a non-existent '/children' array path.
    col_synth = DecisionSynthesizer(
        [basic],
        DeterministicMockBackend(
            scripted={
                "root_component": {"Column": 0.90},
                "child_component": {"Text": 0.90},
            }
        ),
        config=SynthesisConfig(use_archetypes=False),
    )
    col_out = await col_synth.synthesize("Show welcome", {"title": "Welcome Back"})
    assert col_out.stage == SynthesisStage.CONTAINER_2PASS
    validate_payload([basic], col_out.messages)
    col_comps = to_message_dicts(col_out.messages)[1]["updateComponents"]["components"]
    assert col_comps[0]["component"] == "Column"
    assert col_comps[0]["children"] == ["item_1"]
    assert col_comps[1]["text"] == {"path": "/title"}
