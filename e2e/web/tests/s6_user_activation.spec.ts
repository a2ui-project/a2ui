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
 * User activation: a function that needs a gesture runs on a click and nowhere else.
 *
 * The `user_activation` scenario gives a button an action that calls `openUrl`, which the basic
 * catalog marks `requiresUserActivation`. A real click opens the URL and reports nothing. The
 * second turn binds the same call to a Text, which the renderer evaluates with no gesture
 * behind it: the URL is not opened and the shell sends the activation error.
 */

import {expect, test} from './fixtures.js';
import {
  componentLocator,
  expectOutbound,
  expectOutcome,
  loadLocalScenario,
  openingText,
} from './hub.js';
import {sendPrompt, waitForTurns} from './page.js';

/** The URLs `window.open` was asked for, recorded in place of opening them. */
function openedUrls(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => (window as Window & {openedUrls?: string[]}).openedUrls ?? []);
}

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    const opened: string[] = [];
    (window as Window & {openedUrls?: string[]}).openedUrls = opened;
    window.open = (url?: string | URL) => {
      opened.push(String(url));
      return null;
    };
  });
});

test('openUrl runs from a real click and is refused without a gesture', async ({
  pair,
  open,
  capture,
}) => {
  const scenario = loadLocalScenario('user_activation');
  test.skip(
    !scenario.formats.includes(pair.format),
    `${scenario.name} scripts no ${pair.format} chunks`,
  );
  const [clickTurn, passiveTurn] = scenario.turns;
  const page = await open('v1_0');

  await sendPrompt(page, openingText(scenario));
  await waitForTurns(page, 1);
  await expectOutcome(page, clickTurn.expectViewTree);

  await componentLocator(page, 'links', 'openBtn').getByRole('button').click();
  await expect.poll(() => openedUrls(page)).toEqual(['https://a2ui.org/opened']);
  expect(capture.envelopes()).toEqual([]);

  // The second turn binds the call to a Text: no gesture backs that evaluation.
  await sendPrompt(page, passiveTurn.userText!);
  await waitForTurns(page, 2);
  await expectOutcome(page, passiveTurn.expectViewTree);
  await expect(componentLocator(page, 'links', 'autoOpen')).toHaveText('');

  const messages = await capture.waitForMessages(3);
  expectOutbound(messages[2].envelopes, passiveTurn.expectOutbound);
  const error = messages[2].envelopes[0].error as {message: string};
  expect(error.message).toContain('openUrl');
  expect(error.message).toMatch(/activation/i);
  expect(await openedUrls(page)).toEqual(['https://a2ui.org/opened']);
});
