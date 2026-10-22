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
 * Shared utilities for MCP catalog data functions.
 *
 * Because A2UI resolves arguments before invoking a function, nested async
 * calls (like `callMcpTool`) arrive as pending Promises. Data functions use
 * `asyncable` and `withSettledArgs` to accept and await Promise arguments
 * automatically while remaining synchronous when all arguments are already
 * resolved.
 */

import {A2uiExpressionError} from '@a2ui/web_core/v0_9';
import {RE2JS} from 're2js';
import {z} from 'zod';

/** Checks whether a value is a Promise-like object. */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as {then?: unknown}).then === 'function'
  );
}

/**
 * Widens a Zod schema to accept either a resolved value or a pending Promise.
 */
export function asyncable<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, z.custom<PromiseLike<unknown>>(isThenable)]);
}

/** Checks whether a value is a plain object (not an array, null, or class instance). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively awaits all Promises nested inside `value`.
 *
 * Returns `value` synchronously if no nested Promises are found.
 */
function settleDeep(value: unknown): unknown | Promise<unknown> {
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
 * Executes `body` once all arguments have resolved.
 *
 * Runs synchronously if no arguments contain Promises, preserving reactive bindings,
 * or returns a Promise if any argument is asynchronous.
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

/** Maximum number of compiled regex patterns to cache. */
const MAX_CACHED_PATTERNS = 100;

const compiledPatterns = new Map<string, ReturnType<typeof RE2JS.compile>>();

/**
 * Compiles and caches an RE2 regular expression.
 *
 * @param source The regular expression string to compile.
 * @param fn The name of the calling function for error reporting.
 * @throws A2uiExpressionError if the pattern is invalid.
 */
export function pattern(source: string, fn: string): ReturnType<typeof RE2JS.compile> {
  let compiled = compiledPatterns.get(source);
  if (!compiled) {
    try {
      compiled = RE2JS.compile(source);
    } catch (error) {
      throw new A2uiExpressionError(
        `Invalid RE2 pattern '${source}': ${error instanceof Error ? error.message : error}`,
        fn,
        error,
      );
    }
    if (compiledPatterns.size >= MAX_CACHED_PATTERNS) {
      const oldestKey = compiledPatterns.keys().next().value;
      if (oldestKey !== undefined) {
        compiledPatterns.delete(oldestKey);
      }
    }
    compiledPatterns.set(source, compiled);
  }
  return compiled;
}

/**
 * Applies `fn` to a single string or maps it across an array of strings.
 *
 * Converts null and undefined values to empty strings.
 */
export function overValue<T>(value: unknown, fn: (item: string) => T): T | T[] {
  const asText = (item: unknown) => String(item ?? '');
  return Array.isArray(value) ? value.map(item => fn(asText(item))) : fn(asText(value));
}
