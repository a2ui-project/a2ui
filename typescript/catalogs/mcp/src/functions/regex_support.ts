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
 * agent-supplied patterns validated with `analyzeRegex` from `@a2ui/web_core`, and
 * the string-or-array mapping that `split` and `regexCapture` share.
 */

import {A2uiExpressionError, analyzeRegex} from '@a2ui/web_core/v1_0';

/** Maximum number of compiled patterns kept in the cache. */
const MAX_CACHED_PATTERNS = 100;

/** Compiled patterns keyed by source, in insertion order. */
const compiledPatterns = new Map<string, RegExp>();

/**
 * Compiles a regular expression in the A2UI regex dialect after validating syntax and
 * checking for catastrophic backtracking with `analyzeRegex`, caching up to
 * `MAX_CACHED_PATTERNS` instances.
 *
 * Patterns are compiled in Unicode mode (`u`) with no other flags, matching the basic
 * catalog's `regex` function.
 *
 * @param source The pattern text.
 * @param functionName The calling function, named in the error.
 * @throws A2uiExpressionError if the pattern is outside the A2UI regex dialect, invalid, or unsafe.
 */
export function compileSafeRegex(source: string, functionName: string): RegExp {
  let compiled = compiledPatterns.get(source);
  if (compiled) {
    return compiled;
  }
  const analysis = analyzeRegex(source);
  if (!analysis.ok) {
    throw new A2uiExpressionError(
      `${functionName} rejected the pattern '${source}' (${analysis.reason}): ${analysis.detail}`,
      functionName,
    );
  }
  try {
    compiled = new RegExp(source, 'u');
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
