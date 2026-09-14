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
 * Tests for the host half of the sample.
 *
 * Everything about interpreting a tool result -- template fetching, caching,
 * message extraction -- now lives in the MCP catalog and is tested there. What
 * remains here is what the host still owns: connecting to servers, recording
 * which server advertises which tool, and routing a tool name to a client.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {A2uiRecipeApp, BASIC_WITH_MCP_CATALOG_ID, MCP_CLIENT_NAME, MCP_CLIENT_VERSION} from './app';

const SSE_URL = 'http://127.0.0.1:8000/sse';

let mockClient: {
  connect: ReturnType<typeof vi.fn>;
  getServerVersion: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
  readResource: ReturnType<typeof vi.fn>;
};

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(function () {
    return mockClient;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

/** Builds the app without letting `firstUpdated` reach the network. */
function createApp(): A2uiRecipeApp {
  const app = new A2uiRecipeApp();
  // `firstUpdated` auto-connects; tests drive connection explicitly instead.
  vi.spyOn(app as any, 'firstUpdated').mockResolvedValue(undefined);
  return app;
}

describe('A2uiRecipeApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      getServerVersion: vi.fn().mockReturnValue({name: 'test-server', version: '1.0.0'}),
      listTools: vi.fn().mockResolvedValue({tools: [{name: 'get_sample_data'}]}),
      request: vi.fn().mockResolvedValue({content: []}),
      readResource: vi.fn().mockResolvedValue({contents: []}),
    };
  });

  describe('initialization', () => {
    it('starts with no clients and no surfaces', () => {
      const app = createApp();
      expect(app.mcpClients.size).toBe(0);
      expect(app.getSurface('non-existent')).toBeUndefined();
    });

    it('advertises the composite Basic+MCP catalog in its client capabilities', () => {
      const app = createApp();
      expect(app.processor.getClientCapabilities()['v0.9']?.supportedCatalogIds).toContain(
        BASIC_WITH_MCP_CATALOG_ID,
      );
    });

    it('exposes callMcpTool to surfaces built on the composite catalog', () => {
      const app = createApp();
      app.processor.processMessages([
        {
          version: 'v0.9',
          createSurface: {
            surfaceId: 'composite-surface',
            catalogId: BASIC_WITH_MCP_CATALOG_ID,
          },
        },
      ] as any);

      const surface = app.getSurface('composite-surface');
      expect(surface).toBeDefined();
      expect(surface!.catalog.functions.has('callMcpTool')).toBe(true);
    });
  });

  describe('connectServer', () => {
    it('connects, registers the client under its server name, and lists tools', async () => {
      const app = createApp();

      const serverName = await app.connectServer(SSE_URL);

      expect(serverName).toBe('test-server');
      expect(app.mcpClients.get('test-server')).toBe(mockClient);
      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.listTools).toHaveBeenCalled();
    });

    it('identifies itself and its supported catalogs during the handshake', async () => {
      const app = createApp();
      await app.connectServer(SSE_URL);

      expect(Client).toHaveBeenCalledWith(
        {name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION},
        {
          capabilities: {
            a2ui: {
              clientCapabilities: {
                'v0.9': {supportedCatalogIds: [BASIC_WITH_MCP_CATALOG_ID]},
              },
            },
          },
        },
      );
    });

    it('rejects a server that never identifies itself', async () => {
      mockClient.getServerVersion.mockReturnValue(undefined);
      const app = createApp();

      await expect(app.connectServer(SSE_URL)).rejects.toThrow(
        'Connected MCP server did not return a valid server name during initialization.',
      );
      expect(app.mcpClients.size).toBe(0);
    });

    it('propagates a transport failure', async () => {
      mockClient.connect.mockRejectedValue(new Error('Network error'));
      const app = createApp();

      await expect(app.connectServer(SSE_URL)).rejects.toThrow('Network error');
    });

    it('stays connected when tool discovery fails', async () => {
      mockClient.listTools.mockRejectedValue(new Error('Tool list error'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const app = createApp();

      await expect(app.connectServer(SSE_URL)).resolves.toBe('test-server');
      expect(app.mcpClients.get('test-server')).toBe(mockClient);
      expect(warn).toHaveBeenCalledWith('Could not list tools:', expect.any(Error));
      warn.mockRestore();
    });

    it('keeps the first owner when two servers advertise the same tool', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const app = createApp();

      await app.connectServer(SSE_URL);
      const firstClient = mockClient;
      mockClient = {
        ...mockClient,
        getServerVersion: vi.fn().mockReturnValue({name: 'second-server'}),
      };
      await app.connectServer('http://127.0.0.1:8001/sse');

      expect(app.getMcpClientForTool('get_sample_data')).toBe(firstClient);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "Tool 'get_sample_data' is already provided by server 'test-server'",
        ),
      );
      warn.mockRestore();
    });
  });

  describe('getMcpClientForTool', () => {
    it('throws when nothing is connected', () => {
      const app = createApp();
      expect(() => app.getMcpClientForTool('any_tool')).toThrow(
        "No MCP client connected to serve tool 'any_tool'",
      );
    });

    it('routes a tool to the server that advertised it', async () => {
      const app = createApp();
      await app.connectServer(SSE_URL);

      const other = {name: 'other'} as any;
      app.mcpClients.set('other-server', other);

      expect(app.getMcpClientForTool('get_sample_data')).toBe(mockClient);
    });

    it('falls back to the first connected client for an unadvertised tool', () => {
      const app = createApp();
      const first = {name: 'first'} as any;
      const second = {name: 'second'} as any;
      app.mcpClients.set('server-1', first);
      app.mcpClients.set('server-2', second);

      expect(app.getMcpClientForTool('unheard_of_tool')).toBe(first);
    });
  });
});
