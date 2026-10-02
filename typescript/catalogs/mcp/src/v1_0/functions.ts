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
 * The functions of the A2UI MCP catalog for A2UI protocol v1.0: `callMcpTool` and the data
 * transformation functions (`jmespath`, `split`, `regexCapture`, `regexReplace`,
 * `updateDataModel`).
 *
 * This is the `@a2ui/catalog-mcp/v1_0/functions` entry point. It imports nothing that needs a
 * browser, so an agent or a test running in Node can build the functions without a DOM; the
 * `@a2ui/catalog-mcp/v1_0` entry point adds the `McpApp` component on top of it. The function
 * implementations are the ones of the v0.9 catalog, which are protocol-agnostic; only the catalog
 * id and the version given to A2UI messages found in tool results differ.
 *
 * Example setup:
 * ```ts
 * const catalogs: Catalog<any>[] = [];
 * const processor = new MessageProcessor(catalogs, onAction);
 *
 * const functions = createMcpCatalogFunctions(toolName => clientFor(toolName), processor);
 * catalogs.push(new Catalog(MCP_CATALOG_ID, '1.0', [], functions));
 * ```
 */

import type {FunctionImplementation, MessageProcessor} from '@a2ui/web_core/v1_0';
import {
  createCallMcpToolImplementation as createV09CallMcpToolImplementation,
  type CallMcpToolOptions,
  type McpClientResolver,
} from '../functions/callMcpTool.js';
import {JmespathApi, JmespathImplementation} from '../functions/jmespath.js';
import {RegexCaptureApi, RegexCaptureImplementation} from '../functions/regexCapture.js';
import {RegexReplaceApi, RegexReplaceImplementation} from '../functions/regexReplace.js';
import {SplitApi, SplitImplementation} from '../functions/split.js';
import {UpdateDataModelApi, UpdateDataModelImplementation} from '../functions/updateDataModel.js';

/** Identifier of the catalog these functions implement. */
export const MCP_CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json';

/** The protocol version given to A2UI messages found in tool results without a `version`. */
export const DEFAULT_MESSAGE_VERSION = 'v1.0';

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
 * Creates the `callMcpTool` function implementation of the v1.0 catalog: the v0.9 one, with A2UI
 * messages found in tool results processed as `v1.0` messages unless they say otherwise.
 *
 * @param getMcpClientForTool Callback that resolves the MCP client for a tool name.
 * @param processor Message processor that applies decoded A2UI messages.
 * @param options Overrides of the version given to messages without one.
 */
export function createCallMcpToolImplementation(
  getMcpClientForTool: McpClientResolver,
  processor: MessageProcessor<any>,
  options: CallMcpToolOptions = {},
): FunctionImplementation {
  return createV09CallMcpToolImplementation(getMcpClientForTool, processor, {
    defaultVersion: DEFAULT_MESSAGE_VERSION,
    ...options,
  });
}

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
  type CallMcpToolOptions,
  type McpClientResolver,
  type McpToolClient,
} from '../functions/callMcpTool.js';

export {JmespathApi, JmespathImplementation} from '../functions/jmespath.js';
export {RegexCaptureApi, RegexCaptureImplementation} from '../functions/regexCapture.js';
export {RegexReplaceApi, RegexReplaceImplementation} from '../functions/regexReplace.js';
export {SplitApi, SplitImplementation} from '../functions/split.js';
export {UpdateDataModelApi, UpdateDataModelImplementation} from '../functions/updateDataModel.js';
export {isThenable} from '../functions/common.js';
