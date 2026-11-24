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
import {createA2uiApp} from '@a2ui/embed/mcp/server';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {describe, expect, it} from 'vitest';

import {evaluatePlan, inspectItem, scoreSummaryText, selectedLabel} from './catalog/functions.js';
import {CANVAS_CATALOG_ID, canvasCatalog} from './catalog/index.js';
import {applyTrayPieceToggle} from './catalog/piece_tray.js';
import {composeSpacePlanner, MAX_DATA_MODEL_BYTES} from './compose.js';
import {loadEnvFile} from './config.js';
import {buildScenarioBundle} from './domain/scenarios.js';
import {SCENARIO_IDS, type FloorplanPlacement} from './domain/types.js';
import {createServer, SERVER_INSTRUCTIONS} from './server.js';

interface EmbedPayload {
  contractVersion: string;
  messages: Array<Record<string, unknown>>;
  followUp?: {text: string};
}

const TOOL_PREFIX = 'mcp_a2ui-canvas_canvas_';
const A2UI_IN_TEXT = /createSurface|updateComponents|updateDataModel|"@path"|"component"\s*:/;
const BASIC_CATALOG_COMPONENTS = new Set([
  'Text',
  'Button',
  'Row',
  'Column',
  'Card',
  'Image',
  'TextField',
  'CheckBox',
  'Slider',
  'ChoicePicker',
  'Tabs',
  'Modal',
  'Divider',
  'List',
  'Icon',
]);

function catalogSchemaFile(): CatalogSchemaFile {
  return {
    contractVersion: CONTRACT_VERSION,
    catalogs: {[CANVAS_CATALOG_ID]: canvasCatalog.validationSchema},
  } as CatalogSchemaFile;
}

function writeTestAppFiles(): string {
  const dir = mkdtempSync(join(tmpdir(), 'a2ui-canvas-test-'));
  const html = join(dir, 'a2ui-app.html');
  writeFileSync(html, '<!doctype html><title>canvas test</title>');
  writeFileSync(join(dir, 'a2ui-app.catalog.json'), JSON.stringify(catalogSchemaFile()));
  return html;
}

function textOf(result: CallToolResult): string {
  return result.content.map(block => (block.type === 'text' ? block.text : '')).join('\n');
}

function payloadOf(result: CallToolResult): EmbedPayload | undefined {
  return (result.structuredContent as {a2ui?: EmbedPayload} | undefined)?.a2ui;
}

function collectObjectKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      collectObjectKeys(v, out);
    }
  }
  return out;
}

async function connect() {
  const client = new Client({name: 'canvas-test', version: '1.0.0'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const {server} = createServer({CANVAS_APP_HTML: writeTestAppFiles()});
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const result = (await client.callTool({name, arguments: args})) as CallToolResult;
    expect(A2UI_IN_TEXT.test(textOf(result))).toBe(false);
    return result;
  }

  return {client, call};
}

describe('canvasCatalog functions & piece tray helpers', () => {
  it('evaluates floorplan & seating rules and inspects selected items', () => {
    const dummyCtx = {} as never;
    const bedroom = buildScenarioBundle('bedroom_office');
    const initialEval = evaluatePlan.execute(
      {
        scene: bedroom.scene,
        placements: bedroom.initialPlacements,
        rules: bedroom.rules,
      },
      dummyCtx,
    ) as {status: string; score: number; violatingIds: string[]};
    expect(initialEval.status).toBe('fail');
    expect(initialEval.violatingIds).toContain('desk_active');

    const presetEval = evaluatePlan.execute(
      {
        scene: bedroom.scene,
        placements: bedroom.presets[0]!.placements,
        rules: bedroom.rules,
      },
      dummyCtx,
    ) as {status: string; score: number};
    expect(presetEval.status).toBe('pass');
    expect(presetEval.score).toBe(100);

    const inspected = inspectItem.execute(
      {
        scene: bedroom.scene,
        placements: bedroom.initialPlacements,
        selectedId: 'desk_active',
      },
      dummyCtx,
    ) as {found: boolean; title: string};
    expect(inspected.found).toBe(true);
    expect(inspected.title).toContain('Standing Desk');

    const label = selectedLabel.execute(
      {
        scene: bedroom.scene,
        placements: bedroom.initialPlacements,
        selectedId: 'desk_active',
      },
      dummyCtx,
    );
    expect(label).toContain('60 in Standing Desk');

    const summary = scoreSummaryText.execute(
      {
        scene: bedroom.scene,
        placements: bedroom.presets[0]!.placements,
        rules: bedroom.rules,
      },
      dummyCtx,
    );
    expect(summary).toContain('5/5');

    // Toggle optional crib in and out via PieceTray helper
    const cribPiece = bedroom.pieces.find(p => p.pieceId === 'crib_52')!;
    const toggledIn = applyTrayPieceToggle(
      cribPiece,
      bedroom.presets[0]!.placements as FloorplanPlacement[],
      168,
      120,
      2,
    );
    expect(toggledIn.next.some(p => p.pieceId === 'crib_52')).toBe(true);
    const toggledOut = applyTrayPieceToggle(cribPiece, toggledIn.next, 168, 120, 2);
    expect(toggledOut.next.some(p => p.pieceId === 'crib_52')).toBe(false);
  });
});

describe('multi-scenario composer & app.validate', () => {
  it('composes genuinely distinct custom trees (< 12 KiB, UAX #31 IDs, no "path" keys) and passes app.validate', () => {
    const validator = createA2uiApp(new McpServer({name: 'validator', version: '0.0.0'}), {
      html: {text: '<!doctype html>'},
      catalogSchema: catalogSchemaFile(),
    });

    const signatures = new Set<string>();
    for (const scenarioId of SCENARIO_IDS) {
      const composed = composeSpacePlanner(`Plan ${scenarioId}`, scenarioId);
      expect(composed.dataModelBytes).toBeLessThan(MAX_DATA_MODEL_BYTES);

      const check = validator.validate(composed.a2ui);
      expect(check.errors).toEqual([]);
      expect(check.ok).toBe(true);

      const updateComponents = composed.a2ui.find(m => 'updateComponents' in m);
      expect(updateComponents).toBeDefined();
      const components =
        updateComponents && 'updateComponents' in updateComponents
          ? updateComponents.updateComponents.components
          : [];

      for (const comp of components) {
        expect(comp.id).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(BASIC_CATALOG_COMPONENTS.has(comp.component)).toBe(false);
      }
      signatures.add(components.map(c => c.component).join('>'));

      const updateDataMsg = composed.a2ui.find(m => 'updateDataModel' in m);
      const dataValue =
        updateDataMsg && 'updateDataModel' in updateDataMsg
          ? updateDataMsg.updateDataModel.value
          : {};
      const keys = collectObjectKeys(dataValue);
      expect(keys).not.toContain('path');
      expect(keys.some(k => k.startsWith('@'))).toBe(false);
    }

    // Each scenario must produce a distinct composed component tree
    expect(signatures.size).toBe(SCENARIO_IDS.length);

    // Rejects unknown basicCatalog component
    const invalid = composeSpacePlanner('Bedroom desk', 'bedroom_office');
    const badMessages = structuredClone(invalid.a2ui);
    const compMsg = badMessages.find(m => 'updateComponents' in m);
    if (compMsg && 'updateComponents' in compMsg) {
      (compMsg.updateComponents.components as Array<{id: string; component: string}>).push({
        id: 'illegal_text',
        component: 'Text',
      });
    }
    expect(validator.validate(badMessages).ok).toBe(false);
  });
});

describe('a2ui-embed-canvas MCP server', () => {
  it('loads CANVAS_ENV_FILE without overwriting existing env vars', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canvas-env-'));
    const envFile = join(dir, '.env');
    writeFileSync(envFile, 'CANVAS_CUSTOM="hello"\nEXISTING_KEY=override\n');
    const env: NodeJS.ProcessEnv = {CANVAS_ENV_FILE: envFile, EXISTING_KEY: 'keep'};
    loadEnvFile(env);
    expect(env['CANVAS_CUSTOM']).toBe('hello');
    expect(env['EXISTING_KEY']).toBe('keep');
  });

  it('registers space_planner and app-only a2ui_action within 64-char host tool limit', async () => {
    const {client} = await connect();
    const {tools} = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(['a2ui_action', 'space_planner']);
    for (const tool of tools) {
      const fullName = `${TOOL_PREFIX}${tool.name}`;
      expect(fullName.length).toBeLessThanOrEqual(64);
      expect(fullName).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
  });

  it('handles space_planner, save_layout, auto_resolve_conflicts, and ask_ergonomics_or_hosts', async () => {
    const {call} = await connect();

    const seatingResult = await call('space_planner', {
      prompt: 'Seat 16 dinner guests across 2 round tables keeping Maya away from Dan',
    });
    expect(seatingResult.isError).toBeFalsy();
    expect(textOf(seatingResult)).toContain('16-Guest Harvest Dinner Seating');

    const surfaceId = (
      payloadOf(seatingResult)!.messages.find(m => 'createSurface' in m)!['createSurface'] as {
        surfaceId: string;
      }
    ).surfaceId;

    const dinnerBundle = buildScenarioBundle('dinner_seating');
    const resolveResult = await call('a2ui_action', {
      name: 'auto_resolve_conflicts',
      surfaceId,
      context: {
        scenarioId: 'dinner_seating',
        placements: dinnerBundle.initialPlacements,
      },
    });
    expect(resolveResult.isError).toBeFalsy();
    expect(textOf(resolveResult)).toContain('100%');

    const saveResult = await call('a2ui_action', {
      name: 'save_layout',
      surfaceId,
      context: {
        scenarioId: 'dinner_seating',
        placements: dinnerBundle.presets[0]!.placements,
      },
    });
    expect(saveResult.isError).toBeFalsy();
    expect(textOf(saveResult)).toContain('Saved 16-Guest Harvest Dinner Seating');

    const followUpResult = await call('a2ui_action', {
      name: 'ask_ergonomics_or_hosts',
      surfaceId,
      context: {
        scenarioTitle: 'Bedroom + Standing Desk Fit',
        selectedItem: '60 in Standing Desk',
        scoreSummary: '100% · 5/5 rules clear',
      },
    });
    expect(followUpResult.isError).toBeFalsy();
    expect(payloadOf(followUpResult)?.followUp?.text).toContain('Bedroom + Standing Desk Fit');
    expect(payloadOf(followUpResult)?.followUp?.text).toContain('60 in Standing Desk');
  });
});
