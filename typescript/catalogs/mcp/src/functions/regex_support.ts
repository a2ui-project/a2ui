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
 * Regular expression support for the text functions of the catalog: compilation of
 * agent-supplied patterns behind the same ReDoS check the basic catalog's `regex` function
 * uses, and the string-or-array mapping that `split`, `regexCapture` and `regexReplace` share.
 */

import {A2uiExpressionError, isSafeRegex} from '@a2ui/web_core/v1_0';

/** Maximum number of compiled patterns kept in the cache. */
const MAX_CACHED_PATTERNS = 100;

/** Compiled patterns keyed by `${flags}:${source}`, in insertion order. */
const compiledPatterns = new Map<string, RegExp>();

/**
 * Compiles a JavaScript regular expression after checking it for catastrophic backtracking,
 * caching up to `MAX_CACHED_PATTERNS` instances.
 *
 * Patterns are compiled without the `u` flag, so the accepted syntax matches the
 * `new RegExp(pattern)` check inside `isSafeRegex` and the basic catalog's `regex` function.
 *
 * @param source The pattern text.
 * @param functionName The calling function, named in the error.
 * @param flags Flags passed to `RegExp`; the caller resets `lastIndex` when it uses `g`.
 * @throws A2uiExpressionError if the pattern is invalid or unsafe.
 */
export function compileSafeRegex(source: string, functionName: string, flags = ''): RegExp {
  const key = `${flags}:${source}`;
  let compiled = compiledPatterns.get(key);
  if (compiled) {
    return compiled;
  }
  if (!isSafeRegex(source)) {
    throw new A2uiExpressionError(
      `${functionName} rejected the pattern '${source}': it is not a valid regular expression or it allows catastrophic backtracking.`,
      functionName,
    );
  }
  try {
    compiled = new RegExp(source, flags);
  } catch (error) {
    throw new A2uiExpressionError(
      `${functionName} could not compile the pattern '${source}': ${error instanceof Error ? error.message : String(error)}`,
      functionName,
      error,
    );
  }
  if (compiledPatterns.size >= MAX_CACHED_PATTERNS) {
    const oldestKey = compiledPatterns.keys().next().value;
    if (oldestKey !== undefined) {
      compiledPatterns.delete(oldestKey);
    }
  }
  compiledPatterns.set(key, compiled);
  return compiled;
}

/**
 * Applies `fn` to `value` as text, or to each element of an array `value`.
 *
 * `null` and `undefined` read as the empty string; any other non-string is converted with
 * `String`.
 */
export function mapTextValue<T>(value: unknown, fn: (item: string) => T): T | T[] {
  const asText = (item: unknown) => String(item ?? '');
  return Array.isArray(value) ? value.map(item => fn(asText(item))) : fn(asText(value));
}
