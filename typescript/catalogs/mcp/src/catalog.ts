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

import {Catalog} from '@a2ui/web_core/v0_9';
import type {WebComponentImplementation} from '@a2ui/web_core/v0_9/universal';
import {A2uiMcpApp} from './components/mcp_app.js';
import {DATA_FUNCTIONS, MCP_CATALOG_ID} from './functions.js';

export {MCP_CATALOG_ID} from './functions.js';

/**
 * The MCP catalog as far as it needs no host input: the `McpApp` component and the data
 * transformation functions, ready to hand to a `MessageProcessor`. `callMcpTool` needs the host's
 * MCP client and message processor, so a surface that calls tools uses a catalog built with
 * `createMcpCatalogFunctions`:
 *
 * ```ts
 * new Catalog(MCP_CATALOG_ID, [...mcpCatalog.components.values()], createMcpCatalogFunctions(resolver, processor))
 * ```
 *
 * A surface that mixes `McpApp` with other components needs one catalog holding every component
 * it uses; build it the same way from this catalog's `components` and the others'.
 */
export const mcpCatalog = new Catalog<WebComponentImplementation>(
  MCP_CATALOG_ID,
  [A2uiMcpApp],
  DATA_FUNCTIONS,
);
