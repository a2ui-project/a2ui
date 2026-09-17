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
 * A2UI MCP Catalog: `callMcpTool`, for invoking Model Context Protocol tools
 * from A2UI surfaces, and the data functions that shape what a tool returns.
 *
 * `MessageProcessor` reads its catalogs lazily, so pass it the array before
 * filling it in. That builds the processor first and keeps the wiring direct.
 *
 * ```ts
 * const catalogs: Catalog<any>[] = [];
 * const processor = new MessageProcessor(catalogs, onAction);
 *
 * const functions = createMcpCatalogFunctions(toolName => clientFor(toolName), processor);
 * catalogs.push(new Catalog(MCP_CATALOG_ID, [], functions));
 * ```
 */

import type {FunctionImplementation, MessageProcessor} from '@a2ui/web_core/v0_9';
import {createCallMcpToolImplementation, type McpClientResolver} from './functions/callMcpTool.js';
import {JmespathApi, JmespathImplementation} from './functions/jmespath.js';
import {RegexCaptureApi, RegexCaptureImplementation} from './functions/regexCapture.js';
import {RegexReplaceApi, RegexReplaceImplementation} from './functions/regexReplace.js';
import {SplitApi, SplitImplementation} from './functions/split.js';
import {UpdateDataModelApi, UpdateDataModelImplementation} from './functions/updateDataModel.js';

/** Identifier of the catalog these functions implement. */
export const MCP_CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/mcp/mcp_catalog.json';

/**
 * Every data function API, in the order the catalog lists them.
 *
 * These carry the argument schemas without the implementations, so a host can
 * publish the catalog without loading an expression evaluator or a regular
 * expression engine.
 */
export const DATA_FUNCTION_APIS = [
  JmespathApi,
  SplitApi,
  RegexCaptureApi,
  RegexReplaceApi,
  UpdateDataModelApi,
] as const;

/** The data function implementations, ready to register in a `Catalog`. */
export const DATA_FUNCTIONS: FunctionImplementation[] = [
  JmespathImplementation,
  SplitImplementation,
  RegexCaptureImplementation,
  RegexReplaceImplementation,
  UpdateDataModelImplementation,
];

/**
 * Returns every function this catalog defines: `callMcpTool` bound to the host's
 * hooks, followed by the data functions.
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

export {JmespathApi, JmespathImplementation} from './functions/jmespath.js';
export {RegexCaptureApi, RegexCaptureImplementation} from './functions/regexCapture.js';
export {RegexReplaceApi, RegexReplaceImplementation} from './functions/regexReplace.js';
export {SplitApi, SplitImplementation} from './functions/split.js';
export {UpdateDataModelApi, UpdateDataModelImplementation} from './functions/updateDataModel.js';
export {isThenable} from './functions/common.js';
