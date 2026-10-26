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

"""Standard decision block fixtures and scripted answers for evaluation tests."""

from __future__ import annotations

from collections.abc import Mapping
import json
from typing import Any

from a2ui.inference_formats.decision import (
    DecisionBlock,
    DeterministicMockBackend,
)

HOST_BLOCK: str = json.dumps({
    "intent": "Show CPU utilization for prod-1",
    "payload": {
        "host": "prod-1",
        "cpu": 0.78,
        "cpuDelta": 0.12,
        "status": "degraded",
        "uptimeHours": 412,
    },
    "layout": ["headline:cpu,cpuDelta,status", "facts:host,uptimeHours"],
})

HOST_DECISION_BLOCK: DecisionBlock = DecisionBlock.from_mapping(json.loads(HOST_BLOCK))

HOST_ANSWERS: dict[str, Any] = {
    "family": ("monitor", 0.90),
    "stakes": 1.0,
    "urgency": 1.4,
    "archetype:monitor": ("dashboard", 0.85),
    "gate:banner": 0.80,
    "gate:headline": 0.90,
    "gate:facts": 0.80,
    "anatomy:headline.deltas": 0.85,
    "salience:/cpu": 2.8,
    "salience:/status": 2.1,
    "salience:/uptimeHours": 1.2,
    "salience:/host": 0.4,
    "instance:banner.tone:/status": ("warning", 0.90),
    "instance:headline.news:/cpu": ("bad", 0.85),
    "instance:headline.state_tone:/status": ("warning", 0.80),
}

TRANSFER_BLOCK: str = json.dumps({
    "intent": "Confirm sending $50 to Alex before it goes through",
    "payload": {
        "amount": 50,
        "currency": "USD",
        "recipient": "Alex Chen",
        "fee": 0.5,
        "arrives": "2026-10-24",
        "actions": ["Send", "Cancel"],
    },
    "layout": ["facts:amount,recipient,fee,arrives", "actions:actions"],
    "mutablePaths": ["/actions"],
})

TRANSFER_DECISION_BLOCK: DecisionBlock = DecisionBlock.from_mapping(
    json.loads(TRANSFER_BLOCK)
)

TRANSFER_ANSWERS: dict[str, Any] = {
    "family": ("act", 0.85),
    "stakes": 2.1,
    "urgency": 0.6,
    "archetype:act": ("confirm", 0.90),
    "gate:banner": 0.20,
    "gate:prose": 0.45,
    "gate:facts": 0.85,
    "gate:actions": 0.90,
    "instance:actions.primary:/actions": ("Send", 0.90),
    "instance:actions.destructive:0": 0.80,
    "instance:actions.destructive:1": 0.10,
    "salience:/amount": 2.9,
    "salience:/recipient": 2.6,
    "salience:/fee": 1.9,
    "salience:/arrives": 1.7,
}

SETTINGS_BLOCK: str = json.dumps({
    "intent": "Playback and notification settings",
    "payload": {
        "playback": {
            "skipForward": "30 seconds",
            "autoDownload": True,
            "speed": 1.25,
        },
        "notifications": {"newEpisodes": True, "digest": False},
        "account": {"signOut": "Sign out"},
    },
    "layout": ["groups:/playback,/notifications,/account"],
    "mutablePaths": ["/playback", "/notifications", "/account"],
})

SETTINGS_DECISION_BLOCK: DecisionBlock = DecisionBlock.from_mapping(
    json.loads(SETTINGS_BLOCK)
)

SETTINGS_ANSWERS: dict[str, Any] = {
    "family": ("input", 0.80),
    "stakes": 1.2,
    "urgency": 0.2,
    "archetype:input": ("settings", 0.90),
    "gate:groups": 0.90,
    "gate:actions": 0.20,
    "instance:groups.row_kind:/playback/skipForward": ("value", 0.90),
    "instance:groups.row_kind:/playback/autoDownload": ("switch", 0.95),
    "instance:groups.row_kind:/playback/speed": ("value", 0.70),
    "instance:groups.row_kind:/notifications/newEpisodes": ("switch", 0.90),
    "instance:groups.row_kind:/notifications/digest": ("switch", 0.90),
    "instance:groups.row_kind:/account/signOut": ("danger", 0.90),
}


def scripted_backend(
    answers: Mapping[str, Any] | None = None,
) -> DeterministicMockBackend:
    """Returns a `DeterministicMockBackend` seeded with `answers`."""
    return DeterministicMockBackend(scripted_answers=answers)
