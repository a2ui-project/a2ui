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

// Drives RestaurantExecutor with a scripted backend to check how it retries replies
// that hold no A2UI or fail validation.

import type {AgentExecutionEvent} from '@a2a-js/sdk/server';
import {DefaultExecutionEventBus, RequestContext} from '@a2a-js/sdk/server';
import {beforeAll, describe, expect, it} from 'vitest';

import {RestaurantExecutor} from '../src/agent.js';
import {type BasicCatalogs, loadBasicCatalogs} from '../src/catalogs.js';
import type {A2uiFormat} from '../src/config.js';
import {type ModelBackend, StubBackend, type TurnInput} from '../src/model.js';
import {FALLBACK_TEXT} from '../src/prompt.js';

const FORMATS: A2uiFormat[] = ['direct_json', 'express'];
const PLAIN_TEXT = 'Here are some great Chinese restaurants in New York!';

/** Answers with plain text for the first `textTurns` turns, then like the stub. */
class TextFirstBackend implements ModelBackend {
  readonly queries: string[] = [];

  constructor(
    private readonly stub: StubBackend,
    private readonly textTurns: number,
  ) {}

  async *streamTurn(input: TurnInput): AsyncIterable<string> {
    this.queries.push(input.query);
    if (this.queries.length <= this.textTurns) {
      yield PLAIN_TEXT;
      return;
    }
    yield* this.stub.streamTurn(input);
  }
}

/** Runs one turn and returns every event it published, appended to `events`. */
async function runTurn(
  executor: RestaurantExecutor,
  useStreaming: boolean,
  events: AgentExecutionEvent[] = [],
): Promise<AgentExecutionEvent[]> {
  const message = {
    kind: 'message' as const,
    messageId: 'message-1',
    role: 'user' as const,
    parts: [
      {kind: 'text' as const, text: 'Top 5 Chinese restaurants in New York.'},
      {kind: 'data' as const, data: {useStreaming}},
    ],
  };
  const eventBus = new DefaultExecutionEventBus();
  eventBus.on('event', event => events.push(event));
  await executor.execute(new RequestContext(message, 'task-1', 'context-1'), eventBus);
  return events;
}

/** Runs one non-streaming turn and returns the parts of its final status. */
async function finalParts(executor: RestaurantExecutor) {
  const last = (await runTurn(executor, false)).at(-1);
  expect(last?.kind).toBe('status-update');
  return last?.kind === 'status-update' ? (last.status.message?.parts ?? []) : [];
}

describe.each(FORMATS)('a reply without A2UI (%s)', format => {
  let catalogs: BasicCatalogs;

  beforeAll(async () => {
    catalogs = await loadBasicCatalogs();
  });

  it('is retried with the validation error', async () => {
    const backend = new TextFirstBackend(new StubBackend(format, catalogs), 1);
    const parts = await finalParts(new RestaurantExecutor(format, backend, catalogs));

    // Direct JSON reports the missing tags; Express reports the missing messages.
    expect(backend.queries).toHaveLength(2);
    expect(backend.queries[1]).toMatch(
      format === 'express' ? /no A2UI messages/ : /A2UI tags .* not found/,
    );
    expect(parts.some(part => part.kind === 'data')).toBe(true);
  });

  it('ends with the fallback text when every attempt has none', async () => {
    const backend = new TextFirstBackend(new StubBackend(format, catalogs), 2);
    const parts = await finalParts(new RestaurantExecutor(format, backend, catalogs));

    expect(backend.queries).toHaveLength(2);
    expect(parts).toEqual([{kind: 'text', text: FALLBACK_TEXT}]);
  });
});

/**
 * Streams the first half of the stub's reply on the first turn, cut off inside its
 * `<a2ui-json>` block, then answers like the stub. Records where in `events` each turn
 * starts.
 */
class CutOffFirstBackend implements ModelBackend {
  readonly turnStarts: number[] = [];

  constructor(
    private readonly stub: StubBackend,
    private readonly events: AgentExecutionEvent[],
  ) {}

  async *streamTurn(input: TurnInput): AsyncIterable<string> {
    this.turnStarts.push(this.events.length);
    if (this.turnStarts.length > 1) {
      yield* this.stub.streamTurn(input);
      return;
    }
    let text = '';
    for await (const chunk of this.stub.streamTurn(input)) text += chunk;
    const half = text.substring(0, Math.floor(text.length / 2));
    const split = Math.floor(half.length / 2);
    yield half.substring(0, split);
    yield half.substring(split);
  }
}

/** Lists the surfaces and components the data parts of `events` create. */
function uiKeys(events: AgentExecutionEvent[]): Set<string> {
  const keys = new Set<string>();
  for (const event of events) {
    if (event.kind !== 'status-update') continue;
    for (const part of event.status.message?.parts ?? []) {
      if (part.kind !== 'data') continue;
      const {createSurface, updateComponents} = part.data as {
        createSurface?: {surfaceId: string};
        updateComponents?: {surfaceId: string; components: Array<{id: string}>};
      };
      if (createSurface) keys.add(`surface ${createSurface.surfaceId}`);
      for (const c of updateComponents?.components ?? []) {
        keys.add(`component ${updateComponents!.surfaceId}/${c.id}`);
      }
    }
  }
  return keys;
}

describe('a streamed Direct JSON reply that fails validation', () => {
  let catalogs: BasicCatalogs;

  beforeAll(async () => {
    catalogs = await loadBasicCatalogs();
  });

  it('is retried from a clean stream, and the retry sends its whole UI', async () => {
    const reference = new RestaurantExecutor(
      'direct_json',
      new StubBackend('direct_json', catalogs),
      catalogs,
    );
    const expected = uiKeys(await runTurn(reference, false));

    const events: AgentExecutionEvent[] = [];
    const backend = new CutOffFirstBackend(new StubBackend('direct_json', catalogs), events);
    await runTurn(new RestaurantExecutor('direct_json', backend, catalogs), true, events);

    expect(backend.turnStarts).toHaveLength(2);
    const [, retryStart] = backend.turnStarts;
    // The cut-off attempt streamed part of the UI before it failed validation.
    expect(uiKeys(events.slice(0, retryStart)).size).toBeGreaterThan(0);
    // Everything the retry streamed, plus the final status, carries the whole UI. Streaming
    // also sends `loading_*` placeholders, so the retry's keys are a superset.
    const retried = uiKeys(events.slice(retryStart));
    expect([...expected].filter(key => !retried.has(key))).toEqual([]);
  });
});
