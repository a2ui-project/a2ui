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
 * `@a2ui/catalog-mcp`: the A2UI MCP catalog with the `McpApp` universal component, the
 * `callMcpTool` function and the data functions that shape its results, configured once per host
 * with `configureMcpCatalog`.
 */

export {
  createMcpCatalog,
  loadMcpCatalogApi,
  MCP_CATALOG_DOCUMENT,
  MCP_CATALOG_ID,
  type McpCatalog,
} from './catalog.js';
export {
  type A2uiMcpApp,
  A2uiMcpAppElement,
  createMcpAppImplementation,
  type McpAppApi,
  type McpAppCsp,
  type McpAppPermissions,
  type McpAppProps,
} from './components/mcp_app.js';
export {configureMcpCatalog, type McpCatalogConfig} from './mcp_catalog_config.js';
export type {SandboxConfig} from './shared/sandbox/sandbox_config.js';
export {
  createCallMcpToolImplementation,
  type CallMcpToolOptions,
  type McpAppResourcePayload,
  type McpClientResolver,
  type McpToolDataPayload,
  type McpToolClient,
} from './functions/callMcpTool.js';
export {createRegexCaptureImplementation} from './functions/regex_capture.js';
export {createSplitImplementation} from './functions/split.js';
export {createTransformDataImplementation} from './functions/transform_data.js';
export {createUpdateDataModelImplementation} from './functions/update_data_model.js';
