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
 * Shared plumbing for the data functions of this catalog.
 *
 * ## Why several arguments are typed loosely
 *
 * A2UI resolves a function call's arguments before invoking it, and an argument
 * may itself be a function call. When the inner call is asynchronous, as
 * `callMcpTool` is, the runtime has nothing to await it with and hands the
 * outer function the pending `Promise` instead of the value. The data functions
 * accept that and settle it themselves, so every argument that can receive the
 * output of another function is declared with `asyncable`.
 *
 * A payload author never writes a promise. The published catalog schema
 * therefore states the plain type, which is what the author must supply.
 *
 * The same reasoning sets every return type to `any`: a function handed a
 * pending argument returns a promise for its own result, so no narrower type
 * describes both cases. The description of each function states what it
 * produces once its arguments have settled.
 */

import {A2uiExpressionError} from '@a2ui/web_core/v0_9';
import {RE2JS} from 're2js';
import {z} from 'zod';

/** Reports whether a value is thenable, which is how a pending argument arrives. */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as {then?: unknown}).then === 'function'
  );
}

/**
 * Widens a schema to also admit a pending argument.
 *
 * The sync case keeps its validation. The async case cannot be checked here,
 * because the value does not exist yet, so the implementation re-checks it
 * after the promise settles.
 */
export function asyncable<T extends z.ZodTypeAny>(schema: T) {
  return z.union([schema, z.custom<PromiseLike<unknown>>(isThenable)]);
}

/** Narrows to an object literal, leaving a class instance or a promise out. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Awaits every promise nested inside `value`, rebuilding arrays and object
 * literals around the settled entries.
 *
 * Returns the value itself when nothing is pending, which is what keeps the
 * synchronous path of `withSettledArgs` synchronous.
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
 * Runs `body` once every argument has settled.
 *
 * A call whose arguments hold no promise returns synchronously, so a function
 * used inside a binding stays reactive. A call that had to await one returns a
 * promise for the same result.
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

/** Upper bound on compiled patterns held for the life of the process. */
const MAX_CACHED_PATTERNS = 100;

const compiledPatterns = new Map<string, ReturnType<typeof RE2JS.compile>>();

/**
 * Compiles an RE2 pattern, reusing an earlier compilation of the same source.
 *
 * RE2 rejects a pattern that could backtrack exponentially, so a payload cannot
 * stall the client with one.
 *
 * @param fn Name of the calling function, which the error reports.
 * @throws A2uiExpressionError when the pattern does not compile.
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
 * Applies `fn` to a string, or element by element to an array of them.
 *
 * Every text function of this catalog maps over an array this way, so one call
 * can rewrite a whole column of tool output. Null and undefined read as an
 * empty string rather than failing the call.
 */
export function overValue<T>(value: unknown, fn: (item: string) => T): T | T[] {
  const asText = (item: unknown) => String(item ?? '');
  return Array.isArray(value) ? value.map(item => fn(asText(item))) : fn(asText(value));
}
