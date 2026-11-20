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

/** What every spec does with the page: send a turn, wait for a reply, read the timeline. */

import {expect, type Page} from '@playwright/test';

import type {TimelineEvent} from '../src/a2a-session.js';

/** Types `text` into the prompt and presses Send, as a user would. */
export async function sendPrompt(page: Page, text: string): Promise<void> {
  await page.fill('#prompt', text);
  await page.click('#send');
}

/** Sends `text` from script, with no user gesture behind it. */
export async function sendWithoutGesture(page: Page, text: string): Promise<void> {
  await page.evaluate(async prompt => {
    await window.a2uiShell.send(prompt);
  }, text);
}

/** The number of turns the shell has finished, user-sent or automatic. */
export function turnsCompleted(page: Page): Promise<number> {
  return page
    .locator('#status')
    .getAttribute('data-turns')
    .then(value => Number(value ?? 0));
}

/**
 * Waits until the shell has finished at least `count` turns and nothing is in flight.
 *
 * A turn the shell sends on its own, such as an error report, can finish before the test
 * looks, so the count may already be higher.
 */
export async function waitForTurns(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => turnsCompleted(page), {message: `at least ${count} turns completed`})
    .toBeGreaterThanOrEqual(count);
  await expect(page.locator('#status')).toHaveAttribute('data-busy', 'false');
}

/** The transcript entry of turn `turn`, as the page shows it. */
export function transcriptEntry(page: Page, turn: number) {
  return page.locator(`#transcript p[data-turn="${turn}"]`);
}

/** The shell's timeline, in the order the events happened. */
export function timeline(page: Page): Promise<TimelineEvent[]> {
  return page.evaluate(() => window.a2uiShell.session.timeline);
}

/** Every A2UI envelope the agent has sent the page, in order. */
export function received(page: Page): Promise<Record<string, unknown>[]> {
  return page.evaluate(() => window.a2uiShell.session.received);
}

/** The capabilities the shell advertises on its next message. */
export async function selectCapabilities(page: Page, caps: 'v1_0' | 'v0_9' | 'off'): Promise<void> {
  await page.selectOption('#caps', caps);
}
