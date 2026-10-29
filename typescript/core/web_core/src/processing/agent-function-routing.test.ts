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
import {beforeEach, describe, it} from 'node:test';
import {z} from 'zod';

import {Catalog, createFunctionImplementation, FunctionApi} from '../catalog/types.js';
import {getValue, peekValue} from '../reactivity/signals.js';
import {DataContext} from '../resolution/data-context.js';
import {MessageProcessor} from './message-processor.js';

/** Resolves on the next macrotask, after every pending microtask has run. */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const FIN_CATALOG_ID = 'https://example.com/fin/v1/catalog.json';

const upper = createFunctionImplementation(
  {name: 'upper', returnType: 'string', schema: z.object({'value': z.string()})},
  args => args.value.toUpperCase(),
);

const concat = createFunctionImplementation(
  {
    name: 'concat',
    returnType: 'string',
    schema: z.object({'a': z.string(), 'b': z.string()}),
  },
  args => `${args.a}:${args.b}`,
);

/** Declared in the catalog, but implemented on the agent (schema-only). */
const quote: FunctionApi = {
  name: 'quote',
  returnType: 'number',
  schema: z.object({'symbol': z.string(), 'currency': z.string().default('USD')}).strict(),
};

describe('Fallback routing of unimplemented functions to the agent (v1.0)', () => {
  let outbound: any[];
  let errors: Array<{code: string; message: string; expression?: string}>;
  let proc: MessageProcessor;
  let ctx: DataContext;

  /** Answers the outbound `callAgentFunction` at `index`. */
  const respond = (index: number, response: {value?: unknown; error?: unknown}) => {
    proc.processMessages({
      version: '1.0',
      agentFunctionResponse: {
        functionCallId: outbound[index].callAgentFunction.functionCallId,
        ...response,
      },
    } as any);
  };

  const setUp = (options: {outboundListener?: boolean; defaultTimeoutMs?: number} = {}) => {
    outbound = [];
    errors = [];
    const catalog = new Catalog<any, any>(FIN_CATALOG_ID, '1.0', [], [upper, concat, quote]);
    proc = new MessageProcessor([catalog], undefined, {
      outboundListener:
        options.outboundListener === false
          ? undefined
          : msg => {
              outbound.push(msg);
            },
      defaultTimeoutMs: options.defaultTimeoutMs,
    });
    proc.processMessages({
      version: '1.0',
      createSurface: {surfaceId: 's1', catalogId: FIN_CATALOG_ID},
    } as any);
    const surface = proc.model.getSurface('s1')!;
    surface.onError.subscribe(e => {
      errors.push(e);
    });
    ctx = new DataContext(surface, '/');
  };

  beforeEach(() => setUp());

  it('sends an undeclared function to the agent with the resolved catalogId', async () => {
    const sig = ctx.resolveSignal({'@call': 'fetchFxRate', 'args': {'base': 'EUR'}});
    await flush();

    assert.strictEqual(outbound.length, 1);
    assert.deepStrictEqual(outbound[0].callAgentFunction.callFunction, {
      '@call': 'fetchFxRate',
      'catalogId': FIN_CATALOG_ID,
      'args': {'base': 'EUR'},
    });
    assert.strictEqual(outbound[0].callAgentFunction.surfaceId, 's1');
    assert.strictEqual(peekValue(sig), undefined, 'the value is pending until the agent answers');

    respond(0, {value: 1.08});
    await flush();
    assert.strictEqual(getValue(sig), 1.08);
    assert.deepStrictEqual(errors, []);
  });

  it('feeds an agent result into a local function', async () => {
    const result = ctx.resolveDynamicValue<Promise<string>>({
      '@call': 'upper',
      'args': {'value': {'@call': 'fetchGreeting', 'args': {}}},
    });
    await flush();
    assert.strictEqual(outbound.length, 1);

    respond(0, {value: 'hello'});
    assert.strictEqual(await result, 'HELLO');
    assert.deepStrictEqual(errors, []);
  });

  it('waits for a pending agent argument in a binding before running', async () => {
    const values: unknown[] = [];
    const sub = ctx.subscribeDynamicValue<string>(
      {'@call': 'upper', 'args': {'value': {'@call': 'fetchGreeting', 'args': {}}}},
      value => values.push(value),
    );
    await flush();
    assert.strictEqual(outbound.length, 1);
    assert.strictEqual(sub.value, undefined);
    assert.deepStrictEqual(
      errors,
      [],
      'the local function does not run while its argument is pending',
    );

    respond(0, {value: 'hello'});
    await flush();
    assert.strictEqual(sub.value, 'HELLO');
    assert.deepStrictEqual(values, ['HELLO']);
    assert.deepStrictEqual(errors, []);
    sub.unsubscribe();
  });

  it('reports a failed agent argument in a binding once with the inner function name', async () => {
    const surface = proc.model.getSurface('s1')!;
    surface.dataModel.set('/b', 'first');
    const sub = ctx.subscribeDynamicValue<string>(
      {
        '@call': 'concat',
        'args': {
          'a': {'@call': 'fetchGreeting', 'args': {}},
          'b': {'@path': '/b'},
        },
      },
      () => {},
    );
    await flush();
    respond(0, {error: {code: 'UNKNOWN_FUNCTION', message: 'No such function: fetchGreeting'}});
    await flush();
    assert.strictEqual(sub.value, undefined);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 'EXPRESSION_ERROR');
    assert.strictEqual(errors[0].expression, 'fetchGreeting');
    assert.match(errors[0].message, /No such function: fetchGreeting/);

    // Updating a sibling reactive argument does not re-dispatch the inner failure.
    surface.dataModel.set('/b', 'second');
    await flush();
    assert.strictEqual(sub.value, undefined);
    assert.strictEqual(errors.length, 1);
    sub.unsubscribe();
  });

  it('re-evaluates synchronously when a sibling reactive argument changes after an agent argument settles', async () => {
    const surface = proc.model.getSurface('s1')!;
    surface.dataModel.set('/b', 'first');
    const values: Array<string | undefined> = [];
    const sub = ctx.subscribeDynamicValue<string>(
      {
        '@call': 'concat',
        'args': {
          'a': {'@call': 'fetchGreeting', 'args': {}},
          'b': {'@path': '/b'},
        },
      },
      val => values.push(val),
    );
    await flush();
    respond(0, {value: 'hello'});
    await flush();
    assert.strictEqual(sub.value, 'hello:first');

    surface.dataModel.set('/b', 'second');
    assert.strictEqual(sub.value, 'hello:second');
    assert.deepStrictEqual(values, ['hello:first', 'hello:second']);
    assert.deepStrictEqual(errors, []);
    sub.unsubscribe();
  });

  it('stops an enclosing call when a nested schema-only argument fails validation synchronously', async () => {
    const res = ctx.resolveDynamicValue({
      '@call': 'convert',
      'args': {'rate': {'@call': 'quote', 'args': {'symbol': 42}}},
    });
    const sig = ctx.resolveSignal({
      '@call': 'upper',
      'args': {'value': {'@call': 'quote', 'args': {'symbol': 42}}},
    });
    await flush();
    assert.strictEqual(res, undefined);
    assert.strictEqual(getValue(sig), undefined);
    assert.strictEqual(outbound.length, 0);
    assert.strictEqual(errors.length, 2);
    assert.strictEqual(errors[0].expression, 'quote');
    assert.strictEqual(errors[1].expression, 'quote');
  });

  it('dispatches EXPRESSION_ERROR when an agent call nested inside a plain object or array rejects in resolveDynamicValue', async () => {
    const obj = ctx.resolveDynamicValue<{rate: Promise<unknown>}>({
      rate: {'@call': 'fetchFxRate', 'args': {'base': 'EUR'}},
    });
    await flush();
    assert.strictEqual(outbound.length, 1);
    respond(0, {error: {code: 'UNKNOWN_FUNCTION', message: 'rate unavailable'}});
    assert.strictEqual(await obj.rate, undefined);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 'EXPRESSION_ERROR');
    assert.strictEqual(errors[0].expression, 'fetchFxRate');
  });

  it('cancels pre-microtask and in-flight agent calls when the surface is deleted or processor is disposed', async () => {
    ctx.resolveDynamicValue({'@call': 'preMicrotaskCall', 'args': {}});
    proc.processMessages({
      version: '1.0',
      deleteSurface: {surfaceId: 's1'},
    } as any);
    await flush();
    assert.strictEqual(
      outbound.length,
      0,
      'deleting a surface before the microtask prevents sending the outbound call',
    );
    assert.deepStrictEqual(errors, []);

    setUp({defaultTimeoutMs: 50});
    const sig = ctx.resolveSignal({'@call': 'fetchFxRate', 'args': {'base': 'EUR'}});
    await flush();
    assert.strictEqual(outbound.length, 1);
    proc.processMessages({
      version: '1.0',
      deleteSurface: {surfaceId: 's1'},
    } as any);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.strictEqual(getValue(sig), undefined);
    assert.deepStrictEqual(
      errors,
      [],
      'deleting a surface cancels its pending RPC timer without emitting a timeout error',
    );
  });

  it('sends an outer agent call only once its agent argument has settled', async () => {
    const sig = ctx.resolveSignal({
      '@call': 'convert',
      'args': {'rate': {'@call': 'fetchFxRate', 'args': {'base': 'EUR'}}},
    });
    await flush();
    assert.deepStrictEqual(
      outbound.map(m => m.callAgentFunction.callFunction['@call']),
      ['fetchFxRate'],
    );

    respond(0, {value: 1.08});
    await flush();
    assert.deepStrictEqual(outbound[1].callAgentFunction.callFunction.args, {'rate': 1.08});
    respond(1, {value: 'converted'});
    await flush();
    assert.strictEqual(getValue(sig), 'converted');
    assert.deepStrictEqual(errors, []);
  });

  it('validates and parses the arguments of a schema-only function before sending it', async () => {
    ctx.resolveDynamicValue({'@call': 'quote', 'args': {'symbol': 42}});
    await flush();
    assert.strictEqual(outbound.length, 0);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 'EXPRESSION_ERROR');
    assert.match(errors[0].message, /Validation failed for function 'quote'/);

    const result = ctx.resolveDynamicValue<Promise<number>>({
      '@call': 'quote',
      'args': {'symbol': 'GOOG'},
    });
    await flush();
    assert.strictEqual(outbound.length, 1);
    assert.deepStrictEqual(
      outbound[0].callAgentFunction.callFunction.args,
      {'symbol': 'GOOG', 'currency': 'USD'},
      'the parsed arguments are sent, with schema defaults applied',
    );
    respond(0, {value: 180});
    assert.strictEqual(await result, 180);
  });

  it('runs an implemented function locally', () => {
    assert.strictEqual(
      ctx.resolveDynamicValue({'@call': 'upper', 'args': {'value': 'abc'}}),
      'ABC',
    );
    assert.strictEqual(outbound.length, 0);
  });

  it('reports an agent error as an EXPRESSION_ERROR and clears the value', async () => {
    const sig = ctx.resolveSignal({'@call': 'fetchFxRate', 'args': {'base': 'EUR'}});
    await flush();

    respond(0, {error: {code: 'UNKNOWN_FUNCTION', message: 'No such function: fetchFxRate'}});
    await flush();
    assert.strictEqual(getValue(sig), undefined);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 'EXPRESSION_ERROR');
    assert.match(errors[0].message, /No such function: fetchFxRate/);
  });

  it('reports a timeout as an EXPRESSION_ERROR', async () => {
    setUp({defaultTimeoutMs: 5});
    const sig = ctx.resolveSignal({'@call': 'fetchFxRate', 'args': {'base': 'EUR'}});
    await new Promise(resolve => setTimeout(resolve, 30));

    assert.strictEqual(getValue(sig), undefined);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 'EXPRESSION_ERROR');
    assert.match(errors[0].message, /timed out/);
  });

  it('sends one request for identical calls awaiting a response', async () => {
    const call = {'@call': 'fetchFxRate', 'args': {'base': 'EUR'}};
    const first = ctx.resolveDynamicValue<Promise<number>>(call);
    const second = ctx.resolveDynamicValue<Promise<number>>(call);
    await flush();
    assert.strictEqual(outbound.length, 1);

    respond(0, {value: 1.08});
    assert.deepStrictEqual(await Promise.all([first, second]), [1.08, 1.08]);

    // Once answered, the same call is sent again.
    ctx.resolveDynamicValue(call);
    await flush();
    assert.strictEqual(outbound.length, 2);
  });

  it('sends a separate request when the arguments differ', async () => {
    ctx.resolveDynamicValue({'@call': 'fetchFxRate', 'args': {'base': 'EUR'}});
    ctx.resolveDynamicValue({'@call': 'fetchFxRate', 'args': {'base': 'USD'}});
    await flush();
    assert.strictEqual(outbound.length, 2);
  });

  it('sends an action function call to the agent', async () => {
    ctx.resolveAction({functionCall: {'@call': 'submitOrder', 'args': {'id': 'o-1'}}});
    await flush();
    assert.strictEqual(outbound.length, 1);
    assert.strictEqual(outbound[0].callAgentFunction.callFunction['@call'], 'submitOrder');
  });

  it('reports a call naming an unavailable catalog as a CATALOG_ERROR', async () => {
    ctx.resolveDynamicValue({
      '@call': 'fetchFxRate',
      'catalogId': 'https://example.com/unknown.json',
      'args': {},
    });
    await flush();
    assert.strictEqual(outbound.length, 0);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 'CATALOG_ERROR');
  });

  it('keeps failing locally without an outbound listener', async () => {
    setUp({outboundListener: false});
    assert.strictEqual(
      ctx.resolveDynamicValue({'@call': 'fetchFxRate', 'args': {'base': 'EUR'}}),
      undefined,
    );
    await flush();
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 'EXPRESSION_ERROR');
    assert.match(errors[0].message, /Function not found/);
  });

  it('does not route calls on a pre-1.0 surface', async () => {
    outbound = [];
    errors = [];
    const catalog = new Catalog<any, any>(FIN_CATALOG_ID, '0.9', [], [upper]);
    proc = new MessageProcessor([catalog], undefined, {
      outboundListener: msg => {
        outbound.push(msg);
      },
    });
    proc.processMessages({
      version: 'v0.9',
      createSurface: {surfaceId: 's1', catalogId: FIN_CATALOG_ID},
    } as any);
    const surface = proc.model.getSurface('s1')!;
    surface.onError.subscribe(e => {
      errors.push(e);
    });
    new DataContext(surface, '/').resolveDynamicValue({call: 'fetchFxRate', args: {}});
    await flush();
    assert.strictEqual(outbound.length, 0);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0].message, /Function not found/);
  });
});
