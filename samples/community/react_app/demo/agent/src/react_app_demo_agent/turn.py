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
as an `a2ui` event.

Two things keep the client and the agent in step:

- Rewriting a surface from an earlier turn replaces it. Express compiles a
  block that defines `root` for a known surface into `createSurface`, which a
  renderer rejects, so the turn deletes the old surface and compiles the
  attempt again without it.
- A failed attempt is rolled back on the client: surfaces it created are
  deleted, and surfaces from earlier turns that it changed are restored from
  the messages of the turns that succeeded. When the stream or the checks
  rejected the response, the turn then retries once, sending the model its
  response with the error list.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import AsyncIterator, Collection, Sequence
from dataclasses import dataclass, field
import json
import logging
import re
import time
from typing import Any
import uuid

from a2ui.core import A2uiError, A2uiIntegrityError, CatalogApi
from a2ui.inference_formats.express import ExpressFormat
from a2ui.parser import A2uiPart, TextPart
from a2ui.utils import RendererState
from a2ui_react_app import ReactAppTransformer

from .model import ChatMessage, ModelClient, Usage

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 2
"""The first try plus one automatic retry on validation errors."""

_ENVELOPES = ("createSurface", "updateComponents", "updateDataModel", "deleteSurface")
_OPEN_TAG = "<a2ui>"
_REACT_APP_CALL_RE = re.compile(r"\bReactApp\s*\(")
_TITLE_RE = re.compile(r'\btitle\s*=\s*"([^"\n]{0,80})"')
_HEIGHT_RE = re.compile(r"\bheight\s*=\s*(\d{2,4})")
_SURFACE_EXISTS_RE = re.compile(r"Surface (\S+) already exists")


def now_ms() -> float:
    """Wall-clock time in epoch milliseconds, the clock every timing uses."""
    return time.time() * 1000


def surface_of(message: dict[str, Any]) -> str | None:
    """The surface a message targets, if any."""
    for envelope in _ENVELOPES:
        body = message.get(envelope)
        if isinstance(body, dict) and isinstance(body.get("surfaceId"), str):
            return str(body["surfaceId"])
    return None


def _a2ui_event(message: dict[str, Any], attempt: int) -> SseEvent:
    return SseEvent("a2ui", {"message": message, "attempt": attempt})


def _delete(surface_id: str) -> dict[str, Any]:
    return {"version": "1.0", "deleteSurface": {"surfaceId": surface_id}}


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
    notes: list[str] = field(default_factory=list)
    """Problems the client reported since the last turn, told to the model next turn."""

    def surface_ids(self) -> set[str]:
        """The surfaces that successful turns created and didn't delete."""
        alive: set[str] = set()
        for message in self.committed:
            surface_id = surface_of(message)
            if surface_id is None:
                continue
            if "createSurface" in message:
                alive.add(surface_id)
            elif "deleteSurface" in message:
                alive.discard(surface_id)
        return alive

    def commit(
        self, messages: Sequence[dict[str, Any]], replaced: Collection[str]
    ) -> None:
        """Records a successful attempt; surfaces it replaced lose their old messages."""
        self.committed = [m for m in self.committed if surface_of(m) not in replaced]
        self.committed.extend(messages)


@dataclass
class _Attempt:
    number: int
    started: float
    raw: list[str] = field(default_factory=list)
    sent: list[dict[str, Any]] = field(default_factory=list)
    replaced: set[str] = field(default_factory=set)
    react_apps: list[dict[str, Any]] = field(default_factory=list)
    pending_apps: int = 0
    errors: list[str] = field(default_factory=list)
    retryable: bool = True
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
            "replacedSurfaces": sorted(self.replaced),
            "durationMs": round((self.finished or now_ms()) - self.started, 1),
            "firstTokenMs": (
                round(self.first_token - self.started, 1) if self.first_token else None
            ),
            "usage": self.usage.to_json(),
        }


class _Parse:
    """The Express stream and the checks of one attempt, over one renderer state."""

    def __init__(self, fmt: ExpressFormat, state: RendererState) -> None:
        self.stream = fmt.create_parser().open_stream(state=state)
        self.transformer = ReactAppTransformer(on_error="raise")


def action_prompt(action: dict[str, Any]) -> str:
    """The user message that tells the model about a button press."""
    context = json.dumps(action.get("context") or {}, ensure_ascii=False)
    return (
        f"[action] The user pressed `{action.get('name')}` on surface"
        f" `{action.get('surfaceId')}` (component `{action.get('sourceComponentId')}`)"
        f" with these values: {context}"
    )


def app_error_prompt(app_error: dict[str, Any]) -> str:
    """The user message that asks the model to repair an app that failed in the browser."""
    return (
        f"[app error] The ReactApp `{app_error.get('componentId') or '?'}` on surface"
        f" `{app_error.get('surfaceId')}` failed in the browser during"
        f" {app_error.get('phase') or 'run'}: {app_error.get('message')}\n"
        "Fix the app: write that ReactApp component again under the same id and"
        " surface, without `root`, so only that component changes. Reply with one"
        " short sentence and the fix."
    )


def retry_prompt(errors: Sequence[str]) -> str:
    """The user message that asks the model to fix its response."""
    listed = "\n".join(f"- {e}" for e in errors)
    return (
        "Your previous response could not be shown because of these problems:\n"
        f"{listed}\n\nWrite the whole response again with these problems fixed,"
        " and keep everything else the same."
    )


def _with_notes(conversation: Conversation, user_text: str) -> str:
    """Prepends the problems the client reported since the last turn, once."""
    if not conversation.notes:
        return user_text
    notes = "\n".join(f"- {note}" for note in conversation.notes)
    conversation.notes.clear()
    return (
        "[client notes] Since your last answer, the page"
        f" reported:\n{notes}\n\n{user_text}"
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
        """Runs one turn and yields its events, always ending with `debug` and `done`.

        Args:
            conversation: The conversation; updated when the turn succeeds.
            user_text: The user message sent to the model.
            key: The recording key (the prompt, or `action:<name>`).
        """
        turn_id = uuid.uuid4().hex[:12]
        timings: dict[str, float] = {"received": now_ms()}
        attempts: list[_Attempt] = []
        final: _Attempt | None = None
        failure: str | None = None
        logged = False
        message = _with_notes(conversation, user_text)

        def summary() -> dict[str, Any]:
            shown = final or (attempts[-1] if attempts else None)
            usage = Usage(
                prompt_tokens=sum(a.usage.prompt_tokens for a in attempts),
                output_tokens=sum(a.usage.output_tokens for a in attempts),
                thoughts_tokens=sum(a.usage.thoughts_tokens for a in attempts),
            )
            return {
                "turnId": turn_id,
                "model": self._model.name,
                "mode": self._model.mode,
                "promptChars": len(self._system_prompt),
                "express": shown.text if shown else "",
                "messages": shown.sent if shown else [],
                "reactApps": shown.react_apps if shown else [],
                "attempts": [a.to_json() for a in attempts],
                "retries": max(0, len(attempts) - 1),
                "ok": final is not None,
                "error": failure,
                "timings": timings,
                "usage": usage.to_json(),
            }

        def log(debug: dict[str, Any]) -> None:
            nonlocal logged
            logged = True
            logger.info(
                "turn",
                extra={
                    "json": {
                        "event": "turn",
                        "conversationId": conversation.id,
                        "key": key,
                        **{k: v for k, v in debug.items() if k != "messages"},
                        "durationsMs": {
                            name: round(at - timings["received"], 1)
                            for name, at in timings.items()
                        },
                    }
                },
            )

        try:
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
            history = [*conversation.history, ChatMessage("user", message)]
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
                for event in self._rollback(conversation, attempt):
                    yield event
                if number < MAX_ATTEMPTS and attempt.retryable:
                    yield SseEvent(
                        "retry", {"attempt": number + 1, "errors": attempt.errors}
                    )
                    history = [
                        *history,
                        ChatMessage("model", attempt.text),
                        ChatMessage("user", retry_prompt(attempt.errors)),
                    ]
                    continue
                failure = (
                    "The model's response failed validation twice."
                    if attempt.retryable
                    else f"The turn failed: {attempt.errors[0]}"
                )
                yield SseEvent("error", {"message": failure, "errors": attempt.errors})
                break
            if final is not None:
                conversation.history.extend(
                    [ChatMessage("user", message), ChatMessage("model", final.text)]
                )
                conversation.commit(final.sent, final.replaced)
            timings["streamDone"] = now_ms()
            yield SseEvent(
                "timing", {"checkpoint": "streamDone", "at": timings["streamDone"]}
            )
            debug = summary()
            log(debug)
            yield SseEvent("debug", debug)
            yield SseEvent(
                "done", {"turnId": turn_id, "ok": final is not None, "timings": timings}
            )
        finally:
            # The client went away, or something unexpected escaped: still log the turn.
            if not logged:
                failure = failure or "The turn ended early."
                log(summary())

    async def _stream_attempt(
        self,
        conversation: Conversation,
        history: Sequence[ChatMessage],
        attempt: _Attempt,
        timings: dict[str, float],
        key: str,
    ) -> AsyncIterator[SseEvent]:
        """Streams one model call, filling `attempt`; errors end up in `attempt.errors`."""
        parse = self._open_parse(conversation, attempt.replaced)
        try:
            call = self._model.stream(
                self._system_prompt, history, key=key, attempt=attempt.number
            )
        except LookupError as e:
            attempt.errors.append(str(e))
            attempt.retryable = False
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
                events, parse = self._advance(
                    conversation, parse, attempt, timings, chunk
                )
                for event in events:
                    yield event
                pending = self._pending_app(attempt)
                if pending is not None:
                    yield pending
            events, parse = self._advance(conversation, parse, attempt, timings, None)
            for event in events:
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
        except Exception as e:  # The model call failed (quota, network): no retry.
            attempt.errors.append(f"{type(e).__name__}: {e}")
            attempt.retryable = False
            logger.exception("attempt_failed")
        finally:
            close = getattr(chunks, "aclose", None)
            if close is not None:
                await close()

    def _open_parse(
        self, conversation: Conversation, exclude: Collection[str]
    ) -> _Parse:
        """A fresh parse over the committed state, without the surfaces in `exclude`."""
        state = RendererState(self._catalogs)
        committed = [m for m in conversation.committed if surface_of(m) not in exclude]
        if committed:
            state.apply(committed)
        return _Parse(self._format, state)

    def _advance(
        self,
        conversation: Conversation,
        parse: _Parse,
        attempt: _Attempt,
        timings: dict[str, float],
        chunk: str | None,
    ) -> tuple[list[SseEvent], _Parse]:
        """Feeds a chunk (or closes the stream for None) and returns the events.

        When the attempt rewrites a surface from an earlier turn, the old surface
        is deleted and the attempt's text so far is parsed again without it.
        Messages already sent that the new parse repeats aren't sent twice.
        """
        try:
            parts = (
                parse.stream.feed(chunk) if chunk is not None else parse.stream.close()
            )
            return self._handle_parts(parts, parse.transformer, attempt, timings), parse
        except A2uiIntegrityError as e:
            match = _SURFACE_EXISTS_RE.search(str(e))
            surface_id = match.group(1).rstrip(".") if match else None
            if (
                surface_id is None
                or surface_id in attempt.replaced
                or surface_id not in conversation.surface_ids()
            ):
                raise
        attempt.replaced.add(surface_id)
        events = [_a2ui_event(_delete(surface_id), attempt.number)]
        logger.info(
            "surface_replaced",
            extra={"json": {"event": "surface_replaced", "surfaceId": surface_id}},
        )
        attempt.sent = [m for m in attempt.sent if surface_of(m) != surface_id]
        already = Counter(json.dumps(m, sort_keys=True) for m in attempt.sent)
        sent_before = list(attempt.sent)
        attempt.sent = []
        attempt.react_apps = []
        parse = self._open_parse(conversation, attempt.replaced)
        parts = parse.stream.feed(attempt.text)
        if chunk is None:
            parts += parse.stream.close()
        for event in self._handle_parts(parts, parse.transformer, attempt, timings):
            if event.event == "a2ui":
                key = json.dumps(event.data["message"], sort_keys=True)
                if already[key] > 0:
                    already[key] -= 1
                    continue
            elif event.event == "text":
                continue  # The prose was sent the first time.
            events.append(event)
        # Keep messages sent earlier that the new parse no longer produced.
        for message in sent_before:
            if already[json.dumps(message, sort_keys=True)] > 0:
                attempt.sent.append(message)
        return events, parse

    def _rollback(
        self, conversation: Conversation, attempt: _Attempt
    ) -> list[SseEvent]:
        """Events that undo what a failed attempt showed on the client."""
        existing = conversation.surface_ids()
        touched: dict[str, None] = {}
        for message in attempt.sent:
            surface_id = surface_of(message)
            if surface_id is not None:
                touched[surface_id] = None
        for surface_id in attempt.replaced:
            touched[surface_id] = None
        events: list[SseEvent] = []
        for surface_id in touched:
            if surface_id not in existing:
                events.append(_a2ui_event(_delete(surface_id), attempt.number))
                continue
            # Restore a surface from an earlier turn from the messages that built it.
            events.append(SseEvent("restore_surface", {"surfaceId": surface_id}))
            events.append(_a2ui_event(_delete(surface_id), attempt.number))
            events.extend(
                _a2ui_event(message, attempt.number)
                for message in conversation.committed
                if surface_of(message) == surface_id
            )
        return events

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
                events.append(_a2ui_event(message, attempt.number))
                if "firstA2ui" not in timings:
                    timings["firstA2ui"] = now_ms()
                    events.append(
                        SseEvent(
                            "timing",
                            {"checkpoint": "firstA2ui", "at": timings["firstA2ui"]},
                        )
                    )
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
