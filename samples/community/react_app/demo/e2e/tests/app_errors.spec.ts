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
 * An app that crashes in the browser: the turn shows the error, and the agent gets one automatic
 * repair turn. The responses are hand-written (recordings/app_error.json), so this runs in
 * recorded mode only.
 */
import {expect} from '@playwright/test';
import {MODE, appFrame, test, turnSnapshot} from './helpers';

test.use({allowedFrameErrors: [/demo crash on purpose/]});

test('a crashing app is shown as an error and repaired by the agent', async ({page}) => {
  test.skip(MODE === 'live', 'The crashing app is a hand-written recording.');
  await page.goto('/');
  await page.getByTestId('prompt-input').fill('Show me an app that crashes');
  await page.getByTestId('prompt-input').press('Enter');

  const first = page.getByTestId('turn').first();
  await expect(first.getByTestId('turn-problem')).toContainText('demo crash on purpose');

  const repair = page.getByTestId('turn').nth(1);
  await expect(repair.locator('.turn-prompt-label')).toHaveText('Automatic');
  await expect(repair).toHaveAttribute('data-status', 'done');
  const snapshot = await turnSnapshot(page, (await repair.getAttribute('data-turn-id'))!);
  expect(snapshot.error).toBeNull();

  // The fix updates the app in place, in the turn that showed it.
  await expect(appFrame(first).locator('body')).toContainText('Count is 1');
  // A repair turn never asks for another repair.
  await expect(page.getByTestId('turn')).toHaveCount(2);
});
