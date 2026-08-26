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
import {loadConformanceSuite} from '../conformance/harness.js';
import {DataModel, type DataSubscription} from './data-model.js';

/**
 * Behaviour shared by every A2UI data model implementation lives in
 * `conformance/core/data_model.yaml` and is exercised by the harness below.
 *
 * One mapping is worth calling out: `op: delete` maps to `set(path, undefined)`,
 * because this implementation removes a key when its value becomes `undefined`.
 *
 * The `describe` blocks after the harness cover behaviour that is specific to
 * this JavaScript implementation and therefore cannot be part of a shared,
 * cross-language dataset:
 *
 * - prototype pollution guards (`__proto__`, `constructor`, `prototype`) and
 *   `Object.prototype` property leakage, which only exist because JavaScript
 *   objects have a prototype chain;
 * - `null` and `undefined` path arguments, which languages with non-nullable
 *   string types cannot express;
 * - the distinction between storing `undefined` and removing a key, which
 *   languages without `undefined` cannot express;
 * - rejection of leading-zero list indices, which this implementation enforces
 *   and the Dart implementation currently does not;
 * - unbounded list indices. Arrays here are sparse, so writing `/items/999999999`
 *   is cheap; Dart lists are dense, so the Dart implementation rejects the same
 *   write to avoid allocating the whole list;
 * - notification on an unchanged value. This implementation copies containers on
 *   read and notifies only on an actual change, so replacing the root does not
 *   wake an observer whose own value stayed `undefined`. The Dart implementation
 *   notifies unconditionally.
 */

interface ConformanceStep {
  op: 'get' | 'set' | 'delete' | 'dispose';
  path?: string;
  value?: unknown;
  expect?: unknown;
  expect_absent?: boolean;
  expect_type?: 'list' | 'object';
  expect_values?: Record<string, unknown>;
  expect_notified?: string[];
  expect_error?: {category?: string; message?: string} | string;
}

interface ConformanceCase {
  name: string;
  initial?: Record<string, unknown>;
  watch?: string[];
  steps: ConformanceStep[];
}

interface Observer {
  path: string;
  subscription: DataSubscription<unknown>;
  count: number;
}

function deepCopy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function errorMessagePattern(expectError: ConformanceStep['expect_error']): RegExp {
  const message = typeof expectError === 'string' ? expectError : (expectError?.message ?? '');
  return new RegExp(message);
}

function applyOp(model: DataModel, step: ConformanceStep, reason: string): void {
  switch (step.op) {
    case 'get': {
      const actual = model.get(step.path!);
      if (step.expect_absent === true) {
        assert.strictEqual(actual, undefined, reason);
      }
      if (step.expect_type !== undefined) {
        assert.strictEqual(Array.isArray(actual) ? 'list' : 'object', step.expect_type, reason);
      }
      if ('expect' in step) {
        assert.deepStrictEqual(actual, step.expect, reason);
      }
      break;
    }
    case 'set':
      model.set(step.path!, step.value);
      break;
    case 'delete':
      // This implementation removes a key when its value becomes `undefined`.
      model.set(step.path!, undefined);
      break;
    case 'dispose':
      model.dispose();
      break;
    default:
      throw new Error(`Unknown data_model op: ${String(step.op)}`);
  }
}

function runCase(testCase: ConformanceCase): void {
  // The suite is parsed once and shared across cases, so the initial data is
  // deep copied before the model mutates it.
  const model = new DataModel(deepCopy(testCase.initial) ?? {});
  const observers: Observer[] = (testCase.watch ?? []).map(path => {
    const observer: Observer = {path, count: 0, subscription: undefined!};
    observer.subscription = model.subscribe(path, () => observer.count++);
    return observer;
  });

  testCase.steps.forEach((step, index) => {
    const reason = `${testCase.name} step ${index} (${step.op})`;
    for (const observer of observers) {
      observer.count = 0;
    }

    if (step.expect_error !== undefined) {
      assert.throws(
        () => applyOp(model, step, reason),
        errorMessagePattern(step.expect_error),
        reason,
      );
      return;
    }

    applyOp(model, step, reason);

    if (step.expect_notified !== undefined) {
      const notified: string[] = [];
      for (const observer of observers) {
        for (let i = 0; i < observer.count; i++) {
          notified.push(observer.path);
        }
      }
      assert.deepStrictEqual(
        notified.sort(),
        [...step.expect_notified].sort(),
        `${reason}: notified observers`,
      );
    }

    for (const [path, expected] of Object.entries(step.expect_values ?? {})) {
      const observer = observers.find(o => o.path === path);
      assert.ok(observer, `${reason}: ${path} is not watched`);
      assert.deepStrictEqual(observer.subscription.value, expected, `${reason}: ${path}`);
    }
  });
}

describe('conformance core/data_model.yaml', () => {
  const cases = loadConformanceSuite<ConformanceCase>('core/data_model.yaml');

  it('suite is not empty', () => {
    assert.ok(cases.length > 0);
  });

  for (const testCase of cases) {
    it(testCase.name, () => runCase(testCase));
  }
});

describe('DataModel (JavaScript specific)', () => {
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

  // --- undefined, which the shared dataset expresses as `op: delete` ---

  it('removes keys when value is undefined', () => {
    model.set('/user/name', undefined);
    assert.strictEqual(model.get('/user/name'), undefined);
    assert.strictEqual(Object.keys(model.get('/user')).includes('name'), false);
  });

  it('handles updates to undefined', () => {
    model.set('/foo', 'bar');
    let val: unknown = 'initial';
    const sub = model.subscribe('/foo', v => (val = v));

    model.set('/foo', undefined);
    assert.strictEqual(sub.value, undefined);
    assert.strictEqual(val, undefined);
  });

  // --- Subscription objects ---

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

  // --- Null and undefined path arguments ---

  it('throws when path is null or undefined', () => {
    assert.throws(() => model.get(null as never), /Path cannot be null or undefined/);
    assert.throws(() => model.get(undefined as never), /Path cannot be null or undefined/);
    assert.throws(() => model.set(null as never, 'value'), /Path cannot be null or undefined/);
    assert.throws(() => model.set(undefined as never, 'value'), /Path cannot be null or undefined/);
  });

  it('calculates descendants against root path', () => {
    // This explicitly hits an internal method branch where parentPath === "/"
    const isDescendant = (
      model as unknown as {isDescendant: (a: string, b: string) => boolean}
    ).isDescendant.bind(model);
    assert.strictEqual(isDescendant('/user', '/'), true);
    assert.strictEqual(isDescendant('/', '/'), false);
  });

  // --- Leading-zero list indices ---

  it('rejects leading-zero array indices (RFC 6901)', () => {
    assert.throws(() => {
      model.set('/items/01', 'value');
    }, /Cannot use non-numeric segment/);
    assert.throws(() => {
      model.set('/items/01/nested', 'value');
    }, /Cannot use non-numeric segment/);
    assert.strictEqual(model.get('/items/01'), undefined);
  });

  // --- Security: prototype pollution protection ---

  it('prevents prototype pollution via __proto__ in set, get, getSignal, subscribe', () => {
    assert.throws(
      () => model.set('/__proto__/polluted', 'hacked'),
      /Forbidden path segment '__proto__'/,
    );
    assert.throws(() => model.get('/__proto__/polluted'), /Forbidden path segment '__proto__'/);
    assert.throws(
      () => model.getSignal('/__proto__/polluted'),
      /Forbidden path segment '__proto__'/,
    );
    assert.throws(
      () => model.subscribe('/__proto__/polluted', () => {}),
      /Forbidden path segment '__proto__'/,
    );
    assert.strictEqual(({} as {polluted?: unknown}).polluted, undefined);
  });

  it('prevents prototype pollution via constructor in set, get, getSignal, subscribe', () => {
    assert.throws(
      () => model.set('/constructor/prototype/polluted', 'hacked'),
      /Forbidden path segment 'constructor'/,
    );
    assert.throws(
      () => model.get('/constructor/prototype/polluted'),
      /Forbidden path segment 'constructor'/,
    );
    assert.throws(
      () => model.getSignal('/constructor/prototype/polluted'),
      /Forbidden path segment 'constructor'/,
    );
    assert.throws(
      () => model.subscribe('/constructor/prototype/polluted', () => {}),
      /Forbidden path segment 'constructor'/,
    );
    assert.strictEqual(({} as {polluted?: unknown}).polluted, undefined);
  });

  it('prevents prototype pollution via prototype in set, get, getSignal, subscribe', () => {
    assert.throws(
      () => model.set('/user/prototype/polluted', 'hacked'),
      /Forbidden path segment 'prototype'/,
    );
    assert.throws(
      () => model.get('/user/prototype/polluted'),
      /Forbidden path segment 'prototype'/,
    );
    assert.throws(
      () => model.getSignal('/user/prototype/polluted'),
      /Forbidden path segment 'prototype'/,
    );
    assert.throws(
      () => model.subscribe('/user/prototype/polluted', () => {}),
      /Forbidden path segment 'prototype'/,
    );
    assert.strictEqual(({} as {polluted?: unknown}).polluted, undefined);
  });

  it('allows a large sparse array index', () => {
    // Arrays here are sparse, so this allocates nothing. Implementations with
    // dense lists reject the same write; see conformance/core/data_model.yaml.
    model.set('/items/999999', 'x');
    assert.strictEqual(model.get('/items/999999'), 'x');
  });

  it('does not wake an observer whose value did not change', () => {
    let unrelatedCount = 0;
    let rootCount = 0;
    model.subscribe('/', () => rootCount++);
    model.subscribe('/unrelated', () => unrelatedCount++);

    model.set('/', {newRoot: 'foo'});

    assert.strictEqual(rootCount, 1);
    assert.strictEqual(unrelatedCount, 0);
  });

  it('does not leak Object.prototype inherited properties on get', () => {
    assert.strictEqual(model.get('/toString'), undefined);
    assert.strictEqual(model.get('/valueOf'), undefined);
    assert.strictEqual(model.get('/hasOwnProperty'), undefined);
  });

  it('allows setting and reading own properties named after prototype methods', () => {
    model.set('/toString', 'custom toString');
    assert.strictEqual(model.get('/toString'), 'custom toString');

    model.set('/valueOf/nested', 'custom valueOf');
    assert.strictEqual(model.get('/valueOf/nested'), 'custom valueOf');
  });
});
