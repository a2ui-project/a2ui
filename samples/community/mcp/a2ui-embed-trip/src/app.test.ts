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

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {describe, expect, it} from 'vitest';

import {createServer, SERVER_INSTRUCTIONS} from './app.js';
import {SCENARIO_FIXTURES} from './scenarios/catalog_data.js';
import {writeTestAppFiles} from './testing/validation.js';

interface EmbedPayload {
  contractVersion: string;
  messages: Array<Record<string, unknown>>;
  followUp?: {text: string};
}

const TOOL_PREFIX = 'mcp_a2ui-trip_trip_';
const A2UI_IN_TEXT = /createSurface|updateComponents|updateDataModel|"@path"|"component"\s*:/;

function textOf(result: CallToolResult): string {
  return result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n');
}

function payloadOf(result: CallToolResult): EmbedPayload | undefined {
  return (result.structuredContent as {a2ui?: EmbedPayload} | undefined)?.a2ui;
}

async function connect() {
  const client = new Client({name: 'trip-test', version: '1.0.0'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const {server} = createServer({TRIP_APP_HTML: writeTestAppFiles()});
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const result = (await client.callTool({name, arguments: args})) as CallToolResult;
    expect(A2UI_IN_TEXT.test(textOf(result))).toBe(false);
    return result;
  }

  return {client, call};
}

describe('a2ui-embed-trip MCP server', () => {
  it('registers trip_studio and app-only a2ui_action within the 64-character host tool limit', async () => {
    const {client} = await connect();
    const {tools} = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(['a2ui_action', 'trip_studio']);
    for (const tool of tools) {
      const fullName = `${TOOL_PREFIX}${tool.name}`;
      expect(fullName.length).toBeLessThanOrEqual(64);
      expect(fullName).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
  });

  it('renders afternoon_gap and weekend_budget compositions and handles actions + followUps', async () => {
    const {call} = await connect();

    const gapResult = await call('trip_studio', {
      prompt: 'Squeeze a museum + coffee between 2pm check-in and 7pm dinner',
    });
    expect(gapResult.isError).toBeFalsy();
    expect(textOf(gapResult)).toContain('Kyoto Afternoon Gap Studio');

    const surfaceId = (
      payloadOf(gapResult)!.messages.find(m => 'createSurface' in m)!['createSurface'] as {
        surfaceId: string;
      }
    ).surfaceId;

    const rainResult = await call('a2ui_action', {
      name: 'rain_reschedule',
      surfaceId,
      context: {
        scenario: 'afternoon_gap',
        stops: SCENARIO_FIXTURES.afternoon_gap.stops,
      },
    });
    expect(rainResult.isError).toBeFalsy();
    expect(textOf(rainResult)).toContain('indoor rain backups');

    const lockResult = await call('a2ui_action', {
      name: 'lock_itinerary',
      surfaceId,
      context: {
        scenario: 'afternoon_gap',
        stops: SCENARIO_FIXTURES.afternoon_gap.stops,
        budgetCap: 160,
      },
    });
    expect(lockResult.isError).toBeFalsy();
    expect(textOf(lockResult)).toContain('Locked 4 stops');

    const followUpResult = await call('a2ui_action', {
      name: 'ask_local_spots',
      surfaceId,
      context: {
        neighborhood: 'Nakagyo · Gion',
        stopTitle: 'Museum of Kyoto Craft Vaults',
      },
    });
    expect(followUpResult.isError).toBeFalsy();
    expect(payloadOf(followUpResult)?.followUp?.text).toContain('"Nakagyo · Gion"');
    expect(payloadOf(followUpResult)?.followUp?.text).toContain('"Museum of Kyoto Craft Vaults"');
  });
});
