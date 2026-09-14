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
 * `callMcpTool`: the A2UI catalog function that calls a Model Context Protocol
 * tool and renders the A2UI messages the tool returns.
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
 * The host supplies one hook, `getMcpClientForTool`. This module calls the
 * tool, reads the UI resource, and decodes the messages.
 *
 * ## Where the messages come from
 *
 * A tool delivers A2UI messages by three routes, and one result may use
 * several of them:
 *
 * 1. A resource the result names. `result._meta.ui.resourceUri` holds a
 *    resource URI, whose `application/a2ui+json` content block decodes to an
 *    A2UI message list.
 * 2. A resource the tool declares. A tool descriptor in `tools/list` carries
 *    the same `_meta.ui.resourceUri`, covering every call of that tool.
 * 3. Messages inside `result.content`, in either an embedded resource block or
 *    a text block whose JSON decodes to an A2UI message or a list of messages.
 *
 * A result that doesn't return A2UI, plain prose for example, renders nothing.
 * Every successful call returns the raw `CallToolResult` to the caller.
 *
 * ## Failures
 *
 * Every failure raises an `A2uiExpressionError` naming the tool: no client for
 * the tool, a transport error, a result flagged `isError`, or a resource that
 * does not decode.
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
 * @param getMcpClientForTool Supplies the client to call a given tool on.
 * @param processor Receives the A2UI messages decoded from tool results.
 */
export function createCallMcpToolImplementation(
  getMcpClientForTool: McpClientResolver,
  processor: MessageProcessor<any>,
): FunctionImplementation {
  /** Messages already decoded, keyed by resource URI. A resource never changes. */
  const a2uiMessagesByResourceUri = new Map<string, A2uiMessage[]>();

  /** Declared URIs by tool name, discovered once per client. */
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
   * Returns the UI resource URI each tool declares, reading `tools/list` once
   * per client.
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
        // Progress notifications reset the request timeout, so a server can
        // hold a slow or interactive tool call open past the default.
        {onprogress: () => {}, resetTimeoutOnProgress: true},
      );

      if (!result) {
        throw new Error(`MCP tool '${toolName}' did not return a result.`);
      }
      if (result.isError) {
        throw new Error(`MCP tool '${toolName}' execution failed: ${JSON.stringify(result)}`);
      }

      // The URI the result names, falling back to the one the tool declares.
      const uri =
        readUiResourceUri(result) ?? (await getDeclaredUiResourceUris(client)).get(toolName);
      if (uri) {
        const resourceMessages = await readA2uiResource(client, uri);
        // Creating a surface twice throws A2uiStateError. On a repeat call,
        // keep the live surface and apply only the inline messages below.
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
 * Reads `_meta.ui.resourceUri` from a tool result or a tool descriptor.
 *
 * The field is a transport convention rather than a specified A2UI field, so
 * this checks each hop and returns `undefined` for anything else.
 */
export function readUiResourceUri(source: {_meta?: unknown} | undefined): string | undefined {
  const uri = (source?._meta as any)?.ui?.resourceUri;
  return typeof uri === 'string' ? uri : undefined;
}

/**
 * Returns the first block of `CallToolResult.content` that decodes to A2UI
 * messages, or `null` when no block does, as with a tool that returns prose.
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
    // An embedded resource is A2UI by declaration. A text block shares space
    // with ordinary tool data, so skip anything without a message key.
    if (isResource || isA2uiMessage(parsed)) {
      return [parsed as A2uiMessage];
    }
  }
  return null;
}

/**
 * Decodes an A2UI message list from a `resources/read` response.
 *
 * @throws when no content block declares the A2UI MIME type.
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

/** The keys `MessageProcessor` dispatches on. */
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
