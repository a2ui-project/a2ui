/*
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Catalog} from '@a2ui/web_core/v0_9';
import {z} from 'zod';
import {McpApp} from './mcp-app';
import {PongScoreBoard} from './pong-scoreboard';
import {PongLayout} from './pong-layout';
import {Column} from '@a2ui/angular';

/**
 * The catalog ID for the MCP App catalog.
 * Defined in: samples/community/agent/adk/mcp_app_proxy/catalogs/0.9/mcp_app_catalog.json
 */
export const MCP_APP_CATALOG_ID = 'a2ui.org:a2ui/v0.9/mcp_app_catalog.json';

const McpAppSchema = z.object({
  content: z.union([z.string(), z.object({id: z.string()})]).optional(),
  allowedTools: z.array(z.string()).optional(),
  title: z.string().optional(),
});

const PongScoreBoardSchema = z.object({
  playerScore: z.number().optional(),
  cpuScore: z.number().optional(),
});

const PongLayoutSchema = z.object({
  mcpComponent: z.string().optional(),
  scoreboardComponent: z.string().optional(),
});

export const DEMO_CATALOG = new Catalog(MCP_APP_CATALOG_ID, [
  {name: 'McpApp', component: McpApp, schema: McpAppSchema},
  {name: 'PongScoreBoard', component: PongScoreBoard, schema: PongScoreBoardSchema},
  {name: 'PongLayout', component: PongLayout, schema: PongLayoutSchema},
  // Column should use ColumnApi.schema from @a2ui/web_core, but it is not currently
  // exported by the version of @a2ui/web_core resolved in this community sample.
  // We use z.any() to avoid duplicating the schema definition here.
  {name: 'Column', component: Column, schema: z.any()},
]);
