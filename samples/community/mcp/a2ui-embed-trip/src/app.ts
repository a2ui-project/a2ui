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

/** Wires the `trip_studio` tool, actions, follow-ups, and validator into an MCP server. */

import {readFileSync} from 'node:fs';

import type {CatalogSchemaFile} from '@a2ui/embed/contract';
import {createA2uiApp, type A2uiApp, type A2uiToolOutput} from '@a2ui/embed/mcp/server';
import type {AgentToRendererMessage} from '@a2ui/web_core/v1_0';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

import {TRIP_CATALOG_ID} from './catalog/catalog_id.js';
import {computeTripStats} from './catalog/model.js';
import {type A2uiMessage, updateData} from './compose/a2ui.js';
import {ACTIONS, FOLLOW_UPS} from './compose/events.js';
import {composeTripStudio} from './compose/studio.js';
import {appHtmlPath, catalogSchemaPath} from './config.js';
import {applyRainBackups} from './scenarios/catalog_data.js';
import {TRIP_STUDIO_TOOL} from './tools.js';

export const SERVER_INSTRUCTIONS = [
  'Day & Trip Studio over synthetic neighborhood itineraries, hourly weather windows, and hotel options.',
  'Always call trip_studio whenever the user asks about Trip Studio, Day & Trip Studio, squeezing activities between hotel check-in and dinner, watching rain and walking time on an itinerary, or planning a weekend trip under a budget comparing neighborhood hotels.',
  'Do not call external calendar, email, or workspace file tools for Trip Studio requests; trip_studio renders an interactive card with client-side time shifting, stop/hotel swap decks, route minimap, and live budget/walk calculations.',
  "Make trip_studio the final tool call of your turn: never call read_file, run_command, or any other tool in parallel after trip_studio or after trip_studio returns, because the interactive A2UI studio is already rendered inline for the user and any subsequent tool call collapses the app into the 'Worked for' block. Answer directly from this tool's text summary.",
].join('\n');

function toAgentMessages(messages: readonly A2uiMessage[]): AgentToRendererMessage[] {
  return messages as unknown as AgentToRendererMessage[];
}

export function createServer(env: NodeJS.ProcessEnv = process.env): {
  server: McpServer;
  app: A2uiApp;
} {
  const server = new McpServer(
    {name: 'a2ui-embed-trip', version: '0.1.0'},
    {instructions: SERVER_INSTRUCTIONS},
  );
  const catalogSchemaFile = JSON.parse(
    readFileSync(catalogSchemaPath(env), 'utf8'),
  ) as CatalogSchemaFile;
  if (!catalogSchemaFile.catalogs[TRIP_CATALOG_ID]) {
    throw new Error(`${catalogSchemaPath(env)} has no schema for ${TRIP_CATALOG_ID}.`);
  }

  const app = createA2uiApp(server, {
    html: appHtmlPath(env),
    catalogSchema: catalogSchemaFile,
    resourceName: 'Day & Trip Studio',
  });

  app.tool(TRIP_STUDIO_TOOL.name, TRIP_STUDIO_TOOL.config, ({prompt, scenario}): A2uiToolOutput => {
    const composed = composeTripStudio(prompt, scenario);
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
  });

  app.action('lock_itinerary', {argsSchema: ACTIONS.lock_itinerary}, (args, {surfaceId}) => {
    const stats = computeTripStats(args.stops, args.hotel, args.budgetCap ?? 0);
    const note = `Locked ${args.stops.length} stops · $${stats.totalCost} total · ${stats.totalWalkMin}m walk.`;
    const updates = [
      updateData(surfaceId, '/statusBadge', 'Locked ✓'),
      updateData(surfaceId, '/statusNote', note),
    ];
    return {
      text: note,
      a2ui: toAgentMessages(updates),
    };
  });

  app.action('rain_reschedule', {argsSchema: ACTIONS.rain_reschedule}, (args, {surfaceId}) => {
    const updatedStops = applyRainBackups(args.scenario, args.stops);
    const stats = computeTripStats(updatedStops, undefined, 0);
    const note = `Swapped exposed stops to indoor rain backups (${stats.totalWalkMin}m walk).`;
    const updates = [
      updateData(surfaceId, '/stops', updatedStops),
      updateData(surfaceId, '/statusBadge', 'Rain-safe ☂'),
      updateData(surfaceId, '/statusNote', note),
    ];
    return {
      text: note,
      a2ui: toAgentMessages(updates),
    };
  });

  app.followUp('ask_local_spots', {
    template: FOLLOW_UPS.ask_local_spots.template,
    argsSchema: FOLLOW_UPS.ask_local_spots.argsSchema,
    maxValueLength: 80,
  });

  return {server, app};
}
