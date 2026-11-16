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
 * Conversion of resolved values to plain JSON, for the arguments of calls sent
 * to the agent and for the keys that identify identical calls.
 */

/** Thrown when a value cannot be represented as JSON. */
export class NonJsonValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonJsonValueError';
  }
}

/**
 * Returns a plain JSON copy of `value`.
 *
 * An object property whose value is `undefined` is omitted, as
 * `JSON.stringify` omits it. Every key, `"__proto__"` included, becomes an
 * ordinary own property of the copy.
 *
 * @param value The value to copy.
 * @param sortKeys Whether to sort object keys recursively. Array order is kept.
 * @returns The JSON copy.
 * @throws {NonJsonValueError} If `value` contains something JSON cannot
 *   represent: `NaN` or `±Infinity`, an `undefined` array element, a function,
 *   a symbol, a bigint, a circular reference, or an object that is not a plain
 *   object or array (such as a `Date`, a `Map` or a class instance).
 */
export function toJsonValue(value: unknown, sortKeys = false): unknown {
  return copyJson(value, sortKeys, new Set(), '');
}

/**
 * Builds a key that identifies `value` up to the order of object keys.
 *
 * @param value The value to identify.
 * @returns The key, or `undefined` if `value` cannot be represented as JSON.
 */
export function canonicalJsonKey(value: unknown): string | undefined {
  try {
    return JSON.stringify(toJsonValue(value, true));
  } catch {
    return undefined;
  }
}

function copyJson(value: unknown, sortKeys: boolean, seen: Set<object>, path: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new NonJsonValueError(`${describe(path)} is ${String(value)}`);
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new NonJsonValueError(`${describe(path)} is a ${typeof value}`);
  }
  if (seen.has(value)) {
    throw new NonJsonValueError(`${describe(path)} is a circular reference`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, i) => {
        if (item === undefined) {
          throw new NonJsonValueError(`${describe(`${path}/${i}`)} is undefined`);
        }
        return copyJson(item, sortKeys, seen, `${path}/${i}`);
      });
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      const typeName = (value as {constructor?: {name?: string}}).constructor?.name || 'object';
      throw new NonJsonValueError(`${describe(path)} is a ${typeName}, not a plain object`);
    }
    const keys = Object.keys(value);
    if (sortKeys) keys.sort();
    const copy: Record<string, unknown> = {};
    for (const key of keys) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) continue;
      Object.defineProperty(copy, key, {
        value: copyJson(item, sortKeys, seen, `${path}/${key}`),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return copy;
  } finally {
    seen.delete(value);
  }
}

function describe(path: string): string {
  return path ? `the value at '${path}'` : 'the value';
}
