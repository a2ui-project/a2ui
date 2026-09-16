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
import {loadConformanceSuite} from './harness.js';
import {DataModel, type DataSubscription} from '../../src/v0_9/state/data-model.js';

/**
 * Runs the shared `conformance/core/data_model.yaml` suite against `DataModel`.
 *
 * One mapping is worth calling out: `op: delete` maps to `set(path, undefined)`,
 * because this implementation removes a key when its value becomes `undefined`.
 *
 * Behaviour that cannot be expressed as a shared, cross-language dataset stays
 * in `src/v0_9/state/data-model.test.ts`.
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
