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

"""Action round trips: the event name and context a client sends back."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import pytest

from a2ui.core.basic_catalog import BasicCatalog
from a2ui.inference_formats.decision import (
    ActionSpec,
    DecisionSynthesizer,
    SynthesisOutput,
    SynthesisStage,
)
from a2ui.parser.messages import to_message_dicts
from a2ui.utils import validate_payload

from .layout_fixtures import ScriptedValue, mock_backend

CATALOG = BasicCatalog("v1.0")

FORM_SCRIPTED: dict[str, ScriptedValue] = {
    "family": ("input", 0.90),
    "stakes": 0.5,
    "urgency": 0.2,
    "archetype:input": ("form", 0.90),
    "gate:form": 0.95,
    "gate:actions": 0.90,
}

COLLECTION_SCRIPTED: dict[str, ScriptedValue] = {
    "family": ("inspect", 0.85),
    "stakes": 0.2,
    "urgency": 0.1,
    "archetype:inspect": ("detail", 0.85),
    "gate:headline": 0.80,
    "gate:collection": 0.90,
}

CONFIRM_SCRIPTED: dict[str, ScriptedValue] = {
    "family": ("act", 0.85),
    "stakes": 1.0,
    "urgency": 0.6,
    "archetype:act": ("confirm", 0.95),
    "gate:facts": 0.85,
    "gate:actions": 0.90,
}


def _buttons(out: SynthesisOutput) -> list[dict[str, Any]]:
    components = next(
        d["updateComponents"]["components"]
        for d in to_message_dicts(out.messages)
        if "updateComponents" in d
    )
    return [c for c in components if c["component"] == "Button"]


def _read(data: Any, path: str) -> Any:
    for part in path.strip("/").split("/"):
        data = data[int(part)] if isinstance(data, Sequence) else data[part]
    return data


def _resolve_event(
    button: Mapping[str, Any], data: Mapping[str, Any], item: Any = None
) -> tuple[str, dict[str, Any]]:
    """Resolves a button's event as a client would: absolute paths against the
    data model, relative paths against the repeated item."""
    event = button["action"]["event"]
    context = {
        name: (
            _read(data, ref["@path"])
            if ref["@path"].startswith("/")
            else _read(item, ref["@path"])
        )
        for name, ref in event.get("context", {}).items()
    }
    return event["name"], context


async def _synthesize(
    scripted: dict[str, ScriptedValue], intent: str, payload: Any, **kwargs: Any
) -> SynthesisOutput:
    out = await DecisionSynthesizer([CATALOG], mock_backend(**scripted)).synthesize(
        intent, payload, **kwargs
    )
    assert out.stage is SynthesisStage.ARCHETYPE
    validate_payload([CATALOG], out.messages)
    return out


@pytest.mark.asyncio
async def test_form_submit_sends_the_mutable_values() -> None:
    payload = {"name": "Alice", "email": "alice@example.com"}
    out = await _synthesize(
        FORM_SCRIPTED,
        "Edit profile",
        payload,
        mutable_paths=["/name", "/email"],
        actions=[ActionSpec(id="save_profile", label="Save")],
    )
    (button,) = _buttons(out)
    assert _resolve_event(button, payload) == ("save_profile", payload)


@pytest.mark.asyncio
async def test_item_action_sends_the_item_id() -> None:
    payload = {
        "title": "Flights",
        "flights": [
            {"id": "fl-1", "title": "SFO to NRT", "price": 900},
            {"id": "fl-2", "title": "SFO to LHR", "price": 700},
        ],
    }
    out = await _synthesize(
        COLLECTION_SCRIPTED,
        "Choose a flight",
        payload,
        actions=[ActionSpec(id="select_flight", label="Select", scope="/flights")],
    )
    (button,) = _buttons(out)
    second = payload["flights"][1]
    assert _resolve_event(button, payload, second) == (
        "select_flight",
        {"id": "fl-2"},
    )


@pytest.mark.asyncio
async def test_non_latin_label_keeps_the_action_id() -> None:
    payload = {"name": "Alice", "email": "alice@example.com"}
    out = await _synthesize(
        FORM_SCRIPTED,
        "プロフィールを編集",
        payload,
        mutable_paths=["/name", "/email"],
        actions=[ActionSpec(id="save_profile", label="保存")],
    )
    (button,) = _buttons(out)
    assert button["action"]["event"]["name"] == "save_profile"
    texts = [
        c.get("text")
        for d in to_message_dicts(out.messages)
        if "updateComponents" in d
        for c in d["updateComponents"]["components"]
    ]
    assert "保存" in texts


@pytest.mark.asyncio
async def test_explicit_context_is_sent_as_given() -> None:
    payload = {"transfer": {"id": "tx-9", "amount": 50}}
    out = await _synthesize(
        CONFIRM_SCRIPTED,
        "Approve the transfer",
        payload,
        actions=[
            ActionSpec(
                id="approve",
                label="Approve",
                context={"transferId": "/transfer/id", "amount": "/transfer/amount"},
            )
        ],
    )
    (button,) = _buttons(out)
    assert _resolve_event(button, payload) == (
        "approve",
        {"transferId": "tx-9", "amount": 50},
    )
