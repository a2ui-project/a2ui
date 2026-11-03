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
 * Marker for a function argument whose evaluation has already failed and been
 * reported on the surface. Enclosing function calls must not run or report a
 * duplicate surface error when any argument resolves to a `FailedArgument`.
 */
export class FailedArgument {
  constructor(readonly error: unknown) {}
}

/**
 * Finds the first `FailedArgument` nested inside `value`, walking arrays and
 * plain objects recursively.
 *
 * @param value The settled value or argument map to inspect.
 * @returns The first `FailedArgument` encountered, or `undefined` if none is present.
 */
export function findFailedArgument(value: unknown): FailedArgument | undefined {
  if (value instanceof FailedArgument) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFailedArgument(item);
      if (found) return found;
    }
    return undefined;
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) {
      const found = findFailedArgument(item);
      if (found) return found;
    }
    return undefined;
  }
  return undefined;
}

const settledPromises = new WeakMap<PromiseLike<unknown>, {value: unknown}>();

/**
 * Records the settled value of a tracked Promise so subsequent `settleDeep`
 * passes can read it synchronously when a sibling reactive dependency changes.
 *
 * @param promise The Promise that settled.
 * @param value The settled value.
 */
export function recordSettledValue(promise: PromiseLike<unknown>, value: unknown): void {
  settledPromises.set(promise, {value});
}

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
    const recorded = settledPromises.get(value);
    if (recorded !== undefined) {
      return settleDeep(recorded.value) as T | Promise<unknown>;
    }
    return Promise.resolve(value).then(settleDeep);
  }
  if (Array.isArray(value)) {
    const items = value.map(settleDeep);
    if (!items.some(isThenable)) {
      return (items.every((item, i) => item === value[i]) ? value : items) as T;
    }
    return Promise.all(items);
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).map(([key, item]) => [key, settleDeep(item)] as const);
    if (!entries.some(([, item]) => isThenable(item))) {
      return (
        entries.every(([key, item]) => item === value[key]) ? value : Object.fromEntries(entries)
      ) as T;
    }
    return Promise.all(entries.map(([, item]) => item)).then(settled =>
      Object.fromEntries(entries.map(([key], i) => [key, settled[i]])),
    );
  }
  return value;
}
