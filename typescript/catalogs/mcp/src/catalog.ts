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
import {JmespathImplementation} from './functions/jmespath.js';
import {RegexCaptureImplementation} from './functions/regexCapture.js';
import {RegexReplaceImplementation} from './functions/regexReplace.js';
import {SplitImplementation} from './functions/split.js';
import {UpdateDataModelImplementation} from './functions/updateDataModel.js';

/** Identifier for the A2UI MCP catalog schema. */
export const MCP_CATALOG_ID = 'https://a2ui.org/specification/v1_0/catalogs/mcp/catalog.json';

/**
 * The MCP catalog: the `McpApp` component and every function of the catalog schema, ready to
 * hand to a `MessageProcessor`. `callMcpTool` runs once the host has called
 * `configureMcpCatalog({getMcpClientForTool, processor})`.
 *
 * A surface that mixes `McpApp` with other components needs one catalog holding every component
 * it uses; build it from this catalog's `components` and `functions` and the others'.
 */
export const mcpCatalog = new Catalog<WebComponentImplementation>(
  MCP_CATALOG_ID,
  '1.0',
  [A2uiMcpApp],
  [
    CallMcpToolImplementation,
    JmespathImplementation,
    SplitImplementation,
    RegexCaptureImplementation,
    RegexReplaceImplementation,
    UpdateDataModelImplementation,
  ],
);
