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
  type DataContext,
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
 * Recursively resolves dynamic values (data bindings and function calls) against a DataContext.
 */
function resolveDynamicValue<T>(value: unknown, context?: DataContext): T {
  if (value === null || typeof value !== 'object' || !context) {
    return value as T;
  }
  if ('path' in value || 'call' in value) {
    return context.resolveDynamicValue(value as any);
  }
  if (Array.isArray(value)) {
    return value.map(item => resolveDynamicValue(item, context)) as unknown as T;
  }
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(value)) {
    result[k] = resolveDynamicValue(v, context);
  }
  return result as T;
}

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
  return createFunctionImplementation(CallMcpToolApi, async (args, context, abortSignal) => {
    const server = resolveDynamicValue<string | undefined>(args.server, context);
    const name = resolveDynamicValue<string>(args.name, context);
    const resolvedArguments = resolveDynamicValue<Record<string, any>>(
      args.arguments ?? {},
      context,
    );

    try {
      const client = await clientGetter(server);

      if (!client) {
        throw new Error(
          server
            ? `MCP Client is not available for server '${server}'.`
            : 'MCP Client is not available.',
        );
      }

      console.log(
        `Executing MCP tool '${name}' on server '${server || 'default'}' with arguments:`,
        JSON.stringify(resolvedArguments),
      );

      const params = {
        name,
        arguments: resolvedArguments,
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

      if (result.isError) {
        throw new Error(`MCP tool '${name}' execution failed: ${JSON.stringify(result.content)}`);
      }

      if (onResult) {
        await onResult(result, client, name, server);
      }

      return result;
    } catch (error: unknown) {
      if (error instanceof A2uiExpressionError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new A2uiExpressionError(
        `Failed to execute MCP tool '${name}': ${message}`,
        'callMcpTool',
        error,
      );
    }
  });
}
