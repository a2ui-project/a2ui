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
  createAgentFunction,
  isAgentFunction,
  type AgentFunctionContext,
  type AgentFunctionHandler,
  type CatalogOptions,
  type FunctionApi,
} from '../index.js';

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

  it('supports createAgentFunction with init options or FunctionApi', () => {
    const fromInit = createAgentFunction({
      name: 'fetchFxRate',
      returnType: 'number',
      schema: FX_RATE_SCHEMA,
      handler,
    });
    assert.strictEqual(isAgentFunction(fromInit), true);
    assert.strictEqual(fromInit.name, 'fetchFxRate');

    const declaration: FunctionApi = {
      name: 'consultOracle',
      returnType: 'string',
      schema: FX_RATE_SCHEMA,
    };
    const fromApi = createAgentFunction(declaration, handler);
    assert.strictEqual(isAgentFunction(fromApi), true);
    assert.strictEqual(fromApi.declaration, declaration);
  });

  it('converts a JSON Schema object into a Zod schema', () => {
    const fn = new AgentFunction({
      name: 'lookupCustomer',
      returnType: 'object',
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
      allowedCallers: 'rendererOrAgent',
      requiresUserActivation: true,
      description: 'Asks the oracle.',
    };

    const fn = AgentFunction.fromApi(declaration, handler);

    assert.strictEqual(fn.declaration, declaration);
    assert.strictEqual(fn.name, 'consultOracle');
    assert.strictEqual(fn.returnType, 'string');
    assert.strictEqual(fn.schema, declaration.schema);
    assert.strictEqual(fn.allowedCallers, 'rendererOrAgent');
    assert.strictEqual(fn.requiresUserActivation, true);
    assert.strictEqual(fn.description, 'Asks the oracle.');
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
        err instanceof A2uiCatalogError && err.message.includes("isn't catalog 'test/oracle'"),
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
});
