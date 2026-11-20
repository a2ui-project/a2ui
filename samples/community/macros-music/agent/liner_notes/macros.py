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

"""Music macros that combine basic catalog layout with music catalog widgets.

Most macros take only ids and read the demo database while they expand on the
server, so the model never copies facts into the UI. `FactCard` is the
exception: the model writes its content.
"""

from __future__ import annotations

from typing import Any, Literal, Sequence

from a2ui.builder.v1_0 import (
    Action,
    ActionEvent,
    Button,
    Card,
    Column,
    ComponentBuilderNode,
    Divider,
    Icon,
    IconName,
    Row,
    Text,
)
from a2ui.transformers.macros import macro

from liner_notes import database
from liner_notes.music_catalog import (
    AlbumArt,
    ArtistAvatar,
    DateBadge,
    GenreTags,
    Timeline,
    TimelineEvent,
    TrackItem,
    TrackList,
)

MAX_COMPARED_ARTISTS = 4


def _heading(text: str) -> Text:
    return Text(text=f"### {text}")


def _caption(text: str) -> Text:
    return Text(text=text, variant="caption")


def _event_button(
    label: str,
    name: str,
    context: dict[str, Any],
    user_message: str,
    variant: Literal["default", "primary", "borderless"] = "default",
) -> Button:
    return Button(
        child=Text(text=label),
        variant=variant,
        action=Action(
            event=ActionEvent(name=name, context=context, userMessage=user_message)
        ),
    )


def _artist_header(artist: database.Artist, title: str, subtitle: str) -> Row:
    return Row(
        align="center",
        children=[
            ArtistAvatar(name=artist.name, hue=artist.hue, size="small"),
            Column(children=[_heading(title), _caption(subtitle)]),
        ],
    )


def _stat(
    value: str, label: str, align: Literal["start", "center"] = "start"
) -> Column:
    return Column(align=align, children=[Text(text=f"**{value}**"), _caption(label)])


@macro
def ArtistProfile(artistId: str) -> Card:
    """Profile card for one artist: avatar, origin, genres, bio, key stats and buttons to open their albums, tour dates and career timeline.

    Args:
        artistId: Artist id from the roster, for example "nina-simone".
    """
    artist = database.get_artist(artistId)
    context = {"artistId": artist.id}
    buttons: list[ComponentBuilderNode] = [
        _event_button(
            "Albums", "show_discography", context, f"Show albums by {artist.name}"
        ),
        _event_button(
            "Career timeline",
            "show_timeline",
            context,
            f"Show {artist.name}'s career timeline",
        ),
    ]
    if artist.tour:
        buttons.insert(
            1,
            _event_button(
                "Tour dates",
                "show_tour",
                context,
                f"When is {artist.name} touring?",
                variant="primary",
            ),
        )
    return Card(
        child=Column(
            children=[
                Row(
                    align="center",
                    children=[
                        ArtistAvatar(name=artist.name, hue=artist.hue, size="large"),
                        Column(
                            children=[
                                _heading(artist.name),
                                _caption(
                                    f"{artist.kind} · {artist.origin} · {artist.active}"
                                ),
                                GenreTags(genres=list(artist.genres)),
                            ]
                        ),
                    ],
                ),
                Text(text=artist.bio),
                Row(
                    justify="spaceAround",
                    children=[
                        _stat(str(artist.debut_year), "First release"),
                        _stat(str(len(artist.albums)), "Albums in database"),
                        _stat(str(len(artist.tour)), "Upcoming shows"),
                    ],
                ),
                Row(children=buttons),
            ]
        )
    )


@macro
def Discography(artistId: str) -> Card:
    """Album list for one artist with generated cover art, year and label. Albums that have a track list get a "Tracklist" button.

    Args:
        artistId: Artist id from the roster, for example "the-beatles".
    """
    artist = database.get_artist(artistId)
    years = [album.year for album in artist.albums]
    rows: list[ComponentBuilderNode] = []
    for album in artist.albums:
        children: list[ComponentBuilderNode] = [
            AlbumArt(
                title=album.title,
                artist=artist.name,
                hue=database.album_hue(artist, album),
                size="small",
            ),
            Column(
                weight=1,
                children=[
                    Text(text=f"**{album.title}**"),
                    _caption(f"{album.year} · {album.label} · {album.kind}"),
                ],
            ),
        ]
        if album.tracks:
            children.append(
                _event_button(
                    "Tracklist",
                    "show_album",
                    {"albumId": album.id},
                    f"Show the tracklist for {album.title}",
                    variant="borderless",
                )
            )
        rows.append(Row(align="center", children=children))
    return Card(
        child=Column(
            children=[
                _artist_header(
                    artist,
                    f"Albums by {artist.name}",
                    f"{len(artist.albums)} releases · {min(years)}–{max(years)}",
                ),
                Divider(),
                *rows,
            ]
        )
    )


@macro
def AlbumSpotlight(albumId: str) -> Card:
    """Detail card for one album: large cover art, release facts, genres and the full track list when the database has it.

    Args:
        albumId: Album id, for example "abbey-road". Get ids from `get_artist_facts`.
    """
    album, artist = database.get_album(albumId)
    details: list[ComponentBuilderNode] = [
        _heading(album.title),
        Text(text=f"by {artist.name}"),
        _caption(f"{album.year} · {album.label} · {album.kind}"),
        GenreTags(genres=list(artist.genres)),
    ]
    if album.note:
        details.append(Text(text=album.note))
    tracks: ComponentBuilderNode = (
        TrackList(
            tracks=[TrackItem(title=t.title, duration=t.duration) for t in album.tracks]
        )
        if album.tracks
        else _caption("The track list for this album isn't in the demo database.")
    )
    return Card(
        child=Column(
            children=[
                Row(
                    align="center",
                    children=[
                        AlbumArt(
                            title=album.title,
                            artist=artist.name,
                            hue=database.album_hue(artist, album),
                            size="large",
                        ),
                        Column(weight=1, children=details),
                    ],
                ),
                Divider(),
                tracks,
                _event_button(
                    f"More from {artist.name}",
                    "show_discography",
                    {"artistId": artist.id},
                    f"Show albums by {artist.name}",
                    variant="borderless",
                ),
            ]
        )
    )


@macro
def TourSchedule(artistId: str) -> Card:
    """Upcoming concert dates for one artist, each with a calendar badge, venue and ticket button. Shows a friendly empty state when the artist isn't touring.

    Args:
        artistId: Artist id from the roster, for example "aldous-harding".
    """
    artist = database.get_artist(artistId)
    if not artist.tour:
        return Card(
            child=Column(
                children=[
                    _artist_header(
                        artist, f"{artist.name} on tour", "No upcoming shows"
                    ),
                    Text(
                        text=(
                            f"{artist.name} has no upcoming shows in the demo database."
                        )
                    ),
                    _event_button(
                        "Browse albums instead",
                        "show_discography",
                        {"artistId": artist.id},
                        f"Show albums by {artist.name}",
                    ),
                ]
            )
        )
    rows: list[ComponentBuilderNode] = []
    for show in artist.tour:
        ticket: ComponentBuilderNode = (
            _caption("Sold out")
            if show.status == "soldOut"
            else _event_button(
                "Tickets",
                "get_tickets",
                {"artistId": artist.id, "date": show.date},
                f"Get tickets for {artist.name} in {show.city}",
                variant="primary" if show.status == "fewLeft" else "default",
            )
        )
        rows.append(
            Row(
                align="center",
                children=[
                    DateBadge(date=show.date, status=show.status),
                    Column(
                        weight=1,
                        children=[
                            Text(text=f"**{show.city}**, {show.country}"),
                            _caption(show.venue),
                        ],
                    ),
                    ticket,
                ],
            )
        )
    return Card(
        child=Column(
            children=[
                _artist_header(
                    artist,
                    f"{artist.name} on tour",
                    f"{len(artist.tour)} upcoming shows · fictional demo dates",
                ),
                Divider(),
                *rows,
            ]
        )
    )


@macro
def CareerTimeline(artistId: str) -> Card:
    """Vertical timeline of the milestones in one artist's career.

    Args:
        artistId: Artist id from the roster, for example "ryuichi-sakamoto".
    """
    artist = database.get_artist(artistId)
    return Card(
        child=Column(
            children=[
                _artist_header(
                    artist, f"{artist.name}: career timeline", artist.active
                ),
                Timeline(
                    events=[
                        TimelineEvent(
                            year=e.year, title=e.title, detail=e.detail or None
                        )
                        for e in artist.timeline
                    ]
                ),
            ]
        )
    )


@macro
def ArtistComparison(artistIds: Sequence[str]) -> Card:
    """Side-by-side comparison of two to four artists: origin, genres, era, first release and album count.

    Args:
        artistIds: Two to four artist ids from the roster.
    """
    artists = [database.get_artist(a) for a in artistIds[:MAX_COMPARED_ARTISTS]]
    columns: list[ComponentBuilderNode] = [
        Column(
            weight=1,
            align="center",
            children=[
                ArtistAvatar(name=a.name, hue=a.hue, size="medium"),
                Text(text=f"**{a.name}**"),
                _caption(a.origin),
                GenreTags(genres=list(a.genres)),
                Divider(),
                _stat(a.active, "Active", "center"),
                _stat(str(a.debut_year), "First release", "center"),
                _stat(str(len(a.albums)), "Albums in database", "center"),
                _event_button(
                    "Profile",
                    "show_artist",
                    {"artistId": a.id},
                    f"Tell me about {a.name}",
                ),
            ],
        )
        for a in artists
    ]
    return Card(
        child=Column(
            children=[
                _heading(" vs ".join(a.name for a in artists)),
                Row(align="start", children=columns),
            ]
        )
    )


@macro
def ArtistGrid(title: str, artistIds: Sequence[str]) -> Card:
    """A titled list of compact artist rows, each with a profile button and a tour button for touring artists. Use it for search results and recommendations.

    Args:
        title: Heading for the list, for example "Artists from Africa".
        artistIds: Artist ids from the roster.
    """
    rows: list[ComponentBuilderNode] = []
    for artist in (database.get_artist(a) for a in artistIds):
        buttons: list[ComponentBuilderNode] = [
            _event_button(
                "Profile",
                "show_artist",
                {"artistId": artist.id},
                f"Tell me about {artist.name}",
                variant="borderless",
            )
        ]
        if artist.tour:
            buttons.append(
                _event_button(
                    "Tour dates",
                    "show_tour",
                    {"artistId": artist.id},
                    f"When is {artist.name} touring?",
                    variant="borderless",
                )
            )
        rows.append(
            Row(
                align="center",
                children=[
                    ArtistAvatar(name=artist.name, hue=artist.hue, size="small"),
                    Column(
                        weight=1,
                        children=[
                            Text(text=f"**{artist.name}**"),
                            _caption(f"{artist.origin} · {', '.join(artist.genres)}"),
                        ],
                    ),
                    *buttons,
                ],
            )
        )
    return Card(child=Column(children=[_heading(title), Divider(), *rows]))


@macro
def FactCard(headline: str, body: str, icon: IconName = "star") -> Card:
    """A highlighted fact or answer that you write yourself. Use only facts from the database tools.

    Args:
        headline: Short headline for the fact.
        body: One to three sentences.
        icon: Icon shown next to the headline.
    """
    return Card(
        child=Column(
            children=[
                Row(
                    align="center",
                    children=[Icon(name=icon), Text(text=f"**{headline}**")],
                ),
                Text(text=body),
            ]
        )
    )


ALL_MACROS = [
    ArtistProfile,
    Discography,
    AlbumSpotlight,
    TourSchedule,
    CareerTimeline,
    ArtistComparison,
    ArtistGrid,
    FactCard,
]
