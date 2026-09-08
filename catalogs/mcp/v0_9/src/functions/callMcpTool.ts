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

import {
  createFunctionImplementation,
  type FunctionImplementation,
  A2uiExpressionError,
} from '@a2ui/web_core/v0_9';
import type {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {CallMcpToolApi} from './callMcpToolApi.js';

export {CallMcpToolApi};

/**
 * Getter function returning an MCP Client for an optional server name.
 */
export type McpClientGetter = (
  server?: string,
) => Client | Promise<Client> | undefined | Promise<Client | undefined>;

/**
 * Callback hook invoked when an MCP tool executes successfully.
 */
export type McpToolResultHandler = (
  result: CallToolResult,
  client: Client,
  name: string,
  server?: string,
) => Promise<void> | void;

/**
 * Creates a `callMcpTool` FunctionImplementation bound to an MCP client getter.
 *
 * @param clientGetter A getter function returning a Client for an optional server name.
 * @param onResult Optional hook called with the tool result and active client upon successful execution.
 */
export function createCallMcpToolImplementation(
  clientGetter: McpClientGetter,
  onResult?: McpToolResultHandler,
): FunctionImplementation {
  return createFunctionImplementation(CallMcpToolApi, async (args, _context, abortSignal) => {
    try {
      const server = args.server;
      const client = await clientGetter(server);

      if (!client) {
        throw new Error(
          server
            ? `MCP Client is not available for server '${server}'.`
            : 'MCP Client is not available.',
        );
      }

      const params = {
        name: args.name,
        arguments: args.arguments ?? {},
      };

      const result: CallToolResult = await client.request(
        {method: 'tools/call', params},
        CallToolResultSchema,
        {
          // Hosts may interpose long-running or user-interactive steps before the
          // tool result arrives. Opting in here lets a host heartbeat keep the
          // request alive past the default timeout; callers can still override.
          onprogress: () => {},
          resetTimeoutOnProgress: true,
          ...(abortSignal ? {signal: abortSignal} : {}),
        },
      );

      if (onResult) {
        await onResult(result, client, args.name, args.server);
      }

      return result;
    } catch (error: unknown) {
      if (error instanceof A2uiExpressionError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new A2uiExpressionError(
        `Failed to execute MCP tool '${args.name}': ${message}`,
        'callMcpTool',
        error,
      );
    }
  });
}
