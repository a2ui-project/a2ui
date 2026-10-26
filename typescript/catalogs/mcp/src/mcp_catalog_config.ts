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

import type {CallMcpToolOptions} from './functions/callMcpTool.js';
import {
  configureSandbox,
  resetSandboxConfig,
  type SandboxConfig,
} from './shared/sandbox/sandbox_config.js';

/**
 * Host-provided configuration of the MCP catalog: the `callMcpTool` options (MCP client resolver,
 * message processor, default message version, MCP App resource callback) plus the sandbox location.
 */
export interface McpCatalogConfig extends CallMcpToolOptions {
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
  resetSandboxConfig();
}
