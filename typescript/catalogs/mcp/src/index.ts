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

/**
 * `@a2ui/catalog-mcp`: the A2UI MCP catalog for web renderers. This entry point exposes the
 * catalog with the `McpApp` universal component and the catalog functions, the sandbox
 * configuration and the MCP Apps host bridge. It needs a browser; agents and tests that only
 * need the functions import `@a2ui/catalog-mcp/functions`.
 */

// The catalog and its component.
export {MCP_CATALOG_ID, mcpCatalog} from './catalog.js';
export {
  A2uiMcpApp,
  decodeHtmlContent,
  DEFAULT_MCP_APP_TITLE,
  MCP_APP_INNER_SANDBOX,
  McpAppApi,
  URL_ENCODED_PREFIX,
  type McpAppProps,
} from './components/mcp_app.js';
export {
  DATA_MODEL_CHANGE_METHOD,
  DATA_MODEL_UPDATE_METHOD,
  DataModelChangeNotificationSchema,
  DEFAULT_MCP_APP_HOST_INFO,
  FUNCTION_CALL_METHOD,
  FunctionCallRequestSchema,
  McpAppBridge,
  type FunctionCallResult,
  type McpAppBridgeOptions,
  type McpAppBridgeProps,
} from './components/mcp_app_bridge.js';

// Sandbox configuration.
export {
  configureSandbox,
  DEFAULT_SANDBOX_BASE_URL,
  getSandboxConfig,
  resetSandboxConfig,
  resolveSandboxUrl,
  SANDBOX_PAGES,
  type ResolveSandboxUrlOptions,
  type SandboxConfig,
  type SandboxMode,
} from './shared/sandbox/sandbox_config.js';

// The catalog functions, as exported by `@a2ui/catalog-mcp/functions`.
export {
  A2UI_MIME_TYPE,
  CallMcpToolApi,
  createCallMcpToolImplementation,
  createMcpCatalogFunctions,
  DATA_FUNCTION_APIS,
  DATA_FUNCTIONS,
  isThenable,
  JmespathApi,
  JmespathImplementation,
  RegexCaptureApi,
  RegexCaptureImplementation,
  RegexReplaceApi,
  RegexReplaceImplementation,
  SplitApi,
  SplitImplementation,
  UpdateDataModelApi,
  UpdateDataModelImplementation,
  type McpClientResolver,
  type McpToolClient,
} from './functions.js';
