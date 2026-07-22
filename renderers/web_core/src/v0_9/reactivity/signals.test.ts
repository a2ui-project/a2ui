/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert';
import {after, describe, it} from 'node:test';
import {
  signal as aSignal,
  computed as aComputed,
  Signal as ASignal,
  WritableSignal as AWritableSignal,
  isSignal as aIsSignal,
  effect as aEffect,
  untracked as auntracked,
} from '@angular/core';

import {
  setSignalImplementation,
  signal,
  computed,
  effect,
  isSignal,
  Signal,
  getValue,
  setValue,
  _PRIVATE_DEFAULT_SIGNAL_IMPLEMENTATION,
} from './signals.js';

describe('Signals abstraction', () => {
  after(() => {
    setSignalImplementation(_PRIVATE_DEFAULT_SIGNAL_IMPLEMENTATION);
  });

  it('uses default (preact) implementation correctly', () => {
    const s = signal('hello');
    assert.strictEqual(getValue(s), 'hello');

    const c = computed(() => getValue(s) + ' world');
    assert.strictEqual(getValue(c), 'hello world');

    let effectCount = 0;
    const cleanup = effect(() => {
      getValue(s);
      effectCount++;
    });

    assert.strictEqual(effectCount, 1);
    setValue(s, 'bye');
    assert.strictEqual(effectCount, 2);

    cleanup();
    assert.ok(isSignal(s));
  });

  it('can be overridden with Angular variation', () => {
    setSignalImplementation({
      computed: <T>(fn: () => T) => {
        const c = aComputed(fn);
        return c as unknown as Signal<T>;
      },
      isSignal: (val: unknown): val is Signal<unknown> => aIsSignal(val),
      signal: <T>(initialValue: T) => {
        const s = aSignal(initialValue);
        return s as unknown as Signal<T>;
      },
      effect: (fn: () => void | (() => void)) => {
        const e = aEffect(cleanupRegisterFn => {
          const cleanup = fn();
          if (typeof cleanup === 'function') {
            cleanupRegisterFn(cleanup);
          }
        });
        return () => e.destroy();
      },
      getValue: <T>(s: Signal<T>) => (s as ASignal<T>)(),
      setValue: <T>(s: Signal<T>, v: T) => (s as AWritableSignal<T>).set(v),
      peekValue: <T>(s: Signal<T>) => auntracked(() => (s as ASignal<T>)()),
      batchWrite: (batchFn: () => void) => {
        batchFn();
      },
    });

    const s = signal('first');
    const computedVal = computed(() => `prefix ${getValue(s)}`);

    assert.strictEqual(getValue(s), 'first');
    assert.strictEqual(getValue(computedVal), 'prefix first');

    setValue(s, 'second');

    assert.strictEqual(getValue(s), 'second');
    assert.strictEqual(getValue(computedVal), 'prefix second');

    assert.ok(isSignal(s));
  });
});
