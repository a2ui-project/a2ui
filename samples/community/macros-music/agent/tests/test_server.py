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

"""Tests for scripted responses, button actions and the HTTP API."""

from __future__ import annotations

import os

os.environ["LINER_NOTES_MODE"] = "scripted"

import pytest
from fastapi.testclient import TestClient

from liner_notes import database, scripted
from liner_notes.server import app

client = TestClient(app)


def test_info_reports_scripted_mode_and_catalogs():
    info = client.get("/api/info").json()
    assert info["mode"] == "scripted"
    assert info["protocolVersion"] == "1.0"
    assert info["examplePrompts"] == scripted.EXAMPLE_PROMPTS
    assert len(info["catalogIds"]) == 2


def test_macros_report_which_catalogs_they_combine():
    macros = {m["name"]: m for m in client.get("/api/macros").json()}
    assert set(macros) >= {"ArtistProfile", "Discography", "TourSchedule", "FactCard"}
    assert "DateBadge" in macros["TourSchedule"]["musicComponents"]
    assert "Card" in macros["TourSchedule"]["basicComponents"]
    assert macros["FactCard"]["musicComponents"] == []


@pytest.mark.parametrize("prompt", scripted.EXAMPLE_PROMPTS)
def test_every_example_prompt_renders(prompt):
    turn = client.post(
        "/api/chat", json={"conversationId": "c", "prompt": prompt}
    ).json()
    assert turn["debug"]["error"] is None
    assert turn["debug"]["macroCalls"]
    assert turn["messages"]
    assert turn["text"]


def test_each_turn_gets_its_own_surface():
    ids = [
        client.post("/api/chat", json={"conversationId": "fresh", "prompt": p}).json()[
            "surfaceId"
        ]
        for p in scripted.EXAMPLE_PROMPTS[:2]
    ]
    assert ids == ["turn-1", "turn-2"]


def test_scripted_fallback_matches_artist_names():
    assert 'TourSchedule("rosalia")' in scripted.scripted_response(
        "Is Rosalía touring?"
    )
    assert "ArtistGrid" in scripted.scripted_response("hello")


@pytest.mark.parametrize(
    ("name", "context", "macro"),
    [
        ("show_artist", {"artistId": "bjork"}, "ArtistProfile"),
        ("show_discography", {"artistId": "bjork"}, "Discography"),
        ("show_tour", {"artistId": "rosalia"}, "TourSchedule"),
        ("show_timeline", {"artistId": "bts"}, "CareerTimeline"),
        ("show_album", {"albumId": "abbey-road"}, "AlbumSpotlight"),
        ("get_tickets", {"artistId": "rosalia", "date": "2026-12-12"}, "FactCard"),
    ],
)
def test_actions_render_without_the_model(name, context, macro):
    turn = client.post(
        "/api/action",
        json={"conversationId": "c", "name": name, "context": context},
    ).json()
    assert turn["debug"]["mode"] == "action"
    assert turn["debug"]["macroCalls"] == [macro]


def test_unknown_action_reports_an_error():
    turn = client.post(
        "/api/action", json={"conversationId": "c", "name": "dance", "context": {}}
    ).json()
    assert turn["messages"] == []
    assert "Unknown action" in turn["debug"]["error"]


def test_database_ids_are_unique():
    album_ids = [a.id for artist in database.ARTISTS for a in artist.albums]
    assert len(album_ids) == len(set(album_ids))
    assert len({a.id for a in database.ARTISTS}) == len(database.ARTISTS)
