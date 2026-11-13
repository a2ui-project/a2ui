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

"""Tools exposed to the language model in playground tool mode."""

from __future__ import annotations

from typing import Any, Callable

from a2ui.inference_formats.decision import ActionSpec, ActionStyle


def get_host_health(host: str = "prod-1") -> dict[str, Any]:
    """Retrieves operational and health metrics for a production host server.

    Args:
        host: Host identifier to inspect.

    Returns:
        A dictionary containing host name, CPU utilization, CPU delta, status,
        and uptime hours.
    """
    return {
        "host": host,
        "cpu": 0.78,
        "cpuDelta": 0.12,
        "status": "degraded",
        "uptimeHours": 412,
    }


def get_resort(name: str = "Snowbird") -> dict[str, Any]:
    """Fetches details, elevation, and open trail information for mountain ski resorts.

    Args:
        name: Primary resort name to include in the returned collection.

    Returns:
        A dictionary containing a `resorts` list of resort summary objects.
    """
    return {
        "resorts": [
            {"name": name, "elevation": 11000, "openRuns": 85},
            {"name": "Alta", "elevation": 10500, "openRuns": 70},
        ]
    }


def get_transfer_quote(
    amount: float = 15000.0, recipient: str = "Acme Corp"
) -> dict[str, Any]:
    """Calculates fee and prepares a quote for an outbound bank wire transfer.

    Args:
        amount: Transfer amount in US dollars.
        recipient: Beneficiary name for the wire transfer.

    Returns:
        A dictionary with recipient, amount, fee, and source account details.
    """
    return {
        "recipient": recipient,
        "amount": amount,
        "fee": 25.0,
        "sourceAccount": "Checking ...4821",
    }


def get_playback_settings() -> dict[str, Any]:
    """Loads current audio, subtitle, and user interface playback settings.

    Returns:
        A dictionary containing volume, subtitles flag, and theme name.
    """
    return {
        "volume": 80,
        "subtitles": True,
        "theme": "dark",
    }


def get_order_details(order_id: str = "ORD-8492") -> dict[str, Any]:
    """Fetches fulfillment status, carrier details, and totals for one order.

    Args:
        order_id: Order identifier to look up.

    Returns:
        A dictionary containing fulfillment status, carrier, estimated delivery,
        shipping address, and total in USD.
    """
    return {
        "orderId": order_id,
        "status": "Out for delivery",
        "carrier": "Courier Express",
        "estimatedDelivery": "Today by 5:00 PM",
        "shippingAddress": "742 Evergreen Terrace, Seattle, WA",
        "totalUsd": 148.50,
    }


def get_deploy_runbook(service: str = "checkout-api") -> dict[str, Any]:
    """Loads the ordered production rollout checklist for a backend service.

    Args:
        service: Service name being deployed.

    Returns:
        A dictionary containing service name, target environment, and ordered
        deployment steps.
    """
    return {
        "service": service,
        "environment": "us-central1-prod",
        "steps": [
            {
                "title": "Drain canary instance pool",
                "detail": "Shift 5% traffic away from canary-a and wait 60s.",
            },
            {
                "title": "Roll image tag v2.18.4",
                "detail": "Apply deployment manifest and verify readiness probes.",
            },
            {
                "title": "Check error budget burn",
                "detail": "Confirm 5xx rate stays under 0.1% for 10 minutes.",
            },
            {
                "title": "Promote to full fleet",
                "detail": "Ramp remaining 95% of pods across zones.",
            },
        ],
    }


_HOST_SNAPSHOTS: tuple[tuple[str, float, float, str, int], ...] = (
    ("prod-1", 0.78, 0.12, "degraded", 412),
    ("prod-2", 0.41, -0.18, "healthy", 618),
    ("prod-3", 0.91, 0.24, "critical", 129),
)


TOOL_INTENTS: dict[str, str] = {
    "get_host_health": "Show CPU utilization and host health",
    "get_resort": "Browse mountain ski resort details",
    "get_transfer_quote": "Review wire transfer quote",
    "get_playback_settings": "Adjust audio playback and notification preferences",
    "get_order_details": "Inspect single order delivery details",
    "get_deploy_runbook": "Follow step-by-step production deployment runbook",
}

TOOL_MUTABLE_PATHS: dict[str, tuple[str, ...]] = {
    "get_host_health": (),
    "get_resort": (),
    "get_transfer_quote": (),
    "get_playback_settings": ("/volume", "/subtitles", "/theme"),
    "get_order_details": (),
    "get_deploy_runbook": (),
}

TOOL_ACTIONS: dict[str, tuple[ActionSpec, ...]] = {
    "get_host_health": (),
    "get_resort": (),
    "get_transfer_quote": (
        ActionSpec(id="confirm_transfer", label="Confirm Transfer"),
        ActionSpec(id="cancel_transfer", label="Cancel"),
    ),
    "get_playback_settings": (
        ActionSpec(id="save_settings", label="Save", style=ActionStyle.PRIMARY),
        ActionSpec(id="discard_settings", label="Cancel"),
    ),
    "get_order_details": (ActionSpec(id="track_shipment", label="Track Shipment"),),
    "get_deploy_runbook": (),
}
"""The buttons each tool's surface offers; their ids are the events the agent gets."""

TOOLS: list[Callable[..., Any]] = [
    get_host_health,
    get_resort,
    get_transfer_quote,
    get_playback_settings,
    get_order_details,
    get_deploy_runbook,
]

_TOOL_ALIASES: dict[str, Callable[..., Any]] = {
    "host": get_host_health,
    "get_host_health": get_host_health,
    "resort": get_resort,
    "get_resort": get_resort,
    "transfer": get_transfer_quote,
    "get_transfer_quote": get_transfer_quote,
    "settings": get_playback_settings,
    "get_playback_settings": get_playback_settings,
    "order": get_order_details,
    "get_order_details": get_order_details,
    "runbook": get_deploy_runbook,
    "deploy": get_deploy_runbook,
    "get_deploy_runbook": get_deploy_runbook,
}

EXAMPLE_TOOL_NAMES: tuple[str, ...] = (
    "host",
    "resort",
    "transfer",
    "settings",
    "order",
    "runbook",
)


def run_example_tool(name: str, turn: int = 1) -> tuple[str, dict[str, Any]] | None:
    """Executes a named tool directly with zero LLM calls.

    Args:
        name: Short alias or canonical function name of the tool to invoke.
        turn: Current 1-based turn counter used to rotate host health snapshots.

    Returns:
        A `(canonical_tool_name, payload)` tuple, or `None` if `name` is not a
        registered example tool.
    """
    fn = _TOOL_ALIASES.get(name.strip().lower())
    if fn is None:
        return None
    canonical = fn.__name__
    if fn is get_host_health:
        host, cpu, delta, status, uptime = _HOST_SNAPSHOTS[
            (max(turn, 1) - 1) % len(_HOST_SNAPSHOTS)
        ]
        return canonical, {
            "host": host,
            "cpu": cpu,
            "cpuDelta": delta,
            "status": status,
            "uptimeHours": uptime,
        }
    return canonical, fn()
