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
 * Tests the MCP server end to end with an in-memory client. Skipped until
 * `yarn fetch-data` and `yarn build` have run.
 */

import {existsSync} from 'node:fs';

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {catalogSchemaPath, createServer, databasePath, SERVER_INSTRUCTIONS} from './app.js';

const ready = existsSync(databasePath()) && existsSync(catalogSchemaPath());

const GENRE_REVENUE =
  'SELECT g.Name AS genre, SUM(il.UnitPrice * il.Quantity) AS revenue FROM InvoiceLine il JOIN Track t ON t.TrackId = il.TrackId JOIN Genre g ON g.GenreId = t.GenreId GROUP BY genre ORDER BY revenue DESC LIMIT 10';

interface Payload {
  contractVersion: string;
  messages: Array<Record<string, unknown>>;
  followUp?: {text: string};
}

function payload(result: CallToolResult): Payload {
  return (result.structuredContent as {a2ui: Payload}).a2ui;
}

function text(result: CallToolResult): string {
  return result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n');
}

describe.skipIf(!ready)('a2ui-embed-sql MCP server', () => {
  const client = new Client({name: 'test', version: '1.0.0'});

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer({...process.env, GEMINI_API_KEY: ''}).connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(() => client.close());

  async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return (await client.callTool({name, arguments: args})) as CallToolResult;
  }

  it('sends instructions about reusing the summaries', () => {
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS).toMatch(/instead of querying again/);
  });

  it('lists the tools with the app resource and the app-only action tool', async () => {
    const {tools} = await client.listTools();
    expect(tools.map(tool => tool.name)).toEqual([
      'list_tables',
      'query',
      'explain',
      'a2ui_action',
    ]);
    expect(tools[1]?._meta).toMatchObject({ui: {resourceUri: 'ui://a2ui/app.html'}});
    const {contents} = await client.readResource({uri: 'ui://a2ui/app.html'});
    expect(contents[0]?.mimeType).toBe('text/html;profile=mcp-app');
  });

  it('returns a text summary in content and the A2UI in structuredContent', async () => {
    const result = await call('query', {sql: GENRE_REVENUE});
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('Rock');
    expect(text(result)).not.toContain('updateComponents');
    const {messages} = payload(result);
    expect(messages[0]).toMatchObject({createSurface: {sendDataModel: true}});
  });

  it('says in the summary that a large result is only partly shown', async () => {
    const result = await call('query', {sql: 'SELECT * FROM Track'});
    expect(text(result)).toMatch(/The view shows the first \d+ of 500 rows\./);
    const model = payload(result).messages.find(message => 'updateDataModel' in message);
    expect(Buffer.byteLength(JSON.stringify(model))).toBeLessThan(16 * 1024);
  });

  it('offers breakdowns through foreign key joins', async () => {
    const json = JSON.stringify(payload(await call('query', {sql: GENRE_REVENUE})));
    expect(json).toContain('"dimension":"MediaType.Name"');
    expect(json).toContain('"dimension":"Artist.Name"');
    expect(json).not.toContain('"dimension":"Genre.Name"');
  });

  it('turns failing SQL into an error result with the message', async () => {
    const result = await call('query', {sql: 'DELETE FROM Artist'});
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^Tool "query" failed: /);
  });

  it('refreshes a surface in place through a2ui_action', async () => {
    const result = await call('a2ui_action', {
      name: 'refresh',
      surfaceId: 'surface-1',
      context: {sql: 'SELECT COUNT(*) AS customers FROM Customer'},
    });
    expect(result.isError).toBeFalsy();
    const kinds = payload(result).messages.map(message =>
      Object.keys(message).find(key => key !== 'version'),
    );
    expect(kinds).toEqual(['updateComponents', 'updateDataModel']);
  });

  it('refreshes a composed surface with valid data-only updates', async () => {
    const result = await call('a2ui_action', {
      name: 'refresh',
      surfaceId: 'surface-2',
      context: {sql: 'SELECT Name FROM Genre LIMIT 3', layout: 'composed'},
    });
    expect(result.isError).toBeFalsy();
    const kinds = payload(result).messages.map(message =>
      Object.keys(message).find(key => key !== 'version'),
    );
    expect(new Set(kinds)).toEqual(new Set(['updateDataModel']));
  });

  it('builds breakdown follow-ups from the server template', async () => {
    const result = await call('a2ui_action', {
      name: 'breakdown',
      surfaceId: 'surface-1',
      context: {metric: 'revenue', dimension: 'MediaType.Name'},
    });
    expect(payload(result).followUp).toEqual({text: 'Break down "revenue" by "MediaType.Name"'});
  });

  it('answers explain without a key with text only', async () => {
    const result = await call('explain', {question: 'How many artists?'});
    expect(result.structuredContent).toBeUndefined();
    expect(text(result)).toContain('GEMINI_API_KEY');
  });
});
