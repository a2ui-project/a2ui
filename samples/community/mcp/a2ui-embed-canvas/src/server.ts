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
 * Space & Seating Planner MCP server wired with `createA2uiApp` from
 * `@a2ui/embed/mcp/server`.
 */

import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';

import type {CatalogSchemaFile} from '@a2ui/embed/contract';
import {createA2uiApp, type A2uiApp, type A2uiToolOutput} from '@a2ui/embed/mcp/server';
import type {AgentToRendererMessage} from '@a2ui/web_core/v1_0';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';

import {CANVAS_CATALOG_ID} from './catalog/catalog_id.js';
import {composeSpacePlanner, updateData, type A2uiMessage} from './compose.js';
import {appHtmlPath, catalogSchemaPath, loadEnvFile} from './config.js';
import {evaluatePlanData} from './domain/geometry.js';
import {autoResolvePlacements, buildScenarioBundle} from './domain/scenarios.js';
import {SCENARIO_IDS, type PlacementItem} from './domain/types.js';

export const SERVER_INSTRUCTIONS = [
  'Interactive 2D Space & Seating Planner over scaled room floorplans, patio clearances, and banquet table seating charts.',
  'Always call space_planner whenever the user asks about fitting furniture into a room or office, checking door-swing or walkway clearances, arranging a patio or garden around a fire pit or shade, or planning dinner/event seating across tables with guest constraints.',
  'CRITICAL: Make space_planner the final tool call of your turn: never call read_file, run_command, update_focus, or any other tool in parallel after space_planner or after space_planner returns, because the interactive A2UI studio is already rendered inline for the user and any subsequent tool call collapses the app into the "Worked for" block. Answer directly from this tool\'s text summary.',
  'Do not call external calendar, mail, or workspace search tools for spatial layout or seating requests; space_planner is completely self-contained and returns all dimensions, guest assignments, presets, and recommendations in its text summary.',
].join('\n');

const PlacementRecordSchema = z.record(z.string(), z.unknown());

export const SPACE_PLANNER_INPUT = {
  prompt: z
    .string()
    .default(
      'Can a queen bed and 60-inch standing desk fit in my bedroom without blocking the door swing?',
    )
    .describe(
      'Natural-language spatial layout or banquet seating request describing the room, furniture, patio, or guest constraints.',
    ),
  scenario: z
    .enum(SCENARIO_IDS)
    .optional()
    .describe(
      'Optional explicit scenario: bedroom_office (scaled bedroom + standing desk floorplan with slotted piece tray), dinner_seating (16-guest two-table banquet seating chart), or patio_garden (courtyard terrace with fire-pit safety halo). Omit to infer from prompt.',
    ),
};

export const ACTION_SCHEMAS = {
  save_layout: {
    scenarioId: z.enum(SCENARIO_IDS),
    placements: z.array(PlacementRecordSchema).min(1).max(32),
  },
  auto_resolve_conflicts: {
    scenarioId: z.enum(SCENARIO_IDS),
    placements: z.array(PlacementRecordSchema).min(1).max(32),
  },
} as const;

export const FOLLOW_UP_CONFIG = {
  template:
    'Give practical ergonomics, lighting, or hosting tips for {scenarioTitle} focusing on {selectedItem} (current plan: {scoreSummary}).',
  argsSchema: {
    scenarioTitle: z.string().max(120),
    selectedItem: z.string().max(160),
    scoreSummary: z.string().max(160),
  },
  maxValueLength: 160,
} as const;

function toAgentMessages(messages: readonly A2uiMessage[]): AgentToRendererMessage[] {
  return messages as unknown as AgentToRendererMessage[];
}

export function createServer(env: NodeJS.ProcessEnv = process.env): {
  server: McpServer;
  app: A2uiApp;
} {
  const server = new McpServer(
    {name: 'a2ui-embed-canvas', version: '0.1.0'},
    {instructions: SERVER_INSTRUCTIONS},
  );
  const schemaPath = catalogSchemaPath(env);
  const catalogSchemaFile = JSON.parse(readFileSync(schemaPath, 'utf8')) as CatalogSchemaFile;
  if (!catalogSchemaFile.catalogs[CANVAS_CATALOG_ID]) {
    throw new Error(`${schemaPath} has no schema for ${CANVAS_CATALOG_ID}.`);
  }

  const app = createA2uiApp(server, {
    html: appHtmlPath(env),
    catalogSchema: catalogSchemaFile,
    resourceName: 'Space & Seating Planner',
  });

  app.tool(
    'space_planner',
    {
      title: 'Space & Seating Planner',
      description:
        'Interactive 2D SVG floorplan and banquet seating planner built with a custom A2UI v1.0 catalog. Supports dragging and rotating scaled furniture against door-swing and daylight zones, toggling candidate pieces, or swapping dinner guests across tables with live constraint scoring. Make space_planner the final tool call of your turn: never call read_file, run_command, or any other tool after space_planner returns, because any subsequent tool call collapses the inline A2UI app into the "Worked for" block. Answer directly from this tool\'s text summary.',
      inputSchema: SPACE_PLANNER_INPUT,
      annotations: {readOnlyHint: true, openWorldHint: false},
    },
    ({prompt, scenario}): A2uiToolOutput => {
      const composed = composeSpacePlanner(prompt, scenario);
      const check = app.validate(composed.a2ui);
      if (!check.ok) {
        throw new Error(
          `Invalid A2UI composition: ${check.errors.map(err => err.message).join('; ')}`,
        );
      }
      return {
        text: composed.text,
        a2ui: toAgentMessages(composed.a2ui),
      };
    },
  );

  app.action('save_layout', {argsSchema: ACTION_SCHEMAS.save_layout}, (args, {surfaceId}) => {
    const bundle = buildScenarioBundle(args.scenarioId);
    const placements = args.placements as unknown as PlacementItem[];
    const evaluation = evaluatePlanData(bundle.scene, placements, bundle.rules);
    const note = `Saved ✓ · ${evaluation.score}% (${evaluation.passCount}/${evaluation.totalCount} clear)`;
    const updates = [updateData(surfaceId, '/savedNote', note)];
    return {
      text: `Saved ${bundle.scene.title}: ${evaluation.summary} (${placements.length} items).`,
      a2ui: toAgentMessages(updates),
    };
  });

  app.action(
    'auto_resolve_conflicts',
    {argsSchema: ACTION_SCHEMAS.auto_resolve_conflicts},
    (args, {surfaceId}) => {
      const bundle = buildScenarioBundle(args.scenarioId);
      const current = args.placements as unknown as PlacementItem[];
      const resolved = autoResolvePlacements(bundle, current);
      const evaluation = evaluatePlanData(bundle.scene, resolved, bundle.rules);
      const note = `Resolved ✓ · ${evaluation.score}% (${evaluation.passCount}/${evaluation.totalCount} clear)`;
      const updates = [
        updateData(surfaceId, '/placements', resolved),
        updateData(surfaceId, '/activePresetId', ''),
        updateData(surfaceId, '/savedNote', note),
      ];
      return {
        text: `Auto-resolved ${bundle.scene.title}: ${evaluation.summary}.`,
        a2ui: toAgentMessages(updates),
      };
    },
  );

  app.followUp('ask_ergonomics_or_hosts', FOLLOW_UP_CONFIG);

  return {server, app};
}

const entryArg = process.argv[1];
if (entryArg && resolve(entryArg) === resolve(fileURLToPath(import.meta.url))) {
  loadEnvFile();
  await createServer().server.connect(new StdioServerTransport());
}
