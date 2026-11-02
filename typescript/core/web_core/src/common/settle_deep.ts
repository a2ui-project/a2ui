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
 * Settling of pending values nested in resolved function arguments.
 *
 * The runtime resolves the arguments of a function call before invoking it.
 * An argument produced by an asynchronous function arrives as a pending
 * Promise, possibly nested in an array or a plain object built from other
 * arguments. `settleDeep` awaits every such Promise before the arguments are
 * validated and the function runs, and returns the input itself, synchronously,
 * when nothing in it is pending, so synchronous expressions stay synchronous.
 */

/**
 * Checks whether a value is a Promise-like object.
 *
 * @param value The value to inspect.
 * @returns Whether `value` has a callable `then`.
 */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as {then?: unknown}).then === 'function'
  );
}

/**
 * Checks whether a value is a plain object: not an array, `null`, or an
 * instance of a class such as `Date` or a `Signal`.
 *
 * @param value The value to inspect.
 * @returns Whether `value` is a plain object.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (Array.isArray(value) || typeof value !== 'object' || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively awaits the Promises nested in the arrays and plain objects of
 * `value`.
 *
 * Only arrays and plain objects are walked; a `Date`, a `Signal`, or any other
 * class instance is returned as it is. A rejected Promise anywhere in `value`
 * rejects the returned Promise.
 *
 * @param value The value to settle.
 * @returns `value` itself when nothing in it is pending, otherwise a Promise
 *     of `value` with every nested Promise replaced by its settled value.
 */
export function settleDeep<T>(value: T): T | Promise<unknown> {
  if (isThenable(value)) {
    return Promise.resolve(value).then(settleDeep);
  }
  if (Array.isArray(value)) {
    const items = value.map(settleDeep);
    return items.some(isThenable) ? Promise.all(items) : value;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).map(([key, item]) => [key, settleDeep(item)] as const);
    if (!entries.some(([, item]) => isThenable(item))) {
      return value;
    }
    return Promise.all(entries.map(([, item]) => item)).then(settled =>
      Object.fromEntries(entries.map(([key], i) => [key, settled[i]])),
    );
  }
  return value;
}
