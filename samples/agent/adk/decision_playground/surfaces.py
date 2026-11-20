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
from typing import Any

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.experimental.decision import ExpressSurfaceSpec
from a2ui.rpc.experimental.decision import NamedPredicateSpec

RPC_PREDICATE_CATALOG_ID = "https://a2ui.org/samples/decision_playground/rpc/v1"

EXPRESS_TEMPLATES: tuple[ExpressSurfaceSpec, ...] = (
    ExpressSurfaceSpec(
        id="host_health",
        description="Production host health metrics card with CPU, status, and uptime",
        dsl=(
            "root = Card(Column(["
            'Text("### Host Health"), '
            "Text($/host), "
            "Row([Text($/status), Text($/cpu), Text($/cpuDelta)]), "
            "Text($/uptimeHours)"
            "]))"
        ),
        required_paths=("/host", "/cpu", "/status"),
    ),
    ExpressSurfaceSpec(
        id="ski_resort",
        description="Mountain ski resort snow report with elevation and open runs",
        dsl=(
            "root = Card(Column(["
            'Text("### Ski Resort Report"), '
            "Text($/name), "
            "Row([Text($/elevation), Text($/openRuns)]), "
            "Row([Text($/snowDepth), Text($/status)])"
            "]))"
        ),
        required_paths=("/name", "/elevation"),
    ),
    ExpressSurfaceSpec(
        id="transfer_quote",
        description="Outbound wire transfer quote and confirmation summary",
        dsl=(
            "root = Card(Column(["
            'Text("### Wire Transfer Quote"), '
            "Text($/recipient), "
            "Row([Text($/amount), Text($/fee)]), "
            "Text($/sourceAccount)"
            "]))"
        ),
        required_paths=("/recipient", "/amount"),
    ),
    ExpressSurfaceSpec(
        id="playback_settings",
        description="Audio, subtitle, and theme playback settings panel",
        dsl=(
            "root = Card(Column(["
            'Text("### Playback Settings"), '
            "Text($/theme), "
            'Slider("Volume", 0, 100, $/volume), '
            'CheckBox("Subtitles", $/subtitles)'
            "]))"
        ),
        required_paths=("/volume", "/subtitles"),
    ),
    ExpressSurfaceSpec(
        id="order_details",
        description="Order fulfillment status, carrier, and delivery estimate",
        dsl=(
            "root = Card(Column(["
            'Text("### Order Status"), '
            "Row([Text($/orderId), Text($/status)]), "
            "Text($/carrier), "
            "Row([Text($/estimatedDelivery), Text($/totalUsd)])"
            "]))"
        ),
        required_paths=("/orderId", "/status"),
    ),
    ExpressSurfaceSpec(
        id="deploy_runbook",
        description="Production service rollout checklist and deployment runbook",
        dsl=(
            "root = Card(Column(["
            'Text("### Deployment Runbook"), '
            "Row([Text($/service), Text($/version)]), "
            "Text($/environment), "
            "Text($/checklist)"
            "]))"
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
                "Is this product feedback constructive and free of abusive or"
                " profane language?"
            ),
            max_input_length=500,
            timeout_seconds=10.0,
        ),
        failure_message="Please keep feedback constructive and respectful.",
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
