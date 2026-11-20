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
 * Actions: real typing and clicks produce the envelopes the hub expects.
 *
 * For each seed with user operations, the page performs them on the rendered components. The
 * message the shell then POSTs holds exactly the scenario's `expectOutbound` envelope (the
 * fixture has already checked it against the schema), with the surface's data model in the
 * message metadata when the surface asked for it. The agent's log shows the inbound formatted
 * for the model with the action's name and context values, and the reply turn renders.
 */

import {expect, test} from './fixtures.js';
import {expectOutbound, expectOutcome, loadScenario, runUiOps} from './hub.js';
import {sendPrompt, waitForTurns} from './page.js';

const SEEDS = ['newsletter_signup', 'login_form_action', 'restaurant_list_booking'];

function contextValues(envelopes: readonly Record<string, unknown>[]): string[] {
  return envelopes.flatMap(envelope => {
    const action = envelope.action as {context?: Record<string, unknown>} | undefined;
    return Object.values(action?.context ?? {}).map(String);
  });
}

function actionNames(envelopes: readonly Record<string, unknown>[]): string[] {
  return envelopes.flatMap(envelope => {
    const action = envelope.action as {name?: string} | undefined;
    return action?.name ? [action.name] : [];
  });
}

for (const name of SEEDS) {
  test(`${name}: the page's actions reach the agent as the hub expects`, async ({
    pair,
    open,
    capture,
    agentLog,
  }) => {
    const scenario = loadScenario(name, '1.0');
    test.skip(
      !scenario.formats.includes(pair.format),
      `${scenario.name} scripts no ${pair.format} chunks`,
    );
    const page = await open('v1_0');

    for (const [index, turn] of scenario.turns.entries()) {
      if (turn.userText !== null) {
        await sendPrompt(page, turn.userText);
      }
      await waitForTurns(page, index + 1);
      await expectOutcome(page, turn.expectViewTree);
      if (!turn.uiOps?.length) continue;

      await runUiOps(page, turn.uiOps);

      // The operations end in an action, which the shell sends as the next message.
      const messages = await capture.waitForMessages(index + 2);
      const sent = messages[index + 1];
      expectOutbound(sent.envelopes, turn.expectOutbound);
      expect(sent.text).toEqual([]);
      if (turn.expectDataModel) {
        const dataModel = sent.metadata?.a2uiRendererDataModel as
          | {version: string; surfaces: Record<string, unknown>}
          | undefined;
        expect(dataModel?.version).toBe('1.0');
        expect(dataModel?.surfaces).toEqual(turn.expectDataModel);
      }

      // The agent reads the action for the model, naming the action and its context values.
      await waitForTurns(page, index + 2);
      const records = await agentLog();
      const record = records.find(
        entry => entry.scenario === scenario.name && entry.turn === index + 1,
      );
      expect(record, `agent log holds turn ${index + 1}`).toBeDefined();
      const inbound = record!.userContents.at(-1) ?? '';
      for (const actionName of actionNames(turn.expectOutbound ?? [])) {
        expect(inbound).toContain(actionName);
      }
      for (const value of contextValues(turn.expectOutbound ?? [])) {
        expect(inbound).toContain(value);
      }
    }
  });
}
