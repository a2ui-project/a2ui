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

"""Drives the scripted agent over A2A JSON-RPC, in process, for every scenario.

Each scenario runs once per format it scripts, with a renderer of the
scenario's protocol version. The renderer sends its capabilities the way the
web and Flutter shells do: the A2UI extension header plus the capabilities
key in the message metadata.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
import json
from typing import Any
import uuid

from a2ui_e2e_agent.scenarios import Scenario, load_scenarios
from a2ui_e2e_agent.server import DEFAULT_SCENARIO_DIR, ServerConfig, build_app
import httpx
import pytest
import pytest_asyncio

A2UI_MIME_TYPE = "application/a2ui+json"
OPENING_TEXT_MISMATCH = "Hello, is anyone there?"

_CAPABILITIES: dict[str, dict[str, Any]] = {
    "1.0": {
        "extension": "https://a2ui.org/a2a-extension/a2ui/v1.0",
        "key": "a2uiRendererCapabilities",
        "version_key": "1.0",
        "catalog_id": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
    },
    "0.9.1": {
        "extension": "https://a2ui.org/a2a-extension/a2ui/v0.9",
        "key": "a2uiClientCapabilities",
        "version_key": "v0.9",
        "catalog_id": "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
    },
}

SCENARIOS = list(load_scenarios(DEFAULT_SCENARIO_DIR))
CASES = [
    pytest.param(
        (scenario, fmt), id=f"{scenario.name}-{fmt}-v{scenario.protocol_version}"
    )
    for scenario in SCENARIOS
    for fmt in scenario.formats
]


def _message(
    parts: list[dict[str, Any]],
    *,
    context_id: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    message: dict[str, Any] = {
        "kind": "message",
        "messageId": str(uuid.uuid4()),
        "role": "user",
        "contextId": context_id,
        "parts": parts,
    }
    if metadata is not None:
        message["metadata"] = metadata
    return message


def _text_part(text: str) -> dict[str, Any]:
    return {"kind": "text", "text": text}


def _a2ui_part(data: dict[str, Any]) -> dict[str, Any]:
    return {"kind": "data", "data": data, "metadata": {"mimeType": A2UI_MIME_TYPE}}


def _capabilities(version: str) -> dict[str, Any]:
    profile = _CAPABILITIES[version]
    return {
        profile["key"]: {
            profile["version_key"]: {"supportedCatalogIds": [profile["catalog_id"]]}
        }
    }


class Renderer:
    """A renderer of one protocol version talking to the agent in one context."""

    def __init__(self, client: httpx.AsyncClient, version: str) -> None:
        self._client = client
        self._version = version
        self.context_id = str(uuid.uuid4())

    async def send(
        self, parts: list[dict[str, Any]], *, capabilities: bool = True
    ) -> list[dict[str, Any]]:
        """Sends one `message/stream` request and returns the events, in order."""
        profile = _CAPABILITIES[self._version]
        message = _message(
            parts,
            context_id=self.context_id,
            metadata=_capabilities(self._version) if capabilities else None,
        )
        headers = {"X-A2A-Extensions": profile["extension"]} if capabilities else {}
        response = await self._client.post(
            "/",
            json={
                "jsonrpc": "2.0",
                "id": str(uuid.uuid4()),
                "method": "message/stream",
                "params": {"message": message},
            },
            headers=headers,
        )
        assert response.status_code == 200, response.text
        events = []
        for line in response.text.split("\n"):
            if not line.startswith("data:"):
                continue
            body = json.loads(line[len("data:") :])
            assert "error" not in body, body
            events.append(body["result"])
        assert events, "The stream sent no events."
        last = events[-1]
        assert last["kind"] == "status-update" and last["final"] is True, last
        assert last["status"]["state"] != "failed", last
        return events

    async def log(self) -> list[dict[str, Any]]:
        response = await self._client.get("/e2e/log")
        assert response.status_code == 200
        return response.json()


def _agent_parts(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The parts of the agent's working status messages, in order."""
    parts: list[dict[str, Any]] = []
    for event in events:
        if event.get("kind") != "status-update":
            continue
        message = event["status"].get("message")
        if message and message.get("role") == "agent":
            parts.extend(message["parts"])
    return parts


def _a2ui_messages(parts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    data_parts = [part for part in parts if part["kind"] == "data"]
    for part in data_parts:
        assert part.get("metadata", {}).get("mimeType") == A2UI_MIME_TYPE, part
    return [part["data"] for part in data_parts]


def _text(parts: list[dict[str, Any]]) -> str:
    return "".join(part["text"] for part in parts if part["kind"] == "text")


def _concrete(value: Any) -> Any:
    """Replaces the `$match: any` placeholders of an expected envelope with values."""
    if isinstance(value, dict):
        if value.keys() == {"$match"}:
            return "2026-01-01T00:00:00Z"
        return {key: _concrete(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_concrete(item) for item in value]
    return value


@pytest_asyncio.fixture(params=CASES)
async def renderer(
    request: pytest.FixtureRequest,
) -> AsyncIterator[tuple[Scenario, Renderer]]:
    scenario, fmt = request.param
    app = build_app(ServerConfig(format=fmt))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://agent"
    ) as client:
        yield scenario, Renderer(client, scenario.protocol_version)


@pytest.mark.asyncio
async def test_turn_0_with_capabilities_streams_the_scenario_wire(renderer) -> None:
    scenario, client = renderer
    turn = scenario.turns[0]

    parts = _agent_parts(await client.send([_text_part(scenario.opening_text)]))

    assert _a2ui_messages(parts) == turn.a2ui_messages
    assert _text(parts).strip() == turn.text
    (record,) = await client.log()
    assert record["scenario"] == scenario.name
    assert record["turn"] == 0
    assert record["version"] == scenario.protocol_version
    assert record["a2ui_enabled"] is True
    assert (
        _CAPABILITIES[scenario.protocol_version]["catalog_id"]
        in record["system_instruction"]
    )


@pytest.mark.asyncio
async def test_turn_0_without_capabilities_answers_with_text_only(renderer) -> None:
    scenario, client = renderer
    turn = scenario.turns[0]

    parts = _agent_parts(
        await client.send([_text_part(scenario.opening_text)], capabilities=False)
    )

    assert _a2ui_messages(parts) == []
    assert turn.text in _text(parts)
    (record,) = await client.log()
    assert record["a2ui_enabled"] is False
    assert record["version"] is None
    assert "<a2ui" not in record["system_instruction"]


@pytest.mark.asyncio
async def test_every_turn_replays_after_its_outbound_message(renderer) -> None:
    scenario, client = renderer

    await client.send([_text_part(scenario.opening_text)])
    for previous, turn in zip(scenario.turns, scenario.turns[1:]):
        if turn.user_text is not None:
            parts = [_text_part(turn.user_text)]
        else:
            assert previous.expect_outbound, (
                f"Turn {turn.index} of '{scenario.name}' has no user text and the"
                " previous turn sends nothing outbound."
            )
            parts = [
                _a2ui_part(_concrete(envelope)) for envelope in previous.expect_outbound
            ]

        agent_parts = _agent_parts(await client.send(parts))

        assert _a2ui_messages(agent_parts) == turn.a2ui_messages
        assert _text(agent_parts).strip() == turn.text

    records = await client.log()
    assert [record["turn"] for record in records] == list(range(len(scenario.turns)))
    for turn in scenario.turns[1:]:
        if turn.user_text is None:
            # The model sees the renderer's message formatted as text, not raw JSON.
            inbound = records[turn.index]["user_contents"][-1]
            assert inbound.startswith(("User triggered action", "Renderer reported"))


@pytest.mark.asyncio
async def test_withdrawing_capabilities_scopes_the_turn_to_text(renderer) -> None:
    scenario, client = renderer
    if len(scenario.turns) < 2 or scenario.turns[1].user_text is None:
        pytest.skip("Needs a second turn the user starts with text.")
    turn = scenario.turns[1]

    await client.send([_text_part(scenario.opening_text)])
    parts = _agent_parts(
        await client.send([_text_part(turn.user_text)], capabilities=False)
    )

    assert _a2ui_messages(parts) == []
    assert turn.text in _text(parts)


@pytest.mark.asyncio
async def test_unknown_opening_text_gets_a_text_reply(renderer) -> None:
    _scenario, client = renderer

    parts = _agent_parts(await client.send([_text_part(OPENING_TEXT_MISMATCH)]))

    assert _a2ui_messages(parts) == []
    assert "No scenario opens with" in _text(parts)


@pytest.mark.asyncio
async def test_a_version_without_a_scenario_copy_gets_a_text_reply(renderer) -> None:
    scenario, client = renderer
    other_versions = [v for v in _CAPABILITIES if v != scenario.protocol_version]
    missing = next(
        (
            v
            for v in other_versions
            if not any(
                s.protocol_version == v and s.opening_text == scenario.opening_text
                for s in SCENARIOS
            )
        ),
        None,
    )
    if missing is None:
        pytest.skip("The scenario exists in every version the agent serves.")
    other = Renderer(client._client, missing)

    parts = _agent_parts(await other.send([_text_part(scenario.opening_text)]))

    assert _a2ui_messages(parts) == []
    assert f"No v{missing} copy of the scenario" in _text(parts)
    (record,) = await other.log()
    assert record["version"] == missing
    assert _CAPABILITIES[missing]["catalog_id"] in record["system_instruction"]


@pytest.mark.asyncio
async def test_agent_functions_answer_without_a_model_turn(renderer) -> None:
    scenario, client = renderer
    if scenario.protocol_version != "1.0":
        pytest.skip("Agent functions exist from v1.0.")
    catalog_id = _CAPABILITIES["1.0"]["catalog_id"]

    def call(call_id: str, name: str, args: dict[str, Any]) -> dict[str, Any]:
        return {
            "version": "1.0",
            "callAgentFunction": {
                "functionCallId": call_id,
                "surfaceId": "any",
                "callFunction": {"@call": name, "catalogId": catalog_id, "args": args},
            },
        }

    priced = _a2ui_messages(
        _agent_parts(
            await client.send(
                [_a2ui_part(call("c1", "lookupPrice", {"sku": "sku-100"}))]
            )
        )
    )
    failed = _a2ui_messages(
        _agent_parts(await client.send([_a2ui_part(call("c2", "failingLookup", {}))]))
    )

    assert priced == [{
        "version": "1.0",
        "agentFunctionResponse": {"functionCallId": "c1", "value": "$10.00"},
    }]
    (failure,) = failed
    assert failure["agentFunctionResponse"]["functionCallId"] == "c2"
    assert "error" in failure["agentFunctionResponse"]
    assert await client.log() == []
