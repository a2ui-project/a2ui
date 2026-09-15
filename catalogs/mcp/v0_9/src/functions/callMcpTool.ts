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
  A2uiExpressionError,
  DynamicStringSchema,
  DynamicValueSchema,
  createFunctionImplementation,
  type A2uiMessage,
  type CreateSurfaceMessage,
  type FunctionImplementation,
  type MessageProcessor,
} from '@a2ui/web_core/v0_9';
import type {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import type {CallToolResult, ReadResourceResult} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';

import {resolveDynamicRecord} from '../dynamic-values.js';

/** MIME type identifying an A2UI payload in MCP resources. */
export const A2UI_MIME_TYPE = 'application/a2ui+json';

/** Subset of the MCP `Client` required by `callMcpTool`. */
export type McpToolClient = Pick<Client, 'request' | 'readResource' | 'listTools'>;

/** Resolves the connected MCP client that serves a named tool. */
export type McpClientResolver = (
  toolName: string,
) => McpToolClient | undefined | null | Promise<McpToolClient | undefined | null>;

export const CallMcpToolApi = {
  name: 'callMcpTool' as const,
  returnType: 'any' as const,
  schema: z.object({
    name: DynamicStringSchema.describe('The name of the MCP tool to execute.'),
    arguments: z
      .record(DynamicValueSchema)
      .optional()
      .default({})
      .describe('The arguments to pass to the MCP tool.'),
  }),
  description: 'Invokes a tool on a connected Model Context Protocol (MCP) server.',
};

/**
 * Creates the `callMcpTool` function implementation.
 *
 * Invokes an MCP tool, processes any UI resources declared by the tool or inline
 * `application/a2ui+json` content blocks, and returns the raw `CallToolResult`.
 */
export function createCallMcpToolImplementation(
  getMcpClientForTool: McpClientResolver,
  processor: MessageProcessor<any>,
): FunctionImplementation {
  const a2uiMessagesByResourceUri = new Map<string, A2uiMessage[]>();
  const declaredUiResourceUris = new WeakMap<McpToolClient, Promise<Map<string, string[]>>>();

  async function readA2uiResource(client: McpToolClient, uri: string): Promise<A2uiMessage[]> {
    let messages = a2uiMessagesByResourceUri.get(uri);
    if (!messages) {
      messages = parseA2uiMessages(await client.readResource({uri}), uri);
      a2uiMessagesByResourceUri.set(uri, messages);
    }
    return messages;
  }

  function getDeclaredUiResourceUris(client: McpToolClient): Promise<Map<string, string[]>> {
    const cached = declaredUiResourceUris.get(client);
    if (cached) {
      return cached;
    }

    const discovery = (async () => {
      const uris = new Map<string, string[]>();
      try {
        const {tools} = await client.listTools();
        for (const tool of tools ?? []) {
          const declared = readUiResourceUris(tool);
          if (declared.length > 0) {
            uris.set(tool.name, declared);
          }
        }
      } catch (err) {
        console.warn('Could not query MCP tool UI resources:', err);
      }
      return uris;
    })();
    declaredUiResourceUris.set(client, discovery);
    return discovery;
  }

  return createFunctionImplementation(CallMcpToolApi, async (args, context) => {
    const toolName = context.resolveDynamicValue<string>(args.name);

    try {
      const resolvedArguments = resolveDynamicRecord(args.arguments ?? {}, context);

      const client = await getMcpClientForTool(toolName);
      if (!client) {
        throw new Error(`MCP client for tool '${toolName}' could not be resolved.`);
      }
      const result: CallToolResult = await client.request(
        {method: 'tools/call', params: {name: toolName, arguments: resolvedArguments}},
        CallToolResultSchema,
        {onprogress: () => {}, resetTimeoutOnProgress: true},
      );

      if (!result) {
        throw new Error(`MCP tool '${toolName}' did not return a result.`);
      }
      if (result.isError) {
        throw new Error(`MCP tool '${toolName}' execution failed: ${JSON.stringify(result)}`);
      }

      const named = readUiResourceUris(result);
      const uris =
        named.length > 0 ? named : ((await getDeclaredUiResourceUris(client)).get(toolName) ?? []);
      for (const uri of uris) {
        const resourceMessages = await readA2uiResource(client, uri);
        if (!createsExistingSurface(resourceMessages, processor)) {
          processor.processMessages(resourceMessages);
        }
      }

      const messages = extractA2uiMessages(result.content);
      if (messages.length > 0) {
        processor.processMessages(messages);
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

/** Extracts `_meta.ui.resourceUri` strings from a tool result or descriptor. */
export function readUiResourceUris(source: {_meta?: unknown} | undefined): string[] {
  const declared = (source?._meta as any)?.ui?.resourceUri;
  const uris = Array.isArray(declared) ? declared : [declared];
  return [...new Set(uris.filter((uri): uri is string => typeof uri === 'string' && uri !== ''))];
}

/** Extracts inline A2UI messages from `CallToolResult.content` resource blocks. */
export function extractA2uiMessages(content: CallToolResult['content'] | undefined): A2uiMessage[] {
  const messages: A2uiMessage[] = [];
  for (const item of content ?? []) {
    const block = item as {
      type?: string;
      resource?: {uri?: string; mimeType?: string; text?: unknown};
    };
    if (block?.type !== 'resource' || block.resource?.mimeType !== A2UI_MIME_TYPE) {
      continue;
    }

    const {text, uri} = block.resource;
    if (typeof text !== 'string') {
      continue;
    }

    let parsed: A2uiMessage | A2uiMessage[];
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Resource ${uri} declares ${A2UI_MIME_TYPE} but does not hold valid JSON.`);
    }
    messages.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  return messages;
}

/** Decodes A2UI messages from a `resources/read` response. */
export function parseA2uiMessages(
  resource: ReadResourceResult | undefined,
  uri: string,
): A2uiMessage[] {
  const texts = (resource?.contents ?? [])
    .filter(content => content.mimeType === A2UI_MIME_TYPE)
    .map(content => (content as {text?: unknown}).text)
    .filter((text): text is string => typeof text === 'string');
  return texts.flatMap(text => {
    let parsed: A2uiMessage | A2uiMessage[];
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Resource ${uri} declares ${A2UI_MIME_TYPE} but does not hold valid JSON.`);
    }
    return Array.isArray(parsed) ? parsed : [parsed];
  });
}

function createsExistingSurface(
  messages: A2uiMessage[],
  processor: MessageProcessor<any>,
): boolean {
  return messages.some(message => {
    if (!message || !('createSurface' in message)) {
      return false;
    }
    const surfaceId = (message as CreateSurfaceMessage).createSurface?.surfaceId;
    return !!surfaceId && !!processor.model.getSurface(surfaceId);
  });
}
