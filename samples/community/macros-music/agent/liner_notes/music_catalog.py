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

"""The custom music catalog: its JSON definition and typed builder nodes.

`catalog/music_catalog.json` is shared with the React client, which
implements these components. The builder classes below mirror it so macros
can construct music components with type checking.
"""

from __future__ import annotations

import json
import pathlib
from typing import Literal

from pydantic import BaseModel

from a2ui.builder.v1_0 import ComponentBuilderNode
from a2ui.core import Catalog, CatalogApi

CATALOG_PATH = (
    pathlib.Path(__file__).resolve().parents[2] / "catalog" / "music_catalog.json"
)
MUSIC_CATALOG_ID = "https://a2ui.org/demos/macros-music/v1/catalog.json"

Size = Literal["small", "medium", "large"]


def load_music_catalog() -> CatalogApi:
    return Catalog.from_json(json.loads(CATALOG_PATH.read_text()))


class MusicNode(ComponentBuilderNode, catalog_id=MUSIC_CATALOG_ID):
    """Base class that stamps the music catalog id on every subclass."""


class TrackItem(BaseModel):
    title: str
    duration: str | None = None


class TimelineEvent(BaseModel):
    year: int
    title: str
    detail: str | None = None


class ArtistAvatar(MusicNode):
    component: Literal["ArtistAvatar"] = "ArtistAvatar"
    name: str
    hue: int | None = None
    size: Size | None = None


class AlbumArt(MusicNode):
    component: Literal["AlbumArt"] = "AlbumArt"
    title: str
    artist: str
    hue: int | None = None
    size: Size | None = None


class GenreTags(MusicNode):
    component: Literal["GenreTags"] = "GenreTags"
    genres: list[str]


class TrackList(MusicNode):
    component: Literal["TrackList"] = "TrackList"
    tracks: list[TrackItem]


class DateBadge(MusicNode):
    component: Literal["DateBadge"] = "DateBadge"
    date: str
    status: Literal["onSale", "fewLeft", "soldOut"] | None = None


class Timeline(MusicNode):
    component: Literal["Timeline"] = "Timeline"
    events: list[TimelineEvent]
