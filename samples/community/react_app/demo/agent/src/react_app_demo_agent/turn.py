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

"""One conversation turn: model stream -> Express -> ReactApp checks -> SSE events.

A turn streams the model's Express response through the Express response
stream, checks each compiled message with `ReactAppTransformer` and yields it
as an `a2ui` event. When the stream or the checks reject the response, the turn
retries once: it removes the surfaces the failed attempt created, sends the
model its own response with the error list, and streams the new answer.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
import json
import logging
import re
import time
from typing import Any
import uuid

from a2ui.core import A2uiError, CatalogApi
from a2ui.inference_formats.express import ExpressFormat
from a2ui.parser import A2uiPart, TextPart
from a2ui.utils import RendererState
from a2ui_react_app import ReactAppTransformer

from .model import ChatMessage, ModelClient, Usage

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 2
"""The first try plus one automatic retry on validation errors."""

_OPEN_TAG = "<a2ui>"
_REACT_APP_CALL_RE = re.compile(r"\bReactApp\s*\(")
_TITLE_RE = re.compile(r'\btitle\s*=\s*"([^"\n]{0,80})"')
_HEIGHT_RE = re.compile(r"\bheight\s*=\s*(\d{2,4})")


def now_ms() -> float:
    """Wall-clock time in epoch milliseconds, the clock every timing uses."""
    return time.time() * 1000


@dataclass(frozen=True)
class SseEvent:
    """One server-sent event."""

    event: str
    data: dict[str, Any]

    def encode(self) -> str:
        return f"event: {self.event}\ndata: {json.dumps(self.data)}\n\n"


@dataclass
class Conversation:
    """The state the agent keeps per conversation."""

    id: str
    history: list[ChatMessage] = field(default_factory=list)
    committed: list[dict[str, Any]] = field(default_factory=list)
    """Every A2UI message sent by successful turns, to rebuild renderer state."""


@dataclass
class _Attempt:
    number: int
    started: float
    raw: list[str] = field(default_factory=list)
    sent: list[dict[str, Any]] = field(default_factory=list)
    created_surfaces: list[str] = field(default_factory=list)
    react_apps: list[dict[str, Any]] = field(default_factory=list)
    pending_apps: int = 0
    errors: list[str] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    first_token: float | None = None
    finished: float | None = None

    @property
    def text(self) -> str:
        return "".join(self.raw)

    def to_json(self) -> dict[str, Any]:
        return {
            "attempt": self.number,
            "ok": not self.errors,
            "errors": self.errors,
            "express": self.text,
            "messageCount": len(self.sent),
            "durationMs": round((self.finished or now_ms()) - self.started, 1),
            "firstTokenMs": (
                round(self.first_token - self.started, 1) if self.first_token else None
            ),
            "usage": self.usage.to_json(),
        }


def action_prompt(action: dict[str, Any]) -> str:
    """The user message that tells the model about a button press."""
    context = json.dumps(action.get("context") or {}, ensure_ascii=False)
    return (
        f"[action] The user pressed `{action.get('name')}` on surface"
        f" `{action.get('surfaceId')}` (component `{action.get('sourceComponentId')}`)"
        f" with these values: {context}"
    )


def retry_prompt(errors: Sequence[str]) -> str:
    """The user message that asks the model to fix its response."""
    listed = "\n".join(f"- {e}" for e in errors)
    return (
        "Your previous response could not be shown because of these problems:\n"
        f"{listed}\n\nWrite the whole response again with these problems fixed,"
        " and keep everything else the same."
    )


class TurnRunner:
    """Runs conversation turns against one model, catalog set and system prompt."""

    def __init__(
        self, model: ModelClient, catalogs: list[CatalogApi], system_prompt: str
    ) -> None:
        self._model = model
        self._catalogs = catalogs
        self._format = ExpressFormat(catalogs)
        self._system_prompt = system_prompt

    @property
    def model(self) -> ModelClient:
        return self._model

    async def run(
        self, conversation: Conversation, user_text: str, *, key: str
    ) -> AsyncIterator[SseEvent]:
        """Runs one turn and yields its events.

        Args:
            conversation: The conversation; updated when the turn succeeds.
            user_text: The user message sent to the model.
            key: The recording key (the prompt, or `action:<name>`).
        """
        turn_id = uuid.uuid4().hex[:12]
        timings: dict[str, float] = {"received": now_ms()}
        yield SseEvent(
            "turn",
            {
                "turnId": turn_id,
                "model": self._model.name,
                "mode": self._model.mode,
                "promptChars": len(self._system_prompt),
                "receivedAt": timings["received"],
            },
        )
        history = [*conversation.history, ChatMessage("user", user_text)]
        attempts: list[_Attempt] = []
        final: _Attempt | None = None

        for number in range(1, MAX_ATTEMPTS + 1):
            attempt = _Attempt(number=number, started=now_ms())
            attempts.append(attempt)
            async for event in self._stream_attempt(
                conversation, history, attempt, timings, key
            ):
                yield event
            attempt.finished = now_ms()
            if not attempt.errors:
                final = attempt
                break
            # Undo what the failed attempt showed, then retry or give up.
            for surface_id in attempt.created_surfaces:
                yield SseEvent(
                    "a2ui",
                    {
                        "message": {
                            "version": "1.0",
                            "deleteSurface": {"surfaceId": surface_id},
                        },
                        "attempt": number,
                    },
                )
            if number < MAX_ATTEMPTS:
                yield SseEvent(
                    "retry", {"attempt": number + 1, "errors": attempt.errors}
                )
                history = [
                    *history,
                    ChatMessage("model", attempt.text),
                    ChatMessage("user", retry_prompt(attempt.errors)),
                ]
            else:
                yield SseEvent(
                    "error",
                    {
                        "message": "The model's response failed validation twice.",
                        "errors": attempt.errors,
                    },
                )

        timings["streamDone"] = now_ms()
        yield SseEvent(
            "timing", {"checkpoint": "streamDone", "at": timings["streamDone"]}
        )
        if final is not None:
            conversation.history.extend(
                [ChatMessage("user", user_text), ChatMessage("model", final.text)]
            )
            conversation.committed.extend(final.sent)

        shown = final or attempts[-1]
        usage = Usage(
            prompt_tokens=sum(a.usage.prompt_tokens for a in attempts),
            output_tokens=sum(a.usage.output_tokens for a in attempts),
            thoughts_tokens=sum(a.usage.thoughts_tokens for a in attempts),
        )
        debug = {
            "turnId": turn_id,
            "model": self._model.name,
            "mode": self._model.mode,
            "promptChars": len(self._system_prompt),
            "express": shown.text,
            "messages": shown.sent,
            "reactApps": shown.react_apps,
            "attempts": [a.to_json() for a in attempts],
            "retries": len(attempts) - 1,
            "ok": final is not None,
            "timings": timings,
            "usage": usage.to_json(),
        }
        logger.info(
            "turn",
            extra={
                "json": {
                    "event": "turn",
                    "conversationId": conversation.id,
                    "key": key,
                    **{k: v for k, v in debug.items() if k not in ("messages",)},
                    "durationsMs": {
                        name: round(at - timings["received"], 1)
                        for name, at in timings.items()
                    },
                }
            },
        )
        yield SseEvent("debug", debug)
        yield SseEvent(
            "done", {"turnId": turn_id, "ok": final is not None, "timings": timings}
        )

    async def _stream_attempt(
        self,
        conversation: Conversation,
        history: Sequence[ChatMessage],
        attempt: _Attempt,
        timings: dict[str, float],
        key: str,
    ) -> AsyncIterator[SseEvent]:
        """Streams one model call, filling `attempt`; errors end up in `attempt.errors`."""
        state = RendererState(self._catalogs)
        if conversation.committed:
            state.apply(conversation.committed)
        stream = self._format.create_parser().open_stream(state=state)
        transformer = ReactAppTransformer(on_error="raise")
        try:
            call = self._model.stream(
                self._system_prompt, history, key=key, attempt=attempt.number
            )
        except LookupError as e:
            attempt.errors.append(str(e))
            return
        attempt.usage = call.usage
        chunks = call.chunks
        try:
            async for chunk in chunks:
                if attempt.first_token is None:
                    attempt.first_token = now_ms()
                    if "firstToken" not in timings:
                        timings["firstToken"] = attempt.first_token
                        yield SseEvent(
                            "timing",
                            {"checkpoint": "firstToken", "at": attempt.first_token},
                        )
                attempt.raw.append(chunk)
                for event in self._handle_parts(
                    stream.feed(chunk), transformer, attempt, timings
                ):
                    yield event
                pending = self._pending_app(attempt)
                if pending is not None:
                    yield pending
            for event in self._handle_parts(
                stream.close(), transformer, attempt, timings
            ):
                yield event
        except A2uiError as e:
            attempt.errors.extend(_error_lines(e))
            logger.warning(
                "attempt_rejected",
                extra={
                    "json": {
                        "event": "attempt_rejected",
                        "attempt": attempt.number,
                        "errors": attempt.errors,
                    }
                },
            )
        finally:
            close = getattr(chunks, "aclose", None)
            if close is not None:
                await close()

    def _handle_parts(
        self,
        parts: Sequence[object],
        transformer: ReactAppTransformer,
        attempt: _Attempt,
        timings: dict[str, float],
    ) -> list[SseEvent]:
        """Turns stream parts into events. Raises `A2uiError` on a rejected message."""
        events: list[SseEvent] = []
        for part in parts:
            if isinstance(part, TextPart):
                if part.text:
                    events.append(SseEvent("text", {"text": part.text}))
                continue
            if not isinstance(part, A2uiPart):
                continue
            for model in transformer.transform_to_transport(part.a2ui):
                message = model.model_dump(by_alias=True, exclude_none=True)
                attempt.sent.append(message)
                events.append(
                    SseEvent("a2ui", {"message": message, "attempt": attempt.number})
                )
                if "firstA2ui" not in timings:
                    timings["firstA2ui"] = now_ms()
                    events.append(
                        SseEvent(
                            "timing",
                            {"checkpoint": "firstA2ui", "at": timings["firstA2ui"]},
                        )
                    )
                created = message.get("createSurface")
                if isinstance(created, dict):
                    attempt.created_surfaces.append(str(created.get("surfaceId")))
                for surface_id, component in _components(message):
                    if component.get("component") != "ReactApp":
                        continue
                    attempt.react_apps.append({
                        "surfaceId": surface_id,
                        "id": component.get("id"),
                        "title": component.get("title"),
                        "source": component.get("source"),
                        "dataPaths": component.get("dataPaths"),
                        "functions": component.get("functions"),
                    })
                    if "reactAppSource" not in timings:
                        timings["reactAppSource"] = now_ms()
                        events.append(
                            SseEvent(
                                "timing",
                                {
                                    "checkpoint": "reactAppSource",
                                    "at": timings["reactAppSource"],
                                },
                            )
                        )
        return events

    @staticmethod
    def _pending_app(attempt: _Attempt) -> SseEvent | None:
        """An `app_pending` event when the model starts writing a new `ReactApp`."""
        text = attempt.text
        start = text.find(_OPEN_TAG)
        if start < 0:
            return None
        calls = list(_REACT_APP_CALL_RE.finditer(text, start))
        if len(calls) <= attempt.pending_apps:
            return None
        attempt.pending_apps = len(calls)
        head = text[calls[-1].end() : calls[-1].end() + 240]
        title = _TITLE_RE.search(head)
        height = _HEIGHT_RE.search(head)
        return SseEvent(
            "app_pending",
            {
                "attempt": attempt.number,
                "index": len(calls) - 1,
                "title": title.group(1) if title else None,
                "height": int(height.group(1)) if height else None,
            },
        )


def _components(message: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """The components a message carries, with their surface id."""
    found: list[tuple[str, dict[str, Any]]] = []
    for envelope in ("createSurface", "updateComponents"):
        body = message.get(envelope)
        if isinstance(body, dict):
            for component in body.get("components") or []:
                if isinstance(component, dict):
                    found.append((str(body.get("surfaceId")), component))
    return found


def _error_lines(error: A2uiError) -> list[str]:
    """The problems an error lists, one per line."""
    lines = [line.strip(" -•") for line in str(error).splitlines() if line.strip(" -•")]
    return lines or [type(error).__name__]
