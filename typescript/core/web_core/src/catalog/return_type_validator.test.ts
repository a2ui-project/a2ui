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
import {describe, it} from 'node:test';
import {z} from 'zod';

import {A2uiExpressionError} from '../errors.js';
import {computed, getValue, isSignal, peekValue, setValue, signal} from '../reactivity/signals.js';
import {DataContext} from '../resolution/data-context.js';
import {DataModel} from '../state/data-model.js';
import {type A2uiErrorPayload, SurfaceModel} from '../state/surface-model.js';
import {assertFunctionReturnType, isValidReturnTypeValue} from './return_type_validator.js';
import {Catalog, type FunctionApi, type FunctionImplementation} from './types.js';

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const CATALOG_ID = 'https://example.com/return-type-test';

function makeFn(
  name: string,
  returnType: FunctionApi['returnType'],
  execute: FunctionImplementation['execute'],
  schema: z.ZodTypeAny = z.object({}),
): FunctionImplementation {
  return {
    name,
    returnType,
    schema,
    allowedCallers: 'rendererOrAgent',
    execute,
  };
}

describe('Function returnType runtime validation (Issue #4400)', () => {
  describe('isValidReturnTypeValue (strict, no coercion)', () => {
    it('validates string without coercing numbers or booleans', () => {
      assert.strictEqual(isValidReturnTypeValue('string', ''), true);
      assert.strictEqual(isValidReturnTypeValue('string', 'hello'), true);
      assert.strictEqual(isValidReturnTypeValue('string', 42), false);
      assert.strictEqual(isValidReturnTypeValue('string', true), false);
      assert.strictEqual(isValidReturnTypeValue('string', null), false);
      assert.strictEqual(isValidReturnTypeValue('string', undefined), false);
      assert.strictEqual(isValidReturnTypeValue('string', ['a']), false);
      assert.strictEqual(isValidReturnTypeValue('string', {}), false);
    });

    it('validates finite numbers without coercing numeric strings or accepting NaN/Infinity', () => {
      assert.strictEqual(isValidReturnTypeValue('number', 0), true);
      assert.strictEqual(isValidReturnTypeValue('number', -12.5), true);
      assert.strictEqual(isValidReturnTypeValue('number', '42'), false);
      assert.strictEqual(isValidReturnTypeValue('number', Number.NaN), false);
      assert.strictEqual(isValidReturnTypeValue('number', Number.POSITIVE_INFINITY), false);
      assert.strictEqual(isValidReturnTypeValue('number', Number.NEGATIVE_INFINITY), false);
      assert.strictEqual(isValidReturnTypeValue('number', true), false);
      assert.strictEqual(isValidReturnTypeValue('number', null), false);
      assert.strictEqual(isValidReturnTypeValue('number', undefined), false);
    });

    it('validates boolean without coercing truthy/falsy values', () => {
      assert.strictEqual(isValidReturnTypeValue('boolean', true), true);
      assert.strictEqual(isValidReturnTypeValue('boolean', false), true);
      assert.strictEqual(isValidReturnTypeValue('boolean', 1), false);
      assert.strictEqual(isValidReturnTypeValue('boolean', 0), false);
      assert.strictEqual(isValidReturnTypeValue('boolean', 'true'), false);
      assert.strictEqual(isValidReturnTypeValue('boolean', {valid: true}), false);
      assert.strictEqual(isValidReturnTypeValue('boolean', null), false);
      assert.strictEqual(isValidReturnTypeValue('boolean', undefined), false);
    });

    it('validates array and discriminates plain object from arrays and class instances', () => {
      assert.strictEqual(isValidReturnTypeValue('array', []), true);
      assert.strictEqual(isValidReturnTypeValue('array', [1, 'a']), true);
      assert.strictEqual(isValidReturnTypeValue('array', {}), false);
      assert.strictEqual(isValidReturnTypeValue('array', 'abc'), false);
      assert.strictEqual(isValidReturnTypeValue('array', null), false);

      assert.strictEqual(isValidReturnTypeValue('object', {}), true);
      assert.strictEqual(isValidReturnTypeValue('object', {a: 1}), true);
      assert.strictEqual(isValidReturnTypeValue('object', Object.create(null)), true);
      assert.strictEqual(isValidReturnTypeValue('object', []), false);
      assert.strictEqual(isValidReturnTypeValue('object', null), false);
      assert.strictEqual(isValidReturnTypeValue('object', new Date()), false);
      assert.strictEqual(isValidReturnTypeValue('object', '{}'), false);
    });

    it('validates validationResult objects strictly', () => {
      assert.strictEqual(isValidReturnTypeValue('validationResult', {valid: true}), true);
      assert.strictEqual(
        isValidReturnTypeValue('validationResult', {
          valid: false,
          code: 'REQUIRED',
          message: 'Field is required',
          severity: 'warning',
        }),
        true,
      );
      assert.strictEqual(
        isValidReturnTypeValue('validationResult', {valid: true, severity: 'info'}),
        true,
      );
      assert.strictEqual(
        isValidReturnTypeValue('validationResult', {valid: false, severity: 'error'}),
        true,
      );
      assert.strictEqual(isValidReturnTypeValue('validationResult', true), false);
      assert.strictEqual(isValidReturnTypeValue('validationResult', {}), false);
      assert.strictEqual(isValidReturnTypeValue('validationResult', {valid: 'true'}), false);
      assert.strictEqual(
        isValidReturnTypeValue('validationResult', {valid: false, severity: 'fatal'}),
        false,
      );
      assert.strictEqual(
        isValidReturnTypeValue('validationResult', {valid: false, code: 123}),
        false,
      );
      assert.strictEqual(
        isValidReturnTypeValue('validationResult', {valid: false, message: null}),
        false,
      );
      assert.strictEqual(isValidReturnTypeValue('validationResult', []), false);
      assert.strictEqual(isValidReturnTypeValue('validationResult', null), false);
    });

    it('validates void, any, and custom extension return types', () => {
      assert.strictEqual(isValidReturnTypeValue('void', undefined), true);
      assert.strictEqual(isValidReturnTypeValue('void', null), true);
      assert.strictEqual(isValidReturnTypeValue('void', ''), false);
      assert.strictEqual(isValidReturnTypeValue('void', 0), false);
      assert.strictEqual(isValidReturnTypeValue('void', false), false);
      assert.strictEqual(isValidReturnTypeValue('void', {}), false);

      for (const sample of ['a', 1, true, [], {}, null, undefined]) {
        assert.strictEqual(isValidReturnTypeValue('any', sample), true);
        assert.strictEqual(isValidReturnTypeValue('customToken', sample), true);
      }
    });

    it('throws A2uiExpressionError with function name and type details on mismatch', () => {
      assert.throws(
        () => assertFunctionReturnType('readCount', 'number', 'hello'),
        (err: unknown) =>
          err instanceof A2uiExpressionError &&
          err.expression === 'readCount' &&
          err.message.includes('string') &&
          err.message.includes('number'),
      );
    });
  });

  describe('Catalog.invoker and DataContext v1.0 validation', () => {
    it('rejects synchronous return type mismatches in Catalog.invoker and reports EXPRESSION_ERROR in DataContext', () => {
      const badFn = makeFn('readCount', 'number', () => 'hello');
      const okFn = makeFn('validCount', 'number', () => 7);
      const catalog = new Catalog(CATALOG_ID, '1.0', [], [badFn, okFn]);
      const surface = new SurfaceModel('s1', catalog);
      const errors: A2uiErrorPayload[] = [];
      surface.onError.subscribe(err => {
        errors.push(err);
      });
      const ctx = new DataContext(surface, '/');

      assert.strictEqual(catalog.invoker('validCount', {}, ctx), 7);
      assert.throws(
        () => catalog.invoker('readCount', {}, ctx),
        (err: unknown) => err instanceof A2uiExpressionError && err.expression === 'readCount',
      );

      const resolved = ctx.resolveDynamicValue({'@call': 'readCount', args: {}});
      assert.strictEqual(resolved, undefined);
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].code, 'EXPRESSION_ERROR');
      assert.strictEqual(errors[0].expression, 'readCount');
    });

    it('validates asynchronous Promise return values in Catalog.invoker and DataContext', async () => {
      const asyncBad = makeFn('asyncBad', 'number', async () => 'nope');
      const asyncGood = makeFn('asyncGood', 'number', async () => 12);
      const catalog = new Catalog(CATALOG_ID, '1.0', [], [asyncBad, asyncGood]);
      const surface = new SurfaceModel('s-async', catalog);
      const errors: A2uiErrorPayload[] = [];
      surface.onError.subscribe(err => {
        errors.push(err);
      });
      const ctx = new DataContext(surface, '/');

      assert.strictEqual(await catalog.invoker('asyncGood', {}, ctx), 12);
      await assert.rejects(
        () => Promise.resolve(catalog.invoker('asyncBad', {}, ctx)),
        (err: unknown) => err instanceof A2uiExpressionError && err.expression === 'asyncBad',
      );

      const resolved = await ctx.resolveDynamicValue({'@call': 'asyncBad', args: {}});
      assert.strictEqual(resolved, undefined);
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].code, 'EXPRESSION_ERROR');
      assert.strictEqual(errors[0].expression, 'asyncBad');
    });

    it('validates reactive Signal results across valid/invalid transitions while preserving subscriptions and cleanup', () => {
      const source = signal<unknown>(10);
      let cleanupCount = 0;
      const liveCount = makeFn('liveCount', 'number', () => {
        const derived = computed(() => getValue(source));
        derived.unsubscribe = () => {
          cleanupCount++;
        };
        return derived;
      });
      const catalog = new Catalog(CATALOG_ID, '1.0', [], [liveCount]);
      const surface = new SurfaceModel('s-sig', catalog);
      const errors: A2uiErrorPayload[] = [];
      surface.onError.subscribe(err => {
        errors.push(err);
      });
      const ctx = new DataContext(surface, '/');

      // Direct invoker preserves Signal and cleanup
      const directSig = catalog.invoker('liveCount', {}, ctx);
      assert.strictEqual(isSignal(directSig), true);
      assert.strictEqual(peekValue(directSig), 10);
      directSig.unsubscribe?.();
      assert.strictEqual(cleanupCount, 1);

      // Reactive subscription via DataContext
      const updates: Array<number | undefined> = [];
      const sub = ctx.subscribeDynamicValue<number>({'@call': 'liveCount', args: {}}, val => {
        updates.push(val);
      });
      assert.strictEqual(sub.value, 10);
      assert.strictEqual(errors.length, 0);

      // Transition to invalid value -> emits EXPRESSION_ERROR and resets binding
      setValue(source, 'not-a-number');
      assert.strictEqual(sub.value, undefined);
      assert.deepStrictEqual(updates, [undefined]);
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].code, 'EXPRESSION_ERROR');
      assert.strictEqual(errors[0].expression, 'liveCount');

      // Subscription stays alive and recovers when value becomes valid again
      setValue(source, 25);
      assert.strictEqual(sub.value, 25);
      assert.deepStrictEqual(updates, [undefined, 25]);
      assert.strictEqual(errors.length, 1);

      // Cleanup unsubscribes inner signal and stops future error reporting
      sub.unsubscribe();
      assert.strictEqual(cleanupCount, 2);
      setValue(source, 'after-unsubscribe');
      assert.strictEqual(errors.length, 1);
      assert.deepStrictEqual(updates, [undefined, 25]);
    });

    it('cleans up Signal subscriptions on one-shot resolveDynamicValue failures', () => {
      let unsubscribed = 0;
      const badSignalFn = makeFn('badSignalFn', 'number', () => {
        const inner = signal<unknown>('bad');
        inner.unsubscribe = () => {
          unsubscribed++;
        };
        return inner;
      });
      const catalog = new Catalog(CATALOG_ID, '1.0', [], [badSignalFn]);
      const surface = new SurfaceModel('s-oneshot', catalog);
      const errors: A2uiErrorPayload[] = [];
      surface.onError.subscribe(err => {
        errors.push(err);
      });
      const ctx = new DataContext(surface, '/');

      const result = ctx.resolveDynamicValue({'@call': 'badSignalFn', args: {}});
      assert.strictEqual(result, undefined);
      assert.strictEqual(unsubscribed, 1);
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].code, 'EXPRESSION_ERROR');
      assert.strictEqual(errors[0].expression, 'badSignalFn');
    });

    it('validates Promise-of-Signal results and preserves subscriptions and cleanup in reactive bindings', async () => {
      const source = signal<unknown>('initial-bad');
      let cleanupCount = 0;
      const asyncSignalFn = makeFn(
        'asyncSignalFn',
        'number',
        async () => {
          const derived = computed(() => getValue(source));
          derived.unsubscribe = () => {
            cleanupCount++;
          };
          return derived;
        },
        z.object({'key': z.string()}),
      );
      const catalog = new Catalog(CATALOG_ID, '1.0', [], [asyncSignalFn]);
      const surface = new SurfaceModel('s-async-sig', catalog);
      const errors: A2uiErrorPayload[] = [];
      surface.onError.subscribe(err => {
        errors.push(err);
      });
      const ctx = new DataContext(surface, '/');

      const updates: Array<number | undefined> = [];
      const sub = ctx.subscribeDynamicValue<number>(
        {'@call': 'asyncSignalFn', args: {key: 'k1'}},
        val => updates.push(val),
      );
      await flush();

      assert.strictEqual(sub.value, undefined);
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].expression, 'asyncSignalFn');

      setValue(source, 99);
      assert.strictEqual(sub.value, 99);
      assert.strictEqual(updates.at(-1), 99);

      sub.unsubscribe();
      assert.strictEqual(cleanupCount, 1);
      setValue(source, 'after-stop');
      assert.strictEqual(errors.length, 1);
    });

    it('unsubscribes a Promise-of-Signal result exactly once when resolved after abort', async () => {
      let directResolve!: (val: unknown) => void;
      let directCleanups = 0;
      let reactiveResolve!: (val: unknown) => void;
      let reactiveCleanups = 0;

      const deferredDirect = makeFn(
        'deferredDirect',
        'number',
        () =>
          new Promise(resolve => {
            directResolve = resolve;
          }),
      );
      const deferredReactive = makeFn(
        'deferredReactive',
        'number',
        () =>
          new Promise(resolve => {
            reactiveResolve = resolve;
          }),
      );
      const catalog = new Catalog(CATALOG_ID, '1.0', [], [deferredDirect, deferredReactive]);
      const surface = new SurfaceModel('s-abort-sig', catalog);
      const errors: A2uiErrorPayload[] = [];
      surface.onError.subscribe(err => {
        errors.push(err);
      });
      const ctx = new DataContext(surface, '/');

      // Direct Catalog.invoker call aborted before Promise resolves to a Signal
      const controller = new AbortController();
      const pending = catalog.invoker('deferredDirect', {}, ctx, controller.signal);
      controller.abort();
      const lateDirectSignal = signal<unknown>(42);
      lateDirectSignal.unsubscribe = () => {
        directCleanups++;
      };
      directResolve(lateDirectSignal);
      const resolvedDirect = await pending;
      assert.strictEqual(resolvedDirect, undefined);
      assert.strictEqual(directCleanups, 1);

      // Reactive DataContext binding unsubscribed before Promise resolves to a Signal
      const sig = ctx.resolveSignal({'@call': 'deferredReactive', args: {}});
      sig.unsubscribe?.();
      const lateReactiveSignal = signal<unknown>('bad-after-abort');
      lateReactiveSignal.unsubscribe = () => {
        reactiveCleanups++;
      };
      reactiveResolve(lateReactiveSignal);
      await flush();
      assert.strictEqual(reactiveCleanups, 1);
      assert.strictEqual(errors.length, 0);
    });

    it('stops enclosing calls when a nested call fails returnType validation without duplicate errors', async () => {
      let outerCalls = 0;
      const badInner = makeFn('badInner', 'number', () => 'wrong');
      const asyncBadInner = makeFn('asyncBadInner', 'number', async () => 'wrong-async');
      const outer = makeFn(
        'outer',
        'string',
        args => {
          outerCalls++;
          return String(args['value']);
        },
        z.object({'value': z.any()}),
      );
      const catalog = new Catalog(CATALOG_ID, '1.0', [], [badInner, asyncBadInner, outer]);
      const surface = new SurfaceModel('s-nested', catalog);
      const errors: A2uiErrorPayload[] = [];
      surface.onError.subscribe(err => {
        errors.push(err);
      });
      const ctx = new DataContext(surface, '/');

      const syncRes = ctx.resolveDynamicValue({
        '@call': 'outer',
        args: {value: {'@call': 'badInner', args: {}}},
      });
      assert.strictEqual(syncRes, undefined);
      assert.strictEqual(outerCalls, 0);
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].expression, 'badInner');

      const asyncRes = await ctx.resolveDynamicValue({
        '@call': 'outer',
        args: {value: {'@call': 'asyncBadInner', args: {}}},
      });
      assert.strictEqual(asyncRes, undefined);
      assert.strictEqual(outerCalls, 0);
      assert.strictEqual(errors.length, 2);
      assert.strictEqual(errors[1].expression, 'asyncBadInner');
    });

    it('validates declared schema-only functions routed to the agent and does not cache invalid responses', async () => {
      const agentCountDecl: FunctionApi = {
        name: 'agentCount',
        returnType: 'number',
        schema: z.object({'key': z.string()}),
        allowedCallers: 'rendererOrAgent',
      };
      const agentVoidDecl: FunctionApi = {
        name: 'agentVoid',
        returnType: 'void',
        schema: z.object({}),
        allowedCallers: 'rendererOrAgent',
      };
      const catalog = new Catalog(CATALOG_ID, '1.0', [], [agentCountDecl, agentVoidDecl]);
      const surface = new SurfaceModel('s-agent', catalog);
      const errors: A2uiErrorPayload[] = [];
      surface.onError.subscribe(err => {
        errors.push(err);
      });

      const responses: unknown[] = ['bad-string', 42];
      let callCount = 0;
      surface.agentFunctionCaller = async call => {
        if (call['@call'] === 'agentVoid') {
          return null;
        }
        if (call['@call'] === 'undeclaredAgentFn') {
          return 'any-undeclared-value';
        }
        return responses[callCount++];
      };

      const ctx = new DataContext(surface, '/');

      // First call gets wrong type -> fails with EXPRESSION_ERROR and is NOT cached
      const first = await ctx.resolveDynamicValue({'@call': 'agentCount', args: {key: 'a'}});
      assert.strictEqual(first, undefined);
      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].code, 'EXPRESSION_ERROR');
      assert.strictEqual(errors[0].expression, 'agentCount');

      // Second call with same args retries fresh and succeeds with valid number
      const second = await ctx.resolveDynamicValue({'@call': 'agentCount', args: {key: 'a'}});
      assert.strictEqual(second, 42);
      assert.strictEqual(callCount, 2);
      assert.strictEqual(errors.length, 1);

      // Declared void agent function accepts null from wire
      const voidRes = await ctx.resolveDynamicValue({'@call': 'agentVoid', args: {}});
      assert.strictEqual(voidRes, null);
      assert.strictEqual(errors.length, 1);

      // Undeclared fallback function has no declared returnType and remains unconstrained
      const undeclaredRes = await ctx.resolveDynamicValue({'@call': 'undeclaredAgentFn', args: {}});
      assert.strictEqual(undeclaredRes, 'any-undeclared-value');
      assert.strictEqual(errors.length, 1);
    });

    it('does not report a false returnType error when a routed agent call is aborted before sending', async () => {
      const agentCountDecl: FunctionApi = {
        name: 'agentCount',
        returnType: 'number',
        schema: z.object({}),
        allowedCallers: 'rendererOrAgent',
      };
      const catalog = new Catalog(CATALOG_ID, '1.0', [], [agentCountDecl]);
      const surface = new SurfaceModel('s-abort', catalog);
      const errors: A2uiErrorPayload[] = [];
      surface.onError.subscribe(err => {
        errors.push(err);
      });
      surface.agentFunctionCaller = async () => 10;

      const ctx = new DataContext(surface, '/');
      const sig = ctx.resolveSignal({'@call': 'agentCount', args: {}});
      sig.unsubscribe?.();
      await flush();

      assert.strictEqual(errors.length, 0);
    });

    it('keeps pre-1.0 behavior unchanged without runtime returnType rejection', () => {
      const v09Fn = makeFn('legacyCount', 'number', () => 'hello');
      const v09Catalog = new Catalog('https://example.com/v09', '0.9', [], [v09Fn]);
      const surface = new SurfaceModel(
        's-v09',
        v09Catalog,
        new Map([[v09Catalog.id, v09Catalog]]),
        undefined,
        false,
        new DataModel({}),
        'v0.9',
      );
      const errors: A2uiErrorPayload[] = [];
      surface.onError.subscribe(err => {
        errors.push(err);
      });
      const ctx = new DataContext(surface, '/');

      assert.strictEqual(v09Catalog.invoker('legacyCount', {}, ctx), 'hello');
      assert.strictEqual(ctx.resolveDynamicValue({call: 'legacyCount', args: {}}), 'hello');
      assert.strictEqual(errors.length, 0);
    });
  });
});
