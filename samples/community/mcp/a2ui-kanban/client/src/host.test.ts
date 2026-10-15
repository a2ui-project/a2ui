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
 * The four channels, as the chat host sees them, with a scripted agent double
 * that replays the Python agent's storyline and an in-process fake MCP client.
 */

import type {Part} from '@a2a-js/sdk';
import type {McpToolClient} from '@a2ui/catalog-mcp';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {A2UI_MIME_TYPE, type AgentClient, type AgentReply} from './a2a.js';
import {KanbanHost, MCP_APP_MESSAGE_ACTION, messageText, singleServerResolver} from './host.js';
import {BOARD_PATH, SELECTION_PATH, SUMMARY_PATH} from './summary.js';

const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
const MCP_CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json';

interface Board {
  columns: Array<{id: string; title: string; wipLimit?: number; cards: Array<{id: string}>}>;
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

/** What the scripted Python agent sends for "show me the board" (see a2ui_messages.py). */
function boardSurfaceMessages(board: Board): Record<string, unknown>[] {
  return [
    {version: 'v1.0', createSurface: {surfaceId: 'kanban', catalogId: BASIC_CATALOG_ID}},
    {
      version: 'v1.0',
      updateDataModel: {
        surfaceId: 'kanban',
        path: '/kanban',
        value: {
          board,
          toolResult: board,
          selection: null,
          summary: {todoText: '', doneText: '', wipText: '', selectionText: 'No card selected'},
        },
      },
    },
    {
      version: 'v1.0',
      updateComponents: {
        surfaceId: 'kanban',
        components: [
          {id: 'root', component: 'Column', children: ['summary', 'selection_text', 'board']},
          {id: 'summary', component: 'Row', children: ['todo_count', 'wip_badge', 'done_count']},
          {id: 'todo_count', component: 'Text', text: {'@path': '/kanban/summary/todoText'}},
          {id: 'wip_badge', component: 'Text', text: {'@path': '/kanban/summary/wipText'}},
          {id: 'done_count', component: 'Text', text: {'@path': '/kanban/summary/doneText'}},
          {
            id: 'selection_text',
            component: 'Text',
            text: {'@path': '/kanban/summary/selectionText'},
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

  beforeEach(async () => {
    agent = new ScriptedAgentDouble();
    mcpCalls = [];
    changes = 0;
    const fakeMcp = {
      callTool: async (params: {name: string; arguments?: unknown}) => {
        mcpCalls.push({name: params.name, arguments: params.arguments});
        return {content: [], structuredContent: seedBoard()};
      },
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

  it('creates the board surface from the agent reply and derives the sibling summary', () => {
    const surface = host.boardSurface;
    expect(surface).toBeDefined();
    expect(host.surfaces.length).toBe(1);
    expect(host.entries.map(entry => entry.role)).toEqual(['user', 'agent']);
    expect(host.entries[1].text).toBe('Here is the sprint board.');
    expect(surface!.dataModel.get(`${SUMMARY_PATH}/todoText`)).toBe('Todo: 2');
    expect(surface!.dataModel.get(`${SUMMARY_PATH}/doneText`)).toBe('Done: 1');
    expect(surface!.dataModel.get(`${SUMMARY_PATH}/wipText`)).toBe('Review 3/3');
    expect(surface!.dataModel.get(`${SUMMARY_PATH}/selectionText`)).toBe('No card selected');
    expect(changes).toBeGreaterThan(0);
  });

  it('A: an agent dataModelUpdate replaces the bound board and the summary follows', async () => {
    agent.reply({
      texts: ['Moved Write docs to Todo.'],
      a2uiMessages: [
        {
          version: 'v1.0',
          updateDataModel: {
            surfaceId: 'kanban',
            path: BOARD_PATH,
            value: moveCard(seedBoard(), 't2', 'todo'),
          },
        },
      ],
    });
    await host.sendUserText('Move Write docs back to Todo');
    const dataModel = host.boardSurface!.dataModel;
    expect((dataModel.get(BOARD_PATH) as Board).columns[0].cards.map(card => card.id)).toEqual([
      't3',
      't4',
      't2',
    ]);
    expect(dataModel.get(`${SUMMARY_PATH}/todoText`)).toBe('Todo: 3');
    expect(dataModel.get(`${SUMMARY_PATH}/wipText`)).toBe('Review 2/3');
    expect(host.entries.at(-1)).toEqual({role: 'agent', text: 'Moved Write docs to Todo.'});
  });

  it('B: the next turn carries the model context and selection, but not the board', async () => {
    const dataModel = host.boardSurface!.dataModel;
    // What the McpApp bridge writes when the app sends ui/update-model-context.
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
    expect(rendererDataModel['version']).toBe('v1.0');
    const kanban = (rendererDataModel['surfaces'] as {kanban: {kanban: Record<string, unknown>}})
      .kanban.kanban;
    expect(kanban['modelContext']).toEqual(modelContext);
    expect(kanban['selection']).toEqual(modelContext.selection);
    expect(kanban).not.toHaveProperty('board');
    expect(kanban).not.toHaveProperty('toolResult');
    expect(dataModel.get(`${SUMMARY_PATH}/selectionText`)).toBe(
      'Selected: Migrate DB in Todo (Ana, due 2026-10-17)',
    );

    dataModel.set('/kanban', []);
    expect(host.rendererDataModel()).toBeNull();
  });

  it('C: a board written by the app re-renders the sibling counters without the agent', () => {
    const dataModel = host.boardSurface!.dataModel;
    const turnsBefore = agent.turns.length;
    // What the McpApp bridge writes for the app's ui/notifications/data-model-change.
    dataModel.set(BOARD_PATH, moveCard(seedBoard(), 't1', 'review'));
    expect(dataModel.get(`${SUMMARY_PATH}/wipText`)).toBe('Review 4/3 (over limit)');
    expect(dataModel.get(`${SUMMARY_PATH}/todoText`)).toBe('Todo: 2');
    expect(dataModel.get(SUMMARY_PATH)).toMatchObject({overLimit: true});
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
      version: 'v1.0',
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
