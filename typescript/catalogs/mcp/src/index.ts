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
 * `@a2ui/catalog-mcp`: the A2UI MCP catalog with the `McpApp` universal component and the
 * `callMcpTool` and data functions, configured once per host with `configureMcpCatalog`.
 */

export {mcpCatalog} from './catalog.js';
export {A2uiMcpApp} from './components/mcp_app.js';
export {configureMcpCatalog, type McpCatalogConfig} from './mcp_catalog_config.js';
export type {SandboxConfig} from './shared/sandbox/sandbox_config.js';
export {
  CallMcpToolImplementation,
  type McpAppResourcePayload,
  type McpClientResolver,
  type McpToolClient,
} from './functions/callMcpTool.js';
export {JmespathImplementation} from './functions/jmespath.js';
export {RegexCaptureImplementation} from './functions/regexCapture.js';
export {RegexReplaceImplementation} from './functions/regexReplace.js';
export {SplitImplementation} from './functions/split.js';
export {UpdateDataModelImplementation} from './functions/updateDataModel.js';
