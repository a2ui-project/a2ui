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

import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';

/** Default simulated network latency (in milliseconds) for MCP server operations. */
export const DEFAULT_MCP_NETWORK_LATENCY_MS = 120;

/** Descriptor of a tool registered on the client-side mock MCP server. */
export interface MockMcpToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly resourceUri: string;
  readonly targetDataPath: string;
}

/** Result of executing a tool on the mock MCP server, paired with the target surface path. */
export interface MockMcpToolExecution {
  readonly targetDataPath: string;
  readonly dataModelValue: unknown;
  readonly result: CallToolResult;
}

const TOOL_DESCRIPTORS: readonly MockMcpToolDescriptor[] = [
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
 * Client-side mock MCP server: advertises the tools the examples call and executes them
 * (`tools/call`) with simulated network latency, returning structured `CallToolResult` payloads.
 */
export class MockMcpServer {
  private readonly toolsByName = new Map<string, MockMcpToolDescriptor>();
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
