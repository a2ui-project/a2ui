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
 * Module-level configuration of the MCP catalog: the objects a host application provides so
 * `callMcpTool` can reach its MCP servers and apply the A2UI messages they return, and where the
 * host serves the sandbox proxy pages. Set once at startup with `configureMcpCatalog`.
 */

import type {DataContext, MessageProcessor} from '@a2ui/web_core/v0_9';
import type {McpAppResourcePayload, McpClientResolver} from './functions/callMcpTool.js';
import {configureSandbox, type SandboxConfig} from './shared/sandbox/sandbox_config.js';

/** Host-provided configuration of the MCP catalog. */
export interface McpCatalogConfig {
  /**
   * Resolves the connected MCP client for a tool name. Without it `callMcpTool` fails and
   * `McpApp` dispatches `tools/call` requests as A2UI actions instead of executing them.
   */
  readonly getMcpClientForTool?: McpClientResolver;
  /**
   * Message processor that receives the A2UI messages found in tool results and UI resources.
   * Required together with `getMcpClientForTool`.
   */
  readonly processor?: MessageProcessor<any>;
  /** A2UI protocol version given to decoded messages that carry none. Defaults to `'v1.0'`. */
  readonly defaultVersion?: string;
  /** Called whenever a tool call resolves an MCP App (`text/html;profile=mcp-app`) resource. */
  readonly onMcpAppResource?: (payload: McpAppResourcePayload, context: DataContext) => void;
  /** Where the host serves the `sandbox/` proxy pages; see `SandboxConfig`. */
  readonly sandbox?: Partial<SandboxConfig>;
}

/** Default protocol version given to decoded messages that carry none. */
export const DEFAULT_MESSAGE_VERSION = 'v1.0';

let currentConfig: McpCatalogConfig = {};

/**
 * Configures the MCP catalog for this host. Unspecified fields keep their current values, so the
 * call can be repeated to update a single setting. `sandbox` is forwarded to the sandbox
 * configuration.
 */
export function configureMcpCatalog(config: McpCatalogConfig): void {
  const {sandbox, ...rest} = config;
  currentConfig = {...currentConfig, ...rest};
  if (sandbox) {
    configureSandbox(sandbox);
  }
}

/** Returns the current configuration. */
export function getMcpCatalogConfig(): McpCatalogConfig {
  return currentConfig;
}

/** Clears the configuration; tests call it in teardown. */
export function resetMcpCatalogConfig(): void {
  currentConfig = {};
}
