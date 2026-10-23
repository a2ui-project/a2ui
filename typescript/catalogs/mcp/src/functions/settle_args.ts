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
 * Settling of pending function arguments.
 *
 * A2UI resolves the arguments of a function call before invoking it, and an
 * argument produced by an asynchronous function such as `callMcpTool` arrives
 * as a pending Promise. The data functions of this catalog wrap their body in
 * `withSettledArgs`, which runs it synchronously when every argument is
 * settled (so reactive bindings keep working) and otherwise awaits the pending
 * ones first.
 */

/** Checks whether a value is a Promise-like object. */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as {then?: unknown}).then === 'function'
  );
}

/** Checks whether a value is a plain object: not an array, `null`, or a class instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (Array.isArray(value) || typeof value !== 'object' || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively awaits the Promises nested in arrays and plain objects of `value`.
 *
 * Returns `value` itself, synchronously, when nothing in it is pending.
 */
export function settleDeep(value: unknown): unknown {
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

/**
 * Runs `body` once every argument has settled.
 *
 * Returns the result of `body` synchronously when no argument is pending, and a
 * Promise of it otherwise. A rejected argument rejects that Promise.
 */
export function withSettledArgs<T>(
  args: Record<string, unknown>,
  body: (settled: Record<string, unknown>) => T,
): T | Promise<T> {
  const settled = settleDeep(args);
  return isThenable(settled)
    ? Promise.resolve(settled).then(value => body(value as Record<string, unknown>))
    : body(settled as Record<string, unknown>);
}
