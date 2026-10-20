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
import {DataModel} from './data-model.js';
import {A2uiDataError} from '../errors.js';

describe('DataModel', () => {
  let model: DataModel;

  beforeEach(() => {
    model = new DataModel({
      user: {
        name: 'Alice',
        settings: {
          theme: 'dark',
        },
      },
      items: ['a', 'b', 'c'],
    });
  });

  it('removes keys when value is undefined', () => {
    model.set('/user/name', undefined);
    assert.strictEqual(model.get('/user/name'), undefined);
    assert.strictEqual(Object.keys(model.get('/user')).includes('name'), false);
  });

  // --- Subscriptions (TS-specific Subscription API) ---

  it('returns a subscription object', () => {
    model.set('/a', 1);
    let updatedValue: number | undefined;
    const sub = model.subscribe<number>('/a', val => (updatedValue = val));
    assert.strictEqual(sub.value, 1);

    model.set('/a', 2);
    assert.strictEqual(sub.value, 2);
    assert.strictEqual(updatedValue, 2);

    sub.unsubscribe();
    // Verify listener removed
    model.set('/a', 3);
    assert.strictEqual(updatedValue, 2);
  });

  it('allows unsubscribing individual listeners', () => {
    let callCount1 = 0;
    let callCount2 = 0;

    const sub1 = model.subscribe('/user/name', () => callCount1++);
    const sub2 = model.subscribe('/user/name', () => callCount2++);

    sub1.unsubscribe();

    model.set('/user/name', 'Frank');

    assert.strictEqual(callCount1, 0); // sub1 was unsubscribed
    assert.strictEqual(callCount2, 1); // sub2 still active
    assert.strictEqual(sub2.value, 'Frank');

    sub2.unsubscribe(); // Should clear the internal map set
    model.set('/user/name', 'Grace');
    assert.strictEqual(callCount2, 1); // still 1
  });

  it('handles updates to undefined', () => {
    model.set('/foo', 'bar');
    let val: any = 'initial';
    const sub = model.subscribe('/foo', v => (val = v));

    model.set('/foo', undefined);
    assert.strictEqual(sub.value, undefined);
    assert.strictEqual(val, undefined);
  });

  it('throws when path is null or undefined', () => {
    assert.throws(() => model.get(null as any), /Path cannot be null or undefined/);
    assert.throws(() => model.get(undefined as any), /Path cannot be null or undefined/);
    assert.throws(() => model.set(null as any, 'value'), /Path cannot be null or undefined/);
    assert.throws(() => model.set(undefined as any, 'value'), /Path cannot be null or undefined/);
  });

  it('calculates descendants against root path', () => {
    // This explicitly hits an internal method branch where parentPath === "/"
    const isDescendant = (model as any).isDescendant.bind(model);
    assert.strictEqual(isDescendant('/user', '/'), true);
    assert.strictEqual(isDescendant('/', '/'), false);
  });

  // --- Security Tests: Prototype Pollution Protection on TS-specific APIs ---

  it('prevents prototype pollution via __proto__, constructor, and prototype in getSignal and subscribe', () => {
    for (const badPath of [
      '/__proto__/polluted',
      '/constructor/prototype/polluted',
      '/user/prototype/polluted',
    ]) {
      assert.throws(() => model.getSignal(badPath), A2uiDataError);
      assert.throws(() => model.subscribe(badPath, () => {}), A2uiDataError);
    }
    assert.strictEqual(({} as any).polluted, undefined);
  });

  it('notifies bound signals without unbounded array clone overhead', () => {
    let notifiedVal: any = null;
    const sub = model.subscribe<any[]>('/items', v => (notifiedVal = v));

    model.set('/items/500', 'test_val');
    assert.strictEqual(model.get('/items/500'), 'test_val');
    assert.ok(Array.isArray(notifiedVal));
    assert.strictEqual(notifiedVal[500], 'test_val');

    sub.unsubscribe();
  });
});
