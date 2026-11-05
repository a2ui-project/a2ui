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

/** React implementations of the music catalog, registered as one v1.0 catalog. */

import {createComponentImplementation, type ReactCatalogComponent} from '@a2ui/react';
import {Catalog} from '@a2ui/web_core';

import {
  AlbumArtApi,
  ArtistAvatarApi,
  DateBadgeApi,
  GenreTagsApi,
  MUSIC_CATALOG_ID,
  TimelineApi,
  TrackListApi,
} from './music_catalog_api';

const DEFAULT_HUE = 18;

function initials(name: string): string {
  const words = name
    .replace(/^the\s+/i, '')
    .split(/[\s.]+/)
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map(w => w[0]!.toUpperCase())
    .join('');
}

function gradient(hue: number): string {
  return `linear-gradient(135deg, hsl(${hue} 70% 58%), hsl(${(hue + 40) % 360} 65% 32%))`;
}

export const ArtistAvatar = createComponentImplementation(ArtistAvatarApi, ({props}) => (
  <div
    className={`ln-avatar ln-size-${props.size ?? 'medium'}`}
    style={{background: gradient(props.hue ?? DEFAULT_HUE)}}
    role="img"
    aria-label={props.name}
  >
    {initials(props.name)}
  </div>
));

export const AlbumArt = createComponentImplementation(AlbumArtApi, ({props}) => {
  const hue = props.hue ?? DEFAULT_HUE;
  return (
    <div
      className={`ln-cover ln-size-${props.size ?? 'medium'}`}
      style={{
        background: `radial-gradient(circle at 30% 25%, hsl(${(hue + 60) % 360} 80% 70% / 0.55), transparent 55%), ${gradient(hue)}`,
      }}
      role="img"
      aria-label={`${props.title} by ${props.artist}`}
    >
      <span className="ln-cover-title">{props.title}</span>
      <span className="ln-cover-artist">{props.artist}</span>
    </div>
  );
});

export const GenreTags = createComponentImplementation(GenreTagsApi, ({props}) => (
  <ul className="ln-tags" aria-label="Genres">
    {props.genres.map(genre => (
      <li key={genre} className="ln-tag">
        {genre}
      </li>
    ))}
  </ul>
));

export const TrackList = createComponentImplementation(TrackListApi, ({props}) => (
  <ol className="ln-tracks">
    {props.tracks.map((track, index) => (
      <li key={`${index}-${track.title}`} className="ln-track">
        <span className="ln-track-number">{index + 1}</span>
        <span className="ln-track-title">{track.title}</span>
        <span className="ln-track-duration">{track.duration ?? ''}</span>
      </li>
    ))}
  </ol>
));

const STATUS_LABELS = {onSale: 'On sale', fewLeft: 'Few left', soldOut: 'Sold out'} as const;

export const DateBadge = createComponentImplementation(DateBadgeApi, ({props}) => {
  const date = new Date(`${props.date}T12:00:00`);
  const valid = !Number.isNaN(date.getTime());
  return (
    <time className={`ln-date ln-status-${props.status ?? 'none'}`} dateTime={props.date}>
      <span className="ln-date-month">
        {valid ? date.toLocaleString('en', {month: 'short'}) : '—'}
      </span>
      <span className="ln-date-day">{valid ? date.getDate() : '?'}</span>
      <span className="ln-date-year">{valid ? date.getFullYear() : props.date}</span>
      {props.status && <span className="ln-date-status">{STATUS_LABELS[props.status]}</span>}
    </time>
  );
});

export const Timeline = createComponentImplementation(TimelineApi, ({props}) => (
  <ol className="ln-timeline">
    {props.events.map((event, index) => (
      <li key={`${event.year}-${index}`} className="ln-timeline-event">
        <span className="ln-timeline-year">{event.year}</span>
        <div>
          <div className="ln-timeline-title">{event.title}</div>
          {event.detail && <div className="ln-timeline-detail">{event.detail}</div>}
        </div>
      </li>
    ))}
  </ol>
));

export const musicCatalog = new Catalog<ReactCatalogComponent>(
  MUSIC_CATALOG_ID,
  '1.0',
  [ArtistAvatar, AlbumArt, GenreTags, TrackList, DateBadge, Timeline],
  [],
);
