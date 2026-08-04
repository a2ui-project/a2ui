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

import {
  signal as preactSignal,
  computed as preactComputed,
  effect as preactEffect,
  batch as preactBatch,
  Signal as PreactSignal,
  Computed as PreactComputed,
} from '@preact/signals-core';

export interface Signal<T = unknown> {
  // Marker that prevents any value from being assigned as a signal.
  // Without this any object can be assigned to a signal.
  __signalBrand?: T;
  unsubscribe?: () => void;
}

export interface SignalImplementations {
  signal: <T>(initialValue: T) => Signal<T>;
  computed: <T>(computeFn: () => T) => Signal<T>;
  effect: (effectFn: () => void | (() => void)) => () => void;
  batchWrite: (batchFn: () => void) => void;
  isSignal: (val: unknown) => val is Signal<unknown>;
  getValue: <T>(signal: Signal<T>) => T;
  setValue: <T>(signal: Signal<T>, value: T) => void;
  peekValue: <T>(signal: Signal<T>) => T;
}

let signalImpl: SignalImplementations['signal'];
let computedImpl: SignalImplementations['computed'];
let effectImpl: SignalImplementations['effect'];
let batchWriteImpl: SignalImplementations['batchWrite'];
let isSignalImpl: SignalImplementations['isSignal'];
let getValueImpl: SignalImplementations['getValue'];
let setValueImpl: SignalImplementations['setValue'];
let peekValueImpl: SignalImplementations['peekValue'];

/** Default signal implementations. Exported only for testing purposes. */
export const _PRIVATE_DEFAULT_SIGNAL_IMPLEMENTATION: SignalImplementations = {
  signal: preactSignal as SignalImplementations['signal'],
  computed: preactComputed as SignalImplementations['computed'],
  effect: preactEffect as SignalImplementations['effect'],
  batchWrite: preactBatch as SignalImplementations['batchWrite'],
  isSignal: (val: unknown): val is Signal<unknown> =>
    !!val && typeof val === 'object' && 'value' in val && 'peek' in val,
  getValue: <T>(signal: Signal<T>): T => (signal as PreactSignal<T>).value,
  setValue: <T>(signal: Signal<T>, value: T): void => {
    if (!(signal instanceof PreactComputed)) {
      (signal as PreactSignal<T>).value = value;
    }
  },
  peekValue: <T>(signal: Signal<T>): T => (signal as PreactSignal<T>).peek(),
};

setSignalImplementation(_PRIVATE_DEFAULT_SIGNAL_IMPLEMENTATION);

/**
 * Sets the implementations of the various signal-related functions.
 * This allows for signal libraries to be swapped out.
 */
export function setSignalImplementation(impl: SignalImplementations): void {
  // Intentionally only store the functions so we ignore any mutations of the implementation.
  signalImpl = impl.signal;
  computedImpl = impl.computed;
  effectImpl = impl.effect;
  batchWriteImpl = impl.batchWrite;
  isSignalImpl = impl.isSignal;
  getValueImpl = impl.getValue;
  setValueImpl = impl.setValue;
  peekValueImpl = impl.peekValue;
}

export function signal<T>(initialValue: T): Signal<T> {
  return signalImpl(initialValue);
}

export function computed<T>(computeFn: () => T): Signal<T> {
  return computedImpl(computeFn);
}

export function effect(effectFn: () => void | (() => void)): () => void {
  return effectImpl(effectFn);
}

export function batchWrite(batchFn: () => void): void {
  return batchWriteImpl(batchFn);
}

export function isSignal(val: unknown): val is Signal<unknown> {
  return isSignalImpl(val);
}

export function getValue<T>(signal: Signal<T>): T {
  return getValueImpl(signal);
}

export function setValue<T>(signal: Signal<T>, value: T): void {
  setValueImpl(signal, value);
}

export function peekValue<T>(signal: Signal<T>): T {
  return peekValueImpl(signal);
}
