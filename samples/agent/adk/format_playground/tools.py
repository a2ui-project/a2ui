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


def get_host_health(host: str = "prod-1") -> dict[str, Any]:
    """Retrieves operational and health metrics for a production host server."""
    return {
        "host": host,
        "cpu": 0.78,
        "cpuDelta": 0.12,
        "status": "degraded",
        "uptimeHours": 412,
    }


def get_resort(name: str = "Snowbird") -> dict[str, Any]:
    """Fetches details, elevation, and open trail information for mountain ski resorts."""
    return {
        "resorts": [
            {"name": name, "elevation": 11000, "openRuns": 85},
            {"name": "Alta", "elevation": 10500, "openRuns": 70},
        ]
    }


def get_transfer_quote(
    amount: float = 15000.0, recipient: str = "Acme Corp"
) -> dict[str, Any]:
    """Calculates fee and prepares a quote for an outbound bank wire transfer."""
    return {
        "recipient": recipient,
        "amount": amount,
        "fee": 25.0,
        "sourceAccount": "Checking ...4821",
        "actions": ["Confirm Transfer", "Cancel"],
    }


def get_playback_settings() -> dict[str, Any]:
    """Loads current audio, subtitle, and user interface playback settings."""
    return {
        "volume": 80,
        "subtitles": True,
        "theme": "dark",
        "actions": ["Save", "Cancel"],
    }


TOOL_INTENTS: dict[str, str] = {
    "get_host_health": "Show CPU utilization and host health",
    "get_resort": "Browse mountain ski resort details",
    "get_transfer_quote": "Review wire transfer quote",
    "get_playback_settings": "Adjust audio playback and notification preferences",
}

TOOL_MUTABLE_PATHS: dict[str, tuple[str, ...]] = {
    "get_host_health": (),
    "get_resort": (),
    "get_transfer_quote": ("/actions",),
    "get_playback_settings": ("/volume", "/subtitles", "/theme", "/actions"),
}

TOOLS: list[Callable[..., Any]] = [
    get_host_health,
    get_resort,
    get_transfer_quote,
    get_playback_settings,
]
