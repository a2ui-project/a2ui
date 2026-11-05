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

"""Tests that every macro expands into valid basic + music catalog messages."""

from __future__ import annotations

import pytest

from a2ui.core import A2uiError

from liner_notes import database
from liner_notes.music_catalog import MUSIC_CATALOG_ID
from liner_notes.runtime import A2uiRuntime

BASIC_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"


@pytest.fixture(scope="module")
def runtime() -> A2uiRuntime:
    return A2uiRuntime()


def _express(body: str) -> str:
    return f"Some text.\n<a2ui>\n{body}\n</a2ui>"


def _all_components(messages: list[dict]) -> list[dict]:
    return [
        c
        for m in messages
        for body in (m.get("createSurface"), m.get("updateComponents"))
        if body
        for c in body.get("components", [])
    ]


@pytest.mark.parametrize("artist", database.ARTISTS, ids=lambda a: a.id)
@pytest.mark.parametrize(
    "macro",
    ["ArtistProfile", "Discography", "TourSchedule", "CareerTimeline"],
)
def test_artist_macros_expand_for_every_artist(runtime, macro, artist):
    turn = runtime.render(_express(f'root = {macro}("{artist.id}")'), "s1")

    assert turn.macro_calls == [macro]
    components = _all_components(turn.messages)
    assert len(components) == turn.transport_component_count > 1
    catalogs = {c["catalogId"] for c in components}
    assert catalogs <= {BASIC_CATALOG_ID, MUSIC_CATALOG_ID}
    assert MUSIC_CATALOG_ID in catalogs
    assert not {c["component"] for c in components} & runtime.macro_names


@pytest.mark.parametrize(
    "album_id", [a.id for artist in database.ARTISTS for a in artist.albums]
)
def test_album_spotlight_expands_for_every_album(runtime, album_id):
    turn = runtime.render(_express(f'root = AlbumSpotlight("{album_id}")'), "s1")
    album, _ = database.get_album(album_id)
    components = _all_components(turn.messages)
    track_lists = [c for c in components if c["component"] == "TrackList"]
    assert len(track_lists) == (1 if album.tracks else 0)


def test_multi_macro_composition_with_primitives(runtime):
    turn = runtime.render(
        _express(
            'root = Column([ArtistComparison(["fela-kuti", "kendrick-lamar"]),'
            ' ArtistGrid("Touring", ["rosalia", "bts"]), FactCard("Hi", "There",'
            ' "info"), GenreTags(["Jazz"])])'
        ),
        "turn-7",
    )
    assert turn.text == "Some text."
    assert turn.macro_calls == ["ArtistComparison", "ArtistGrid", "FactCard"]
    assert turn.messages[0]["createSurface"]["surfaceId"] == "turn-7"
    assert "catalogId" not in turn.messages[0]["createSurface"]


def test_model_surface_name_is_replaced_by_turn_surface(runtime):
    turn = runtime.render(
        _express('surface("main")\nroot = Discography("bts")'), "turn-3"
    )
    assert turn.messages[0]["createSurface"]["surfaceId"] == "turn-3"


def test_unknown_artist_raises_with_known_ids(runtime):
    with pytest.raises(A2uiError, match="Known ids: the-beatles"):
        runtime.render(_express('root = ArtistProfile("taylor-swift")'), "s1")


def test_tour_schedule_lists_every_show_with_badges(runtime):
    artist = database.get_artist("aldous-harding")
    turn = runtime.render(_express('root = TourSchedule("aldous-harding")'), "s1")
    badges = [
        c for c in _all_components(turn.messages) if c["component"] == "DateBadge"
    ]
    assert [b["date"] for b in badges] == [t.date for t in artist.tour]
    assert [b["status"] for b in badges] == [t.status for t in artist.tour]
