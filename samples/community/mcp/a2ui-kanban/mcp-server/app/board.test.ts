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
 * Drives the board app against a real `AppBridge` host over an in-memory
 * transport pair, the way the `@a2ui/catalog-mcp` host tests do, so both ends
 * run the real MCP Apps protocol; only the iframe boundary is left out.
 */

import {AppBridge} from '@modelcontextprotocol/ext-apps/app-bridge';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import type {CallToolResult, JSONRPCMessage} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {seedBoard} from '../src/board.js';
import {
  createBoardApp,
  DATA_MODEL_CHANGE_METHOD,
  DATA_MODEL_UPDATE_METHOD,
  type BoardApp,
} from './board.js';
import {moveCard, type Board} from './render.js';

/** One end of an in-memory JSON-RPC channel; messages reach the other end asynchronously. */
class LinkedTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  peer!: LinkedTransport;
  closed = false;

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    const peer = this.peer;
    setTimeout(() => {
      if (!peer.closed) {
        peer.onmessage?.(structuredClone(message));
      }
    }, 0);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.onclose?.();
  }
}

function linkTransports(): [LinkedTransport, LinkedTransport] {
  const host = new LinkedTransport();
  const app = new LinkedTransport();
  host.peer = app;
  app.peer = host;
  return [host, app];
}

const DataModelChangeNotificationSchema = z.object({
  method: z.literal(DATA_MODEL_CHANGE_METHOD),
  params: z.object({key: z.string(), subpath: z.string().optional(), value: z.unknown()}),
});

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400 && !predicate(); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  expect(predicate(), what).toBe(true);
}

/** The host side: what the `McpApp` bridge would do, recorded. */
interface FakeHost {
  readonly bridge: AppBridge;
  readonly transport: LinkedTransport;
  readonly toolCalls: Array<{name: string; arguments: Record<string, unknown>}>;
  readonly messages: Array<{role: string; content: unknown}>;
  readonly modelContexts: Array<Record<string, unknown>>;
  readonly dataChanges: Array<{key: string; value: unknown}>;
  /** The board `move_task` replies with; defaults to the optimistic move. */
  moveResult: (args: Record<string, unknown>) => CallToolResult;
  sendBoardUpdate(board: Board): Promise<void>;
}

function createFakeHost(transport: LinkedTransport, board: Board): FakeHost {
  const bridge = new AppBridge(
    null,
    {name: 'test host', version: '0.0.0'},
    {openLinks: {}, logging: {}, serverTools: {}},
    {
      hostContext: {
        theme: 'dark',
        displayMode: 'inline',
        availableDisplayModes: ['inline'],
        locale: 'en-US',
        timeZone: 'UTC',
        platform: 'web',
      },
    },
  );
  let current = board;
  const host: FakeHost = {
    bridge,
    transport,
    toolCalls: [],
    messages: [],
    modelContexts: [],
    dataChanges: [],
    moveResult: args => {
      current = moveCard(
        current,
        args['taskId'] as string,
        args['toColumn'] as string,
        args['index'] as number | undefined,
      );
      return {
        content: [{type: 'text', text: JSON.stringify(current)}],
        structuredContent: current as unknown as Record<string, unknown>,
      };
    },
    async sendBoardUpdate(next: Board) {
      current = next;
      await transport.send({
        jsonrpc: '2.0',
        method: DATA_MODEL_UPDATE_METHOD,
        params: {key: 'board', subpath: '/columns', value: next.columns},
      });
    },
  };
  bridge.oncalltool = async params => {
    const args = params.arguments ?? {};
    host.toolCalls.push({name: params.name, arguments: args});
    return host.moveResult(args);
  };
  bridge.onmessage = async params => {
    host.messages.push({role: params.role, content: params.content});
    return {};
  };
  bridge.onupdatemodelcontext = async params => {
    host.modelContexts.push(params.structuredContent ?? {});
    return {};
  };
  bridge.setNotificationHandler(DataModelChangeNotificationSchema, notification => {
    host.dataChanges.push({key: notification.params.key, value: notification.params.value});
  });
  bridge.oninitialized = () => {
    // What the `McpApp` bridge does once the app is up: deliver the bound `toolResult`.
    bridge
      .sendToolResult({
        content: [{type: 'text', text: JSON.stringify(current)}],
        structuredContent: current as unknown as Record<string, unknown>,
      })
      .catch(() => {});
  };
  return host;
}

describe('board app over the MCP Apps protocol', () => {
  let root: HTMLElement;
  let host: FakeHost;
  let boardApp: BoardApp;

  beforeEach(async () => {
    root = document.createElement('main');
    document.body.append(root);
    const [hostTransport, appTransport] = linkTransports();
    host = createFakeHost(hostTransport, seedBoard());
    await host.bridge.connect(hostTransport);
    boardApp = createBoardApp(root, {autoResize: false});
    await boardApp.connect(appTransport);
    await waitFor(() => boardApp.state().board !== null, 'initial board from tool-result');
  });

  afterEach(async () => {
    await boardApp.app.close();
    await host.bridge.close();
    document.body.textContent = '';
    delete document.documentElement.dataset['theme'];
  });

  it('renders the tool result, applies the host theme and publishes its model context', async () => {
    expect(root.querySelectorAll('li.card').length).toBe(8);
    expect(document.documentElement.dataset['theme']).toBe('dark');
    await waitFor(() => host.modelContexts.length >= 1, 'model context after the board arrived');
    const context = host.modelContexts.at(-1)!;
    expect(context['selection']).toBeNull();
    expect((context['columns'] as Array<{id: string; count: number}>).map(c => c.count)).toEqual([
      2, 2, 3, 1,
    ]);
  });

  it('A: re-renders on a data-model-update for the board binding', async () => {
    await host.sendBoardUpdate(moveCard(seedBoard(), 't1', 'done'));
    await waitFor(
      () => root.querySelector('.column[data-column-id="done"] .count')?.textContent === '2',
      'Done shows two cards',
    );
    expect(root.querySelector('.column[data-column-id="in_progress"] .count')?.textContent).toBe(
      '1',
    );
    // The app republishes its model context but does not echo the board back.
    await waitFor(
      () => (host.modelContexts.at(-1)?.['columns'] as Array<{count: number}>)?.[3]?.count === 2,
      'model context after the update',
    );
    expect(host.dataChanges.length).toBe(0);
  });

  it('B: a selection and a filter reach the host through update-model-context', async () => {
    boardApp.select('t3');
    boardApp.filter('Ana');
    await waitFor(
      () => (host.modelContexts.at(-1)?.['filter'] as string | null) === 'Ana',
      'filter published',
    );
    const context = host.modelContexts.at(-1)!;
    expect(context['selection']).toEqual({
      taskId: 't3',
      title: 'Migrate DB',
      assignee: 'Ana',
      due: '2026-10-17',
      column: 'Todo',
    });
    expect(root.querySelectorAll('li.card').length).toBe(3);
  });

  it('C and D: a drop writes the board binding, calls move_task and posts a chat message', async () => {
    await boardApp.move('t1', 'review');
    expect(host.toolCalls).toEqual([
      {name: 'move_task', arguments: {taskId: 't1', toColumn: 'review'}},
    ]);
    await waitFor(() => host.dataChanges.length >= 1, 'data-model-change for the board');
    const written = host.dataChanges[0];
    expect(written.key).toBe('board');
    expect((written.value as Board).columns[2].cards.map(card => card.id)).toEqual([
      't2',
      't6',
      't7',
      't1',
    ]);
    await waitFor(() => host.messages.length === 1, 'ui/message after the move');
    expect(host.messages[0]).toEqual({
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Moved "Fix login" from In progress to Review.',
          _meta: {kanban: {event: 'moved', taskId: 't1', from: 'in_progress', to: 'review'}},
        },
      ],
    });
    await waitFor(
      () =>
        (host.modelContexts.at(-1)?.['columns'] as Array<{overLimit: boolean}>)?.[2]?.overLimit ===
        true,
      'Review flagged over its limit in the model context',
    );
    expect(
      root.querySelector('.column[data-column-id="review"]')?.classList.contains('over-limit'),
    ).toBe(true);
  });

  it('D: rolls back and keeps quiet when the server refuses the move', async () => {
    host.moveResult = () => ({content: [{type: 'text', text: 'Unknown task id'}], isError: true});
    await boardApp.move('t1', 'done');
    expect(boardApp.state().board).toEqual(seedBoard());
    await waitFor(() => host.dataChanges.length >= 2, 'optimistic write then rollback write');
    expect(host.dataChanges.at(-1)?.value).toEqual(seedBoard());
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(host.messages.length).toBe(0);
  });

  it('D: rolls back when the tool call throws an exception', async () => {
    host.moveResult = () => {
      throw new Error('transport disconnected');
    };
    await expect(boardApp.move('t1', 'done')).rejects.toThrow();
    expect(boardApp.state().board).toEqual(seedBoard());
    await waitFor(() => host.dataChanges.length >= 2, 'optimistic write then rollback write');
    expect(host.dataChanges.at(-1)?.value).toEqual(seedBoard());
    expect(host.messages.length).toBe(0);
  });

  it('D: the split button posts the card as a split request', async () => {
    await boardApp.split(seedBoard().columns[0].cards[0]);
    await waitFor(() => host.messages.length === 1, 'ui/message for the split request');
    expect(host.messages[0].content).toEqual([
      {
        type: 'text',
        text: 'Please split "Migrate DB" into smaller subtasks.',
        _meta: {
          kanban: {
            event: 'split-request',
            task: {
              id: 't3',
              title: 'Migrate DB',
              assignee: 'Ana',
              due: '2026-10-17',
              tags: ['backend'],
            },
          },
        },
      },
    ]);
  });
});
