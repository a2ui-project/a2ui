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

"""Model clients: live Gemini streaming, and recording and replay for tests."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
import json
from pathlib import Path
import re
import time
from typing import Literal, Protocol

from google import genai
from google.genai import types

DEFAULT_MODEL = "gemini-3.5-flash"


@dataclass(frozen=True)
class ChatMessage:
    """One message of the conversation history."""

    role: Literal["user", "model"]
    text: str


@dataclass
class Usage:
    """Token counts of one model call."""

    prompt_tokens: int = 0
    output_tokens: int = 0
    thoughts_tokens: int = 0

    def to_json(self) -> dict[str, int]:
        return {
            "promptTokens": self.prompt_tokens,
            "outputTokens": self.output_tokens,
            "thoughtsTokens": self.thoughts_tokens,
        }


@dataclass
class ModelCall:
    """A streamed model call: the text chunks, then `usage` once they ran out."""

    chunks: AsyncIterator[str]
    usage: Usage = field(default_factory=Usage)


class ModelClient(Protocol):
    """Streams a model response for a system prompt and a conversation."""

    @property
    def name(self) -> str:
        """The model name, shown in the Performance tab."""
        ...

    @property
    def mode(self) -> Literal["live", "replay"]:
        """`live` for a real model, `replay` for recorded responses."""
        ...

    def stream(
        self,
        system_prompt: str,
        history: Sequence[ChatMessage],
        *,
        key: str,
        attempt: int,
    ) -> ModelCall:
        """Starts a call.

        Args:
            system_prompt: The system instruction.
            history: The conversation, ending with the user message to answer.
            key: Identifies the request for recording and replay: the user
                prompt, or `action:<name>` for an action.
            attempt: 1 for the first try, 2 for the retry after validation errors.
        """
        ...


class GeminiModel:
    """Streams from the Gemini API with `google-genai`."""

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        *,
        api_key: str | None = None,
        thinking_level: str | None = "low",
    ) -> None:
        self._model = model
        self._client = genai.Client(api_key=api_key)
        self._thinking_level = thinking_level

    @property
    def name(self) -> str:
        return self._model

    @property
    def mode(self) -> Literal["live", "replay"]:
        return "live"

    def stream(
        self,
        system_prompt: str,
        history: Sequence[ChatMessage],
        *,
        key: str,
        attempt: int,
    ) -> ModelCall:
        del key, attempt  # Only replay uses them.
        call = ModelCall(chunks=_empty())
        call.chunks = self._chunks(system_prompt, history, call.usage)
        return call

    async def _chunks(
        self, system_prompt: str, history: Sequence[ChatMessage], usage: Usage
    ) -> AsyncIterator[str]:
        config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            thinking_config=(
                types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel(self._thinking_level.upper())
                )
                if self._thinking_level
                else None
            ),
        )
        contents = [
            types.Content(role=m.role, parts=[types.Part(text=m.text)]) for m in history
        ]
        stream = await self._client.aio.models.generate_content_stream(
            model=self._model, contents=contents, config=config
        )
        async for chunk in stream:
            meta = chunk.usage_metadata
            if meta is not None:
                usage.prompt_tokens = meta.prompt_token_count or usage.prompt_tokens
                usage.output_tokens = meta.candidates_token_count or usage.output_tokens
                usage.thoughts_tokens = (
                    meta.thoughts_token_count or usage.thoughts_tokens
                )
            if chunk.text:
                yield chunk.text


async def _empty() -> AsyncIterator[str]:
    return
    yield  # pragma: no cover


def recording_key(text: str) -> str:
    """Normalizes a prompt into the key recordings are stored under."""
    return re.sub(r"\s+", " ", text.strip().lower())


@dataclass
class _Recording:
    chunks: list[str]
    offsets_ms: list[float]
    usage: Usage
    model: str


class ReplayModel:
    """Replays recorded responses, chunk by chunk, with the recorded timing.

    Recordings are JSON files in a directory, each `{"entries": [...]}` where
    an entry is `{"key", "attempt", "model", "chunks": [{"t", "text"}],
    "usage"}`. `t` is the chunk's arrival in milliseconds after the call.
    """

    def __init__(self, directory: Path, *, speed: float = 1.0) -> None:
        self._speed = speed
        self._entries: dict[tuple[str, int], _Recording] = {}
        for path in sorted(directory.glob("*.json")):
            for entry in json.loads(path.read_text(encoding="utf-8"))["entries"]:
                usage = entry.get("usage", {})
                self._entries[
                    (recording_key(entry["key"]), int(entry.get("attempt", 1)))
                ] = _Recording(
                    chunks=[c["text"] for c in entry["chunks"]],
                    offsets_ms=[float(c.get("t", 0)) for c in entry["chunks"]],
                    usage=Usage(
                        prompt_tokens=usage.get("promptTokens", 0),
                        output_tokens=usage.get("outputTokens", 0),
                        thoughts_tokens=usage.get("thoughtsTokens", 0),
                    ),
                    model=entry.get("model", DEFAULT_MODEL),
                )
        self._model = (
            next(iter(self._entries.values())).model if self._entries else DEFAULT_MODEL
        )

    @property
    def name(self) -> str:
        return self._model

    @property
    def mode(self) -> Literal["live", "replay"]:
        return "replay"

    def stream(
        self,
        system_prompt: str,
        history: Sequence[ChatMessage],
        *,
        key: str,
        attempt: int,
    ) -> ModelCall:
        del system_prompt, history  # The recording already holds the answer.
        recording = self._entries.get((recording_key(key), attempt))
        if recording is None:
            raise LookupError(f"No recording for {key!r} (attempt {attempt}).")
        return ModelCall(chunks=self._chunks(recording), usage=recording.usage)

    async def _chunks(self, recording: _Recording) -> AsyncIterator[str]:
        start = time.monotonic()
        for text, offset in zip(recording.chunks, recording.offsets_ms):
            wait = offset / 1000 / self._speed - (time.monotonic() - start)
            if wait > 0:
                await asyncio.sleep(wait)
            yield text


class RecordingModel:
    """Wraps a live model and saves every response for `ReplayModel`."""

    def __init__(self, inner: ModelClient, path: Path) -> None:
        self._inner = inner
        self._path = path

    @property
    def name(self) -> str:
        return self._inner.name

    @property
    def mode(self) -> Literal["live", "replay"]:
        return self._inner.mode

    def stream(
        self,
        system_prompt: str,
        history: Sequence[ChatMessage],
        *,
        key: str,
        attempt: int,
    ) -> ModelCall:
        inner = self._inner.stream(system_prompt, history, key=key, attempt=attempt)
        call = ModelCall(chunks=_empty(), usage=inner.usage)
        call.chunks = self._record(inner, key, attempt)
        return call

    async def _record(
        self, inner: ModelCall, key: str, attempt: int
    ) -> AsyncIterator[str]:
        start = time.monotonic()
        chunks: list[dict[str, object]] = []
        async for text in inner.chunks:
            chunks.append(
                {"t": round((time.monotonic() - start) * 1000, 1), "text": text}
            )
            yield text
        self._save({
            "key": key,
            "attempt": attempt,
            "model": self._inner.name,
            "chunks": chunks,
            "usage": inner.usage.to_json(),
        })

    def _save(self, entry: dict[str, object]) -> None:
        document: dict[str, list[dict[str, object]]] = {"entries": []}
        if self._path.exists():
            document = json.loads(self._path.read_text(encoding="utf-8"))
        key = recording_key(str(entry["key"]))
        # A first attempt starts a new recording of the key: drop its old retries.
        document["entries"] = [
            e
            for e in document["entries"]
            if recording_key(str(e["key"])) != key
            or (entry["attempt"] != 1 and e.get("attempt", 1) != entry["attempt"])
        ] + [entry]
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(document, indent=1) + "\n", encoding="utf-8")
