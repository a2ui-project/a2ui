# Copyright 2026 Google LLC
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

"""Tests for the HTTP API, with recorded responses."""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from react_app_demo_agent.catalog import DEMO_CATALOG_ID
from react_app_demo_agent.model import ReplayModel
from react_app_demo_agent.server import create_app

ANSWER = '<a2ui>\nsurface("hi")\nroot = Text(text="Hello")\n</a2ui>'


def _client(tmp_path: Path) -> httpx.AsyncClient:
    (tmp_path / "hello.json").write_text(
        json.dumps({
            "entries": [
                {"key": "Say hello", "chunks": [{"t": 0, "text": ANSWER}]},
                {"key": "action:wave", "chunks": [{"t": 0, "text": "Waved back."}]},
            ]
        })
    )
    app = create_app(ReplayModel(tmp_path, speed=1000))
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


def _events(body: str) -> list[tuple[str, dict[str, object]]]:
    events = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        events.append((lines["event"], json.loads(lines["data"])))
    return events


async def test_chat_streams_sse_events(tmp_path: Path) -> None:
    async with _client(tmp_path) as client:
        response = await client.post(
            "/api/chat", json={"conversationId": "c1", "text": "  say HELLO "}
        )

    assert response.headers["content-type"].startswith("text/event-stream")
    events = _events(response.text)
    assert events[0][0] == "turn"
    a2ui = [data["message"] for name, data in events if name == "a2ui"]
    assert a2ui[0]["createSurface"]["surfaceId"] == "hi"  # type: ignore[index]
    assert events[-1] == ("done", events[-1][1]) and events[-1][1]["ok"] is True


async def test_actions_are_replayed_by_name(tmp_path: Path) -> None:
    async with _client(tmp_path) as client:
        response = await client.post(
            "/api/chat",
            json={
                "conversationId": "c1",
                "action": {"name": "wave", "context": {"n": 1}},
            },
        )

    texts = [data["text"] for name, data in _events(response.text) if name == "text"]
    assert "".join(texts) == "Waved back."  # type: ignore[arg-type]


async def test_renderer_message_runs_agent_functions(tmp_path: Path) -> None:
    async with _client(tmp_path) as client:
        response = await client.post(
            "/api/renderer-message",
            json={
                "conversationId": "c1",
                "message": {
                    "version": "1.0",
                    "callAgentFunction": {
                        "surfaceId": "trip",
                        "functionCallId": "fc-1",
                        "callFunction": {
                            "@call": "estimateTravelTime",
                            "catalogId": DEMO_CATALOG_ID,
                            "args": {"stops": ["Louvre", "Eiffel Tower"]},
                        },
                    },
                },
            },
        )

    body = response.json()
    assert body["handled"] is True
    reply = body["replies"][0]["agentFunctionResponse"]
    assert reply["functionCallId"] == "fc-1"
    assert isinstance(reply["value"], int) and reply["value"] > 0


async def test_renderer_errors_become_notes_and_bad_messages_get_400(
    tmp_path: Path,
) -> None:
    async with _client(tmp_path) as client:
        noted = await client.post(
            "/api/renderer-message",
            json={
                "conversationId": "c1",
                "message": {
                    "version": "1.0",
                    "error": {
                        "code": "REACT_APP_ERROR",
                        "surfaceId": "trip",
                        "message": "boom",
                    },
                },
            },
        )
        bad = await client.post(
            "/api/renderer-message",
            json={
                "conversationId": "c1",
                "message": {
                    "version": "1.0",
                    "callAgentFunction": {
                        "surfaceId": "trip",
                        "callFunction": {"@call": "estimateTravelTime", "args": {}},
                    },
                },
            },
        )

    assert noted.json() == {"handled": True, "replies": []}
    assert bad.status_code == 400
    assert "error" in bad.json()


async def test_chat_requires_text_or_action(tmp_path: Path) -> None:
    async with _client(tmp_path) as client:
        response = await client.post("/api/chat", json={"conversationId": "c1"})

    assert response.status_code == 400


async def test_history_endpoint_returns_turns(tmp_path: Path) -> None:
    async with _client(tmp_path) as client:
        await client.post(
            "/api/chat", json={"conversationId": "c1", "text": "Say hello"}
        )
        history = await client.get("/api/history")

    assert history.status_code == 200
    data = history.json()
    assert data["ok"] is True
    assert data["count"] >= 1
    assert any(t["key"] == "Say hello" for t in data["turns"])
