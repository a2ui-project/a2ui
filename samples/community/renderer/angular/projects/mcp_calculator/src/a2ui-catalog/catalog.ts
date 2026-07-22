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

import {
  Catalog,
  DynamicNumberSchema,
  DynamicStringSchema,
  DynamicValueSchema,
  createFunctionImplementation,
} from '@a2ui/web_core/v0_9';
import {z} from 'zod';
import {McpApp} from './mcp-app';
import {PongScoreBoard} from './pong-scoreboard';
import {PongLayout} from './pong-layout';
import {Column} from '@a2ui/angular';

/**
 * The catalog ID for the MCP App catalog.
 * Defined in: samples/community/agent/adk/mcp_app_proxy/catalogs/0.9/mcp_app_catalog.json
 */
export const MCP_APP_CATALOG_ID =
  'https://a2ui.org/samples/community/agent/adk/mcp_app_proxy/catalogs/0.9/mcp_app_catalog.json';

const McpAppSchema = z.object({
  htmlContent: DynamicStringSchema.optional(),
  allowedTools: z.array(z.string()).optional(),
  allowedFunctions: z.array(z.string()).optional(),
  data: DynamicValueSchema.optional(),
  title: DynamicStringSchema.optional(),
});

const PongScoreBoardSchema = z.object({
  playerScore: DynamicNumberSchema.optional(),
  cpuScore: DynamicNumberSchema.optional(),
  commentary: DynamicStringSchema.optional(),
});

const PongLayoutSchema = z.object({
  mcpComponent: z.string().optional(),
  scoreboardComponent: z.string().optional(),
});

export const SHOW_WINNER_MODAL_FN = createFunctionImplementation(
  {
    name: 'showWinnerModal',
    returnType: 'void',
    schema: z.object({
      winner: z.enum(['player', 'cpu']),
    }),
  },
  (args, context) => {
    const dialog = document.createElement('dialog');
    dialog.style.border = 'none';
    dialog.style.borderRadius = '16px';
    dialog.style.padding = '32px';
    dialog.style.boxShadow = '0 20px 50px rgba(0, 0, 0, 0.5)';
    dialog.style.background = 'linear-gradient(135deg, #0a0b1e 0%, #1a082e 100%)';
    dialog.style.color = '#fff';
    dialog.style.textAlign = 'center';
    dialog.style.fontFamily = "'Outfit', sans-serif";
    dialog.style.maxWidth = '360px';
    dialog.style.outline = 'none';

    const title = document.createElement('h2');
    title.style.margin = '0 0 16px 0';
    title.style.fontSize = '2rem';
    title.style.textShadow = '0 0 10px rgba(0, 242, 255, 0.5)';
    title.style.color = args.winner === 'player' ? '#00f2ff' : '#ff00ff';
    title.textContent = args.winner === 'player' ? '🏆 VICTORY!' : '👾 GAME OVER';

    const message = document.createElement('p');
    message.style.margin = '0 0 24px 0';
    message.style.fontSize = '1.1rem';
    message.style.opacity = '0.9';
    message.textContent =
      args.winner === 'player'
        ? 'Congratulations! You defeated the CPU.'
        : 'The CPU won the match. Better luck next time!';

    const btn = document.createElement('button');
    btn.textContent = 'Play Again';
    btn.style.background = args.winner === 'player' ? '#00f2ff' : '#ff00ff';
    btn.style.color = '#050515';
    btn.style.border = 'none';
    btn.style.padding = '12px 32px';
    btn.style.borderRadius = '24px';
    btn.style.fontWeight = 'bold';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '1rem';
    btn.style.boxShadow = `0 0 15px ${
      args.winner === 'player' ? 'rgba(0, 242, 255, 0.4)' : 'rgba(255, 0, 255, 0.4)'
    }`;

    btn.onclick = () => {
      dialog.close();
      dialog.remove();
      // Reset scores in A2UI Data Model
      context.surface.dataModel.set('/pong_state/player_score', 0);
      context.surface.dataModel.set('/pong_state/cpu_score', 0);
    };

    dialog.appendChild(title);
    dialog.appendChild(message);
    dialog.appendChild(btn);
    document.body.appendChild(dialog);

    dialog.showModal();
  },
);

export const DEMO_CATALOG = new Catalog(
  MCP_APP_CATALOG_ID,
  [
    {name: 'McpApp', component: McpApp, schema: McpAppSchema},
    {name: 'PongScoreBoard', component: PongScoreBoard, schema: PongScoreBoardSchema},
    {name: 'PongLayout', component: PongLayout, schema: PongLayoutSchema},
    // Column should use ColumnApi.schema from @a2ui/web_core, but it is not currently
    // exported by the version of @a2ui/web_core resolved in this community sample.
    // We use z.any() to avoid duplicating the schema definition here.
    {name: 'Column', component: Column, schema: z.any()},
  ],
  [SHOW_WINNER_MODAL_FN],
);
