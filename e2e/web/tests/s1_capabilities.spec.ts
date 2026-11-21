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
 * Capabilities: what the shell advertises decides what the agent generates.
 *
 * A v1.0 renderer gets the v1.0 transcript, and the agent's system instruction names exactly
 * the catalog it advertised; a v0.9 renderer gets the v0.9.1 copy the same way. A message that
 * carries no capabilities withdraws A2UI for that turn: the reply is text only and the page shows
 * no new surface, while the surfaces of earlier turns stay.
 */

import {expect, test} from './fixtures.js';
import {expectOutcome, loadScenario, openingText, surfaceLocator, turnText} from './hub.js';
import {selectCapabilities, sendPrompt, transcriptEntry, waitForTurns} from './page.js';

const CATALOG_IDS = {
  '1.0': 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json',
  'v0.9': 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
};

test('a v1.0 renderer gets the v1.0 transcript for the catalog it advertised', async ({
  open,
  capture,
  agentLog,
}) => {
  const scenario = loadScenario('newsletter_signup', '1.0');
  const page = await open('v1_0');
  await sendPrompt(page, openingText(scenario));
  await waitForTurns(page, 1);

  await expectOutcome(page, scenario.turns[0].expectViewTree);

  const [sent] = await capture.waitForMessages(1);
  expect(sent.metadata?.a2uiRendererCapabilities).toEqual({
    '1.0': {supportedCatalogIds: [CATALOG_IDS['1.0']]},
  });
  expect(sent.metadata?.a2uiClientCapabilities).toBeUndefined();

  const [record] = await agentLog();
  expect(record.scenario).toBe(scenario.name);
  expect(record.version).toBe('1.0');
  expect(record.a2uiEnabled).toBe(true);
  expect(record.systemInstruction).toContain(CATALOG_IDS['1.0']);
  expect(record.systemInstruction).not.toContain(CATALOG_IDS['v0.9']);
});

test('a v0.9 renderer gets the v0.9.1 transcript for the catalog it advertised', async ({
  open,
  capture,
  agentLog,
}) => {
  const scenario = loadScenario('newsletter_signup', '0.9.1');
  const page = await open('v0_9');
  await sendPrompt(page, openingText(scenario));
  await waitForTurns(page, 1);

  await expectOutcome(page, scenario.turns[0].expectViewTree);

  const [sent] = await capture.waitForMessages(1);
  expect(sent.metadata?.a2uiClientCapabilities).toEqual({
    'v0.9': {supportedCatalogIds: [CATALOG_IDS['v0.9']]},
  });
  expect(sent.metadata?.a2uiRendererCapabilities).toBeUndefined();

  const [record] = await agentLog();
  expect(record.scenario).toBe(scenario.name);
  expect(record.version).toBe('0.9.1');
  expect(record.a2uiEnabled).toBe(true);
  expect(record.systemInstruction).toContain(CATALOG_IDS['v0.9']);
  expect(record.systemInstruction).not.toContain(CATALOG_IDS['1.0']);
});

test('a turn sent without capabilities gets text only and no new surface', async ({
  open,
  capture,
  agentLog,
}) => {
  const scenario = loadScenario('newsletter_signup', '1.0');
  const page = await open('v1_0');
  await sendPrompt(page, openingText(scenario));
  await waitForTurns(page, 1);
  await expectOutcome(page, scenario.turns[0].expectViewTree);

  // The second turn follows the scenario's script, which answers it with an update to the
  // form; without capabilities the agent must send that turn's text and nothing else.
  await selectCapabilities(page, 'off');
  await sendPrompt(page, 'Thanks, that is all.');
  await waitForTurns(page, 2);

  const messages = await capture.waitForMessages(2);
  expect(messages[1].metadata?.a2uiRendererCapabilities).toBeUndefined();
  expect(messages[1].metadata?.a2uiClientCapabilities).toBeUndefined();

  const records = await agentLog();
  expect(records).toHaveLength(2);
  expect(records[1].turn).toBe(1);
  expect(records[1].a2uiEnabled).toBe(false);
  expect(records[1].systemInstruction).not.toContain('<a2ui');

  const reply = turnText(scenario.turns[1]);
  await expect(transcriptEntry(page, 1)).toHaveText(reply.trim());
  // The first turn's form is still there, untouched by the update the script would have sent.
  await expectOutcome(page, scenario.turns[0].expectViewTree);
  await expect(page.locator('[data-a2ui-surface]')).toHaveCount(1);
  await expect(surfaceLocator(page, 'newsletter-signup').getByText(/subscribed/)).toHaveCount(0);
});
