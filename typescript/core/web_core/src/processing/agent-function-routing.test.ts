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
import {afterEach, beforeEach, describe, it} from 'node:test';
import {z} from 'zod';

import {Catalog, createFunctionImplementation, FunctionApi} from '../catalog/types.js';
import {getValue, peekValue, setValue, signal} from '../reactivity/signals.js';
import {FormatStringImplementation} from '../catalogs/basic/v1/index.js';
import {A2uiRpcError, RpcErrorCode} from '../errors.js';
import {DataContext} from '../resolution/data-context.js';
import {MessageProcessor} from './message-processor.js';

/** Resolves on the next macrotask, after every pending microtask has run. */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const FIN_CATALOG_ID = 'https://example.com/fin/v1/catalog.json';

const upper = createFunctionImplementation(
  {
    name: 'upper',
    returnType: 'string',
    schema: z.object({'value': z.string()}),
    allowedCallers: 'rendererOrAgent',
  },
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

/** Schema-only function restricted to agent callers. */
const agentOnlySchemaFn: FunctionApi = {
  name: 'agentOnlySchemaFn',
  returnType: 'string',
  schema: z.object({}),
  allowedCallers: 'agentOnly',
};

/** Throws a plain `Error`, which an action reports as an `EXECUTION_ERROR`. */
const explode = createFunctionImplementation(
  {name: 'explode', returnType: 'string', schema: z.object({'value': z.string()})},
  () => {
    throw new Error('boom');
  },
);

/** Records the evaluation flags its context carries when it runs. */
const probeCalls: Array<{isActionExecution: boolean; isUserActivated: boolean}> = [];
const probe = createFunctionImplementation(
  {name: 'probe', returnType: 'string', schema: z.object({'value': z.string()})},
  (args, ctx) => {
    probeCalls.push({
      isActionExecution: ctx.isActionExecution,
      isUserActivated: ctx.isUserActivated,
    });
    return args.value;
  },
);

/** Schema-only function that requires a user gesture. */
const confirmPayment: FunctionApi = {
  name: 'confirmPayment',
  returnType: 'boolean',
  schema: z.object({}),
  requiresUserActivation: true,
};

/** Returns a signal that the test drives, to check that a binding follows it. */
const liveSignals: Array<ReturnType<typeof signal<string>>> = [];
const liveValue = createFunctionImplementation(
  {name: 'liveValue', returnType: 'string', schema: z.object({'seed': z.string()})},
  args => {
    const sig = signal(args.seed);
    liveSignals.push(sig);
    return sig;
  },
);

/** Resolves after a macrotask, so a call that awaits it is suspended meanwhile. */
const slowToken = createFunctionImplementation(
  {name: 'slowToken', returnType: 'string', schema: z.object({})},
  () => new Promise<string>(resolve => setTimeout(() => resolve('tok'), 5)) as unknown as string,
);

/** Accepts only `b`, so any other argument key is reported, not dropped. */
const strictEcho = createFunctionImplementation(
  {
    name: 'strictEcho',
    returnType: 'number',
    schema: z.object({'b': z.number()}).strict(),
    allowedCallers: 'rendererOrAgent',
  },
  args => args.b,
);

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
    proc?.dispose();
    outbound = [];
    errors = [];
    const catalog = new Catalog<any, any>(
      FIN_CATALOG_ID,
      '1.0',
      [],
      [
        upper,
        concat,
        quote,
        agentOnlySchemaFn,
        explode,
        probe,
        confirmPayment,
        liveValue,
        slowToken,
        strictEcho,
        FormatStringImplementation,
      ],
    );
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
  afterEach(() => proc?.dispose());

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

  it('cancels pre-microtask and in-flight agent calls when the surface is deleted', async () => {
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

  it('shares in-flight and settled answers for reactive bindings with canonical argument keys, and evicts on failure', async () => {
    const first = ctx.resolveDynamicValue<Promise<number>>({
      '@call': 'fetchFxRate',
      'args': {'base': 'EUR', 'target': 'USD'},
    });
    const second = ctx.resolveDynamicValue<Promise<number>>({
      '@call': 'fetchFxRate',
      'args': {'target': 'USD', 'base': 'EUR'},
    });
    await flush();
    assert.strictEqual(outbound.length, 1);

    respond(0, {value: 1.08});
    assert.deepStrictEqual(await Promise.all([first, second]), [1.08, 1.08]);

    // Once answered, a binding with the same canonical arguments reads the cached answer without sending again.
    const cached = ctx.resolveDynamicValue<Promise<number>>({
      '@call': 'fetchFxRate',
      'args': {'target': 'USD', 'base': 'EUR'},
    });
    await flush();
    assert.strictEqual(outbound.length, 1);
    assert.strictEqual(await cached, 1.08);

    // Array element order is preserved (not sorted).
    ctx.resolveDynamicValue({'@call': 'sumList', 'args': {'values': [1, 2]}});
    ctx.resolveDynamicValue({'@call': 'sumList', 'args': {'values': [2, 1]}});
    await flush();
    assert.strictEqual(outbound.length, 3);

    // A failed call is evicted so a later retry sends a fresh request.
    const failedTry = ctx.resolveDynamicValue<Promise<number>>({
      '@call': 'flakyRate',
      'args': {'base': 'GBP'},
    });
    await flush();
    assert.strictEqual(outbound.length, 4);
    respond(3, {error: {code: 'EXECUTION_ERROR', message: 'temporary failure'}});
    assert.strictEqual(await failedTry, undefined);
    assert.strictEqual(errors.length, 1);

    const retry = ctx.resolveDynamicValue<Promise<number>>({
      '@call': 'flakyRate',
      'args': {'base': 'GBP'},
    });
    await flush();
    assert.strictEqual(outbound.length, 5);
    respond(4, {value: 1.27});
    assert.strictEqual(await retry, 1.27);
  });

  it('sends a separate request when the arguments differ, and reuses settled answers on A->B->A flip-back', async () => {
    const surface = proc.model.getSurface('s1')!;
    surface.dataModel.set('/base', 'EUR');
    const sub = ctx.subscribeDynamicValue<number>(
      {'@call': 'fetchFxRate', 'args': {'base': {'@path': '/base'}}},
      () => {},
    );
    await flush();
    assert.strictEqual(outbound.length, 1);
    respond(0, {value: 1.08});
    await flush();
    assert.strictEqual(sub.value, 1.08);

    surface.dataModel.set('/base', 'GBP');
    await flush();
    assert.strictEqual(outbound.length, 2);
    respond(1, {value: 1.27});
    await flush();
    assert.strictEqual(sub.value, 1.27);

    // Flipping back to EUR reuses the settled answer without a third request.
    surface.dataModel.set('/base', 'EUR');
    await flush();
    assert.strictEqual(outbound.length, 2);
    assert.strictEqual(sub.value, 1.08);
    sub.unsubscribe();
  });

  it('never shares or caches imperative action function calls or event action context calls', async () => {
    const action = {functionCall: {'@call': 'submitOrder', 'args': {'id': 'o-1'}}};
    const p1 = ctx.resolveAction(action) as Promise<unknown>;
    const p2 = ctx.resolveAction(action) as Promise<unknown>;
    await flush();
    assert.strictEqual(
      outbound.length,
      2,
      'concurrent action clicks do not share an in-flight call',
    );
    respond(0, {value: 'ok-1'});
    respond(1, {value: 'ok-2'});
    assert.deepStrictEqual(await Promise.all([p1, p2]), ['ok-1', 'ok-2']);

    const p3 = ctx.resolveAction(action) as Promise<unknown>;
    await flush();
    assert.strictEqual(outbound.length, 3, 'subsequent action click does not read a cached answer');
    respond(2, {value: 'ok-3'});
    assert.strictEqual(await p3, 'ok-3');

    // Event action context awaits nested agent calls before dispatching onAction,
    // and suppresses dispatch if a context agent call fails.
    const surface = proc.model.getSurface('s1')!;
    const dispatchedActions: any[] = [];
    surface.onAction.subscribe(a => {
      dispatchedActions.push(a);
    });
    const evAction = {
      event: {
        name: 'checkout',
        context: {'quote': {'@call': 'quote', 'args': {'symbol': 'GOOG'}}},
      },
    };
    const resolvedEv = ctx.resolveAction(evAction);
    const dispatchPromise = surface.dispatchAction(resolvedEv, 'btn-1');
    await flush();
    assert.strictEqual(outbound.length, 4);
    assert.strictEqual(
      dispatchedActions.length,
      0,
      'waits for agent call in context before emitting',
    );
    respond(3, {value: 185});
    await dispatchPromise;
    assert.strictEqual(dispatchedActions.length, 1);
    assert.deepStrictEqual(dispatchedActions[0].context, {'quote': 185});

    // Failed agent call in event context suppresses action dispatch and emits EXPRESSION_ERROR.
    const resolvedEvFail = ctx.resolveAction(evAction);
    const dispatchFailPromise = surface.dispatchAction(resolvedEvFail, 'btn-1');
    await flush();
    assert.strictEqual(outbound.length, 5);
    respond(4, {error: {code: 'EXECUTION_ERROR', message: 'quote failed'}});
    await dispatchFailPromise;
    assert.strictEqual(
      dispatchedActions.length,
      1,
      'failed context call suppresses action dispatch',
    );
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 'EXPRESSION_ERROR');
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

  it('refuses a schema-only function with allowedCallers agentOnly without sending it to the agent', async () => {
    assert.strictEqual(
      ctx.resolveDynamicValue({'@call': 'agentOnlySchemaFn', 'args': {}}),
      undefined,
    );
    await flush();
    assert.strictEqual(outbound.length, 0);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 'EXPRESSION_ERROR');
    assert.match(errors[0].message, /allowedCallers is agentOnly/);
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

  it('keeps the pre-1.0 behavior for a failed nested call: the enclosing call runs with undefined', async () => {
    const failingAsync = createFunctionImplementation(
      {name: 'failingAsync', returnType: 'string', schema: z.object({})},
      () => Promise.reject(new Error('async failure')) as unknown as string,
    );
    const orDefault = createFunctionImplementation(
      {name: 'orDefault', returnType: 'string', schema: z.object({'value': z.any().optional()})},
      args => (args.value as string | undefined) ?? 'fallback',
    );
    const catalog = new Catalog<any, any>(FIN_CATALOG_ID, '0.9', [], [failingAsync, orDefault]);
    proc = new MessageProcessor([catalog]);
    proc.processMessages({
      version: 'v0.9',
      createSurface: {surfaceId: 's1', catalogId: FIN_CATALOG_ID},
    } as any);
    const surface = proc.model.getSurface('s1')!;
    const preErrors: unknown[] = [];
    surface.onError.subscribe(e => {
      preErrors.push(e);
    });
    const result = new DataContext(surface, '/').resolveDynamicValue<Promise<string>>({
      call: 'orDefault',
      args: {value: {call: 'failingAsync', args: {}}},
    });
    assert.strictEqual(await result, 'fallback');
    assert.strictEqual(preErrors.length, 1);
  });

  it('bypasses cache for outer action calls whose arguments contain a pending agent call', async () => {
    const action = {
      functionCall: {
        '@call': 'submitOrder',
        'args': {
          token: {'@call': 'getCsrfToken', 'args': {}},
        },
      },
    };
    const p1 = Promise.resolve(ctx.resolveAction(action));
    await flush();
    assert.strictEqual(outbound.length, 1);
    assert.strictEqual(outbound[0].callAgentFunction.callFunction['@call'], 'getCsrfToken');
    respond(0, {value: 'tok-fixed'});
    await flush();
    assert.strictEqual(outbound.length, 2);
    assert.strictEqual(outbound[1].callAgentFunction.callFunction['@call'], 'submitOrder');
    respond(1, {value: 'order-1'});
    assert.strictEqual(await p1, 'order-1');

    // Second click with the same inner token answer still dispatches submitOrder fresh.
    const p2 = Promise.resolve(ctx.resolveAction(action));
    await flush();
    assert.strictEqual(outbound.length, 3);
    assert.strictEqual(outbound[2].callAgentFunction.callFunction['@call'], 'getCsrfToken');
    respond(2, {value: 'tok-fixed'});
    await flush();
    assert.strictEqual(outbound.length, 4);
    assert.strictEqual(outbound[3].callAgentFunction.callFunction['@call'], 'submitOrder');
    respond(3, {value: 'order-2'});
    assert.strictEqual(await p2, 'order-2');
  });

  it('aborts event action resolution synchronously when a context entry fails synchronously', async () => {
    const resolved = ctx.resolveAction({
      event: {
        name: 'checkout',
        context: {
          badQuote: {'@call': 'quote', 'args': {'value': 'not-a-number'}},
        },
        userMessage: {'@call': 'fetchSummary', 'args': {}},
      },
    });
    assert.strictEqual(resolved, undefined);
    await flush();
    assert.strictEqual(outbound.length, 0);
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 'EXPRESSION_ERROR');
  });
  // U1: the flags of a call survive its pending arguments.
  it('keeps the action flags for a local function that runs after an agent argument settles', async () => {
    probeCalls.length = 0;
    const done = Promise.resolve(
      ctx.resolveAction({
        functionCall: {'@call': 'probe', 'args': {'value': {'@call': 'fetchGreeting', 'args': {}}}},
      }),
    );
    await flush();
    respond(0, {value: 'hi'});
    assert.strictEqual(await done, 'hi');
    assert.deepStrictEqual(probeCalls, [{isActionExecution: true, isUserActivated: true}]);

    const failed = Promise.resolve(
      ctx.resolveAction({
        functionCall: {
          '@call': 'explode',
          'args': {'value': {'@call': 'fetchGreeting2', 'args': {}}},
        },
      }),
    );
    await flush();
    respond(1, {value: 'hi'});
    await failed;
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(
      errors[0].code,
      'EXECUTION_ERROR',
      'an action that throws after awaiting an argument is still an action failure',
    );
  });

  // U2: event action entries resolve one at a time and stop at the first failure.
  it('resolves event context entries in order and sends nothing after a failed entry', async () => {
    const surface = proc.model.getSurface('s1')!;
    const dispatched: unknown[] = [];
    surface.onAction.subscribe(a => {
      dispatched.push(a);
    });
    const action = {
      event: {
        name: 'checkout',
        context: {
          'a': {'@call': 'fetchA', 'args': {}},
          'b': {'@call': 'fetchB', 'args': {}},
        },
        userMessage: {'@call': 'fetchMessage', 'args': {}},
      },
    };

    const ok = surface.dispatchAction(ctx.resolveAction(action), 'btn');
    await flush();
    assert.deepStrictEqual(
      outbound.map(m => m.callAgentFunction.callFunction['@call']),
      ['fetchA'],
      'the second entry waits for the first',
    );
    respond(0, {value: 1});
    await flush();
    assert.strictEqual(outbound[1].callAgentFunction.callFunction['@call'], 'fetchB');
    respond(1, {value: 2});
    await flush();
    assert.strictEqual(outbound[2].callAgentFunction.callFunction['@call'], 'fetchMessage');
    respond(2, {value: 'Buy'});
    await ok;
    assert.strictEqual(dispatched.length, 1);
    assert.deepStrictEqual((dispatched[0] as any).context, {'a': 1, 'b': 2});
    assert.strictEqual((dispatched[0] as any).userMessage, 'Buy');

    const failing = surface.dispatchAction(ctx.resolveAction(action), 'btn');
    await flush();
    assert.strictEqual(outbound.length, 4);
    respond(3, {error: {code: 'EXECUTION_ERROR', message: 'A failed'}});
    await failing;
    await flush();
    assert.strictEqual(outbound.length, 4, 'no later entry is evaluated after a failure');
    assert.strictEqual(dispatched.length, 1, 'the action is not dispatched');
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].expression, 'fetchA');
  });

  it('resolves an event action to plain values, with no internal placeholders', async () => {
    const resolved = ctx.resolveAction({
      event: {name: 'go', context: {'rate': {'@call': 'fetchFxRate', 'args': {}}}},
    });
    assert.ok(resolved instanceof Promise, 'an action waiting on the agent resolves to a Promise');
    await flush();
    respond(0, {value: 1.08});
    assert.deepStrictEqual(await resolved, {event: {name: 'go', context: {'rate': 1.08}}});

    const failed = ctx.resolveAction({
      event: {name: 'go', context: {'rate': {'@call': 'fetchFxRate2', 'args': {}}}},
    });
    await flush();
    respond(1, {error: {code: 'EXECUTION_ERROR', message: 'down'}});
    assert.strictEqual(await failed, undefined);
  });

  it('treats a userMessage that resolves to nothing as absent, and any other non-string as invalid', async () => {
    assert.deepStrictEqual(
      ctx.resolveAction({event: {name: 'go', userMessage: {'@path': '/missing'}}}),
      {event: {name: 'go'}},
    );
    const pendingNull = ctx.resolveAction({
      event: {name: 'go', userMessage: {'@call': 'fetchMessage', 'args': {}}},
    });
    await flush();
    respond(0, {value: null});
    assert.deepStrictEqual(await pendingNull, {event: {name: 'go'}});
    assert.strictEqual(errors.length, 0);

    assert.strictEqual(ctx.resolveAction({event: {name: 'go', userMessage: 42}}), undefined);
    const pendingNumber = ctx.resolveAction({
      event: {name: 'go', userMessage: {'@call': 'fetchMessage2', 'args': {}}},
    });
    await flush();
    respond(1, {value: 42});
    assert.strictEqual(await pendingNumber, undefined);
    assert.deepStrictEqual(
      errors.map(e => [e.code, e.message]),
      [
        ['INVALID_ACTION', "Action event 'userMessage' must resolve to a string."],
        ['INVALID_ACTION', "Action event 'userMessage' must resolve to a string."],
      ],
    );
  });

  it('does not send a sibling agent call when another argument fails first', async () => {
    assert.strictEqual(
      ctx.resolveDynamicValue({
        '@call': 'concat',
        'args': {
          'a': {'@call': 'quote', 'args': {'symbol': 42}},
          'b': {'@call': 'fetchGreeting', 'args': {}},
        },
      }),
      undefined,
    );
    await flush();
    assert.strictEqual(outbound.length, 0, 'the sibling call is aborted before it is sent');
    assert.strictEqual(errors.length, 1);
  });

  it('reports a sibling that fails after another argument failed only once', async () => {
    const result = ctx.resolveDynamicValue<Promise<unknown>>({
      '@call': 'concat',
      'args': {
        'a': {'@call': 'fetchA', 'args': {}},
        'b': {'@call': 'fetchB', 'args': {}},
      },
    });
    await flush();
    assert.strictEqual(outbound.length, 2, 'sibling arguments run concurrently');
    respond(0, {error: {code: 'EXECUTION_ERROR', message: 'A failed'}});
    await flush();
    respond(1, {error: {code: 'EXECUTION_ERROR', message: 'B failed'}});
    assert.strictEqual(await result, undefined);
    await flush();
    assert.deepStrictEqual(
      errors.map(e => e.expression),
      ['fetchA'],
      'the late failure of an aborted sibling is not reported',
    );
  });

  // U3: event actions honor the caller's user activation.
  it('applies userActivation to event action context entries', async () => {
    const action = {
      event: {name: 'pay', context: {'ok': {'@call': 'confirmPayment', 'args': {}}}},
    };
    assert.strictEqual(ctx.resolveAction(action, {userActivation: false}), undefined);
    await flush();
    assert.strictEqual(outbound.length, 0, 'a passive action does not send the call');
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0].message, /requires user activation/);

    const resolved = ctx.resolveAction(action, {userActivation: true});
    await flush();
    assert.strictEqual(outbound.length, 1);
    respond(0, {value: true});
    assert.deepStrictEqual(await resolved, {event: {name: 'pay', context: {'ok': true}}});
  });

  // U4: call keys and JSON arguments.
  it('keeps "__proto__" an ordinary argument key when sharing calls', async () => {
    ctx.resolveDynamicValue({'@call': 'lookup', 'args': JSON.parse('{"__proto__": {"a": 1}}')});
    ctx.resolveDynamicValue({'@call': 'lookup', 'args': JSON.parse('{"__proto__": {"a": 2}}')});
    await flush();
    assert.strictEqual(outbound.length, 2, 'calls with different "__proto__" values are distinct');
    assert.deepStrictEqual(
      outbound[0].callAgentFunction.callFunction.args,
      JSON.parse('{"__proto__": {"a": 1}}'),
    );
  });

  it('fails a call whose arguments are not valid JSON locally, and omits undefined properties', async () => {
    for (const bad of [NaN, Infinity, new Date(0), [1, undefined]]) {
      ctx.resolveDynamicValue({'@call': 'lookup', 'args': {'value': bad}});
    }
    await flush();
    assert.strictEqual(outbound.length, 0);
    assert.strictEqual(errors.length, 4);
    for (const error of errors) {
      assert.strictEqual(error.code, 'EXPRESSION_ERROR');
      assert.strictEqual(error.expression, 'lookup');
      assert.match(error.message, /arguments of function 'lookup' are not valid JSON/i);
    }

    ctx.resolveDynamicValue({
      '@call': 'lookup',
      'args': {'base': 'EUR', 'missing': {'@path': '/nothing/here'}},
    });
    await flush();
    assert.strictEqual(outbound.length, 1);
    assert.deepStrictEqual(outbound[0].callAgentFunction.callFunction.args, {'base': 'EUR'});
  });

  // U6: cached and shared answers are copies.
  it('gives each caller its own copy of a shared or cached answer', async () => {
    const first = ctx.resolveDynamicValue<Promise<{list: number[]}>>({
      '@call': 'fetchProfile',
      'args': {},
    });
    const second = ctx.resolveDynamicValue<Promise<{list: number[]}>>({
      '@call': 'fetchProfile',
      'args': {},
    });
    await flush();
    assert.strictEqual(outbound.length, 1);
    respond(0, {value: {list: [1]}});
    const [a, b] = await Promise.all([first, second]);
    a.list.push(2);
    assert.deepStrictEqual(b, {list: [1]}, 'in-flight sharers do not see each other mutate');

    const cached = await ctx.resolveDynamicValue<Promise<{list: number[]}>>({
      '@call': 'fetchProfile',
      'args': {},
    });
    assert.strictEqual(outbound.length, 1);
    assert.deepStrictEqual(cached, {list: [1]}, 'mutating an answer does not change the cache');
    cached.list.push(3);
    const again = await ctx.resolveDynamicValue<Promise<{list: number[]}>>({
      '@call': 'fetchProfile',
      'args': {},
    });
    assert.deepStrictEqual(again, {list: [1]});
  });

  // U7: cancellation is silent.
  it('does not report calls cancelled on a live surface', async () => {
    const sig = ctx.resolveSignal({'@call': 'fetchFxRate', 'args': {}});
    const action = Promise.resolve(
      ctx.resolveAction({functionCall: {'@call': 'submitOrder', 'args': {}}}),
    );
    await flush();
    assert.strictEqual(outbound.length, 2);
    let rejection: unknown;
    proc.rpc
      .callAgentFunction('s1', {'@call': 'other', 'catalogId': FIN_CATALOG_ID, 'args': {}})
      .catch(e => {
        rejection = e;
      });
    proc.rpc.cancelSurfaceCalls('s1');
    await flush();
    assert.strictEqual(await action, undefined);
    assert.strictEqual(getValue(sig), undefined);
    assert.deepStrictEqual(errors, []);
    assert.ok(rejection instanceof A2uiRpcError);
    assert.strictEqual((rejection as A2uiRpcError).code, RpcErrorCode.CANCELLED);
    assert.match((rejection as Error).message, /Pending calls for surface 's1' were cancelled\./);
  });

  // U8: a deleted surface sends nothing.
  it('does not send an action call that resumes after its surface was deleted', async () => {
    const action = Promise.resolve(
      ctx.resolveAction({
        functionCall: {
          '@call': 'submitOrder',
          'args': {'token': {'@call': 'slowToken', 'args': {}}},
        },
      }),
    );
    proc.processMessages({version: '1.0', deleteSurface: {surfaceId: 's1'}} as any);
    assert.strictEqual(await action, undefined);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.strictEqual(outbound.length, 0);
    assert.deepStrictEqual(errors, []);
  });

  it('cancels a call made through a removed surface without sending it', async () => {
    const surface = proc.model.getSurface('s1')!;
    const caller = surface.agentFunctionCaller!;
    proc.model.deleteSurface('s1');
    await assert.rejects(
      caller({'@call': 'late', 'catalogId': FIN_CATALOG_ID, 'args': {}}),
      (e: unknown) => e instanceof A2uiRpcError && e.code === RpcErrorCode.CANCELLED,
    );
    assert.strictEqual(outbound.length, 0);
  });

  // U9: schema-only arguments are validated once resolved.
  it('validates the resolved arguments of a schema-only function', async () => {
    const surface = proc.model.getSurface('s1')!;
    surface.dataModel.set('/sym', 'GOOG');
    ctx.resolveDynamicValue({'@call': 'quote', 'args': {'symbol': {'@path': '/sym'}}});
    await flush();
    assert.deepStrictEqual(outbound[0].callAgentFunction.callFunction.args, {
      'symbol': 'GOOG',
      'currency': 'USD',
    });

    const res = ctx.resolveDynamicValue<Promise<unknown>>({
      '@call': 'quote',
      'args': {'symbol': {'@call': 'fetchSymbol', 'args': {}}},
    });
    await flush();
    assert.strictEqual(outbound[1].callAgentFunction.callFunction['@call'], 'fetchSymbol');
    respond(1, {value: 42});
    assert.strictEqual(await res, undefined);
    await flush();
    assert.strictEqual(outbound.length, 2, 'an invalid resolved argument is not sent');
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0].message, /Validation failed for function 'quote'/);
  });

  // U12: a failed call is not re-sent for equal arguments, but is retried.
  it('does not re-send a failed call when its arguments re-evaluate to equal values', async () => {
    const surface = proc.model.getSurface('s1')!;
    surface.dataModel.set('/user', {id: 1});
    const sub = ctx.subscribeDynamicValue(
      {'@call': 'fetchProfile', 'args': {'user': {'@path': '/user'}}},
      () => {},
    );
    await flush();
    respond(0, {error: {code: 'EXECUTION_ERROR', message: 'nope'}});
    await flush();
    assert.strictEqual(errors.length, 1);

    surface.dataModel.set('/user', {id: 1});
    await flush();
    assert.strictEqual(outbound.length, 1, 'equal arguments do not re-send the failed call');

    surface.dataModel.set('/user', {id: 2});
    await flush();
    assert.strictEqual(outbound.length, 2, 'new arguments send the call');

    const other = ctx.subscribeDynamicValue(
      {'@call': 'fetchProfile', 'args': {'user': {'@path': '/user'}}},
      () => {},
    );
    respond(1, {error: {code: 'EXECUTION_ERROR', message: 'nope'}});
    await flush();
    surface.dataModel.set('/user', {id: 1});
    await flush();
    const third = ctx.subscribeDynamicValue(
      {'@call': 'fetchProfile', 'args': {'user': {'@path': '/user'}}},
      () => {},
    );
    await flush();
    assert.ok(
      outbound.length >= 3 &&
        outbound.slice(2).every(m => m.callAgentFunction.callFunction.args.user.id === 1),
      'a new evaluation retries a failed call',
    );
    sub.unsubscribe();
    other.unsubscribe();
    third.unsubscribe();
  });

  // U13: a Signal returned after pending arguments settle keeps streaming.
  it('follows a Signal that a local function returns after an agent argument settles', async () => {
    liveSignals.length = 0;
    const values: unknown[] = [];
    const sub = ctx.subscribeDynamicValue(
      {'@call': 'liveValue', 'args': {'seed': {'@call': 'fetchSeed', 'args': {}}}},
      value => values.push(value),
    );
    await flush();
    respond(0, {value: 'one'});
    await flush();
    assert.strictEqual(sub.value, 'one');
    setValue(liveSignals[liveSignals.length - 1], 'two');
    assert.strictEqual(sub.value, 'two');
    sub.unsubscribe();
    setValue(liveSignals[liveSignals.length - 1], 'three');
    assert.strictEqual(values[values.length - 1], 'two', 'unsubscribing stops the forwarding');
  });

  // U5: replacing the caller drops the caches.
  it('drops shared and cached answers when the agent caller changes', async () => {
    const surface = proc.model.getSurface('s1')!;
    const first = ctx.resolveDynamicValue<Promise<unknown>>({'@call': 'fetchFxRate', 'args': {}});
    await flush();
    respond(0, {value: 1});
    assert.strictEqual(await first, 1);

    const sent: unknown[] = [];
    surface.agentFunctionCaller = async call => {
      sent.push(call);
      return 2;
    };
    assert.strictEqual(
      await ctx.resolveDynamicValue<Promise<unknown>>({'@call': 'fetchFxRate', 'args': {}}),
      2,
      'the new caller answers instead of the old cache',
    );
    assert.strictEqual(sent.length, 1);
  });
  // Round 2.
  /** Sends an agent-initiated `callRendererFunction` and returns the response. */
  const callRenderer = async (callFunction: Record<string, unknown>) => {
    const before = outbound.length;
    proc.processMessages({
      version: '1.0',
      callRendererFunction: {
        functionCallId: `rpc-${before}`,
        surfaceId: 's1',
        callFunction: {catalogId: FIN_CATALOG_ID, ...callFunction},
      },
    } as any);
    await flush();
    await flush();
    return outbound.slice(before);
  };

  it('sends a cancelled call again when its binding re-evaluates with equal arguments (V1)', async () => {
    const surface = proc.model.getSurface('s1')!;
    surface.dataModel.set('/user', {id: 1});
    const sub = ctx.subscribeDynamicValue(
      {'@call': 'fetchProfile', 'args': {'user': {'@path': '/user'}}},
      () => {},
    );
    await flush();
    assert.strictEqual(outbound.length, 1);
    proc.rpc.cancelSurfaceCalls('s1');
    await flush();
    assert.strictEqual(errors.length, 0, 'a cancellation is silent');

    surface.dataModel.set('/user', {id: 1});
    await flush();
    assert.strictEqual(outbound.length, 2, 'a cancellation is not remembered as a failure');
    respond(1, {value: 'profile'});
    await flush();
    assert.strictEqual(sub.value, 'profile');
    sub.unsubscribe();
  });

  it('disposes surfaces and the RPC handler silently when the processor is disposed mid-call (V4)', async () => {
    setUp({defaultTimeoutMs: 30});
    const surface = proc.model.getSurface('s1')!;
    const processorErrors: unknown[] = [];
    proc.model.onError.subscribe(e => {
      processorErrors.push(e);
    });
    const sub = ctx.subscribeDynamicValue({'@call': 'fetchFxRate', 'args': {}}, () => {});
    await flush();
    assert.strictEqual(outbound.length, 1);
    let pendingRejection: unknown;
    proc.rpc
      .callAgentFunction('s1', {'@call': 'other', 'catalogId': FIN_CATALOG_ID, 'args': {}})
      .catch(e => {
        pendingRejection = e;
      });

    proc.dispose();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.strictEqual(surface.disposed, true);
    assert.ok(pendingRejection instanceof A2uiRpcError, 'no call is left pending');
    await assert.rejects(
      proc.rpc.callAgentFunction('s1', {'@call': 'x', 'catalogId': FIN_CATALOG_ID, 'args': {}}),
      (e: unknown) => e instanceof A2uiRpcError && e.code === RpcErrorCode.DISPOSED,
    );
    assert.strictEqual(outbound.length, 2, 'nothing more is sent after disposal');
    assert.deepStrictEqual(errors, []);
    assert.deepStrictEqual(processorErrors, []);
    sub.unsubscribe();
  });

  it('cancels a deleted surface pending calls exactly once (V5)', async () => {
    let cancellations = 0;
    const cancel = proc.rpc.cancelSurfaceCalls.bind(proc.rpc);
    proc.rpc.cancelSurfaceCalls = (surfaceId: string) => {
      cancellations++;
      cancel(surfaceId);
    };
    const pending = proc.rpc.callAgentFunction('s1', {
      '@call': 'other',
      'catalogId': FIN_CATALOG_ID,
      'args': {},
    });
    proc.processMessages({version: '1.0', deleteSurface: {surfaceId: 's1'}} as any);
    await assert.rejects(
      pending,
      (e: unknown) => e instanceof A2uiRpcError && e.code === RpcErrorCode.CANCELLED,
    );
    assert.strictEqual(cancellations, 1);
  });

  it('re-evaluates only the binding whose call settled, without resend loops past the cache size (V8)', async () => {
    const subs = Array.from({length: 300}, (_, i) =>
      ctx.subscribeDynamicValue({'@call': 'fetchItem', 'args': {'i': i}}, () => {}),
    );
    await flush();
    assert.strictEqual(outbound.length, 300);
    for (let i = 0; i < 300; i++) respond(i, {value: i});
    await flush();
    await flush();
    assert.strictEqual(outbound.length, 300, 'no binding re-sends after the cache evicts');
    assert.deepStrictEqual(
      subs.map(sub => sub.value),
      Array.from({length: 300}, (_, i) => i),
    );
    for (const sub of subs) sub.unsubscribe();
  });

  it('reports a local function that throws in an event action context as an EXECUTION_ERROR (V9)', () => {
    assert.strictEqual(
      ctx.resolveAction({
        event: {name: 'go', context: {'x': {'@call': 'explode', 'args': {'value': 'a'}}}},
      }),
      undefined,
    );
    assert.deepStrictEqual(
      errors.map(e => e.code),
      ['EXECUTION_ERROR'],
    );
  });

  it('does not route a nested call in the arguments of an agent callRendererFunction (V3)', async () => {
    const responses = await callRenderer({
      '@call': 'upper',
      'args': {'value': {'@call': 'fetchGreeting', 'args': {}}},
    });
    assert.ok(
      responses.every(m => !m.callAgentFunction),
      'no callAgentFunction is sent while the agent waits for this response',
    );
    const response = responses.find(m => m.rendererFunctionResponse)!.rendererFunctionResponse;
    assert.strictEqual(response.error.code, 'EXECUTION_ERROR');
    assert.match(response.error.message, /Function not found/);
  });

  it('refuses an agent call inside a formatString template without sending it (V3)', async () => {
    const template = {'@call': 'formatString', 'args': {'value': 'Hi ${fetchName()}!'}};
    const sub = ctx.subscribeDynamicValue(template, () => {});
    await flush();
    assert.strictEqual(outbound.length, 0, 'a template part never calls the agent');
    assert.strictEqual(sub.value, 'Hi !', 'the refused part renders empty');
    sub.unsubscribe();

    const resolved = ctx.resolveAction({event: {name: 'greet', context: {'msg': template}}});
    await flush();
    assert.strictEqual(outbound.length, 0);
    assert.deepStrictEqual(await resolved, {event: {name: 'greet', context: {'msg': 'Hi !'}}});
    assert.ok(errors.length >= 2);
    for (const error of errors) {
      assert.strictEqual(error.code, 'EXPRESSION_ERROR');
      assert.strictEqual(error.expression, 'fetchName');
    }
  });

  it('refuses template parts and callRendererFunction arguments even when the agent already answered the call (V3)', async () => {
    const cached = ctx.resolveDynamicValue<Promise<unknown>>({'@call': 'fetchName', 'args': {}});
    await flush();
    respond(0, {value: 'Ann'});
    assert.strictEqual(await cached, 'Ann');
    assert.strictEqual(
      await ctx.resolveDynamicValue<Promise<unknown>>({'@call': 'fetchName', 'args': {}}),
      'Ann',
      'the answer is cached for bindings',
    );
    assert.strictEqual(outbound.length, 1);

    const sub = ctx.subscribeDynamicValue(
      {'@call': 'formatString', 'args': {'value': 'Hi ${fetchName()}!'}},
      () => {},
    );
    await flush();
    assert.strictEqual(sub.value, 'Hi !', 'a template part does not read the cached answer');
    sub.unsubscribe();
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].code, 'EXPRESSION_ERROR');
    assert.strictEqual(errors[0].expression, 'fetchName');

    const responses = await callRenderer({
      '@call': 'upper',
      'args': {'value': {'@call': 'fetchName', 'args': {}}},
    });
    assert.ok(responses.every(m => !m.callAgentFunction));
    const response = responses.find(m => m.rendererFunctionResponse)!.rendererFunctionResponse;
    assert.strictEqual(response.error.code, 'EXECUTION_ERROR');
    assert.match(response.error.message, /Function not found/);
    assert.strictEqual(outbound.filter(m => m.callAgentFunction).length, 1, 'nothing more is sent');
  });

  it('sends schema defaults from a document catalog as a local implementation receives them (V11)', async () => {
    const docCatalog = Catalog.fromJson(
      {
        catalogId: 'https://example.com/doc.json',
        functions: {
          quoteDoc: {
            properties: {
              '@call': {const: 'quoteDoc'},
              args: {
                type: 'object',
                properties: {
                  symbol: {type: 'string'},
                  options: {
                    type: 'object',
                    properties: {currency: {type: 'string', default: 'USD'}},
                    default: {},
                  },
                },
                required: ['symbol'],
              },
            },
          },
        },
      },
      '1.0',
    );
    const fn = docCatalog.functions.get('quoteDoc')!;
    const localArgs = fn.schema.parse({symbol: 'GOOG'});
    proc = new MessageProcessor([docCatalog as any], undefined, {
      outboundListener: msg => {
        outbound.push(msg);
      },
    });
    proc.processMessages({
      version: '1.0',
      createSurface: {surfaceId: 's1', catalogId: 'https://example.com/doc.json'},
    } as any);
    new DataContext(proc.model.getSurface('s1')!, '/').resolveDynamicValue({
      '@call': 'quoteDoc',
      'args': {'symbol': 'GOOG'},
    });
    await flush();
    assert.deepStrictEqual(outbound[0].callAgentFunction.callFunction.args, localArgs);
    assert.deepStrictEqual(localArgs, {symbol: 'GOOG', options: {currency: 'USD'}});
  });

  it('reports a malformed event context value as EXPRESSION_ERROR, first or after a pending entry (V12)', async () => {
    const bad = {'@unknown': 1};
    assert.strictEqual(ctx.resolveAction({event: {name: 'go', context: {'bad': bad}}}), undefined);
    const later = ctx.resolveAction({
      event: {name: 'go', context: {'first': {'@call': 'fetchA', 'args': {}}, 'bad': bad}},
    });
    await flush();
    respond(0, {value: 1});
    assert.strictEqual(await later, undefined);
    assert.strictEqual(
      ctx.resolveAction({event: {name: 'go', userMessage: {'@unknown': 1}}}),
      undefined,
    );
    assert.strictEqual(errors.length, 3);
    for (const error of errors) {
      assert.strictEqual(error.code, 'EXPRESSION_ERROR');
      assert.strictEqual((error as {surfaceId?: string}).surfaceId, 's1');
    }
    assert.match(errors[0].message, /^Action event context entry 'bad' is invalid: /);
    assert.match(errors[1].message, /^Action event context entry 'bad' is invalid: /);
    assert.match(errors[2].message, /^Action event userMessage is invalid: /);
  });

  it('reports refusals in actions as EXPRESSION_ERROR; only a local function that throws is EXECUTION_ERROR (V9)', async () => {
    ctx.resolveAction(
      {event: {name: 'pay', context: {'ok': {'@call': 'confirmPayment', 'args': {}}}}},
      {userActivation: false},
    );
    ctx.resolveAction({
      event: {name: 'go', context: {'x': {'@call': 'agentOnlySchemaFn', 'args': {}}}},
    });
    ctx.resolveAction({functionCall: {'@call': 'agentOnlySchemaFn', 'args': {}}});
    ctx.resolveAction({
      event: {name: 'go', context: {'x': {'@call': 'upper', 'args': {'value': 42}}}},
    });
    ctx.resolveAction({functionCall: {'@call': 'upper', 'args': {'value': 42}}});
    ctx.resolveAction({functionCall: {'@call': 'explode', 'args': {'value': 'a'}}});
    await flush();
    assert.strictEqual(outbound.length, 0);
    assert.deepStrictEqual(
      errors.map(e => e.code),
      [
        'EXPRESSION_ERROR',
        'EXPRESSION_ERROR',
        'EXPRESSION_ERROR',
        'EXPRESSION_ERROR',
        'EXPRESSION_ERROR',
        'EXECUTION_ERROR',
      ],
    );
  });

  it('gives the agent a descriptive message when a nested argument fails without one (V13)', async () => {
    const responses = await callRenderer({
      '@call': 'upper',
      'args': {'value': {'@call': 'fetchGreeting', 'catalogId': 'https://example.com/none.json'}},
    });
    const response = responses.find(m => m.rendererFunctionResponse)!.rendererFunctionResponse;
    assert.strictEqual(response.error.code, 'EXECUTION_ERROR');
    assert.notStrictEqual(response.error.message, 'undefined');
    assert.match(response.error.message, /could not be resolved/);
  });

  it('keeps an agent-supplied "__proto__" argument an ordinary key (V14)', async () => {
    const ok = await callRenderer({'@call': 'strictEcho', 'args': {'b': 2}});
    assert.strictEqual(ok.find(m => m.rendererFunctionResponse)!.rendererFunctionResponse.value, 2);

    const responses = await callRenderer({
      '@call': 'strictEcho',
      'args': JSON.parse('{"__proto__": {"b": 3}, "b": 2}'),
    });
    const response = responses.find(m => m.rendererFunctionResponse)!.rendererFunctionResponse;
    assert.strictEqual(
      response.error?.code,
      'INVALID_FUNCTION_CALL',
      'the "__proto__" key reaches validation as an own key instead of being dropped',
    );
    assert.match(response.error.message, /__proto__/);
  });
});
