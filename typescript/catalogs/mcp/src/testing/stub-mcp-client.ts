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

import type {A2uiMessage} from '@a2ui/web_core/v0_9';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';

import {A2UI_MIME_TYPE, type McpToolClient} from '../functions/callMcpTool.js';

/**
 * What a stubbed MCP tool answers with.
 *
 * - A string becomes one `text` content block.
 * - An object holding `content` is used as the `CallToolResult` as is, so a
 *   stub can carry `_meta.ui.resourceUri` or embedded A2UI resources.
 * - Any other object is serialized to JSON in one `text` content block.
 */
export type StubToolResponse = string | CallToolResult | Record<string, unknown>;

/**
 * A stubbed MCP tool: a fixed response, or a function of the resolved tool
 * arguments returning one, synchronously or as a promise.
 */
export type StubTool =
  | StubToolResponse
  | ((args: Record<string, unknown>) => StubToolResponse | Promise<StubToolResponse>);

/** One recorded `tools/call` request. */
export interface McpCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** Configuration of the in-memory MCP server. */
export interface StubMcpOptions {
  /** Tools the server serves, keyed by tool name. Calling any other tool fails. */
  tools?: Record<string, StubTool>;
  /**
   * Resources served by `resources/read`, keyed by URI. A value that is not a
   * string is serialized to JSON and served as `application/a2ui+json`.
   */
  resources?: Record<string, A2uiMessage[] | string>;
  /**
   * `_meta` served with each tool descriptor in `tools/list`. Use it when a
   * payload relies on a UI resource the tool declares rather than one its
   * result names.
   */
  toolMeta?: Record<string, Record<string, unknown>>;
}

/** An in-memory MCP client that answers from {@link StubMcpOptions} and records traffic. */
export interface StubMcpClient extends McpToolClient {
  /** Every `tools/call` received, in order. */
  readonly calls: McpCall[];
  /** Every `resources/read` URI received, in order. */
  readonly reads: string[];
  /** Whether any request is still being answered. */
  pending(): boolean;
  /** Resolves once every request received so far has been answered. */
  settle(): Promise<void>;
}

/** Turns a stub response into the `CallToolResult` the catalog expects. */
function toCallToolResult(response: StubToolResponse): CallToolResult {
  if (typeof response === 'string') {
    return {content: [{type: 'text', text: response}]};
  }
  if (response && typeof response === 'object' && Array.isArray(response['content'])) {
    return response as CallToolResult;
  }
  return {content: [{type: 'text', text: JSON.stringify(response)}]};
}

/**
 * Creates a stub MCP client.
 *
 * The client implements the subset of the MCP SDK `Client` that
 * `callMcpTool` uses: `request` for `tools/call`, `readResource`, and
 * `listTools`. An unstubbed tool or resource rejects with a message naming it,
 * which `callMcpTool` surfaces as an `A2uiExpressionError`.
 *
 * Pass it wherever a host would pass a connected client, for example to
 * `createCallMcpToolImplementation(() => client, processor)`.
 */
export function createStubMcpClient(options: StubMcpOptions = {}): StubMcpClient {
  const tools = options.tools ?? {};
  const resources = options.resources ?? {};
  const toolMeta = options.toolMeta ?? {};
  const calls: McpCall[] = [];
  const reads: string[] = [];
  const inFlight = new Set<Promise<unknown>>();

  const track = <T>(promise: Promise<T>): Promise<T> => {
    inFlight.add(promise);
    promise.finally(() => inFlight.delete(promise)).catch(() => {});
    return promise;
  };

  const client = {
    calls,
    reads,
    pending: () => inFlight.size > 0,
    async settle() {
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
      }
    },

    request(request: {method: string; params?: Record<string, unknown>}) {
      return track(
        (async () => {
          if (request.method !== 'tools/call') {
            throw new Error(`Stub MCP server does not implement ${request.method}.`);
          }
          const params = request.params ?? {};
          const name = String(params['name']);
          const args = (params['arguments'] as Record<string, unknown> | undefined) ?? {};
          calls.push({name, arguments: args});

          const tool: StubTool | undefined = tools[name];
          if (tool === undefined) {
            throw new Error(`Unstubbed MCP tool '${name}'. Add it to the stub's tools.`);
          }
          const response = typeof tool === 'function' ? await tool(args) : tool;
          return toCallToolResult(response);
        })(),
      );
    },

    readResource({uri}: {uri: string}) {
      return track(
        (async () => {
          reads.push(uri);
          const resource = resources[uri];
          if (resource === undefined) {
            throw new Error(`Unstubbed MCP resource '${uri}'. Add it to the stub's resources.`);
          }
          const text = typeof resource === 'string' ? resource : JSON.stringify(resource);
          return {contents: [{uri, mimeType: A2UI_MIME_TYPE, text}]};
        })(),
      );
    },

    async listTools() {
      return {
        tools: Object.keys(tools).map(name => ({
          name,
          inputSchema: {type: 'object' as const},
          ...(toolMeta[name] ? {_meta: toolMeta[name]} : {}),
        })),
      };
    },
  };

  return client as unknown as StubMcpClient;
}
