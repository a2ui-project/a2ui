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
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {CallMcpToolApi} from './callMcpToolApi.js';

export {CallMcpToolApi};

/**
 * Creates a `callMcpTool` FunctionImplementation bound to an MCP Client or client getter.
 *
 * @param clientOrGetter An MCP Client instance or a getter function returning a Client.
 */
export function createCallMcpToolImplementation(
  clientOrGetter: Client | (() => Client),
): FunctionImplementation {
  return createFunctionImplementation(CallMcpToolApi, async (args, _context, abortSignal) => {
    try {
      const client = typeof clientOrGetter === 'function' ? clientOrGetter() : clientOrGetter;

      if (!client) {
        throw new Error('MCP Client is not available.');
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
