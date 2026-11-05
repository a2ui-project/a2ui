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

/** Deterministic end-to-end tests against the agent in scripted mode. */

import {expect, test} from '@playwright/test';

import {ask, latestTurn, music, trackErrors} from './helpers';

let errors: string[];

test.beforeEach(async ({page}) => {
  errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('prompt-chip')).toHaveCount(9);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('shows the mode, example prompts and macro library', async ({page}) => {
  await expect(page.getByTestId('mode-badge')).toHaveText('Scripted mode (no API key)');
  await expect(page.getByTestId('macro-library').locator('li')).toHaveCount(8);
  await expect(page.getByTestId('macro-library')).toContainText('TourSchedule(artistId)');
});

test('Beatles discography renders album art for every album', async ({page}) => {
  const turn = await ask(page, 'What albums do the Beatles have?');
  const surface = turn.getByTestId('surface');
  await expect(surface).toContainText('Albums by The Beatles');
  await expect(music(surface, 'AlbumArt')).toHaveCount(13);
  await expect(surface).toContainText('Abbey Road');
  await expect(turn.getByTestId('hood-stats')).toContainText('1 macro call → 77 components');
});

test('Aldous Harding tour shows date badges and ticket states', async ({page}) => {
  const surface = (await ask(page, 'When is Aldous Harding touring?')).getByTestId('surface');
  await expect(music(surface, 'DateBadge')).toHaveCount(6);
  await expect(surface).toContainText('Barbican Hall');
  await expect(surface).toContainText('Sold out');
  await expect(surface.getByRole('button', {name: 'Tickets'})).toHaveCount(5);
});

test('Nina Simone combines a profile and a timeline', async ({page}) => {
  const surface = (await ask(page, 'Tell me about Nina Simone')).getByTestId('surface');
  await expect(surface.locator('h3').first()).toHaveText('Nina Simone');
  await expect(music(surface, 'GenreTags')).toContainText('Jazz');
  await expect(music(surface, 'Timeline')).toContainText('Mississippi Goddam');
});

test('Homogenic shows the full track list', async ({page}) => {
  const surface = (await ask(page, "Show me the tracklist for Björk's Homogenic")).getByTestId(
    'surface',
  );
  const tracks = music(surface, 'TrackList').locator('li');
  await expect(tracks).toHaveCount(10);
  await expect(tracks.nth(1)).toContainText('Jóga');
});

test('comparison shows both artists side by side', async ({page}) => {
  const surface = (await ask(page, 'Compare Fela Kuti and Kendrick Lamar')).getByTestId('surface');
  await expect(surface).toContainText('Fela Kuti vs Kendrick Lamar');
  await expect(music(surface, 'ArtistAvatar')).toHaveCount(2);
});

test('touring artists, career timeline, fact card and region search', async ({page}) => {
  let surface = (await ask(page, "Who's touring soon?")).getByTestId('surface');
  await expect(surface).toContainText('On tour soon');
  await expect(music(surface, 'ArtistAvatar')).toHaveCount(5);

  surface = (await ask(page, "Walk me through Ryuichi Sakamoto's career")).getByTestId('surface');
  await expect(music(surface, 'Timeline')).toContainText('Academy Award');

  surface = (await ask(page, 'Give me a fun fact about Gurrumul')).getByTestId('surface');
  await expect(surface).toContainText('Number one in Yolŋu Matha');

  surface = (await ask(page, 'Show me artists from Latin America')).getByTestId('surface');
  await expect(surface).toContainText('Celia Cruz');
  await expect(surface).toContainText('Mercedes Sosa');
});

test('a Tracklist button opens the album without the model', async ({page}) => {
  const discography = await ask(page, 'What albums do the Beatles have?');
  await discography.getByRole('button', {name: 'Tracklist'}).first().click();
  const turn = await latestTurn(page, 1);
  await expect(page.getByTestId('user-turn').last()).toContainText(
    'Show the tracklist for Revolver',
  );
  await expect(music(turn.getByTestId('surface'), 'TrackList')).toContainText(
    'Tomorrow Never Knows',
  );
  await expect(turn.getByTestId('hood-stats')).toContainText('button action');
});

test('profile buttons chain into tour dates and demo tickets', async ({page}) => {
  const profile = await ask(page, 'Tell me about Rosalía');
  await profile.getByRole('button', {name: 'Tour dates'}).click();
  const tour = await latestTurn(page, 1);
  await expect(music(tour, 'DateBadge')).toHaveCount(4);
  await tour.getByRole('button', {name: 'Tickets'}).first().click();
  const tickets = await latestTurn(page, 2);
  await expect(tickets.getByTestId('surface')).toContainText('Demo tickets');
});

test('under the hood shows the Express and the expanded v1.0 messages', async ({page}) => {
  const turn = await ask(page, 'When is Aldous Harding touring?');
  await turn.getByTestId('under-the-hood').locator('summary').click();
  await expect(turn.getByTestId('hood-express')).toContainText('TourSchedule("aldous-harding")');
  await turn.getByRole('tab', {name: 'A2UI v1.0 messages'}).click();
  const wire = turn.getByTestId('hood-wire');
  await expect(wire).toContainText('"version": "1.0"');
  await expect(wire).toContainText('https://a2ui.org/demos/macros-music/v1/catalog.json');
  await expect(wire).toContainText(
    'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
  );
  await expect(wire).not.toContainText('"component": "TourSchedule"');
});
