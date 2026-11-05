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

"""HTTP API for the Liner Notes demo.

Run with `uv run uvicorn liner_notes.server:app --port 8100`.
"""

from __future__ import annotations

import dataclasses
import logging
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from liner_notes import scripted
from liner_notes.agent import AgentTurn, create_agent
from liner_notes.music_catalog import MUSIC_CATALOG_ID

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Liner Notes: A2UI v1.0 macros music demo")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

agent = create_agent()

# Arguments used to expand each macro once, to report which catalogs it uses.
_SAMPLE_ARGS: dict[str, dict[str, Any]] = {
    "ArtistProfile": {"artistId": "nina-simone"},
    "Discography": {"artistId": "the-beatles"},
    "AlbumSpotlight": {"albumId": "abbey-road"},
    "TourSchedule": {"artistId": "aldous-harding"},
    "CareerTimeline": {"artistId": "bjork"},
    "ArtistComparison": {"artistIds": ["fela-kuti", "kendrick-lamar"]},
    "ArtistGrid": {"title": "Artists", "artistIds": ["rosalia", "bts"]},
    "FactCard": {"headline": "Fact", "body": "Body", "icon": "star"},
}


class ChatRequest(BaseModel):
    conversation_id: str = Field(alias="conversationId")
    prompt: str


class ActionRequest(BaseModel):
    conversation_id: str = Field(alias="conversationId")
    name: str
    context: dict[str, Any] = {}
    user_message: str | None = Field(default=None, alias="userMessage")


def _turn_json(turn: AgentTurn) -> dict[str, Any]:
    return {
        "surfaceId": turn.surface_id,
        "text": turn.text,
        "messages": turn.messages,
        "debug": {
            "mode": turn.mode,
            "model": agent.model if turn.mode == "live" else None,
            "modelOutput": turn.model_output,
            "latencyMs": turn.latency_ms,
            "toolCalls": [dataclasses.asdict(c) for c in turn.tool_calls],
            "macroCalls": turn.macro_calls,
            "inferenceComponentCount": turn.inference_component_count,
            "transportComponentCount": turn.transport_component_count,
            "attempts": turn.attempts,
            "inputTokens": turn.input_tokens,
            "outputTokens": turn.output_tokens,
            "error": turn.error,
        },
    }


@app.get("/api/info")
def info() -> dict[str, Any]:
    return {
        "mode": agent.mode,
        "model": agent.model,
        "protocolVersion": "1.0",
        "catalogIds": [c.catalog_id for c in agent.runtime.transport_catalogs],
        "musicCatalogId": MUSIC_CATALOG_ID,
        "examplePrompts": scripted.EXAMPLE_PROMPTS,
    }


@app.get("/api/macros")
def macros() -> list[dict[str, Any]]:
    runtime = agent.runtime
    names_by_catalog = {
        c.catalog_id: set(c.components) for c in runtime.transport_catalogs
    }
    result = []
    for m in runtime.expander.macros:
        schema = m.to_json_schema()
        components = runtime.expander.processor.expand(
            m.name, _SAMPLE_ARGS[m.name], instance_id="preview"
        )
        used = sorted({c["component"] for c in components})
        result.append({
            "name": m.name,
            "description": (m.description or "").split("\n")[0],
            "parameters": list(schema.get("properties", {})),
            "basicComponents": [
                n
                for n in used
                if n in names_by_catalog[runtime.basic_catalog.catalog_id]
            ],
            "musicComponents": [
                n for n in used if n in names_by_catalog[MUSIC_CATALOG_ID]
            ],
        })
    return result


@app.post("/api/chat")
async def chat(request: ChatRequest) -> dict[str, Any]:
    return _turn_json(await agent.respond(request.conversation_id, request.prompt))


@app.post("/api/action")
async def action(request: ActionRequest) -> dict[str, Any]:
    turn = await agent.handle_action(
        request.conversation_id, request.name, request.context, request.user_message
    )
    return _turn_json(turn)
