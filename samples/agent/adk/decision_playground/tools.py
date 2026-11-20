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

"""Mock domain tools exposed in `binder` mode and `/tool <alias>` commands."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from a2ui.inference_formats.experimental.decision import ActionSpec


def get_host_health(host: str = "prod-1") -> dict[str, Any]:
    """Retrieves operational metrics for a production host server."""
    return {
        "host": host,
        "cpu": "78%",
        "cpuDelta": "+12%",
        "status": "degraded",
        "uptimeHours": 412,
        # Dummy credential to demonstrate automatic redaction from updateDataModel.
        "apiKey": "sk_demo_" + ("0" * 64),
    }


def get_resort(name: str = "Snowbird") -> dict[str, Any]:
    """Fetches elevation and open trail summary for a mountain ski resort."""
    return {
        "name": name,
        "elevation": "11,000 ft",
        "openRuns": "85 / 140 open",
        "snowDepth": "114 in",
        "status": "Open",
    }


def get_transfer_quote(
    amount: float = 15000.0, recipient: str = "Acme Corp"
) -> dict[str, Any]:
    """Calculates fee and prepares a quote for an outbound bank wire transfer."""
    return {
        "recipient": recipient,
        "amount": f"${amount:,.2f}",
        "fee": "$25.00",
        "sourceAccount": "Checking ...4821",
    }


def get_playback_settings() -> dict[str, Any]:
    """Loads current audio, subtitle, and theme playback settings."""
    return {
        "volume": 80,
        "subtitles": True,
        "theme": "dark",
    }


def get_order_details(order_id: str = "ORD-8492") -> dict[str, Any]:
    """Fetches fulfillment status, carrier details, and total for one order."""
    return {
        "orderId": order_id,
        "status": "Out for delivery",
        "carrier": "Courier Express",
        "estimatedDelivery": "Today by 5:00 PM",
        "totalUsd": "$148.50",
    }


def get_deploy_runbook(service: str = "checkout-api") -> dict[str, Any]:
    """Loads the rollout summary for a backend service."""
    return {
        "service": service,
        "environment": "us-west-2 production",
        "version": "v2.14.0",
        "checklist": "1. Run smoke tests  2. Shift 10% canary  3. Verify p99 latency",
    }


@dataclass(frozen=True)
class SampleToolEntry:
    """Metadata for one sample tool available via `/tool <alias>`."""

    alias: str
    fn: Callable[..., dict[str, Any]]
    intent: str
    actions: tuple[ActionSpec, ...] = ()


SAMPLE_TOOLS: tuple[SampleToolEntry, ...] = (
    SampleToolEntry(
        alias="host",
        fn=get_host_health,
        intent="Show production host health metrics",
        actions=(ActionSpec(id="restart_host", label="Restart Host"),),
    ),
    SampleToolEntry(
        alias="resort",
        fn=get_resort,
        intent="Show ski resort conditions and snow report",
    ),
    SampleToolEntry(
        alias="transfer",
        fn=get_transfer_quote,
        intent="Review and confirm wire transfer quote",
        actions=(
            ActionSpec(id="confirm_transfer", label="Confirm Transfer"),
            ActionSpec(id="cancel_transfer", label="Cancel"),
        ),
    ),
    SampleToolEntry(
        alias="settings",
        fn=get_playback_settings,
        intent="Edit audio and playback settings",
        actions=(ActionSpec(id="save_settings", label="Save Settings"),),
    ),
    SampleToolEntry(
        alias="order",
        fn=get_order_details,
        intent="Inspect order delivery status and carrier",
    ),
    SampleToolEntry(
        alias="runbook",
        fn=get_deploy_runbook,
        intent="Show production deployment runbook",
        actions=(ActionSpec(id="start_rollout", label="Start Canary Rollout"),),
    ),
)

TOOL_BY_ALIAS: dict[str, SampleToolEntry] = {t.alias: t for t in SAMPLE_TOOLS}
TOOL_BY_NAME: dict[str, SampleToolEntry] = {t.fn.__name__: t for t in SAMPLE_TOOLS}
TOOL_ALIASES: tuple[str, ...] = tuple(t.alias for t in SAMPLE_TOOLS)
TOOL_NAMES: tuple[str, ...] = tuple(t.fn.__name__ for t in SAMPLE_TOOLS)
TOOL_FUNCTIONS: tuple[Callable[..., dict[str, Any]], ...] = tuple(
    t.fn for t in SAMPLE_TOOLS
)
