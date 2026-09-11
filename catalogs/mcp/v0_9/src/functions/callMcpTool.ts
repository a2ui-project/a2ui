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
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {CallMcpToolApi} from './callMcpToolApi.js';

export {CallMcpToolApi};

/**
 * Executes an MCP tool by name and returns the raw `CallToolResult`.
 *
 * The host application owns transport concerns: it resolves which connected MCP
 * server hosts the named tool, issues the `tools/call` request, and returns the
 * result. Result inspection is handled by the catalog function itself.
 */
export type McpToolCaller = (
  toolName: string,
  args: Record<string, any>,
) => CallToolResult | Promise<CallToolResult>;

/**
 * Callback hook invoked when an MCP tool executes successfully.
 */
export type McpToolResultHandler = (
  result: CallToolResult,
  toolName: string,
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
 * Creates a `callMcpTool` FunctionImplementation bound to a host tool caller.
 *
 * @param callMcpTool Executes a named MCP tool and returns its raw result.
 * @param onResult Optional hook called with the tool result upon successful execution.
 */
export function createCallMcpToolImplementation(
  callMcpTool: McpToolCaller,
  onResult?: McpToolResultHandler,
): FunctionImplementation {
  return createFunctionImplementation(CallMcpToolApi, async (args, context) => {
    const toolName = resolveDynamicValue<string>(args.name, context);
    const resolvedArguments = resolveDynamicValue<Record<string, any>>(
      args.arguments ?? {},
      context,
    );

    try {
      console.debug(
        `Executing MCP tool '${toolName}' with arguments:`,
        JSON.stringify(resolvedArguments),
      );

      const result = await callMcpTool(toolName, resolvedArguments);

      if (!result) {
        throw new Error(`MCP tool '${toolName}' did not return a result.`);
      }

      if (result.isError) {
        throw new Error(`MCP tool '${toolName}' execution failed: ${JSON.stringify(result)}`);
      }

      if (onResult) {
        await onResult(result, toolName);
      }

      return result;
    } catch (error: unknown) {
      if (error instanceof A2uiExpressionError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new A2uiExpressionError(
        `Failed to execute MCP tool '${toolName}': ${message}`,
        'callMcpTool',
        error,
      );
    }
  });
}
