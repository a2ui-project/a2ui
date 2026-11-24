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

import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {CONTRACT_VERSION} from '@a2ui/embed/contract';
import {isValidUax31Identifier} from '@a2ui/web_core/v1_0';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {describe, expect, it} from 'vitest';

import {REDLINE_CATALOG_ID, redlineCatalog} from './catalog/index.js';
import {jsonBytes} from './compose/a2ui.js';
import {loadEnvFile} from './config.js';
import {createServer, REDLINE_TOOL_NAME, SERVER_INSTRUCTIONS} from './server.js';

interface EmbedPayload {
  contractVersion: string;
  messages: Array<Record<string, any>>;
  followUp?: {text: string};
}

const A2UI_IN_TEXT = /createSurface|updateComponents|updateDataModel|"@path"|"component"\s*:/;
const PLUGIN_TOOL_PREFIX = 'mcp_a2ui-redline_redline_';

function writeTempAppBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), 'a2ui-redline-test-'));
  const htmlPath = join(dir, 'a2ui-app.html');
  writeFileSync(htmlPath, '<!doctype html><title>Redline Test</title>');
  writeFileSync(
    join(dir, 'a2ui-app.catalog.json'),
    JSON.stringify({
      contractVersion: CONTRACT_VERSION,
      catalogs: {[REDLINE_CATALOG_ID]: redlineCatalog.validationSchema},
    }),
  );
  return htmlPath;
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      collectKeys(v, keys);
    }
  }
  return keys;
}

const payloadOf = (result: CallToolResult) =>
  (result.structuredContent as {a2ui: EmbedPayload} | undefined)?.a2ui;

const textOf = (result: CallToolResult) =>
  result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n');

async function connectTestClient(extraEnv: Record<string, string> = {}) {
  const client = new Client({name: 'redline-test-client', version: '0.1.0'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const {server, app} = createServer({
    REDLINE_APP_HTML: writeTempAppBundle(),
    ...extraEnv,
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const result = (await client.callTool({name, arguments: args})) as CallToolResult;
    expect(A2UI_IN_TEXT.test(textOf(result))).toBe(false);
    return result;
  }

  return {client, app, callTool};
}

describe('a2ui-embed-redline MCP server', () => {
  it('registers redline_negotiator within the 64-char MCP limit and exposes server instructions', async () => {
    const {client} = await connectTestClient();
    const {tools} = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(['a2ui_action', REDLINE_TOOL_NAME]);
    expect(`${PLUGIN_TOOL_PREFIX}${REDLINE_TOOL_NAME}`).toHaveLength(43);
    for (const tool of tools) {
      expect(`${PLUGIN_TOOL_PREFIX}${tool.name}`.length).toBeLessThanOrEqual(64);
    }
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS).toContain(
      'Make redline_negotiator the final tool call of your turn',
    );
    const redlineTool = tools.find(t => t.name === REDLINE_TOOL_NAME)!;
    expect(redlineTool.description).toContain(
      'Make redline_negotiator the final tool call of your turn',
    );
  });

  it('composes genuinely distinct, schema-valid component trees across scenarios', async () => {
    const {app, callTool} = await connectTestClient();

    const leaseRes = await callTool(REDLINE_TOOL_NAME, {
      prompt: 'Review an apartment lease with a 2.5x security deposit and 10% late fee',
    });
    const quoteRes = await callTool(REDLINE_TOOL_NAME, {
      prompt: 'Negotiate a $38,500 kitchen remodel contractor quote with 60% upfront milestones',
    });
    const freelanceRes = await callTool(REDLINE_TOOL_NAME, {
      prompt: 'Redline a freelance SOW with broad IP assignment and Net-60 payment',
    });

    for (const res of [leaseRes, quoteRes, freelanceRes]) {
      expect(res.isError).toBeFalsy();
      const messages = payloadOf(res)!.messages;
      expect(app.validate(messages)).toEqual({ok: true, errors: []});

      const createMsg = messages.find(m => m['createSurface'])!['createSurface'];
      expect(createMsg.sendDataModel).toBe(true);
      expect(createMsg.catalogId).toBe(REDLINE_CATALOG_ID);

      const components: Array<Record<string, any>> = messages.flatMap(
        m => m['updateComponents']?.components ?? [],
      );
      for (const comp of components) {
        expect(isValidUax31Identifier(comp['id'])).toBe(true);
        expect(comp['id']).not.toContain('-');
      }

      const dataModel = messages.find(m => m['updateDataModel'])!['updateDataModel'].value;
      expect(jsonBytes(dataModel)).toBeLessThan(12 * 1024);
      expect(collectKeys(dataModel).has('path')).toBe(false);
      expect(textOf(res)).toContain('Make redline_negotiator the final tool call of your turn');
    }

    const typesOf = (res: CallToolResult) =>
      payloadOf(res)!
        .messages.flatMap(m => m['updateComponents']?.components ?? [])
        .map((c: Record<string, any>) => c['component']);

    const leaseTypes = typesOf(leaseRes);
    const quoteTypes = typesOf(quoteRes);
    const freelanceTypes = typesOf(freelanceRes);

    // Lease has inline BenchmarkBullet slots inside ClauseRedline and omits MilestoneScheduleBar.
    expect(leaseTypes).not.toContain('MilestoneScheduleBar');
    expect(leaseTypes).toContain('BenchmarkBullet');

    // Contractor quote includes MilestoneScheduleBar + TwoUpRow of standalone BenchmarkBullets.
    expect(quoteTypes).toContain('MilestoneScheduleBar');
    expect(quoteTypes.filter(t => t === 'TwoUpRow')).toHaveLength(2);

    // Freelance agreement includes MilestoneScheduleBar after 3 ClauseRedlines and 1 TwoUpRow.
    expect(freelanceTypes).toContain('MilestoneScheduleBar');
    expect(freelanceTypes.filter(t => t === 'TwoUpRow')).toHaveLength(1);
    expect(freelanceTypes.filter(t => t === 'ClauseRedline')).toHaveLength(3);
  });

  it('handles finalize_counter, reset_picks, stale surfaces, and ask_clause_strategy follow-ups', async () => {
    const {callTool} = await connectTestClient();
    const res = await callTool(REDLINE_TOOL_NAME, {
      prompt: 'Review apartment lease',
      scenario: 'apartment_lease',
    });
    const surfaceId = payloadOf(res)!.messages[0]!['createSurface'].surfaceId as string;

    const locked = await callTool('a2ui_action', {
      name: 'finalize_counter',
      surfaceId,
      context: {
        stances: {deposit: 'counter', late_fee: 'counter', renewal_notice: 'counter'},
        tone: 'firm',
      },
    });
    expect(locked.isError).toBeFalsy();
    expect(textOf(locked)).toContain('Counter-package locked (firm tone)');
    expect(payloadOf(locked)!.messages[0]).toMatchObject({
      updateDataModel: {
        surfaceId,
        path: '/statusBanner',
      },
    });

    const reset = await callTool('a2ui_action', {
      name: 'reset_picks',
      surfaceId,
      context: {},
    });
    expect(reset.isError).toBeFalsy();
    expect(
      payloadOf(reset)!.messages.find(m => m['updateDataModel']?.path === '/stances')![
        'updateDataModel'
      ].value,
    ).toEqual({
      deposit: 'counter',
      late_fee: 'counter',
      renewal_notice: 'fallback',
    });

    const followUp = await callTool('a2ui_action', {
      name: 'ask_clause_strategy',
      surfaceId,
      context: {
        docTitle: '245 Valencia St Apt 4B — 12-Month Lease',
        tone: 'firm',
      },
    });
    expect(followUp.isError).toBeFalsy();
    expect(payloadOf(followUp)!.followUp?.text).toBe(
      'Give me a concise phone/email negotiation script and walk-away fallback if they push back on my "firm" counter-offer for "245 Valencia St Apt 4B — 12-Month Lease".',
    );

    const stale = await callTool('a2ui_action', {
      name: 'reset_picks',
      surfaceId: 'redline_999',
      context: {},
    });
    expect(textOf(stale)).toContain('earlier server session');
  });

  it('loads REDLINE_ENV_FILE without overriding existing variables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'a2ui-redline-env-'));
    const envFile = join(dir, 'custom.env');
    writeFileSync(envFile, 'CUSTOM_KEY="alpha"\nEXISTING_KEY=overridden\n');
    const env: NodeJS.ProcessEnv = {REDLINE_ENV_FILE: envFile, EXISTING_KEY: 'kept'};
    loadEnvFile(env);
    expect(env['CUSTOM_KEY']).toBe('alpha');
    expect(env['EXISTING_KEY']).toBe('kept');
  });
});
