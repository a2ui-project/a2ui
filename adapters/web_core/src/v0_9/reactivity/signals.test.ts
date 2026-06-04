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
import {describe, it} from 'node:test';
import {Signal as PSignal, computed as pComputed, effect as pEffect} from '@preact/signals-core';
import {
  signal as aSignal,
  computed as aComputed,
  Signal as ASignal,
  WritableSignal as AWritableSignal,
  isSignal,
  effect as aEffect,
} from '@angular/core';

import {FrameworkSignal} from './signals';

declare module './signals' {
  interface SignalKinds<T> {
    angular: ASignal<T>;
    preact: PSignal<T>;
  }
  interface WritableSignalKinds<T> {
    angular: AWritableSignal<T>;
    preact: PSignal<T>;
  }
}

describe('FrameworkSignal', () => {
  // Test FrameworkSignal with two sample implemenations that wrap Angular and
  // Preact signals. Angular and Preact signals are good representitive samples,
  // because the two common patterns - `()` vs. `.value` - are represented by
  // Angular and Preact respectively.

  describe('Angular variation', () => {
    const AngularSignal: FrameworkSignal<'angular'> = {
      computed: <T>(fn: () => T) => aComputed(fn),
      isSignal: (val: unknown) => isSignal(val),
      wrap: <T>(val: T) => aSignal(val),
      unwrap: <T>(val: ASignal<T>) => val(),
      set: <T>(signal: AWritableSignal<T>, value: T) => signal.set(value),
      effect: (fn: () => void, cleanupCallback: () => void) => {
        const e = aEffect(cleanupRegisterFn => {
          cleanupRegisterFn(cleanupCallback);
          fn();
        });
        return () => e.destroy();
      },
    };

    it('round trip wraps and unwraps successfully', () => {
      const val = 'hello';
      const wrapped = AngularSignal.wrap(val);
      assert.strictEqual(AngularSignal.unwrap(wrapped), val);
    });

    it('handles updates well', () => {
      const signal = AngularSignal.wrap('first');
      const computedVal = AngularSignal.computed(() => `prefix ${signal()}`);

      assert.strictEqual(signal(), 'first');
      assert.strictEqual(AngularSignal.unwrap(signal), 'first');
      assert.strictEqual(computedVal(), 'prefix first');
      assert.strictEqual(AngularSignal.unwrap(computedVal), 'prefix first');

      AngularSignal.set(signal, 'second');

      assert.strictEqual(signal(), 'second');
      assert.strictEqual(AngularSignal.unwrap(signal), 'second');
      assert.strictEqual(computedVal(), 'prefix second');
      assert.strictEqual(AngularSignal.unwrap(computedVal), 'prefix second');
    });

    describe('.isSignal()', () => {
      it('validates a signal', () => {
        const val = 'hello';
        const wrapped = AngularSignal.wrap(val);
        assert.ok(AngularSignal.isSignal(wrapped));
      });

      it('rejects a non-signal', () => {
        assert.strictEqual(AngularSignal.isSignal('hello'), false);
      });
    });
  });

  describe('Preact variation', () => {
    const PreactSignal: FrameworkSignal<'preact'> = {
      computed: <T>(fn: () => T) => pComputed(fn),
      isSignal: (val: unknown) => val instanceof PSignal,
      wrap: <T>(val: T) => new PSignal(val),
      unwrap: <T>(val: PSignal<T>) => val.value,
      set: <T>(signal: PSignal<T>, value: T) => (signal.value = value),
      effect: (fn: () => void) => pEffect(fn),
    };

    it('round trip wraps and unwraps successfully', () => {
      const val = 'hello';
      const wrapped = PreactSignal.wrap(val);
      assert.strictEqual(PreactSignal.unwrap(wrapped), val);
    });

    it('handles updates well', () => {
      const signal = PreactSignal.wrap('first');
      const computed = PreactSignal.computed(() => `prefix ${signal.value}`);

      assert.strictEqual(signal.value, 'first');
      assert.strictEqual(PreactSignal.unwrap(signal), 'first');
      assert.strictEqual(computed.value, 'prefix first');
      assert.strictEqual(PreactSignal.unwrap(computed), 'prefix first');

      PreactSignal.set(signal, 'second');

      assert.strictEqual(signal.value, 'second');
      assert.strictEqual(PreactSignal.unwrap(signal), 'second');
      assert.strictEqual(computed.value, 'prefix second');
      assert.strictEqual(PreactSignal.unwrap(computed), 'prefix second');
    });

    describe('.isSignal()', () => {
      it('validates a signal', () => {
        const val = 'hello';
        const wrapped = PreactSignal.wrap(val);
        assert.ok(PreactSignal.isSignal(wrapped));
      });

      it('rejects a non-signal', () => {
        assert.strictEqual(PreactSignal.isSignal('hello'), false);
      });
    });
  });
});
