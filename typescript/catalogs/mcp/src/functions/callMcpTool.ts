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
 * const processor = new MessageProcessor([mcpCatalog]);
 * configureMcpCatalog({getMcpClientForTool, processor});
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
  type DataContext,
  type FunctionImplementation,
  type MessageProcessor,
} from '@a2ui/web_core/v0_9';
import type {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import type {CallToolResult, ReadResourceResult} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';

import {resolveDynamicRecord} from '../dynamic-values.js';
import {DEFAULT_MESSAGE_VERSION, getMcpCatalogConfig} from '../mcp_catalog_config.js';

/** MIME type identifying an A2UI payload in an MCP resource. */
export const A2UI_MIME_TYPE = 'application/a2ui+json';

/** MIME type identifying an MCP App HTML bundle (`ui://`) resource. */
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

/**
 * Resolved MCP App resource (`text/html;profile=mcp-app`) together with its `_meta.ui` security
 * metadata and the originating tool's input and result.
 */
export interface McpAppResourcePayload {
  readonly resourceUri: string;
  readonly html: string;
  readonly csp?: {
    readonly connectDomains?: readonly string[];
    readonly resourceDomains?: readonly string[];
    readonly frameDomains?: readonly string[];
    readonly baseUriDomains?: readonly string[];
  };
  readonly permissions?: {
    readonly camera?: Record<string, unknown>;
    readonly microphone?: Record<string, unknown>;
    readonly geolocation?: Record<string, unknown>;
    readonly clipboardWrite?: Record<string, unknown>;
  };
  readonly toolInput?: Record<string, unknown>;
  readonly toolResult?: Record<string, unknown>;
}

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
    targetDataPath: DynamicStringSchema.optional().describe(
      'Optional JSON Pointer path on the surface data model where a resolved MCP App resource payload is written.',
    ),
  }),
  description: 'Invokes a tool on a connected Model Context Protocol (MCP) server.',
};

/** Options of `createCallMcpToolImplementation`. */
export interface CallMcpToolOptions {
  /** Resolves the connected MCP client for a tool name. */
  readonly getMcpClientForTool?: McpClientResolver;
  /** Message processor that receives A2UI messages decoded from tool results. */
  readonly processor?: MessageProcessor<any>;
  /**
   * The A2UI protocol version given to decoded messages that carry no `version`, such as the
   * payloads of MCP catalog servers that predate the field. Defaults to `'v1.0'`.
   */
  readonly defaultVersion?: string;
  /**
   * Optional callback invoked whenever a tool call resolves an MCP App (`text/html;profile=mcp-app`)
   * resource.
   */
  readonly onMcpAppResource?: (payload: McpAppResourcePayload, context: DataContext) => void;
}

interface DecodedUiResource {
  readonly a2uiMessages: A2uiMessage[];
  readonly mcpAppResources: Array<Omit<McpAppResourcePayload, 'toolInput' | 'toolResult'>>;
}

/**
 * Creates a `callMcpTool` function implementation bound to a configuration getter.
 *
 * The getter is read on every invocation, so the host can configure (or reconfigure) the MCP
 * client resolver and message processor after the catalog is registered. The implementation
 * invokes the named MCP tool, processes any referenced or inline `application/a2ui+json`
 * resources through the configured processor, and returns the raw `CallToolResult`.
 *
 * @param getOptions Returns the current options; see `CallMcpToolOptions`.
 */
export function createCallMcpToolImplementation(
  getOptions: () => CallMcpToolOptions,
): FunctionImplementation {
  /** Cache of decoded UI resources keyed by resource URI. */
  const decodedByResourceUri = new Map<string, DecodedUiResource>();

  /** Cache of tool-declared UI resource URIs per MCP client. */
  const declaredUiResourceUris = new WeakMap<McpToolClient, Promise<Map<string, string[]>>>();

  async function readUiResource(client: McpToolClient, uri: string): Promise<DecodedUiResource> {
    let decoded = decodedByResourceUri.get(uri);
    if (!decoded) {
      const resource = await client.readResource({uri});
      decoded = {
        a2uiMessages: parseA2uiMessages(resource, uri),
        mcpAppResources: parseMcpAppResources(resource, uri),
      };
      if (decodedByResourceUri.size >= MAX_CACHED_RESOURCES) {
        const oldestUri = decodedByResourceUri.keys().next().value;
        if (oldestUri !== undefined) {
          decodedByResourceUri.delete(oldestUri);
        }
      }
      decodedByResourceUri.set(uri, decoded);
    }
    return decoded;
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
    const targetDataPath =
      args.targetDataPath !== undefined
        ? context.resolveDynamicValue<string>(args.targetDataPath)
        : undefined;
    const {
      getMcpClientForTool,
      processor,
      defaultVersion = DEFAULT_MESSAGE_VERSION,
      onMcpAppResource,
    } = getOptions();
    if (!getMcpClientForTool || !processor) {
      throw new A2uiExpressionError(
        `Cannot execute MCP tool '${toolName}': callMcpTool is not configured. Call configureMcpCatalog({getMcpClientForTool, processor}) first.`,
        'callMcpTool',
      );
    }
    const withVersion = (message: A2uiMessage) => ensureMessageVersion(message, defaultVersion);

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

      const emitMcpAppResource = (
        base: Omit<McpAppResourcePayload, 'toolInput' | 'toolResult'>,
      ) => {
        const payload: McpAppResourcePayload = {
          ...base,
          toolInput: resolvedArguments,
          toolResult: result as unknown as Record<string, unknown>,
        };
        if (targetDataPath) {
          context.set(targetDataPath, payload);
        }
        onMcpAppResource?.(payload, context);
      };

      // Prefer resource URIs from the tool result, falling back to tool-declared URIs.
      const named = readUiResourceUris(result);
      const resourceLinkUris = extractMcpAppResourceLinkUris(result.content);
      const baseUris =
        named.length > 0 ? named : ((await getDeclaredUiResourceUris(client)).get(toolName) ?? []);
      const uris = [...new Set([...baseUris, ...resourceLinkUris])];
      for (const uri of uris) {
        const {a2uiMessages, mcpAppResources} = await readUiResource(client, uri);
        // Skip recreating surfaces that already exist to avoid throwing A2uiStateError.
        if (a2uiMessages.length > 0 && !createsExistingSurface(a2uiMessages, processor)) {
          processor.processMessages(a2uiMessages.map(withVersion));
        }
        for (const appResource of mcpAppResources) {
          emitMcpAppResource(appResource);
        }
      }

      const messages = extractA2uiMessages(result.content);
      if (messages.length > 0) {
        processor.processMessages(messages.map(withVersion));
      }
      for (const inlineAppResource of extractInlineMcpAppResources(result.content)) {
        emitMcpAppResource(inlineAppResource);
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

function isMcpAppMimeType(mimeType: unknown): boolean {
  return typeof mimeType === 'string' && mimeType.toLowerCase().startsWith(MCP_APP_MIME_TYPE);
}

function isUiSchemeUri(uri: unknown): uri is string {
  return typeof uri === 'string' && uri.startsWith('ui://');
}

function decodeBase64Utf8(blob: string): string {
  const binary = atob(blob);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function readResourceItemHtml(item: {text?: unknown; blob?: unknown}): string | undefined {
  if (typeof item.text === 'string') {
    return item.text;
  }
  if (typeof item.blob === 'string') {
    return decodeBase64Utf8(item.blob);
  }
  return undefined;
}

/**
 * Extracts `resource_link` URIs from `CallToolResult.content` blocks that reference
 * an MCP App (`text/html;profile=mcp-app` or `ui://` URI).
 */
export function extractMcpAppResourceLinkUris(
  content: CallToolResult['content'] | undefined,
): string[] {
  const uris: string[] = [];
  for (const item of content ?? []) {
    const block = item as {type?: string; uri?: unknown; mimeType?: unknown};
    if (block?.type !== 'resource_link' || typeof block.uri !== 'string' || block.uri === '') {
      continue;
    }
    if (block.mimeType === A2UI_MIME_TYPE) {
      continue;
    }
    if (isMcpAppMimeType(block.mimeType) || isUiSchemeUri(block.uri)) {
      uris.push(block.uri);
    }
  }
  return [...new Set(uris)];
}

/**
 * Extracts inline MCP App HTML resources from `CallToolResult.content` blocks.
 */
export function extractInlineMcpAppResources(
  content: CallToolResult['content'] | undefined,
): Array<Omit<McpAppResourcePayload, 'toolInput' | 'toolResult'>> {
  const resources: Array<Omit<McpAppResourcePayload, 'toolInput' | 'toolResult'>> = [];
  for (const item of content ?? []) {
    const block = item as {
      type?: string;
      _meta?: unknown;
      resource?: {
        uri?: string;
        mimeType?: string;
        text?: unknown;
        blob?: unknown;
        _meta?: unknown;
      };
    };
    if (block?.type !== 'resource' || !block.resource) {
      continue;
    }
    const {uri, mimeType} = block.resource;
    if (mimeType === A2UI_MIME_TYPE) {
      continue;
    }
    if (!isMcpAppMimeType(mimeType) && !isUiSchemeUri(uri)) {
      continue;
    }
    const html = readResourceItemHtml(block.resource);
    if (html === undefined) {
      continue;
    }
    const uiMeta =
      ((block.resource._meta as Record<string, unknown> | undefined)?.['ui'] as
        | Record<string, unknown>
        | undefined) ??
      ((block._meta as Record<string, unknown> | undefined)?.['ui'] as
        | Record<string, unknown>
        | undefined);
    resources.push({
      resourceUri: typeof uri === 'string' && uri !== '' ? uri : 'ui://inline',
      html,
      ...(uiMeta?.['csp'] && typeof uiMeta['csp'] === 'object' && !Array.isArray(uiMeta['csp'])
        ? {csp: uiMeta['csp'] as Record<string, unknown>}
        : {}),
      ...(uiMeta?.['permissions'] &&
      typeof uiMeta['permissions'] === 'object' &&
      !Array.isArray(uiMeta['permissions'])
        ? {permissions: uiMeta['permissions'] as Record<string, unknown>}
        : {}),
    });
  }
  return resources;
}

/**
 * Parses MCP App HTML resources from a `resources/read` response for all content
 * blocks matching `text/html;profile=mcp-app` (or a `ui://` URI with HTML content).
 */
export function parseMcpAppResources(
  resource: ReadResourceResult | undefined,
  uri: string,
): Array<Omit<McpAppResourcePayload, 'toolInput' | 'toolResult'>> {
  const results: Array<Omit<McpAppResourcePayload, 'toolInput' | 'toolResult'>> = [];
  const topLevelUiMeta = (resource?._meta as Record<string, unknown> | undefined)?.['ui'] as
    | Record<string, unknown>
    | undefined;
  for (const item of resource?.contents ?? []) {
    const content = item as {
      uri?: string;
      mimeType?: string;
      text?: unknown;
      blob?: unknown;
      _meta?: unknown;
    };
    if (content.mimeType === A2UI_MIME_TYPE) {
      continue;
    }
    const resolvedUri = typeof content.uri === 'string' && content.uri !== '' ? content.uri : uri;
    if (!isMcpAppMimeType(content.mimeType) && !isUiSchemeUri(resolvedUri)) {
      continue;
    }
    const html = readResourceItemHtml(content);
    if (html === undefined) {
      continue;
    }
    const itemUiMeta =
      ((content._meta as Record<string, unknown> | undefined)?.['ui'] as
        | Record<string, unknown>
        | undefined) ?? topLevelUiMeta;
    results.push({
      resourceUri: resolvedUri,
      html,
      ...(itemUiMeta?.['csp'] &&
      typeof itemUiMeta['csp'] === 'object' &&
      !Array.isArray(itemUiMeta['csp'])
        ? {csp: itemUiMeta['csp'] as Record<string, unknown>}
        : {}),
      ...(itemUiMeta?.['permissions'] &&
      typeof itemUiMeta['permissions'] === 'object' &&
      !Array.isArray(itemUiMeta['permissions'])
        ? {permissions: itemUiMeta['permissions'] as Record<string, unknown>}
        : {}),
    });
  }
  return results;
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

/**
 * Ensures an A2UI message carries a version identifier before processing, defaulting to
 * `defaultVersion` when not explicitly provided.
 */
export function ensureMessageVersion(
  message: A2uiMessage,
  defaultVersion = DEFAULT_MESSAGE_VERSION,
): A2uiMessage {
  if (
    typeof message === 'object' &&
    message !== null &&
    (!('version' in message) || (message as unknown as Record<string, unknown>).version == null)
  ) {
    return {
      ...(message as unknown as Record<string, unknown>),
      version: defaultVersion,
    } as A2uiMessage;
  }
  return message;
}

/**
 * The `callMcpTool` function of the MCP catalog, bound to the host configuration set with
 * `configureMcpCatalog`. It fails until the host provides `getMcpClientForTool` and `processor`.
 */
export const CallMcpToolImplementation: FunctionImplementation =
  createCallMcpToolImplementation(getMcpCatalogConfig);
