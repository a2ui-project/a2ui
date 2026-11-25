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

import type {JsonModel} from './ai/json_model.js';
import {parseModelJson} from './ai/lenient_json.js';
import {MIXER_CATALOG_ID, mixerCatalog} from './catalog/index.js';
import {loadEnvFile} from './config.js';
import {CURATED_SCENARIO_IDS} from './scenarios/presets.js';
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

async function connectTestServer(model: JsonModel | null = null) {
  const client = new Client({name: 'mixer-test-client', version: '1.0.0'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const {server, app} = createServer({MIXER_APP_HTML: writeTempAppBundle()}, {model});
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

function rootChildrenOf(payload: EmbedPayload): string[] {
  const comps = payload.messages.flatMap(msg => {
    const update = msg['updateComponents'] as
      | {components?: Array<{id: string; children?: string[]}>}
      | undefined;
    return update?.components ?? [];
  });
  return comps.find(c => c.id === 'root')?.children ?? [];
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
    expect(SERVER_INSTRUCTIONS).toContain('Make `goal_mixer` the final tool call of your turn');
    expect(tools.find(t => t.name === 'goal_mixer')?.description).toContain(
      'Make `goal_mixer` the final tool call of your turn',
    );
  });

  it('supports MIXER_ENV_FILE and bracket-balanced parseModelJson', () => {
    const dir = mkdtempSync(join(tmpdir(), 'a2ui-mixer-env-'));
    const envFile = join(dir, 'custom.env');
    writeFileSync(envFile, 'MIXER_SAMPLE_VAR="from_file"\nEXISTING_VAR=ignored\n');
    const env: NodeJS.ProcessEnv = {MIXER_ENV_FILE: envFile, EXISTING_VAR: 'kept'};
    loadEnvFile(env);
    expect(env['MIXER_SAMPLE_VAR']).toBe('from_file');
    expect(env['EXISTING_VAR']).toBe('kept');

    const repaired = parseModelJson('```json\n{"a": [1, 2,], "b": {"x": 3}\n```') as Record<
      string,
      unknown
    >;
    expect(repaired['a']).toEqual([1, 2]);
  });

  it('composes all 4 distinct layout modes across all 8 curated domains without a model', async () => {
    const {call, app} = await connectTestServer(null);

    const layoutsSeen = new Set<string>();
    for (const scenario of CURATED_SCENARIO_IDS) {
      const res = await call('goal_mixer', {
        prompt: `Optimize ${scenario} trade-offs`,
        scenario,
      });
      expect(res.isError).toBeFalsy();
      const payload = extractPayload(res);
      expect(app.validate(payload.messages).ok).toBe(true);

      const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('\n');
      expect(text).toContain('Make `goal_mixer` the final tool call of your turn');

      const rootKids = rootChildrenOf(payload).join(',');
      layoutsSeen.add(rootKids);

      const dm = initialDataModelOf(payload);
      expect(Buffer.byteLength(JSON.stringify(dm))).toBeLessThan(12 * 1024);
      const keys = collectObjectKeys(dm);
      expect(keys.has('path')).toBe(false);
      expect(keys.has('@path')).toBe(false);
      for (const id of componentIdsOf(payload)) {
        expect(isValidUax31Identifier(id)).toBe(true);
        expect(id.includes('-')).toBe(false);
      }
    }

    // Confirm all 4 distinct root architectures were exercised!
    expect(layoutsSeen.size).toBe(4);
    expect(layoutsSeen).toContain('rings_main,stage_grid,tiles_grid');
    expect(layoutsSeen).toContain('top_stage_grid,tiles_grid');
    expect(layoutsSeen).toContain('rings_main,prep_gantt,tiles_grid');
    expect(layoutsSeen).toContain('pareto_frontier,rings_main,tiles_grid');
  });

  it('synthesizes bespoke custom blueprints via Gemini and supports lock_mix & snap_to_targets on custom surfaces', async () => {
    const fakeGemini: JsonModel = {
      async generateJson() {
        return {
          layoutMode: 'pareto_hero',
          badge: 'Cloud GPU cluster',
          title: 'Inference Latency, Cost & Throughput Mixer',
          subtitle:
            '★ Recommended: FP8 quantized L40S pool + prefix caching hits 210ms p95 at $14k/mo.',
          deliverableLabel: 'cluster autoscaling & quantization rollout spec',
          followUpButtonLabel: 'Deploy spec ↗',
          microNoteText: 'Prefix caching cuts TTFT 38% on multi-turn agent prompts.',
          targets: [
            {
              key: 'p95_ms',
              label: 'p95 latency',
              unit: 'ms',
              baseline: 90,
              min: 0,
              max: 260,
              direction: 'atMost',
            },
            {
              key: 'monthly_cost',
              label: 'Cluster cost',
              prefix: '$',
              unit: 'k/mo',
              baseline: 2,
              min: 0,
              max: 18,
              direction: 'atMost',
            },
            {
              key: 'rps_cap',
              label: 'Peak throughput',
              unit: 'rps',
              baseline: 20,
              min: 140,
              max: 400,
              direction: 'atLeast',
            },
            {
              key: 'quality',
              label: 'Eval win-rate',
              unit: 'pts',
              baseline: 55,
              min: 88,
              max: 100,
              direction: 'atLeast',
            },
          ],
          items: [
            {
              id: 'gpu_pool',
              title: 'Accelerator tier',
              subtitle: 'Base serving replicas',
              icon: 'rocket',
              recommendedId: 'fp8_l40s',
              options: [
                {
                  id: 'fp8_l40s',
                  label: '4x L40S FP8',
                  note: 'Sweet-spot $/tok',
                  effects: [
                    {key: 'p95_ms', delta: 85},
                    {key: 'monthly_cost', delta: 8},
                    {key: 'rps_cap', delta: 95},
                    {key: 'quality', delta: 19},
                  ],
                },
                {
                  id: 'bf16_h100',
                  label: '4x H100 BF16',
                  note: 'Fastest p95, premium cost',
                  effects: [
                    {key: 'p95_ms', delta: 45},
                    {key: 'monthly_cost', delta: 17},
                    {key: 'rps_cap', delta: 160},
                    {key: 'quality', delta: 21},
                  ],
                },
                {
                  id: 'int4_a10g',
                  label: '4x A10G INT4',
                  note: 'Lowest cost, higher tail',
                  effects: [
                    {key: 'p95_ms', delta: 145},
                    {key: 'monthly_cost', delta: 4},
                    {key: 'rps_cap', delta: 65},
                    {key: 'quality', delta: 13},
                  ],
                },
              ],
            },
            {
              id: 'kv_cache',
              title: 'KV & prefix cache',
              subtitle: 'Memory & hit-rate tier',
              icon: 'vault',
              recommendedId: 'prefix_nvme',
              options: [
                {
                  id: 'prefix_nvme',
                  label: 'RAM + NVMe tier',
                  note: '76% prefix hit rate',
                  effects: [
                    {key: 'p95_ms', delta: 20},
                    {key: 'monthly_cost', delta: 3},
                    {key: 'rps_cap', delta: 35},
                    {key: 'quality', delta: 8},
                  ],
                },
                {
                  id: 'hbm_only',
                  label: 'Pure HBM',
                  note: 'Lowest jitter',
                  effects: [
                    {key: 'p95_ms', delta: 10},
                    {key: 'monthly_cost', delta: 5},
                    {key: 'rps_cap', delta: 45},
                    {key: 'quality', delta: 8},
                  ],
                },
                {
                  id: 'stateless',
                  label: 'No shared cache',
                  note: 'Recomputes prompt',
                  effects: [
                    {key: 'p95_ms', delta: 65},
                    {key: 'monthly_cost', delta: 1},
                    {key: 'rps_cap', delta: 10},
                    {key: 'quality', delta: 8},
                  ],
                },
              ],
            },
            {
              id: 'spec_decode',
              title: 'Speculative draft',
              subtitle: 'Draft-verifier speedup',
              icon: 'clock',
              recommendedId: 'eagle_draft',
              options: [
                {
                  id: 'eagle_draft',
                  label: '2B Draft head',
                  note: '1.7x decode tokens/s',
                  effects: [
                    {key: 'p95_ms', delta: 15},
                    {key: 'monthly_cost', delta: 1},
                    {key: 'rps_cap', delta: 25},
                    {key: 'quality', delta: 8},
                  ],
                },
                {
                  id: 'medusa_heads',
                  label: 'Multi-head',
                  note: 'Zero extra model',
                  effects: [
                    {key: 'p95_ms', delta: 25},
                    {key: 'monthly_cost', delta: 1},
                    {key: 'rps_cap', delta: 20},
                    {key: 'quality', delta: 7},
                  ],
                },
                {
                  id: 'vanilla_decode',
                  label: 'Standard decode',
                  note: 'Simplest ops',
                  effects: [
                    {key: 'p95_ms', delta: 45},
                    {key: 'monthly_cost', delta: 0},
                    {key: 'rps_cap', delta: 5},
                    {key: 'quality', delta: 8},
                  ],
                },
              ],
            },
          ],
          pareto: {
            title: 'p95 Latency (ms) vs Monthly Cluster Cost ($k/mo)',
            xKey: 'p95_ms',
            yKey: 'monthly_cost',
            xLabel: 'p95 Latency (ms)',
            yLabel: 'Cost $k/mo',
            presets: [
              {
                id: 'fast_h100',
                label: '160ms H100',
                mix: [
                  {itemId: 'gpu_pool', scale: 1.0, activeOptionId: 'bf16_h100'},
                  {itemId: 'kv_cache', scale: 1.0, activeOptionId: 'hbm_only'},
                  {itemId: 'spec_decode', scale: 1.0, activeOptionId: 'eagle_draft'},
                ],
              },
              {
                id: 'rec_l40s',
                label: '★ 210ms L40S',
                recommended: true,
                mix: [
                  {itemId: 'gpu_pool', scale: 1.0, activeOptionId: 'fp8_l40s'},
                  {itemId: 'kv_cache', scale: 1.0, activeOptionId: 'prefix_nvme'},
                  {itemId: 'spec_decode', scale: 1.0, activeOptionId: 'eagle_draft'},
                ],
              },
              {
                id: 'budget_a10g',
                label: '$7k Lean A10G',
                mix: [
                  {itemId: 'gpu_pool', scale: 1.0, activeOptionId: 'int4_a10g'},
                  {itemId: 'kv_cache', scale: 1.0, activeOptionId: 'stateless'},
                  {itemId: 'spec_decode', scale: 1.0, activeOptionId: 'vanilla_decode'},
                ],
              },
            ],
          },
        };
      },
    };

    const {call, app} = await connectTestServer(fakeGemini);
    const opened = await call('goal_mixer', {
      prompt: 'Balance LLM serving p95 latency, GPU cluster cost, throughput, and eval quality',
      scenario: 'custom',
    });
    expect(opened.isError).toBeFalsy();
    const text = opened.content.map(b => (b.type === 'text' ? b.text : '')).join('\n');
    expect(text).toContain('Gemini live synthesis');
    expect(text).toContain('Layout: `pareto_hero`');

    const payload = extractPayload(opened);
    expect(app.validate(payload.messages).ok).toBe(true);
    expect(rootChildrenOf(payload)).toEqual(['pareto_frontier', 'rings_main', 'tiles_grid']);
    expect(componentTypesOf(payload)).not.toContain('PrepTrackGantt');

    const surfaceId = (payload.messages[0]!['createSurface'] as {surfaceId: string}).surfaceId;
    const dm = initialDataModelOf(payload);
    expect(dm['scenario']).toBe('custom');

    // Verify snap_to_targets and lock_mix work seamlessly on a 'custom' synthesized surface!
    const blownItems = (dm['items'] as Array<Record<string, unknown>>).map(item => ({
      ...item,
      scale: 2.0,
    }));
    const snapped = await call('a2ui_action', {
      name: 'snap_to_targets',
      surfaceId,
      context: {scenario: 'custom', items: blownItems},
    });
    expect(snapped.isError).toBeFalsy();

    const locked = await call('a2ui_action', {
      name: 'lock_mix',
      surfaceId,
      context: {scenario: 'custom', items: dm['items'], selectedPresetId: 'rec_l40s'},
    });
    expect(locked.isError).toBeFalsy();
    expect(locked.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')).toContain(
      'Inference Latency, Cost & Throughput Mixer',
    );
  });

  it('falls back cleanly to keyword-matched curated blueprint when Gemini fails', async () => {
    const failingModel: JsonModel = {
      async generateJson() {
        throw new Error('Simulated timeout');
      },
    };
    const {call} = await connectTestServer(failingModel);
    const wedding = await call('goal_mixer', {
      prompt: 'Balance a $28k wedding budget, guest count, open-bar package, and contingency',
    });
    expect(wedding.isError).toBeFalsy();
    const text = wedding.content.map(b => (b.type === 'text' ? b.text : '')).join('\n');
    expect(text).toContain('Curated domain blueprint (`wedding_budget`)');
    expect(text).toContain('Wedding Budget, Guest Count & Open-Bar Mixer');
  });
});
