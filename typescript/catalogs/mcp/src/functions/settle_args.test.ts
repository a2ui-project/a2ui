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

import {describe, it} from 'node:test';
import * as assert from 'node:assert';
import {isThenable, settleDeep, withSettledArgs} from './settle_args.js';

describe('isThenable', () => {
  it('recognizes Promises and objects with a then method', () => {
    assert.strictEqual(isThenable(Promise.resolve(1)), true);
    assert.strictEqual(isThenable({then: () => {}}), true);
  });

  it('rejects primitives, null, arrays and objects without then', () => {
    for (const value of [1, 'then', null, undefined, [], {}, {then: 'later'}]) {
      assert.strictEqual(isThenable(value), false, String(value));
    }
  });
});

describe('settleDeep', () => {
  it('returns the same value synchronously when nothing is pending', () => {
    const value = {rows: [{name: 'a'}], count: 1, when: new Date(0)};
    assert.strictEqual(settleDeep(value), value);
    assert.strictEqual(settleDeep('text'), 'text');
    assert.strictEqual(settleDeep(null), null);
  });

  it('awaits a Promise nested in an object and an array', async () => {
    const settled = settleDeep({rows: [Promise.resolve('a'), 'b'], count: Promise.resolve(2)});
    assert.strictEqual(isThenable(settled), true);
    assert.deepStrictEqual(await settled, {rows: ['a', 'b'], count: 2});
  });

  it('awaits a Promise that resolves to another pending structure', async () => {
    const settled = settleDeep(Promise.resolve({inner: Promise.resolve('done')}));
    assert.deepStrictEqual(await settled, {inner: 'done'});
  });

  it('leaves class instances alone, even when they hold a Promise', () => {
    class Holder {
      readonly pending = Promise.resolve(1);
    }
    const args = {holder: new Holder()};
    assert.strictEqual(settleDeep(args), args);
  });
});

describe('withSettledArgs', () => {
  it('runs the body synchronously when no argument is pending', () => {
    const result = withSettledArgs({value: 'a'}, settled => `${settled['value']}!`);
    assert.strictEqual(result, 'a!');
  });

  it('returns a Promise of the body result when an argument is pending', async () => {
    const result = withSettledArgs(
      {value: Promise.resolve('a')},
      settled => `${settled['value']}!`,
    );
    assert.strictEqual(isThenable(result), true);
    assert.strictEqual(await result, 'a!');
  });

  it('rejects when an argument rejects, without running the body', async () => {
    let ran = false;
    const result = withSettledArgs({value: Promise.reject(new Error('tool failed'))}, () => {
      ran = true;
    });
    await assert.rejects(async () => await result, /tool failed/);
    assert.strictEqual(ran, false);
  });
});
