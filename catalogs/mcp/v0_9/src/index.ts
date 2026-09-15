/*
 * Copyright 2024 Google LLC
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

/**
 * A2UI MCP Catalog: `callMcpTool` for invoking Model Context Protocol tools,
 * plus the data functions that turn a tool result into data model updates.
 *
 * `createMcpCatalogFunctions` returns every function the catalog defines, so a
 * host registers them in one step. `MessageProcessor` reads its catalogs
 * lazily, so pass it the array before filling it in.
 *
 * ```ts
 * const catalogs: Catalog<any>[] = [];
 * const processor = new MessageProcessor(catalogs, onAction);
 *
 * catalogs.push(
 *   new Catalog(CATALOG_ID, components, [
 *     ...basicFunctions,
 *     ...createMcpCatalogFunctions(toolName => clientFor(toolName), processor),
 *   ]),
 * );
 * ```
 */

import type {FunctionImplementation, MessageProcessor} from '@a2ui/web_core/v0_9';
import {createCallMcpToolImplementation, type McpClientResolver} from './functions/callMcpTool.js';
import {DATA_FUNCTIONS} from './functions/dataFunctions.js';

export const MCP_CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/mcp/mcp_catalog.json';

/**
 * Returns every function this catalog defines.
 *
 * @param getMcpClientForTool Supplies the client to call a given tool on.
 * @param processor Receives the A2UI messages decoded from tool results.
 */
export function createMcpCatalogFunctions(
  getMcpClientForTool: McpClientResolver,
  processor: MessageProcessor<any>,
): FunctionImplementation[] {
  return [createCallMcpToolImplementation(getMcpClientForTool, processor), ...DATA_FUNCTIONS];
}

export {
  A2UI_MIME_TYPE,
  CallMcpToolApi,
  createCallMcpToolImplementation,
  type McpClientResolver,
  type McpToolClient,
} from './functions/callMcpTool.js';

export {
  DATA_FUNCTIONS,
  JmespathImplementation,
  RegexCaptureImplementation,
  RegexMatchImplementation,
  RegexReplaceImplementation,
  SplitImplementation,
  UpdateDataModelImplementation,
} from './functions/dataFunctions.js';

export {
  DATA_FUNCTION_APIS,
  JmespathApi,
  RegexCaptureApi,
  RegexMatchApi,
  RegexReplaceApi,
  SplitApi,
  UpdateDataModelApi,
} from './functions/dataFunctionsApi.js';
