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
import {signal} from '../reactivity/signals.js';
import {isPlainObject, isThenable, settleDeep} from './settle_deep.js';

describe('isThenable', () => {
  it('recognizes Promises and objects with a callable then', () => {
    assert.strictEqual(isThenable(Promise.resolve(1)), true);
    assert.strictEqual(isThenable({then: () => {}}), true);
  });

  it('rejects everything else', () => {
    assert.strictEqual(isThenable(null), false);
    assert.strictEqual(isThenable(undefined), false);
    assert.strictEqual(isThenable('then'), false);
    assert.strictEqual(isThenable({then: 1}), false);
    assert.strictEqual(isThenable([]), false);
  });
});

describe('isPlainObject', () => {
  it('accepts object literals and null-prototype objects', () => {
    assert.strictEqual(isPlainObject({a: 1}), true);
    assert.strictEqual(isPlainObject(Object.create(null)), true);
  });

  it('rejects arrays, null, primitives and class instances', () => {
    assert.strictEqual(isPlainObject([]), false);
    assert.strictEqual(isPlainObject(null), false);
    assert.strictEqual(isPlainObject('x'), false);
    assert.strictEqual(isPlainObject(new Date(0)), false);
    assert.strictEqual(isPlainObject(signal(1)), false);
  });
});

describe('settleDeep', () => {
  it('returns primitives unchanged and synchronously', () => {
    assert.strictEqual(settleDeep(1), 1);
    assert.strictEqual(settleDeep('a'), 'a');
    assert.strictEqual(settleDeep(null), null);
    assert.strictEqual(settleDeep(undefined), undefined);
    assert.strictEqual(settleDeep(false), false);
  });

  it('returns the same array and plain object when nothing is pending', () => {
    const list = [1, {a: [2, 3]}];
    const record = {a: 1, b: {c: [null, 'd']}};
    assert.strictEqual(settleDeep(list), list);
    assert.strictEqual(settleDeep(record), record);
  });

  it('returns class instances as they are without walking them', () => {
    const date = new Date(0);
    const sig = signal(Promise.resolve(1));
    assert.strictEqual(settleDeep(date), date);
    assert.strictEqual(settleDeep(sig), sig);
    const holder = {date, sig};
    assert.strictEqual(settleDeep(holder), holder);
  });

  it('awaits a top-level Promise', async () => {
    assert.strictEqual(await settleDeep(Promise.resolve('x')), 'x');
  });

  it('awaits Promises nested in arrays and plain objects', async () => {
    const settled = await settleDeep({
      a: Promise.resolve(1),
      b: [2, Promise.resolve(3)],
      c: {d: Promise.resolve({e: Promise.resolve(4)})},
      f: 'static',
    });
    assert.deepStrictEqual(settled, {a: 1, b: [2, 3], c: {d: {e: 4}}, f: 'static'});
  });

  it('settles a chain of Promises that resolve to Promises', async () => {
    const chained = Promise.resolve(Promise.resolve([Promise.resolve(1)]));
    assert.deepStrictEqual(await settleDeep(chained), [1]);
  });

  it('keeps the keys of a settled object in order', async () => {
    const settled = (await settleDeep({z: Promise.resolve(1), a: 2})) as Record<string, unknown>;
    assert.deepStrictEqual(Object.keys(settled), ['z', 'a']);
  });

  it('rejects when a nested Promise rejects', async () => {
    const failure = new Error('boom');
    await assert.rejects(
      settleDeep({ok: Promise.resolve(1), bad: [Promise.reject(failure)]}) as Promise<unknown>,
      failure,
    );
  });

  it('does not mutate the input while settling', async () => {
    const pending = Promise.resolve(1);
    const input = {a: pending, b: [pending]};
    const settled = await settleDeep(input);
    assert.notStrictEqual(settled, input);
    assert.strictEqual(input.a, pending);
    assert.strictEqual(input.b[0], pending);
  });
});
