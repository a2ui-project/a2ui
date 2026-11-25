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
 * Multi-Goal Meal, Habit & Trade-Off Mixer MCP server powered by `@a2ui/embed`.
 *
 * Registers the `goal_mixer` tool (with live Gemini synthesis + 8 curated domain
 * fallbacks and 4 distinct custom component layouts), in-place `lock_mix` and
 * `snap_to_targets` actions, and the `build_shopping_or_action_list` follow-up.
 */

import {readFileSync, realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

import type {CatalogSchemaFile} from '@a2ui/embed/contract';
import {createA2uiApp, type A2uiApp} from '@a2ui/embed/mcp/server';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';

import {geminiModelFromEnv, type JsonModel} from './ai/json_model.js';
import {MIXER_CATALOG_ID} from './catalog/catalog_id.js';
import {MIXER_ACTIONS, MIXER_FOLLOW_UPS} from './compose/events.js';
import {appHtmlPath, catalogSchemaPath, loadEnvFile} from './config.js';
import {MixerService} from './mixer_service.js';
import {GOAL_MIXER_TOOL} from './tools.js';

export const TAIL_HOIST_RULE =
  "Make `goal_mixer` the final tool call of your turn: never call `read_file`, `run_command`, or any other tool in parallel after `goal_mixer` or after `goal_mixer` returns, because the interactive A2UI studio is already rendered inline for the user and any subsequent tool call collapses the app into the 'Worked for' block. Answer directly from this tool's text summary.";

export const SERVER_INSTRUCTIONS = [
  'Multi-Goal Trade-Off Mixer studio (`goal_mixer`) built on @a2ui/embed with a 100% custom catalog.',
  "Call `goal_mixer` whenever the user asks to open or use Goal Mixer, or wants to balance competing multi-variable targets across everyday life, finance, home/hardware, health, or work (for example wedding budget/guests/bar, home solar/battery/heat-pump sizing, half-marathon/strength/recovery, apartment commute/rent/space, startup runway/hiring/growth, family weeknight routine, weekday meal prep, or debt payoff vs emergency savings). Always leave `scenario` omitted (or pass `'auto'` / `'custom'`) so Goal Mixer synthesizes a bespoke Gemini model tailored to the prompt's exact numbers and constraints.",
  TAIL_HOIST_RULE,
  'Goal Mixer composes 4 distinct custom component layouts (`rings_pareto_gantt`, `rings_pareto`, `rings_gantt`, `pareto_hero`) from the same catalog depending on the problem structure.',
  'Surfaces set `sendDataModel: true`: when the user scrubs 0.5x–2.0x scales, clicks swap pills, or selects a Pareto frontier preset dot, the updated `/items` and `/selectedPresetId` are attached to the next chat turn.',
].join('\n');

export function createServer(
  env: NodeJS.ProcessEnv = process.env,
  overrides: {model?: JsonModel | null; timeoutMs?: number} = {},
): {
  server: McpServer;
  app: A2uiApp;
  service: MixerService;
} {
  loadEnvFile(env);
  const server = new McpServer(
    {name: 'a2ui-embed-mixer', version: '0.1.0'},
    {instructions: SERVER_INSTRUCTIONS},
  );
  const schemaPath = catalogSchemaPath(env);
  const catalogSchema = JSON.parse(readFileSync(schemaPath, 'utf8')) as CatalogSchemaFile;
  if (!catalogSchema.catalogs[MIXER_CATALOG_ID]) {
    throw new Error(`${schemaPath} does not contain schema for ${MIXER_CATALOG_ID}.`);
  }

  const app = createA2uiApp(server, {
    html: appHtmlPath(env),
    catalogSchema,
    resourceName: 'Multi-Goal Trade-Off Mixer',
  });
  const model = overrides.model === null ? undefined : (overrides.model ?? geminiModelFromEnv(env));
  const service = new MixerService(
    model,
    messages => app.validate(messages).ok,
    overrides.timeoutMs,
  );

  app.tool(GOAL_MIXER_TOOL.name, GOAL_MIXER_TOOL.config, async ({prompt, scenario}) => {
    const out = await service.openMixer(prompt, scenario);
    const check = app.validate(out.a2ui);
    if (!check.ok) {
      throw new Error(check.errors.map(err => err.message).join('; '));
    }
    return out;
  });

  app.action('lock_mix', {argsSchema: MIXER_ACTIONS.lock_mix}, (args, {surfaceId}) =>
    service.lockMix(args, surfaceId),
  );

  app.action('snap_to_targets', {argsSchema: MIXER_ACTIONS.snap_to_targets}, (args, {surfaceId}) =>
    service.snapToTargets(args, surfaceId),
  );

  app.followUp('build_shopping_or_action_list', {
    template: MIXER_FOLLOW_UPS.build_shopping_or_action_list.template,
    argsSchema: MIXER_FOLLOW_UPS.build_shopping_or_action_list.argsSchema,
    maxValueLength: 120,
  });

  return {server, app, service};
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return fileURLToPath(import.meta.url) === entry;
  }
}

if (isMainModule()) {
  loadEnvFile();
  await createServer().server.connect(new StdioServerTransport());
}
