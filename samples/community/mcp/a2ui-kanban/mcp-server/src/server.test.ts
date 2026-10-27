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

/** Smoke test of the Streamable HTTP server with a real MCP client. */

import assert from 'node:assert/strict';
import type {AddressInfo} from 'node:net';
import {after, before, describe, it} from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {KanbanBoard, type Board} from './board.js';
import {BOARD_RESOURCE_URI, createHttpServer, MCP_PATH, RESET_PATH} from './server.js';

const APP_HTML = '<!doctype html><html><body>board</body></html>';

describe('Kanban MCP server over Streamable HTTP', () => {
  const board = new KanbanBoard();
  const httpServer = createHttpServer(board, {readAppHtml: () => APP_HTML});
  let baseUrl: string;
  let client: Client;

  before(async () => {
    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    const {port} = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    client = new Client({name: 'test', version: '0.0.0'});
    await client.connect(new StreamableHTTPClientTransport(new URL(MCP_PATH, baseUrl)));
  });

  after(async () => {
    await client.close();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  });

  it('advertises open_board with the app resource in _meta.ui.resourceUri', async () => {
    const {tools} = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), [
      'assign_task',
      'create_task',
      'list_board',
      'move_task',
      'open_board',
    ]);
    const openBoard = tools.find(tool => tool.name === 'open_board');
    assert.equal(
      (openBoard?._meta?.['ui'] as {resourceUri?: string})?.resourceUri,
      BOARD_RESOURCE_URI,
    );
    assert.equal(tools.find(tool => tool.name === 'move_task')?._meta?.['ui'], undefined);
  });

  it('serves the board app with the MCP App MIME type', async () => {
    const {resources} = await client.listResources();
    assert.equal(resources.length, 1);
    assert.equal(resources[0].uri, BOARD_RESOURCE_URI);
    assert.equal(resources[0].mimeType, 'text/html;profile=mcp-app');
    const {contents} = await client.readResource({uri: BOARD_RESOURCE_URI});
    assert.equal(contents.length, 1);
    assert.equal(contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.equal('text' in contents[0] ? contents[0].text : undefined, APP_HTML);
  });

  it('returns the whole board as structuredContent and reports bad ids as tool errors', async () => {
    const moved = await client.callTool({
      name: 'move_task',
      arguments: {taskId: 't1', toColumn: 'review'},
    });
    const review = (moved.structuredContent as Board).columns.find(
      column => column.id === 'review',
    );
    assert.deepEqual(
      review?.cards.map(card => card.id),
      ['t2', 't6', 't7', 't1'],
    );

    const listed = await client.callTool({name: 'list_board', arguments: {}});
    assert.deepEqual(listed.structuredContent, moved.structuredContent);

    const failed = await client.callTool({
      name: 'move_task',
      arguments: {taskId: 'nope', toColumn: 'done'},
    });
    assert.equal(failed.isError, true);
    assert.deepEqual(failed.content, [{type: 'text', text: 'Unknown task id: nope'}]);
  });

  it('restores the seed board on POST /reset', async () => {
    const response = await fetch(new URL(RESET_PATH, baseUrl), {method: 'POST'});
    assert.equal(response.status, 200);
    const listed = await client.callTool({name: 'list_board', arguments: {}});
    const inProgress = (listed.structuredContent as Board).columns.find(
      column => column.id === 'in_progress',
    );
    assert.deepEqual(
      inProgress?.cards.map(card => card.id),
      ['t1', 't5'],
    );
  });
});
