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

/**
 * Resolved dynamic value snapshot in a node's properties.
 *
 * Captures the current value pinned at the time of emission. A new binding instance
 * is emitted through the node's properties whenever the underlying value changes.
 *
 * Literal and function-call values resolve to a read-only `ResolvedBinding`, preventing
 * accidental writes without explicitly narrowing to {@link WritableBinding}.
 */
export class ResolvedBinding<T> {
  /**
   * Creates a new `ResolvedBinding` instance.
   *
   * @param value The resolved snapshot value.
   */
  constructor(readonly value: T) {}
}

/**
 * Writable resolved dynamic binding backed by a mutable data model path.
 */
export class WritableBinding<T> extends ResolvedBinding<T> {
  /**
   * Creates a new `WritableBinding` instance.
   *
   * @param value Current snapshot value.
   * @param set Setter callback to update the underlying model.
   * @param path Authored data path.
   */
  constructor(
    value: T,
    readonly set: (value: T) => void,
    /** Authored data path before scope resolution. */
    readonly path: string,
  ) {
    super(value);
  }
}

/**
 * Narrows a `ResolvedBinding` to a `WritableBinding`.
 *
 * @param binding The binding to check.
 * @returns Whether the binding is writable.
 */
export function isWritable<T>(binding: ResolvedBinding<T>): binding is WritableBinding<T> {
  return binding instanceof WritableBinding;
}

/**
 * Compares two bindings for equivalence during change detection.
 *
 * Returns true if both bindings have identical writability, write destination path,
 * and structurally equal snapshot values.
 *
 * @param a First binding.
 * @param b Second binding.
 * @returns Whether the two bindings are equivalent.
 */
export function sameBinding(a: ResolvedBinding<unknown>, b: ResolvedBinding<unknown>): boolean {
  if (isWritable(a) !== isWritable(b)) {
    return false;
  }
  if (isWritable(a) && isWritable(b) && a.path !== b.path) {
    return false;
  }
  return valueEquals(a.value, b.value);
}

function valueEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => valueEquals(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return (
      aKeys.length === bKeys.length && aKeys.every(key => key in b && valueEquals(a[key], b[key]))
    );
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
