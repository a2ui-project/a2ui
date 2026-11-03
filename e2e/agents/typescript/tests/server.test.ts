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

// Drives the scripted agent over A2A JSON-RPC on an ephemeral port, for every scenario and
// format it scripts, with a renderer of the scenario's protocol version. The renderer sends its
// capabilities the way the web shell does: the capabilities key in the message metadata.

import crypto from 'crypto';
import type {Server} from 'http';
import type {AddressInfo} from 'net';

import type {DataPart, Message, Part, Task, TaskStatusUpdateEvent} from '@a2a-js/sdk';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {V0_9, V1_0, type VersionProfile} from '../src/functions.js';
import {
  loadScenarios,
  openingText,
  type Scenario,
  turnA2uiMessages,
  turnText,
} from '../src/scenarios.js';
import type {ModelRequestRecord} from '../src/scripted-model.js';
import {A2UI_MIME_TYPE, createServer, DEFAULT_SCENARIO_DIR} from '../src/server.js';

type StreamEvent = Task | TaskStatusUpdateEvent;

const PROFILES: Readonly<Record<string, VersionProfile>> = {
  '0.9.1': V0_9,
  '1.0': V1_0,
};
const CAPABILITIES_KEY: Readonly<Record<string, string>> = {
  '0.9.1': 'a2uiClientCapabilities',
  '1.0': 'a2uiRendererCapabilities',
};

const SCENARIOS = [...loadScenarios(DEFAULT_SCENARIO_DIR)];
const CASES = SCENARIOS.flatMap(scenario =>
  scenario.formats.map(format => ({
    scenario,
    format,
    id: `${scenario.name} ${format} v${scenario.protocolVersion}`,
  })),
);

function textPart(text: string): Part {
  return {kind: 'text', text};
}

function a2uiPart(data: Record<string, unknown>): Part {
  return {kind: 'data', data, metadata: {mimeType: A2UI_MIME_TYPE}};
}

function capabilities(version: string): Record<string, unknown> {
  const profile = PROFILES[version];
  return {
    [CAPABILITIES_KEY[version]]: {
      [profile.wireVersion]: {supportedCatalogIds: [profile.catalogId]},
    },
  };
}

/** Replaces the `$match: any` placeholders of an expected envelope with values. */
function concrete(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(concrete);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === '$match') return '2026-01-01T00:00:00Z';
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, concrete(item)]));
  }
  return value;
}

function agentParts(events: StreamEvent[]): Part[] {
  return events.flatMap(event =>
    event.kind === 'status-update' && event.status.message?.role === 'agent'
      ? event.status.message.parts
      : [],
  );
}

function a2uiMessages(parts: Part[]): Record<string, unknown>[] {
  const dataParts = parts.filter((part): part is DataPart => part.kind === 'data');
  for (const part of dataParts) {
    expect(part.metadata?.mimeType).toBe(A2UI_MIME_TYPE);
  }
  return dataParts.map(part => part.data);
}

function text(parts: Part[]): string {
  return parts
    .filter((part): part is Part & {kind: 'text'} => part.kind === 'text')
    .map(part => part.text)
    .join('');
}

/** A renderer of one protocol version talking to the agent in one context. */
class Renderer {
  readonly contextId = crypto.randomUUID();

  constructor(
    private readonly endpoint: string,
    private readonly version: string,
  ) {}

  async send(parts: Part[], options: {capabilities?: boolean} = {}): Promise<StreamEvent[]> {
    const message: Message = {
      kind: 'message',
      messageId: crypto.randomUUID(),
      role: 'user',
      contextId: this.contextId,
      parts,
      ...(options.capabilities === false ? {} : {metadata: capabilities(this.version)}),
    };
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'message/stream',
        params: {message},
      }),
    });
    expect(response.status).toBe(200);
    const events = (await response.text())
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => {
        const body = JSON.parse(line.slice('data:'.length));
        expect(body.error).toBeUndefined();
        return body.result as StreamEvent;
      });
    expect(events.length).toBeGreaterThan(0);
    const last = events.at(-1) as TaskStatusUpdateEvent;
    expect(last.kind).toBe('status-update');
    expect(last.final).toBe(true);
    expect(last.status.state).not.toBe('failed');
    return events;
  }

  async log(): Promise<ModelRequestRecord[]> {
    const response = await fetch(new URL('/e2e/log', this.endpoint));
    expect(response.status).toBe(200);
    return (await response.json()) as ModelRequestRecord[];
  }
}

describe.each(CASES)('scripted agent over JSON-RPC ($id)', ({scenario, format}) => {
  let server: Server;
  let endpoint: string;

  beforeAll(async () => {
    const {app} = createServer({format});
    server = await new Promise<Server>(resolve => {
      const listening = app.listen(0, () => resolve(listening));
    });
    endpoint = `http://localhost:${(server.address() as AddressInfo).port}/`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  function renderer(version: string = scenario.protocolVersion): Renderer {
    return new Renderer(endpoint, version);
  }

  it('turn 0 with capabilities streams the scenario wire', async () => {
    const client = renderer();
    await fetch(new URL('/e2e/log', endpoint), {method: 'DELETE'});
    const turn = scenario.turns[0];

    const parts = agentParts(await client.send([textPart(openingText(scenario))]));

    expect(a2uiMessages(parts)).toEqual(turnA2uiMessages(turn));
    expect(text(parts).trim()).toBe(turnText(turn));
    const [record] = await client.log();
    expect(record.scenario).toBe(scenario.name);
    expect(record.turn).toBe(0);
    expect(record.version).toBe(scenario.protocolVersion);
    expect(record.a2uiEnabled).toBe(true);
    expect(record.systemInstruction).toContain(PROFILES[scenario.protocolVersion].catalogId);
  });

  it('turn 0 without capabilities answers with text only', async () => {
    const client = renderer();
    await fetch(new URL('/e2e/log', endpoint), {method: 'DELETE'});
    const turn = scenario.turns[0];

    const parts = agentParts(
      await client.send([textPart(openingText(scenario))], {capabilities: false}),
    );

    expect(a2uiMessages(parts)).toEqual([]);
    expect(text(parts)).toContain(turnText(turn));
    const [record] = await client.log();
    expect(record.a2uiEnabled).toBe(false);
    expect(record.version).toBeNull();
    expect(record.systemInstruction).not.toContain('<a2ui');
  });

  it('every turn replays after its outbound message', async () => {
    const client = renderer();
    await fetch(new URL('/e2e/log', endpoint), {method: 'DELETE'});

    await client.send([textPart(openingText(scenario))]);
    for (let i = 1; i < scenario.turns.length; i++) {
      const previous = scenario.turns[i - 1];
      const turn = scenario.turns[i];
      let parts: Part[];
      if (turn.userText !== null) {
        parts = [textPart(turn.userText)];
      } else {
        expect(previous.expectOutbound.length).toBeGreaterThan(0);
        parts = previous.expectOutbound.map(envelope =>
          a2uiPart(concrete(envelope) as Record<string, unknown>),
        );
      }

      const received = agentParts(await client.send(parts));

      expect(a2uiMessages(received)).toEqual(turnA2uiMessages(turn));
      expect(text(received).trim()).toBe(turnText(turn));
    }

    const records = await client.log();
    expect(records.map(record => record.turn)).toEqual(scenario.turns.map(turn => turn.index));
    for (const turn of scenario.turns.slice(1)) {
      if (turn.userText === null) {
        // The model sees the renderer's message formatted as text, not raw JSON.
        const inbound = records[turn.index].userContents.at(-1) ?? '';
        expect(/^(User triggered action|Renderer reported)/.test(inbound)).toBe(true);
      }
    }
  });

  it('withdrawing capabilities scopes the turn to text', async ({skip}) => {
    const turn = scenario.turns[1];
    if (!turn || turn.userText === null) skip();
    const client = renderer();

    await client.send([textPart(openingText(scenario))]);
    const parts = agentParts(await client.send([textPart(turn.userText!)], {capabilities: false}));

    expect(a2uiMessages(parts)).toEqual([]);
    expect(text(parts)).toContain(turnText(turn));
  });

  it('an unknown opening text gets a text reply', async () => {
    const parts = agentParts(await renderer().send([textPart('Hello, is anyone there?')]));

    expect(a2uiMessages(parts)).toEqual([]);
    expect(text(parts)).toContain('No scenario opens with');
  });

  it('a version without a scenario copy gets a text reply', async ({skip}) => {
    const missing = Object.keys(PROFILES).find(
      version =>
        version !== scenario.protocolVersion &&
        !SCENARIOS.some(
          (s: Scenario) =>
            s.protocolVersion === version && openingText(s) === openingText(scenario),
        ),
    );
    if (!missing) skip();
    const client = renderer(missing);
    await fetch(new URL('/e2e/log', endpoint), {method: 'DELETE'});

    const parts = agentParts(await client.send([textPart(openingText(scenario))]));

    expect(a2uiMessages(parts)).toEqual([]);
    expect(text(parts)).toContain(`No v${missing} copy of the scenario`);
    const [record] = await client.log();
    expect(record.version).toBe(missing);
    expect(record.systemInstruction).toContain(PROFILES[missing!].catalogId);
  });

  it('agent functions answer without a model turn', async ({skip}) => {
    if (scenario.protocolVersion !== '1.0') skip();
    const client = renderer();
    await fetch(new URL('/e2e/log', endpoint), {method: 'DELETE'});
    const call = (callId: string, name: string, args: Record<string, unknown>) => ({
      version: '1.0',
      callAgentFunction: {
        functionCallId: callId,
        surfaceId: 'any',
        callFunction: {'@call': name, catalogId: V1_0.catalogId, args},
      },
    });

    const priced = a2uiMessages(
      agentParts(await client.send([a2uiPart(call('c1', 'lookupPrice', {sku: 'sku-100'}))])),
    );
    const failed = a2uiMessages(
      agentParts(await client.send([a2uiPart(call('c2', 'failingLookup', {}))])),
    );

    expect(priced).toEqual([
      {version: '1.0', agentFunctionResponse: {functionCallId: 'c1', value: '$10.00'}},
    ]);
    expect(failed).toHaveLength(1);
    const response = failed[0].agentFunctionResponse as Record<string, unknown>;
    expect(response.functionCallId).toBe('c2');
    expect(response.error).toBeDefined();
    expect(await client.log()).toEqual([]);
  });
});
