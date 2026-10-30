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
 * agent-supplied patterns behind a portability check and the ReDoS check in `safe_regex.ts`, and
 * the string-or-array mapping that `split` and `regexCapture` share.
 */

import {A2uiExpressionError} from '@a2ui/web_core/v1_0';

import {isSafeRegex} from './safe_regex.js';

/** Maximum number of compiled patterns kept in the cache. */
const MAX_CACHED_PATTERNS = 100;

/** Compiled patterns keyed by source, in insertion order. */
const compiledPatterns = new Map<string, RegExp>();

/** Group openers of lookahead and lookbehind assertions. */
const LOOKAROUND_OPENERS = ['(?=', '(?!', '(?<=', '(?<!'];

/**
 * Whether a pattern stays inside the portable subset every renderer can implement: no lookahead
 * or lookbehind assertions, and no numbered (`\1` to `\9`) or named (`\k<name>`) backreferences.
 * Escaped characters and the contents of character classes are read as literals.
 */
export function isPortableRegex(pattern: string): boolean {
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '\\') {
      const next = pattern[i + 1] ?? '';
      if (!inClass && (/[1-9]/.test(next) || pattern.startsWith('k<', i + 1))) {
        return false;
      }
      i++;
    } else if (inClass) {
      inClass = char !== ']';
    } else if (char === '[') {
      inClass = true;
    } else if (char === '(' && LOOKAROUND_OPENERS.some(opener => pattern.startsWith(opener, i))) {
      return false;
    }
  }
  return true;
}

/**
 * Compiles a JavaScript regular expression after checking that it stays inside the portable
 * subset (see `isPortableRegex`) and does not allow catastrophic backtracking, caching up to
 * `MAX_CACHED_PATTERNS` instances.
 *
 * Patterns are compiled without flags, so the accepted syntax matches the `new RegExp(pattern)`
 * check inside `isSafeRegex` (`safe_regex.ts`) and the basic catalog's `regex` function.
 *
 * @param source The pattern text.
 * @param functionName The calling function, named in the error.
 * @throws A2uiExpressionError if the pattern is not portable, invalid or unsafe.
 */
export function compileSafeRegex(source: string, functionName: string): RegExp {
  let compiled = compiledPatterns.get(source);
  if (compiled) {
    return compiled;
  }
  if (!isPortableRegex(source)) {
    throw new A2uiExpressionError(
      `${functionName} rejected the pattern '${source}': lookaround assertions and backreferences are not supported.`,
      functionName,
    );
  }
  if (!isSafeRegex(source)) {
    throw new A2uiExpressionError(
      `${functionName} rejected the pattern '${source}': it is not a valid regular expression or it allows catastrophic backtracking.`,
      functionName,
    );
  }
  try {
    compiled = new RegExp(source);
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
  compiledPatterns.set(source, compiled);
  return compiled;
}

/**
 * Applies `fn` to `value` as text, or to each element of an array `value`.
 *
 * A `null` or `undefined` element of an array reads as the empty string; any other non-string is
 * converted with `String`.
 */
export function mapTextValue<T>(value: unknown, fn: (item: string) => T): T | T[] {
  const asText = (item: unknown) => String(item ?? '');
  return Array.isArray(value) ? value.map(item => fn(asText(item))) : fn(asText(value));
}
