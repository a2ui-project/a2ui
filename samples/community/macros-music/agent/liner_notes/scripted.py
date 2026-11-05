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

"""Responses that need no model: example prompts in scripted mode, and actions.

Scripted mode lets the demo and its end-to-end tests run without an API key.
Action routes run in both modes, because a button press already says exactly
which macro to show.
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from liner_notes import database

EXAMPLE_PROMPTS: list[str] = [
    "What albums do the Beatles have?",
    "When is Aldous Harding touring?",
    "Tell me about Nina Simone",
    "Show me the tracklist for Björk's Homogenic",
    "Compare Fela Kuti and Kendrick Lamar",
    "Who's touring soon?",
    "Walk me through Ryuichi Sakamoto's career",
    "Give me a fun fact about Gurrumul",
    "Show me artists from Latin America",
]


def _a2ui(text: str, express: str) -> str:
    return f"{text}\n<a2ui>\n{express}\n</a2ui>"


def _ids(artists: list[database.Artist]) -> str:
    return json.dumps([a.id for a in artists])


def _touring_response() -> str:
    touring = database.find_artists(touring=True)
    return _a2ui(
        f"{len(touring)} artists in the database have upcoming shows.",
        f'root = ArtistGrid("On tour soon", {_ids(touring)})',
    )


def _latin_america_response() -> str:
    artists = database.find_artists("latin america")
    return _a2ui(
        "Here are the Latin American artists in the database.",
        f'root = ArtistGrid("Artists from Latin America", {_ids(artists)})',
    )


SCRIPTED_RESPONSES: dict[str, Callable[[], str]] = {
    EXAMPLE_PROMPTS[0]: lambda: _a2ui(
        "The Beatles released 13 albums between 1963 and 1970.",
        'root = Discography("the-beatles")',
    ),
    EXAMPLE_PROMPTS[1]: lambda: _a2ui(
        "Aldous Harding has six shows coming up, starting in Auckland in December.",
        'root = TourSchedule("aldous-harding")',
    ),
    EXAMPLE_PROMPTS[2]: lambda: _a2ui(
        "Nina Simone, the 'High Priestess of Soul', fused jazz, blues and gospel"
        " with civil rights songwriting.",
        'root = Column([ArtistProfile("nina-simone"), CareerTimeline("nina-simone")])',
    ),
    EXAMPLE_PROMPTS[3]: lambda: _a2ui(
        "Homogenic (1997) pairs strings with volcanic beats.",
        'root = AlbumSpotlight("homogenic")',
    ),
    EXAMPLE_PROMPTS[4]: lambda: _a2ui(
        "Two artists who made politics danceable, four decades apart.",
        'root = ArtistComparison(["fela-kuti", "kendrick-lamar"])',
    ),
    EXAMPLE_PROMPTS[5]: _touring_response,
    EXAMPLE_PROMPTS[6]: lambda: _a2ui(
        "Ryuichi Sakamoto went from synth-pop pioneer to Oscar-winning composer.",
        'root = CareerTimeline("ryuichi-sakamoto")',
    ),
    EXAMPLE_PROMPTS[7]: lambda: _a2ui(
        "Here's one of my favorite facts about Gurrumul.",
        'fact = FactCard("Number one in Yolŋu Matha", "Djarimirri (Child of the'
        " Rainbow) was the first album sung in an Indigenous Australian language to"
        ' reach No. 1 on the ARIA chart.", "star")\n'
        'root = Column([fact, ArtistProfile("gurrumul")])',
    ),
    EXAMPLE_PROMPTS[8]: _latin_america_response,
}


def _normalize(prompt: str) -> str:
    return re.sub(r"[^\w]+", " ", prompt.casefold()).strip()


_SCRIPTED_BY_KEY = {_normalize(p): fn for p, fn in SCRIPTED_RESPONSES.items()}


def scripted_response(prompt: str) -> str:
    """Canned response for an example prompt, or a keyword-based fallback."""
    if fn := _SCRIPTED_BY_KEY.get(_normalize(prompt)):
        return fn()
    words = _normalize(prompt)
    for artist in database.ARTISTS:
        if _normalize(artist.name) in words or artist.id.replace("-", " ") in words:
            if "tour" in words:
                return _a2ui(
                    "Here are the dates.", f'root = TourSchedule("{artist.id}")'
                )
            if "album" in words or "discograph" in words:
                return _a2ui(
                    "Here's the discography.", f'root = Discography("{artist.id}")'
                )
            if "career" in words or "timeline" in words:
                return _a2ui(
                    "Here's the timeline.", f'root = CareerTimeline("{artist.id}")'
                )
            return _a2ui(
                f"Here's {artist.name}.", f'root = ArtistProfile("{artist.id}")'
            )
    return _a2ui(
        "Scripted mode only understands the example prompts and artist names. Set"
        " GEMINI_API_KEY for free-form questions. Here's everyone in the database.",
        f'root = ArtistGrid("Artists in the database", {_ids(list(database.ARTISTS))})',
    )


def _action_express(name: str, context: dict[str, Any]) -> str | None:
    artist_id = json.dumps(str(context.get("artistId", "")))
    if name == "show_artist":
        return f"root = ArtistProfile({artist_id})"
    if name == "show_discography":
        return f"root = Discography({artist_id})"
    if name == "show_tour":
        return f"root = TourSchedule({artist_id})"
    if name == "show_timeline":
        return f"root = CareerTimeline({artist_id})"
    if name == "show_album":
        return f"root = AlbumSpotlight({json.dumps(str(context.get('albumId', '')))})"
    if name == "get_tickets":
        artist = database.get_artist(str(context.get("artistId", "")))
        show = next((t for t in artist.tour if t.date == context.get("date")), None)
        where = f"{show.venue}, {show.city} on {show.date}" if show else "this show"
        body = json.dumps(
            f"Tickets for {artist.name} at {where} would open here. The tour dates"
            " are fictional, so there's nothing to buy."
        )
        return f'root = FactCard("Demo tickets", {body}, "shoppingCart")'
    return None


def action_response(name: str, context: dict[str, Any]) -> str | None:
    """Express for a known button action, or None if the action is unknown."""
    express = _action_express(name, context)
    return f"<a2ui>\n{express}\n</a2ui>" if express else None
