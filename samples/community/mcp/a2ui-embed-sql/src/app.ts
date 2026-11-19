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
 * Registers the sample's tools, actions and follow-ups on an MCP server with
 * `createA2uiApp` from `@a2ui/embed/mcp/server`.
 */

import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {createA2uiApp, type A2uiApp, type A2uiToolOutput} from '@a2ui/embed/mcp/server';
import type {CatalogSchemaFile} from '@a2ui/embed/contract';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

import {SQL_CATALOG_ID} from './catalog/catalog_id.js';
import {
  BREAKDOWN_EVENT,
  BREAKDOWN_TEMPLATE,
  BreakdownContextSchema,
  REFRESH_EVENT,
  RefreshContextSchema,
} from './compose/events.js';
import type {A2uiMessage} from './compose/messages.js';
import {ReadOnlyDatabase} from './db/database.js';
import {geminiModelFromEnv} from './explain/json_model.js';
import {SqlTools} from './sql_tools.js';
import {EXPLAIN_TOOL, LIST_TABLES_TOOL, QUERY_TOOL} from './tools.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Path of the SQLite file: `SQL_SAMPLE_DB`, or the Chinook file `yarn fetch-data` downloads. */
export function databasePath(env: NodeJS.ProcessEnv = process.env): string {
  return env['SQL_SAMPLE_DB'] ?? join(packageRoot, 'data', 'chinook.sqlite');
}

/** Path of the app HTML: `A2UI_EMBED_SQL_HTML`, or the file `yarn build` writes. */
export function appHtmlPath(env: NodeJS.ProcessEnv = process.env): string {
  return env['A2UI_EMBED_SQL_HTML'] ?? join(packageRoot, 'dist', 'a2ui-app.html');
}

/** Path of the catalog schema file `a2ui-embed build` writes next to the app HTML. */
export function catalogSchemaPath(env: NodeJS.ProcessEnv = process.env): string {
  return appHtmlPath(env).replace(/\.html$/, '.catalog.json');
}

/**
 * Loads `SQL_SAMPLE_ENV_FILE` (default: `.env` in the package) into `env`
 * when the file exists, without overriding variables that are already set.
 */
export function loadEnvFile(env: NodeJS.ProcessEnv = process.env): void {
  const path = env['SQL_SAMPLE_ENV_FILE'] ?? join(packageRoot, '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match?.[1] || env[match[1]] !== undefined) continue;
    env[match[1]] = (match[2] ?? '').replace(/^(['"])(.*)\1$/, '$2');
  }
}

/** Creates the domain handlers for the database at {@link databasePath}. */
export function createSqlTools(
  env: NodeJS.ProcessEnv = process.env,
  validator?: Pick<A2uiApp, 'validate'>,
): SqlTools {
  const catalogSchema = JSON.parse(
    readFileSync(join(packageRoot, 'src', 'catalog', 'catalog_schema.json'), 'utf8'),
  ) as Record<string, unknown>;
  return new SqlTools(
    new ReadOnlyDatabase(databasePath(env)),
    catalogSchema,
    geminiModelFromEnv(env),
    undefined,
    validator,
  );
}

/**
 * The composers' messages as the web_core message type `@a2ui/embed` expects.
 * `@a2ui/embed` validates them before they are sent.
 */
function messages(a2ui: readonly A2uiMessage[]): NonNullable<A2uiToolOutput['a2ui']> {
  return a2ui as unknown as NonNullable<A2uiToolOutput['a2ui']>;
}

/** MCP server instructions: how the model should use the tools and their summaries. */
export const SERVER_INSTRUCTIONS = [
  'Read-only SQL access to the Chinook music store database (SQLite).',
  'Prefer the query tool with your own SQL; call list_tables first if you need the schema. Use explain only when asked or when you cannot write the SQL.',
  'Every tool result includes a text summary of what the user sees in the rendered view: row counts, totals, the first rows, and how many rows the view shows. Reuse it to answer follow-up questions instead of querying again when it already has the answer.',
  'Context attached to a user\'s message by the app (an A2UI surface data model) reflects what the user selected in the card, under "selected"; use it to resolve references like "this row".',
].join('\n');

/**
 * Creates the MCP server: the three tools, the `refresh` action and the
 * `breakdown` follow-up. Failing SQL makes the tool throw a `QueryError`,
 * which `@a2ui/embed` turns into an error result with the message as text.
 */
export function createServer(env: NodeJS.ProcessEnv = process.env): McpServer {
  const server = new McpServer(
    {name: 'a2ui-embed-sql', version: '0.1.0'},
    {instructions: SERVER_INSTRUCTIONS},
  );
  const catalogSchemaFile = JSON.parse(
    readFileSync(catalogSchemaPath(env), 'utf8'),
  ) as CatalogSchemaFile;
  if (!catalogSchemaFile.catalogs[SQL_CATALOG_ID]) {
    throw new Error(`${catalogSchemaPath(env)} has no schema for ${SQL_CATALOG_ID}.`);
  }
  const app = createA2uiApp(server, {
    html: appHtmlPath(env),
    catalogSchema: catalogSchemaFile,
    resourceName: 'SQL explorer',
  });
  const tools = createSqlTools(env, app);

  app.tool(LIST_TABLES_TOOL.name, LIST_TABLES_TOOL.config, () => {
    const output = tools.listTables();
    return {text: output.text, a2ui: messages(output.a2ui)};
  });
  app.tool(QUERY_TOOL.name, QUERY_TOOL.config, async args => {
    const output = await tools.query(args);
    return {text: output.text, a2ui: messages(output.a2ui)};
  });
  app.tool(EXPLAIN_TOOL.name, EXPLAIN_TOOL.config, async ({question}) => {
    const output = await tools.explain(question);
    // Without a model or an answer, explain returns text only.
    return output.a2ui.length === 0
      ? {text: output.text}
      : {text: output.text, a2ui: messages(output.a2ui)};
  });
  app.action(REFRESH_EVENT, {argsSchema: RefreshContextSchema.shape}, async (args, {surfaceId}) => {
    const output = await tools.refresh(args, surfaceId);
    return {text: output.text, a2ui: messages(output.a2ui)};
  });
  app.followUp(BREAKDOWN_EVENT, {
    template: BREAKDOWN_TEMPLATE,
    argsSchema: BreakdownContextSchema.shape,
  });
  return server;
}
