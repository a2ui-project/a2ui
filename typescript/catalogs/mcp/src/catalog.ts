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

import {Catalog, type WebComponentImplementation} from '@a2ui/web_core/v1_0';
import {A2uiMcpApp} from './components/mcp_app.js';
import {CallMcpToolImplementation} from './functions/callMcpTool.js';

/** Identifier of the A2UI MCP catalog schema (`catalogs/mcp/v1/catalog.json`). */
export const MCP_CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json';

/**
 * The MCP catalog: the `McpApp` component and `callMcpTool`, ready to hand to a
 * `MessageProcessor`. `callMcpTool` runs once the host has called
 * `configureMcpCatalog({getMcpClientForTool, processor})`.
 *
 * Register it next to the other catalogs of the host; a component of a surface created with
 * another catalog selects this one with its own `catalogId`.
 */
export const mcpCatalog = new Catalog<WebComponentImplementation>(
  MCP_CATALOG_ID,
  '1.0',
  [A2uiMcpApp],
  [CallMcpToolImplementation],
);
