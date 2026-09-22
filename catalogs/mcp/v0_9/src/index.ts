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
 * A2UI MCP Catalog providing `callMcpTool` and data transformation functions
 * (`jmespath`, `split`, `regexCapture`, `regexReplace`, `updateDataModel`).
 *
 * Example setup:
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
 * API definitions and schemas for the catalog's data transformation functions.
 */
export const DATA_FUNCTION_APIS = [
  JmespathApi,
  SplitApi,
  RegexCaptureApi,
  RegexReplaceApi,
  UpdateDataModelApi,
] as const;

/** Function implementations for the catalog's data transformation functions. */
export const DATA_FUNCTIONS: FunctionImplementation[] = [
  JmespathImplementation,
  SplitImplementation,
  RegexCaptureImplementation,
  RegexReplaceImplementation,
  UpdateDataModelImplementation,
];

/**
 * Creates all functions defined in the MCP catalog, including `callMcpTool`
 * and the data transformation functions.
 *
 * @param getMcpClientForTool Callback that resolves the MCP client for a tool name.
 * @param processor Message processor that receives A2UI messages decoded from tool results.
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
