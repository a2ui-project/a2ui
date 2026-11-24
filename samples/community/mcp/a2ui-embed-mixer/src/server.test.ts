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

import {CONTRACT_VERSION, type CatalogSchemaFile} from '@a2ui/embed/contract';
import {isValidUax31Identifier} from '@a2ui/web_core/validation';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {describe, expect, it} from 'vitest';

import {MIXER_CATALOG_ID, mixerCatalog} from './catalog/index.js';
import {loadEnvFile} from './config.js';
import {createServer, SERVER_INSTRUCTIONS} from './server.js';

interface EmbedPayload {
  contractVersion: string;
  messages: Array<Record<string, unknown>>;
  followUp?: {text: string};
}

const TOOL_PREFIX = 'mcp_a2ui-mixer_mixer_';
const A2UI_LEAK_RE = /createSurface|updateComponents|updateDataModel|"@path"|"component"\s*:/;

function writeTempAppBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), 'a2ui-mixer-test-'));
  const htmlPath = join(dir, 'a2ui-app.html');
  const schemaFile: CatalogSchemaFile = {
    contractVersion: CONTRACT_VERSION,
    catalogs: {[MIXER_CATALOG_ID]: mixerCatalog.validationSchema},
  } as CatalogSchemaFile;
  writeFileSync(htmlPath, '<!doctype html><title>mixer test</title>');
  writeFileSync(join(dir, 'a2ui-app.catalog.json'), JSON.stringify(schemaFile));
  return htmlPath;
}

function collectObjectKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out.add(k);
      collectObjectKeys(v, out);
    }
  }
  return out;
}

async function connectTestServer() {
  const client = new Client({name: 'mixer-test-client', version: '1.0.0'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const {server, app} = createServer({MIXER_APP_HTML: writeTempAppBundle()});
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const result = (await client.callTool({name, arguments: args})) as CallToolResult;
    const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n');
    expect(A2UI_LEAK_RE.test(text)).toBe(false);
    return result;
  }

  return {client, app, call};
}

function extractPayload(result: CallToolResult): EmbedPayload {
  return (result.structuredContent as {a2ui: EmbedPayload}).a2ui;
}

function componentTypesOf(payload: EmbedPayload): string[] {
  return payload.messages.flatMap(msg => {
    const update = msg['updateComponents'] as {components?: Array<{component: string}>} | undefined;
    return (update?.components ?? []).map(c => c.component);
  });
}

function componentIdsOf(payload: EmbedPayload): string[] {
  return payload.messages.flatMap(msg => {
    const update = msg['updateComponents'] as {components?: Array<{id: string}>} | undefined;
    return (update?.components ?? []).map(c => c.id);
  });
}

function initialDataModelOf(payload: EmbedPayload): Record<string, unknown> {
  const msg = payload.messages.find(entry => {
    const udm = entry['updateDataModel'] as {path?: string} | undefined;
    return Boolean(udm && udm.path === undefined);
  });
  return ((msg?.['updateDataModel'] as {value: Record<string, unknown>}) ?? {}).value;
}

describe('a2ui-embed-mixer MCP server', () => {
  it('exposes goal_mixer + app-only a2ui_action within the 64-char MCP tool limit', async () => {
    const {client} = await connectTestServer();
    const {tools} = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(['a2ui_action', 'goal_mixer']);
    expect(`${TOOL_PREFIX}goal_mixer`.length).toBe(31);
    for (const tool of tools) {
      expect(`${TOOL_PREFIX}${tool.name}`.length).toBeLessThanOrEqual(64);
    }
    const actionMeta = tools.find(t => t.name === 'a2ui_action')?._meta as
      | {ui?: {visibility?: string[]}}
      | undefined;
    expect(actionMeta?.ui?.visibility).toEqual(['app']);
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
  });

  it('supports MIXER_ENV_FILE without overriding pre-existing environment variables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'a2ui-mixer-env-'));
    const envFile = join(dir, 'custom.env');
    writeFileSync(envFile, 'MIXER_SAMPLE_VAR="from_file"\nEXISTING_VAR=ignored\n');
    const env: NodeJS.ProcessEnv = {MIXER_ENV_FILE: envFile, EXISTING_VAR: 'kept'};
    loadEnvFile(env);
    expect(env['MIXER_SAMPLE_VAR']).toBe('from_file');
    expect(env['EXISTING_VAR']).toBe('kept');
  });

  it('composes genuinely different validated custom component trees per scenario', async () => {
    const {call, app} = await connectTestServer();

    const mealRes = await call('goal_mixer', {
      prompt: 'Weekday high-protein meal prep under $65 and 15m prep',
    });
    const debtRes = await call('goal_mixer', {
      prompt:
        'Allocate $1,500 monthly surplus between APR credit card debt payoff and emergency savings cushion',
    });
    const trainRes = await call('goal_mixer', {
      prompt: 'Balance Zone 2 cardio, compound lifts, and recovery readiness',
    });

    const mealPayload = extractPayload(mealRes);
    const debtPayload = extractPayload(debtRes);
    const trainPayload = extractPayload(trainRes);

    expect(app.validate(mealPayload.messages).ok).toBe(true);
    expect(app.validate(debtPayload.messages).ok).toBe(true);
    expect(app.validate(trainPayload.messages).ok).toBe(true);

    const mealTypes = componentTypesOf(mealPayload);
    const debtTypes = componentTypesOf(debtPayload);
    const trainTypes = componentTypesOf(trainPayload);

    // meal_prep has both ParetoPlane2D and PrepTrackGantt + 4 PortionScrubTiles
    expect(mealTypes).toContain('ParetoPlane2D');
    expect(mealTypes).toContain('PrepTrackGantt');
    expect(mealTypes.filter(t => t === 'PortionScrubTile').length).toBe(4);

    // debt_savings omits PrepTrackGantt and uses 3 surplus PortionScrubTiles
    expect(debtTypes).toContain('ParetoPlane2D');
    expect(debtTypes).not.toContain('PrepTrackGantt');
    expect(debtTypes.filter(t => t === 'PortionScrubTile').length).toBe(3);

    // training_week omits ParetoPlane2D and uses PrepTrackGantt + 3 session PortionScrubTiles
    expect(trainTypes).toContain('PrepTrackGantt');
    expect(trainTypes).not.toContain('ParetoPlane2D');
    expect(trainTypes.filter(t => t === 'PortionScrubTile').length).toBe(3);

    // Check UAX #31 snake_case IDs, sendDataModel: true, < 12 KiB, and zero "path" keys
    for (const payload of [mealPayload, debtPayload, trainPayload]) {
      const createMsg = payload.messages[0]!['createSurface'] as {
        surfaceId: string;
        sendDataModel?: boolean;
      };
      expect(createMsg.sendDataModel).toBe(true);
      for (const id of componentIdsOf(payload)) {
        expect(isValidUax31Identifier(id)).toBe(true);
        expect(id.includes('-')).toBe(false);
      }
      const dm = initialDataModelOf(payload);
      expect(Buffer.byteLength(JSON.stringify(dm))).toBeLessThan(12 * 1024);
      const keys = collectObjectKeys(dm);
      expect(keys.has('path')).toBe(false);
      expect(keys.has('@path')).toBe(false);
    }
  });

  it('handles lock_mix, snap_to_targets, and build_shopping_or_action_list follow-ups', async () => {
    const {call} = await connectTestServer();
    const opened = await call('goal_mixer', {
      prompt: 'High-protein meal prep',
      scenario: 'meal_prep',
    });
    const payload = extractPayload(opened);
    const surfaceId = (payload.messages[0]!['createSurface'] as {surfaceId: string}).surfaceId;
    const dm = initialDataModelOf(payload);
    const items = (dm['items'] as Array<Record<string, unknown>>).map(item => ({
      ...item,
      scale: 2.0,
    }));

    const snapped = await call('a2ui_action', {
      name: 'snap_to_targets',
      surfaceId,
      context: {scenario: 'meal_prep', items},
    });
    expect(snapped.isError).toBeFalsy();
    const snappedMessages = extractPayload(snapped).messages;
    const itemsUpdate = snappedMessages.find(
      m => (m['updateDataModel'] as {path?: string} | undefined)?.path === '/items',
    );
    expect(itemsUpdate).toBeDefined();

    const locked = await call('a2ui_action', {
      name: 'lock_mix',
      surfaceId,
      context: {
        scenario: 'meal_prep',
        items: dm['items'],
        selectedPresetId: 'preset_balanced',
      },
    });
    expect(locked.isError).toBeFalsy();
    const lockedUpdate = extractPayload(locked).messages.find(
      m => (m['updateDataModel'] as {path?: string} | undefined)?.path === '/locked',
    ) as {updateDataModel: {value: boolean}};
    expect(lockedUpdate.updateDataModel.value).toBe(true);

    const followUp = await call('a2ui_action', {
      name: 'build_shopping_or_action_list',
      surfaceId,
      context: {
        deliverable: 'grocery shopping & 45-min Sunday batch checklist',
        scenarioTitle: 'Weekday High-Protein Meal & Batch Mixer',
        preset: 'preset_balanced',
      },
    });
    expect(followUp.isError).toBeFalsy();
    expect(extractPayload(followUp).followUp?.text).toContain(
      'Build my "grocery shopping & 45-min Sunday batch checklist" for the "Weekday High-Protein Meal & Batch Mixer" mix',
    );
  });
});
