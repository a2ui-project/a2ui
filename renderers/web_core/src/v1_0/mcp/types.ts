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

/** MCP Resource contents item. */
export interface McpResourceContents {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  [key: string]: unknown;
}

/** Content item within an MCP Tool call result. */
export interface McpContentItem {
  type: string;
  text?: string;
  resource?: McpResourceContents;
  [key: string]: unknown;
}

/** Result returned from an MCP tools/call invocation. */
export interface McpCallToolResult {
  content?: McpContentItem[];
  isError?: boolean;
  [key: string]: unknown;
}

/** Parameters for calling an MCP Tool. */
export interface McpCallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
}

/** Client interface representing an MCP Client for calling tools and reading resources. */
export interface McpClientInterface {
  callTool(params: McpCallToolParams): Promise<McpCallToolResult>;
  listTools?(): Promise<{tools: Array<{name: string; [key: string]: unknown}>}>;
  readResource?(params: {uri: string}): Promise<{contents: McpResourceContents[]}>;
}

/** Options for generating MCP UI client capabilities. */
export interface McpUiClientCapabilitiesOptions {
  /** If true, advertises application/a2ui+json for native rendering. Defaults to true. */
  enableNativeA2ui?: boolean;
  /** If true, advertises text/html;profile=mcp-app for iframe fallback. Defaults to true. */
  enableHtmlApp?: boolean;
}

/** Subscription handle for MCP action dispatchers. */
export interface McpActionDispatcherSubscription {
  unsubscribe: () => void;
}

/** Message processor interface for feeding messages into A2UI surfaces. */
export interface A2uiMessageProcessorLike {
  processMessages?: (messages: any[]) => Promise<unknown> | unknown;
  [key: string]: any;
}

/** Options for configuring an MCP Action Dispatcher. */
export interface McpActionDispatcherOptions {
  /** Target message processor to update when tools return A2UI payloads. */
  messageProcessor?: A2uiMessageProcessorLike;
  /** Callback fired when a tool execution encounters an error. */
  onError?: (error: unknown) => void;
}

/** Host context options passed to sandboxed views. */
export interface McpHostContext {
  displayMode?: string;
  availableDisplayModes?: string[];
  [key: string]: unknown;
}

/** Options for initializing an McpSandboxHost controller. */
export interface McpSandboxHostOptions {
  /** MCP Client used to execute tool calls requested from inside the iframe. */
  mcpClient?: McpClientInterface;
  /** Whitelist of tool names the sandboxed iframe is permitted to call. */
  allowedTools?: Set<string> | string[];
  /** Expected origin of the host window for message origin verification. */
  allowedHostOrigin?: string;
  /** Protocol version string to advertise to the view during ui/initialize. */
  protocolVersion?: string;
  /** Host information reported to the view during ui/initialize. */
  hostInfo?: {name: string; version: string};
  /** Host context options reported to the view during ui/initialize. */
  hostContext?: McpHostContext;
  /** Callback invoked when the sandboxed iframe requests a size change. */
  onSizeChanged?: (size: {width?: number; height?: number}) => void;
  /** Callback invoked when the sandbox connection status updates. */
  onStatusChange?: (status: string) => void;
}
