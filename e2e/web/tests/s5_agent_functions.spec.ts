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
 * Agent functions: a binding that the agent answers over the transport.
 *
 * The `agent_functions` scenario binds a Text to `lookupPrice`, another to `failingLookup`, and
 * a button's action to `failingLookup`. The page shows the first Text empty while its call is
 * out, then with the price once the `agentFunctionResponse` whose `functionCallId` matches the
 * call arrives. The failing binding resolves to empty while its sibling renders, and the shell
 * reports an `EXPRESSION_ERROR` that names the failed call. The button's action calls the
 * failing function too, so it halts with the same error and dispatches no event.
 */

import {expect, test} from './fixtures.js';
import {componentLocator, loadLocalScenario, openingText, surfaceLocator} from './hub.js';
import {received, sendPrompt, waitForTurns} from './page.js';

interface AgentCall {
  readonly surfaceId: string;
  readonly functionCallId: string;
  readonly callFunction: {readonly '@call': string; readonly args: Record<string, unknown>};
}

function calls(envelopes: readonly Record<string, unknown>[]): AgentCall[] {
  return envelopes.flatMap(envelope =>
    envelope.callAgentFunction ? [envelope.callAgentFunction as AgentCall] : [],
  );
}

function errors(envelopes: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return envelopes.flatMap(envelope =>
    envelope.error ? [envelope.error as Record<string, unknown>] : [],
  );
}

function responses(envelopes: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return envelopes.flatMap(envelope =>
    envelope.agentFunctionResponse
      ? [envelope.agentFunctionResponse as Record<string, unknown>]
      : [],
  );
}

test('a binding to an agent function shows its value once the agent answers', async ({
  pair,
  open,
  capture,
}) => {
  const scenario = loadLocalScenario('agent_functions');
  test.skip(
    !scenario.formats.includes(pair.format),
    `${scenario.name} scripts no ${pair.format} chunks`,
  );
  const page = await open('v1_0');
  await sendPrompt(page, openingText(scenario));

  // The surface renders before the agent answers the call: the bound Text is empty, its
  // siblings are not.
  const surface = surfaceLocator(page, 'prices');
  await expect(surface).toBeVisible();
  const price = componentLocator(page, 'prices', 'price');
  await expect(componentLocator(page, 'prices', 'priceLabel')).toHaveText('Price of sku-100:');
  await expect(price).toHaveText('');

  await expect(price).toHaveText('$10.00');
  await waitForTurns(page, 2);

  // The call went out as a `callAgentFunction` envelope, and the response that came back
  // names the same call.
  const outbound = calls(capture.envelopes());
  const lookup = outbound.find(call => call.callFunction['@call'] === 'lookupPrice');
  expect(lookup, 'lookupPrice was called on the agent').toBeDefined();
  expect(lookup!.surfaceId).toBe('prices');
  expect(lookup!.callFunction.args).toEqual({sku: 'sku-100'});
  const inbound = responses(await received(page));
  const answer = inbound.find(response => response.functionCallId === lookup!.functionCallId);
  expect(answer, 'the agent answered the call').toBeDefined();
  expect(answer!.value).toBe('$10.00');
  expect(answer!.error).toBeUndefined();
});

test('a binding to a failing agent function resolves to empty and is reported', async ({
  pair,
  open,
  capture,
}) => {
  const scenario = loadLocalScenario('agent_functions');
  test.skip(
    !scenario.formats.includes(pair.format),
    `${scenario.name} scripts no ${pair.format} chunks`,
  );
  const page = await open('v1_0');
  await sendPrompt(page, openingText(scenario));
  await expect(componentLocator(page, 'prices', 'price')).toHaveText('$10.00');
  await waitForTurns(page, 2);

  // The sibling renders and the broken binding is empty.
  await expect(componentLocator(page, 'prices', 'sibling')).toHaveText('Sibling still renders');
  await expect(componentLocator(page, 'prices', 'broken')).toHaveText('');

  const failing = calls(capture.envelopes()).find(
    call => call.callFunction['@call'] === 'failingLookup',
  );
  expect(failing, 'failingLookup was called on the agent').toBeDefined();
  const failure = responses(await received(page)).find(
    response => response.functionCallId === failing!.functionCallId,
  );
  expect(failure?.error, 'the agent answered the call with an error').toBeDefined();

  // The renderer reports the failed binding, naming the call that failed.
  await expect
    .poll(() => errors(capture.envelopes()).filter(error => error.code === 'EXPRESSION_ERROR'))
    .not.toEqual([]);
  const reported = errors(capture.envelopes()).filter(error => error.code === 'EXPRESSION_ERROR');
  expect(reported.some(error => error.functionCallId === failing!.functionCallId)).toBe(true);
});

test('an action that calls a failing agent function halts with an error', async ({
  pair,
  open,
  capture,
}) => {
  const scenario = loadLocalScenario('agent_functions');
  test.skip(
    !scenario.formats.includes(pair.format),
    `${scenario.name} scripts no ${pair.format} chunks`,
  );
  const page = await open('v1_0');
  await sendPrompt(page, openingText(scenario));
  await expect(componentLocator(page, 'prices', 'price')).toHaveText('$10.00');
  await waitForTurns(page, 2);
  const before = capture.envelopes().length;
  const callsBefore = calls(capture.envelopes()).length;

  await componentLocator(page, 'prices', 'failBtn').getByRole('button').click();

  // The action's call goes out, the agent fails it, and the renderer reports the failure
  // with the call's id instead of dispatching the action.
  await expect
    .poll(() => calls(capture.envelopes()).length, {message: 'the action called the agent'})
    .toBe(callsBefore + 1);
  const call = calls(capture.envelopes()).at(-1)!;
  expect(call.callFunction['@call']).toBe('failingLookup');
  await expect
    .poll(() => errors(capture.envelopes().slice(before)), {
      message: 'the renderer reported the failed call',
    })
    .not.toEqual([]);
  const reported = errors(capture.envelopes().slice(before));
  expect(reported.map(error => error.code)).toEqual(['EXPRESSION_ERROR']);
  expect(reported[0].functionCallId, JSON.stringify(reported)).toBe(call.functionCallId);
  const after = capture.envelopes().slice(before);
  expect(after.filter(envelope => envelope.action)).toEqual([]);
  await expect(surfaceLocator(page, 'prices')).toBeVisible();
});
