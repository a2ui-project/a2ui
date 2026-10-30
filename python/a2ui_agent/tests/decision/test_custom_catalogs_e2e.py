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

"""End-to-end synthesis tests across custom Finance, Healthcare, and DevOps catalogs."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import pytest

from a2ui.core import Catalog, PayloadValidator
from a2ui.inference_formats.decision import (
    DecisionSynthesizer,
    DeterministicMockBackend,
    FallbackSource,
    LabeledDecisionExample,
    SynthesisConfig,
    SynthesisOutput,
    SynthesisStage,
    TemplateRegistry,
    calibrate_thresholds,
)
from a2ui.parser.messages import to_message_dicts
from a2ui.utils import validate_payload


def _build_finance_catalog(protocol_version: str) -> Catalog:
    """Builds a custom Finance catalog with zero Basic Catalog components."""
    is_v1 = protocol_version.lstrip("v").startswith("1.")
    call_key = "@call" if is_v1 else "call"
    schema: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/catalogs/finance/v1/catalog.json",
        "protocolVersion": protocol_version,
        "components": {
            "TickerQuoteCard": {
                "type": "object",
                "description": "Displays live equity quote and day change.",
                "properties": {
                    "component": {"const": "TickerQuoteCard"},
                    "ticker": {"$ref": "common_types.json#/$defs/DynamicString"},
                    "price": {"$ref": "common_types.json#/$defs/DynamicNumber"},
                    "marketSession": {
                        "type": "string",
                        "enum": ["PRE_MARKET", "REGULAR", "AFTER_HOURS"],
                    },
                },
                "required": ["component", "ticker", "price"],
            },
            "OrderEntryTicket": {
                "type": "object",
                "description": "Mutable order entry ticket with validation.",
                "allOf": [
                    {"$ref": "common_types.json#/$defs/Checkable"},
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "OrderEntryTicket"},
                            "symbol": {
                                "$ref": "common_types.json#/$defs/DynamicString"
                            },
                            "shares": {
                                "$ref": "common_types.json#/$defs/DynamicNumber"
                            },
                            "side": {
                                "type": "string",
                                "enum": ["BUY", "SELL"],
                            },
                            "submitOrder": {"$ref": "common_types.json#/$defs/Action"},
                        },
                        "required": [
                            "component",
                            "symbol",
                            "shares",
                            "submitOrder",
                        ],
                    },
                ],
            },
            "HoldingsLedger": {
                "type": "object",
                "description": "Repeating ledger of portfolio holdings.",
                "properties": {
                    "component": {"const": "HoldingsLedger"},
                    "portfolioName": {"$ref": "common_types.json#/$defs/DynamicString"},
                    "positions": {"$ref": "common_types.json#/$defs/ChildList"},
                },
                "required": ["component", "portfolioName", "positions"],
            },
        },
        "functions": {
            "isValidTickerSymbol": {
                "type": "object",
                "returnType": "boolean",
                "properties": {
                    call_key: {"const": "isValidTickerSymbol"},
                    "args": {
                        "type": "object",
                        "properties": {
                            "ticker": {"$ref": "common_types.json#/$defs/DynamicString"}
                        },
                        "required": ["ticker"],
                    },
                },
                "required": [call_key, "args"],
            },
        },
    }
    return Catalog.from_json(schema)


def _build_healthcare_catalog(protocol_version: str) -> Catalog:
    """Builds a custom Healthcare catalog with zero Basic Catalog components."""
    is_v1 = protocol_version.lstrip("v").startswith("1.")
    call_key = "@call" if is_v1 else "call"
    schema: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/catalogs/healthcare/v1/catalog.json",
        "protocolVersion": protocol_version,
        "components": {
            "VitalsTelemetryCard": {
                "type": "object",
                "description": "Displays patient heart rate and triage level.",
                "properties": {
                    "component": {"const": "VitalsTelemetryCard"},
                    "patientName": {"$ref": "common_types.json#/$defs/DynamicString"},
                    "heartRateBpm": {"$ref": "common_types.json#/$defs/DynamicNumber"},
                    "triageBand": {
                        "type": "string",
                        "enum": ["GREEN", "YELLOW", "RED"],
                    },
                },
                "required": ["component", "patientName", "heartRateBpm"],
            },
            "WardBedBanner": {
                "type": "object",
                "description": "Container wrapping a patient vitals card.",
                "properties": {
                    "component": {"const": "WardBedBanner"},
                    "wardName": {"$ref": "common_types.json#/$defs/DynamicString"},
                    "vitalsChild": {"$ref": "common_types.json#/$defs/ComponentId"},
                },
                "required": ["component", "wardName", "vitalsChild"],
            },
            "ClinicalChartDeck": {
                "type": "object",
                "description": "Multi-view switcher for clinical panes.",
                "properties": {
                    "component": {"const": "ClinicalChartDeck"},
                    "panes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "paneTitle": {"type": "string"},
                                "paneId": {
                                    "$ref": "common_types.json#/$defs/ComponentId"
                                },
                            },
                            "required": ["paneTitle", "paneId"],
                        },
                    },
                },
                "required": ["component", "panes"],
            },
        },
        "functions": {
            "isSafeHeartRate": {
                "type": "object",
                "returnType": "boolean",
                "properties": {
                    call_key: {"const": "isSafeHeartRate"},
                    "args": {
                        "type": "object",
                        "properties": {
                            "bpm": {"$ref": "common_types.json#/$defs/DynamicNumber"}
                        },
                        "required": ["bpm"],
                    },
                },
                "required": [call_key, "args"],
            },
        },
    }
    return Catalog.from_json(schema)


def _build_devops_catalog(protocol_version: str) -> Catalog:
    """Builds a custom DevOps catalog with zero Basic Catalog components."""
    is_v1 = protocol_version.lstrip("v").startswith("1.")
    call_key = "@call" if is_v1 else "call"
    schema: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/catalogs/devops/v1/catalog.json",
        "protocolVersion": protocol_version,
        "components": {
            "ClusterHealthGauge": {
                "type": "object",
                "description": "Displays cluster CPU utilization and region.",
                "properties": {
                    "component": {"const": "ClusterHealthGauge"},
                    "clusterName": {"$ref": "common_types.json#/$defs/DynamicString"},
                    "cpuPercent": {"$ref": "common_types.json#/$defs/DynamicNumber"},
                },
                "required": ["component", "clusterName", "cpuPercent"],
            },
            "IncidentFeed": {
                "type": "object",
                "description": "Repeating list of incident rows.",
                "properties": {
                    "component": {"const": "IncidentFeed"},
                    "incidents": {"$ref": "common_types.json#/$defs/ChildList"},
                    "severityFilter": {
                        "type": "string",
                        "enum": ["SEV1", "SEV2", "SEV3"],
                    },
                },
                "required": ["component", "incidents"],
            },
            "RollbackActionCard": {
                "type": "object",
                "description": "Triggers deployment rollback with check.",
                "allOf": [
                    {"$ref": "common_types.json#/$defs/Checkable"},
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "RollbackActionCard"},
                            "revisionTag": {
                                "$ref": "common_types.json#/$defs/DynamicString"
                            },
                            "triggerRollback": {
                                "$ref": "common_types.json#/$defs/Action"
                            },
                        },
                        "required": [
                            "component",
                            "revisionTag",
                            "triggerRollback",
                        ],
                    },
                ],
            },
        },
        "functions": {
            "isRevisionHealthy": {
                "type": "object",
                "returnType": "boolean",
                "properties": {
                    call_key: {"const": "isRevisionHealthy"},
                    "args": {
                        "type": "object",
                        "properties": {
                            "revision": {
                                "$ref": "common_types.json#/$defs/DynamicString"
                            }
                        },
                        "required": ["revision"],
                    },
                },
                "required": [call_key, "args"],
            },
        },
    }
    return Catalog.from_json(schema)


def _assert_valid_surface(
    catalogs: Sequence[Catalog],
    output: SynthesisOutput,
    *,
    expected_root: str,
) -> None:
    """Validates every synthesized component, wire envelope, and Express output."""
    assert output.messages
    validate_payload(list(catalogs), output.messages)
    msg_dicts = to_message_dicts(output.messages)
    components = msg_dicts[1]["updateComponents"]["components"]
    assert components[0]["component"] == expected_root

    validators = {cat.catalog_id: PayloadValidator(cat) for cat in catalogs}
    default_validator = PayloadValidator(catalogs[0])
    for comp in components:
        cat_id = comp.get("catalogId")
        validator = (
            validators[cat_id]
            if isinstance(cat_id, str) and cat_id in validators
            else default_validator
        )
        validator.validate_component(comp)

    express_text = output.to_express(catalogs)
    assert expected_root in express_text


@pytest.mark.parametrize("protocol_version", ["0.9", "1.0"])
@pytest.mark.asyncio
async def test_finance_catalog_e2e_v09_and_v10(protocol_version: str) -> None:
    """Verifies Finance leaf, container ChildList, and template promotion in v0.9 and v1.0."""
    catalog = _build_finance_catalog(protocol_version)
    backend = DeterministicMockBackend()
    registry = TemplateRegistry()
    synth = DecisionSynthesizer(
        [catalog], backend, registry=registry, fallback_card=True
    )

    quote_out = await synth.synthesize(
        "Show TickerQuoteCard for regular market session",
        {"ticker": "GOOG", "price": 182.50},
        config=SynthesisConfig(max_tree_depth=1),
    )
    assert quote_out.stage == SynthesisStage.ABSTAIN_FALLBACK
    assert quote_out.fallback_source is FallbackSource.CARD
    assert quote_out.trace and quote_out.trace[0].outcome == "no eligible archetype"
    _assert_valid_surface([catalog], quote_out, expected_root="TickerQuoteCard")

    # Promote synthesized quote surface and verify Stage 1 template reuse.
    registry.promote_synthesized(
        "quote_tpl",
        "Promoted equity quote card",
        quote_out,
        required_pointers=["/ticker", "/price"],
    )
    reused_out = await synth.synthesize(
        "Show quote_tpl for regular market session",
        {"ticker": "MSFT", "price": 415.0},
    )
    assert reused_out.stage == SynthesisStage.TEMPLATE_SELECT
    assert reused_out.selected_template_id == "quote_tpl"
    _assert_valid_surface([catalog], reused_out, expected_root="TickerQuoteCard")

    ledger_out = await synth.synthesize(
        "Display HoldingsLedger positions table",
        {
            "portfolioName": "Growth Fund",
            "positions": [
                {"ticker": "GOOG", "price": 182.50},
                {"ticker": "AAPL", "price": 220.10},
            ],
        },
    )
    assert ledger_out.stage == SynthesisStage.ABSTAIN_FALLBACK
    assert ledger_out.fallback_source is FallbackSource.CARD
    _assert_valid_surface([catalog], ledger_out, expected_root="HoldingsLedger")


@pytest.mark.parametrize("protocol_version", ["0.9", "1.0"])
@pytest.mark.asyncio
async def test_healthcare_catalog_e2e_v09_and_v10(
    protocol_version: str,
) -> None:
    """Verifies Healthcare leaf and CHILD wrapper fallback synthesis in v0.9 and v1.0."""
    catalog = _build_healthcare_catalog(protocol_version)
    backend = DeterministicMockBackend()
    synth = DecisionSynthesizer([catalog], backend, fallback_card=True)

    vitals_out = await synth.synthesize(
        "vitals card",
        {"patientName": "J. Doe", "heartRateBpm": 74},
        config=SynthesisConfig(max_tree_depth=1),
    )
    assert vitals_out.stage == SynthesisStage.ABSTAIN_FALLBACK
    assert vitals_out.fallback_source is FallbackSource.CARD
    assert vitals_out.trace and vitals_out.trace[0].outcome == "no eligible archetype"
    _assert_valid_surface([catalog], vitals_out, expected_root="VitalsTelemetryCard")

    banner_out = await synth.synthesize(
        "ward banner",
        {"wardName": "ICU-East", "patientName": "J. Doe", "heartRateBpm": 74},
    )
    assert banner_out.stage == SynthesisStage.ABSTAIN_FALLBACK
    assert banner_out.fallback_source is FallbackSource.CARD
    _assert_valid_surface([catalog], banner_out, expected_root="WardBedBanner")


@pytest.mark.parametrize("protocol_version", ["0.9", "1.0"])
@pytest.mark.asyncio
async def test_devops_catalog_and_calibration_e2e(
    protocol_version: str,
) -> None:
    """Verifies DevOps synthesis and empirical threshold calibration end-to-end."""
    catalog = _build_devops_catalog(protocol_version)
    backend = DeterministicMockBackend(
        scripted={
            "template_select:Show ClusterHealthGauge cpuPercent": {
                "gauge_tpl": 0.92,
                "feed_tpl": 0.08,
            },
            "template_select:Show SEV1 IncidentFeed list": {
                "feed_tpl": 0.90,
                "gauge_tpl": 0.10,
            },
        }
    )
    registry = TemplateRegistry()
    synth = DecisionSynthesizer(
        [catalog],
        backend,
        registry=registry,
        config=SynthesisConfig(abstain_threshold=0.35),
        fallback_card=True,
    )

    gauge_out = await synth.synthesize(
        "Show ClusterHealthGauge cpuPercent",
        {"clusterName": "prod-us-west1", "cpuPercent": 68.2},
        config=SynthesisConfig(max_tree_depth=1),
    )
    assert gauge_out.stage == SynthesisStage.ABSTAIN_FALLBACK
    assert gauge_out.fallback_source is FallbackSource.CARD
    assert gauge_out.trace and gauge_out.trace[0].outcome == "no eligible archetype"
    _assert_valid_surface([catalog], gauge_out, expected_root="ClusterHealthGauge")

    feed_out = await synth.synthesize(
        "Show SEV1 IncidentFeed list",
        {
            "incidents": [
                {"clusterName": "prod-us-west1", "cpuPercent": 95.4},
                {"clusterName": "prod-eu-west1", "cpuPercent": 89.1},
            ]
        },
    )
    assert feed_out.stage == SynthesisStage.ABSTAIN_FALLBACK
    assert feed_out.fallback_source is FallbackSource.CARD
    _assert_valid_surface([catalog], feed_out, expected_root="IncidentFeed")

    registry.promote_synthesized(
        "gauge_tpl",
        "Cluster health gauge template",
        gauge_out,
        required_pointers=["/clusterName", "/cpuPercent"],
    )
    registry.promote_synthesized(
        "feed_tpl",
        "Incident feed template",
        feed_out,
        required_pointers=["/incidents"],
    )

    dataset = [
        LabeledDecisionExample(
            intent="Show ClusterHealthGauge cpuPercent",
            payload={"clusterName": "prod-us-west1", "cpuPercent": 68.2},
            expected_root_component="ClusterHealthGauge",
        ),
        LabeledDecisionExample(
            intent="Show SEV1 IncidentFeed list",
            payload={
                "incidents": [
                    {"clusterName": "prod-us-west1", "cpuPercent": 95.4},
                ]
            },
            expected_root_component="IncidentFeed",
        ),
    ]
    cal_result = await calibrate_thresholds(synth, dataset, target_precision=0.95)
    assert cal_result.achieved_precision == pytest.approx(1.0)
    assert cal_result.achieved_coverage == pytest.approx(1.0)
    assert 0.30 <= cal_result.recommended_template_threshold <= 0.99
