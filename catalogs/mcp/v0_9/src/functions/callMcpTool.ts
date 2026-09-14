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
 * `callMcpTool`: the A2UI catalog function that invokes Model Context Protocol
 * tools and renders whatever UI they return.
 *
 * ## Wiring
 *
 * ```ts
 * const catalogs: Catalog<any>[] = [];
 * const processor = new MessageProcessor(catalogs);
 * const callMcpTool = createCallMcpToolImplementation(getMcpClientForTool, processor);
 * catalogs.push(new Catalog(MCP_CATALOG_ID, [], [callMcpTool]));
 * ```
 *
 * The host supplies one hook, `getMcpClientForTool`. The tool call, the UI
 * resource read, and message decoding all happen here.
 *
 * ## What a server can return
 *
 * A tool result reaches the screen in one of three ways. A single result may
 * combine them: a resource creates the surface, then inline messages fill it
 * with data.
 *
 * 1. An MCP resource the result points at. `result._meta.ui.resourceUri` names
 *    a resource, read and parsed as an `application/a2ui+json` message list.
 * 2. An MCP resource the tool points at. The same `_meta.ui.resourceUri`, set
 *    on a tool descriptor in `tools/list`, covers every call of that tool. It
 *    is discovered once per client and used when a result names no URI itself.
 * 3. A2UI messages inline in `result.content`, as either an embedded resource
 *    or a text block whose JSON decodes to a message or a list of messages.
 *
 * A result carrying none of these, plain prose for example, applies nothing.
 * Either way the raw `CallToolResult` is returned to the caller.
 *
 * A resource is read once per URI. Its message list is skipped when the surface
 * it creates already exists, so repeat calls update data rather than rebuild
 * the UI.
 *
 * Note that `_meta.ui.resourceUri` is an MCP transport convention, not part of
 * the A2UI specification. Only the MIME type is specified.
 *
 * ## Failures
 *
 * Every failure (no client for the tool, a transport error, a result flagged
 * `isError`, an undecodable resource) is raised as an `A2uiExpressionError`
 * naming the tool.
 */

import {
  createFunctionImplementation,
  type FunctionImplementation,
  type MessageProcessor,
  A2uiExpressionError,
} from '@a2ui/web_core/v0_9';
import type {A2uiMessage, CreateSurfaceMessage} from '@a2ui/web_core/v0_9';
import type {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import type {CallToolResult, ReadResourceResult} from '@modelcontextprotocol/sdk/types.js';
import {resolveDynamicRecord} from '../dynamic-values.js';
import {CallMcpToolApi} from './callMcpToolApi.js';

export {CallMcpToolApi};

/**
 * MIME type identifying an A2UI payload.
 */
export const A2UI_MIME_TYPE = 'application/a2ui+json';

/**
 * The slice of the MCP `Client` this catalog uses.
 */
export type McpToolClient = Pick<Client, 'request' | 'readResource' | 'listTools'>;

/**
 * Resolves the connected MCP client that serves a named tool.
 */
export type McpClientResolver = (toolName: string) => McpToolClient | Promise<McpToolClient>;

/**
 * Creates the `callMcpTool` function implementation.
 *
 * @param getMcpClientForTool Resolves the MCP client that serves a named tool.
 * @param processor Receives the A2UI messages derived from tool results.
 */
export function createCallMcpToolImplementation(
  getMcpClientForTool: McpClientResolver,
  processor: MessageProcessor<any>,
): FunctionImplementation {
  /** Decoded messages by resource URI. A URI's contents never change. */
  const a2uiMessagesByResourceUri = new Map<string, A2uiMessage[]>();

  /** Per client, the UI resource URI each of its tools declares in `tools/list`. */
  const declaredUiResourceUris = new WeakMap<McpToolClient, Promise<Map<string, string>>>();

  async function readA2uiResource(client: McpToolClient, uri: string): Promise<A2uiMessage[]> {
    let messages = a2uiMessagesByResourceUri.get(uri);
    if (!messages) {
      messages = parseA2uiMessages(await client.readResource({uri}), uri);
      a2uiMessagesByResourceUri.set(uri, messages);
    }
    return messages;
  }

  /**
   * Maps tool name to declared UI resource URI, once per client.
   */
  function getDeclaredUiResourceUris(client: McpToolClient): Promise<Map<string, string>> {
    let discovery = declaredUiResourceUris.get(client);
    if (!discovery) {
      discovery = (async () => {
        const uris = new Map<string, string>();
        try {
          const {tools} = await client.listTools();
          for (const tool of tools ?? []) {
            const uri = readUiResourceUri(tool);
            if (uri) {
              uris.set(tool.name, uri);
            }
          }
        } catch (err) {
          console.warn('Could not query MCP tool UI resources:', err);
        }
        return uris;
      })();
      declaredUiResourceUris.set(client, discovery);
    }
    return discovery;
  }

  return createFunctionImplementation(CallMcpToolApi, async (args, context) => {
    const toolName = context.resolveDynamicValue<string>(args.name);
    const resolvedArguments = resolveDynamicRecord(args.arguments ?? {}, context);

    try {
      const client = await getMcpClientForTool(toolName);
      const result: CallToolResult = await client.request(
        {method: 'tools/call', params: {name: toolName, arguments: resolvedArguments}},
        CallToolResultSchema,
        // Subscribing to progress lets a host heartbeat hold the request open
        // past the default timeout, for slow or interactive tools.
        {onprogress: () => {}, resetTimeoutOnProgress: true},
      );

      if (!result) {
        throw new Error(`MCP tool '${toolName}' did not return a result.`);
      }
      if (result.isError) {
        throw new Error(`MCP tool '${toolName}' execution failed: ${JSON.stringify(result)}`);
      }

      // The UI resource this result points at, or the one its tool declares.
      const uri =
        readUiResourceUri(result) ?? (await getDeclaredUiResourceUris(client)).get(toolName);
      if (uri) {
        const resourceMessages = await readA2uiResource(client, uri);
        // Re-creating a live surface throws A2uiStateError, so a repeat call
        // keeps the existing surface and applies only the data messages below.
        const created = resourceMessages.find(
          (message): message is CreateSurfaceMessage => !!message && 'createSurface' in message,
        );
        const surfaceId = created?.createSurface?.surfaceId;
        if (!surfaceId || !processor.model.getSurface(surfaceId)) {
          processor.processMessages(resourceMessages);
        }
      }

      const messages = extractA2uiMessages(result.content);
      if (messages) {
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
 * Reads `_meta.ui.resourceUri` off a tool result or a tool descriptor.
 *
 * Read defensively because this is a transport convention, not a specified
 * A2UI field.
 */
export function readUiResourceUri(source: {_meta?: unknown} | undefined): string | undefined {
  const uri = (source?._meta as any)?.ui?.resourceUri;
  return typeof uri === 'string' ? uri : undefined;
}

/**
 * Extracts A2UI messages inlined in `CallToolResult.content`, taking the first
 * block that decodes. Returns `null` for results that carry none, such as a
 * tool that only returns prose.
 */
export function extractA2uiMessages(
  content: CallToolResult['content'] | undefined,
): A2uiMessage[] | null {
  for (const item of content ?? []) {
    const block = item as any;
    const isResource = block?.type === 'resource';
    if (!isResource && block?.type !== 'text') {
      continue;
    }

    const text = isResource ? block.resource?.text : block.text;
    if (typeof text !== 'string') {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }

    if (Array.isArray(parsed)) {
      return parsed as A2uiMessage[];
    }
    // An embedded resource declares itself A2UI. A text block shares space with
    // ordinary tool data, so a scalar or unrelated object is skipped.
    if (isResource || isA2uiMessage(parsed)) {
      return [parsed as A2uiMessage];
    }
  }
  return null;
}

/**
 * Decodes an A2UI message list out of a `resources/read` response.
 *
 * @throws if no content block declares the A2UI MIME type.
 */
export function parseA2uiMessages(
  resource: ReadResourceResult | undefined,
  uri: string,
): A2uiMessage[] {
  const content = resource?.contents?.find(c => c.mimeType === A2UI_MIME_TYPE) as any;
  if (typeof content?.text !== 'string') {
    throw new Error(`Resource ${uri} does not contain valid A2UI JSON messages.`);
  }
  return JSON.parse(content.text) as A2uiMessage[];
}

const A2UI_MESSAGE_KEYS = [
  'createSurface',
  'updateComponents',
  'updateDataModel',
  'deleteSurface',
] as const;

function isA2uiMessage(value: unknown): value is A2uiMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    A2UI_MESSAGE_KEYS.some(key => key in (value as Record<string, unknown>))
  );
}
