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

import {MessageProcessor} from '@a2ui/web_core/v0_9';
import {basicCatalog} from '@a2ui/lit/v0_9';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';

export const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json';
export const A2UI_MIME_TYPE = 'application/a2ui+json';

export const MCP_CALL_TOOL_ACTION = 'callMcpTool';

/**
 * Default client name sent in `clientInfo` during the MCP initialization handshake.
 *
 * In the Model Context Protocol, `clientInfo` is an informational identifier (similar
 * to an HTTP User-Agent string) primarily used by servers for logging, metrics, and debugging.
 */
export const DEFAULT_MCP_CLIENT_NAME = 'a2ui-mcp-engine';
export const DEFAULT_MCP_CLIENT_VERSION = '1.0.0';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface A2uiMcpEngineEvents {
  onAction?: (action: any) => Promise<void> | void;
  onStatusChange?: (message: string) => void;
  onConnectionChange?: (status: ConnectionStatus) => void;
  onSurfaceChange?: () => void;
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

  private readonly events: A2uiMcpEngineEvents;

  constructor(catalogs: any[] = [basicCatalog], events: A2uiMcpEngineEvents = {}) {
    this.events = events || {};
    this.processor = new MessageProcessor(catalogs || [basicCatalog], action =>
      this.events.onAction?.(action),
    );
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
              clientCapabilities: {
                'v0.9': {
                  supportedCatalogIds: [BASIC_CATALOG_ID],
                },
              },
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
   * Handles MCP tool invocation from an A2UI action context.
   * Extracts server/tool routing metadata and dispatches execution.
   */
  async handleMcpCallTool(context: Record<string, any> = {}) {
    const ctx = context || {};
    const targetServer: string | undefined = ctx.server;
    const targetTool: string | undefined = ctx.tool;

    if (!targetServer) {
      console.error(`'${MCP_CALL_TOOL_ACTION}' action missing required 'server' in context:`, ctx);
      return;
    }

    if (!targetTool) {
      console.error(`'${MCP_CALL_TOOL_ACTION}' action missing required 'tool' in context:`, ctx);
      return;
    }

    // Filter out routing metadata keys from tool arguments
    const toolArgs: Record<string, any> = {};
    for (const [key, value] of Object.entries(ctx)) {
      if (key !== 'server' && key !== 'tool') {
        toolArgs[key] = value;
      }
    }

    await this.executeTool(targetServer, targetTool, toolArgs);
  }

  /**
   * Generic executor for any MCP tool returning A2UI presentation templates or data updates.
   * Routes strictly to the specified targetServer.
   */
  async executeTool(targetServer: string, toolName: string, args: Record<string, any> = {}) {
    const toolArgs = args || {};
    const client = this.mcpClients.get(targetServer);

    if (!client) {
      console.error(`No MCP client available for server '${targetServer}' (tool '${toolName}')`);
      this.events.onStatusChange?.(`Failed: No connected server '${targetServer}' for ${toolName}`);
      return;
    }

    this.events.onStatusChange?.(`Executing ${toolName} on [${targetServer}]...`);

    try {
      // 1. Call MCP Tool on targeted client
      const result = await client.callTool({
        name: toolName,
        arguments: toolArgs,
      });

      // 2. Discover UI template resource URI from tool response _meta or cached tool definitions
      const resourceUri =
        (result as any)._meta?.ui?.resourceUri ||
        this.toolUiResources.get(`${targetServer}:${toolName}`) ||
        this.toolUiResources.get(toolName);

      // 3. Fetch presentation template if not cached and apply if surface does not exist yet
      if (resourceUri) {
        const template = await this.getOrFetchTemplate(client, resourceUri);
        const surfaceId = template.find((m: any) => m.createSurface)?.createSurface?.surfaceId;
        if (!surfaceId || !this.processor.model.getSurface(surfaceId)) {
          this.processor.processMessages(template);
        }
      }

      // 4. Extract and apply A2UI data updates from tool content
      const dataMessages = this.extractA2uiMessages(result.content as any[]);
      if (dataMessages) {
        this.processor.processMessages(dataMessages);
      }

      // 5. Notify listeners that surface state has updated
      this.events.onSurfaceChange?.();
      this.events.onStatusChange?.(`${toolName} on [${targetServer}] completed successfully!`);
    } catch (error: any) {
      console.error(`Error executing ${toolName} on [${targetServer}]:`, error);
      this.events.onStatusChange?.(`Execution failed: ${error.message || error}`);
    }
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
