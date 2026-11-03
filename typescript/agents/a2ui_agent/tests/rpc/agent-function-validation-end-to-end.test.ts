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

import {type FunctionImplementation, MessageProcessor} from '@a2ui/web_core';
import {describe, expect, test} from 'vitest';
import {z} from 'zod';

import {
  A2uiGenerator,
  A2uiValidationError,
  AgentFunction,
  AgentFunctionRegistry,
  Catalog,
  CatalogConfig,
  ComponentPruningTransformer,
  DirectJsonFormat,
  DirectJsonFormatFactory,
  DirectJsonParser,
  ExpressFormat,
  ExpressParser,
  FunctionPruningTransformer,
  RendererFunctionCalls,
  RendererMessageRouter,
  resolveCatalogs,
  validatePayload,
} from '../../src/index.js';

function createTestCatalog(): Catalog {
  const baseCatalog = Catalog.fromJson({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    catalogId: 'https://example.com/finance/catalog.json',
    protocolVersion: '1.0',
    components: {
      Text: {
        type: 'object',
        allOf: [
          {$ref: 'common_types.json#/$defs/ComponentCommon'},
          {
            properties: {
              component: {const: 'Text'},
              text: {$ref: 'common_types.json#/$defs/DynamicString'},
            },
            required: ['component', 'text'],
          },
        ],
        unevaluatedProperties: false,
      },
    },
    functions: {
      declaredRate: {
        type: 'object',
        description: 'Declared exchange rate lookup.',
        returnType: 'string',
        allOf: [
          {$ref: 'common_types.json#/$defs/FunctionCommon'},
          {
            properties: {
              '@call': {const: 'declaredRate'},
              args: {
                type: 'object',
                properties: {
                  base: {type: 'string'},
                  target: {type: 'string', default: 'USD'},
                },
                required: ['base'],
                unevaluatedProperties: false,
              },
            },
            required: ['@call', 'args'],
          },
        ],
        unevaluatedProperties: false,
      },
    },
    $defs: {
      anyComponent: {
        oneOf: [{$ref: '#/components/Text'}],
        discriminator: {propertyName: 'component'},
      },
      anyFunction: {
        oneOf: [{$ref: '#/functions/declaredRate'}],
      },
    },
  });

  const declaredFn = baseCatalog.functions.get('declaredRate')!;
  const boundDeclared = AgentFunction.fromApi(
    declaredFn,
    (args: Record<string, unknown>) => `${String(args['base'])}/${String(args['target'])}=1.08`,
  );
  const codeDefined = new AgentFunction({
    name: 'fetchTicker',
    returnType: 'string',
    description: 'Fetches a ticker price.',
    schema: z.object({symbol: z.string()}).strict(),
    handler: (args: {symbol: string}) => `${args.symbol}:150.00`,
  });

  return baseCatalog.copyWith({agentFunctions: [boundDeclared, codeDefined]});
}

describe('Agent Functions End-to-End Integration', () => {
  test('DirectJsonPromptGenerator and ExpressPromptGenerator include agent functions', () => {
    const catalog = createTestCatalog();

    const directPrompt = new DirectJsonFormat([catalog]).promptGenerator.generate();
    expect(directPrompt).toContain('declaredRate');
    expect(directPrompt).toContain('fetchTicker');

    const expressPrompt = new ExpressFormat([catalog]).promptGenerator.generate();
    expect(expressPrompt).toContain('declaredRate');
    expect(expressPrompt).toContain('fetchTicker');
  });

  test('DirectJsonParser and ExpressParser compile calls to agent functions and reject bad args', () => {
    const catalog = createTestCatalog();
    const directParser = new DirectJsonParser([catalog]);
    const expressParser = new ExpressParser([catalog]);

    const directBlock = JSON.stringify([
      {
        version: '1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: catalog.id,
          components: [
            {
              id: 'root',
              component: 'Text',
              text: {'@call': 'fetchTicker', args: {symbol: 'GOOG'}},
            },
          ],
        },
      },
    ]);
    const compiledDirect = directParser.compile(directBlock);
    validatePayload([catalog], compiledDirect);
    expect(compiledDirect).toHaveLength(1);

    const expressBlock = `root = Text(text=fetchTicker(symbol="GOOG"))`;
    const compiledExpress = expressParser.compile(expressBlock);
    validatePayload([catalog], compiledExpress);
    expect(compiledExpress).toHaveLength(1);

    expect(() =>
      validatePayload(
        [catalog],
        [
          {
            version: '1.0',
            createSurface: {
              surfaceId: 's1',
              catalogId: catalog.id,
              components: [
                {
                  id: 'root',
                  component: 'Text',
                  text: {'@call': 'fetchTicker', args: {wrongArg: 123}},
                },
              ],
            },
          },
        ],
      ),
    ).toThrow(A2uiValidationError);
  });

  test('Catalog transformers and resolveCatalogs preserve unpruned agent functions', () => {
    const catalog = createTestCatalog();
    const compPruned = new ComponentPruningTransformer(['Text']).transform(catalog);
    expect([...compPruned.agentFunctions.keys()]).toEqual(['declaredRate', 'fetchTicker']);

    const fnPruned = new FunctionPruningTransformer(['fetchTicker']).transform(catalog);
    expect([...fnPruned.agentFunctions.keys()]).toEqual(['fetchTicker']);

    const resolved = resolveCatalogs(
      [new CatalogConfig(catalog, [new FunctionPruningTransformer(['declaredRate'])])],
      {'1.0': {supportedCatalogIds: [catalog.id]}},
    );
    expect(resolved).toHaveLength(1);
    expect([...resolved[0].agentFunctions.keys()]).toEqual(['declaredRate']);

    const generator = new A2uiGenerator(
      [new CatalogConfig(catalog)],
      undefined,
      new DirectJsonFormatFactory(),
    );
    const proc = generator.createProcessor({
      '1.0': {supportedCatalogIds: [catalog.id]},
    });
    expect(proc.catalogs[0].agentFunctions.size).toBe(2);
  });

  test('Full bidirectional RPC roundtrip between MessageProcessor and Agent (Registry + Calls + Router)', async () => {
    const agentCatalog = createTestCatalog();
    const getLocaleImpl: FunctionImplementation = {
      name: 'getLocale',
      returnType: 'string',
      allowedCallers: 'agentOnly',
      schema: z.object({}).strict(),
      execute: () => 'en-GB',
    };
    const rendererCatalog = agentCatalog.withEntries(
      [...agentCatalog.components.values()],
      [...agentCatalog.functions.values(), getLocaleImpl],
    );

    const registry = new AgentFunctionRegistry([agentCatalog]);
    const rendererCalls = new RendererFunctionCalls();

    const outboundFromRenderer: Array<Record<string, unknown>> = [];
    const processor = new MessageProcessor([rendererCatalog], undefined, {
      version: '1.0',
      outboundListener: msg => {
        outboundFromRenderer.push(msg as unknown as Record<string, unknown>);
      },
    });

    const router = new RendererMessageRouter({
      registry,
      rendererCalls,
    });

    processor.processMessages([
      {
        version: '1.0',
        createSurface: {
          surfaceId: 's1',
          catalogId: rendererCatalog.id,
          components: [
            {
              id: 'root',
              component: 'Text',
              text: 'Ready',
            },
          ],
        },
      },
    ]);

    // 1. Renderer calls an agent function on the agent via callAgentFunction
    const agentCallPromise = processor.callAgentFunction<string>('s1', {
      '@call': 'declaredRate',
      catalogId: agentCatalog.id,
      args: {base: 'EUR'},
    });

    expect(outboundFromRenderer).toHaveLength(1);
    const agentResponse = await router.route(outboundFromRenderer.shift()!);
    expect(agentResponse).not.toBeNull();
    processor.processMessages([agentResponse!]);
    await expect(agentCallPromise).resolves.toBe('EUR/USD=1.08');

    // 2. Agent calls a renderer function on the renderer via callRendererFunction
    const [callRendererMsg, localePromise] = rendererCalls.call<string>({
      catalogId: rendererCatalog.id,
      name: 'getLocale',
      surfaceId: 's1',
    });

    const rendererResponses = await processor.processMessagesAsync([callRendererMsg]);
    expect(rendererResponses).toHaveLength(1);
    expect(outboundFromRenderer).toHaveLength(1);
    await router.route(outboundFromRenderer.shift()!);
    await expect(localePromise).resolves.toBe('en-GB');
  });
});
