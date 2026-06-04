/*
 * Copyright 2025 Google LLC
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

import assert from 'node:assert';
import {describe, it, beforeEach} from 'node:test';
import {signal, computed} from '@preact/signals-core';
import {z} from 'zod';
import {DataModel} from '../state/data-model.js';
import {DataContext} from './data-context.js';
import {A2uiExpressionError} from '../errors.js';

const createTestDataContext = (
  model: DataModel,
  path: string,
  functionInvoker: any = () => null,
  dispatchError: (err: any) => void = () => {},
) => {
  const mockSurface = {
    dataModel: model,
    catalog: {invoker: functionInvoker},
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

  it('does not resolve arbitrary objects recursively', () => {
    const obj = {
      foo: 'bar',
      nested: {path: 'name'},
      list: [{path: 'address/city'}, 'literal'],
    };

    const resolved = context.resolveDynamicValue(obj as any);
    assert.deepStrictEqual(resolved, obj);
  });

  it('subscribes to literal objects as signals without resolution', () => {
    const obj = {foo: 'bar', nested: {path: 'name'}};
    const sig = context.resolveSignal(obj as any);

    // It should be a literal signal containing the object
    assert.deepStrictEqual(sig.peek(), obj);

    // Updating the path should NOT affect it
    context.set('name', 'Bob');
    assert.deepStrictEqual(sig.peek(), obj);
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
    it('resolves event actions non-recursively', () => {
      const action = {
        event: {
          name: 'save',
          context: {
            id: {path: 'name'},
            metadata: {nested: {path: 'something'}},
          },
        },
      };

      const resolved = context.resolveAction(action as any);

      assert.deepStrictEqual(resolved, {
        event: {
          name: 'save',
          context: {
            id: 'Alice',
            metadata: {nested: {path: 'something'}}, // Literal, NOT resolved
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
        err.stack = 'Mock stack trace';
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
      assert.deepStrictEqual(dispatchedError.details, {
        stack: 'Mock stack trace',
      });
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
            if (trigger.value) throw new A2uiExpressionError('Inner failure', 'inner_func');
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

      trigger.value = true;
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
            if (trigger.value) throw new Error('Generic inner failure');
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

      trigger.value = true;
      assert.strictEqual(sub.value, undefined);
      assert.ok(dispatchedError);
      assert.strictEqual((dispatchedError as any).code, 'EXPRESSION_ERROR');
      assert.strictEqual((dispatchedError as any).message, 'Generic inner failure');
    });
  });
});
