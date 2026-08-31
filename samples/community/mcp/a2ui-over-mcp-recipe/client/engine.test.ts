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

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
  A2uiMcpEngine,
  BASIC_CATALOG_ID,
  DEFAULT_MCP_CLIENT_NAME,
  DEFAULT_MCP_CLIENT_VERSION,
  A2UI_MIME_TYPE,
  MCP_CALL_TOOL_ACTION,
} from './engine';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js';

let mockClient: {
  connect: ReturnType<typeof vi.fn>;
  getServerVersion: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
  readResource: ReturnType<typeof vi.fn>;
};

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  const MockClient = vi.fn().mockImplementation(function () {
    return mockClient;
  });
  return {Client: MockClient};
});

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => {
  const MockTransport = vi.fn().mockImplementation(function () {
    return {};
  });
  return {SSEClientTransport: MockTransport};
});

describe('A2uiMcpEngine', () => {
  const sampleTemplate = [
    {
      createSurface: {
        surfaceId: 'test-surface',
        catalogId: BASIC_CATALOG_ID,
      },
    },
    {
      updateComponents: {
        surfaceId: 'test-surface',
        components: [
          {
            id: 'root',
            component: 'Text',
            properties: {
              text: {
                literal: 'Test Presentation',
              },
            },
          },
        ],
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      getServerVersion: vi.fn().mockReturnValue({name: 'test-server', version: '1.0.0'}),
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: 'get_sample_data',
            _meta: {
              ui: {
                resourceUri: 'a2ui://sample-template',
              },
            },
          },
        ],
      }),
      callTool: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              {
                updateDataModel: {
                  surfaceId: 'test-surface',
                  value: {title: 'Hello Recipe'},
                },
              },
            ]),
          },
        ],
      }),
      readResource: vi.fn().mockResolvedValue({
        contents: [
          {
            uri: 'a2ui://sample-template',
            mimeType: A2UI_MIME_TYPE,
            text: JSON.stringify(sampleTemplate),
          },
        ],
      }),
    };
  });

  describe('initialization', () => {
    it('initializes with default basic catalog and handles undefined events', () => {
      const engine = new A2uiMcpEngine(undefined, undefined);
      expect(engine.processor).toBeDefined();
      expect(engine.mcpClients.size).toBe(0);
      expect(engine.getSurface('non-existent')).toBeUndefined();
    });

    it('forwards action triggers to onAction callback', async () => {
      const onAction = vi.fn();
      const engine = new A2uiMcpEngine(undefined, {onAction});
      const dummyAction = {name: 'custom_action', context: {key: 'val'}};

      // Emit action from processor's surface group model
      (engine.processor.model.onAction as any).emit(dummyAction);
      expect(onAction).toHaveBeenCalledWith(dummyAction);
    });

    it('defines MCP_CALL_TOOL_ACTION as callMcpTool', () => {
      expect(MCP_CALL_TOOL_ACTION).toBe('callMcpTool');
    });
  });

  describe('connectServer', () => {
    it('connects to server, discovers tool UI resources, and registers client', async () => {
      const onConnectionChange = vi.fn();
      const onStatusChange = vi.fn();
      const engine = new A2uiMcpEngine(undefined, {onConnectionChange, onStatusChange});

      const serverName = await engine.connectServer('http://127.0.0.1:8000/sse', 'custom-client');

      expect(serverName).toBe('test-server');
      expect(engine.mcpClients.get('test-server')).toBe(mockClient);
      expect(onConnectionChange).toHaveBeenNthCalledWith(1, 'connecting');
      expect(onConnectionChange).toHaveBeenNthCalledWith(2, 'connected');
      expect(onStatusChange).toHaveBeenCalledWith(
        'Connected to MCP Server [test-server] (http://127.0.0.1:8000/sse)',
      );

      // Verify Client initialization options
      expect(Client).toHaveBeenCalledWith(
        {name: 'custom-client', version: DEFAULT_MCP_CLIENT_VERSION},
        {
          capabilities: {
            a2ui: {
              clientCapabilities: {
                'v0.9': {
                  supportedCatalogIds: [BASIC_CATALOG_ID],
                },
              },
            },
          },
        },
      );
      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.listTools).toHaveBeenCalled();
    });

    it('falls back to DEFAULT_MCP_CLIENT_NAME if not specified', async () => {
      const engine = new A2uiMcpEngine();
      await engine.connectServer('http://127.0.0.1:8000/sse');

      expect(Client).toHaveBeenCalledWith(
        {name: DEFAULT_MCP_CLIENT_NAME, version: DEFAULT_MCP_CLIENT_VERSION},
        expect.anything(),
      );
    });

    it('throws error and sets status to error when server name is missing', async () => {
      mockClient.getServerVersion.mockReturnValue(undefined);
      const onConnectionChange = vi.fn();
      const onStatusChange = vi.fn();
      const engine = new A2uiMcpEngine(undefined, {onConnectionChange, onStatusChange});

      await expect(engine.connectServer('http://127.0.0.1:8000/sse')).rejects.toThrow(
        'Connected MCP server did not return a valid server name during initialization.',
      );

      expect(onConnectionChange).toHaveBeenCalledWith('error');
      expect(onStatusChange).toHaveBeenCalledWith(expect.stringContaining('Connection failed:'));
    });

    it('handles connection failure from transport', async () => {
      mockClient.connect.mockRejectedValue(new Error('Network error'));
      const onConnectionChange = vi.fn();
      const engine = new A2uiMcpEngine(undefined, {onConnectionChange});

      await expect(engine.connectServer('http://127.0.0.1:8000/sse')).rejects.toThrow(
        'Network error',
      );
      expect(onConnectionChange).toHaveBeenCalledWith('error');
    });

    it('handles tool listing failure gracefully during connection', async () => {
      mockClient.listTools.mockRejectedValue(new Error('Tool list error'));
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const engine = new A2uiMcpEngine();

      const serverName = await engine.connectServer('http://127.0.0.1:8000/sse');
      expect(serverName).toBe('test-server');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Could not query tool UI resources:',
        expect.any(Error),
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe('handleMcpCallTool', () => {
    let engine: A2uiMcpEngine;

    beforeEach(async () => {
      engine = new A2uiMcpEngine();
      await engine.connectServer('http://127.0.0.1:8000/sse');
    });

    it('defensively handles null context without throwing TypeError', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(engine.handleMcpCallTool(null as any)).resolves.not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `'${MCP_CALL_TOOL_ACTION}' action missing required 'server' in context:`,
        {},
      );
      consoleErrorSpy.mockRestore();
    });

    it('defensively handles undefined context without throwing TypeError', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(engine.handleMcpCallTool(undefined as any)).resolves.not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `'${MCP_CALL_TOOL_ACTION}' action missing required 'server' in context:`,
        {},
      );
      consoleErrorSpy.mockRestore();
    });

    it('logs error if server is missing from context', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await engine.handleMcpCallTool({tool: 'get_sample_data'});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `'${MCP_CALL_TOOL_ACTION}' action missing required 'server' in context:`,
        {tool: 'get_sample_data'},
      );
      consoleErrorSpy.mockRestore();
    });

    it('logs error if tool is missing from context', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await engine.handleMcpCallTool({server: 'test-server'});

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `'${MCP_CALL_TOOL_ACTION}' action missing required 'tool' in context:`,
        {server: 'test-server'},
      );
      consoleErrorSpy.mockRestore();
    });

    it('filters routing metadata keys (server, tool) from tool arguments', async () => {
      const executeToolSpy = vi.spyOn(engine, 'executeTool').mockResolvedValue(undefined);

      await engine.handleMcpCallTool({
        server: 'test-server',
        tool: 'get_sample_data',
        category: 'italian',
        difficulty: 'easy',
      });

      expect(executeToolSpy).toHaveBeenCalledWith('test-server', 'get_sample_data', {
        category: 'italian',
        difficulty: 'easy',
      });
    });
  });

  describe('executeTool', () => {
    let engine: A2uiMcpEngine;
    let onStatusChange: any;
    let onSurfaceChange: any;

    beforeEach(async () => {
      onStatusChange = vi.fn();
      onSurfaceChange = vi.fn();
      engine = new A2uiMcpEngine(undefined, {onStatusChange, onSurfaceChange});
      await engine.connectServer('http://127.0.0.1:8000/sse');
    });

    it('logs error and notifies status if target server is not connected', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await engine.executeTool('unknown-server', 'get_sample_data');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "No MCP client available for server 'unknown-server' (tool 'get_sample_data')",
      );
      expect(onStatusChange).toHaveBeenCalledWith(
        "Failed: No connected server 'unknown-server' for get_sample_data",
      );
      consoleErrorSpy.mockRestore();
    });

    it('executes tool with normalized args when args is null', async () => {
      await engine.executeTool('test-server', 'get_sample_data', null as any);

      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'get_sample_data',
        arguments: {},
      });
    });

    it('handles tool execution error gracefully', async () => {
      mockClient.callTool.mockRejectedValue(new Error('Tool failed'));
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await engine.executeTool('test-server', 'get_sample_data');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error executing get_sample_data on [test-server]:',
        expect.any(Error),
      );
      expect(onStatusChange).toHaveBeenCalledWith('Execution failed: Tool failed');
      consoleErrorSpy.mockRestore();
    });

    it('discovers template from result._meta.ui.resourceUri, fetches template, and applies messages', async () => {
      mockClient.callTool.mockResolvedValue({
        _meta: {
          ui: {
            resourceUri: 'a2ui://sample-template',
          },
        },
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              {
                updateDataModel: {
                  surfaceId: 'test-surface',
                  value: {title: 'Special Recipe'},
                },
              },
            ]),
          },
        ],
      });

      await engine.executeTool('test-server', 'get_sample_data');

      // Surface created and updated
      const surface = engine.getSurface('test-surface');
      expect(surface).toBeDefined();
      expect(mockClient.readResource).toHaveBeenCalledWith({uri: 'a2ui://sample-template'});
      expect(onSurfaceChange).toHaveBeenCalled();
      expect(onStatusChange).toHaveBeenCalledWith(
        'get_sample_data on [test-server] completed successfully!',
      );
    });

    it('caches templates and does not re-fetch on subsequent tool calls', async () => {
      // First call fetches template
      await engine.executeTool('test-server', 'get_sample_data');
      expect(mockClient.readResource).toHaveBeenCalledTimes(1);

      // Second call uses cached template
      await engine.executeTool('test-server', 'get_sample_data');
      expect(mockClient.readResource).toHaveBeenCalledTimes(1);
    });

    it('does not re-process template if surface already exists', async () => {
      const processMessagesSpy = vi.spyOn(engine.processor, 'processMessages');

      // First call processes template (2 messages) + update data model (1 message)
      await engine.executeTool('test-server', 'get_sample_data');
      expect(processMessagesSpy).toHaveBeenCalledWith(sampleTemplate);

      processMessagesSpy.mockClear();

      // Second call has existing surface so template should NOT be passed to processMessages
      await engine.executeTool('test-server', 'get_sample_data');
      expect(processMessagesSpy).not.toHaveBeenCalledWith(sampleTemplate);
    });

    it('extracts A2UI messages from resource type content', async () => {
      mockClient.callTool.mockResolvedValue({
        content: [
          {
            type: 'resource',
            resource: {
              text: JSON.stringify([
                {
                  updateDataModel: {
                    surfaceId: 'test-surface',
                    value: {calories: 500},
                  },
                },
              ]),
            },
          },
        ],
      });

      await engine.executeTool('test-server', 'get_sample_data');
      expect(onSurfaceChange).toHaveBeenCalled();
    });

    it('extracts A2UI messages from single object updateDataModel', async () => {
      mockClient.callTool.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              updateDataModel: {
                surfaceId: 'test-surface',
                value: {readyInMinutes: 30},
              },
            }),
          },
        ],
      });

      await engine.executeTool('test-server', 'get_sample_data');
      expect(onSurfaceChange).toHaveBeenCalled();
    });

    it('handles template without valid A2UI MIME type gracefully', async () => {
      mockClient.readResource.mockResolvedValue({
        contents: [
          {
            uri: 'a2ui://sample-template',
            mimeType: 'text/plain',
            text: 'not a2ui',
          },
        ],
      });

      // Clear cache so it fetches
      (engine as any).templateCache.clear();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await engine.executeTool('test-server', 'get_sample_data');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error executing get_sample_data on [test-server]:',
        expect.any(Error),
      );
      expect(onStatusChange).toHaveBeenCalledWith(
        expect.stringContaining(
          'Execution failed: Resource a2ui://sample-template does not contain valid A2UI JSON template data.',
        ),
      );
      consoleErrorSpy.mockRestore();
    });
  });
});
