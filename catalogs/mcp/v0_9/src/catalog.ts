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

import {Catalog, type ComponentApi} from '@a2ui/web_core/v0_9';
import {
  createCallMcpToolImplementation,
  type McpToolCaller,
  type McpToolResultHandler,
} from './functions/callMcpTool.js';

export const MCP_CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/mcp/mcp_catalog.json';

export type {McpToolCaller, McpToolResultHandler};

/**
 * Creates an A2UI Catalog instance containing MCP catalog functions bound to a host tool caller.
 *
 * @param callMcpTool Executes a named MCP tool and returns its raw result.
 * @param onResult Optional hook called with the tool result upon successful execution.
 */
export function createMcpCatalog(
  callMcpTool: McpToolCaller,
  onResult?: McpToolResultHandler,
): Catalog<ComponentApi> {
  const functions = [createCallMcpToolImplementation(callMcpTool, onResult)];
  return new Catalog<ComponentApi>(MCP_CATALOG_ID, [], functions);
}
