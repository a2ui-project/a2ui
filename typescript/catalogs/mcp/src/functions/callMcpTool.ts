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
 * Implementation of the `callMcpTool` A2UI catalog function, which executes
 * Model Context Protocol (MCP) tools and processes any returned A2UI messages.
 *
 * ## Setup
 *
 * ```ts
 * const catalogs: Catalog<any>[] = [];
 * const processor = new MessageProcessor(catalogs);
 * const functions = createMcpCatalogFunctions(getMcpClientForTool, processor);
 * catalogs.push(new Catalog(MCP_CATALOG_ID, [], functions));
 * ```
 *
 * ## Supported MCP UI Responses
 *
 * `callMcpTool` extracts A2UI messages from tool responses using the following sources:
 *
 * ### 1. A UI resource the tool declares
 *
 * A descriptor in `tools/list` names the resource holding the layout that
 * every call of that tool renders:
 *
 * ```json
 * {
 *   "name": "get_recipe",
 *   "description": "Fetch a recipe",
 *   "_meta": {"ui": {"resourceUri": "a2ui://recipe-card"}}
 * }
 * ```
 *
 * This module reads the resourceUri through `resources/read` and decodes every
 * `application/a2ui+json` block of the response into messages:
 *
 * ```json
 * {
 *   "result": {
 *     "contents": [
 *       {
 *         "uri": "a2ui://path/to/resource",
 *         "mimeType": "application/a2ui+json",
 *         "text": "[{\"version\": \"v0.9\", \"updateDataModel\": {\"key\": \"value\"}}]"
 *       }
 *     ]
 *   }
 * }
 * ```
 *
 * Discovery runs once per client. Resource contents are static, so messages
 * are cached by URI, and a resource that would recreate a live surface is
 * skipped rather than processed twice.
 *
 * ### 2. A UI resource the result names
 *
 * The same `_meta.ui.resourceUri` field can be used on the tool result itself:
 *
 * ```json
 * {
 *   "content": [{"type": "text", "text": "Generated a Baked Salmon recipe."}],
 *   "_meta": {"ui": {"resourceUri": "a2ui://recipe-card"}}
 * }
 * ```
 *
 * URIs on the result replace the declared ones rather than adding to them.
 *
 * ### 3. A2UI resources inline in the result content
 *
 * An embedded resource block declaring mime type `application/a2ui+json`:
 *
 * ```json
 * {
 *   "content": [
 *     {"type": "text", "text": "Generated a Baked Salmon recipe."},
 *     {
 *       "type": "resource",
 *       "resource": {
 *         "uri": "a2ui://recipe-card/data",
 *         "mimeType": "application/a2ui+json",
 *         "text": "[{\"version\": \"v0.9\", \"updateDataModel\": {…}}]"
 *       }
 *     }
 *   ]
 * }
 * ```
 *
 * ### 4. Plain tool data
 *
 * ```json
 * {"content": [{"type": "text", "text": "Prep time is 15 minutes."}]}
 * ```
 *
 * No resource URI and no A2UI block, so nothing renders. The raw
 * `CallToolResult` is still returned, which is what the data functions of this
 * catalog read when a payload shapes tool output itself.
 *
 * ## Failures
 *
 * Every failure raises an `A2uiExpressionError` naming the tool: no client for
 * the tool, a transport error, a result flagged `isError`, or a payload that
 * declares the A2UI MIME type but holds invalid JSON. A resource that holds no
 * A2UI at all is not a failure: it contributes nothing and the call proceeds.
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

/** MIME type identifying an A2UI payload in an MCP resource. */
export const A2UI_MIME_TYPE = 'application/a2ui+json';

/** Maximum number of decoded UI resources to cache per implementation. */
const MAX_CACHED_RESOURCES = 100;

/** Subset of the MCP `Client` interface used by this catalog. */
export type McpToolClient = Pick<Client, 'request' | 'readResource' | 'listTools'>;

/**
 * Resolves the connected MCP client for a given tool name.
 *
 * May return `null` or `undefined` if no client is currently available (for example,
 * before a connection completes), which causes the tool call to fail with an error.
 */
export type McpClientResolver = (
  toolName: string,
) => McpToolClient | undefined | null | Promise<McpToolClient | undefined | null>;

/**
 * Function API definition for `callMcpTool`.
 *
 * Payloads reference tools by name; the host application is responsible for
 * routing each tool name to the appropriate MCP server client.
 */
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
 * Invokes the named MCP tool, processes any referenced or inline `application/a2ui+json`
 * resources through `processor`, and returns the raw `CallToolResult`.
 *
 * @param getMcpClientForTool Callback that resolves the MCP client for a tool name.
 * @param processor Message processor that applies decoded A2UI messages.
 */
export function createCallMcpToolImplementation(
  getMcpClientForTool: McpClientResolver,
  processor: MessageProcessor<any>,
): FunctionImplementation {
  /** Cache of decoded A2UI messages keyed by resource URI. */
  const a2uiMessagesByResourceUri = new Map<string, A2uiMessage[]>();

  /** Cache of tool-declared UI resource URIs per MCP client. */
  const declaredUiResourceUris = new WeakMap<McpToolClient, Promise<Map<string, string[]>>>();

  async function readA2uiResource(client: McpToolClient, uri: string): Promise<A2uiMessage[]> {
    let messages = a2uiMessagesByResourceUri.get(uri);
    if (!messages) {
      messages = parseA2uiMessages(await client.readResource({uri}), uri);
      if (a2uiMessagesByResourceUri.size >= MAX_CACHED_RESOURCES) {
        const oldestUri = a2uiMessagesByResourceUri.keys().next().value;
        if (oldestUri !== undefined) {
          a2uiMessagesByResourceUri.delete(oldestUri);
        }
      }
      a2uiMessagesByResourceUri.set(uri, messages);
    }
    return messages;
  }

  /** Queries `tools/list` once per client to discover UI resource URIs declared by tools. */
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
        // Reset the request timeout on progress notifications to support long-running tools.
        {onprogress: () => {}, resetTimeoutOnProgress: true},
      );

      if (!result) {
        throw new Error(`MCP tool '${toolName}' did not return a result.`);
      }
      if (result.isError) {
        throw new Error(`MCP tool '${toolName}' execution failed: ${JSON.stringify(result)}`);
      }

      // Prefer resource URIs from the tool result, falling back to tool-declared URIs.
      const named = readUiResourceUris(result);
      const uris =
        named.length > 0 ? named : ((await getDeclaredUiResourceUris(client)).get(toolName) ?? []);
      for (const uri of uris) {
        const resourceMessages = await readA2uiResource(client, uri);
        // Skip recreating surfaces that already exist to avoid throwing A2uiStateError.
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

/**
 * Extracts unique string URIs from `_meta.ui.resourceUri` on a tool descriptor or result.
 * Accepts either a single URI string or an array of URI strings.
 */
export function readUiResourceUris(source: {_meta?: unknown} | undefined): string[] {
  const declared = (source?._meta as any)?.ui?.resourceUri;
  const uris = Array.isArray(declared) ? declared : [declared];
  return [...new Set(uris.filter((uri): uri is string => typeof uri === 'string' && uri !== ''))];
}

/**
 * Extracts inline A2UI messages from `CallToolResult.content` blocks.
 *
 * Only embedded resource blocks with `mimeType: "application/a2ui+json"` are
 * parsed; plain text blocks are ignored.
 *
 * @throws Error if an A2UI resource block contains invalid JSON.
 */
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

/**
 * Parses A2UI messages from a `resources/read` response for all content blocks
 * matching `application/a2ui+json`.
 *
 * @throws Error if an A2UI content block contains invalid JSON.
 */
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

/** Checks whether any message attempts to create a surface that already exists in `processor`. */
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
