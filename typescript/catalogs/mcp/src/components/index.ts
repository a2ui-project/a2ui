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
 * `@a2ui/catalog-mcp/components`: the `McpApp` universal component, its API and its host
 * bridge, without the catalog functions.
 */

export {
  A2uiMcpApp,
  decodeHtmlContent,
  DEFAULT_MCP_APP_TITLE,
  MCP_APP_INNER_SANDBOX,
  McpAppApi,
  URL_ENCODED_PREFIX,
  type McpAppProps,
} from './mcp_app.js';
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
} from './mcp_app_bridge.js';
