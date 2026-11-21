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

"""Shared Express templates, RPC predicate specs, and v1.0 form surfaces."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from a2ui.builder.v1_0 import Action, Button, Card, Column, Divider, DynamicString, Icon, Row, Text
from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.experimental.decision import ExpressSurfaceSpec
from a2ui.inference_formats.experimental.decision_gated_templates import (
    GATE_EXTENSION_KEY,
    VARIANT_EXTENSION_KEY,
    GatedTemplateSpec,
)
from a2ui.inference_formats.experimental.decision_prose_upgrade import (
    FieldType,
    ProseTemplateSpec,
    TypedFieldSpec,
)
from a2ui.rpc.experimental.decision import NamedPredicateSpec
from a2ui.transformers.macros import macro

RPC_PREDICATE_CATALOG_ID = "https://a2ui.org/samples/decision_playground/rpc/v1"

EXPRESS_TEMPLATES: tuple[ExpressSurfaceSpec, ...] = (
    ExpressSurfaceSpec(
        id="host_health",
        description="Production host health metrics card with CPU, status, and uptime",
        dsl=(
            'root = Card(Column([Row([Icon("warning"), Text("### Host Health"),'
            ' Text($/status, variant="caption")], justify="spaceBetween"), Divider(),'
            ' Row([Column([Text("Host", variant="caption"), Text($/host)]),'
            ' Column([Text("CPU", variant="caption"), Row([Text($/cpu),'
            ' Text($/cpuDelta, variant="caption")])]), Column([Text("Uptime (hrs)",'
            ' variant="caption"), Text($/uptimeHours)])], justify="spaceBetween"),'
            ' Divider(), Row([Button(Text("Restart Host"), variant="primary",'
            ' action={event: {name: "restart_host"}})], justify="end")]))'
        ),
        required_paths=("/host", "/cpu", "/status"),
    ),
    ExpressSurfaceSpec(
        id="ski_resort",
        description="Mountain ski resort snow report with elevation and open runs",
        dsl=(
            'root = Card(Column([Row([Icon("locationOn"), Column([Text("### Ski Resort'
            ' Report"), Text($/name)])]), Divider(),'
            ' Row([Card(Column([Text("Elevation", variant="caption"),'
            ' Text($/elevation), Text("Open Runs", variant="caption"),'
            ' Text($/openRuns)])), Card(Column([Text("Snow Depth", variant="caption"),'
            ' Text($/snowDepth), Text("Status", variant="caption"),'
            " Text($/status)]))])]))"
        ),
        required_paths=("/name", "/elevation"),
    ),
    ExpressSurfaceSpec(
        id="transfer_quote",
        description="Outbound wire transfer quote and confirmation summary",
        dsl=(
            'root = Card(Column([Row([Icon("payment"), Text("### Review Wire'
            ' Transfer")]), Text("Verify the details below before authorizing this'
            ' transfer.", variant="caption"), Divider(), Row([Text("Recipient",'
            ' variant="caption"), Text($/recipient)], justify="spaceBetween"),'
            ' Row([Text("Amount", variant="caption"), Text($/amount)],'
            ' justify="spaceBetween"), Row([Text("Wire Fee", variant="caption"),'
            ' Text($/fee)], justify="spaceBetween"), Row([Text("Source Account",'
            ' variant="caption"), Text($/sourceAccount)], justify="spaceBetween"),'
            ' Divider(), Row([Button(Text("Cancel"), variant="borderless",'
            ' action={event: {name: "cancel_transfer"}}), Button(Text("Confirm'
            ' Transfer"), variant="primary", action={event: {name:'
            ' "confirm_transfer"}})], justify="end")]))'
        ),
        required_paths=("/recipient", "/amount"),
    ),
    ExpressSurfaceSpec(
        id="playback_settings",
        description="Audio, subtitle, and theme playback settings panel",
        dsl=(
            'root = Card(Column([Row([Icon("settings"), Text("### Playback'
            ' Settings")]), Divider(), Row([Text("Theme", variant="caption"),'
            ' Text($/theme)], justify="spaceBetween"), Slider("Volume", 0, 100,'
            ' $/volume), CheckBox("Subtitles", $/subtitles), Divider(),'
            ' Row([Button(Text("Save Preferences"), variant="primary", action={event:'
            ' {name: "save_settings"}})], justify="end")]))'
        ),
        required_paths=("/volume", "/subtitles"),
    ),
    ExpressSurfaceSpec(
        id="order_details",
        description="Order fulfillment status, carrier, and delivery estimate",
        dsl=(
            'root = Card(Column([Row([Row([Icon("shoppingCart"), Text("### Order'
            ' Status")]), Text($/orderId, variant="caption")], justify="spaceBetween"),'
            ' Divider(), Row([Column([Text("Status", variant="caption"),'
            ' Text($/status)]), Column([Text("Estimated Delivery", variant="caption"),'
            ' Text($/estimatedDelivery)])], justify="spaceBetween"),'
            ' Row([Text("Carrier", variant="caption"), Text($/carrier)],'
            ' justify="spaceBetween"), Divider(), Row([Row([Text("Total",'
            ' variant="caption"), Text($/totalUsd)]), Button(Text("Track Package"),'
            ' variant="primary", action={event: {name: "track_order"}})],'
            ' justify="spaceBetween")]))'
        ),
        required_paths=("/orderId", "/status"),
    ),
    ExpressSurfaceSpec(
        id="deploy_runbook",
        description="Production service rollout checklist and deployment runbook",
        dsl=(
            'root = Card(Column([Row([Icon("check"), Text("### Deployment'
            ' Runbook")]), Row([Text($/service), Text($/version, variant="caption"),'
            ' Text($/environment, variant="caption")], justify="spaceBetween"),'
            ' Divider(), Text("Rollout Checklist", variant="caption"),'
            " Text($/checklist)]))"
        ),
        required_paths=("/service", "/checklist"),
    ),
)


@dataclass(frozen=True)
class RpcFormSpec:
    """One interactive v1.0 form backed by a submit-time decision predicate."""

    alias: str
    title: str
    field_label: str
    placeholder_value: str
    predicate: NamedPredicateSpec
    failure_message: str


RPC_FORMS: tuple[RpcFormSpec, ...] = (
    RpcFormSpec(
        alias="bug",
        title="Bug Report (Submit-Time Decision Validation)",
        field_label="Steps to reproduce",
        placeholder_value="1. Open settings 2. Click Save -> 500 error",
        predicate=NamedPredicateSpec(
            name="is_specific_bug_report",
            question_prompt=(
                "Does this bug report include concrete reproduction steps or an"
                " observable error rather than a vague complaint?"
            ),
            max_input_length=500,
            timeout_seconds=10.0,
        ),
        failure_message="Please include concrete steps to reproduce the bug.",
    ),
    RpcFormSpec(
        alias="feedback",
        title="Product Feedback (Politeness Gate)",
        field_label="Your feedback",
        placeholder_value="The split-screen inspector makes debugging much faster.",
        predicate=NamedPredicateSpec(
            name="is_polite_feedback",
            question_prompt=(
                "Is this text relevant, professional, and constructive product"
                " feedback (free of profanity, abuse, or crude/off-topic"
                " remarks)?"
            ),
            max_input_length=500,
            timeout_seconds=10.0,
        ),
        failure_message=(
            "Please keep feedback on-topic, constructive, and professional."
        ),
    ),
    RpcFormSpec(
        alias="refund",
        title="Refund Request (Eligibility Check)",
        field_label="Reason for refund",
        placeholder_value="Item arrived damaged with a cracked screen on delivery.",
        predicate=NamedPredicateSpec(
            name="is_valid_refund_reason",
            question_prompt=(
                "Does this text describe a concrete order issue such as damage,"
                " wrong item, or non-delivery?"
            ),
            max_input_length=500,
            timeout_seconds=10.0,
        ),
        failure_message="Please describe the specific issue with your order.",
    ),
)

RPC_FORM_BY_ALIAS: dict[str, RpcFormSpec] = {f.alias: f for f in RPC_FORMS}
RPC_FORM_ALIASES: tuple[str, ...] = tuple(f.alias for f in RPC_FORMS)
RPC_PREDICATE_SPECS: tuple[NamedPredicateSpec, ...] = tuple(
    f.predicate for f in RPC_FORMS
)


def build_rpc_form_messages(
    form: RpcFormSpec, *, surface_id: str = "main"
) -> list[dict[str, Any]]:
    """Builds v1.0 wire messages for a form validated by `callAgentFunction`."""
    basic_cid = BasicCatalog("v1.0").catalog_id
    return [
        {
            "version": "1.0",
            "createSurface": {
                "surfaceId": surface_id,
                "catalogId": basic_cid,
            },
        },
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": surface_id,
                "components": [
                    {
                        "id": "root",
                        "component": "Card",
                        "child": "form_col",
                    },
                    {
                        "id": "form_col",
                        "component": "Column",
                        "children": [
                            "title_text",
                            "note_input",
                            "submit_btn",
                        ],
                    },
                    {
                        "id": "title_text",
                        "component": "Text",
                        "text": f"### {form.title}",
                    },
                    {
                        "id": "note_input",
                        "component": "TextField",
                        "label": form.field_label,
                        "value": {"@path": "/note"},
                        "@checks": [{
                            "condition": {
                                "@call": form.predicate.name,
                                "catalogId": RPC_PREDICATE_CATALOG_ID,
                                "args": {"value": {"@path": "/note"}},
                            },
                            "message": form.failure_message,
                        }],
                    },
                    {
                        "id": "submit_btn",
                        "component": "Button",
                        "child": "submit_label",
                        "variant": "primary",
                        "action": {
                            "event": {
                                "name": f"submit_{form.alias}",
                                "context": {"note": {"@path": "/note"}},
                            }
                        },
                    },
                    {
                        "id": "submit_label",
                        "component": "Text",
                        "text": "Validate & Submit",
                    },
                ],
            },
        },
        {
            "version": "1.0",
            "updateDataModel": {
                "surfaceId": surface_id,
                "path": "/",
                "value": {"note": form.placeholder_value},
            },
        },
    ]


def build_status_card_messages(surface_id: str, markdown: str) -> list[dict[str, Any]]:
    """Builds a minimal A2UI v1.0 card displaying status or help markdown."""
    basic_cid = BasicCatalog("v1.0").catalog_id
    return [
        {
            "version": "1.0",
            "createSurface": {
                "surfaceId": surface_id,
                "catalogId": basic_cid,
            },
        },
        {
            "version": "1.0",
            "updateComponents": {
                "surfaceId": surface_id,
                "components": [
                    {"id": "root", "component": "Card", "child": "status_text"},
                    {"id": "status_text", "component": "Text", "text": markdown},
                ],
            },
        },
    ]


@macro()
def IncidentAlertCard(
    title: DynamicString,
    summary: DynamicString,
    service: str,
    affected_hosts: int,
    severity: Literal["info", "warning", "critical"] = "info",
    page_oncall: bool = False,
    on_ack: Action | None = None,
) -> Card:
    """Renders a production incident alert card with severity, host count, and paging status."""
    paging_label = "Paging on-call" if page_oncall else "No page required"
    children: list[Any] = [
        Row(
            children=[
                Icon(name="warning"),
                Text(text=title),
                Text(text=f"[{severity.upper()}]", variant="caption"),
            ],
            justify="spaceBetween",
        ),
        Divider(),
        Text(text=summary),
        Row(
            children=[
                Column(children=[Text(text="Service", variant="caption"), Text(text=service)]),
                Column(
                    children=[
                        Text(text="Affected Hosts", variant="caption"),
                        Text(text=str(affected_hosts)),
                    ]
                ),
                Column(
                    children=[
                        Text(text="Escalation", variant="caption"),
                        Text(text=paging_label),
                    ]
                ),
            ],
            justify="spaceBetween",
        ),
    ]
    if on_ack is not None:
        children.extend([
            Divider(),
            Row(
                children=[
                    Button(
                        child=Text(text="Acknowledge Incident"),
                        variant="primary",
                        action=on_ack,
                    )
                ],
                justify="end",
            ),
        ])
    return Card(child=Column(children=children))


PLAYGROUND_MACROS: tuple[Any, ...] = (IncidentAlertCard,)


@dataclass(frozen=True)
class GatedPresetSpec:
    """One interactive payload preset for `gated` mode."""

    alias: str
    template_id: str
    intent: str
    payload: dict[str, Any]


_BASIC_V1_ID = BasicCatalog("v1.0").catalog_id

GATED_TEMPLATES: tuple[GatedTemplateSpec, ...] = (
    GatedTemplateSpec(
        id="service_incident_gated",
        description=(
            "Service health dashboard with optional rollback alert, postmortem"
            " link, and compact vs detailed metrics layout."
        ),
        catalog_id=_BASIC_V1_ID,
        required_paths=("/service", "/status"),
        components=(
            {"id": "root", "component": "Card", "child": "main_col"},
            {
                "id": "main_col",
                "component": "Column",
                "children": [
                    "header_row",
                    "top_div",
                    "rollback_alert",
                    "metrics_compact",
                    "metrics_detailed",
                    "postmortem_card",
                ],
            },
            {
                "id": "header_row",
                "component": "Row",
                "justify": "spaceBetween",
                "children": ["header_left", "status_badge"],
            },
            {
                "id": "header_left",
                "component": "Row",
                "children": ["header_icon", "header_title"],
            },
            {"id": "header_icon", "component": "Icon", "name": "warning"},
            {"id": "header_title", "component": "Text", "text": {"@path": "/service"}},
            {
                "id": "status_badge",
                "component": "Text",
                "text": {"@path": "/status"},
                "variant": "caption",
            },
            {"id": "top_div", "component": "Divider"},
            {
                "id": "rollback_alert",
                "component": "Card",
                "child": "rollback_col",
                "@metadata": {
                    "extensions": {
                        GATE_EXTENSION_KEY: {
                            "condition": (
                                "Show the rollback alert banner when the service is"
                                " degraded, critical, or experiencing elevated errors."
                            ),
                            "threshold": 0.5,
                        }
                    }
                },
            },
            {
                "id": "rollback_col",
                "component": "Column",
                "children": ["rollback_title", "rollback_btn"],
            },
            {
                "id": "rollback_title",
                "component": "Text",
                "text": "Active degradation detected. Roll back to the previous release.",
            },
            {
                "id": "rollback_btn",
                "component": "Button",
                "child": "rollback_btn_label",
                "variant": "primary",
                "action": {"event": {"name": "trigger_rollback"}},
            },
            {
                "id": "rollback_btn_label",
                "component": "Text",
                "text": "Start Rollback",
            },
            {
                "id": "metrics_compact",
                "component": "Row",
                "justify": "spaceBetween",
                "children": ["compact_cpu", "compact_err"],
                "@metadata": {
                    "extensions": {
                        VARIANT_EXTENSION_KEY: {
                            "group": "metrics_layout",
                            "name": "compact",
                            "description": (
                                "Single-row compact metrics when the service is healthy"
                                " and routine."
                            ),
                            "prompt": (
                                "Choose compact or detailed metrics layout for this"
                                " service status."
                            ),
                        }
                    }
                },
            },
            {"id": "compact_cpu", "component": "Text", "text": {"@path": "/cpu"}},
            {"id": "compact_err", "component": "Text", "text": {"@path": "/errorRate"}},
            {
                "id": "metrics_detailed",
                "component": "Column",
                "children": ["detail_cpu_row", "detail_err_row", "detail_region_row"],
                "@metadata": {
                    "extensions": {
                        VARIANT_EXTENSION_KEY: {
                            "group": "metrics_layout",
                            "name": "detailed",
                            "description": (
                                "Expanded multi-row telemetry breakdown when the"
                                " service is degraded or under investigation."
                            ),
                        }
                    }
                },
            },
            {
                "id": "detail_cpu_row",
                "component": "Row",
                "justify": "spaceBetween",
                "children": ["detail_cpu_lbl", "detail_cpu_val"],
            },
            {"id": "detail_cpu_lbl", "component": "Text", "text": "CPU Utilization", "variant": "caption"},
            {"id": "detail_cpu_val", "component": "Text", "text": {"@path": "/cpu"}},
            {
                "id": "detail_err_row",
                "component": "Row",
                "justify": "spaceBetween",
                "children": ["detail_err_lbl", "detail_err_val"],
            },
            {"id": "detail_err_lbl", "component": "Text", "text": "5xx Error Rate", "variant": "caption"},
            {"id": "detail_err_val", "component": "Text", "text": {"@path": "/errorRate"}},
            {
                "id": "detail_region_row",
                "component": "Row",
                "justify": "spaceBetween",
                "children": ["detail_region_lbl", "detail_region_val"],
            },
            {"id": "detail_region_lbl", "component": "Text", "text": "Region", "variant": "caption"},
            {"id": "detail_region_val", "component": "Text", "text": {"@path": "/region"}},
            {
                "id": "postmortem_card",
                "component": "Card",
                "child": "postmortem_text",
                "@metadata": {
                    "extensions": {
                        GATE_EXTENSION_KEY: {
                            "condition": (
                                "Show the postmortem notes card when the payload"
                                " includes a postmortem summary or resolved incident"
                                " notes."
                            ),
                            "threshold": 0.5,
                        }
                    }
                },
            },
            {
                "id": "postmortem_text",
                "component": "Text",
                "text": {"@path": "/postmortemNote"},
            },
        ),
    ),
    GatedTemplateSpec(
        id="order_status_gated",
        description=(
            "Order fulfillment card with optional delay warning, refund action,"
            " and in-transit vs delivered layout."
        ),
        catalog_id=_BASIC_V1_ID,
        required_paths=("/orderId", "/status"),
        components=(
            {"id": "root", "component": "Card", "child": "order_col"},
            {
                "id": "order_col",
                "component": "Column",
                "children": [
                    "order_header",
                    "order_div",
                    "delay_warning",
                    "delivery_in_transit",
                    "delivery_delivered",
                    "refund_action_row",
                ],
            },
            {
                "id": "order_header",
                "component": "Row",
                "justify": "spaceBetween",
                "children": ["order_title", "order_id_text"],
            },
            {"id": "order_title", "component": "Text", "text": "### Order Fulfillment"},
            {"id": "order_id_text", "component": "Text", "text": {"@path": "/orderId"}, "variant": "caption"},
            {"id": "order_div", "component": "Divider"},
            {
                "id": "delay_warning",
                "component": "Card",
                "child": "delay_text",
                "@metadata": {
                    "extensions": {
                        GATE_EXTENSION_KEY: {
                            "condition": (
                                "Show the shipping delay warning when the order is"
                                " delayed, late, or held in transit."
                            ),
                            "threshold": 0.5,
                        }
                    }
                },
            },
            {"id": "delay_text", "component": "Text", "text": {"@path": "/delayReason"}},
            {
                "id": "delivery_in_transit",
                "component": "Row",
                "justify": "spaceBetween",
                "children": ["transit_lbl", "transit_eta"],
                "@metadata": {
                    "extensions": {
                        VARIANT_EXTENSION_KEY: {
                            "group": "delivery_view",
                            "name": "in_transit",
                            "description": "ETA view when the package has not arrived yet.",
                            "prompt": "Is this order still in transit or already delivered?",
                        }
                    }
                },
            },
            {"id": "transit_lbl", "component": "Text", "text": "Estimated Arrival", "variant": "caption"},
            {"id": "transit_eta", "component": "Text", "text": {"@path": "/eta"}},
            {
                "id": "delivery_delivered",
                "component": "Row",
                "justify": "spaceBetween",
                "children": ["delivered_lbl", "delivered_at"],
                "@metadata": {
                    "extensions": {
                        VARIANT_EXTENSION_KEY: {
                            "group": "delivery_view",
                            "name": "delivered",
                            "description": "Completed delivery confirmation view.",
                        }
                    }
                },
            },
            {"id": "delivered_lbl", "component": "Text", "text": "Delivered", "variant": "caption"},
            {"id": "delivered_at", "component": "Text", "text": {"@path": "/deliveredAt"}},
            {
                "id": "refund_action_row",
                "component": "Row",
                "justify": "end",
                "children": ["refund_btn"],
                "@metadata": {
                    "extensions": {
                        GATE_EXTENSION_KEY: {
                            "condition": (
                                "Show the request-refund button when the order is"
                                " delayed or damaged."
                            ),
                            "threshold": 0.5,
                        }
                    }
                },
            },
            {
                "id": "refund_btn",
                "component": "Button",
                "child": "refund_btn_lbl",
                "variant": "primary",
                "action": {"event": {"name": "request_refund"}},
            },
            {"id": "refund_btn_lbl", "component": "Text", "text": "Request Refund"},
        ),
    ),
)

GATED_PRESETS: tuple[GatedPresetSpec, ...] = (
    GatedPresetSpec(
        alias="incident_degraded",
        template_id="service_incident_gated",
        intent="Show degraded service incident requiring detailed metrics and rollback",
        payload={
            "service": "checkout-api",
            "status": "degraded",
            "cpu": "94%",
            "errorRate": "7.8%",
            "region": "us-west-2",
            "postmortemNote": "",
        },
    ),
    GatedPresetSpec(
        alias="incident_healthy",
        template_id="service_incident_gated",
        intent="Show healthy routine service status with compact metrics",
        payload={
            "service": "checkout-api",
            "status": "healthy",
            "cpu": "22%",
            "errorRate": "0.01%",
            "region": "us-west-2",
            "postmortemNote": "Postmortem #412 published: connection pool limit raised.",
        },
    ),
    GatedPresetSpec(
        alias="order_delayed",
        template_id="order_status_gated",
        intent="Show delayed in-transit order with refund option",
        payload={
            "orderId": "ORD-9104",
            "status": "delayed in transit",
            "eta": "Delayed until Thursday",
            "deliveredAt": "",
            "delayReason": "Weather delay at Memphis hub (+48 hours).",
        },
    ),
    GatedPresetSpec(
        alias="order_delivered",
        template_id="order_status_gated",
        intent="Show completed delivered order confirmation",
        payload={
            "orderId": "ORD-9104",
            "status": "delivered",
            "eta": "",
            "deliveredAt": "Left at front porch at 2:14 PM",
            "delayReason": "",
        },
    ),
)

GATED_PRESET_BY_ALIAS: dict[str, GatedPresetSpec] = {p.alias: p for p in GATED_PRESETS}
GATED_PRESET_ALIASES: tuple[str, ...] = tuple(p.alias for p in GATED_PRESETS)

_EXPRESS_BY_ID = {spec.id: spec for spec in EXPRESS_TEMPLATES}

PROSE_TEMPLATES: tuple[ProseTemplateSpec, ...] = (
    ProseTemplateSpec(
        id="order_details",
        description="Order fulfillment status, carrier, and delivery estimate",
        surface=_EXPRESS_BY_ID["order_details"],
        fields=(
            TypedFieldSpec("/orderId", FieldType.TEXT, "Order identifier (e.g. ORD-8492)"),
            TypedFieldSpec("/status", FieldType.TEXT, "Current shipping or delivery status"),
            TypedFieldSpec("/carrier", FieldType.TEXT, "Shipping carrier name", required=False),
            TypedFieldSpec(
                "/estimatedDelivery",
                FieldType.TEXT,
                "Estimated delivery date or window",
                required=False,
            ),
            TypedFieldSpec(
                "/totalUsd",
                FieldType.TEXT,
                "Total order amount including currency symbol (e.g. $148.50)",
                required=False,
            ),
        ),
    ),
    ProseTemplateSpec(
        id="host_health",
        description="Production host health metrics with hostname, CPU, status, and uptime",
        surface=_EXPRESS_BY_ID["host_health"],
        fields=(
            TypedFieldSpec("/host", FieldType.TEXT, "Server hostname"),
            TypedFieldSpec("/cpu", FieldType.TEXT, "CPU utilization percentage"),
            TypedFieldSpec("/status", FieldType.TEXT, "Operational health status"),
            TypedFieldSpec("/cpuDelta", FieldType.TEXT, "CPU delta change", required=False),
            TypedFieldSpec(
                "/uptimeHours", FieldType.NUMBER, "Uptime in hours", required=False
            ),
        ),
    ),
    ProseTemplateSpec(
        id="ski_resort",
        description="Mountain ski resort snow report with elevation, snow depth, and open runs",
        surface=_EXPRESS_BY_ID["ski_resort"],
        fields=(
            TypedFieldSpec("/name", FieldType.TEXT, "Ski resort name"),
            TypedFieldSpec("/elevation", FieldType.TEXT, "Summit or base elevation"),
            TypedFieldSpec("/openRuns", FieldType.TEXT, "Count of open runs", required=False),
            TypedFieldSpec("/snowDepth", FieldType.TEXT, "Snow depth measurement", required=False),
            TypedFieldSpec("/status", FieldType.TEXT, "Operating status", required=False),
        ),
    ),
)


@dataclass(frozen=True)
class ProsePresetSpec:
    """One plain-prose example preset for `prose` mode."""

    alias: str
    prose: str
    mock_values: dict[str, Any]


PROSE_PRESETS: tuple[ProsePresetSpec, ...] = (
    ProsePresetSpec(
        alias="order",
        prose=(
            "Your order ORD-8492 ($148.50) is currently Out for delivery via"
            " Courier Express and should arrive Today by 5:00 PM."
        ),
        mock_values={
            "/orderId": "ORD-8492",
            "/status": "Out for delivery",
            "/carrier": "Courier Express",
            "/estimatedDelivery": "Today by 5:00 PM",
            "/totalUsd": "$148.50",
        },
    ),
    ProsePresetSpec(
        alias="host",
        prose=(
            "Production server prod-web-04 is currently degraded at 87% CPU"
            " (+12%) after 412 hours of uptime."
        ),
        mock_values={
            "/host": "prod-web-04",
            "/cpu": "87%",
            "/cpuDelta": "+12%",
            "/status": "degraded",
            "/uptimeHours": 412,
        },
    ),
    ProsePresetSpec(
        alias="resort",
        prose=(
            "Snowbird is currently Open with a summit elevation of 11,000 ft,"
            " 114 in of snow depth, and 85 / 140 runs open today."
        ),
        mock_values={
            "/name": "Snowbird",
            "/elevation": "11,000 ft",
            "/openRuns": "85 / 140",
            "/snowDepth": "114 in",
            "/status": "Open",
        },
    ),
    ProsePresetSpec(
        alias="unstructured",
        prose=(
            "When debugging high CPU on Linux servers, start with top or perf to"
            " see whether user-space threads or kernel I/O dominate."
        ),
        mock_values={},
    ),
)

PROSE_PRESET_BY_ALIAS: dict[str, ProsePresetSpec] = {p.alias: p for p in PROSE_PRESETS}
PROSE_PRESET_ALIASES: tuple[str, ...] = tuple(p.alias for p in PROSE_PRESETS)
