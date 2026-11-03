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

"""An ADK model that replays the scenario a conversation opened with.

`HubScriptedLlm` stands in for a real model. It reads the request ADK built,
picks the scenario and turn from it, and streams that turn's scripted chunks.
Nothing is kept between requests, so what the model answers depends only on
what the request holds, as it would for a real model:

- The scenario is the one whose turn 0 `userText` is the first user content
  of the request.
- The protocol version is read from the catalog id the agent's instruction
  names (`.../specification/v1_0/...` or `.../v0_9/...`), so a v0.9 renderer
  gets the scenario's v0.9.1 copy.
- The turn is the position of the latest user content among the user contents
  that carry text. A turn with `userText: null` therefore starts only when the
  renderer's message for the previous turn's `expectOutbound` has arrived as
  user content; a request whose latest user content carries no text, such as
  one holding only RPC parts, gets no reply.
- When the instruction holds no A2UI snippet, because the renderer sent no
  capabilities, the model answers with the turn's text parts only.

Every request is appended to a `RequestLog`, which the server exposes on
`GET /e2e/log` so a test can check what the model was shown.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from dataclasses import asdict, dataclass, field
import re
import threading
from typing import Any

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types as genai_types
from pydantic import Field

from .scenarios import Scenario, ScenarioIndex, Turn, normalize_version

__all__ = [
    "HubScriptedLlm",
    "ModelRequestRecord",
    "RequestLog",
]

_CATALOG_VERSION = re.compile(r"a2ui\.org/specification/v(\d+(?:_\d+)+)/")
_SNIPPET_MARKERS = ("<a2ui>", "<a2ui-json>")


@dataclass
class ModelRequestRecord:
    """What one model request held and how the model answered it."""

    system_instruction: str
    user_contents: list[str]
    version: str | None
    a2ui_enabled: bool
    format: str
    scenario: str | None = None
    turn: int | None = None
    chunks: int = 0
    text: str = ""
    note: str | None = None


class RequestLog:
    """The requests a `HubScriptedLlm` got, oldest first."""

    def __init__(self) -> None:
        self._records: list[ModelRequestRecord] = []
        self._lock = threading.Lock()

    def append(self, record: ModelRequestRecord) -> None:
        with self._lock:
            self._records.append(record)

    def clear(self) -> None:
        with self._lock:
            self._records.clear()

    @property
    def records(self) -> list[ModelRequestRecord]:
        with self._lock:
            return list(self._records)

    def to_json(self) -> list[dict[str, Any]]:
        return [asdict(record) for record in self.records]

    def __len__(self) -> int:
        with self._lock:
            return len(self._records)


@dataclass
class _Selection:
    """The scenario and turn a request resolves to, or why it does not."""

    scenario: Scenario | None = None
    turn: Turn | None = None
    note: str | None = None
    reply_text: str | None = None
    history: list[str] = field(default_factory=list)


def _instruction_text(llm_request: LlmRequest) -> str:
    instruction = llm_request.config.system_instruction if llm_request.config else None
    if instruction is None:
        return ""
    if isinstance(instruction, str):
        return instruction
    if isinstance(instruction, genai_types.Content):
        return "".join(part.text or "" for part in instruction.parts or [])
    if isinstance(instruction, list):
        return "".join(
            item if isinstance(item, str) else (getattr(item, "text", None) or "")
            for item in instruction
        )
    return str(instruction)


def _user_texts(llm_request: LlmRequest) -> list[str]:
    """The text of each user content that carries text, oldest first."""
    texts: list[str] = []
    for content in llm_request.contents or []:
        if content.role != "user":
            continue
        text = "\n".join(
            part.text for part in content.parts or [] if part.text and not part.thought
        ).strip()
        if text:
            texts.append(text)
    return texts


def _version_from_instruction(instruction: str) -> str | None:
    match = _CATALOG_VERSION.search(instruction)
    return normalize_version(match.group(1)) if match else None


def _has_snippet(instruction: str) -> bool:
    return any(marker in instruction for marker in _SNIPPET_MARKERS)


class HubScriptedLlm(BaseLlm):
    """A model that answers each request with a scripted scenario turn.

    Attributes:
        scenarios: The loaded scenarios.
        format_name: The inference format whose chunks are streamed, as the
            scenario files name it (`direct_json` or `express`).
        chunk_delay_ms: The pause before each streamed chunk, so a renderer's
            progressive rendering can be observed.
        log: Where every request is recorded.
    """

    model: str = "a2ui-e2e-scripted"
    scenarios: ScenarioIndex
    format_name: str = "direct_json"
    chunk_delay_ms: int = 0
    log: RequestLog = Field(default_factory=RequestLog)

    @classmethod
    def supported_models(cls) -> list[str]:
        return ["a2ui-e2e-scripted"]

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        instruction = _instruction_text(llm_request)
        user_texts = _user_texts(llm_request)
        version = _version_from_instruction(instruction)
        a2ui_enabled = version is not None and _has_snippet(instruction)
        record = ModelRequestRecord(
            system_instruction=instruction,
            user_contents=user_texts,
            version=version,
            a2ui_enabled=a2ui_enabled,
            format=self.format_name,
        )
        selection = self._select(user_texts, version)
        record.scenario = selection.scenario.name if selection.scenario else None
        record.turn = selection.turn.index if selection.turn else None
        record.note = selection.note

        chunks = self._chunks(selection, a2ui_enabled)
        record.chunks = len(chunks) if stream else min(len(chunks), 1)
        record.text = "".join(chunks)
        self.log.append(record)

        if not chunks:
            return
        if not stream or not a2ui_enabled:
            yield _response("".join(chunks))
            return
        for chunk in chunks:
            if self.chunk_delay_ms > 0:
                await asyncio.sleep(self.chunk_delay_ms / 1000)
            yield _response(chunk, partial=True)
        # ADK's own models end a stream with the whole text in one response,
        # which the A2UI event converter drops when it streamed the chunks.
        yield _response("".join(chunks))

    def _select(self, user_texts: list[str], version: str | None) -> _Selection:
        """Picks the scenario and turn the request's user contents name."""
        if not user_texts:
            return _Selection(note="The request holds no user text; nothing to reply.")
        opening = user_texts[0]
        lookup_version = version
        if lookup_version is None:
            # Without capabilities there is no version to replay; use the
            # newest copy of the scenario, whose text parts are the same.
            versions = self.scenarios.versions_of(opening)
            lookup_version = versions[-1] if versions else "1.0"
        scenario = self.scenarios.find(opening, lookup_version)
        if scenario is None:
            known = self.scenarios.versions_of(opening)
            if known:
                note = (
                    f"No v{lookup_version} copy of the scenario opening with"
                    f" {opening!r}; it exists for {', '.join(known)}."
                )
            else:
                note = f"No scenario opens with {opening!r}."
            return _Selection(note=note, reply_text=note, history=user_texts)
        turn_index = len(user_texts) - 1
        if turn_index >= len(scenario.turns):
            note = (
                f"Scenario '{scenario.name}' has {len(scenario.turns)} turns;"
                f" this is user content {turn_index + 1}."
            )
            return _Selection(scenario=scenario, note=note, reply_text=note)
        turn = scenario.turns[turn_index]
        mismatch: str | None = None
        if turn.user_text is not None and " ".join(turn.user_text.split()) != " ".join(
            user_texts[-1].split()
        ):
            mismatch = (
                f"Turn {turn_index} expects user text {turn.user_text!r};"
                f" got {user_texts[-1]!r}."
            )
        return _Selection(scenario=scenario, turn=turn, note=mismatch)

    def _chunks(self, selection: _Selection, a2ui_enabled: bool) -> list[str]:
        if selection.turn is None:
            return [selection.reply_text] if selection.reply_text else []
        turn = selection.turn
        if not a2ui_enabled:
            return [turn.text] if turn.text else []
        try:
            return turn.chunks_for(self.format_name)
        except KeyError:
            return [
                f"Scenario '{selection.scenario.name if selection.scenario else '?'}'"
                f" scripts no '{self.format_name}' chunks for turn {turn.index}."
            ]


def _response(text: str, *, partial: bool = False) -> LlmResponse:
    return LlmResponse(
        content=genai_types.Content(role="model", parts=[genai_types.Part(text=text)]),
        partial=partial if partial else None,
    )
