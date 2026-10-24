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
 * Test support for the A2UI MCP catalog.
 *
 * {@link createStubMcpClient} stands in for a connected MCP server.
 * {@link stubMcp} wraps one as a plugin for `createSurfaceHarness` from
 * `@a2ui/testing`, so a test drives a payload by component id and asserts on
 * the tool calls it made:
 *
 * ```ts
 * const mcp = stubMcp({tools: {get_recipe_a2ui: {content: [...]}}});
 * const h = await createSurfaceHarness({messages: recipeForm, plugins: [mcp]});
 * await h.click('submit-button');
 * expect(mcp.calls).toEqual([{name: 'get_recipe_a2ui', arguments: {...}}]);
 * ```
 */

import type {SurfaceHarnessPlugin} from '@a2ui/testing';
import type {MessageProcessor} from '@a2ui/web_core/v0_9';

import {createCallMcpToolImplementation} from '../functions/callMcpTool.js';
import {MCP_CATALOG_ID} from '../index.js';
import {createStubMcpClient, type StubMcpClient, type StubMcpOptions} from './stub-mcp-client.js';

export {
  createStubMcpClient,
  type McpCall,
  type StubMcpClient,
  type StubMcpOptions,
  type StubTool,
  type StubToolResponse,
} from './stub-mcp-client.js';

/**
 * Catalog id the MCP samples use for "basic components plus `callMcpTool`".
 * The plugin synthesizes it so sample payloads load without extra setup.
 */
export const BASIC_WITH_MCP_CATALOG_ID =
  'https://a2ui.org/specification/v0_9/catalogs/basic_with_mcp/catalog.json';

/** A stub MCP server as a `createSurfaceHarness` plugin. */
export interface StubMcp extends SurfaceHarnessPlugin {
  /** The underlying client, for hosts that want to pass it themselves. */
  readonly client: StubMcpClient;
  /** Every `tools/call` the surface made, in order. */
  readonly calls: StubMcpClient['calls'];
  /** Every `resources/read` URI the surface fetched, in order. */
  readonly reads: StubMcpClient['reads'];
}

/**
 * Creates a harness plugin that registers `callMcpTool` against a stub MCP
 * server and lets the harness wait for tool answers.
 */
export function stubMcp(options: StubMcpOptions = {}): StubMcp {
  const client = createStubMcpClient(options);
  return {
    name: 'mcp',
    client,
    calls: client.calls,
    reads: client.reads,
    catalogIds: [MCP_CATALOG_ID, BASIC_WITH_MCP_CATALOG_ID],
    functions: (processor: MessageProcessor<any>) => [
      createCallMcpToolImplementation(() => client, processor),
    ],
    pending: () => client.pending(),
    settle: () => client.settle(),
  };
}
