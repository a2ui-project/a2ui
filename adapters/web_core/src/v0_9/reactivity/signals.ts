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

// SignalKinds and WritableSignalKinds are declared in such a way that
// downstream library impls can dynamically provide their Signal implementations
// in a type-safe way. Usage downstream might look something like:
//
// declare module '../reactivity/signals' {
//   interface SignalKinds<T> {
//     preact: Signal<T>;
//   }
//   interface WritableSignalKinds<T> {
//     preact: Signal<T>;
//   }
// }
//
// This <T>, while unused, is required to pass through to a given Signal impl.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface SignalKinds<T> {}

// This <T>, while unused, is required to pass through to a given Signal impl.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface WritableSignalKinds<T> {}

/**
 * A generic representation of a Signal that could come from any framework.
 * For any library building on top of A2UI's web core lib, this must be
 * implemented for their associated signals implementation.
 */
export interface FrameworkSignal<K extends keyof SignalKinds<any>> {
  /**
   * Create a computed signal for this framework.
   */
  computed<T>(fn: () => T): SignalKinds<T>[K];

  /**
   * Run a reactive effect.
   */
  effect(fn: () => void, cleanupCallback?: () => void): () => void;

  /**
   * Check if an arbitrary object is a framework signal.
   */
  isSignal(val: unknown): val is SignalKinds<any>[K];

  /**
   * Wrap the value in a signal.
   */
  wrap<T>(val: T): WritableSignalKinds<T>[K];

  /**
   * Extract the value from a signal.
   */
  unwrap<T>(val: SignalKinds<T>[K]): T;

  /**
   * Sets the value of the provided framework signal.
   */
  set<T>(signal: WritableSignalKinds<T>[K], value: T): void;
}
