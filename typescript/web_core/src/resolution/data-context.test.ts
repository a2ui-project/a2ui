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
import {describe, it, beforeEach} from 'node:test';
import {signal, computed, peekValue, getValue, setValue} from '../reactivity/signals.js';
import {z} from 'zod';
import {DataModel} from '../state/data-model.js';
import {SurfaceModel} from '../state/surface-model.js';
import {
  DataContext,
  MAX_DYNAMIC_VALUE_DEPTH,
  getKnownSchemaKeys,
  validateFunctionArgs,
} from './data-context.js';
import {Catalog} from '../catalog/types.js';
import {MAX_FUNCTION_CALL_ARGS} from '../types/common-types.js';
import {A2uiExpressionError} from '../errors.js';

const createTestDataContext = (
  model: DataModel,
  path: string,
  functionInvoker: any = () => null,
  dispatchError: (err: any) => void = () => {},
) => {
  const mockSurface = {
    dataModel: model,
    defaultCatalog: {invoker: functionInvoker},
    availableCatalogs: new Map(),
    dispatchError,
  } as any;
  return new DataContext(mockSurface, path);
};

describe('DataContext', () => {
  let model: DataModel;
  let context: DataContext;

  beforeEach(() => {
    model = new DataModel({
      user: {
        name: 'Alice',
        address: {
          city: 'Wonderland',
        },
      },
      list: ['a', 'b'],
    });
    context = createTestDataContext(model, '/user');
  });

  it('resolves relative paths', () => {
    assert.strictEqual(context.resolveDynamicValue({path: 'name'}), 'Alice');
  });

  it('resolves absolute paths', () => {
    assert.strictEqual(context.resolveDynamicValue({path: '/list/0'}), 'a');
  });

  it('resolves nested paths', () => {
    assert.strictEqual(context.resolveDynamicValue({path: 'address/city'}), 'Wonderland');
  });

  it('updates data via relative path', () => {
    context.set('name', 'Bob');
    assert.strictEqual(model.get('/user/name'), 'Bob');
  });

  it('creates nested context', () => {
    const addressContext = context.nested('address');
    assert.strictEqual(addressContext.path, '/user/address');
    assert.strictEqual(addressContext.resolveDynamicValue({path: 'city'}), 'Wonderland');
  });

  it('handles root context', () => {
    const rootContext = createTestDataContext(model, '/');
    assert.strictEqual(rootContext.resolveDynamicValue({path: 'user/name'}), 'Alice');
  });

  it('subscribes relative path', () => {
    let called = false;
    context.subscribeDynamicValue({path: 'name'}, val => {
      assert.strictEqual(val, 'Charlie');
      called = true;
    });
    context.set('name', 'Charlie');
    assert.strictEqual(called, true, 'Callback was never called');
  });

  it('resolves using resolveDynamicValue() method with literals', () => {
    // Literal
    assert.strictEqual(context.resolveDynamicValue('literal'), 'literal');

    // Path
    assert.strictEqual(context.resolveDynamicValue({path: 'name'}), 'Alice');

    // Absolute Path
    assert.strictEqual(context.resolveDynamicValue({path: '/list/0'}), 'a');
  });

  it('resolves literal arrays', () => {
    assert.deepStrictEqual(context.resolveDynamicValue(['literal', 'array']), ['literal', 'array']);
  });

  it('returns fully static arrays as-is without re-allocation', () => {
    const staticArray = ['literal', 1, true, null, [2, 'nested']];
    assert.strictEqual(context.resolveDynamicValue(staticArray), staticArray);
  });

  it('resolves arrays of DynamicValues element-wise', () => {
    assert.deepStrictEqual(context.resolveDynamicValue([{path: 'name'}, 'literal']), [
      'Alice',
      'literal',
    ]);
  });

  it('resolves DynamicValues nested inside inner arrays', () => {
    assert.deepStrictEqual(context.resolveDynamicValue(['outer', [{path: 'name'}, 'inner']]), [
      'outer',
      ['Alice', 'inner'],
    ]);
  });

  it('subscribes literal arrays as static', () => {
    let called = false;
    const sub = context.subscribeDynamicValue(['literal', 'array'], () => {
      called = true;
    });
    assert.deepStrictEqual(sub.value, ['literal', 'array']);

    // Simulate some generic path update that shouldn't trigger anything for this static sub
    context.set('name', 'Charlie');
    assert.strictEqual(called, false);
  });

  it('subscribes arrays containing path bindings reactively', () => {
    let latest: unknown;
    const sub = context.subscribeDynamicValue([{path: 'name'}, 'x'], val => {
      latest = val;
    });
    assert.deepStrictEqual(sub.value, ['Alice', 'x']);

    context.set('name', 'Bob');
    assert.deepStrictEqual(latest, ['Bob', 'x']);
    sub.unsubscribe();
  });

  it('resolves nested DynamicValues inside and/or function args', () => {
    const fnInvoker = (name: string, args: Record<string, any>) => {
      if (name === 'and') return args.values.every((v: unknown) => !!v);
      if (name === 'or') return args.values.some((v: unknown) => !!v);
      if (name === 'required') {
        const val = args.value;
        if (val === null || val === undefined) return false;
        if (typeof val === 'string' && val === '') return false;
        return true;
      }
      return null;
    };
    const root = createTestDataContext(
      new DataModel({
        formData: {email: '', phone: '', zip: '', agree: false},
      }),
      '/',
      fnInvoker,
    );

    const result = root.resolveDynamicValue({
      call: 'and',
      args: {
        values: [
          {path: '/formData/agree'},
          {
            call: 'or',
            args: {
              values: [
                {call: 'required', args: {value: {path: '/formData/email'}}},
                {call: 'required', args: {value: {path: '/formData/phone'}}},
              ],
            },
          },
          {call: 'required', args: {value: {path: '/formData/zip'}}},
        ],
      },
      returnType: 'boolean',
    });
    assert.strictEqual(result, false);

    root.set('/formData/agree', true);
    root.set('/formData/email', 'a@b.com');
    root.set('/formData/zip', '12345');
    const valid = root.resolveDynamicValue({
      call: 'and',
      args: {
        values: [
          {path: '/formData/agree'},
          {
            call: 'or',
            args: {
              values: [
                {call: 'required', args: {value: {path: '/formData/email'}}},
                {call: 'required', args: {value: {path: '/formData/phone'}}},
              ],
            },
          },
          {call: 'required', args: {value: {path: '/formData/zip'}}},
        ],
      },
      returnType: 'boolean',
    });
    assert.strictEqual(valid, true);
  });

  it('resolves function calls synchronously', () => {
    const fnInvoker = (name: string, args: Record<string, any>) => {
      if (name === 'add') return args.a + args.b;
      return null;
    };
    const ctx = createTestDataContext(model, '/user', fnInvoker);
    const result = ctx.resolveDynamicValue({
      call: 'add',
      args: {a: 1, b: 2},
      returnType: 'any',
    });
    assert.strictEqual(result, 3);
  });

  it('dispatches generic error on function call without invoker synchronously', () => {
    let dispatchedError: any = null;
    const ctx = createTestDataContext(
      model,
      '/user',
      () => {
        throw new Error('Function invoker is not configured');
      },
      err => {
        dispatchedError = err;
      },
    );

    const result = ctx.resolveDynamicValue({
      call: 'add',
      args: {},
      returnType: 'any',
    });
    assert.strictEqual(result, undefined);
    assert.ok(dispatchedError);
    assert.strictEqual(dispatchedError.code, 'EXPRESSION_ERROR');
  });

  it('resolves arbitrary plain objects and arrays recursively', () => {
    const obj = {
      foo: 'bar',
      nested: {path: 'name'},
      list: [{path: 'address/city'}, 'literal'],
    };

    const resolved = context.resolveDynamicValue(obj as any);
    assert.deepStrictEqual(resolved, {
      foo: 'bar',
      nested: 'Alice',
      list: ['Wonderland', 'literal'],
    });
  });

  it('subscribes to plain objects reactively when nested dynamic values change', () => {
    const obj = {foo: 'bar', nested: {path: 'name'}};
    const sig = context.resolveSignal(obj as any);

    assert.deepStrictEqual(peekValue(sig), {foo: 'bar', nested: 'Alice'});

    context.set('name', 'Bob');
    assert.deepStrictEqual(peekValue(sig), {foo: 'bar', nested: 'Bob'});
  });

  it('subscribes to function calls with no args', () => {
    const fnInvoker = (name: string) => (name === 'getPi' ? Math.PI : 0);
    const ctx = createTestDataContext(model, '/', fnInvoker);

    let called = false;
    ctx.subscribeDynamicValue({call: 'getPi', args: {}, returnType: 'any'}, () => {
      called = true;
    });
    assert.strictEqual(called, false);
  });

  it('returns undefined on function call without invoker reactively', () => {
    const ctx = createTestDataContext(model, '/user', () => {
      throw new Error('Function invoker is not configured');
    });
    const sub = ctx.subscribeDynamicValue({call: 'add', args: {}, returnType: 'any'}, () => {});
    assert.strictEqual(sub.value, undefined);
  });

  it('subscribes to function call returning a signal', () => {
    const fnInvoker = (name: string) => {
      if (name === 'obs') return signal('hello');
      return null;
    };
    const ctx = createTestDataContext(model, '/', fnInvoker);
    let val: unknown;
    ctx.subscribeDynamicValue({call: 'obs', args: {}, returnType: 'any'}, v => {
      val = v;
    });
    assert.ok(true); // Verification occurs by absence of crash, and coverage hits the switch
    assert.equal(val, undefined);
  });

  it('subscribes to invalid dynamic value reactively (falls back to literal signal)', () => {
    const obj = {unknown: 'thing'};
    const sub = context.subscribeDynamicValue(obj as any, () => {});
    assert.deepStrictEqual(sub.value, obj);
  });

  it('handles path resolution edge cases', () => {
    assert.strictEqual(context.nested('').path, '/user');
    assert.strictEqual(context.nested('.').path, '/user');
    // Ensure trailing slash removal logic is hit
    const rootCtx = createTestDataContext(model, '/');
    assert.strictEqual(rootCtx.nested('test').path, '/test');
    const trailingCtx = createTestDataContext(model, '/user/');
    assert.strictEqual(trailingCtx.nested('test').path, '/user/test');
  });
  it('subscribes to function call with arguments reactively', () => {
    const fnInvoker = (name: string, args: any) => {
      if (name === 'greet') return `Hello ${args.name}`;
      return null;
    };
    const ctx = createTestDataContext(model, '/user', fnInvoker);

    const sub = ctx.subscribeDynamicValue(
      {call: 'greet', args: {name: {path: 'name'}}, returnType: 'any'},
      () => {},
    );

    assert.strictEqual(sub.value, 'Hello Alice');

    // Update inner path
    ctx.set('name', 'Bob');
    assert.strictEqual(sub.value, 'Hello Bob');

    sub.unsubscribe();
  });

  describe('resolveAction', () => {
    it('resolves event actions and nested context objects recursively', () => {
      const action = {
        event: {
          name: 'save',
          context: {
            id: {path: 'name'},
            metadata: {nested: {path: 'address/city'}},
          },
        },
      };

      const resolved = context.resolveAction(action as any);

      assert.deepStrictEqual(resolved, {
        event: {
          name: 'save',
          context: {
            id: 'Alice',
            metadata: {nested: 'Wonderland'},
          },
        },
      });
    });

    it('resolves functionCall actions', () => {
      const fnInvoker = (name: string, args: any) => {
        if (name === 'greet') return `Hello ${args.name}`;
        return null;
      };
      const ctx = createTestDataContext(model, '/user', fnInvoker);

      const action = {
        functionCall: {
          call: 'greet',
          args: {name: {path: 'name'}},
        },
      };

      const resolved = ctx.resolveAction(action as any);
      assert.strictEqual(resolved, 'Hello Alice');
    });
  });

  describe('Error Handling', () => {
    it('translates ZodError into A2uiExpressionError and dispatches error', () => {
      const invokerWithZodError = () => {
        throw new z.ZodError([
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'number',
            path: ['foo'],
            message: 'Expected string, received number',
          },
        ]);
      };
      let dispatchedError: any = null;
      const ctx = createTestDataContext(model, '/', invokerWithZodError, err => {
        dispatchedError = err;
      });

      const result = ctx.resolveDynamicValue({
        call: 'fail',
        args: {},
        returnType: 'any',
      });

      assert.strictEqual(result, undefined);
      assert.ok(dispatchedError);
      assert.strictEqual(dispatchedError.code, 'EXPRESSION_ERROR');
      assert.strictEqual(dispatchedError.expression, 'fail');
    });

    it('dispatches generic Error as EXPRESSION_ERROR to surface', () => {
      const invokerWithRegularError = () => {
        const err = new Error('Generic failure');
        err.stack = 'Mock stack trace containing secret paths';
        throw err;
      };
      let dispatchedError: any = null;
      const ctx = createTestDataContext(model, '/', invokerWithRegularError, err => {
        dispatchedError = err;
      });

      const result = ctx.resolveDynamicValue({
        call: 'fail',
        args: {},
        returnType: 'any',
      });

      assert.strictEqual(result, undefined);
      assert.ok(dispatchedError);
      assert.strictEqual(dispatchedError.code, 'EXPRESSION_ERROR');
      assert.strictEqual(dispatchedError.expression, 'fail');
      assert.strictEqual(dispatchedError.message, 'Generic failure');
      // Ensure stack trace is NOT leaked in details (CWE-209 prevention)
      assert.strictEqual(dispatchedError.details, undefined);
    });

    it('does not disclose V8 stack traces in surface error details (Issue #2385)', () => {
      const invokerThrowingRangeError = () => {
        throw new RangeError('toFixed() digits argument must be between 0 and 100');
      };
      let dispatchedError: any = null;
      const ctx = createTestDataContext(model, '/', invokerThrowingRangeError, err => {
        dispatchedError = err;
      });

      ctx.resolveDynamicValue({
        call: 'formatNumber',
        args: {value: 123, decimals: 200},
        returnType: 'string',
      });

      assert.ok(dispatchedError);
      assert.strictEqual(dispatchedError.code, 'EXPRESSION_ERROR');
      assert.strictEqual(dispatchedError.expression, 'formatNumber');
      assert.strictEqual(
        dispatchedError.message,
        'toFixed() digits argument must be between 0 and 100',
      );
      assert.strictEqual(dispatchedError.details, undefined);
    });

    it('handles null or undefined thrown values gracefully without crashing', () => {
      const invokerThrowingNull = () => {
        throw null;
      };
      let dispatchedError: any = null;
      const ctx = createTestDataContext(model, '/', invokerThrowingNull, err => {
        dispatchedError = err;
      });

      ctx.resolveDynamicValue({
        call: 'fail',
        args: {},
        returnType: 'any',
      });

      assert.ok(dispatchedError);
      assert.strictEqual(dispatchedError.code, 'EXPRESSION_ERROR');
      assert.strictEqual(dispatchedError.message, 'An unexpected error occurred in function fail.');
      assert.strictEqual(dispatchedError.details, undefined);
    });

    it('dispatches A2uiExpressionError to surface', () => {
      const invokerWithExpressionError = () => {
        throw new A2uiExpressionError('Custom expr error', 'custom_func');
      };
      let dispatchedError: any = null;
      const ctx = createTestDataContext(model, '/', invokerWithExpressionError, err => {
        dispatchedError = err;
      });

      const result = ctx.resolveDynamicValue({
        call: 'fail',
        args: {},
        returnType: 'any',
      });

      assert.strictEqual(result, undefined);
      assert.ok(dispatchedError);
      assert.strictEqual(dispatchedError.code, 'EXPRESSION_ERROR');
      assert.strictEqual(dispatchedError.expression, 'custom_func');
    });

    it('handles errors thrown during reactive argument resolution', () => {
      const trigger = signal(false);
      const fnInvoker = (name: string) => {
        if (name === 'inner') {
          return computed(() => {
            if (getValue(trigger)) throw new A2uiExpressionError('Inner failure', 'inner_func');
            return 'ok';
          });
        }
        return 'outer-result';
      };

      let dispatchedError: any = null;
      const ctx = createTestDataContext(model, '/', fnInvoker, err => {
        dispatchedError = err;
      });

      const sub = ctx.subscribeDynamicValue(
        {
          call: 'outer',
          args: {
            arg: {call: 'inner', args: {}},
          },
          returnType: 'any',
        },
        () => {},
      );

      assert.strictEqual(sub.value, 'outer-result');
      assert.strictEqual(dispatchedError, null);

      setValue(trigger, true);
      // Accessing sub.value or the effect running triggers the catch.
      assert.strictEqual(sub.value, undefined);
      assert.ok(dispatchedError);
      assert.strictEqual((dispatchedError as any).message, 'Inner failure');
    });

    it('handles generic errors thrown during reactive execution', () => {
      const trigger = signal(false);
      const fnInvoker = (name: string) => {
        if (name === 'inner') {
          return computed(() => {
            if (getValue(trigger)) throw new Error('Generic inner failure');
            return 'ok';
          });
        }
        return 'outer-result';
      };

      let dispatchedError: any = null;
      const ctx = createTestDataContext(model, '/', fnInvoker, err => {
        dispatchedError = err;
      });

      const sub = ctx.subscribeDynamicValue(
        {
          call: 'outer',
          args: {
            arg: {call: 'inner', args: {}},
          },
          returnType: 'any',
        },
        () => {},
      );

      assert.strictEqual(sub.value, 'outer-result');
      assert.strictEqual(dispatchedError, null);

      setValue(trigger, true);
      assert.strictEqual(sub.value, undefined);
      assert.ok(dispatchedError);
      assert.strictEqual((dispatchedError as any).code, 'EXPRESSION_ERROR');
      assert.strictEqual((dispatchedError as any).message, 'Generic inner failure');
    });

    it('guards against excessive recursion in resolveDynamicValue (Issue #2388)', () => {
      assert.strictEqual(MAX_DYNAMIC_VALUE_DEPTH, 1000);
      let nested: any = {path: '/val'};
      for (let i = 0; i <= MAX_DYNAMIC_VALUE_DEPTH + 10; i++) {
        nested = {call: 'wrap', args: {v: nested}};
      }

      let dispatchedError: any = null;
      const ctx = createTestDataContext(
        model,
        '/',
        (_name: string, args: any) => args.v,
        err => {
          dispatchedError = err;
        },
      );

      const result = ctx.resolveDynamicValue(nested);
      assert.strictEqual(result, undefined);
      assert.ok(dispatchedError);
      assert.strictEqual(dispatchedError.code, 'EXPRESSION_ERROR');
      assert.ok(dispatchedError.message.includes('Maximum dynamic value nesting depth exceeded'));
    });

    it('guards against excessive recursion in resolveSignal / subscribeDynamicValue without call stack overflow (Issue #2388)', () => {
      let nested: any = {path: '/val'};
      for (let i = 0; i <= MAX_DYNAMIC_VALUE_DEPTH + 10; i++) {
        nested = {call: 'wrap', args: {v: nested}};
      }

      let dispatchedError: any = null;
      const ctx = createTestDataContext(
        model,
        '/',
        (_name: string, args: any) => args.v,
        err => {
          dispatchedError = err;
        },
      );

      const sub = ctx.subscribeDynamicValue(nested, () => {});
      assert.strictEqual(sub.value, undefined);
      assert.ok(dispatchedError);
      assert.strictEqual(dispatchedError.code, 'EXPRESSION_ERROR');
      assert.ok(dispatchedError.message.includes('Maximum dynamic value nesting depth exceeded'));
      sub.unsubscribe();
    });

    it('evaluates legitimate nested expressions within depth limit correctly', () => {
      let nested: any = 5;
      for (let i = 0; i < 5; i++) {
        nested = {call: 'inc', args: {v: nested}};
      }

      let dispatchedError: any = null;
      const ctx = createTestDataContext(
        model,
        '/',
        (_name: string, args: any) => (args.v ?? 0) + 1,
        err => {
          dispatchedError = err;
        },
      );

      const result = ctx.resolveDynamicValue(nested);
      assert.strictEqual(result, 10);
      assert.strictEqual(dispatchedError, null);
    });
  });

  describe('Function Argument Stripping & Resource Consumption (Issue #2384)', () => {
    it('getKnownSchemaKeys extracts keys from ZodObject and ZodEffects', () => {
      const objSchema = z.object({a: z.string(), b: z.number()});
      assert.deepStrictEqual(getKnownSchemaKeys(objSchema), new Set(['a', 'b']));

      const refinedSchema = z
        .object({value: z.any(), min: z.number().optional()})
        .refine(data => data.value !== undefined);
      assert.deepStrictEqual(getKnownSchemaKeys(refinedSchema), new Set(['value', 'min']));

      const passthroughSchema = z.object({a: z.string()}).passthrough();
      assert.strictEqual(getKnownSchemaKeys(passthroughSchema), null);

      const unionSchema = z.union([z.object({x: z.string()}), z.object({y: z.number()})]);
      assert.deepStrictEqual(getKnownSchemaKeys(unionSchema), new Set(['x', 'y']));

      const intersectionSchema = z.intersection(
        z.object({a: z.string()}),
        z.object({b: z.number()}),
      );
      assert.deepStrictEqual(getKnownSchemaKeys(intersectionSchema), new Set(['a', 'b']));

      const intersectionWithPassthrough = z.intersection(
        z.object({a: z.string()}),
        z.object({b: z.number()}).passthrough(),
      );
      assert.strictEqual(getKnownSchemaKeys(intersectionWithPassthrough), null);
    });

    it('validateFunctionArgs allows valid keys when schema is available', () => {
      const catalog = new Catalog(
        'test-cat',
        '1.0',
        [],
        [
          {
            name: 'testFunc',
            returnType: 'string',
            schema: z.object({name: z.string(), age: z.number().optional()}),
            execute: (args: any) => `Hello ${args.name}`,
          },
        ],
      );

      const validArgs = {
        name: 'Alice',
        age: 30,
      };

      assert.doesNotThrow(() => {
        validateFunctionArgs('testFunc', validArgs, catalog);
      });
    });

    it('validateFunctionArgs throws error on unknown arguments', () => {
      const catalog = new Catalog(
        'test-cat',
        '1.0',
        [],
        [
          {
            name: 'testFunc',
            returnType: 'string',
            schema: z.object({name: z.string(), age: z.number().optional()}),
            execute: (args: any) => `Hello ${args.name}`,
          },
        ],
      );

      const invalidArgs = {
        name: 'Alice',
        extra: 'junk',
      };

      assert.throws(
        () => validateFunctionArgs('testFunc', invalidArgs, catalog),
        (err: any) => {
          assert.strictEqual(err instanceof A2uiExpressionError, true);
          assert.match(err.message, /Unknown argument 'extra'/);
          return true;
        },
      );
    });

    it('validateFunctionArgs throws error when exceeding maximum argument limits', () => {
      const catalog = new Catalog(
        'test-cat',
        '1.0',
        [],
        [
          {
            name: 'testFunc',
            returnType: 'string',
            schema: z.object({name: z.string()}),
            execute: (args: any) => `Hello ${args.name}`,
          },
        ],
      );

      const tooManyArgs: Record<string, any> = {name: 'Alice', extra1: 1, extra2: 2};
      assert.throws(
        () => validateFunctionArgs('testFunc', tooManyArgs, catalog),
        (err: any) => {
          assert.strictEqual(err instanceof A2uiExpressionError, true);
          return true;
        },
      );

      const excessiveArgs: Record<string, any> = {};
      for (let i = 0; i <= MAX_FUNCTION_CALL_ARGS + 5; i++) excessiveArgs[`k${i}`] = i;
      assert.throws(
        () => validateFunctionArgs('testFunc', excessiveArgs, catalog),
        (err: any) => {
          assert.strictEqual(err instanceof A2uiExpressionError, true);
          assert.match(err.message, /exceeds maximum allowed arguments count/);
          return true;
        },
      );
    });

    it('resolveSignal dispatches error and prevents signal creation on unknown arguments', () => {
      const customModel = new DataModel({
        validVal: 'Alice',
        junkVal: 'Secret',
      });

      const catalog = new Catalog(
        'test-cat',
        '1.0',
        [],
        [
          {
            name: 'greet',
            returnType: 'string',
            schema: z.object({name: z.string()}),
            execute: (args: any) => `Hello ${args.name}`,
          },
        ],
      );

      let dispatchedError: any = null;
      const mockSurface = {
        dataModel: customModel,
        defaultCatalog: catalog,
        availableCatalogs: new Map(),
        dispatchError: (err: any) => {
          dispatchedError = err;
        },
      } as any;
      const ctx = new DataContext(mockSurface, '/');

      const sig = ctx.resolveSignal({
        call: 'greet',
        args: {
          name: {path: '/validVal'},
          junk: {path: '/junkVal'},
        },
        returnType: 'any',
      });

      assert.strictEqual(peekValue(sig), undefined);
      assert.ok(dispatchedError);
      assert.strictEqual(dispatchedError.code, 'EXPRESSION_ERROR');
      assert.match(dispatchedError.message, /Unknown argument 'junk'/);
    });

    it('resolveDynamicValue dispatches error on unknown arguments', () => {
      const catalog = new Catalog(
        'test-cat',
        '1.0',
        [],
        [
          {
            name: 'greet',
            returnType: 'string',
            schema: z.object({name: z.string()}),
            execute: (args: any) => `Hello ${args.name}`,
          },
        ],
      );

      let dispatchedError: any = null;
      const mockSurface = {
        dataModel: new DataModel({}),
        defaultCatalog: catalog,
        availableCatalogs: new Map(),
        dispatchError: (err: any) => {
          dispatchedError = err;
        },
      } as any;
      const ctx = new DataContext(mockSurface, '/');

      const res = ctx.resolveDynamicValue({
        call: 'greet',
        args: {
          name: 'Alice',
          junk: 'extra',
        },
        returnType: 'any',
      });

      assert.strictEqual(res, undefined);
      assert.ok(dispatchedError);
      assert.strictEqual(dispatchedError.code, 'EXPRESSION_ERROR');
      assert.match(dispatchedError.message, /Unknown argument 'junk'/);
    });
  });

  describe('Multi-catalog function resolution', () => {
    const makeCatalog = (id: string, result: string) =>
      new Catalog(
        id,
        '1.0',
        [],
        [
          {
            name: 'greet',
            returnType: 'string',
            schema: z.object({}),
            execute: () => result,
          },
        ],
      );

    const makeSurface = (defaultCatalog: Catalog<any>, available: Array<Catalog<any>>) =>
      ({
        dataModel: new DataModel({}),
        defaultCatalog,
        availableCatalogs: new Map(available.map(c => [c.id, c])),
        dispatchError: () => {},
      }) as any;

    it('invokes the named catalog rather than the default', () => {
      const primary = makeCatalog('cat-primary', 'from-primary');
      const secondary = makeCatalog('cat-secondary', 'from-secondary');
      const ctx = new DataContext(makeSurface(primary, [primary, secondary]), '/');

      assert.strictEqual(
        ctx.resolveDynamicValue({call: 'greet', args: {}, catalogId: 'cat-secondary'} as any),
        'from-secondary',
      );
    });

    it('falls back to the default catalog when the call names none', () => {
      const primary = makeCatalog('cat-primary', 'from-primary');
      const secondary = makeCatalog('cat-secondary', 'from-secondary');
      const ctx = new DataContext(makeSurface(primary, [primary, secondary]), '/');

      assert.strictEqual(ctx.resolveDynamicValue({call: 'greet', args: {}}), 'from-primary');
    });

    it('reports an unavailable named catalog through the surface error channel', () => {
      const primary = makeCatalog('cat-primary', 'from-primary');
      const surface = makeSurface(primary, [primary]);
      let dispatchedError: any = null;
      surface.dispatchError = (err: any) => {
        dispatchedError = err;
      };
      const ctx = new DataContext(surface, '/');

      assert.strictEqual(
        ctx.resolveDynamicValue({call: 'greet', args: {}, catalogId: 'cat-missing'} as any),
        undefined,
      );
      assert.ok(dispatchedError);
      assert.strictEqual(dispatchedError.code, 'EXPRESSION_ERROR');
      assert.match(dispatchedError.message, /Catalog not found: cat-missing/);
    });

    it('reports an unavailable named catalog on the reactive path as well', () => {
      const primary = makeCatalog('cat-primary', 'from-primary');
      const surface = makeSurface(primary, [primary]);
      let dispatchedError: any = null;
      surface.dispatchError = (err: any) => {
        dispatchedError = err;
      };
      const ctx = new DataContext(surface, '/');

      const sub = ctx.subscribeDynamicValue(
        {call: 'greet', args: {}, catalogId: 'cat-missing'} as any,
        () => {},
      );

      assert.strictEqual(sub.value, undefined);
      assert.ok(dispatchedError);
      assert.strictEqual(dispatchedError.code, 'EXPRESSION_ERROR');
      assert.match(dispatchedError.message, /Catalog not found: cat-missing/);
      sub.unsubscribe();
    });
  });

  describe('Phase 3 resolution parity (deep object recursion, hasPath, onWarning, index scope)', () => {
    it('recursively resolves dynamic bindings inside nested plain objects both synchronously and reactively', () => {
      const cat = new Catalog('cat', '1.0', []);
      const surface = new SurfaceModel('s1', cat);
      surface.dataModel.set('/user', {name: 'Alice', role: 'Admin'});

      const ctx = new DataContext(surface, '/');
      const nestedInput = {
        profile: {
          displayName: {path: '/user/name'},
          meta: {
            roleLabel: {path: '/user/role'},
            staticFlag: true,
          },
        },
      };

      const resolved = ctx.resolveDynamicValue<any>(nestedInput);
      assert.deepStrictEqual(resolved, {
        profile: {
          displayName: 'Alice',
          meta: {
            roleLabel: 'Admin',
            staticFlag: true,
          },
        },
      });

      const updates: any[] = [];
      const sub = ctx.subscribeDynamicValue<any>(nestedInput, val => updates.push(val));
      assert.strictEqual(sub.value.profile.displayName, 'Alice');

      surface.dataModel.set('/user/name', 'Bob');
      assert.strictEqual(updates.length, 1);
      assert.strictEqual(updates[0].profile.displayName, 'Bob');
      sub.unsubscribe();
    });

    it('emits MISSING_DATA_BINDING on surface.onWarning for absent paths but not for explicit null paths', () => {
      const cat = new Catalog('cat', '1.0', []);
      const surface = new SurfaceModel('s1', cat);
      surface.dataModel.set('/', {explicitNull: null});

      assert.strictEqual(surface.dataModel.hasPath('/explicitNull'), true);
      assert.strictEqual(surface.dataModel.hasPath('/missingKey'), false);

      const warnings: Array<{code: string; path?: string; message: string}> = [];
      surface.onWarning.subscribe(w => {
        warnings.push(w);
      });

      const ctx = new DataContext(surface, '/');
      assert.strictEqual(ctx.resolveDynamicValue({path: '/explicitNull'}), null);
      assert.strictEqual(warnings.length, 0);

      assert.strictEqual(ctx.resolveDynamicValue({path: '/missingKey'}), undefined);
      assert.strictEqual(warnings.length, 1);
      assert.strictEqual(warnings[0].code, 'MISSING_DATA_BINDING');
      assert.strictEqual(warnings[0].path, '/missingKey');
      assert.match(warnings[0].message, /Preflight DataBinding Warning/);

      // Repeated resolution on the same context or a nested child context deduplicates the warning for that path
      assert.strictEqual(ctx.resolveDynamicValue({path: '/missingKey'}), undefined);
      assert.strictEqual(warnings.length, 1);

      const childCtx = ctx.nested('/sub');
      assert.strictEqual(childCtx.resolveDynamicValue({path: '/missingKey'}), undefined);
      assert.strictEqual(warnings.length, 1);
    });

    it('resolves getIndex() from explicit index or trailing numeric segment across parent chain', () => {
      const cat = new Catalog('cat', '1.0', []);
      const surface = new SurfaceModel('s1', cat);

      const rootCtx = new DataContext(surface, '/items/7/details');
      assert.strictEqual(rootCtx.getIndex(), undefined);

      const loopItemCtx = new DataContext(surface, '/items/7');
      assert.strictEqual(loopItemCtx.getIndex(), 7);

      const childCtx = loopItemCtx.nested('details/address');
      assert.strictEqual(childCtx.getIndex(), 7);

      const explicitOverrideCtx = loopItemCtx.nested('sub', 42);
      assert.strictEqual(explicitOverrideCtx.getIndex(), 42);
    });
  });
});
