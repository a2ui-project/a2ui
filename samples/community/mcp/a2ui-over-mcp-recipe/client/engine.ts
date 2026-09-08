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

import {Catalog, MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/lit/v0_9';
import {
  type McpClientGetter,
  type McpToolResultHandler,
} from '../../../../../catalogs/mcp/v0_9/src/catalog.js';
import {createCallMcpToolImplementation} from '../../../../../catalogs/mcp/v0_9/src/functions/callMcpTool.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';

export {type McpClientGetter, type McpToolResultHandler, type CallToolResult};
export const BASIC_WITH_MCP_CATALOG_ID =
  'https://a2ui.org/specification/v0_9/catalogs/basic_with_mcp/catalog.json';
export const A2UI_MIME_TYPE = 'application/a2ui+json';

/**
 * Default client name sent in `clientInfo` during the MCP initialization handshake.
 *
 * In the Model Context Protocol, `clientInfo` is an informational identifier (similar
 * to an HTTP User-Agent string) primarily used by servers for logging, metrics, and debugging.
 */
export const DEFAULT_MCP_CLIENT_NAME = 'a2ui-mcp-engine';
export const DEFAULT_MCP_CLIENT_VERSION = '1.0.0';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Creates an A2UI Catalog combining the standard Basic Catalog components and functions
 * with MCP tool execution (`callMcpTool`).
 *
 * @param clientGetter A getter function returning a Client for an optional server name.
 * @param onResult Optional hook called with the tool result and active client upon successful execution.
 */
export function createBasicWithMcpCatalog(
  clientGetter: McpClientGetter,
  onResult?: McpToolResultHandler,
): Catalog<any> {
  const mcpFn = createCallMcpToolImplementation(clientGetter, onResult);
  const allComponents = Array.from(basicCatalog.components.values());
  const allFunctions = [...Array.from(basicCatalog.functions.values()), mcpFn as any];
  return new Catalog<any>(BASIC_WITH_MCP_CATALOG_ID, allComponents, allFunctions);
}

/**
 * Generic A2UI-over-MCP host runtime engine.
 * Handles MCP connections, tool discovery with UI metadata, template fetching/caching,
 * and two-way surface data synchronization.
 */
export class A2uiMcpEngine {
  // Unified A2UI MessageProcessor managing all active surfaces
  readonly processor: MessageProcessor<any>;

  // Multi-server registry: connected MCP clients keyed by server name
  readonly mcpClients = new Map<string, Client>();

  // Cache for loaded presentation templates keyed by resource URI
  private readonly templateCache = new Map<string, any[]>();

  // Mapping of tool names (server:tool or tool) to declared UI template resource URIs
  private readonly toolUiResources = new Map<string, string>();

  getMcpClient(server?: string): Client {
    if (server) {
      const client = this.mcpClients.get(server);
      if (client) {
        return client;
      }
      throw new Error(`No MCP client connected for server '${server}'`);
    }
    for (const client of this.mcpClients.values()) {
      return client;
    }
    throw new Error('No MCP client connected');
  }

  constructor(
    private readonly events: {
      onAction?: (action: any) => Promise<void> | void;
      onStatusChange?: (message: string) => void;
      onConnectionChange?: (status: ConnectionStatus) => void;
      onSurfaceChange?: () => void;
    } = {},
  ) {
    const clientGetter: McpClientGetter = (server?: string) => this.getMcpClient(server);
    const onResult: McpToolResultHandler = (result, client, name, server) =>
      this.handleToolResult(result, client, name, server);
    const basicWithMcpCatalog = createBasicWithMcpCatalog(clientGetter, onResult);

    this.processor = new MessageProcessor<any>([basicWithMcpCatalog], action =>
      this.events.onAction?.(action),
    );

    // Forward surface errors to console and event listeners so errors are never silently swallowed
    this.processor.onSurfaceCreated(surface => {
      surface.onError.subscribe(err => {
        console.error(`[A2UI Error on surface '${surface.id}']`, err);
        this.events.onStatusChange?.(`Surface error on ${surface.id}: ${err.message || err.code}`);
      });
    });
  }

  /**
   * Retrieves an active A2UI surface model by its ID.
   */
  getSurface(surfaceId: string) {
    return this.processor.model.getSurface(surfaceId);
  }

  /**
   * Connects to an MCP server via SSE transport, discovers tools with A2UI metadata,
   * and registers the client.
   *
   * @param sseUrl The SSE endpoint URL of the MCP server.
   * @param clientName Optional custom client name to send during handshake (defaults to DEFAULT_MCP_CLIENT_NAME).
   * @returns The registered server name.
   */
  async connectServer(
    sseUrl: string,
    clientName: string = DEFAULT_MCP_CLIENT_NAME,
  ): Promise<string> {
    this.events.onConnectionChange?.('connecting');
    this.events.onStatusChange?.(`Connecting to MCP server at ${sseUrl}...`);

    try {
      const transport = new SSEClientTransport(new URL(sseUrl));
      const client = new Client(
        {
          name: clientName,
          version: DEFAULT_MCP_CLIENT_VERSION,
        },
        {
          capabilities: {
            a2ui: {
              clientCapabilities: this.processor.getClientCapabilities(),
            },
          } as any,
        },
      );

      await client.connect(transport);
      const serverInfo = client.getServerVersion();
      if (!serverInfo?.name) {
        throw new Error(
          'Connected MCP server did not return a valid server name during initialization.',
        );
      }
      const serverName = serverInfo.name;

      this.mcpClients.set(serverName, client);
      this.events.onConnectionChange?.('connected');
      this.events.onStatusChange?.(`Connected to MCP Server [${serverName}] (${sseUrl})`);

      // Discover all tools and their declared UI templates ahead of invocation
      try {
        const toolsResult = await client.listTools();
        for (const tool of toolsResult.tools) {
          const uiUri = (tool as any)._meta?.ui?.resourceUri;
          if (uiUri) {
            this.toolUiResources.set(`${serverName}:${tool.name}`, uiUri);
            this.toolUiResources.set(tool.name, uiUri);
          }
        }
      } catch (err) {
        console.warn('Could not query tool UI resources:', err);
      }

      return serverName;
    } catch (error: any) {
      console.error('MCP Connection Error:', error);
      this.events.onConnectionChange?.('error');
      this.events.onStatusChange?.(`Connection failed: ${error.message || error}`);
      throw error;
    }
  }

  /**
   * Processes a CallToolResult by discovering and fetching associated UI templates
   * and applying data model updates.
   */
  async handleToolResult(
    result: CallToolResult,
    client: Client,
    name: string,
    server?: string,
  ): Promise<void> {
    const resourceUri =
      (result._meta as any)?.ui?.resourceUri ||
      (server ? this.toolUiResources.get(`${server}:${name}`) : undefined) ||
      this.toolUiResources.get(name) ||
      (name.includes(':') ? this.toolUiResources.get(name.split(':')[1]) : undefined);

    if (resourceUri) {
      const template = await this.getOrFetchTemplate(client, resourceUri);

      const surfaceId = template.find((m: any) => m.createSurface)?.createSurface?.surfaceId;
      if (!surfaceId || !this.processor.model.getSurface(surfaceId)) {
        this.processor.processMessages(template);
      }
      this.events.onStatusChange?.(`UI template processed for tool '${name}'`);
    }

    const dataMessages = this.extractA2uiMessages(result.content);
    if (dataMessages) {
      this.processor.processMessages(dataMessages);
    }

    this.events.onStatusChange?.(`Processed A2UI messages for tool '${name}'`);
    this.events.onSurfaceChange?.();
  }

  private extractA2uiMessages(contentArray: any[]): any[] | null {
    for (const item of contentArray || []) {
      if (item.type === 'resource' && item.resource?.text) {
        try {
          return JSON.parse(item.resource.text);
        } catch {}
      } else if (item.type === 'text' && typeof item.text === 'string') {
        try {
          const parsed = JSON.parse(item.text);
          if (Array.isArray(parsed) || parsed.updateDataModel) {
            return Array.isArray(parsed) ? parsed : [parsed];
          }
        } catch {}
      }
    }
    return null;
  }

  private async getOrFetchTemplate(client: Client, uri: string): Promise<any[]> {
    if (this.templateCache.has(uri)) {
      return this.templateCache.get(uri)!;
    }

    this.events.onStatusChange?.(`Fetching UI template (${uri})...`);
    const resourceResult = await client.readResource({uri});
    const a2uiContent = resourceResult.contents.find((c: any) => c.mimeType === A2UI_MIME_TYPE);

    if (!a2uiContent || !('text' in a2uiContent)) {
      throw new Error(`Resource ${uri} does not contain valid A2UI JSON template data.`);
    }

    const template = JSON.parse(a2uiContent.text);
    this.templateCache.set(uri, template);
    return template;
  }
}
