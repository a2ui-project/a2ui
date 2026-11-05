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

"""The music agent: Gemini with database tools, writing Express with macros."""

from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import os
import time
from typing import Any, Literal

from google import genai
from google.genai import errors, types

from a2ui.core import A2uiError

from liner_notes import database, scripted
from liner_notes.runtime import A2uiRuntime, RenderedTurn

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-3.6-flash"
MAX_HISTORY_MESSAGES = 20
API_RETRY_DELAYS_S = (1.0, 3.0)
# Bounds latency: each tool round trip is another model call.
MAX_TOOL_ROUND_TRIPS = 4

ROLE_PROMPT = """\
You are Liner Notes, a friendly music guide. You answer questions about the
artists in a small demo music database and show rich UI built from A2UI
components.

## How to respond

1. Start with one or two short, conversational sentences that answer the
   question directly.
2. Then add one `<a2ui>` block that shows the answer visually.
3. Do not write `surface(...)`. Do not repeat in text what the UI already shows.

## Choosing components

Prefer the high-level macros. They take ids and load accurate data from the
database themselves, so never copy album lists, tour dates or bios into the UI.
- Discography(artistId): "what albums...", "discography".
- AlbumSpotlight(albumId): one album or its tracklist. Album ids come from
  `get_artist_facts`.
- TourSchedule(artistId): tours, concerts, gigs, tickets.
- ArtistProfile(artistId): "tell me about...", "who is...".
- CareerTimeline(artistId): history, career, milestones.
- ArtistComparison(artistIds): comparing two to four artists.
- ArtistGrid(title, artistIds): lists of artists such as search results or
  recommendations.
- FactCard(headline, body, icon): a fact or answer you write yourself, such as
  trivia. Only state facts that come from `get_artist_facts`.

Combine them in a `Column` when the question has several parts, for example
`root = Column([ArtistProfile("nina-simone"), CareerTimeline("nina-simone")])`.
You may also compose basic components (Card, Row, Column, Text) with music
components (GenreTags, AlbumArt, ArtistAvatar, Timeline, TrackList, DateBadge)
when no macro fits.

## Data

Call `find_artists` to search (it also searches facts, so `find_artists("Grammy")`
finds award winners) and `get_artist_facts` for details. Ask for every artist
you need in a single `get_artist_facts` call. Only use ids from the roster below. If the user asks about an artist who is not in the
roster, say the demo database doesn't include them and suggest similar artists
from the roster with an ArtistGrid.

Today's date is {today}. Tour dates in the database are fictional.

## Artist roster

{roster}
"""


def find_artists(query: str = "", touring: bool | None = None) -> dict[str, Any]:
    """Searches the music database. Matches names, places, regions, genres, bios, facts, career milestones and album titles.

    Args:
        query: One keyword or phrase, such as "Africa", "jazz", "Grammy" or "Homogenic". Leave empty to list everyone.
        touring: If set, only return artists who are (true) or are not (false) touring.

    Returns:
        Matching artist summaries.
    """
    return {"artists": [a.summary() for a in database.find_artists(query, touring)]}


def get_artist_facts(artistIds: list[str]) -> dict[str, Any]:
    """Returns everything the database knows about one or more artists: bio, facts, timeline, albums (with album ids) and tour dates. Pass every artist you need in one call.

    Args:
        artistIds: Artist ids from the roster.
    """
    results: dict[str, Any] = {}
    for artist_id in artistIds:
        try:
            results[artist_id] = database.get_artist(artist_id).to_json()
        except database.UnknownRecordError as e:
            results[artist_id] = {"error": str(e)}
    return {"artists": results}


@dataclasses.dataclass
class ToolCall:
    name: str
    args: dict[str, Any]


@dataclasses.dataclass
class AgentTurn:
    """One assistant turn, plus the debug details the client shows."""

    surface_id: str
    text: str
    messages: list[dict[str, Any]]
    model_output: str
    mode: Literal["live", "scripted", "action"]
    latency_ms: int
    tool_calls: list[ToolCall] = dataclasses.field(default_factory=list)
    macro_calls: list[str] = dataclasses.field(default_factory=list)
    inference_component_count: int = 0
    transport_component_count: int = 0
    attempts: int = 1
    input_tokens: int | None = None
    output_tokens: int | None = None
    error: str | None = None


@dataclasses.dataclass
class Session:
    history: list[types.Content] = dataclasses.field(default_factory=list)
    turn_count: int = 0

    def next_surface_id(self) -> str:
        self.turn_count += 1
        return f"turn-{self.turn_count}"

    def remember(self, user_text: str, model_text: str) -> None:
        self.history.append(types.UserContent(parts=[types.Part(text=user_text)]))
        self.history.append(types.ModelContent(parts=[types.Part(text=model_text)]))
        del self.history[:-MAX_HISTORY_MESSAGES]


class MusicAgent:
    """Answers prompts and button actions for many in-memory sessions."""

    def __init__(self, api_key: str | None, model: str = DEFAULT_MODEL) -> None:
        self.runtime = A2uiRuntime()
        self.model = model
        self.client = genai.Client(api_key=api_key) if api_key else None
        self.sessions: dict[str, Session] = {}
        roster = "\n".join(
            json.dumps(a.summary(), ensure_ascii=False) for a in database.ARTISTS
        )
        role = ROLE_PROMPT.format(today=time.strftime("%Y-%m-%d"), roster=roster)
        self.system_prompt = f"{role}\n\n{self.runtime.prompt_snippet}"

    @property
    def mode(self) -> Literal["live", "scripted"]:
        return "live" if self.client else "scripted"

    def _session(self, conversation_id: str) -> Session:
        return self.sessions.setdefault(conversation_id, Session())

    async def respond(self, conversation_id: str, prompt: str) -> AgentTurn:
        session = self._session(conversation_id)
        surface_id = session.next_surface_id()
        start = time.perf_counter()
        if self.client is None:
            output = scripted.scripted_response(prompt)
            turn = self._render(output, surface_id, "scripted", start)
        else:
            try:
                turn = await self._respond_live(session, prompt, surface_id, start)
            except errors.APIError as e:
                logger.exception("Gemini request failed")
                turn = self._error_turn(surface_id, start, f"Gemini API error: {e}")
                turn.text = (
                    "Sorry, the model is unavailable right now. Please try again."
                )
        session.remember(prompt, turn.model_output)
        return turn

    async def handle_action(
        self,
        conversation_id: str,
        name: str,
        context: dict[str, Any],
        user_message: str | None,
    ) -> AgentTurn:
        session = self._session(conversation_id)
        surface_id = session.next_surface_id()
        start = time.perf_counter()
        try:
            output = scripted.action_response(name, context)
        except database.UnknownRecordError as e:
            output = None
            name = f"{name} ({e})"
        if output is None:
            turn = self._error_turn(surface_id, start, f"Unknown action '{name}'.")
        else:
            turn = self._render(output, surface_id, "action", start)
        session.remember(user_message or f"[clicked {name}]", turn.model_output)
        return turn

    async def _respond_live(
        self, session: Session, prompt: str, surface_id: str, start: float
    ) -> AgentTurn:
        assert self.client is not None
        contents = [*session.history, _user(prompt)]
        tool_calls: list[ToolCall] = []
        usage = [0, 0]
        output = ""
        error: str | None = None
        for attempt in (1, 2):
            # The retry has the tool results in its history, so it must answer.
            response = await self._generate(contents, allow_tools=attempt == 1)
            tool_calls.extend(_tool_calls(response))
            if response.automatic_function_calling_history:
                contents = list(response.automatic_function_calling_history)
            if response.usage_metadata:
                usage[0] += response.usage_metadata.prompt_token_count or 0
                usage[1] += response.usage_metadata.candidates_token_count or 0
            output = response.text or ""
            if not output.strip():
                # Usually the tool round-trip limit was hit mid-research.
                error = "The model returned no text."
                logger.warning("Attempt %d returned no text", attempt)
                contents.append(_user("Answer now with the facts you already have."))
                continue
            try:
                rendered = self.runtime.render(output, surface_id)
            except Exception as e:  # Any failure is fed back to the model once.
                error = f"{type(e).__name__}: {e}"
                if not isinstance(e, A2uiError):
                    logger.exception("Unexpected error rendering model output")
                logger.warning("Attempt %d produced invalid A2UI: %s", attempt, e)
                contents += [
                    types.ModelContent(parts=[types.Part(text=output)]),
                    _user(
                        f"Your <a2ui> block failed validation: {error}\nReply again"
                        " in full with a corrected block."
                    ),
                ]
                continue
            return self._turn(
                rendered,
                output,
                surface_id,
                "live",
                start,
                tool_calls=tool_calls,
                attempts=attempt,
                input_tokens=usage[0],
                output_tokens=usage[1],
            )
        turn = self._error_turn(surface_id, start, error or "Unknown error")
        turn.model_output = output
        turn.text = _strip_a2ui(output) or "Sorry, I couldn't build that view."
        turn.tool_calls = tool_calls
        turn.attempts = 2
        return turn

    async def _generate(
        self, contents: list[types.Content], allow_tools: bool = True
    ) -> types.GenerateContentResponse:
        """Calls Gemini, retrying rate limits and server errors with backoff."""
        assert self.client is not None
        for delay in (*API_RETRY_DELAYS_S, None):
            try:
                return await self.client.aio.models.generate_content(
                    model=self.model,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=self.system_prompt,
                        tools=[find_artists, get_artist_facts] if allow_tools else None,
                        automatic_function_calling=types.AutomaticFunctionCallingConfig(
                            maximum_remote_calls=MAX_TOOL_ROUND_TRIPS
                        ),
                        thinking_config=types.ThinkingConfig(
                            thinking_level=types.ThinkingLevel.LOW
                        ),
                    ),
                )
            except errors.APIError as e:
                transient = isinstance(e, errors.ServerError) or e.code == 429
                if delay is None or not transient:
                    raise
                logger.warning("Gemini error %s, retrying in %ss", e.code, delay)
                await asyncio.sleep(delay)
        raise AssertionError("unreachable")

    def _render(
        self,
        output: str,
        surface_id: str,
        mode: Literal["scripted", "action"],
        start: float,
    ) -> AgentTurn:
        try:
            rendered = self.runtime.render(output, surface_id)
        except (A2uiError, database.UnknownRecordError) as e:
            turn = self._error_turn(surface_id, start, str(e))
            turn.model_output = output
            return turn
        return self._turn(rendered, output, surface_id, mode, start)

    def _turn(
        self,
        rendered: RenderedTurn,
        output: str,
        surface_id: str,
        mode: Literal["live", "scripted", "action"],
        start: float,
        **extra: Any,
    ) -> AgentTurn:
        return AgentTurn(
            surface_id=surface_id,
            text=rendered.text,
            messages=rendered.messages,
            model_output=output,
            mode=mode,
            latency_ms=_elapsed_ms(start),
            macro_calls=rendered.macro_calls,
            inference_component_count=rendered.inference_component_count,
            transport_component_count=rendered.transport_component_count,
            **extra,
        )

    def _error_turn(self, surface_id: str, start: float, error: str) -> AgentTurn:
        return AgentTurn(
            surface_id=surface_id,
            text="Sorry, something went wrong building that view.",
            messages=[],
            model_output="",
            mode=self.mode,
            latency_ms=_elapsed_ms(start),
            error=error,
        )


def _user(text: str) -> types.Content:
    return types.UserContent(parts=[types.Part(text=text)])


def _elapsed_ms(start: float) -> int:
    return round((time.perf_counter() - start) * 1000)


def _strip_a2ui(output: str) -> str:
    head, _, rest = output.partition("<a2ui>")
    _, _, tail = rest.partition("</a2ui>")
    return f"{head}{tail}".strip()


def _tool_calls(response: types.GenerateContentResponse) -> list[ToolCall]:
    calls = []
    for content in response.automatic_function_calling_history or []:
        for part in content.parts or []:
            if part.function_call and part.function_call.name:
                calls.append(
                    ToolCall(
                        part.function_call.name, dict(part.function_call.args or {})
                    )
                )
    return calls


def create_agent() -> MusicAgent:
    """Builds the agent from GEMINI_API_KEY, GEMINI_MODEL and LINER_NOTES_MODE."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if os.environ.get("LINER_NOTES_MODE") == "scripted":
        api_key = None
    return MusicAgent(api_key, os.environ.get("GEMINI_MODEL", DEFAULT_MODEL))
