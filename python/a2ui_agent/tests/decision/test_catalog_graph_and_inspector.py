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

"""Unit tests for CatalogDecisionGraph and inspect_payload_pointers."""

from __future__ import annotations

from typing import Any

from a2ui.core import Catalog
from a2ui.inference_formats.decision.catalog_graph import CatalogDecisionGraph
from a2ui.inference_formats.decision.models import SlotKind
from a2ui.inference_formats.decision.payload_inspector import (
    PointerSummary,
    inspect_payload_pointers,
)


def _make_finance_catalog(protocol_version: str = "1.0") -> Catalog:
    """Builds a custom Finance catalog with zero Basic Catalog components."""
    is_v1 = protocol_version.lstrip("v").startswith("1.")
    call_key = "@call" if is_v1 else "call"
    schema: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/catalogs/finance/v1/catalog.json",
        "protocolVersion": protocol_version,
        "components": {
            "PortfolioGrid": {
                "type": "object",
                "description": "Displays a table of portfolio positions.",
                "properties": {
                    "component": {"const": "PortfolioGrid"},
                    "accountName": {"$ref": "common_types.json#/$defs/DynamicString"},
                    "positions": {"$ref": "common_types.json#/$defs/ChildList"},
                },
                "required": ["component", "accountName", "positions"],
            },
            "TradeTicket": {
                "type": "object",
                "description": "Order entry ticket for equities.",
                "allOf": [
                    {"$ref": "common_types.json#/$defs/Checkable"},
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "TradeTicket"},
                            "ticker": {
                                "$ref": "common_types.json#/$defs/DynamicString"
                            },
                            "quantity": {
                                "$ref": "common_types.json#/$defs/DynamicNumber"
                            },
                            "side": {
                                "type": "string",
                                "enum": ["BUY", "SELL"],
                            },
                            "onSubmit": {"$ref": "common_types.json#/$defs/Action"},
                        },
                        "required": ["component", "ticker", "quantity", "onSubmit"],
                    },
                ],
            },
            "StrategyComparison": {
                "type": "object",
                "description": "Multi-view switcher comparing option strategies.",
                "properties": {
                    "component": {"const": "StrategyComparison"},
                    "strategies": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "strategyName": {
                                    "$ref": "common_types.json#/$defs/DynamicString"
                                },
                                "viewId": {
                                    "$ref": "common_types.json#/$defs/ComponentId"
                                },
                            },
                            "required": ["strategyName", "viewId"],
                        },
                    },
                },
                "required": ["component", "strategies"],
            },
            "MarginAlertBox": {
                "type": "object",
                "description": "Wrapper container displaying a margin warning.",
                "properties": {
                    "component": {"const": "MarginAlertBox"},
                    "bannerChild": {"$ref": "common_types.json#/$defs/ComponentId"},
                    "isMarginCall": {"$ref": "common_types.json#/$defs/DynamicBoolean"},
                },
                "required": ["component", "bannerChild"],
            },
        },
        "functions": {
            "isValidTicker": {
                "type": "object",
                "returnType": "boolean",
                "properties": {
                    call_key: {"const": "isValidTicker"},
                    "args": {
                        "type": "object",
                        "properties": {"value": {"type": "string"}},
                        "required": ["value"],
                    },
                },
                "required": [call_key, "args"],
            },
            "formatCurrency": {
                "type": "object",
                "returnType": "string",
                "properties": {
                    call_key: {"const": "formatCurrency"},
                    "args": {
                        "type": "object",
                        "properties": {"amount": {"type": "number"}},
                        "required": ["amount"],
                    },
                },
                "required": [call_key, "args"],
            },
        },
    }
    return Catalog.from_json(schema)


def _make_healthcare_catalog() -> Catalog:
    """Builds a custom Healthcare catalog with zero Basic Catalog components."""
    schema: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/catalogs/healthcare/v1/catalog.json",
        "protocolVersion": "1.0",
        "components": {
            "VitalsMonitor": {
                "type": "object",
                "description": "Live telemetry card for patient vitals.",
                "properties": {
                    "component": {"const": "VitalsMonitor"},
                    "patientName": {"$ref": "common_types.json#/$defs/DynamicString"},
                    "heartRate": {"$ref": "common_types.json#/$defs/DynamicNumber"},
                    "criticalAlert": {
                        "$ref": "common_types.json#/$defs/DynamicBoolean"
                    },
                    "triageLevel": {
                        "type": "string",
                        "enum": ["GREEN", "YELLOW", "RED"],
                    },
                },
                "required": ["component", "patientName", "heartRate"],
            },
            "DosageOrderPanel": {
                "type": "object",
                "description": "Medication dosage order container with action.",
                "allOf": [
                    {"$ref": "common_types.json#/$defs/Checkable"},
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "DosageOrderPanel"},
                            "summaryWidget": {
                                "$ref": "common_types.json#/$defs/ComponentId"
                            },
                            "confirmAction": {
                                "$ref": "common_types.json#/$defs/Action"
                            },
                        },
                        "required": [
                            "component",
                            "summaryWidget",
                            "confirmAction",
                        ],
                    },
                ],
            },
            "ChartViewSwitcher": {
                "type": "object",
                "description": "Switches between clinical chart views.",
                "properties": {
                    "component": {"const": "ChartViewSwitcher"},
                    "panes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "paneLabel": {"type": "string"},
                                "paneComponent": {
                                    "$ref": "common_types.json#/$defs/ComponentId"
                                },
                            },
                            "required": ["paneLabel", "paneComponent"],
                        },
                    },
                },
                "required": ["component", "panes"],
            },
        },
        "functions": {
            "isSafeDosage": {
                "type": "object",
                "returnType": "boolean",
                "properties": {
                    "@call": {"const": "isSafeDosage"},
                    "args": {
                        "type": "object",
                        "properties": {"mg": {"type": "number"}},
                        "required": ["mg"],
                    },
                },
                "required": ["@call", "args"],
            },
            "computeBmi": {
                "type": "object",
                "returnType": "number",
                "properties": {
                    "@call": {"const": "computeBmi"},
                    "args": {"type": "object", "properties": {}},
                },
                "required": ["@call", "args"],
            },
        },
    }
    return Catalog.from_json(schema)


def _make_devops_catalog() -> Catalog:
    """Builds a custom DevOps catalog with zero Basic Catalog components."""
    schema: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "catalogId": "https://example.com/catalogs/devops/v1/catalog.json",
        "protocolVersion": "1.0",
        "components": {
            "IncidentTimeline": {
                "type": "object",
                "description": "Repeating timeline of production incidents.",
                "properties": {
                    "component": {"const": "IncidentTimeline"},
                    "events": {"$ref": "common_types.json#/$defs/ChildList"},
                    "severityFilter": {
                        "type": "string",
                        "enum": ["P0", "P1", "P2"],
                    },
                },
                "required": ["component", "events"],
            },
            "ClusterGauge": {
                "type": "object",
                "description": "Displays cluster CPU and tags.",
                "properties": {
                    "component": {"const": "ClusterGauge"},
                    "clusterId": {"$ref": "common_types.json#/$defs/DynamicString"},
                    "cpuUtilization": {
                        "$ref": "common_types.json#/$defs/DynamicNumber"
                    },
                    "isHealthy": {"$ref": "common_types.json#/$defs/DynamicBoolean"},
                    "tags": {"$ref": "common_types.json#/$defs/DynamicStringList"},
                    "metadataPayload": {
                        "$ref": "common_types.json#/$defs/DynamicValue"
                    },
                },
                "required": ["component", "clusterId", "cpuUtilization"],
            },
            "RollbackTrigger": {
                "type": "object",
                "description": "Triggers a deployment rollback.",
                "allOf": [
                    {"$ref": "common_types.json#/$defs/Checkable"},
                    {
                        "type": "object",
                        "properties": {
                            "component": {"const": "RollbackTrigger"},
                            "targetRevision": {
                                "$ref": "common_types.json#/$defs/DynamicString"
                            },
                            "triggerRollback": {
                                "$ref": "common_types.json#/$defs/Action"
                            },
                        },
                        "required": [
                            "component",
                            "targetRevision",
                            "triggerRollback",
                        ],
                    },
                ],
            },
        },
        "functions": {
            "isRevisionDeployed": {
                "type": "object",
                "returnType": "boolean",
                "properties": {
                    "@call": {"const": "isRevisionDeployed"},
                    "args": {
                        "type": "object",
                        "properties": {"revision": {"type": "string"}},
                        "required": ["revision"],
                    },
                },
                "required": ["@call", "args"],
            },
        },
    }
    return Catalog.from_json(schema)


class TestPayloadInspector:
    """Tests for RFC 6901 JSON Pointer extraction and type classification."""

    def test_nested_scalars_booleans_and_empty_dicts(self) -> None:
        payload = {
            "metrics": {
                "cpu": 72.5,
                "cores": 16,
                "throttled": True,
                "healthy": False,
                "host": "prod-us-east-1",
            },
            "emptyConfig": {},
        }
        pointers = inspect_payload_pointers(payload)
        by_path = {p.path: p for p in pointers}

        assert set(by_path) == {
            "/metrics/cpu",
            "/metrics/cores",
            "/metrics/throttled",
            "/metrics/healthy",
            "/metrics/host",
            "/emptyConfig",
        }
        assert by_path["/metrics/cpu"] == PointerSummary(
            path="/metrics/cpu", value_type="number", cardinality=1
        )
        assert by_path["/metrics/cores"] == PointerSummary(
            path="/metrics/cores", value_type="number", cardinality=1
        )
        assert by_path["/metrics/throttled"] == PointerSummary(
            path="/metrics/throttled", value_type="boolean", cardinality=1
        )
        assert by_path["/metrics/healthy"] == PointerSummary(
            path="/metrics/healthy", value_type="boolean", cardinality=1
        )
        assert by_path["/metrics/host"] == PointerSummary(
            path="/metrics/host", value_type="string", cardinality=1
        )
        assert by_path["/emptyConfig"] == PointerSummary(
            path="/emptyConfig", value_type="object", cardinality=0
        )

    def test_array_of_dicts_collects_element_keys_without_recursing(self) -> None:
        payload = {
            "positions": [
                {"ticker": "GOOG", "shares": 100, "hedged": True},
                {"ticker": "AAPL", "shares": 50, "sector": "Tech"},
            ],
        }
        pointers = inspect_payload_pointers(payload)
        assert len(pointers) == 1
        summary = pointers[0]
        assert summary.path == "/positions"
        assert summary.value_type == "array"
        assert summary.cardinality == 2
        assert summary.element_keys == ("ticker", "shares", "hedged", "sector")
        assert summary.sample_type_by_key == {
            "ticker": "string",
            "shares": "number",
            "hedged": "boolean",
            "sector": "string",
        }

    def test_rfc6901_tilde_and_slash_escaping(self) -> None:
        payload = {
            "a/b": {"c~d": "escaped", "normal": 1},
            "rows": [{"service/name": "auth", "latency~ms": 12.5}],
        }
        pointers = inspect_payload_pointers(payload)
        by_path = {p.path: p for p in pointers}
        assert list(by_path) == ["/a~1b/c~0d", "/a~1b/normal", "/rows"]
        assert by_path["/rows"].element_keys == ("service~1name", "latency~0ms")
        assert by_path["/rows"].sample_type_by_key == {
            "service~1name": "string",
            "latency~0ms": "number",
        }
        assert hash(by_path["/rows"]) is not None

    def test_mutable_paths_exact_and_prefix_matching(self) -> None:
        payload = {
            "form": {"ticker": "GOOG", "quantity": 10},
            "format": {"theme": "dark"},
            "directFlag": True,
        }
        pointers = inspect_payload_pointers(
            payload, mutable_paths=["/form", "/directFlag"]
        )
        by_path = {p.path: p for p in pointers}
        assert by_path["/form/ticker"].mutable_hint is True
        assert by_path["/form/quantity"].mutable_hint is True
        assert by_path["/directFlag"].mutable_hint is True
        assert by_path["/format/theme"].mutable_hint is False


class TestCatalogDecisionGraph:
    """Tests for dynamic CatalogDecisionGraph extraction across custom domains."""

    def test_finance_catalog_slots_and_candidates(self) -> None:
        catalog = _make_finance_catalog("1.0")
        graph = CatalogDecisionGraph([catalog])

        assert graph.protocol_version == "v1.0"
        assert (
            graph.surface_catalog_id
            == "https://example.com/catalogs/finance/v1/catalog.json"
        )
        assert [c.name for c in graph.root_candidates()] == [
            "PortfolioGrid",
            "TradeTicket",
            "StrategyComparison",
            "MarginAlertBox",
        ]
        assert [c.name for c in graph.leaf_candidates()] == ["TradeTicket"]
        assert [c.name for c in graph.container_candidates()] == [
            "PortfolioGrid",
            "StrategyComparison",
            "MarginAlertBox",
        ]
        assert [c.name for c in graph.multi_view_switchers()] == ["StrategyComparison"]
        assert graph.checkable_functions() == ("isValidTicker",)

        ticket = graph.get_component("TradeTicket")
        assert ticket is not None
        assert ticket.supports_checks is True
        assert ticket.has_action_slot is True
        assert ticket.is_container is False
        slots_by_name = {s.name: s for s in ticket.slots}
        assert slots_by_name["ticker"].kind == SlotKind.DATA_VALUE
        assert slots_by_name["ticker"].value_type == "string"
        assert slots_by_name["ticker"].required is True
        assert slots_by_name["quantity"].kind == SlotKind.DATA_VALUE
        assert slots_by_name["quantity"].value_type == "number"
        assert slots_by_name["side"].kind == SlotKind.STATIC_ENUM
        assert slots_by_name["side"].enum_values == ("BUY", "SELL")
        assert slots_by_name["onSubmit"].kind == SlotKind.ACTION

        switcher = graph.get_component("StrategyComparison")
        assert switcher is not None
        assert switcher.is_multi_view_switcher is True
        strat_slot = switcher.slots[0]
        assert strat_slot.kind == SlotKind.NAMED_CHILD_ARRAY
        assert strat_slot.child_id_key == "viewId"
        assert strat_slot.label_key == "strategyName"

    def test_healthcare_and_devops_catalogs_and_multi_catalog_mode(self) -> None:
        hc_cat = _make_healthcare_catalog()
        devops_cat = _make_devops_catalog()
        graph = CatalogDecisionGraph([hc_cat, devops_cat])

        assert graph.surface_catalog_id is None
        assert graph.checkable_functions() == (
            "isSafeDosage",
            "isRevisionDeployed",
        )

        vitals = graph.get_component("VitalsMonitor")
        assert vitals is not None
        assert vitals.is_container is False
        assert vitals.has_action_slot is False

        dosage = graph.get_component("DosageOrderPanel")
        assert dosage is not None
        assert dosage.is_container is True
        assert dosage.has_action_slot is True
        assert dosage.supports_checks is True

        gauge = graph.get_component("ClusterGauge")
        assert gauge is not None
        gauge_slots = {s.name: s for s in gauge.slots}
        assert gauge_slots["tags"].kind == SlotKind.DATA_VALUE
        assert gauge_slots["tags"].value_type == "array"
        assert gauge_slots["metadataPayload"].kind == SlotKind.DATA_VALUE
        assert gauge_slots["metadataPayload"].value_type == "any"

        timeline = graph.get_component("IncidentTimeline")
        assert timeline is not None
        timeline_slots = {s.name: s for s in timeline.slots}
        assert timeline_slots["events"].kind == SlotKind.CHILD_LIST
        assert timeline_slots["severityFilter"].kind == SlotKind.STATIC_ENUM
        assert timeline_slots["severityFilter"].enum_values == ("P0", "P1", "P2")

    def test_v09_catalog_support(self) -> None:
        catalog_v09 = _make_finance_catalog("0.9")
        graph = CatalogDecisionGraph([catalog_v09])
        assert graph.protocol_version in ("v0.9", "0.9")
        assert graph.checkable_functions() == ("isValidTicker",)
        assert graph.get_component("NonExistent") is None
