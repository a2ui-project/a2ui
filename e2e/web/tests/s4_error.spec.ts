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
 * Errors: a message the renderer cannot apply goes back to the agent on its own.
 *
 * The `missing_surface_error` seed updates a surface that was never created. The shell sends
 * the `INTEGRITY_ERROR` envelope with no user action, the agent's next model request carries
 * it, and the apology the script answers with appears in the transcript. No surface is shown.
 */

import {expect, test} from './fixtures.js';
import {expectOutbound, expectOutcome, loadScenario, openingText, turnText} from './hub.js';
import {sendPrompt, transcriptEntry, waitForTurns} from './page.js';

test('an update to a missing surface is reported and answered', async ({
  pair,
  open,
  capture,
  agentLog,
}) => {
  const scenario = loadScenario('missing_surface_error', '1.0');
  test.skip(
    !scenario.formats.includes(pair.format),
    `${scenario.name} scripts no ${pair.format} chunks`,
  );
  const [broken, apology] = scenario.turns;
  const page = await open('v1_0');

  await sendPrompt(page, openingText(scenario));
  // The error message goes out on its own, and the agent's answer to it is the second turn.
  await waitForTurns(page, 2);

  const messages = await capture.waitForMessages(2);
  expect(messages[1].text).toEqual([]);
  expectOutbound(messages[1].envelopes, broken.expectOutbound);
  const error = messages[1].envelopes[0].error as {code: string; message: string};
  expect(error.code).toBe('INTEGRITY_ERROR');
  expect(error.message).toContain('missing');

  await expectOutcome(page, broken.expectViewTree);
  await expectOutcome(page, apology.expectViewTree);
  await expect(page.locator('[data-a2ui-surface]')).toHaveCount(0);
  await expect(transcriptEntry(page, 1)).toHaveText(turnText(apology).trim());

  const records = await agentLog();
  const reply = records.find(record => record.scenario === scenario.name && record.turn === 1);
  expect(reply, 'the agent answered the error').toBeDefined();
  const inbound = reply!.userContents.at(-1) ?? '';
  expect(inbound).toContain('INTEGRITY_ERROR');
  expect(inbound).toContain('missing');
});
