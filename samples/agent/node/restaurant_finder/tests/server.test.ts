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

// Drives the stub agent over A2A JSON-RPC, the way the sample clients do. No model
// and no API key: STUB_LLM=true serves the notice surface and a canned example.

import * as crypto from 'crypto';
import type {Server} from 'http';
import type {AddressInfo} from 'net';

import type {DataPart, Message, Part, Task, TaskStatusUpdateEvent} from '@a2a-js/sdk';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import type {A2uiFormat} from '../src/config.js';
import {createApp} from '../src/index.js';
import {V1_0} from '../src/versions.js';

type StreamEvent = Task | Message | TaskStatusUpdateEvent;

const FORMATS: A2uiFormat[] = ['direct_json', 'express'];
const V1_0_CATALOG = V1_0.basicCatalogId;

function userMessage(parts: Part[], metadata?: Record<string, unknown>): Message {
  return {kind: 'message', messageId: crypto.randomUUID(), role: 'user', parts, metadata};
}

const query: Part = {kind: 'text', text: 'Top 5 Chinese restaurants in New York.'};

/** The A2UI messages in a list of parts, checking that each is labeled as A2UI. */
function a2uiMessages(parts: Part[] = []): Record<string, unknown>[] {
  const dataParts = parts.filter((part): part is DataPart => part.kind === 'data');
  for (const part of dataParts) {
    expect(part.metadata?.mimeType).toBe('application/a2ui+json');
  }
  return dataParts.map(part => part.data);
}

function createdSurfaceIds(messages: Record<string, unknown>[]): string[] {
  return messages
    .map(msg => (msg.createSurface as {surfaceId?: string} | undefined)?.surfaceId)
    .filter((id): id is string => id !== undefined);
}

describe.each(FORMATS)('stub agent over JSON-RPC (%s)', format => {
  let server: Server;
  let endpoint: string;

  beforeAll(async () => {
    const {app} = await createApp({env: {STUB_LLM: 'true', A2UI_FORMAT: format}});
    server = await new Promise<Server>(resolve => {
      const listening = app.listen(0, () => resolve(listening));
    });
    endpoint = `http://localhost:${(server.address() as AddressInfo).port}/a2a/json-rpc`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  function post(method: string, message: Message): Promise<Response> {
    return fetch(endpoint, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: crypto.randomUUID(), method, params: {message}}),
    });
  }

  /** message/send: returns the finished task. */
  async function send(message: Message): Promise<Task> {
    const body = await (await post('message/send', message)).json();
    expect(body.error).toBeUndefined();
    expect(body.result.kind).toBe('task');
    return body.result as Task;
  }

  /** message/stream: returns every event the server sent, in order. */
  async function stream(message: Message): Promise<StreamEvent[]> {
    const text = await (await post('message/stream', message)).text();
    return text
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => {
        const body = JSON.parse(line.slice('data:'.length));
        expect(body.error).toBeUndefined();
        return body.result as StreamEvent;
      });
  }

  it('message/send without capabilities answers in v0.9 in the final status', async () => {
    const task = await send(userMessage([query, {kind: 'data', data: {useStreaming: false}}]));

    expect(task.status.state).toBe('input-required');
    const messages = a2uiMessages(task.status.message?.parts);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every(msg => msg.version === 'v0.9')).toBe(true);
    expect(createdSurfaceIds(messages)).toEqual(expect.arrayContaining(['stub-notice', 'default']));
  });

  it('message/stream with v1.0 capabilities streams v1.0 in working updates', async () => {
    const events = await stream(
      userMessage([query], {
        a2uiRendererCapabilities: {'v1.0': {supportedCatalogIds: [V1_0_CATALOG]}},
      }),
    );

    const working = events.filter(
      (event): event is TaskStatusUpdateEvent =>
        event.kind === 'status-update' && event.status.state === 'working',
    );
    const messages = working.flatMap(event => a2uiMessages(event.status.message?.parts));
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every(msg => msg.version === 'v1.0')).toBe(true);
    expect(createdSurfaceIds(messages)).toEqual(expect.arrayContaining(['stub-notice', 'default']));

    const last = events.at(-1) as TaskStatusUpdateEvent;
    expect(last.kind).toBe('status-update');
    expect(last.final).toBe(true);
    expect(last.status.state).toBe('input-required');
  });

  describe('an unknown catalog id fails the task under its announced id', () => {
    const unknownCatalog = {
      a2uiRendererCapabilities: {
        'v1.0': {supportedCatalogIds: ['https://example.com/unknown/catalog.json']},
      },
    };

    it('message/stream', async () => {
      const events = await stream(userMessage([query], unknownCatalog));

      const first = events[0] as Task;
      expect(first.kind).toBe('task');
      const last = events.at(-1) as TaskStatusUpdateEvent;
      expect(last.kind).toBe('status-update');
      expect(last.final).toBe(true);
      expect(last.status.state).toBe('failed');
      expect(last.taskId).toBe(first.id);
    });

    it('message/send', async () => {
      const task = await send(
        userMessage([query, {kind: 'data', data: {useStreaming: false}}], unknownCatalog),
      );

      expect(task.status.state).toBe('failed');
      expect(task.status.message?.taskId).toBe(task.id);
    });
  });
});
