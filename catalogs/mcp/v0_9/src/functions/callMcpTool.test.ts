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
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {CallMcpToolApi} from './callMcpToolApi.js';
import {createCallMcpToolImplementation, type McpToolCaller} from './callMcpTool.js';
import {createMcpCatalog, MCP_CATALOG_ID} from '../catalog.js';
import mcpCatalogJson from '../../mcp_catalog.json' with {type: 'json'};

interface RecordedCall {
  toolName: string;
  args: Record<string, any>;
}

/**
 * Creates a tool caller that records every invocation and echoes a text result.
 *
 * Mirrors the host contract: resolve the tool, execute it, return the raw result.
 */
function createRecordingCaller(
  toolHandler: (toolName: string, args: Record<string, any>) => CallToolResult = (
    toolName,
    args,
  ) => ({
    content: [{type: 'text', text: `Result of ${toolName}: ${JSON.stringify(args)}`}],
  }),
): McpToolCaller & {calls: RecordedCall[]} {
  const calls: RecordedCall[] = [];
  const caller = (async (toolName: string, args: Record<string, any>) => {
    calls.push({toolName, args});
    return toolHandler(toolName, args);
  }) as McpToolCaller & {calls: RecordedCall[]};
  caller.calls = calls;
  return caller;
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

    it('parses dynamic data bindings in name and arguments', () => {
      const parsed = CallMcpToolApi.schema.parse({
        name: {path: '/selectedTool'},
        arguments: {
          city: {path: '/user/city'},
          count: 10,
        },
      });
      assert.deepStrictEqual(parsed, {
        name: {path: '/selectedTool'},
        arguments: {
          city: {path: '/user/city'},
          count: 10,
        },
      });
    });

    it('drops a server argument, since servers are resolved by the host', () => {
      const parsed = CallMcpToolApi.schema.parse({
        name: 'fetch_weather',
        server: 'weather-service',
      } as any);
      assert.deepStrictEqual(parsed, {
        name: 'fetch_weather',
        arguments: {},
      });
    });

    it('throws validation error when name is missing', () => {
      assert.throws(() => {
        CallMcpToolApi.schema.parse({});
      });
    });
  });

  describe('createCallMcpToolImplementation & createMcpCatalog', () => {
    it('delegates tool name and resolved arguments to the host tool caller', async () => {
      const caller = createRecordingCaller();
      const catalog = createMcpCatalog(caller);
      assert.strictEqual(catalog.id, MCP_CATALOG_ID);

      const context = createTestDataContext(new DataModel({}), catalog);

      const result = await catalog.invoker(
        'callMcpTool',
        {name: 'counter', arguments: {count: 5}},
        context,
      );

      assert.deepStrictEqual(result, {
        content: [{type: 'text', text: 'Result of counter: {"count":5}'}],
      });
      assert.strictEqual(caller.calls.length, 1);
      assert.strictEqual(caller.calls[0].toolName, 'counter');
      assert.deepStrictEqual(caller.calls[0].args, {count: 5});
    });

    it('passes an empty arguments object when no arguments are supplied', async () => {
      const caller = createRecordingCaller();
      const catalog = createMcpCatalog(caller);
      const context = createTestDataContext(new DataModel({}), catalog);

      await catalog.invoker('callMcpTool', {name: 'ping'}, context);

      assert.deepStrictEqual(caller.calls[0].args, {});
    });

    it('throws A2uiExpressionError when the host tool caller fails', async () => {
      const catalog = createMcpCatalog(() => {
        throw new Error('No MCP client connected');
      });
      const context = createTestDataContext(new DataModel({}), catalog);

      await assert.rejects(
        async () => {
          await catalog.invoker('callMcpTool', {name: 'tool'}, context);
        },
        (err: any) => {
          assert.ok(err instanceof A2uiExpressionError);
          assert.strictEqual(err.expression, 'callMcpTool');
          assert.ok(err.message.includes('No MCP client connected'));
          return true;
        },
      );
    });

    it('throws A2uiExpressionError when the tool result is flagged isError', async () => {
      const catalog = createMcpCatalog(() => ({
        isError: true,
        content: [{type: 'text', text: 'database connection failed'}],
      }));
      const context = createTestDataContext(new DataModel({}), catalog);

      await assert.rejects(
        async () => {
          await catalog.invoker('callMcpTool', {name: 'failing_tool'}, context);
        },
        (err: any) => {
          assert.ok(err instanceof A2uiExpressionError);
          assert.strictEqual(err.expression, 'callMcpTool');
          assert.ok(err.message.includes("MCP tool 'failing_tool' execution failed"));
          assert.ok(err.message.includes('database connection failed'));
          return true;
        },
      );
    });

    it('throws A2uiExpressionError when the host tool caller returns nothing', async () => {
      const catalog = createMcpCatalog(() => undefined as any);
      const context = createTestDataContext(new DataModel({}), catalog);

      await assert.rejects(
        async () => {
          await catalog.invoker('callMcpTool', {name: 'tool'}, context);
        },
        (err: any) => {
          assert.ok(err instanceof A2uiExpressionError);
          assert.ok(err.message.includes("MCP tool 'tool' did not return a result."));
          return true;
        },
      );
    });

    it('throws A2uiExpressionError on invalid function arguments', async () => {
      const catalog = createMcpCatalog(createRecordingCaller());
      const context = createTestDataContext(new DataModel({}), catalog);

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
      const impl = createCallMcpToolImplementation(name => ({
        content: [{type: 'text', text: `Direct: ${name}`}],
      }));
      assert.strictEqual(impl.name, 'callMcpTool');
      assert.strictEqual(impl.returnType, 'any');

      const customCatalog = new Catalog('test-direct', [], [impl]);
      const context = createTestDataContext(new DataModel({}), customCatalog);

      const result = await customCatalog.invoker('callMcpTool', {name: 'ping'}, context);
      assert.deepStrictEqual(result, {
        content: [{type: 'text', text: 'Direct: ping'}],
      });
    });

    it('invokes onResult callback with result and tool name upon successful execution', async () => {
      let capturedResult: any;
      let capturedName: any;

      const impl = createCallMcpToolImplementation(createRecordingCaller(), (result, name) => {
        capturedResult = result;
        capturedName = name;
      });

      const customCatalog = new Catalog('test-onresult', [], [impl]);
      const context = createTestDataContext(new DataModel({}), customCatalog);

      await customCatalog.invoker('callMcpTool', {name: 'my_tool', arguments: {a: 1}}, context);

      assert.deepStrictEqual(capturedResult, {
        content: [{type: 'text', text: 'Result of my_tool: {"a":1}'}],
      });
      assert.strictEqual(capturedName, 'my_tool');
    });

    it('does not invoke onResult when the tool result is flagged isError', async () => {
      let onResultFired = false;
      const catalog = createMcpCatalog(
        () => ({isError: true, content: []}),
        () => {
          onResultFired = true;
        },
      );
      const context = createTestDataContext(new DataModel({}), catalog);

      await assert.rejects(async () => {
        await catalog.invoker('callMcpTool', {name: 'failing_tool'}, context);
      }, A2uiExpressionError);
      assert.strictEqual(onResultFired, false);
    });

    it('propagates onResult failures as A2uiExpressionError', async () => {
      const catalog = createMcpCatalog(createRecordingCaller(), () => {
        throw new Error('template fetch failed');
      });
      const context = createTestDataContext(new DataModel({}), catalog);

      await assert.rejects(
        async () => {
          await catalog.invoker('callMcpTool', {name: 'tool'}, context);
        },
        (err: any) => {
          assert.ok(err instanceof A2uiExpressionError);
          assert.ok(err.message.includes('template fetch failed'));
          return true;
        },
      );
    });

    it('passes onResult callback through createMcpCatalog', async () => {
      let onResultFired = false;
      const catalog = createMcpCatalog(createRecordingCaller(), (_result, name) => {
        onResultFired = true;
        assert.strictEqual(name, 'tool_via_catalog');
      });
      const context = createTestDataContext(new DataModel({}), catalog);

      await catalog.invoker('callMcpTool', {name: 'tool_via_catalog'}, context);
      assert.strictEqual(onResultFired, true);
    });

    it('resolves dynamic data bindings for name and arguments via DataContext', async () => {
      const caller = createRecordingCaller();
      const catalog = createMcpCatalog(caller);

      const dataModel = new DataModel({
        toolName: 'get_forecast',
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
            text: 'Result of get_forecast: {"city":"Paris","days":3,"unit":"metric"}',
          },
        ],
      });
      assert.strictEqual(caller.calls[0].toolName, 'get_forecast');
      assert.deepStrictEqual(caller.calls[0].args, {
        city: 'Paris',
        days: 3,
        unit: 'metric',
      });
    });

    it('treats "path" and "call" argument keys as literal tool arguments', async () => {
      const caller = createRecordingCaller();
      const catalog = createMcpCatalog(caller);
      const context = createTestDataContext(new DataModel({path: 'SHOULD_NOT_RESOLVE'}), catalog);

      await catalog.invoker(
        'callMcpTool',
        {
          name: 'read_file',
          arguments: {path: '/tmp/notes.txt', call: 'transcribe'},
        },
        context,
      );

      assert.deepStrictEqual(caller.calls[0].args, {
        path: '/tmp/notes.txt',
        call: 'transcribe',
      });
    });

    it('passes literal objects that merely contain a path property through untouched', async () => {
      const caller = createRecordingCaller();
      const impl = createCallMcpToolImplementation(caller);
      const customCatalog = new Catalog('test-literal-objects', [], [impl]);
      const dataModel = new DataModel({docs: 'SHOULD_NOT_RESOLVE', city: 'Paris'});
      const context = createTestDataContext(dataModel, customCatalog);

      // Bypasses schema validation, which would strip the extra literal keys.
      await impl.execute(
        {
          name: 'search',
          arguments: {
            filter: {path: '/docs', recursive: true},
            city: {path: '/city'},
          },
        },
        context,
      );

      assert.deepStrictEqual(caller.calls[0].args, {
        filter: {path: '/docs', recursive: true},
        city: 'Paris',
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
        arguments: {uri: 'a2ui://form'},
      });
      assert.deepStrictEqual(valid, {
        name: 'read_resource',
        arguments: {uri: 'a2ui://form'},
      });
    });

    it('does not declare a server argument in the published schema', () => {
      const args = (mcpCatalogJson as any).functions.callMcpTool.properties.args;
      assert.deepStrictEqual(Object.keys(args.properties), ['name', 'arguments']);
      assert.strictEqual(args.additionalProperties, false);
    });
  });

  describe('MessageProcessor Integration', () => {
    it('works seamlessly alongside basic catalog in MessageProcessor', async () => {
      const mcpCatalog = createMcpCatalog(createRecordingCaller());
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
