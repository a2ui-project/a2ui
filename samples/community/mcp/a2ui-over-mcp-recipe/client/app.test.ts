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
 * Interpreting a tool result -- template fetching, caching, message extraction
 * -- belongs to the MCP catalog and is tested there. What remains here is what
 * the host owns: connecting, recording which client serves which tool, routing
 * a tool name to a client, and bootstrapping the first surface.
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {A2uiRecipeApp, BASIC_WITH_MCP_CATALOG_ID, MCP_CLIENT_NAME, MCP_CLIENT_VERSION} from './app';

const RECIPE_FORM_TOOL = 'get_recipe_form_a2ui';

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

/** Runs the connect-and-bootstrap lifecycle the way Lit would. */
const bootstrap = (app: A2uiRecipeApp) => (app as any).firstUpdated();

describe('A2uiRecipeApp', () => {
  let app: A2uiRecipeApp;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      getServerVersion: vi.fn().mockReturnValue({name: 'test-server', version: '1.0.0'}),
      listTools: vi.fn().mockResolvedValue({tools: [{name: RECIPE_FORM_TOOL}]}),
      request: vi.fn().mockResolvedValue({content: []}),
      readResource: vi.fn().mockResolvedValue({contents: []}),
    };

    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    app = new A2uiRecipeApp();
  });

  describe('initialization', () => {
    it('starts with no tools and no surfaces', () => {
      expect(app.clientsByTool.size).toBe(0);
      expect(app.getSurface('non-existent')).toBeUndefined();
    });

    it('advertises the composite Basic+MCP catalog in its client capabilities', () => {
      expect(app.processor.getClientCapabilities()['v0.9']?.supportedCatalogIds).toContain(
        BASIC_WITH_MCP_CATALOG_ID,
      );
    });

    it('exposes callMcpTool to surfaces built on the composite catalog', () => {
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

  describe('startup', () => {
    it('connects, records the tools the server serves, and runs the entrypoint tool', async () => {
      await bootstrap(app);

      expect(mockClient.connect).toHaveBeenCalled();
      expect(app.clientsByTool.get(RECIPE_FORM_TOOL)).toBe(mockClient);
      expect(mockClient.request).toHaveBeenCalledWith(
        {method: 'tools/call', params: {name: RECIPE_FORM_TOOL, arguments: {}}},
        expect.anything(),
        expect.anything(),
      );
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('identifies itself and its supported catalogs during the handshake', async () => {
      await bootstrap(app);

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

    it('reports a server that never identifies itself', async () => {
      mockClient.getServerVersion.mockReturnValue(undefined);

      await bootstrap(app);

      expect(app.clientsByTool.size).toBe(0);
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to initialize recipe app:',
        expect.objectContaining({
          message: expect.stringContaining('did not return a valid server name'),
        }),
      );
    });

    it('reports a transport failure', async () => {
      mockClient.connect.mockRejectedValue(new Error('Network error'));

      await bootstrap(app);

      expect(app.clientsByTool.size).toBe(0);
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to initialize recipe app:',
        expect.objectContaining({message: 'Network error'}),
      );
    });

    it('reports a failure to list tools rather than continuing half-configured', async () => {
      mockClient.listTools.mockRejectedValue(new Error('Tool list error'));

      await bootstrap(app);

      expect(app.clientsByTool.size).toBe(0);
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to initialize recipe app:',
        expect.objectContaining({message: 'Tool list error'}),
      );
    });

    it('rejects a tool advertised more than once', async () => {
      mockClient.listTools.mockResolvedValue({
        tools: [{name: RECIPE_FORM_TOOL}, {name: RECIPE_FORM_TOOL}],
      });

      await bootstrap(app);

      expect(consoleError).toHaveBeenCalledWith(
        'Failed to initialize recipe app:',
        expect.objectContaining({
          message: `Tool '${RECIPE_FORM_TOOL}' is advertised more than once.`,
        }),
      );
    });
  });

  describe('getMcpClientForTool', () => {
    it('returns the client that advertised the tool', async () => {
      await bootstrap(app);
      expect(app.getMcpClientForTool(RECIPE_FORM_TOOL)).toBe(mockClient);
    });

    it('throws for a tool no connected server advertises', () => {
      expect(() => app.getMcpClientForTool('unheard_of_tool')).toThrow(
        "No connected MCP server advertises a tool named 'unheard_of_tool'.",
      );
    });
  });
});
