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

import {describe, it, afterEach, beforeEach} from 'node:test';
import * as assert from 'node:assert';
import {
  DataModel,
  DataContext,
  A2uiExpressionError,
  Catalog,
  MessageProcessor,
} from '@a2ui/web_core/v0_9';
import type {CallToolResult, ReadResourceResult} from '@modelcontextprotocol/sdk/types.js';
import type {z} from 'zod';
import {MCP_CATALOG_ID, mcpCatalog} from '../catalog.js';
import {configureMcpCatalog, resetMcpCatalogConfig} from '../mcp_catalog_config.js';
import {
  A2UI_MIME_TYPE,
  CallMcpToolApi,
  CallMcpToolImplementation,
  MCP_APP_MIME_TYPE,
  createCallMcpToolImplementation,
  ensureMessageVersion,
  extractA2uiMessages,
  extractInlineMcpAppResources,
  extractMcpAppResourceLinkUris,
  parseA2uiMessages,
  parseMcpAppResources,
  readUiResourceUris,
  type McpAppResourcePayload,
  type McpToolClient,
} from './callMcpTool.js';
import mcpCatalogJson from '../catalog.json' with {type: 'json'};

const SURFACE_CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
const UI_RESOURCE_URI = 'a2ui://sample-ui';
const SECOND_RESOURCE_URI = 'a2ui://sample-ui-2';

const sampleMessages = [
  {createSurface: {surfaceId: 'test-surface', catalogId: SURFACE_CATALOG_ID}},
  {
    updateComponents: {
      surfaceId: 'test-surface',
      components: [{id: 'root', component: 'Text', properties: {text: {literal: 'Hi'}}}],
    },
  },
];

const uiResource: ReadResourceResult = {
  contents: [
    {uri: UI_RESOURCE_URI, mimeType: A2UI_MIME_TYPE, text: JSON.stringify(sampleMessages)},
  ],
};

/** A second UI resource, for tools that name more than one. */
const secondUiResource: ReadResourceResult = {
  contents: [
    {
      uri: SECOND_RESOURCE_URI,
      mimeType: A2UI_MIME_TYPE,
      text: JSON.stringify([
        {createSurface: {surfaceId: 'second-surface', catalogId: SURFACE_CATALOG_ID}},
      ]),
    },
  ],
};

interface RecordedCall {
  toolName: string;
  args: Record<string, any>;
}

interface FakeClientOptions {
  /** Result returned from `tools/call`, or a factory over the request params. */
  result?: CallToolResult | ((toolName: string, args: Record<string, any>) => any);
  resource?: ReadResourceResult;
  /** Resources served by `resources/read`, keyed by URI. */
  resources?: Record<string, ReadResourceResult>;
  /** Tool descriptors served by `tools/list`. Pass `null` to omit the method. */
  tools?: Array<{name: string; _meta?: unknown}> | null;
  listToolsError?: Error;
}

/** Mock MCP client that records tool calls and resource reads. */
interface FakeClient {
  calls: RecordedCall[];
  reads: string[];
  listToolsCount: number;
  request(request: any): Promise<any>;
  readResource(params: {uri: string}): Promise<any>;
  listTools?(): Promise<{tools: any[]}>;
}

/** Casts a `FakeClient` to `McpToolClient`. */
const asClient = (client: FakeClient) => client as McpToolClient;

function createFakeClient(options: FakeClientOptions = {}): FakeClient {
  const calls: RecordedCall[] = [];
  const reads: string[] = [];

  const client: FakeClient = {
    calls,
    reads,
    listToolsCount: 0,
    async request(request: any) {
      assert.strictEqual(request.method, 'tools/call');
      const {name, arguments: args} = request.params;
      calls.push({toolName: name, args});
      const {result} = options;
      if (typeof result === 'function') {
        return result(name, args);
      }
      return (
        result ?? {content: [{type: 'text', text: `Result of ${name}: ${JSON.stringify(args)}`}]}
      );
    },
    async readResource({uri}) {
      reads.push(uri);
      return options.resources?.[uri] ?? options.resource ?? uiResource;
    },
  };

  if (options.tools !== null) {
    client.listTools = async () => {
      client.listToolsCount++;
      if (options.listToolsError) {
        throw options.listToolsError;
      }
      return {tools: options.tools ?? []};
    };
  }

  return client;
}

const createTestDataContext = (model: DataModel, catalog: Catalog<any>, path = '/') => {
  const mockSurface = {
    dataModel: model,
    defaultCatalog: {invoker: catalog.invoker},
    availableCatalogs: new Map(),
    dispatchError: () => {},
  } as any;
  return new DataContext(mockSurface, path);
};

describe('callMcpTool', () => {
  let processor: MessageProcessor<any>;

  /** Creates a test catalog bound to `client`. */
  const catalogFor = (client: FakeClient) =>
    new Catalog<any>(
      MCP_CATALOG_ID,
      '0.9',
      [],
      [
        createCallMcpToolImplementation(() => ({
          defaultVersion: 'v0.9',
          getMcpClientForTool: () => asClient(client),
          processor,
        })),
      ],
    );

  /** Creates an inline A2UI resource content block. */
  const dataBlock = (value: Record<string, unknown>, surfaceId = 'test-surface') => ({
    type: 'resource' as const,
    resource: {
      uri: 'a2ui://inline-data',
      mimeType: A2UI_MIME_TYPE,
      text: JSON.stringify([{updateDataModel: {surfaceId, value}}]),
    },
  });

  const withUiResourceMeta = (content: unknown[] = []) =>
    ({_meta: {ui: {resourceUri: UI_RESOURCE_URI}}, content}) as CallToolResult;

  beforeEach(() => {
    processor = new MessageProcessor<any>(
      [new Catalog(SURFACE_CATALOG_ID, '0.9', [], [])],
      async () => {},
    );
  });

  describe('CallMcpToolApi Schema', () => {
    it('has correct metadata', () => {
      assert.strictEqual(CallMcpToolApi.name, 'callMcpTool');
      assert.strictEqual(CallMcpToolApi.returnType, 'any');
    });

    it('parses valid minimal arguments with default empty arguments object', () => {
      const parsed = CallMcpToolApi.schema.parse({name: 'get_time'});
      assert.deepStrictEqual(parsed, {name: 'get_time', arguments: {}});
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
        arguments: {city: {path: '/user/city'}, count: 10},
      });
      assert.deepStrictEqual(parsed, {
        name: {path: '/selectedTool'},
        arguments: {city: {path: '/user/city'}, count: 10},
      });
    });

    it('drops a server argument, since servers are resolved by the host', () => {
      const parsed = CallMcpToolApi.schema.parse({
        name: 'fetch_weather',
        server: 'weather-service',
      } as any);
      assert.deepStrictEqual(parsed, {name: 'fetch_weather', arguments: {}});
    });

    it('throws validation error when name is missing', () => {
      assert.throws(() => {
        CallMcpToolApi.schema.parse({});
      });
    });
  });

  describe('tool invocation', () => {
    it('issues tools/call on the resolved client and returns the raw result', async () => {
      const client = createFakeClient();
      const catalog = catalogFor(client);
      assert.strictEqual(catalog.id, MCP_CATALOG_ID);

      const context = createTestDataContext(new DataModel({}), catalog);
      const result = await catalog.invoker(
        'callMcpTool',
        {name: 'counter', arguments: {count: 5}},
        context,
      );

      assert.deepStrictEqual(client.calls, [{toolName: 'counter', args: {count: 5}}]);
      assert.deepStrictEqual(result, {
        content: [{type: 'text', text: 'Result of counter: {"count":5}'}],
      });
    });

    it('passes an empty arguments object when no arguments are supplied', async () => {
      const client = createFakeClient();
      const catalog = catalogFor(client);
      const context = createTestDataContext(new DataModel({}), catalog);

      await catalog.invoker('callMcpTool', {name: 'ping'}, context);

      assert.deepStrictEqual(client.calls[0].args, {});
    });

    it('resolves the client per tool name, so payloads never name a server', async () => {
      const weather = createFakeClient();
      const clock = createFakeClient();
      const catalog = new Catalog<any>(
        MCP_CATALOG_ID,
        '0.9',
        [],
        [
          createCallMcpToolImplementation(() => ({
            defaultVersion: 'v0.9',
            getMcpClientForTool: toolName => asClient(toolName === 'get_time' ? clock : weather),
            processor,
          })),
        ],
      );
      const context = createTestDataContext(new DataModel({}), catalog);

      await catalog.invoker('callMcpTool', {name: 'get_time'}, context);

      assert.strictEqual(clock.calls.length, 1);
      assert.strictEqual(weather.calls.length, 0);
    });

    it('awaits an async client resolver', async () => {
      const client = createFakeClient();
      const catalog = new Catalog<any>(
        MCP_CATALOG_ID,
        '0.9',
        [],
        [
          createCallMcpToolImplementation(() => ({
            defaultVersion: 'v0.9',
            getMcpClientForTool: async () => asClient(client),
            processor,
          })),
        ],
      );
      const context = createTestDataContext(new DataModel({}), catalog);

      await catalog.invoker('callMcpTool', {name: 'ping'}, context);

      assert.strictEqual(client.calls.length, 1);
    });

    it('throws A2uiExpressionError when the client cannot be resolved', async () => {
      const catalog = new Catalog<any>(
        MCP_CATALOG_ID,
        '0.9',
        [],
        [
          createCallMcpToolImplementation(() => ({
            defaultVersion: 'v0.9',
            getMcpClientForTool: () => {
              throw new Error('No MCP client connected');
            },
            processor,
          })),
        ],
      );
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

    it('throws A2uiExpressionError when resolver returns null or undefined', async () => {
      const catalog = new Catalog<any>(
        MCP_CATALOG_ID,
        '0.9',
        [],
        [
          createCallMcpToolImplementation(() => ({
            defaultVersion: 'v0.9',
            getMcpClientForTool: () => undefined,
            processor,
          })),
        ],
      );
      const context = createTestDataContext(new DataModel({}), catalog);

      await assert.rejects(
        async () => {
          await catalog.invoker('callMcpTool', {name: 'missing_tool'}, context);
        },
        (err: any) => {
          assert.ok(err instanceof A2uiExpressionError);
          assert.strictEqual(err.expression, 'callMcpTool');
          assert.ok(
            err.message.includes("MCP client for tool 'missing_tool' could not be resolved."),
          );
          return true;
        },
      );
    });

    it('throws A2uiExpressionError when the result is flagged isError, applying nothing', async () => {
      const client = createFakeClient({
        result: {
          _meta: {ui: {resourceUri: UI_RESOURCE_URI}},
          isError: true,
          content: [{type: 'text', text: 'database connection failed'}],
        },
      });
      const catalog = catalogFor(client);
      const context = createTestDataContext(new DataModel({}), catalog);

      await assert.rejects(
        async () => {
          await catalog.invoker('callMcpTool', {name: 'failing_tool'}, context);
        },
        (err: any) => {
          assert.ok(err instanceof A2uiExpressionError);
          assert.ok(err.message.includes("MCP tool 'failing_tool' execution failed"));
          assert.ok(err.message.includes('database connection failed'));
          return true;
        },
      );
      assert.deepStrictEqual(client.reads, []);
    });

    it('throws A2uiExpressionError when the tool returns nothing', async () => {
      const catalog = catalogFor(createFakeClient({result: () => undefined}));
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
      const catalog = catalogFor(createFakeClient());
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
  });

  describe('result handling', () => {
    const invoke = (client: FakeClient, toolName = 'get_sample_data') => {
      const catalog = catalogFor(client);
      return catalog.invoker(
        'callMcpTool',
        {name: toolName},
        createTestDataContext(new DataModel({}), catalog),
      );
    };

    it('reads the UI resource named by result._meta and applies its messages', async () => {
      const client = createFakeClient({result: withUiResourceMeta()});
      await invoke(client);

      assert.deepStrictEqual(client.reads, [UI_RESOURCE_URI]);
      assert.ok(processor.model.getSurface('test-surface'));
    });

    it('falls back to the UI resource a tool declares in tools/list', async () => {
      const client = createFakeClient({
        result: {content: [dataBlock({title: 'Discovered'})]},
        tools: [{name: 'get_sample_data', _meta: {ui: {resourceUri: UI_RESOURCE_URI}}}],
      });

      await invoke(client);

      assert.deepStrictEqual(client.reads, [UI_RESOURCE_URI]);
      assert.strictEqual(
        processor.model.getSurface('test-surface')!.dataModel.get('/title'),
        'Discovered',
      );
    });

    it('prefers the result _meta URI over the declared one', async () => {
      const client = createFakeClient({
        result: withUiResourceMeta(),
        tools: [{name: 'get_sample_data', _meta: {ui: {resourceUri: 'a2ui://declared'}}}],
      });

      await invoke(client);

      assert.deepStrictEqual(client.reads, [UI_RESOURCE_URI]);
    });

    it('reads every UI resource the result names, in order', async () => {
      const client = createFakeClient({
        result: {
          _meta: {ui: {resourceUri: [UI_RESOURCE_URI, SECOND_RESOURCE_URI, UI_RESOURCE_URI]}},
          content: [],
        } as CallToolResult,
        resources: {[UI_RESOURCE_URI]: uiResource, [SECOND_RESOURCE_URI]: secondUiResource},
      });

      await invoke(client);

      // The repeated URI is read once, and both surfaces are created.
      assert.deepStrictEqual(client.reads, [UI_RESOURCE_URI, SECOND_RESOURCE_URI]);
      assert.ok(processor.model.getSurface('test-surface'));
      assert.ok(processor.model.getSurface('second-surface'));
    });

    it('reads every UI resource a tool declares in tools/list', async () => {
      const client = createFakeClient({
        result: {content: []},
        tools: [
          {
            name: 'get_sample_data',
            _meta: {ui: {resourceUri: [UI_RESOURCE_URI, SECOND_RESOURCE_URI]}},
          },
        ],
        resources: {[UI_RESOURCE_URI]: uiResource, [SECOND_RESOURCE_URI]: secondUiResource},
      });

      await invoke(client);

      assert.deepStrictEqual(client.reads, [UI_RESOURCE_URI, SECOND_RESOURCE_URI]);
      assert.ok(processor.model.getSurface('test-surface'));
      assert.ok(processor.model.getSurface('second-surface'));
    });

    it('applies every inline A2UI resource of one result', async () => {
      // Distinct paths, so a later block cannot overwrite an earlier one.
      const pathBlock = (path: string, value: unknown) => ({
        type: 'resource' as const,
        resource: {
          uri: `a2ui://recipe-card${path}`,
          mimeType: A2UI_MIME_TYPE,
          text: JSON.stringify([{updateDataModel: {surfaceId: 'test-surface', path, value}}]),
        },
      });
      const client = createFakeClient({
        result: withUiResourceMeta([
          pathBlock('/title', 'First'),
          {type: 'text', text: 'prose between the payloads'},
          pathBlock('/subtitle', 'Second'),
        ]),
      });

      await invoke(client);

      const surface = processor.model.getSurface('test-surface')!;
      assert.strictEqual(surface.dataModel.get('/title'), 'First');
      assert.strictEqual(surface.dataModel.get('/subtitle'), 'Second');
    });

    it('ignores A2UI messages in a text block, which is prose for the model', async () => {
      const client = createFakeClient({
        result: withUiResourceMeta([
          {
            type: 'text',
            text: JSON.stringify([
              {updateDataModel: {surfaceId: 'test-surface', path: '/title', value: 'Smuggled'}},
            ]),
          },
        ]),
      });

      await invoke(client);

      assert.strictEqual(
        processor.model.getSurface('test-surface')!.dataModel.get('/title'),
        undefined,
      );
    });

    it('discovers declared UI resource URIs once per client', async () => {
      const client = createFakeClient({
        result: {content: []},
        tools: [{name: 'get_sample_data', _meta: {ui: {resourceUri: UI_RESOURCE_URI}}}],
      });
      const catalog = catalogFor(client);
      const context = createTestDataContext(new DataModel({}), catalog);

      await catalog.invoker('callMcpTool', {name: 'get_sample_data'}, context);
      await catalog.invoker('callMcpTool', {name: 'get_sample_data'}, context);

      assert.strictEqual(client.listToolsCount, 1);
    });

    it('tolerates clients without tools/list and servers that fail it', async () => {
      const noListing = createFakeClient({result: {content: []}, tools: null});
      await invoke(noListing);
      assert.deepStrictEqual(noListing.reads, []);

      const failing = createFakeClient({
        result: {content: []},
        listToolsError: new Error('Tool list error'),
      });
      await invoke(failing);
      assert.deepStrictEqual(failing.reads, []);
    });

    it('caches messages per resource URI and reuses the surface they created', async () => {
      const client = createFakeClient({result: withUiResourceMeta([dataBlock({title: 'Second'})])});
      const catalog = catalogFor(client);
      const context = createTestDataContext(new DataModel({}), catalog);

      await catalog.invoker('callMcpTool', {name: 'get_sample_data'}, context);
      // Re-processing createSurface for a live surface would throw A2uiStateError.
      await catalog.invoker('callMcpTool', {name: 'get_sample_data'}, context);

      assert.deepStrictEqual(client.reads, [UI_RESOURCE_URI]);
      assert.strictEqual(
        processor.model.getSurface('test-surface')!.dataModel.get('/title'),
        'Second',
      );
    });

    it('applies data messages onto a surface the UI resource did not create', async () => {
      processor.processMessages([
        {version: 'v0.9', createSurface: {surfaceId: 'existing', catalogId: SURFACE_CATALOG_ID}},
      ] as any);
      const client = createFakeClient({
        result: {content: [dataBlock({greeting: 'hi'}, 'existing')]},
      });

      await invoke(client, 'greet');

      assert.strictEqual(processor.model.getSurface('existing')!.dataModel.get('/greeting'), 'hi');
    });

    it('renders nothing when the resource holds no A2UI, without failing', async () => {
      const client = createFakeClient({
        result: withUiResourceMeta(),
        resource: {contents: [{uri: UI_RESOURCE_URI, mimeType: 'text/plain', text: 'not a2ui'}]},
      });

      const result = await invoke(client);

      assert.deepStrictEqual(client.reads, [UI_RESOURCE_URI]);
      assert.strictEqual(processor.model.getSurface('test-surface'), undefined);
      assert.ok(result);
    });

    it('fails when a resource declares the A2UI MIME type but holds invalid JSON', async () => {
      const client = createFakeClient({
        result: withUiResourceMeta(),
        resource: {contents: [{uri: UI_RESOURCE_URI, mimeType: A2UI_MIME_TYPE, text: 'not json'}]},
      });

      await assert.rejects(
        () => invoke(client),
        /declares application\/a2ui\+json but does not hold valid JSON\./,
      );
    });
  });

  describe('dynamic values', () => {
    it('resolves dynamic data bindings for name and arguments via DataContext', async () => {
      const client = createFakeClient();
      const catalog = catalogFor(client);

      const dataModel = new DataModel({
        toolName: 'get_forecast',
        location: 'Paris',
        options: {days: 3},
      });
      const context = createTestDataContext(dataModel, catalog);

      await catalog.invoker(
        'callMcpTool',
        {
          name: {path: '/toolName'},
          arguments: {city: {path: '/location'}, days: {path: '/options/days'}, unit: 'metric'},
        },
        context,
      );

      assert.strictEqual(client.calls[0].toolName, 'get_forecast');
      assert.deepStrictEqual(client.calls[0].args, {city: 'Paris', days: 3, unit: 'metric'});
    });

    it('treats "path" and "call" argument keys as literal tool arguments', async () => {
      const client = createFakeClient();
      const catalog = catalogFor(client);
      const context = createTestDataContext(new DataModel({path: 'SHOULD_NOT_RESOLVE'}), catalog);

      await catalog.invoker(
        'callMcpTool',
        {name: 'read_file', arguments: {path: '/tmp/notes.txt', call: 'transcribe'}},
        context,
      );

      assert.deepStrictEqual(client.calls[0].args, {
        path: '/tmp/notes.txt',
        call: 'transcribe',
      });
    });

    it('passes literal objects that merely contain a path property through untouched', async () => {
      const client = createFakeClient();
      const impl = createCallMcpToolImplementation(() => ({
        defaultVersion: 'v0.9',
        getMcpClientForTool: () => asClient(client),
        processor,
      }));
      const catalog = new Catalog('test-literal-objects', '0.9', [], [impl]);
      const dataModel = new DataModel({docs: 'SHOULD_NOT_RESOLVE', city: 'Paris'});
      const context = createTestDataContext(dataModel, catalog);

      // Bypasses schema validation, which would strip the extra literal keys.
      await impl.execute(
        {
          name: 'search',
          arguments: {filter: {path: '/docs', recursive: true}, city: {path: '/city'}},
        },
        context,
      );

      assert.deepStrictEqual(client.calls[0].args, {
        filter: {path: '/docs', recursive: true},
        city: 'Paris',
      });
    });
  });

  describe('catalog.json Schema Verification', () => {
    it('loads schema into a valid Catalog using Catalog.fromSchema', () => {
      const schemaCatalog = Catalog.fromSchema(mcpCatalogJson);
      assert.strictEqual(schemaCatalog.id, MCP_CATALOG_ID);
      assert.strictEqual(schemaCatalog.functions.has('callMcpTool'), true);

      const fnApi = schemaCatalog.functions.get('callMcpTool');
      assert.ok(fnApi);
      assert.strictEqual(fnApi.name, 'callMcpTool');
      assert.strictEqual(fnApi.returnType, 'any');

      const valid = fnApi.schema.parse({name: 'read_resource', arguments: {uri: 'a2ui://form'}});
      assert.deepStrictEqual(valid, {name: 'read_resource', arguments: {uri: 'a2ui://form'}});
    });

    it('declares the supported arguments in the published schema', () => {
      const args = (mcpCatalogJson as any).functions.callMcpTool.properties.args;
      assert.deepStrictEqual(Object.keys(args.properties), ['name', 'arguments', 'targetDataPath']);
      // A server argument is not among them: the host resolves servers.
      assert.strictEqual(args.additionalProperties, false);
    });

    it('no longer publishes a result expression, which the data functions replace', () => {
      const args = (mcpCatalogJson as any).functions.callMcpTool.properties.args;
      assert.strictEqual(args.properties.dataModelUpdate, undefined);
      assert.strictEqual('dataModelUpdate' in CallMcpToolApi.schema.shape, false);
    });

    it('publishes every function a host registers', () => {
      // A function missing from the JSON is invisible to an agent writing a
      // payload, however well it works at runtime.
      const registered = [...mcpCatalog.functions.keys()];
      assert.deepStrictEqual(
        Object.keys((mcpCatalogJson as any).functions).sort(),
        registered.sort(),
      );
    });

    it('publishes the argument names and descriptions the schemas carry', () => {
      // The catalog JSON is what an agent reads before writing a payload, and
      // it is generated from these schemas. This catches it going stale.
      for (const api of mcpCatalog.functions.values()) {
        if (api.name === CallMcpToolApi.name) {
          continue;
        }
        const published = (mcpCatalogJson as any).functions[api.name];
        assert.ok(published, `${api.name} is not published`);
        assert.strictEqual(published.returnType, api.returnType);

        const args = published.properties.args;
        const shape = (api.schema as z.ZodObject<Record<string, z.ZodTypeAny>>).shape;
        const fields = Object.keys(shape);
        assert.deepStrictEqual(Object.keys(args.properties), fields, `${api.name} arguments`);
        assert.deepStrictEqual(args.required, fields, `${api.name} required arguments`);
        assert.strictEqual(args.additionalProperties, false);

        for (const field of fields) {
          assert.strictEqual(
            args.properties[field].description,
            shape[field].description,
            `${api.name}.${field} description`,
          );
        }
      }
    });

    it('leaves pattern matching to the basic catalog rather than publishing its own', () => {
      assert.ok(!(mcpCatalogJson as any).functions.regexMatch, 'regexMatch is still published');
    });
  });

  describe('MessageProcessor Integration', () => {
    it('works seamlessly alongside another catalog in MessageProcessor', async () => {
      const client = createFakeClient();
      const mcpCatalog = catalogFor(client);
      processor = new MessageProcessor(
        [new Catalog(SURFACE_CATALOG_ID, '0.9', [], []), mcpCatalog],
        async () => {},
      );

      processor.processMessages([
        {version: 'v0.9', createSurface: {surfaceId: 'mcp-surface', catalogId: MCP_CATALOG_ID}},
      ]);

      const surface = processor.model.getSurface('mcp-surface');
      assert.ok(surface);

      const result = await surface.catalog.invoker(
        'callMcpTool',
        {name: 'get_user', arguments: {id: '123'}},
        new DataContext(surface, '/'),
      );

      assert.deepStrictEqual(result, {
        content: [{type: 'text', text: 'Result of get_user: {"id":"123"}'}],
      });
    });
  });
});

describe('message decoding', () => {
  describe('extractA2uiMessages', () => {
    /** An embedded resource block declaring the A2UI MIME type. */
    const a2uiBlock = (payload: unknown, uri = 'a2ui://data') => ({
      type: 'resource',
      resource: {uri, mimeType: A2UI_MIME_TYPE, text: JSON.stringify(payload)},
    });

    it('returns nothing for undefined, empty, and prose content', () => {
      assert.deepStrictEqual(extractA2uiMessages(undefined), []);
      assert.deepStrictEqual(extractA2uiMessages([]), []);
      assert.deepStrictEqual(extractA2uiMessages([{type: 'text', text: 'plain prose'}] as any), []);
    });

    it('ignores a text block, even one holding A2UI messages', () => {
      // Only the MIME type marks a payload as A2UI, so a text block is prose.
      const message = {updateDataModel: {surfaceId: 's', value: {a: 1}}};
      assert.deepStrictEqual(
        extractA2uiMessages([{type: 'text', text: JSON.stringify(message)}] as any),
        [],
      );
      assert.deepStrictEqual(
        extractA2uiMessages([{type: 'text', text: '{"temperature": 21}'}] as any),
        [],
      );
    });

    it('ignores an embedded resource that omits the A2UI MIME type', () => {
      const messages = [{updateDataModel: {surfaceId: 's', value: {calories: 500}}}];
      assert.deepStrictEqual(
        extractA2uiMessages([
          {type: 'resource', resource: {uri: 'a2ui://data', text: JSON.stringify(messages)}},
          {
            type: 'resource',
            resource: {
              uri: 'a2ui://data',
              mimeType: 'application/json',
              text: JSON.stringify(messages),
            },
          },
        ] as any),
        [],
      );
    });

    it('reads a message list out of an A2UI resource', () => {
      const messages = [{updateDataModel: {surfaceId: 's', value: {calories: 500}}}];
      assert.deepStrictEqual(extractA2uiMessages([a2uiBlock(messages)] as any), messages);
    });

    it('wraps a single message object in a list', () => {
      const message = {updateDataModel: {surfaceId: 's', value: {a: 1}}};
      assert.deepStrictEqual(extractA2uiMessages([a2uiBlock(message)] as any), [message]);
    });

    it('collects every A2UI resource in content order', () => {
      const first = {updateDataModel: {surfaceId: 's', value: {n: 1}}};
      const second = [{updateDataModel: {surfaceId: 's', value: {n: 2}}}];
      const third = {updateComponents: {surfaceId: 's', components: []}};

      const extracted = extractA2uiMessages([
        {type: 'text', text: 'prose'},
        a2uiBlock(first),
        {type: 'text', text: '{"unrelated": true}'},
        a2uiBlock(second),
        a2uiBlock(third),
      ] as any);

      assert.deepStrictEqual(extracted, [first, ...second, third]);
    });

    it('throws when a block declares the A2UI MIME type but holds invalid JSON', () => {
      assert.throws(
        () =>
          extractA2uiMessages([
            {
              type: 'resource',
              resource: {uri: 'a2ui://data', mimeType: A2UI_MIME_TYPE, text: 'not json'},
            },
          ] as any),
        /Resource a2ui:\/\/data declares application\/a2ui\+json but does not hold valid JSON\./,
      );
    });
  });

  describe('readUiResourceUris', () => {
    it('reads _meta.ui.resourceUri from results and tool descriptors alike', () => {
      assert.deepStrictEqual(readUiResourceUris({_meta: {ui: {resourceUri: 'a2ui://t'}}}), [
        'a2ui://t',
      ]);
      assert.deepStrictEqual(readUiResourceUris({}), []);
      assert.deepStrictEqual(readUiResourceUris({_meta: {ui: {resourceUri: 7}}}), []);
      assert.deepStrictEqual(readUiResourceUris(undefined), []);
    });

    it('reads an array of URIs, dropping non-strings and duplicates', () => {
      const uris = readUiResourceUris({
        _meta: {ui: {resourceUri: ['a2ui://a', 'a2ui://b', 'a2ui://a', '', 7, null]}},
      });
      assert.deepStrictEqual(uris, ['a2ui://a', 'a2ui://b']);
    });
  });

  describe('parseA2uiMessages', () => {
    it('decodes the content block declaring the A2UI MIME type', () => {
      const messages = [{createSurface: {surfaceId: 's', catalogId: 'c'}}];
      const parsed = parseA2uiMessages(
        {
          contents: [
            {uri: 'a2ui://t', mimeType: 'text/plain', text: 'ignored'},
            {uri: 'a2ui://t', mimeType: A2UI_MIME_TYPE, text: JSON.stringify(messages)},
          ],
        } as any,
        'a2ui://t',
      );
      assert.deepStrictEqual(parsed, messages);
    });

    it('concatenates every A2UI block of one resource, in order', () => {
      const surface = [{createSurface: {surfaceId: 's', catalogId: 'c'}}];
      const data = {updateDataModel: {surfaceId: 's', value: {n: 1}}};
      const parsed = parseA2uiMessages(
        {
          contents: [
            {uri: 'a2ui://t', mimeType: A2UI_MIME_TYPE, text: JSON.stringify(surface)},
            {uri: 'a2ui://t', mimeType: 'text/plain', text: 'ignored'},
            {uri: 'a2ui://t', mimeType: A2UI_MIME_TYPE, text: JSON.stringify(data)},
          ],
        } as any,
        'a2ui://t',
      );
      assert.deepStrictEqual(parsed, [...surface, data]);
    });

    it('returns nothing when no block declares the A2UI MIME type', () => {
      assert.deepStrictEqual(
        parseA2uiMessages(
          {contents: [{uri: 'a2ui://t', mimeType: 'text/plain', text: 'nope'}]} as any,
          'a2ui://t',
        ),
        [],
      );
      assert.deepStrictEqual(parseA2uiMessages(undefined, 'a2ui://t'), []);
    });

    it('throws when a declared A2UI block holds invalid JSON', () => {
      assert.throws(
        () =>
          parseA2uiMessages(
            {contents: [{uri: 'a2ui://t', mimeType: A2UI_MIME_TYPE, text: 'not json'}]} as any,
            'a2ui://t',
          ),
        /Resource a2ui:\/\/t declares application\/a2ui\+json but does not hold valid JSON\./,
      );
    });
  });

  describe('ensureMessageVersion', () => {
    it('sets version to v1.0 when version property is missing', () => {
      const msg = {createSurface: {surfaceId: 's', catalogId: 'c'}} as any;
      assert.deepStrictEqual(ensureMessageVersion(msg), {
        version: 'v1.0',
        createSurface: {surfaceId: 's', catalogId: 'c'},
      });
    });

    it('sets version to v1.0 when version is null or undefined', () => {
      const msgNull = {version: null, createSurface: {surfaceId: 's', catalogId: 'c'}} as any;
      assert.deepStrictEqual(ensureMessageVersion(msgNull), {
        version: 'v1.0',
        createSurface: {surfaceId: 's', catalogId: 'c'},
      });

      const msgUndefined = {
        version: undefined,
        createSurface: {surfaceId: 's', catalogId: 'c'},
      } as any;
      assert.deepStrictEqual(ensureMessageVersion(msgUndefined), {
        version: 'v1.0',
        createSurface: {surfaceId: 's', catalogId: 'c'},
      });
    });

    it('preserves existing explicit version', () => {
      const msg1 = {version: 'v1.0', createSurface: {surfaceId: 's', catalogId: 'c'}} as any;
      assert.deepStrictEqual(ensureMessageVersion(msg1), msg1);

      const msg09 = {version: 'v0.9', createSurface: {surfaceId: 's', catalogId: 'c'}} as any;
      assert.deepStrictEqual(ensureMessageVersion(msg09), msg09);
    });

    it('returns primitive or non-object values as-is', () => {
      assert.strictEqual(ensureMessageVersion(null as any), null);
      assert.strictEqual(ensureMessageVersion(undefined as any), undefined);
      assert.strictEqual(ensureMessageVersion('test' as any), 'test');
    });

    it('sets the given default version when version property is missing', () => {
      const msg = {createSurface: {surfaceId: 's', catalogId: 'c'}} as any;
      assert.deepStrictEqual(ensureMessageVersion(msg, 'v0.9'), {
        version: 'v0.9',
        createSurface: {surfaceId: 's', catalogId: 'c'},
      });

      const msg1 = {version: 'v1.0', createSurface: {surfaceId: 's', catalogId: 'c'}} as any;
      assert.deepStrictEqual(ensureMessageVersion(msg1, 'v0.9'), msg1);
    });
  });
});

describe('createCallMcpToolImplementation defaultVersion option', () => {
  /** Processes every message through a processor that records the versions it receives. */
  const invokeWith = async (options?: {defaultVersion: string}) => {
    const versions: unknown[] = [];
    const processor = {
      processMessages(messages: unknown[]) {
        versions.push(...messages.map(message => (message as {version: unknown}).version));
      },
      model: {getSurface: () => undefined},
    } as unknown as MessageProcessor<any>;
    const client = createFakeClient({
      result: {
        content: [
          {
            type: 'resource',
            resource: {
              uri: 'a2ui://inline',
              mimeType: A2UI_MIME_TYPE,
              text: JSON.stringify([
                {updateDataModel: {surfaceId: 's', value: {}}},
                {version: 'v0.9', updateDataModel: {surfaceId: 's', value: {}}},
              ]),
            },
          },
        ],
      },
    });
    const catalog = new Catalog<any>(
      MCP_CATALOG_ID,
      '0.9',
      [],
      [
        createCallMcpToolImplementation(() => ({
          getMcpClientForTool: () => asClient(client),
          processor,
          ...options,
        })),
      ],
    );
    await catalog.invoker(
      'callMcpTool',
      {name: 'tool'},
      createTestDataContext(new DataModel({}), catalog),
    );
    return versions;
  };

  it('stamps v1.0 on messages without a version by default', async () => {
    assert.deepStrictEqual(await invokeWith(), ['v1.0', 'v0.9']);
  });

  it('stamps the given version on messages without one and keeps explicit versions', async () => {
    assert.deepStrictEqual(await invokeWith({defaultVersion: 'v0.9'}), ['v0.9', 'v0.9']);
  });
});

describe('CallMcpToolImplementation', () => {
  const catalog = new Catalog<any>(MCP_CATALOG_ID, '0.9', [], [CallMcpToolImplementation]);

  afterEach(() => {
    resetMcpCatalogConfig();
  });

  it('fails with a message naming configureMcpCatalog until the host configures it', async () => {
    await assert.rejects(
      catalog.invoker(
        'callMcpTool',
        {name: 'ping'},
        createTestDataContext(new DataModel({}), catalog),
      ),
      (err: any) => {
        assert.ok(err instanceof A2uiExpressionError);
        assert.strictEqual(err.expression, 'callMcpTool');
        assert.ok(err.message.includes('configureMcpCatalog'));
        return true;
      },
    );
  });

  it('calls the client the host configured, reading the configuration on each call', async () => {
    const first = createFakeClient();
    const second = createFakeClient();
    const processor = new MessageProcessor([], async () => {});
    const context = createTestDataContext(new DataModel({}), catalog);

    configureMcpCatalog({getMcpClientForTool: () => asClient(first), processor});
    await catalog.invoker('callMcpTool', {name: 'ping'}, context);
    configureMcpCatalog({getMcpClientForTool: () => asClient(second)});
    await catalog.invoker('callMcpTool', {name: 'ping'}, context);

    assert.strictEqual(first.calls.length, 1);
    assert.strictEqual(second.calls.length, 1);
  });
});

describe('MCP App HTML resources in callMcpTool', () => {
  const APP_URI = 'ui://server/dashboard';
  const APP_HTML = '<!doctype html><div id="app">Dashboard</div>';

  it('extracts MCP App HTML from resources/read and writes it to targetDataPath and onMcpAppResource', async () => {
    const processor = new MessageProcessor([], async () => {});
    const client = createFakeClient({
      result: {
        content: [{type: 'text', text: 'Loaded dashboard'}],
        structuredContent: {total: 42},
        _meta: {ui: {resourceUri: APP_URI}},
      } as any,
      resources: {
        [APP_URI]: {
          contents: [
            {
              uri: APP_URI,
              mimeType: MCP_APP_MIME_TYPE,
              text: APP_HTML,
              _meta: {
                ui: {
                  csp: {connectDomains: ['https://api.example.com']},
                  permissions: {clipboardWrite: {}},
                },
              },
            } as any,
          ],
        },
      },
    });

    const received: McpAppResourcePayload[] = [];
    const impl = createCallMcpToolImplementation(() => ({
      defaultVersion: 'v0.9',
      getMcpClientForTool: () => asClient(client),
      processor,
      onMcpAppResource: payload => received.push(payload),
    }));
    const catalog = new Catalog(MCP_CATALOG_ID, '0.9', [], [impl]);
    const dataModel = new DataModel({});
    const context = createTestDataContext(dataModel, catalog);

    await catalog.invoker(
      'callMcpTool',
      {
        name: 'open_dashboard',
        arguments: {region: 'eu'},
        targetDataPath: '/mcpApp',
      },
      context,
    );

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].resourceUri, APP_URI);
    assert.strictEqual(received[0].html, APP_HTML);
    assert.deepStrictEqual(received[0].csp, {connectDomains: ['https://api.example.com']});
    assert.deepStrictEqual(received[0].permissions, {clipboardWrite: {}});
    assert.deepStrictEqual(received[0].toolInput, {region: 'eu'});
    assert.strictEqual((received[0].toolResult as any).structuredContent.total, 42);
    assert.deepStrictEqual(dataModel.get('/mcpApp'), received[0]);
  });

  it('resolves resource_link content blocks and inline MCP App resources', async () => {
    const processor = new MessageProcessor([], async () => {});
    const linkUri = 'ui://server/linked-widget';
    const inlineUri = 'ui://server/inline-widget';
    const client = createFakeClient({
      result: {
        content: [
          {type: 'resource_link', uri: linkUri, mimeType: MCP_APP_MIME_TYPE},
          {
            type: 'resource',
            resource: {
              uri: inlineUri,
              mimeType: MCP_APP_MIME_TYPE,
              blob: btoa('<p>Inline blob</p>'),
            },
          },
        ],
      } as any,
      resources: {
        [linkUri]: {
          contents: [{uri: linkUri, mimeType: MCP_APP_MIME_TYPE, text: '<p>Linked</p>'}],
        },
      },
    });

    const received: McpAppResourcePayload[] = [];
    const impl = createCallMcpToolImplementation(() => ({
      defaultVersion: 'v0.9',
      getMcpClientForTool: () => asClient(client),
      processor,
      onMcpAppResource: payload => received.push(payload),
    }));
    const catalog = new Catalog(MCP_CATALOG_ID, '0.9', [], [impl]);
    const context = createTestDataContext(new DataModel({}), catalog);

    await catalog.invoker('callMcpTool', {name: 'load_widgets'}, context);

    assert.strictEqual(received.length, 2);
    assert.strictEqual(received[0].resourceUri, linkUri);
    assert.strictEqual(received[0].html, '<p>Linked</p>');
    assert.strictEqual(received[1].resourceUri, inlineUri);
    assert.strictEqual(received[1].html, '<p>Inline blob</p>');
  });

  it('unit-tests extractMcpAppResourceLinkUris, extractInlineMcpAppResources, and parseMcpAppResources', () => {
    assert.deepStrictEqual(
      extractMcpAppResourceLinkUris([
        {type: 'resource_link', uri: 'ui://app/one', mimeType: 'text/html'},
        {type: 'resource_link', uri: 'https://example.com/app', mimeType: MCP_APP_MIME_TYPE},
        {type: 'resource_link', uri: 'a2ui://ignore', mimeType: A2UI_MIME_TYPE},
      ] as any),
      ['ui://app/one', 'https://example.com/app'],
    );

    assert.deepStrictEqual(
      extractInlineMcpAppResources([
        {
          type: 'resource',
          resource: {uri: 'ui://app/inline', mimeType: MCP_APP_MIME_TYPE, text: '<h1>Hi</h1>'},
        },
      ] as any),
      [{resourceUri: 'ui://app/inline', html: '<h1>Hi</h1>'}],
    );

    assert.deepStrictEqual(
      parseMcpAppResources(
        {
          contents: [
            {uri: 'ui://app/read', mimeType: MCP_APP_MIME_TYPE, text: '<h1>Read</h1>'},
            {uri: 'ui://app/a2ui', mimeType: A2UI_MIME_TYPE, text: '[]'},
          ],
        } as any,
        'ui://app/read',
      ),
      [{resourceUri: 'ui://app/read', html: '<h1>Read</h1>'}],
    );
  });
});
