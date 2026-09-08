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

import {describe, it} from 'node:test';
import * as assert from 'node:assert';
import {
  DataModel,
  DataContext,
  A2uiExpressionError,
  Catalog,
  MessageProcessor,
} from '@a2ui/web_core/v0_9';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallMcpToolApi} from './callMcpToolApi.js';
import {createCallMcpToolImplementation} from './callMcpTool.js';
import {createMcpCatalog, MCP_CATALOG_ID} from '../catalog.js';
import mcpCatalogJson from '../../mcp_catalog.json' with {type: 'json'};

/**
 * Creates a mock Transport for testing MCP protocol tool execution.
 */
function createMockTransport(
  toolHandler?: (name: string, args: Record<string, any>) => any,
): Transport & {lastRequest?: any} {
  const transport: any = {
    lastRequest: undefined,
    start: async () => {},
    close: async () => {},
    send: async (msg: any) => {
      transport.lastRequest = msg;
      if (msg.method === 'initialize') {
        transport.onmessage?.({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {tools: {}},
            serverInfo: {name: 'mock-mcp-server', version: '1.0.0'},
          },
        });
      } else if (msg.method === 'tools/call') {
        const toolName = msg.params?.name;
        const toolArgs = msg.params?.arguments || {};
        try {
          const content = toolHandler
            ? await toolHandler(toolName, toolArgs)
            : [{type: 'text', text: `Result of ${toolName}`}];
          transport.onmessage?.({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              content: Array.isArray(content) ? content : [{type: 'text', text: String(content)}],
            },
          });
        } catch (err: any) {
          transport.onmessage?.({
            jsonrpc: '2.0',
            id: msg.id,
            error: {
              code: -32000,
              message: err.message || 'Tool execution failed',
            },
          });
        }
      }
    },
    onmessage: undefined,
    onerror: undefined,
    onclose: undefined,
  };
  return transport;
}

const createTestDataContext = (model: DataModel, catalog: Catalog<any>, path = '/') => {
  const mockSurface = {
    dataModel: model,
    catalog: {invoker: catalog.invoker},
    dispatchError: () => {},
  } as any;
  return new DataContext(mockSurface, path);
};

describe('callMcpTool', () => {
  describe('CallMcpToolApi Schema', () => {
    it('has correct metadata', () => {
      assert.strictEqual(CallMcpToolApi.name, 'callMcpTool');
      assert.strictEqual(CallMcpToolApi.returnType, 'any');
    });

    it('parses valid minimal arguments with default empty arguments object', () => {
      const parsed = CallMcpToolApi.schema.parse({name: 'get_time'});
      assert.deepStrictEqual(parsed, {
        name: 'get_time',
        arguments: {},
      });
    });

    it('parses arguments with arguments payload', () => {
      const parsed = CallMcpToolApi.schema.parse({
        name: 'fetch_weather',
        arguments: {location: 'Tokyo', units: 'celsius'},
      });
      assert.deepStrictEqual(parsed, {
        name: 'fetch_weather',
        arguments: {location: 'Tokyo', units: 'celsius'},
      });
    });

    it('parses arguments with optional server', () => {
      const withServer = CallMcpToolApi.schema.parse({
        name: 'fetch_weather',
        server: 'weather-service',
      });
      assert.deepStrictEqual(withServer, {
        name: 'fetch_weather',
        server: 'weather-service',
        arguments: {},
      });
    });

    it('parses dynamic data bindings in name, server, and arguments', () => {
      const parsed = CallMcpToolApi.schema.parse({
        name: {path: '/selectedTool'},
        server: {path: '/selectedServer'},
        arguments: {
          city: {path: '/user/city'},
          count: 10,
        },
      });
      assert.deepStrictEqual(parsed, {
        name: {path: '/selectedTool'},
        server: {path: '/selectedServer'},
        arguments: {
          city: {path: '/user/city'},
          count: 10,
        },
      });
    });

    it('throws validation error when name is missing', () => {
      assert.throws(() => {
        CallMcpToolApi.schema.parse({});
      });
    });
  });

  describe('createCallMcpToolImplementation & createMcpCatalog with Client Getter', () => {
    it('executes tool call on connected Client instance via getter', async () => {
      const transport = createMockTransport((name, args) => {
        return [{type: 'text', text: `Tool ${name} executed with count=${args.count}`}];
      });
      const client = new Client({name: 'test-client', version: '1.0.0'});
      await client.connect(transport);

      const catalog = createMcpCatalog(() => client);
      assert.strictEqual(catalog.id, MCP_CATALOG_ID);

      const dataModel = new DataModel({});
      const context = createTestDataContext(dataModel, catalog);

      const result = await catalog.invoker(
        'callMcpTool',
        {name: 'counter', arguments: {count: 5}},
        context,
      );

      assert.deepStrictEqual(result, {
        content: [{type: 'text', text: 'Tool counter executed with count=5'}],
      });
      assert.strictEqual(transport.lastRequest.method, 'tools/call');
      assert.strictEqual(transport.lastRequest.params.name, 'counter');
      assert.deepStrictEqual(transport.lastRequest.params.arguments, {count: 5});
    });

    it('routes tool call to target server via client getter when server is provided', async () => {
      const transportA = createMockTransport((name, args) => [
        {type: 'text', text: `ServerA: ${name} -> ${args.query}`},
      ]);
      const clientA = new Client({name: 'server-a', version: '1.0.0'});
      await clientA.connect(transportA);

      const transportB = createMockTransport((name, args) => [
        {type: 'text', text: `ServerB: ${name} -> ${args.query}`},
      ]);
      const clientB = new Client({name: 'server-b', version: '1.0.0'});
      await clientB.connect(transportB);

      const requestedServers: (string | undefined)[] = [];
      const getter = (server?: string) => {
        requestedServers.push(server);
        if (server === 'server-b') return clientB;
        return clientA;
      };

      const catalog = createMcpCatalog(getter);
      const dataModel = new DataModel({});
      const context = createTestDataContext(dataModel, catalog);

      // Tool call targeting server-b
      const resultB = await catalog.invoker(
        'callMcpTool',
        {name: 'query', server: 'server-b', arguments: {query: 'hello'}},
        context,
      );
      assert.deepStrictEqual(resultB, {
        content: [{type: 'text', text: 'ServerB: query -> hello'}],
      });

      // Tool call without server (falls back to default/first)
      const resultDefault = await catalog.invoker(
        'callMcpTool',
        {name: 'query', arguments: {query: 'world'}},
        context,
      );
      assert.deepStrictEqual(resultDefault, {
        content: [{type: 'text', text: 'ServerA: query -> world'}],
      });

      assert.deepStrictEqual(requestedServers, ['server-b', undefined]);
    });

    it('throws A2uiExpressionError when targeted server is not found in getter', async () => {
      const catalog = createMcpCatalog((server?: string) => {
        if (server === 'known-server') return {} as Client;
        return undefined;
      });
      const dataModel = new DataModel({});
      const context = createTestDataContext(dataModel, catalog);

      await assert.rejects(
        async () => {
          await catalog.invoker('callMcpTool', {name: 'tool', server: 'unknown-server'}, context);
        },
        (err: any) => {
          assert.ok(err instanceof A2uiExpressionError);
          assert.strictEqual(err.expression, 'callMcpTool');
          assert.ok(
            err.message.includes("MCP Client is not available for server 'unknown-server'"),
          );
          return true;
        },
      );
    });

    it('executes tool call using client getter returning Client', async () => {
      const transport = createMockTransport((name, args) => [
        {type: 'text', text: `Getter executed: ${name} -> ${args.query}`},
      ]);
      const client = new Client({name: 'getter-client', version: '1.0.0'});
      await client.connect(transport);

      // Getter returns Client
      const catalog = createMcpCatalog(() => client);
      const dataModel = new DataModel({});
      const context = createTestDataContext(dataModel, catalog);

      const result = await catalog.invoker(
        'callMcpTool',
        {name: 'search', arguments: {query: 'a2ui'}},
        context,
      );

      assert.deepStrictEqual(result, {
        content: [{type: 'text', text: 'Getter executed: search -> a2ui'}],
      });
    });

    it('throws A2uiExpressionError when MCP client is unavailable in getter', async () => {
      const catalog = createMcpCatalog(() => undefined as any);
      const dataModel = new DataModel({});
      const context = createTestDataContext(dataModel, catalog);

      await assert.rejects(
        async () => {
          await catalog.invoker('callMcpTool', {name: 'tool'}, context);
        },
        (err: any) => {
          assert.ok(err instanceof A2uiExpressionError);
          assert.strictEqual(err.expression, 'callMcpTool');
          assert.ok(err.message.includes('MCP Client is not available.'));
          return true;
        },
      );
    });

    it('throws A2uiExpressionError when tool call fails on server', async () => {
      const transport = createMockTransport(() => {
        throw new Error('MCP server database connection failed');
      });
      const client = new Client({name: 'failing-client', version: '1.0.0'});
      await client.connect(transport);

      const catalog = createMcpCatalog(() => client);
      const dataModel = new DataModel({});
      const context = createTestDataContext(dataModel, catalog);

      await assert.rejects(
        async () => {
          await catalog.invoker('callMcpTool', {name: 'failing_tool'}, context);
        },
        (err: any) => {
          assert.ok(err instanceof A2uiExpressionError);
          assert.strictEqual(err.expression, 'callMcpTool');
          assert.ok(err.message.includes('MCP server database connection failed'));
          return true;
        },
      );
    });

    it('throws A2uiExpressionError on invalid function arguments', async () => {
      const client = new Client({name: 'test-client', version: '1.0.0'});
      const catalog = createMcpCatalog(() => client);
      const dataModel = new DataModel({});
      const context = createTestDataContext(dataModel, catalog);

      assert.throws(
        () => {
          catalog.invoker('callMcpTool', {} as any, context);
        },
        (err: any) => {
          assert.ok(err instanceof A2uiExpressionError);
          assert.strictEqual(err.expression, 'callMcpTool');
          assert.ok(err.message.includes('Validation failed'));
          return true;
        },
      );
    });

    it('creates function implementation directly via createCallMcpToolImplementation', async () => {
      const transport = createMockTransport(name => [{type: 'text', text: `Direct: ${name}`}]);
      const client = new Client({name: 'direct-client', version: '1.0.0'});
      await client.connect(transport);

      const impl = createCallMcpToolImplementation(() => client);
      assert.strictEqual(impl.name, 'callMcpTool');
      assert.strictEqual(impl.returnType, 'any');

      const customCatalog = new Catalog('test-direct', [], [impl]);
      const dataModel = new DataModel({});
      const context = createTestDataContext(dataModel, customCatalog);

      const result = await customCatalog.invoker('callMcpTool', {name: 'ping'}, context);
      assert.deepStrictEqual(result, {
        content: [{type: 'text', text: 'Direct: ping'}],
      });
    });

    it('invokes onResult callback with result, client, name, and server upon successful execution', async () => {
      const transport = createMockTransport((name, args) => [
        {type: 'text', text: `Result for ${name}`},
      ]);
      const client = new Client({name: 'onresult-client', version: '1.0.0'});
      await client.connect(transport);

      let capturedResult: any;
      let capturedClient: any;
      let capturedName: any;
      let capturedServer: any;

      const impl = createCallMcpToolImplementation(
        () => client,
        (result, cl, name, server) => {
          capturedResult = result;
          capturedClient = cl;
          capturedName = name;
          capturedServer = server;
        },
      );

      const customCatalog = new Catalog('test-onresult', [], [impl]);
      const dataModel = new DataModel({});
      const context = createTestDataContext(dataModel, customCatalog);

      await customCatalog.invoker(
        'callMcpTool',
        {name: 'my_tool', server: 'my_server', arguments: {a: 1}},
        context,
      );

      assert.deepStrictEqual(capturedResult, {
        content: [{type: 'text', text: 'Result for my_tool'}],
      });
      assert.strictEqual(capturedClient, client);
      assert.strictEqual(capturedName, 'my_tool');
      assert.strictEqual(capturedServer, 'my_server');
    });

    it('passes onResult callback through createMcpCatalog', async () => {
      const transport = createMockTransport(name => [{type: 'text', text: `Result of ${name}`}]);
      const client = new Client({name: 'catalog-onresult-client', version: '1.0.0'});
      await client.connect(transport);

      let onResultFired = false;
      const catalog = createMcpCatalog(
        () => client,
        (result, cl, name, server) => {
          onResultFired = true;
          assert.strictEqual(name, 'tool_via_catalog');
          assert.strictEqual(server, undefined);
        },
      );

      const dataModel = new DataModel({});
      const context = createTestDataContext(dataModel, catalog);

      await catalog.invoker('callMcpTool', {name: 'tool_via_catalog'}, context);
      assert.strictEqual(onResultFired, true);
    });

    it('resolves dynamic data bindings for name, server, and arguments via DataContext', async () => {
      const transport = createMockTransport((name, args) => [
        {type: 'text', text: `Resolved: ${name} -> ${JSON.stringify(args)}`},
      ]);
      const client = new Client({name: 'dynamic-client', version: '1.0.0'});
      await client.connect(transport);

      const catalog = createMcpCatalog(server => {
        assert.strictEqual(server, 'weather-server');
        return client;
      });

      const dataModel = new DataModel({
        toolName: 'get_forecast',
        serverName: 'weather-server',
        location: 'Paris',
        options: {
          days: 3,
        },
      });
      const context = createTestDataContext(dataModel, catalog);

      const result = await catalog.invoker(
        'callMcpTool',
        {
          name: {path: '/toolName'},
          server: {path: '/serverName'},
          arguments: {
            city: {path: '/location'},
            days: {path: '/options/days'},
            unit: 'metric',
          },
        },
        context,
      );

      assert.deepStrictEqual(result, {
        content: [
          {
            type: 'text',
            text: 'Resolved: get_forecast -> {"city":"Paris","days":3,"unit":"metric"}',
          },
        ],
      });
      assert.strictEqual(transport.lastRequest.params.name, 'get_forecast');
      assert.deepStrictEqual(transport.lastRequest.params.arguments, {
        city: 'Paris',
        days: 3,
        unit: 'metric',
      });
    });
  });

  describe('mcp_catalog.json Schema Verification', () => {
    it('loads schema into a valid Catalog using Catalog.fromSchema', () => {
      const schemaCatalog = Catalog.fromSchema(mcpCatalogJson);
      assert.strictEqual(schemaCatalog.id, MCP_CATALOG_ID);
      assert.strictEqual(schemaCatalog.functions.has('callMcpTool'), true);

      const fnApi = schemaCatalog.functions.get('callMcpTool');
      assert.ok(fnApi);
      assert.strictEqual(fnApi.name, 'callMcpTool');
      assert.strictEqual(fnApi.returnType, 'any');

      // Test validation with schema-loaded Zod shape
      const valid = fnApi.schema.parse({
        name: 'read_resource',
        server: 'mcp-server',
        arguments: {uri: 'a2ui://form'},
      });
      assert.deepStrictEqual(valid, {
        name: 'read_resource',
        server: 'mcp-server',
        arguments: {uri: 'a2ui://form'},
      });
    });
  });

  describe('MessageProcessor Integration', () => {
    it('works seamlessly alongside basic catalog in MessageProcessor', async () => {
      const transport = createMockTransport((name, args) => [
        {type: 'text', text: `Result of ${name}: ${JSON.stringify(args)}`},
      ]);
      const client = new Client({name: 'processor-client', version: '1.0.0'});
      await client.connect(transport);

      const mcpCatalog = createMcpCatalog(() => client);
      const testBasicCatalog = new Catalog(
        'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        [],
        [],
      );

      const processor = new MessageProcessor([testBasicCatalog, mcpCatalog], async () => {});

      // Process surface creation
      processor.processMessages([
        {
          version: 'v0.9',
          createSurface: {
            surfaceId: 'mcp-surface',
            catalogId: MCP_CATALOG_ID,
          },
        },
      ]);

      const surface = processor.model.getSurface('mcp-surface');
      assert.ok(surface);

      // Invoke callMcpTool via surface data context
      const context = new DataContext(surface, '/');
      const result = await surface.catalog.invoker(
        'callMcpTool',
        {name: 'get_user', arguments: {id: '123'}},
        context,
      );

      assert.deepStrictEqual(result, {
        content: [{type: 'text', text: 'Result of get_user: {"id":"123"}'}],
      });
    });
  });
});
