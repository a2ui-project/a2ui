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

import * as assert from 'node:assert';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, it} from 'node:test';

import {z} from 'zod';

import {
  A2uiCatalogError,
  A2uiValidationError,
  AgentFunction,
  Catalog,
  PayloadValidator,
  STRICT_VALIDATION,
  isAgentFunction,
  type AgentFunctionContext,
  type AgentFunctionHandler,
  type CatalogOptions,
  type FunctionApi,
} from '../index.js';
import * as rootApi from '../index.js';
import * as resolutionApi from '../resolution/index.js';
import * as v10Api from '../v1_0/index.js';

const FX_RATE_SCHEMA = z
  .object({
    base: z.string(),
    target: z.string().default('USD'),
  })
  .strict();

function handler(args: Record<string, unknown>, _context: AgentFunctionContext): number {
  return args['base'] === args['target'] ? 1.0 : 1.08;
}

function fetchFxRate(name = 'fetchFxRate'): AgentFunction {
  return new AgentFunction({
    name,
    returnType: 'number',
    schema: FX_RATE_SCHEMA,
    handler,
    description: 'Current exchange rate from base to target.',
  });
}

/**
 * A catalog document that declares `consultOracle` and `notify` without
 * implementing them, as a catalog an agent implements functions of would.
 */
const ORACLE_DOC = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://a2ui.org/test/oracle_catalog.json',
  protocolVersion: '1.0',
  catalogId: 'test/oracle',
  components: {},
  functions: {
    consultOracle: {
      type: 'object',
      description: 'Asks the oracle a question.',
      returnType: 'string',
      allowedCallers: 'rendererOrAgent',
      properties: {
        '@call': {const: 'consultOracle'},
        args: {
          type: 'object',
          properties: {question: {type: 'string'}},
          required: ['question'],
          unevaluatedProperties: false,
        },
      },
      required: ['@call', 'args'],
    },
    notify: {
      type: 'object',
      description: 'Shows the user a short message.',
      returnType: 'void',
      allowedCallers: 'agentOnly',
      properties: {
        '@call': {const: 'notify'},
        args: {
          type: 'object',
          properties: {message: {type: 'string'}},
          required: ['message'],
          unevaluatedProperties: false,
        },
      },
      required: ['@call', 'args'],
    },
  },
  $defs: {
    anyFunction: {
      oneOf: [{$ref: '#/functions/consultOracle'}, {$ref: '#/functions/notify'}],
    },
  },
};

function loadOracleCatalog(): Catalog<any, FunctionApi> {
  return Catalog.fromJson(structuredClone(ORACLE_DOC));
}

function loadBasicCatalog(): Catalog<any, FunctionApi> {
  const doc = JSON.parse(
    readFileSync(resolve(process.cwd(), '../../../catalogs/basic/v1/catalog.json'), 'utf-8'),
  );
  return Catalog.fromJson(doc);
}

describe('AgentFunction', () => {
  it('is a FunctionApi without an execute implementation', () => {
    const fn = fetchFxRate();

    assert.strictEqual(isAgentFunction(fn), true);
    assert.strictEqual('execute' in fn, false);
    assert.strictEqual((fn as {execute?: unknown}).execute, undefined);
    assert.strictEqual(fn.handler, handler);
    assert.strictEqual(fn.allowedCallers, 'rendererOnly');
    assert.strictEqual(fn.requiresUserActivation, false);
    assert.strictEqual(fn.declaration, undefined);
  });

  it('types the handler from the schema and returnType', async () => {
    const increment = new AgentFunction({
      name: 'increment',
      returnType: 'number',
      schema: z.object({x: z.number()}),
      handler: ({x}) => x + 1,
    });
    const erased: AgentFunction = increment;
    const context: AgentFunctionContext = {catalogId: 'c', surfaceId: 's', functionCallId: 'f'};

    assert.strictEqual(await erased.handler({x: 1}, context), 2);
    assert.strictEqual(isAgentFunction(erased), true);

    new AgentFunction({
      name: 'wrongReturn',
      returnType: 'number',
      schema: z.object({x: z.number()}),
      // @ts-expect-error A handler for a 'number' function can't return a string.
      handler: ({x}) => `${x}`,
    });
    new AgentFunction({
      name: 'wrongArgs',
      schema: z.object({x: z.number()}),
      // @ts-expect-error The schema has no `y`.
      handler: ({y}) => y,
    });
  });

  it('converts a JSON Schema object into a Zod schema', () => {
    const fn = new AgentFunction({
      name: 'lookupCustomer',
      returnType: 'number',
      schema: {
        type: 'object',
        properties: {
          id: {type: 'string', minLength: 1},
          includeHistory: {type: 'boolean', default: false},
        },
        required: ['id'],
        additionalProperties: false,
      },
      handler,
    });

    assert.deepStrictEqual(fn.schema.parse({id: 'c-42'}), {
      id: 'c-42',
      includeHistory: false,
    });
    assert.throws(() => fn.schema.parse({}));
    assert.throws(() => fn.schema.parse({id: 'c-42', extra: 1}));
  });

  it('rejects a handler that is not callable', () => {
    assert.throws(
      () =>
        new AgentFunction({
          name: 'fetchFxRate',
          handler: 'not callable' as unknown as typeof handler,
        }),
      (err: unknown) => err instanceof TypeError && err.message.includes('fetchFxRate'),
    );
  });

  it('is rendererOnly when built directly, whatever the init says', () => {
    const fn = new AgentFunction({
      name: 'fetchFxRate',
      handler,
      allowedCallers: 'agentOnly',
    } as unknown as ConstructorParameters<typeof AgentFunction>[0]);

    assert.strictEqual(fn.allowedCallers, 'rendererOnly');
    assert.strictEqual(fn.declaration, undefined);
  });

  it('accepts a handler that takes only the arguments', async () => {
    const echo: AgentFunctionHandler = args => args['value'];
    const fn = new AgentFunction({name: 'echo', handler: echo});
    const context: AgentFunctionContext = {
      catalogId: 'c',
      surfaceId: 's',
      functionCallId: 'call-1',
    };

    assert.strictEqual(await fn.handler({value: 7}, context), 7);
  });

  it('fromApi keeps the declaration metadata', () => {
    const declaration: FunctionApi = {
      name: 'consultOracle',
      returnType: 'string',
      schema: FX_RATE_SCHEMA,
      allowedCallers: 'rendererOnly',
      requiresUserActivation: true,
      description: 'Asks the oracle.',
    };

    const fn = AgentFunction.fromApi(declaration, handler);

    assert.strictEqual(fn.declaration, declaration);
    assert.strictEqual(fn.name, 'consultOracle');
    assert.strictEqual(fn.returnType, 'string');
    assert.strictEqual(fn.schema, declaration.schema);
    assert.strictEqual(fn.allowedCallers, 'rendererOnly');
    assert.strictEqual(fn.requiresUserActivation, true);
    assert.strictEqual(fn.description, 'Asks the oracle.');
  });

  it('fromApi accepts requiresUserActivation only on a rendererOnly declaration', () => {
    const declaration = (allowedCallers?: 'rendererOnly' | 'rendererOrAgent'): FunctionApi => ({
      name: 'confirmTransfer',
      returnType: 'boolean',
      schema: FX_RATE_SCHEMA,
      requiresUserActivation: true,
      ...(allowedCallers ? {allowedCallers} : {}),
    });

    assert.strictEqual(AgentFunction.fromApi(declaration(), handler).requiresUserActivation, true);
    assert.strictEqual(
      AgentFunction.fromApi(declaration('rendererOnly'), handler).requiresUserActivation,
      true,
    );
    assert.throws(
      () => AgentFunction.fromApi(declaration('rendererOrAgent'), handler),
      (err: unknown) =>
        err instanceof A2uiCatalogError &&
        err.message.includes('confirmTransfer') &&
        err.message.includes('rendererOnly'),
    );
    assert.strictEqual(
      AgentFunction.fromApi(
        {...declaration('rendererOrAgent'), requiresUserActivation: false},
        handler,
      ).allowedCallers,
      'rendererOrAgent',
    );
  });

  it('withHandler binds a new handler and keeps the rest of a direct agent function', () => {
    const fx = new AgentFunction({
      name: 'fetchFxRate',
      returnType: 'number',
      schema: FX_RATE_SCHEMA,
      requiresUserActivation: true,
      description: 'Current exchange rate.',
      handler,
    });
    const other = () => 2;

    const rebound = fx.withHandler(other);

    assert.notStrictEqual(rebound, fx);
    assert.strictEqual(rebound.handler, other);
    assert.strictEqual(fx.handler, handler);
    assert.strictEqual(rebound.name, 'fetchFxRate');
    assert.strictEqual(rebound.returnType, 'number');
    assert.strictEqual(rebound.schema, fx.schema);
    assert.strictEqual(rebound.allowedCallers, 'rendererOnly');
    assert.strictEqual(rebound.requiresUserActivation, true);
    assert.strictEqual(rebound.description, 'Current exchange rate.');
    assert.strictEqual(rebound.declaration, undefined);
    const json = (fn: AgentFunction) => new Catalog('c', '1.0', [], [fn]).toJson();
    assert.deepStrictEqual(json(rebound), json(fx));
  });

  it('withHandler rebuilds a fromApi agent function from its declaration', () => {
    const catalog = loadOracleCatalog();
    const declaration = catalog.functions.get('consultOracle')!;
    const oracle = AgentFunction.fromApi(declaration, handler);
    const other = () => 'yes';

    const rebound = oracle.withHandler(other);

    assert.strictEqual(rebound.handler, other);
    assert.strictEqual(rebound.declaration, declaration);
    assert.strictEqual(rebound.allowedCallers, 'rendererOrAgent');
    const copy = catalog.copyWith({agentFunctions: [rebound]});
    assert.strictEqual(copy.agentFunctions.get('consultOracle'), rebound);
    assert.deepStrictEqual(copy.toJson(), ORACLE_DOC);
  });

  it('withHandler rejects a handler that is not callable', () => {
    assert.throws(
      () => fetchFxRate().withHandler('nope' as unknown as typeof handler),
      (err: unknown) => err instanceof TypeError,
    );
  });

  it('fromApi keeps rendererOnly and rendererOrAgent', () => {
    for (const allowedCallers of ['rendererOnly', 'rendererOrAgent'] as const) {
      const fn = AgentFunction.fromApi(
        {name: 'consultOracle', returnType: 'string', schema: FX_RATE_SCHEMA, allowedCallers},
        handler,
      );
      assert.strictEqual(fn.allowedCallers, allowedCallers);
    }
  });

  it('fromApi rejects an agentOnly declaration', () => {
    const notify = loadOracleCatalog().functions.get('notify')!;

    assert.throws(
      () => AgentFunction.fromApi(notify, handler),
      (err: unknown) => err instanceof A2uiCatalogError && err.message.includes('agentOnly'),
    );
  });

  it('fromApi rejects an existing AgentFunction', () => {
    assert.throws(
      () => AgentFunction.fromApi(fetchFxRate(), handler),
      (err: unknown) =>
        err instanceof TypeError && err.message.includes('already an agent function'),
    );
  });
});

describe('Catalog.agentFunctions', () => {
  it('adds agentFunctions to functions and agentFunctions with copyWith', () => {
    const fx = fetchFxRate();
    const catalog = new Catalog('c', '1.0', [], []).copyWith({agentFunctions: [fx]});

    assert.deepStrictEqual([...catalog.functions.entries()], [['fetchFxRate', fx]]);
    assert.deepStrictEqual([...catalog.agentFunctions.entries()], [['fetchFxRate', fx]]);
  });

  it('lists only agent functions in agentFunctions and the others in rendererFunctions', () => {
    const local: FunctionApi = {
      name: 'formatRate',
      returnType: 'string',
      schema: FX_RATE_SCHEMA,
    };
    const fx = fetchFxRate();
    const catalog = new Catalog('c', '1.0', [], [local]).copyWith({agentFunctions: [fx]});

    assert.deepStrictEqual([...catalog.functions.keys()], ['formatRate', 'fetchFxRate']);
    assert.deepStrictEqual([...catalog.agentFunctions.entries()], [['fetchFxRate', fx]]);
    assert.deepStrictEqual([...catalog.rendererFunctions.entries()], [['formatRate', local]]);
  });

  it('lists every function in rendererFunctions when there are no agent functions', () => {
    const catalog = loadOracleCatalog();

    assert.deepStrictEqual([...catalog.rendererFunctions.keys()], ['consultOracle', 'notify']);
    assert.strictEqual(catalog.agentFunctions.size, 0);
  });

  it('does not take agentFunctions in the constructor options', () => {
    const catalog = new Catalog('c', '1.0', [], [], {
      agentFunctions: [fetchFxRate()],
    } as unknown as CatalogOptions);

    assert.strictEqual(catalog.functions.size, 0);
    assert.strictEqual(catalog.agentFunctions.size, 0);
  });

  it('recognizes an AgentFunction passed directly in functions', () => {
    const fx = fetchFxRate();
    const catalog = new Catalog('c', '1.0', [], [fx]);

    assert.deepStrictEqual([...catalog.agentFunctions.entries()], [['fetchFxRate', fx]]);
    assert.strictEqual(catalog.rendererFunctions.size, 0);
  });

  it('rejects an agent function named like another function', () => {
    const local: FunctionApi = {
      name: 'fetchFxRate',
      returnType: 'number',
      schema: FX_RATE_SCHEMA,
    };

    assert.throws(
      () => new Catalog('c', '1.0', [], [local]).copyWith({agentFunctions: [fetchFxRate()]}),
      (err: unknown) =>
        err instanceof A2uiCatalogError &&
        err.message.includes("already has a function named 'fetchFxRate'") &&
        err.message.includes('AgentFunction.fromApi'),
    );
  });

  it('rejects two agent functions with the same name with its own message', () => {
    assert.throws(
      () =>
        new Catalog('c', '1.0', [], []).copyWith({
          agentFunctions: [fetchFxRate(), fetchFxRate()],
        }),
      (err: unknown) =>
        err instanceof A2uiCatalogError &&
        err.message.includes("lists 'fetchFxRate' more than once") &&
        !err.message.includes('fromApi'),
    );
  });

  it('rejects two fromApi agent functions wrapping the same declaration', () => {
    const catalog = loadOracleCatalog();
    const declaration = catalog.functions.get('consultOracle')!;

    assert.throws(
      () =>
        catalog.copyWith({
          agentFunctions: [
            AgentFunction.fromApi(declaration, handler),
            AgentFunction.fromApi(declaration, handler),
          ],
        }),
      (err: unknown) =>
        err instanceof A2uiCatalogError &&
        err.message.includes("lists 'consultOracle' more than once"),
    );
  });

  it('rejects a function list mixing an agent function and a duplicate name', () => {
    const local: FunctionApi = {
      name: 'fetchFxRate',
      returnType: 'number',
      schema: FX_RATE_SCHEMA,
    };

    assert.throws(
      () => new Catalog('c', '1.0', [], [fetchFxRate(), local]),
      (err: unknown) =>
        err instanceof A2uiCatalogError && err.message.includes('already has a function named'),
    );
  });

  it('rejects an entry in agentFunctions that is not an AgentFunction', () => {
    const local: FunctionApi = {
      name: 'fetchFxRate',
      returnType: 'number',
      schema: FX_RATE_SCHEMA,
    };

    assert.throws(
      () =>
        new Catalog('c', '1.0', [], []).copyWith({
          agentFunctions: [local as unknown as AgentFunction],
        }),
      (err: unknown) =>
        err instanceof A2uiCatalogError && err.message.includes('not an `AgentFunction`'),
    );
  });

  it('rejects agent functions before v1.0', () => {
    assert.throws(
      () => new Catalog('c', '0.9', [], []).copyWith({agentFunctions: [fetchFxRate()]}),
      (err: unknown) =>
        err instanceof A2uiCatalogError && err.message.includes('need v1.0 or later'),
    );
    assert.throws(
      () => new Catalog('c', '0.9', [], [fetchFxRate()]),
      (err: unknown) =>
        err instanceof A2uiCatalogError && err.message.includes('need v1.0 or later'),
    );
  });

  it('rejects an agent function with an invalid UAX #31 identifier', () => {
    const empty = new Catalog('c', '1.0', [], []);
    assert.throws(
      () => empty.copyWith({agentFunctions: [fetchFxRate('fetch-fx-rate')]}),
      (err: unknown) => err instanceof A2uiCatalogError && err.message.includes('Invalid UAX #31'),
    );
    assert.throws(
      () => empty.copyWith({agentFunctions: [fetchFxRate('@index')]}),
      (err: unknown) => err instanceof A2uiCatalogError && err.message.includes('Invalid UAX #31'),
    );
  });

  it('checks agent function parameter names against UAX #31 when a v1.0 catalog gets them', () => {
    const empty = new Catalog('c', '1.0', [], []);
    const isUaxError = (name: string) => (err: unknown) =>
      err instanceof A2uiCatalogError &&
      err.message.includes('Invalid UAX #31') &&
      err.message.includes(`'${name}'`);
    const withSchema = (schema: z.ZodTypeAny | Record<string, unknown>) =>
      new AgentFunction({name: 'fetchRate', schema, handler: () => 1});
    const cases: Array<[string, z.ZodTypeAny | Record<string, unknown>]> = [
      ['target-currency', z.object({'target-currency': z.string()})],
      ['@target', z.object({'@target': z.string()})],
      [
        'target-currency',
        z.object({'target-currency': z.string()}).refine(args => args['target-currency'] !== ''),
      ],
      ['target-currency', z.object({'target-currency': z.string()}).passthrough()],
      [
        'target-currency',
        z.object({base: z.string()}).merge(z.object({'target-currency': z.string()})),
      ],
      [
        'target-currency',
        z.union([z.object({base: z.string()}), z.object({'target-currency': z.string()})]),
      ],
      [
        'target-currency',
        z.discriminatedUnion('kind', [
          z.object({kind: z.literal('a')}),
          z.object({kind: z.literal('b'), 'target-currency': z.string()}),
        ]),
      ],
      [
        'target-currency',
        z.intersection(z.object({base: z.string()}), z.object({'target-currency': z.string()})),
      ],
      ['target-currency', z.object({'target-currency': z.string()}).optional()],
      ['target-currency', {type: 'object', properties: {'target-currency': {type: 'string'}}}],
      ['@target', {type: 'object', properties: {'@target': {type: 'string'}}}],
      [
        'target-currency',
        {anyOf: [{type: 'object', properties: {'target-currency': {type: 'string'}}}]},
      ],
      [
        'target-currency',
        {
          oneOf: [
            {type: 'object', properties: {base: {type: 'string'}}},
            {type: 'object', properties: {'target-currency': {type: 'string'}}},
          ],
        },
      ],
      ['target-currency', {'target-currency': {type: 'string'}}],
    ];

    for (const [name, schema] of cases) {
      // Building the agent function doesn't check, for JSON Schema or Zod alike.
      const fn = withSchema(schema);
      assert.throws(() => empty.copyWith({agentFunctions: [fn]}), isUaxError(name), name);
      assert.throws(() => new Catalog('c', '1.0', [], [fn]), isUaxError(name), name);
    }

    const valid = withSchema({type: 'object', properties: {targetCurrency: {type: 'string'}}});
    assert.deepStrictEqual(
      [...empty.copyWith({agentFunctions: [valid]}).agentFunctions.keys()],
      ['fetchRate'],
    );
  });

  it("follows a JSON Schema's own $defs, also after withHandler", () => {
    const empty = new Catalog('c', '1.0', [], []);
    const fn = new AgentFunction({
      name: 'f',
      schema: {$defs: {Bad: {properties: {'a-b': {type: 'string'}}}}, $ref: '#/$defs/Bad'},
      handler: () => 1,
    });
    const isUaxError = (err: unknown) =>
      err instanceof A2uiCatalogError && err.message.includes("'a-b'");

    for (const candidate of [fn, fn.withHandler(() => 2)]) {
      assert.throws(() => empty.copyWith({agentFunctions: [candidate]}), isUaxError);
      assert.throws(() => new Catalog('c', '1.0', [], [candidate]), isUaxError);
    }
  });

  it("follows a JSON Schema's reference to the catalog's $defs", () => {
    const withDefs = new Catalog('c', '1.0', [], [], {
      defs: {Bad: {properties: {'a-b': {type: 'string'}}}},
    });
    const fn = new AgentFunction({name: 'f', schema: {$ref: '#/$defs/Bad'}, handler: () => 1});

    assert.throws(
      () => withDefs.copyWith({agentFunctions: [fn]}),
      (err: unknown) => err instanceof A2uiCatalogError && err.message.includes("'a-b'"),
    );
    assert.doesNotThrow(() => new Catalog('c', '1.0', [], []).copyWith({agentFunctions: [fn]}));
  });

  it("merges the catalog's $defs with a JSON Schema's own $defs during UAX #31 checks", () => {
    const withDefs = new Catalog('c', '1.0', [], [], {
      defs: {CatalogBad: {type: 'object', properties: {'bad-amount': {type: 'number'}}}},
    });
    const fn = new AgentFunction({
      name: 'pay',
      schema: {
        $defs: {LocalOk: {type: 'object', properties: {memo: {type: 'string'}}}},
        allOf: [{$ref: '#/$defs/LocalOk'}, {$ref: '#/$defs/CatalogBad'}],
      },
      handler: () => 1,
    });

    assert.throws(
      () => withDefs.copyWith({agentFunctions: [fn]}),
      (err: unknown) => err instanceof A2uiCatalogError && err.message.includes("'bad-amount'"),
    );
    assert.throws(
      () =>
        new Catalog('c', '1.0', [], [fn], {
          defs: {CatalogBad: {type: 'object', properties: {'bad-amount': {type: 'number'}}}},
        }),
      (err: unknown) => err instanceof A2uiCatalogError && err.message.includes("'bad-amount'"),
    );
  });

  it('follows a multi-segment $defs pointer to the member it names', () => {
    const defs = {
      Bundle: {
        allOf: [
          {type: 'object', properties: {memo: {type: 'string'}}},
          {type: 'object', properties: {'bad-name': {type: 'string'}}},
        ],
      },
    };
    const pointingAt = (ref: string) =>
      new AgentFunction({name: 'f', schema: {$ref: ref}, handler: () => 1});
    const isUaxError = (err: unknown) =>
      err instanceof A2uiCatalogError && err.message.includes("'bad-name'");

    const withDefs = new Catalog('c', '1.0', [], [], {defs});
    assert.doesNotThrow(() =>
      withDefs.copyWith({agentFunctions: [pointingAt('#/$defs/Bundle/allOf/0')]}),
    );
    assert.throws(
      () => withDefs.copyWith({agentFunctions: [pointingAt('#/$defs/Bundle/allOf/1')]}),
      isUaxError,
    );

    const local = (ref: string) =>
      new AgentFunction({name: 'f', schema: {$defs: defs, $ref: ref}, handler: () => 1});
    const empty = new Catalog('c', '1.0', [], []);
    assert.doesNotThrow(() => empty.copyWith({agentFunctions: [local('#/$defs/Bundle/allOf/0')]}));
    assert.throws(
      () => empty.copyWith({agentFunctions: [local('#/$defs/Bundle/allOf/1')]}),
      isUaxError,
    );
  });

  describe('local $defs that collide', () => {
    const money = {type: 'object', properties: {amount: {type: 'number'}}};
    const withLocalMoney = (name: string, definition: unknown) =>
      new AgentFunction({
        name,
        schema: {$defs: {Money: definition}, $ref: '#/$defs/Money'},
        handler: () => 1,
      });
    const collision = (fnName: string, other: string) => (err: unknown) =>
      err instanceof A2uiCatalogError &&
      err.message === `Agent function '${fnName}' defines $defs 'Money' differently from ${other}.`;

    it('rejects a local $defs entry that the catalog defines differently', () => {
      const withDefs = new Catalog('c', '1.0', [], [], {defs: {Money: money}});
      const pay = withLocalMoney('pay', {type: 'object', properties: {cents: {type: 'integer'}}});

      assert.throws(
        () => withDefs.copyWith({agentFunctions: [pay]}),
        collision('pay', 'the catalog'),
      );
      assert.throws(
        () => new Catalog('c', '1.0', [], [pay], {defs: {Money: money}}),
        collision('pay', 'the catalog'),
      );
    });

    it('accepts a local $defs entry equal to the catalog one', () => {
      const withDefs = new Catalog('c', '1.0', [], [], {defs: {Money: money}});
      // Equal as JSON values, though written with the keys in another order.
      const pay = withLocalMoney('pay', {properties: {amount: {type: 'number'}}, type: 'object'});

      const catalog = withDefs.copyWith({agentFunctions: [pay]});
      assert.deepStrictEqual([...catalog.agentFunctions.keys()], ['pay']);
    });

    it('rejects two agent functions whose local $defs entries of one name differ', () => {
      const empty = new Catalog('c', '1.0', [], []);
      const pay = withLocalMoney('pay', money);
      const refund = withLocalMoney('refund', {type: 'string'});

      assert.throws(
        () => empty.copyWith({agentFunctions: [pay, refund]}),
        collision('refund', "agent function 'pay'"),
      );
      assert.doesNotThrow(() =>
        empty.copyWith({agentFunctions: [pay, withLocalMoney('refund', money)]}),
      );
    });
  });

  it('does not leak internal schema helpers onto public barrel exports', () => {
    for (const barrel of [rootApi, v10Api, resolutionApi] as Array<Record<string, unknown>>) {
      assert.strictEqual(barrel['getDeclaredSchemaKeys'], undefined);
      assert.strictEqual(barrel['bindAgentFunctionDefs'], undefined);
    }
  });

  it('keeps the agent functions in functions when copyWith also gets agentFunctions', () => {
    const local: FunctionApi = {name: 'formatRate', returnType: 'string', schema: FX_RATE_SCHEMA};
    const kept = fetchFxRate();
    const extra = fetchFxRate('quote');
    const catalog = new Catalog('c', '1.0', [], [local]).copyWith({agentFunctions: [kept]});

    const copy = catalog.copyWith({functions: [local, kept], agentFunctions: [extra]});

    assert.deepStrictEqual([...copy.functions.keys()], ['formatRate', 'fetchFxRate', 'quote']);
    assert.deepStrictEqual([...copy.agentFunctions.keys()], ['fetchFxRate', 'quote']);
    assert.strictEqual(copy.agentFunctions.get('fetchFxRate'), kept);
  });

  it('replaces a declaration in place when bound via AgentFunction.fromApi', () => {
    const catalog = loadOracleCatalog();
    const declaration = catalog.functions.get('consultOracle')!;
    const oracle = AgentFunction.fromApi(declaration, handler);

    const copy = catalog.copyWith({agentFunctions: [oracle]});

    assert.deepStrictEqual([...copy.functions.keys()], ['consultOracle', 'notify']);
    assert.strictEqual(copy.functions.get('consultOracle'), oracle);
    assert.deepStrictEqual([...copy.agentFunctions.entries()], [['consultOracle', oracle]]);
    assert.deepStrictEqual([...copy.rendererFunctions.keys()], ['notify']);
    assert.strictEqual(oracle.allowedCallers, 'rendererOrAgent');
  });

  it('rejects an AgentFunction.fromApi entry wrapping a different declaration object', () => {
    const catalog = loadOracleCatalog();
    const sameName = loadOracleCatalog().functions.get('consultOracle')!;

    assert.throws(
      () => catalog.copyWith({agentFunctions: [AgentFunction.fromApi(sameName, handler)]}),
      (err: unknown) =>
        err instanceof A2uiCatalogError &&
        err.message.includes('built with AgentFunction.fromApi from a different declaration') &&
        err.message.includes("catalog 'test/oracle'") &&
        err.message.includes("build it from this catalog's entry"),
    );
  });

  it('rejects a fromApi agent function for a function the catalog does not declare', () => {
    const foreign = loadOracleCatalog().functions.get('consultOracle')!;
    const catalog = new Catalog('c', '1.0', [], []);

    assert.throws(
      () => catalog.copyWith({agentFunctions: [AgentFunction.fromApi(foreign, handler)]}),
      (err: unknown) =>
        err instanceof A2uiCatalogError &&
        err.message.includes("has no function named 'consultOracle'"),
    );
  });
});

describe('Catalog.toJson with agentFunctions', () => {
  it('writes an agent function identically to a declared FunctionApi', () => {
    const withAgent = new Catalog('c', '1.0', [], []).copyWith({
      agentFunctions: [fetchFxRate()],
    });
    const declared = new Catalog(
      'c',
      '1.0',
      [],
      [
        {
          name: 'fetchFxRate',
          returnType: 'number',
          schema: FX_RATE_SCHEMA,
          description: 'Current exchange rate from base to target.',
        },
      ],
    );

    assert.deepStrictEqual(withAgent.toJson(), declared.toJson());
  });

  it('fromApi keeps a loaded document definition as written', () => {
    const catalog = loadOracleCatalog();
    const declaration = catalog.functions.get('consultOracle')!;

    const replaced = catalog.copyWith({
      agentFunctions: [AgentFunction.fromApi(declaration, handler)],
    });

    assert.deepStrictEqual(replaced.toJson(), catalog.toJson());
    assert.deepStrictEqual(replaced.toJson(), ORACLE_DOC);
    assert.deepStrictEqual([...replaced.agentFunctions.keys()], ['consultOracle']);
  });
});

describe('Catalog.copyWith and Catalog.derive with agentFunctions', () => {
  it('adds agent functions to a loaded catalog without mutating the original', () => {
    const catalog = loadBasicCatalog();
    const fx = fetchFxRate();

    const copy = catalog.copyWith({agentFunctions: [fx]});

    assert.strictEqual(copy.id, catalog.id);
    assert.deepStrictEqual(
      [...copy.functions.keys()],
      [...catalog.functions.keys(), 'fetchFxRate'],
    );
    assert.deepStrictEqual([...copy.agentFunctions.entries()], [['fetchFxRate', fx]]);
    assert.strictEqual(catalog.agentFunctions.size, 0);
  });

  it('keeps agent functions when copyWith is called without options', () => {
    const catalog = loadBasicCatalog().copyWith({agentFunctions: [fetchFxRate()]});
    const copy = catalog.copyWith();

    assert.deepStrictEqual(
      [...copy.agentFunctions.entries()],
      [...catalog.agentFunctions.entries()],
    );
  });

  it('replaces existing agent functions when new agentFunctions are passed', () => {
    const catalog = loadBasicCatalog().copyWith({agentFunctions: [fetchFxRate()]});
    const quote = fetchFxRate('quote');

    const copy = catalog.copyWith({agentFunctions: [quote]});

    assert.deepStrictEqual([...copy.agentFunctions.entries()], [['quote', quote]]);
    assert.strictEqual(copy.functions.has('fetchFxRate'), false);
  });

  it('restores declarations when empty agentFunctions are passed to copyWith', () => {
    const catalog = loadOracleCatalog();
    const declaration = catalog.functions.get('consultOracle')!;
    const withAgent = catalog.copyWith({
      agentFunctions: [AgentFunction.fromApi(declaration, handler), fetchFxRate()],
    });

    const copy = withAgent.copyWith({agentFunctions: []});

    assert.strictEqual(copy.agentFunctions.size, 0);
    assert.strictEqual(copy.functions.get('consultOracle'), declaration);
    assert.deepStrictEqual([...copy.functions.keys()], [...catalog.functions.keys()]);
    assert.deepStrictEqual(copy.toJson(), catalog.toJson());
  });

  it('rejects an agent function named like a loaded function in copyWith', () => {
    const catalog = loadBasicCatalog();

    assert.throws(
      () => catalog.copyWith({agentFunctions: [fetchFxRate('formatString')]}),
      (err: unknown) => err instanceof A2uiCatalogError && err.message.includes('formatString'),
    );
  });

  it('drops agent function entries when functions are pruned via copyWith', () => {
    const catalog = loadBasicCatalog().copyWith({
      agentFunctions: [fetchFxRate(), fetchFxRate('quote')],
    });

    const pruned = catalog.copyWith({
      functions: [...catalog.functions.values()].filter(fn => fn.name !== 'quote'),
    });

    assert.deepStrictEqual([...pruned.agentFunctions.keys()], ['fetchFxRate']);
  });

  it('preserves and picks agent functions in derive', () => {
    const catalog = loadBasicCatalog().copyWith({
      agentFunctions: [fetchFxRate(), fetchFxRate('quote')],
    });

    const allDerived = catalog.derive({catalogId: 'derived-all'});
    assert.deepStrictEqual(
      [...allDerived.agentFunctions.entries()],
      [...catalog.agentFunctions.entries()],
    );

    const picked = catalog.derive({catalogId: 'derived-picked', functions: ['fetchFxRate']});
    assert.deepStrictEqual([...picked.functions.keys()], ['fetchFxRate']);
    assert.deepStrictEqual([...picked.agentFunctions.keys()], ['fetchFxRate']);
  });
});

describe('PayloadValidator with AgentFunction', () => {
  const catalog = loadBasicCatalog().copyWith({agentFunctions: [fetchFxRate()]});
  const validator = new PayloadValidator(catalog, STRICT_VALIDATION);

  it('accepts a call to an agent function and applies schema defaults', () => {
    assert.deepStrictEqual(validator.validateFunction('fetchFxRate', {base: 'EUR'}), {
      base: 'EUR',
      target: 'USD',
    });
  });

  it('checks the arguments of an agent function', () => {
    for (const badArgs of [{}, {base: 1}, {base: 'EUR', x: 1}]) {
      assert.throws(
        () => validator.validateFunction('fetchFxRate', badArgs),
        (err: unknown) => err instanceof A2uiValidationError,
      );
    }
  });

  it('accepts a component bound to an agent function', () => {
    assert.doesNotThrow(() => {
      validator.validateComponent({
        id: 'rate',
        component: 'Text',
        text: {'@call': 'fetchFxRate', args: {base: 'EUR'}},
      });
    });
  });

  it('rejects an undeclared function or a catalog without the agent function', () => {
    assert.throws(
      () => validator.validateFunction('notDeclared', {}),
      (err: unknown) => err instanceof A2uiValidationError,
    );

    const plainValidator = new PayloadValidator(loadBasicCatalog(), STRICT_VALIDATION);
    assert.throws(
      () => plainValidator.validateFunction('fetchFxRate', {base: 'EUR'}),
      (err: unknown) => err instanceof A2uiValidationError,
    );
  });

  it("validates, applies defaults, and retains catalog $defs referenced by an agent function's JSON Schema", () => {
    const pay = new AgentFunction({
      name: 'pay',
      returnType: 'object',
      schema: {
        $defs: {
          MemoArgs: {
            type: 'object',
            properties: {memo: {type: 'string', default: 'standard'}},
          },
        },
        allOf: [{$ref: '#/$defs/MemoArgs'}, {$ref: '#/$defs/MoneyArgs'}],
        unevaluatedProperties: false,
      },
      handler: args => args,
    });
    const baseCatalog = new Catalog(
      'c',
      '1.0',
      [],
      [
        {
          name: 'noop',
          returnType: 'void',
          schema: z.object({}).strict(),
        },
      ],
      {
        defs: {
          MoneyArgs: {
            type: 'object',
            properties: {
              amount: {type: 'number', exclusiveMinimum: 0},
              currency: {type: 'string', default: 'USD'},
            },
            required: ['amount'],
          },
        },
      },
    );
    const catalog = baseCatalog.copyWith({agentFunctions: [pay]});
    // Pruning `noop` keeps `MoneyArgs` because `pay` still references it.
    const derived = catalog.derive({catalogId: 'derived', functions: ['pay']});
    const derivedValidator = new PayloadValidator(derived, STRICT_VALIDATION);

    assert.deepStrictEqual(derivedValidator.validateFunction('pay', {amount: 25}), {
      amount: 25,
      currency: 'USD',
      memo: 'standard',
    });
    assert.throws(
      () => derivedValidator.validateFunction('pay', {amount: -5}),
      (err: unknown) => err instanceof A2uiValidationError,
    );
    assert.throws(
      () => derivedValidator.validateFunction('pay', {amount: 25, extra: true}),
      (err: unknown) => err instanceof A2uiValidationError,
    );
    assert.ok('MoneyArgs' in ((derived.toJson()['$defs'] as Record<string, unknown>) ?? {}));
  });

  /** Validates `args` against an agent function with the JSON Schema `schema`. */
  const validateWith = (schema: Record<string, unknown>, args: Record<string, unknown>) =>
    new PayloadValidator(
      new Catalog('c', '1.0', [], []).copyWith({
        agentFunctions: [new AgentFunction({name: 'f', schema, handler: () => 1})],
      }),
      STRICT_VALIDATION,
    ).validateFunction('f', args);
  const isValidationError = (err: unknown) => err instanceof A2uiValidationError;

  it('rejects a missing required argument even when it has a default', () => {
    const schema = {
      type: 'object',
      properties: {a: {type: 'string', default: 'x'}},
      required: ['a'],
    };
    assert.throws(() => validateWith(schema, {}), isValidationError);
    assert.deepStrictEqual(validateWith(schema, {a: 'y'}), {a: 'y'});

    const nested = {
      type: 'object',
      properties: {
        o: {type: 'object', properties: {b: {type: 'number', default: 1}}, required: ['b']},
      },
    };
    assert.throws(() => validateWith(nested, {o: {}}), isValidationError);
  });

  it("checks a property's not schema before filling in the defaults", () => {
    const schema = {
      type: 'object',
      properties: {
        o: {
          type: 'object',
          properties: {a: {type: 'string'}, b: {type: 'string', default: 'x'}},
          not: {type: 'object', properties: {b: {const: 'x'}}, required: ['b']},
        },
      },
    };
    assert.deepStrictEqual(validateWith(schema, {o: {a: 'y'}}), {o: {a: 'y', b: 'x'}});
    assert.throws(() => validateWith(schema, {o: {a: 'y', b: 'x'}}), isValidationError);
  });

  it('accepts resolved argument values whose keys start with @', () => {
    const schema = {type: 'object', properties: {v: {type: 'object'}, w: {}}};
    const args = {v: {'@type': 'x'}, w: {'@path': '/a', '@call': 'g'}};
    assert.deepStrictEqual(validateWith(schema, args), args);
  });

  it('accepts the keys patternProperties match in a closed object', () => {
    const closed = {
      type: 'object',
      properties: {a: {type: 'string'}},
      patternProperties: {'^x_': {type: 'number'}},
      additionalProperties: false,
    };
    for (const schema of [closed, {type: 'object', properties: {o: closed}}]) {
      const wrap = (value: Record<string, unknown>) => (schema === closed ? value : {o: value});
      assert.deepStrictEqual(validateWith(schema, wrap({a: 'y', x_1: 2})), wrap({a: 'y', x_1: 2}));
      assert.throws(() => validateWith(schema, wrap({a: 'y', x_1: 'no'})), isValidationError);
      assert.throws(() => validateWith(schema, wrap({a: 'y', zz: 2})), isValidationError);
    }

    const open = {
      type: 'object',
      properties: {a: {type: 'string'}},
      patternProperties: {'^x_': {type: 'number'}},
      additionalProperties: true,
    };
    assert.deepStrictEqual(validateWith(open, {zz: 2}), {zz: 2});
    assert.throws(() => validateWith(open, {x_1: 'no'}), isValidationError);
  });

  it('rejects undeclared keys in a nested object its schema closes', () => {
    for (const closure of [{additionalProperties: false}, {unevaluatedProperties: false}]) {
      const schema = {
        type: 'object',
        properties: {o: {type: 'object', properties: {a: {type: 'string'}}, ...closure}},
      };
      assert.throws(() => validateWith(schema, {o: {a: 'y', extra: 1}}), isValidationError);
    }
  });
});
