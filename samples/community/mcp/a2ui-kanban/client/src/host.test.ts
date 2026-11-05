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
 * The four channels plus the direct A2UI-to-MCP function pipeline, as the chat
 * host sees them, with a scripted agent double that replays the Python agent's
 * storyline and an in-process fake MCP client.
 */

import type {Part} from '@a2a-js/sdk';
import type {McpToolClient} from '@a2ui/catalog-mcp';
import {DataContext, type SurfaceModel} from '@a2ui/web_core/v1_0';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
  A2UI_MIME_TYPE,
  recordingFetch,
  type A2aDirection,
  type AgentClient,
  type AgentReply,
} from './a2a.js';
import {
  BOARD_PATH,
  formatDebugPayload,
  KanbanHost,
  MCP_APP_MESSAGE_ACTION,
  messageText,
  QUICK_ADD_PATH,
  recordingMcpClientResolver,
  SELECTION_PATH,
  singleServerResolver,
  summarizeDebugPayload,
} from './host.js';

const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
const MCP_CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json';

const QUICK_ADD_TITLE_PATH = `${QUICK_ADD_PATH}/title`;
const QUICK_ADD_ASSIGNEE_PATH = `${QUICK_ADD_PATH}/assignee`;

interface Board {
  columns: Array<{
    id: string;
    title: string;
    wipLimit?: number;
    cards: Array<{id: string; title?: string; assignee?: string; due?: string; tags?: string[]}>;
  }>;
}

function seedBoard(): Board {
  return {
    columns: [
      {id: 'todo', title: 'Todo', cards: [{id: 't3'}, {id: 't4'}]},
      {id: 'in_progress', title: 'In progress', cards: [{id: 't1'}, {id: 't5'}]},
      {id: 'review', title: 'Review', wipLimit: 3, cards: [{id: 't2'}, {id: 't6'}, {id: 't7'}]},
      {id: 'done', title: 'Done', cards: [{id: 't8'}]},
    ],
  };
}

function moveCard(board: Board, taskId: string, toColumn: string): Board {
  return {
    columns: board.columns.map(column => ({
      ...column,
      cards: [
        ...column.cards.filter(card => card.id !== taskId),
        ...(column.id === toColumn ? [{id: taskId}] : []),
      ],
    })),
  };
}

function mcpCall(name: string, args: Record<string, unknown>): Record<string, unknown> {
  return {'@call': name, catalogId: MCP_CATALOG_ID, args};
}

function transform(data: unknown, jmespath: string): Record<string, unknown> {
  return mcpCall('transformData', {jmespath, data});
}

/** What the scripted Python agent sends for "show me the board" (see a2ui_messages.py). */
function boardSurfaceMessages(board: Board): Record<string, unknown>[] {
  return [
    {version: '1.0', createSurface: {surfaceId: 'kanban', catalogId: BASIC_CATALOG_ID}},
    {
      version: '1.0',
      updateDataModel: {
        surfaceId: 'kanban',
        path: '/kanban',
        value: {
          board,
          toolResult: board,
          selection: null,
          quickAdd: {title: 'Document MCP catalog', assignee: 'Ana'},
        },
      },
    },
    {
      version: '1.0',
      updateComponents: {
        surfaceId: 'kanban',
        components: [
          {
            id: 'root',
            component: 'Column',
            children: ['summary', 'selection_text', 'quick_add_card', 'board'],
          },
          {id: 'summary', component: 'Row', children: ['todo_count', 'wip_badge', 'done_count']},
          {
            id: 'todo_count',
            component: 'Text',
            text: transform(
              {'@path': BOARD_PATH},
              "join('', ['Todo: ', to_string(length(columns[?id == 'todo'].cards[]))])",
            ),
          },
          {
            id: 'wip_badge',
            component: 'Text',
            text: transform(
              {'@path': BOARD_PATH},
              "columns[?id == 'review'] | [0] | join('', [title, ' ', to_string(length(cards)), '/', to_string(wipLimit), (length(cards) > wipLimit && ' (over limit)' || '')])",
            ),
          },
          {
            id: 'done_count',
            component: 'Text',
            text: transform(
              {'@path': BOARD_PATH},
              "join('', ['Done: ', to_string(length(columns[?id == 'done'].cards[]))])",
            ),
          },
          {
            id: 'selection_text',
            component: 'Text',
            text: transform(
              {'@path': '/kanban'},
              "(selection.title && join('', ['Selected: ', selection.title, (selection.column && join('', [' in ', selection.column]) || ''), (selection.assignee && selection.due && join('', [' (', selection.assignee, ', due ', selection.due, ')']) || selection.assignee && join('', [' (', selection.assignee, ')']) || selection.due && join('', [' (due ', selection.due, ')']) || '')])) || 'No card selected'",
            ),
          },
          {id: 'quick_add_card', component: 'Card', child: 'quick_add_col'},
          {
            id: 'quick_add_col',
            component: 'Column',
            children: ['quick_add_row'],
          },
          {
            id: 'quick_add_row',
            component: 'Row',
            children: ['quick_add_title', 'quick_add_assignee', 'quick_add_button'],
          },
          {
            id: 'quick_add_title',
            component: 'TextField',
            label: 'Task title',
            value: {'@path': QUICK_ADD_TITLE_PATH},
          },
          {
            id: 'quick_add_assignee',
            component: 'TextField',
            label: 'Assignee',
            value: {'@path': QUICK_ADD_ASSIGNEE_PATH},
          },
          {
            id: 'quick_add_button',
            component: 'Button',
            child: 'quick_add_button_label',
            variant: 'primary',
            action: {
              functionCall: mcpCall('updateDataModel', {
                updates: transform(
                  mcpCall('callMcpTool', {
                    name: 'create_task',
                    arguments: {
                      title: {'@path': QUICK_ADD_TITLE_PATH},
                      assignee: {'@path': QUICK_ADD_ASSIGNEE_PATH},
                    },
                  }),
                  '{"/kanban/board": structuredContent, "/kanban/toolResult": toolResult}',
                ),
              }),
            },
          },
          {
            id: 'quick_add_button_label',
            component: 'Text',
            text: 'Add task',
          },
          {
            id: 'board',
            component: 'McpApp',
            catalogId: MCP_CATALOG_ID,
            title: 'Kanban board',
            htmlContent: '<!doctype html><html><body>board</body></html>',
            allowedTools: ['move_task', 'create_task', 'assign_task', 'list_board'],
            data: {
              paths: {
                board: BOARD_PATH,
                toolResult: '/kanban/toolResult',
                modelContext: '/kanban/modelContext',
                selection: SELECTION_PATH,
              },
            },
          },
        ],
      },
    },
  ];
}

function resolveText(surface: SurfaceModel, componentId: string): string {
  const component = surface.componentsModel.get(componentId);
  const context = new DataContext(surface, '/');
  return context.resolveDynamicValue<string>(component!.properties['text'] as never);
}

/** Replays the scripted agent: records every turn, answers from a queue. */
class ScriptedAgentDouble implements AgentClient {
  readonly turns: Part[][] = [];
  private readonly replies: AgentReply[] = [];

  reply(reply: AgentReply): void {
    this.replies.push(reply);
  }

  async send(parts: readonly Part[]): Promise<AgentReply> {
    this.turns.push([...parts]);
    return this.replies.shift() ?? {texts: ['OK.'], a2uiMessages: []};
  }

  lastTurn(): Part[] {
    return this.turns[this.turns.length - 1];
  }
}

function dataParts(parts: readonly Part[]): Record<string, unknown>[] {
  return parts
    .filter(part => part.kind === 'data')
    .filter(part => (part.metadata as {mimeType?: string})?.mimeType === A2UI_MIME_TYPE)
    .map(part => (part as {data: Record<string, unknown>}).data);
}

describe('KanbanHost', () => {
  let agent: ScriptedAgentDouble;
  let mcpCalls: Array<{name: string; arguments: unknown}>;
  let host: KanbanHost;
  let changes: number;
  let serverBoard: Board;

  beforeEach(async () => {
    agent = new ScriptedAgentDouble();
    mcpCalls = [];
    changes = 0;
    serverBoard = seedBoard();
    const fakeMcp = {
      request: async (request: {
        method: string;
        params?: {name?: string; arguments?: Record<string, unknown>};
      }) => {
        if (request.method === 'tools/call') {
          const name = request.params?.name ?? '';
          const args = request.params?.arguments ?? {};
          mcpCalls.push({name, arguments: args});
          if (name === 'create_task') {
            const colId = String(args['column'] ?? 'todo');
            serverBoard = {
              columns: serverBoard.columns.map(col =>
                col.id === colId
                  ? {
                      ...col,
                      cards: [
                        ...col.cards,
                        {
                          id: 't9',
                          title: String(args['title'] ?? ''),
                          assignee: String(args['assignee'] ?? ''),
                          due: String(args['due'] ?? ''),
                          tags: Array.isArray(args['tags']) ? (args['tags'] as string[]) : [],
                        },
                      ],
                    }
                  : col,
              ),
            };
          }
          return {
            content: [{type: 'text', text: JSON.stringify(serverBoard)}],
            structuredContent: serverBoard,
          };
        }
        return {tools: []};
      },
      readResource: async () => ({contents: []}),
      listTools: async () => ({tools: []}),
    } as unknown as McpToolClient;
    host = new KanbanHost({
      agent,
      getMcpClientForTool: singleServerResolver(async () => fakeMcp),
      onChange: () => {
        changes++;
      },
    });
    agent.reply({
      texts: ['Here is the sprint board.'],
      a2uiMessages: boardSurfaceMessages(seedBoard()),
    });
    await host.sendUserText('Show me the sprint board');
  });

  afterEach(() => {
    host.processor.dispose();
  });

  it('creates the board surface and evaluates the declarative transformData sibling badges', () => {
    const surface = host.boardSurface!;
    expect(surface).toBeDefined();
    expect(host.surfaces.length).toBe(1);
    expect(host.entries.map(entry => entry.role)).toEqual(['user', 'agent']);
    expect(host.entries[1].text).toBe('Here is the sprint board.');
    expect(resolveText(surface, 'todo_count')).toBe('Todo: 2');
    expect(resolveText(surface, 'done_count')).toBe('Done: 1');
    expect(resolveText(surface, 'wip_badge')).toBe('Review 3/3');
    expect(resolveText(surface, 'selection_text')).toBe('No card selected');
    expect(changes).toBeGreaterThan(0);
  });

  it('A: an agent dataModelUpdate replaces the bound board and the transformData badges follow', async () => {
    agent.reply({
      texts: ['Moved Write docs to Todo.'],
      a2uiMessages: [
        {
          version: '1.0',
          updateDataModel: {
            surfaceId: 'kanban',
            path: BOARD_PATH,
            value: moveCard(seedBoard(), 't2', 'todo'),
          },
        },
      ],
    });
    await host.sendUserText('Move Write docs back to Todo');
    const surface = host.boardSurface!;
    const dataModel = surface.dataModel;
    expect((dataModel.get(BOARD_PATH) as Board).columns[0].cards.map(card => card.id)).toEqual([
      't3',
      't4',
      't2',
    ]);
    expect(resolveText(surface, 'todo_count')).toBe('Todo: 3');
    expect(resolveText(surface, 'wip_badge')).toBe('Review 2/3');
    expect(host.entries.at(-1)).toEqual({role: 'agent', text: 'Moved Write docs to Todo.'});
  });

  it('B: the next turn carries the model context and selection, but not the board or quickAdd', async () => {
    const surface = host.boardSurface!;
    const dataModel = surface.dataModel;
    const modelContext = {
      selection: {
        taskId: 't3',
        title: 'Migrate DB',
        assignee: 'Ana',
        due: '2026-10-17',
        column: 'Todo',
      },
      filter: null,
      columns: [],
    };
    dataModel.set('/kanban/modelContext', modelContext);
    dataModel.set(SELECTION_PATH, modelContext.selection);

    await host.sendUserText('Who owns the selected card and when is it due?');
    const parts = agent.lastTurn();
    expect(parts[0]).toEqual({
      kind: 'text',
      text: 'Who owns the selected card and when is it due?',
    });
    const [rendererDataModel] = dataParts(parts);
    expect(rendererDataModel['version']).toBe('1.0');
    const kanban = (rendererDataModel['surfaces'] as {kanban: {kanban: Record<string, unknown>}})
      .kanban.kanban;
    expect(kanban['modelContext']).toEqual(modelContext);
    expect(kanban['selection']).toEqual(modelContext.selection);
    expect(kanban).not.toHaveProperty('board');
    expect(kanban).not.toHaveProperty('toolResult');
    expect(kanban).not.toHaveProperty('quickAdd');
    expect(resolveText(surface, 'selection_text')).toBe(
      'Selected: Migrate DB in Todo (Ana, due 2026-10-17)',
    );

    dataModel.set('/kanban', []);
    expect(host.rendererDataModel()).toBeNull();
  });

  it('C: a board written by the app re-evaluates the sibling transformData counters without the agent', () => {
    const surface = host.boardSurface!;
    const dataModel = surface.dataModel;
    const turnsBefore = agent.turns.length;
    dataModel.set(BOARD_PATH, moveCard(seedBoard(), 't1', 'review'));
    expect(resolveText(surface, 'wip_badge')).toBe('Review 4/3 (over limit)');
    expect(resolveText(surface, 'todo_count')).toBe('Todo: 2');
    expect(agent.turns.length).toBe(turnsBefore);
  });

  it('D: a ui/message from the app becomes a user turn with the action attached', async () => {
    agent.reply({
      texts: ['Review now has 4 cards, over its WIP limit of 3. Want me to move one back?'],
      a2uiMessages: [],
    });
    const content = [
      {
        type: 'text',
        text: 'Moved "Fix login" from In progress to Review.',
        _meta: {kanban: {event: 'moved', taskId: 't1', from: 'in_progress', to: 'review'}},
      },
    ];
    await host.handleAction({
      name: MCP_APP_MESSAGE_ACTION,
      surfaceId: 'kanban',
      sourceComponentId: 'board',
      timestamp: '2026-10-14T00:00:00.000Z',
      context: {role: 'user', content},
    });
    const parts = agent.lastTurn();
    expect(parts[0]).toEqual({kind: 'text', text: 'Moved "Fix login" from In progress to Review.'});
    const [action, rendererDataModel] = dataParts(parts);
    expect(action).toEqual({
      version: '1.0',
      action: {
        name: MCP_APP_MESSAGE_ACTION,
        surfaceId: 'kanban',
        sourceComponentId: 'board',
        timestamp: '2026-10-14T00:00:00.000Z',
        context: {role: 'user', content},
      },
    });
    expect(rendererDataModel['surfaces']).toBeDefined();
    expect(host.entries.slice(-2)).toEqual([
      {role: 'user', text: 'Moved "Fix login" from In progress to Review.'},
      {
        role: 'agent',
        text: 'Review now has 4 cards, over its WIP limit of 3. Want me to move one back?',
      },
    ]);
  });

  it('E: the quick-add button chains callMcpTool, transformData, and updateDataModel without an agent turn', async () => {
    const surface = host.boardSurface!;
    surface.dataModel.set(QUICK_ADD_TITLE_PATH, 'Write release notes');
    surface.dataModel.set(QUICK_ADD_ASSIGNEE_PATH, 'Bo');
    const turnsBefore = agent.turns.length;
    const quickAddButton = surface.componentsModel.get('quick_add_button')!;
    const context = new DataContext(surface, '/');

    await context.resolveAction(quickAddButton.properties['action'] as never);

    expect(agent.turns.length).toBe(turnsBefore);
    expect(mcpCalls).toEqual([
      {
        name: 'create_task',
        arguments: {title: 'Write release notes', assignee: 'Bo'},
      },
    ]);
    expect(resolveText(surface, 'todo_count')).toBe('Todo: 3');
    const updatedBoard = surface.dataModel.get<Board>(BOARD_PATH)!;
    expect(updatedBoard.columns[0].cards.at(-1)).toEqual({
      id: 't9',
      title: 'Write release notes',
      assignee: 'Bo',
      due: '',
      tags: [],
    });
    expect(surface.dataModel.get('/kanban/toolResult')).toEqual({
      content: [{type: 'text', text: JSON.stringify(updatedBoard)}],
      structuredContent: updatedBoard,
    });
    expect(host.lastWriter['board']).toBe('host');
    expect(host.debugLog['mcp-server'].map(e => summarizeDebugPayload(e.payload))).toEqual([
      'tools/call',
      'tools/call result',
      'tools/list',
      'tools/list result',
    ]);
  });

  it('logs other actions instead of sending them to the agent', async () => {
    const turnsBefore = agent.turns.length;
    await host.handleAction({
      name: 'something_else',
      surfaceId: 'kanban',
      sourceComponentId: 'root',
      timestamp: '2026-10-14T00:00:00.000Z',
      context: {},
    });
    expect(agent.turns.length).toBe(turnsBefore);
    expect(host.entries.at(-1)).toEqual({role: 'system', text: 'Action something_else from root'});
  });

  it('reports an agent failure in the log and recovers', async () => {
    const failing: AgentClient = {
      send: async () => {
        throw new Error('agent down');
      },
    };
    const lonely = new KanbanHost({
      agent: failing,
      getMcpClientForTool: singleServerResolver(async () => ({}) as McpToolClient),
    });
    await lonely.sendUserText('hello');
    expect(lonely.entries).toEqual([
      {role: 'user', text: 'hello'},
      {role: 'system', text: 'Agent error: agent down'},
    ]);
    expect(lonely.isBusy).toBe(false);
    lonely.processor.dispose();
  });

  it('dynamically updates the surface layout with Basic Catalog components wrapping McpApp', async () => {
    agent.reply({
      texts: ['Updated the surface to use Basic Catalog Tabs.'],
      a2uiMessages: [
        {
          version: '1.0',
          updateComponents: {
            surfaceId: 'kanban',
            components: [
              {id: 'root', component: 'Column', children: ['workspace_tabs']},
              {
                id: 'workspace_tabs',
                component: 'Tabs',
                tabs: [
                  {title: 'Sprint Board', child: 'board_card'},
                  {title: 'Sprint Summary & Selection', child: 'selection_card'},
                ],
              },
              {id: 'board_card', component: 'Card', child: 'board'},
              {id: 'selection_card', component: 'Card', child: 'selection_text'},
            ],
          },
        },
      ],
    });
    await host.sendUserText('Switch to the tabs layout');
    const components = host.boardSurface!.componentsModel;
    expect(components.get('workspace_tabs')?.type).toBe('Tabs');
    expect(components.get('board_card')?.type).toBe('Card');
    expect(components.get('board')?.type).toBe('McpApp');
    const a2ui = host.debugLog['a2ui'];
    expect(a2ui.filter(e => e.direction === 'agent-to-renderer')).toHaveLength(4);
    expect(summarizeDebugPayload(a2ui.at(-1)!.payload)).toBe('updateComponents');
    expect(
      a2ui
        .filter(e => e.direction === 'renderer-to-agent')
        .map(e => summarizeDebugPayload(e.payload)),
    ).toEqual(['renderer data model']);
  });

  it('records literal A2UI, MCP Apps, and MCP server messages for the debug pane', async () => {
    const a2ui = host.debugLog['a2ui'];
    expect(a2ui.map(e => summarizeDebugPayload(e.payload))).toEqual([
      'createSurface',
      'updateDataModel',
      'updateComponents',
    ]);
    expect(host.lastWriter['board']).toBe('agent');

    const fakeFrameWindow = {
      postMessage: (_msg: unknown, _origin?: unknown) => {},
    } as unknown as Window;
    const listeners: Array<(event: MessageEvent) => void> = [];
    const fakeHostWindow = {
      addEventListener: (_type: string, fn: (event: MessageEvent) => void) => {
        listeners.push(fn);
      },
      removeEventListener: (_type: string, fn: (event: MessageEvent) => void) => {
        const idx = listeners.indexOf(fn);
        if (idx >= 0) listeners.splice(idx, 1);
      },
    } as unknown as Window;

    const detach = host.attachMcpFrameDebugger(fakeHostWindow);
    const appMsg = {jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {}};
    const appWrite = {
      jsonrpc: '2.0',
      method: 'ui/notifications/data-model-change',
      params: {key: 'board', value: seedBoard()},
    };
    for (const listener of listeners) {
      listener({source: fakeFrameWindow, data: appMsg} as MessageEvent);
      listener({source: fakeFrameWindow, data: appWrite} as MessageEvent);
    }
    const hostReply = {jsonrpc: '2.0', id: 1, result: {protocolVersion: '2025-03-26'}};
    fakeFrameWindow.postMessage(hostReply, '*');
    expect(host.debugLog['mcp-apps']).toEqual([
      {direction: 'app-to-host', payload: appMsg},
      {direction: 'app-to-host', payload: appWrite},
      {direction: 'host-to-app', payload: hostReply},
    ]);
    expect(host.lastWriter['board']).toBe('app');
    expect(summarizeDebugPayload(hostReply)).toBe('rpc response #1');

    const fakeClient = {
      request: async () => ({content: [{type: 'text', text: 'moved'}]}),
      readResource: async () => ({contents: []}),
      listTools: async () => ({tools: []}),
    } as unknown as McpToolClient;
    const resolver = recordingMcpClientResolver(
      async () => fakeClient,
      (direction, payload) => host.recordDebug(direction, payload),
    );
    const client = (await resolver('move_task'))!;
    await client.request(
      {method: 'tools/call', params: {name: 'move_task', arguments: {taskId: 't1'}}},
      {} as never,
    );
    expect(host.debugLog['mcp-server']).toEqual([
      {
        direction: 'host-to-server',
        payload: {method: 'tools/call', params: {name: 'move_task', arguments: {taskId: 't1'}}},
      },
      {
        direction: 'server-to-host',
        payload: {method: 'tools/call', result: {content: [{type: 'text', text: 'moved'}]}},
      },
    ]);
    expect(summarizeDebugPayload(host.debugLog['mcp-server'][1].payload)).toBe('tools/call result');
    expect(await resolver('move_task')).toBe(client);

    const longHtml = 'x'.repeat(300);
    const formatted = formatDebugPayload({htmlContent: longHtml, keep: 'full'});
    expect(formatted).toContain('(300 chars)');
    expect(formatted).toContain('"keep": "full"');

    expect(host.debugMessageCount).toBeGreaterThan(0);
    host.clearDebugMessages();
    expect(host.debugMessageCount).toBe(0);
    for (const entries of Object.values(host.debugLog)) {
      expect(entries).toEqual([]);
    }
    expect(host.kanbanDataModel()).not.toBeNull();

    detach();
  });

  it('records literal A2A requests and responses between the host and the agent', async () => {
    const request = {
      jsonrpc: '2.0',
      id: 'r1',
      method: 'message/send',
      params: {message: {kind: 'message', role: 'user', parts: [{kind: 'text', text: 'hi'}]}},
    };
    const response = {
      jsonrpc: '2.0',
      id: 'r1',
      result: {kind: 'task', id: 't1', status: {state: 'completed'}},
    };
    const fetchImpl = async () =>
      new Response(JSON.stringify(response), {headers: {'content-type': 'application/json'}});
    const recorded: Array<[A2aDirection, Record<string, unknown>]> = [];
    const fetchWithRecording = recordingFetch(fetchImpl, (direction, payload) => {
      recorded.push([direction, payload]);
      host.recordDebug(direction, payload);
    });

    const reply = await fetchWithRecording('http://agent/', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    expect(await reply.json()).toEqual(response);
    expect(recorded).toEqual([
      ['host-to-agent', request],
      ['agent-to-host', response],
    ]);
    expect(host.debugLog['a2a']).toEqual([
      {direction: 'host-to-agent', payload: request},
      {direction: 'agent-to-host', payload: response},
    ]);
    expect(summarizeDebugPayload(request)).toBe('message/send');
    expect(summarizeDebugPayload(response)).toBe('rpc response #r1 (task)');

    await fetchWithRecording('http://agent/.well-known/agent-card.json');
    expect(host.debugLog['a2a'][2]).toEqual({
      direction: 'host-to-agent',
      payload: {method: 'GET', url: 'http://agent/.well-known/agent-card.json'},
    });
    expect(host.debugLog['a2a'][3]?.direction).toBe('agent-to-host');
  });
});

describe('messageText', () => {
  it('joins text blocks and ignores everything else', () => {
    expect(
      messageText([{type: 'text', text: 'a'}, {type: 'image'}, {type: 'text', text: 'b'}]),
    ).toBe('a\nb');
    expect(messageText('nope')).toBe('');
  });
});

describe('singleServerResolver', () => {
  it('connects once and retries after a failure', async () => {
    let attempts = 0;
    const resolver = singleServerResolver(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error('first try fails');
      }
      return {} as McpToolClient;
    });
    await expect(resolver('move_task')).rejects.toThrow('first try fails');
    const client = await resolver('move_task');
    expect(await resolver('list_board')).toBe(client);
    expect(attempts).toBe(2);
  });
});
