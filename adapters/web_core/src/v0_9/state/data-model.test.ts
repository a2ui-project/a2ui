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
import {DataModel} from './data-model.js';

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

  // --- Initialization ---

  it('initializes with empty data if not provided', () => {
    const emptyModel = new DataModel();
    assert.deepStrictEqual(emptyModel.get('/'), {});
  });

  // --- Basic Retrieval ---

  it('retrieves root data', () => {
    assert.deepStrictEqual(model.get('/'), {
      user: {name: 'Alice', settings: {theme: 'dark'}},
      items: ['a', 'b', 'c'],
    });
  });

  it('retrieves nested path', () => {
    assert.strictEqual(model.get('/user/name'), 'Alice');
    assert.strictEqual(model.get('/user/settings/theme'), 'dark');
  });

  it('retrieves array items', () => {
    assert.strictEqual(model.get('/items/0'), 'a');
    assert.strictEqual(model.get('/items/1'), 'b');
  });

  it('returns undefined for non-existent paths', () => {
    assert.strictEqual(model.get('/user/age'), undefined);
    assert.strictEqual(model.get('/unknown/path'), undefined);
  });

  it('returns undefined when traversing through undefined/null segments', () => {
    model.set('/nullable', null);
    assert.strictEqual(model.get('/nullable/deep/path'), undefined);
  });

  // --- Updates ---

  it('sets value at existing path', () => {
    model.set('/user/name', 'Bob');
    assert.strictEqual(model.get('/user/name'), 'Bob');
  });

  it('sets value at new path', () => {
    model.set('/user/age', 30);
    assert.strictEqual(model.get('/user/age'), 30);
  });

  it('creates intermediate objects', () => {
    model.set('/a/b/c', 'foo');
    assert.strictEqual(model.get('/a/b/c'), 'foo');
    assert.notStrictEqual(model.get('/a/b'), undefined);
  });

  it('removes keys when value is undefined', () => {
    model.set('/user/name', undefined);
    assert.strictEqual(model.get('/user/name'), undefined);
    assert.strictEqual(Object.keys(model.get('/user')).includes('name'), false);
  });

  // --- Array / List Handling (Flutter Parity) ---

  it('List: set and get', () => {
    model.set('/list/0', 'hello');
    assert.strictEqual(model.get('/list/0'), 'hello');
    assert.ok(Array.isArray(model.get('/list')));
  });

  it('List: append and get', () => {
    model.set('/list/0', 'hello');
    model.set('/list/1', 'world');
    assert.strictEqual(model.get('/list/0'), 'hello');
    assert.strictEqual(model.get('/list/1'), 'world');
    assert.strictEqual(model.get('/list').length, 2);
  });

  it('List: update existing index', () => {
    model.set('/items/1', 'updated');
    assert.strictEqual(model.get('/items/1'), 'updated');
  });

  it('Nested structures are created automatically', () => {
    // Should create nested map and list: { a: { b: [ { c: 123 } ] } }
    model.set('/a/b/0/c', 123);
    assert.strictEqual(model.get('/a/b/0/c'), 123);
    assert.ok(Array.isArray(model.get('/a/b')));
    assert.ok(!Array.isArray(model.get('/a/b/0')));

    // Should create nested maps
    model.set('/x/y/z', 'hello');
    assert.strictEqual(model.get('/x/y/z'), 'hello');

    // Should create nested lists
    model.set('/nestedList/0/0', 'inner');
    assert.strictEqual(model.get('/nestedList/0/0'), 'inner');
    assert.ok(Array.isArray(model.get('/nestedList')));
    assert.ok(Array.isArray(model.get('/nestedList/0')));
  });

  // --- Subscriptions ---

  it('returns a subscription object', () => {
    model.set('/a', 1);
    const sub = model.subscribe<number>('/a', val => (updatedValue = val));
    assert.strictEqual(sub.value, 1);

    let updatedValue: number | undefined;

    model.set('/a', 2);
    assert.strictEqual(sub.value, 2);
    assert.strictEqual(updatedValue, 2);

    sub.unsubscribe();
    // Verify listener removed
    model.set('/a', 3);
    assert.strictEqual(updatedValue, 2);
  });

  it('notifies subscribers on exact match', () => {
    let called = false;
    model.subscribe('/user/name', val => {
      assert.strictEqual(val, 'Charlie');
      called = true;
    });
    model.set('/user/name', 'Charlie');
    assert.strictEqual(called, true, 'Callback was never called');
  });

  it('notifies ancestor subscribers (Container Semantics)', () => {
    let called = false;
    model.subscribe('/user', (val: any) => {
      assert.strictEqual(val.name, 'Dave');
      called = true;
    });
    model.set('/user/name', 'Dave');
    assert.strictEqual(called, true, 'Callback was never called');
  });

  it('notifies descendant subscribers', () => {
    let called = false;
    model.subscribe('/user/settings/theme', val => {
      assert.strictEqual(val, 'light');
      called = true;
    });

    // We update the parent object
    model.set('/user/settings', {theme: 'light'});
    assert.strictEqual(called, true, 'Callback was never called');
  });

  it('notifies root subscriber', () => {
    let called = false;
    model.subscribe('/', (val: any) => {
      assert.strictEqual(val.newProp, 'test');
      called = true;
    });
    model.set('/newProp', 'test');
    assert.strictEqual(called, true, 'Callback was never called');
  });

  it('notifies parent when child updates', () => {
    model.set('/parent', {child: 'initial'});

    let parentValue: any;
    model.subscribe('/parent', val => (parentValue = val));

    model.set('/parent/child', 'updated');
    assert.deepStrictEqual(parentValue, {child: 'updated'});
  });

  it('stops notifying after dispose', () => {
    let count = 0;
    model.subscribe('/', () => count++);

    model.dispose();
    model.set('/foo', 'bar');
    assert.strictEqual(count, 0);
  });

  it('supports multiple subscribers to the same path', () => {
    let callCount1 = 0;
    let callCount2 = 0;

    const sub1 = model.subscribe('/user/name', () => callCount1++);

    const sub2 = model.subscribe('/user/name', () => callCount2++);

    model.set('/user/name', 'Eve');

    assert.strictEqual(callCount1, 1);
    assert.strictEqual(callCount2, 1);
    assert.strictEqual(sub1.value, 'Eve');
    assert.strictEqual(sub2.value, 'Eve');
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

  it('handles subscription to non-existent path', () => {
    let val: any;
    const sub = model.subscribe('/non/existent', v => (val = v));
    assert.strictEqual(sub.value, undefined);

    model.set('/non/existent', 'exists now');
    assert.strictEqual(sub.value, 'exists now');
    assert.strictEqual(val, 'exists now');
  });

  it('handles updates to undefined', () => {
    model.set('/foo', 'bar');
    let val: any = 'initial';
    const sub = model.subscribe('/foo', v => (val = v));

    model.set('/foo', undefined);
    assert.strictEqual(sub.value, undefined);
    assert.strictEqual(val, undefined);
  });

  it('throws when trying to set nested property through a primitive', () => {
    model.set('/user/name', 'not an object');
    assert.strictEqual(model.get('/user/name'), 'not an object');

    assert.throws(() => {
      model.set('/user/name/first', 'Alice');
    }, /Cannot set path/);
  });

  it('throws when using non-numeric segment on an array', () => {
    assert.throws(() => {
      model.set('/items/foo', 'bar');
    }, /Cannot use non-numeric segment/);
  });

  it('throws when using non-numeric segment on an array (intermediate)', () => {
    model.set('/', {items: [1, 2, 3]});
    assert.throws(() => {
      model.set('/items/foo/bar', 'value');
    }, /Cannot use non-numeric segment 'foo' on an array/);
  });

  it('normalizes trailing slashes', () => {
    let callCount = 0;
    model.subscribe('/foo', () => callCount++);
    model.set('/foo/', 'bar'); // Trailing slash
    assert.strictEqual(model.get('/foo/'), 'bar');
    assert.strictEqual(callCount, 1);
  });

  it('replaces root object on root update', () => {
    let callCount = 0;
    model.subscribe('/', () => callCount++);
    // Just add another sub on a generic path to ensure notifyAllSubscribers loop hits multiple items
    model.subscribe('/unrelated', () => {});

    model.set('/', {newRoot: 'foo'});
    assert.deepStrictEqual(model.get(''), {newRoot: 'foo'});
    assert.strictEqual(callCount, 1);
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
});
