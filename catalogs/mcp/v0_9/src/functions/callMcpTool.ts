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
 * MIME type identifying an A2UI message payload.
 *
 * Standardized in `specification/v0_9_1/docs/evolution_guide.md`, replacing the
 * legacy `application/json+a2ui`.
 */
export const A2UI_MIME_TYPE = 'application/a2ui+json';

/**
 * The slice of the MCP `Client` this catalog uses.
 *
 * Derived from the SDK's own `Client`, so the signatures cannot drift, but
 * structural rather than nominal: a wrapper that adds retries or logging, a
 * proxy, or a test double all satisfy it, and so does a `Client` from a second
 * copy of the SDK.
 */
export type McpToolClient = Pick<Client, 'request' | 'readResource' | 'listTools'>;

/**
 * Resolves the connected MCP client that serves a named tool.
 *
 * A2UI payloads address tools by name only, so multi-server routing lives here
 * and nowhere else. The catalog resolves once per invocation and uses that one
 * client for the tool call, the template read, and tool discovery, which is
 * what keeps resource URIs meaningful: they are scoped to the connection that
 * advertised them.
 */
export type McpClientResolver = (toolName: string) => McpToolClient | Promise<McpToolClient>;

/**
 * Creates the `callMcpTool` function implementation.
 *
 * On each invocation it:
 *
 * 1. Resolves the client via `getMcpClientForTool` and issues `tools/call`.
 * 2. Fetches the presentation template the result names, through
 *    `result._meta.ui.resourceUri` or the tool's `tools/list` declaration.
 *    Templates are fetched once per URI and skipped if their surface exists.
 * 3. Applies A2UI messages embedded in the result content.
 *
 * @param getMcpClientForTool Resolves the MCP client that serves a named tool.
 * @param processor Receives the A2UI messages derived from tool results.
 */
export function createCallMcpToolImplementation(
  getMcpClientForTool: McpClientResolver,
  processor: MessageProcessor<any>,
): FunctionImplementation {
  /**
   * Parsed A2UI templates, keyed by the MCP resource URI they were read from.
   *
   * A resource is immutable for a given URI, so this is read through once.
   */
  const templatesByUri = new Map<string, A2uiMessage[]>();

  /**
   * Per client, the UI resource URI each of its tools declares in `tools/list`.
   *
   * Separate from the URI a single result carries in its own `_meta`: this one
   * is announced up front by the tool, so it is discovered once per connection.
   */
  const declaredUiResourceUris = new WeakMap<McpToolClient, Promise<Map<string, string>>>();

  async function getTemplate(client: McpToolClient, uri: string): Promise<A2uiMessage[]> {
    let parsed = templatesByUri.get(uri);
    if (!parsed) {
      parsed = parseA2uiTemplate(await client.readResource({uri}), uri);
      templatesByUri.set(uri, parsed);
    }
    return parsed;
  }

  /**
   * Maps tool name to declared UI resource URI for one client, via `tools/list`.
   *
   * Runs once per client, and is best-effort: a server that cannot list tools
   * simply offers no declaration-based fallback, and results carrying their own
   * `_meta` still work.
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
        {
          // Hosts may interpose long-running or user-interactive steps before
          // the result arrives. Opting in here lets a host heartbeat keep the
          // request alive past the default timeout.
          onprogress: () => {},
          resetTimeoutOnProgress: true,
        },
      );

      if (!result) {
        throw new Error(`MCP tool '${toolName}' did not return a result.`);
      }
      if (result.isError) {
        throw new Error(`MCP tool '${toolName}' execution failed: ${JSON.stringify(result)}`);
      }

      // Apply the A2UI template this result points at, if any.
      const uri =
        readUiResourceUri(result) ?? (await getDeclaredUiResourceUris(client)).get(toolName);
      if (uri) {
        const messages = await getTemplate(client, uri);
        // Re-processing createSurface for a live surface throws A2uiStateError,
        // so repeat calls reuse the surface and only apply new data.
        const created = messages.find(
          (message): message is CreateSurfaceMessage => !!message && 'createSurface' in message,
        );
        const surfaceId = created?.createSurface?.surfaceId;
        if (!surfaceId || !processor.model.getSurface(surfaceId)) {
          processor.processMessages(messages);
        }
      }

      // Apply the A2UI messages carried in the result itself.
      const dataMessages = extractA2uiMessages(result.content);
      if (dataMessages) {
        processor.processMessages(dataMessages);
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

/** Anything carrying MCP `_meta`: a `CallToolResult`, or a tool descriptor. */
export interface WithMcpMeta {
  _meta?: unknown;
}

/**
 * Reads the A2UI presentation template URI out of MCP `_meta`.
 *
 * `_meta.ui.resourceUri` is an MCP transport convention, not part of the A2UI
 * specification, which is why it is read defensively.
 */
export function readUiResourceUri(source: WithMcpMeta | undefined): string | undefined {
  const uri = (source?._meta as any)?.ui?.resourceUri;
  return typeof uri === 'string' ? uri : undefined;
}

/**
 * Extracts A2UI messages embedded in `CallToolResult.content`.
 *
 * Two encodings are recognized, in content order:
 * - an embedded resource whose text is a JSON A2UI message list;
 * - a text block whose JSON parses to a message list or a single message.
 *
 * Returns `null` when no block decodes to A2UI messages, which is the normal
 * case for tools that only return prose.
 */
export function extractA2uiMessages(
  content: CallToolResult['content'] | undefined,
): A2uiMessage[] | null {
  for (const item of content ?? []) {
    const isResource = item?.type === 'resource';
    if (!isResource && item?.type !== 'text') {
      continue;
    }

    const text = isResource ? (item as any).resource?.text : (item as any).text;
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
    // An embedded resource declares itself to be A2UI. A text block is shared
    // with ordinary tool data, so a bare scalar or unrelated object is skipped.
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
export function parseA2uiTemplate(
  resource: ReadResourceResult | undefined,
  uri: string,
): A2uiMessage[] {
  const a2uiContent = resource?.contents?.find((c: any) => c.mimeType === A2UI_MIME_TYPE);

  if (!a2uiContent || typeof (a2uiContent as any).text !== 'string') {
    throw new Error(`Resource ${uri} does not contain valid A2UI JSON template data.`);
  }

  return JSON.parse((a2uiContent as any).text) as A2uiMessage[];
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
