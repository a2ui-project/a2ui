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
 * Streaming: every seed, in both versions, rendered as the agent streams it.
 *
 * The agents pause before each model chunk, so a page sees a turn arrive in pieces. After each
 * turn the page shows the turn's view trees; the agent's log shows the turn went out in more
 * than one chunk; and the shell's timeline shows the turn's text arrived before its first A2UI
 * part, and the A2UI parts were processed before the stream's final frame.
 */

import {CAPS_FOR, expect, test, type Version} from './fixtures.js';
import {expectOutcome, listScenarios, loadScenario, runUiOps, type ScenarioTurn} from './hub.js';
import {sendPrompt, timeline, transcriptEntry, waitForTurns} from './page.js';

const VERSIONS: readonly Version[] = ['1.0', '0.9.1'];

function hasText(turn: ScenarioTurn): boolean {
  return turn.expectWire.some(part => 'text' in part);
}

function hasA2ui(turn: ScenarioTurn): boolean {
  return turn.expectWire.some(part => 'a2ui' in part);
}

function textFirst(turn: ScenarioTurn): boolean {
  return hasText(turn) && 'text' in turn.expectWire[0];
}

for (const version of VERSIONS) {
  for (const name of listScenarios(version)) {
    test(`${name} v${version} renders each turn as it streams`, async ({
      pair,
      open,
      capture,
      agentLog,
    }) => {
      const scenario = loadScenario(name, version);
      test.skip(
        !scenario.formats.includes(pair.format),
        `${scenario.name} scripts no ${pair.format} chunks`,
      );
      const page = await open(CAPS_FOR[version]);

      let expectedMessages = 0;
      for (const [index, turn] of scenario.turns.entries()) {
        if (turn.userText !== null) {
          await sendPrompt(page, turn.userText);
          expectedMessages++;
        }
        // A turn without user text follows from the previous turn's outbound envelopes, which
        // the shell sends on its own.
        await waitForTurns(page, index + 1);

        // Only the messages the script accounts for went out: an envelope the shell sends on
        // its own, such as an error report, is one the turn expects.
        const automatic = (turn.expectOutbound?.length ?? 0) > 0 && !turn.uiOps?.length;
        const sent = capture.messages.map(message => message.envelopes);
        expect(sent.length, `messages sent after turn ${index}: ${JSON.stringify(sent)}`).toBe(
          automatic && sent.length === expectedMessages + 1 ? sent.length : expectedMessages,
        );
        if (automatic) expectedMessages++;

        await expectOutcome(page, turn.expectViewTree);
        if (hasText(turn)) {
          await expect(transcriptEntry(page, index)).toBeVisible();
        }

        const records = await agentLog();
        const record = records.find(
          entry => entry.scenario === scenario.name && entry.turn === index,
        );
        expect(record, `agent log holds turn ${index} of ${scenario.name}`).toBeDefined();
        expect(record!.a2uiEnabled).toBe(true);
        expect(record!.format).toBe(pair.format);
        if (hasA2ui(turn)) {
          expect(record!.chunks, 'the turn streamed in more than one chunk').toBeGreaterThan(1);
        }

        const events = (await timeline(page)).filter(event => event.turn === index);
        const kinds = events.map(event => event.kind);
        const end = kinds.lastIndexOf('end');
        expect(end, 'the turn ended').toBeGreaterThanOrEqual(0);
        if (hasA2ui(turn)) {
          const firstA2ui = kinds.indexOf('a2ui');
          expect(firstA2ui, 'an A2UI part was processed').toBeGreaterThanOrEqual(0);
          expect(firstA2ui, 'A2UI parts arrived before the final frame').toBeLessThan(end);
          if (textFirst(turn)) {
            expect(kinds.indexOf('text'), 'the text arrived before the UI').toBeLessThan(firstA2ui);
          }
        }

        await runUiOps(page, turn.uiOps);
        if (turn.uiOps?.length) expectedMessages++;
      }
    });
  }
}
