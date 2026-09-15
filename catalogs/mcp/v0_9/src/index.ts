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

import type {FunctionImplementation, MessageProcessor} from '@a2ui/web_core/v0_9';
import {createCallMcpToolImplementation, type McpClientResolver} from './functions/callMcpTool.js';
import {JmespathApi, JmespathImplementation} from './functions/jmespath.js';
import {RegexCaptureApi, RegexCaptureImplementation} from './functions/regexCapture.js';
import {RegexReplaceApi, RegexReplaceImplementation} from './functions/regexReplace.js';
import {SplitApi, SplitImplementation} from './functions/split.js';
import {UpdateDataModelApi, UpdateDataModelImplementation} from './functions/updateDataModel.js';

export const MCP_CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/mcp/mcp_catalog.json';

/** All data function API definitions in catalog order. */
export const DATA_FUNCTION_APIS = [
  JmespathApi,
  SplitApi,
  RegexCaptureApi,
  RegexReplaceApi,
  UpdateDataModelApi,
] as const;

/** All data function implementations ready for catalog registration. */
export const DATA_FUNCTIONS: FunctionImplementation[] = [
  JmespathImplementation,
  SplitImplementation,
  RegexCaptureImplementation,
  RegexReplaceImplementation,
  UpdateDataModelImplementation,
];

/**
 * Returns all function implementations defined by the MCP catalog (`callMcpTool` and data functions).
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
  JMESPATH_LANGUAGE_DESCRIPTION,
  JmespathApi,
  JmespathImplementation,
} from './functions/jmespath.js';
export {RegexCaptureApi, RegexCaptureImplementation} from './functions/regexCapture.js';
export {RegexReplaceApi, RegexReplaceImplementation} from './functions/regexReplace.js';
export {SplitApi, SplitImplementation} from './functions/split.js';
export {UpdateDataModelApi, UpdateDataModelImplementation} from './functions/updateDataModel.js';
export {isThenable} from './functions/common.js';
