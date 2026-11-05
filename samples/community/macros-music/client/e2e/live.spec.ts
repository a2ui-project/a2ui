/*
 * Copyright 2024 Google LLC
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
 * End-to-end tests against Gemini. Model output varies, so these check that
 * the expected entities and music components render rather than exact text.
 */

import {expect, test, type Locator} from '@playwright/test';

import {ask, music, trackErrors} from './helpers';

const MODEL_TIMEOUT = 90_000;

let errors: string[];

test.beforeEach(async ({page}) => {
  errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('mode-badge')).toContainText('Live');
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

async function expectHealthy(turn: Locator) {
  await expect(turn.locator('.ln-failure')).toHaveCount(0);
  await expect(turn.getByTestId('surface')).toBeVisible();
  await expect(turn.getByTestId('hood-stats')).toContainText('gemini');
}

const CHIP_EXPECTATIONS: [string, (surface: Locator) => Promise<void>][] = [
  [
    'What albums do the Beatles have?',
    async s => {
      await expect(s).toContainText('Abbey Road');
      await expect(music(s, 'AlbumArt').first()).toBeVisible();
    },
  ],
  [
    'When is Aldous Harding touring?',
    async s => {
      await expect(s).toContainText('Auckland');
      await expect(music(s, 'DateBadge').first()).toBeVisible();
    },
  ],
  [
    'Tell me about Nina Simone',
    async s => {
      await expect(s).toContainText('Nina Simone');
      await expect(music(s, 'ArtistAvatar').first()).toBeVisible();
    },
  ],
  [
    "Show me the tracklist for Björk's Homogenic",
    async s => {
      await expect(music(s, 'TrackList')).toContainText('Jóga');
    },
  ],
  [
    'Compare Fela Kuti and Kendrick Lamar',
    async s => {
      await expect(s).toContainText('Fela Kuti');
      await expect(s).toContainText('Kendrick Lamar');
    },
  ],
  [
    "Who's touring soon?",
    async s => {
      await expect(s).toContainText('Aldous Harding');
      await expect(s).toContainText('Rosalía');
    },
  ],
  [
    "Walk me through Ryuichi Sakamoto's career",
    async s => {
      await expect(music(s, 'Timeline')).toContainText('Last Emperor');
    },
  ],
  [
    'Give me a fun fact about Gurrumul',
    async s => {
      await expect(s).toContainText('Gurrumul');
    },
  ],
  [
    'Show me artists from Latin America',
    async s => {
      await expect(s).toContainText('Celia Cruz');
      await expect(s).toContainText('Mercedes Sosa');
    },
  ],
];

for (const [prompt, check] of CHIP_EXPECTATIONS) {
  test(`chip: ${prompt}`, async ({page}) => {
    const turn = await ask(page, prompt, MODEL_TIMEOUT);
    await expectHealthy(turn);
    await check(turn.getByTestId('surface'));
  });
}

test('follow-up questions use the conversation history', async ({page}) => {
  await expectHealthy(await ask(page, 'Tell me about Angélique Kidjo', MODEL_TIMEOUT));
  const turn = await ask(page, 'When is she touring?', MODEL_TIMEOUT);
  await expectHealthy(turn);
  await expect(turn.getByTestId('surface')).toContainText('Carnegie Hall');
});

test('free-form question composes macros the chips do not cover', async ({page}) => {
  const turn = await ask(
    page,
    'Which artists in the database won a Grammy? Show their profiles.',
    MODEL_TIMEOUT,
  );
  await expectHealthy(turn);
  await expect(music(turn.getByTestId('surface'), 'ArtistAvatar').first()).toBeVisible();
});

test('an artist outside the database gets a graceful answer', async ({page}) => {
  const turn = await ask(page, 'Tell me about Taylor Swift', MODEL_TIMEOUT);
  await expect(turn.locator('.ln-failure')).toHaveCount(0);
  await expect(turn.locator('.ln-assistant-text')).toContainText(/database|demo/i);
});

test('buttons in model-generated UI round-trip through the agent', async ({page}) => {
  const turn = await ask(page, 'What albums do the Beatles have?', MODEL_TIMEOUT);
  await turn.getByRole('button', {name: 'Tracklist'}).last().click();
  await expect(page.getByTestId('assistant-turn')).toHaveCount(2);
  await expect(music(page.getByTestId('assistant-turn').nth(1), 'TrackList')).toContainText(
    'Her Majesty',
  );
});
