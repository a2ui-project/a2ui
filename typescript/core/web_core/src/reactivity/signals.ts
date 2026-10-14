/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
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

/**
 * Generic reactive signal holding a value of type `T`.
 *
 * @template T Type of value managed by the signal.
 */
export interface Signal<T = unknown> {
  // Marker that prevents any value from being assigned as a signal.
  // Without this any object can be assigned to a signal.
  __signalBrand?: T;
  unsubscribe?: () => void;
}

/**
 * Pluggable backend adapter providing primitive reactive signal operations.
 */
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
 * Configures the active reactive signals implementation backend.
 *
 * Enables swapping the underlying reactivity library at runtime.
 *
 * @param impl Pluggable signal implementation operations.
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

/**
 * Creates a reactive state signal initialized to the specified value.
 *
 * @param initialValue Initial value of the signal.
 * @returns A reactive state signal.
 */
export function signal<T>(initialValue: T): Signal<T> {
  return signalImpl(initialValue);
}

/**
 * Creates a derived reactive signal that recomputes when dependencies change.
 *
 * @param computeFn Calculation callback producing the derived value.
 * @returns A reactive read-only computed signal.
 */
export function computed<T>(computeFn: () => T): Signal<T> {
  return computedImpl(computeFn);
}

/**
 * Runs a side-effect callback reactively when accessed signals change.
 *
 * @param effectFn Callback to execute, optionally returning a cleanup function.
 * @returns A disposal function that cancels the effect subscription.
 */
export function effect(effectFn: () => void | (() => void)): () => void {
  return effectImpl(effectFn);
}

/**
 * Batches multiple signal updates to defer subscriber notifications until complete.
 *
 * @param batchFn Callback enclosing signal mutations.
 */
export function batchWrite(batchFn: () => void): void {
  return batchWriteImpl(batchFn);
}

/**
 * Checks whether a given value is a reactive Signal.
 *
 * @param val Value to test.
 * @returns Whether the value is a Signal.
 */
export function isSignal(val: unknown): val is Signal<unknown> {
  return isSignalImpl(val);
}

/**
 * Reads the current value of a signal, subscribing the active reactive context.
 *
 * @param signal Target signal to read.
 * @returns The current value of the signal.
 */
export function getValue<T>(signal: Signal<T>): T {
  return getValueImpl(signal);
}

/**
 * Updates the current value of a writable signal, notifying subscribers.
 *
 * @param signal Target signal to update.
 * @param value New value to assign.
 */
export function setValue<T>(signal: Signal<T>, value: T): void {
  setValueImpl(signal, value);
}

/**
 * Reads the current value of a signal without creating a reactive subscription.
 *
 * @param signal Target signal to read.
 * @returns The current value of the signal.
 */
export function peekValue<T>(signal: Signal<T>): T {
  return peekValueImpl(signal);
}
