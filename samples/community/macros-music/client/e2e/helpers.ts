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

import {expect, type Locator, type Page} from '@playwright/test';

/** Collects console errors and uncaught exceptions for a page. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

/** Sends a prompt (via its chip if one matches) and returns the new assistant turn. */
export async function ask(page: Page, prompt: string, timeout = 30_000): Promise<Locator> {
  const before = await page.getByTestId('assistant-turn').count();
  const chip = page.getByTestId('prompt-chip').filter({hasText: prompt});
  if (await chip.count()) {
    await chip.first().click();
  } else {
    await page.getByLabel('Ask about an artist').fill(prompt);
    await page.getByRole('button', {name: 'Ask', exact: true}).click();
  }
  return latestTurn(page, before, timeout);
}

/** Waits for the assistant turn after `before` existing turns and returns it. */
export async function latestTurn(page: Page, before: number, timeout = 30_000) {
  await expect(page.getByTestId('assistant-turn')).toHaveCount(before + 1, {timeout});
  return page.getByTestId('assistant-turn').nth(before);
}

/** Selects a rendered music catalog component, which React hosts as a custom element. */
export function music(scope: Locator, component: string): Locator {
  return scope.locator(`a2ui-react-${component.toLowerCase()}`);
}
