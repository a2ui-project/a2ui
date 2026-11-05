/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Component APIs of the music catalog.
 *
 * They mirror `catalog/music_catalog.json`, which the Python agent loads;
 * `music_catalog_api.test.ts` checks that the two stay in sync.
 */

import {z} from 'zod';

export const MUSIC_CATALOG_ID = 'https://a2ui.org/demos/macros-music/v1/catalog.json';

const Size = z.enum(['small', 'medium', 'large']);
const Hue = z.number().int().min(0).max(360);

export const ArtistAvatarApi = {
  name: 'ArtistAvatar',
  schema: z.object({
    name: z.string(),
    hue: Hue.optional(),
    size: Size.optional(),
  }),
};

export const AlbumArtApi = {
  name: 'AlbumArt',
  schema: z.object({
    title: z.string(),
    artist: z.string(),
    hue: Hue.optional(),
    size: Size.optional(),
  }),
};

export const GenreTagsApi = {
  name: 'GenreTags',
  schema: z.object({
    genres: z.array(z.string()),
  }),
};

export const TrackListApi = {
  name: 'TrackList',
  schema: z.object({
    tracks: z.array(z.object({title: z.string(), duration: z.string().optional()}).strict()),
  }),
};

export const DateBadgeApi = {
  name: 'DateBadge',
  schema: z.object({
    date: z.string(),
    status: z.enum(['onSale', 'fewLeft', 'soldOut']).optional(),
  }),
};

export const TimelineApi = {
  name: 'Timeline',
  schema: z.object({
    events: z.array(
      z.object({year: z.number().int(), title: z.string(), detail: z.string().optional()}).strict(),
    ),
  }),
};

export const MUSIC_COMPONENT_APIS = [
  ArtistAvatarApi,
  AlbumArtApi,
  GenreTagsApi,
  TrackListApi,
  DateBadgeApi,
  TimelineApi,
];
