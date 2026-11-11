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

"""The demo agent's HTTP API: chat turns over SSE, and renderer messages."""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import AsyncIterator
import logging
import time
from typing import Any

from a2ui.rpc import RendererToAgentMessageProcessor
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .model import ModelClient
from .prompt import build_catalogs, build_system_prompt
from .turn import Conversation, SseEvent, TurnRunner, action_prompt

logger = logging.getLogger(__name__)

_MAX_CONVERSATIONS = 200


class ChatRequest(BaseModel):
    """A user prompt or a button press."""

    conversationId: str
    text: str | None = None
    action: dict[str, Any] | None = None


class RendererMessageRequest(BaseModel):
    """A renderer-to-agent message, such as `callAgentFunction`."""

    conversationId: str | None = None
    message: dict[str, Any]


def create_app(model: ModelClient) -> FastAPI:
    """Builds the FastAPI app around a model client."""
    catalogs = build_catalogs()
    system_prompt = build_system_prompt(catalogs)
    runner = TurnRunner(model, catalogs, system_prompt)
    renderer_messages = RendererToAgentMessageProcessor(catalogs)
    conversations: OrderedDict[str, Conversation] = OrderedDict()
    logger.info(
        "agent_ready",
        extra={
            "json": {
                "event": "agent_ready",
                "model": model.name,
                "mode": model.mode,
                "promptChars": len(system_prompt),
                "catalogs": [c.catalog_id for c in catalogs],
            }
        },
    )

    def conversation(conversation_id: str) -> Conversation:
        found = conversations.get(conversation_id)
        if found is None:
            found = Conversation(conversation_id)
            conversations[conversation_id] = found
            if len(conversations) > _MAX_CONVERSATIONS:
                conversations.popitem(last=False)
        conversations.move_to_end(conversation_id)
        return found

    app = FastAPI(title="A2UI ReactApp demo agent")

    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        return {"ok": True, "model": model.name, "mode": model.mode}

    @app.post("/api/chat")
    async def chat(request: ChatRequest) -> StreamingResponse:
        if request.action is not None:
            text = action_prompt(request.action)
            key = f"action:{request.action.get('name')}"
        elif request.text and request.text.strip():
            text = key = request.text.strip()
        else:
            raise HTTPException(400, "Send `text` or `action`.")
        events = runner.run(conversation(request.conversationId), text, key=key)
        return StreamingResponse(
            _encode(events),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.post("/api/renderer-message")
    async def renderer_message(request: RendererMessageRequest) -> dict[str, Any]:
        started = time.perf_counter()
        result = await renderer_messages.process_message(request.message)
        replies = [
            r.model_dump(by_alias=True, exclude_none=True) for r in result.replies
        ]
        call = request.message.get("callAgentFunction") or {}
        logger.info(
            "renderer_message",
            extra={
                "json": {
                    "event": "renderer_message",
                    "conversationId": request.conversationId,
                    "function": (
                        (call.get("callFunction") or {}).get("call")
                        or (call.get("callFunction") or {}).get("@call")
                    ),
                    "handled": result.handled,
                    "durationMs": round((time.perf_counter() - started) * 1000, 1),
                }
            },
        )
        return {"handled": result.handled, "replies": replies}

    return app


async def _encode(events: AsyncIterator[SseEvent]) -> AsyncIterator[str]:
    """Encodes events for SSE, turning an unexpected failure into an `error` event."""
    try:
        async for event in events:
            yield event.encode()
    except Exception as e:  # The stream is already open; report instead of dropping it.
        logger.exception("turn_failed")
        yield SseEvent("error", {"message": f"{type(e).__name__}: {e}"}).encode()
        yield SseEvent("done", {"ok": False}).encode()
