/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {McpToolClient} from '@a2ui/catalog-mcp';
import type {CallToolResult, ReadResourceResult} from '@modelcontextprotocol/sdk/types.js';

/** Default simulated network latency (in milliseconds) for MCP server operations. */
export const DEFAULT_MCP_NETWORK_LATENCY_MS = 120;

/** Descriptor of a tool registered on the client-side mock MCP server. */
export interface MockMcpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly resourceUri: string;
  readonly targetDataPath: string;
}

/** Definition of a `ui://` HTML resource hosted by the mock MCP server. */
export interface MockMcpUiResource {
  readonly uri: string;
  readonly name: string;
  readonly mimeType: 'text/html;profile=mcp-app';
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
}

/** Result of executing a tool on the mock MCP server, paired with the target surface path. */
export interface MockMcpToolExecution {
  readonly targetDataPath: string;
  readonly dataModelValue: unknown;
  readonly result: CallToolResult;
}

const TOOL_DESCRIPTORS: readonly MockMcpToolDescriptor[] = [
  {
    name: 'get_order',
    description: 'Fetches line items and unit prices for an order ID from the commerce MCP server.',
    resourceUri: 'ui://orders/summary.html',
    targetDataPath: '/order/toolResult',
  },
  {
    name: 'transpose_score',
    description: 'Transposes the active ABC sheet music score on the music MCP server.',
    resourceUri: 'ui://music/score.html',
    targetDataPath: '/music/nowPlaying',
  },
  {
    name: 'capture_3d_snapshot',
    description: 'Persists the 3D scene camera orientation and wireframe mesh preset.',
    resourceUri: 'ui://three/geometry.html',
    targetDataPath: '/scene3d/telemetry',
  },
];

/**
 * Simulates an asynchronous network round-trip to an MCP server.
 */
export function simulateMcpNetworkDelay(latencyMs = DEFAULT_MCP_NETWORK_LATENCY_MS): Promise<void> {
  if (latencyMs <= 0) {
    return Promise.resolve();
  }
  return new Promise(resolve => setTimeout(resolve, latencyMs));
}

/**
 * Client-side mock MCP server that encapsulates the responsibilities of a real remote MCP server:
 *
 * 1. Advertising tools and their associated `_meta.ui.resourceUri` via `listTools()`.
 * 2. Serving `ui://` HTML bundles (`text/html;profile=mcp-app`) and `_meta.ui` CSP/permissions
 *    metadata via `readResource()`.
 * 3. Executing tool calls (`tools/call`) with simulated network latency and returning structured
 *    `CallToolResult` payloads.
 */
export class MockMcpServer implements McpToolClient {
  private readonly toolsByName = new Map<string, MockMcpToolDescriptor>();
  private readonly resourcesByUri = new Map<string, MockMcpUiResource>();
  private readonly latencyMs: number;

  constructor(latencyMs = DEFAULT_MCP_NETWORK_LATENCY_MS) {
    this.latencyMs = latencyMs;
    for (const descriptor of TOOL_DESCRIPTORS) {
      this.toolsByName.set(descriptor.name, descriptor);
    }
  }

  /** Returns true if `toolName` is served by this mock MCP server. */
  hasTool(toolName: string): boolean {
    return this.toolsByName.has(toolName);
  }

  /** Resolves this server as the `McpToolClient` for `callMcpTool` when `toolName` is known. */
  getClientForTool = async (toolName: string): Promise<McpToolClient | undefined> => {
    await simulateMcpNetworkDelay(Math.round(this.latencyMs / 2));
    return this.toolsByName.has(toolName) ? this : undefined;
  };

  /** Registers or updates a `ui://` HTML resource on the mock server. */
  registerUiResource(resource: MockMcpUiResource): void {
    this.resourcesByUri.set(resource.uri, resource);
  }

  /** MCP `tools/list` handler with simulated network latency. */
  async listTools(): ReturnType<McpToolClient['listTools']> {
    await simulateMcpNetworkDelay(this.latencyMs);
    return {
      tools: TOOL_DESCRIPTORS.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: {type: 'object' as const},
        _meta: {
          ui: {
            resourceUri: t.resourceUri,
          },
        },
      })),
    };
  }

  /** MCP `resources/read` handler with simulated network latency. */
  async readResource(params: {uri: string}): Promise<ReadResourceResult> {
    await simulateMcpNetworkDelay(this.latencyMs);
    const resource = this.resourcesByUri.get(params.uri);
    if (!resource) {
      return {contents: []};
    }
    return {
      contents: [
        {
          uri: resource.uri,
          mimeType: resource.mimeType,
          text: resource.html,
          _meta: {
            ui: {
              ...(resource.csp ? {csp: resource.csp} : {}),
              ...(resource.permissions ? {permissions: resource.permissions} : {}),
            },
          },
        } as ReadResourceResult['contents'][number],
      ],
    };
  }

  /** MCP `request` handler (`tools/call`) implementing `McpToolClient`. */
  async request(
    req: {method: string; params?: Record<string, unknown>},
    _schema?: unknown,
    _options?: unknown,
  ): Promise<any> {
    if (req.method !== 'tools/call') {
      throw new Error(`Unsupported MCP request method: ${req.method}`);
    }
    const name = String(req.params?.['name'] ?? '');
    const args = (req.params?.['arguments'] as Record<string, unknown> | undefined) ?? {};
    const execution = await this.executeTool(name, args);
    return execution.result;
  }

  /**
   * Executes an MCP tool with simulated network latency and returns both the wire `CallToolResult`
   * and the surface DataModel update payload.
   */
  async executeTool(
    toolName: string,
    rawArgs: Record<string, unknown> = {},
  ): Promise<MockMcpToolExecution> {
    const descriptor = this.toolsByName.get(toolName);
    if (!descriptor) {
      throw new Error(`Unknown MCP tool: ${toolName}`);
    }

    await simulateMcpNetworkDelay(this.latencyMs);
    const args =
      rawArgs['arguments'] && typeof rawArgs['arguments'] === 'object'
        ? (rawArgs['arguments'] as Record<string, unknown>)
        : rawArgs;

    switch (toolName) {
      case 'get_order': {
        const orderId = String(args['orderId'] ?? 'A-1042');
        const items = [
          {name: 'Mechanical Keyboard', qty: 1, price: 60},
          {name: 'USB-C Coiled Cable', qty: 2, price: 15},
        ];
        const structuredContent = {orderId, items};
        return {
          targetDataPath: descriptor.targetDataPath,
          dataModelValue: {items},
          result: {
            content: [{type: 'text', text: `Loaded ${items.length} items for order ${orderId}.`}],
            structuredContent,
            _meta: {ui: {resourceUri: descriptor.resourceUri}},
          },
        };
      }

      case 'transpose_score': {
        const abc = String(args['abc'] ?? 'E E F G | G F E D | C C D E | E D D2');
        const status = `Transposed score committed (${abc})`;
        const structuredContent = {abc, nowPlaying: status};
        return {
          targetDataPath: descriptor.targetDataPath,
          dataModelValue: status,
          result: {
            content: [{type: 'text', text: status}],
            structuredContent,
            _meta: {ui: {resourceUri: descriptor.resourceUri}},
          },
        };
      }

      case 'capture_3d_snapshot': {
        const geometry = String(args['geometry'] ?? 'torusKnot');
        const yaw = Number(args['yaw'] ?? 0.65);
        const pitch = Number(args['pitch'] ?? 0.42);
        const zoom = Number(args['zoom'] ?? 4.4);
        const telemetry = `${geometry} (yaw=${yaw.toFixed(2)}, pitch=${pitch.toFixed(2)}, zoom=${zoom.toFixed(1)})`;
        const structuredContent = {geometry, yaw, pitch, zoom, telemetry};
        return {
          targetDataPath: descriptor.targetDataPath,
          dataModelValue: telemetry,
          result: {
            content: [{type: 'text', text: telemetry}],
            structuredContent,
            _meta: {ui: {resourceUri: descriptor.resourceUri}},
          },
        };
      }

      default:
        throw new Error(`Unhandled MCP tool: ${toolName}`);
    }
  }
}
