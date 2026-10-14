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

import {isSafePattern} from 'redos-detector';

/**
 * Options for regular expression safety validation.
 */
export interface SafeRegexOptions {
  /** Maximum allowable length of the regex pattern string (default: 256). */
  maxPatternLength?: number;
}

/**
 * Validates whether a regular expression pattern is safe from catastrophic
 * backtracking (ReDoS - CWE-1333) using `redos-detector`.
 *
 * Both the raw pattern and its anchored form (`^(?:pattern)$`, which is also
 * used by HTML `<input pattern>`) are checked so that unanchored trailing
 * nested quantifiers such as `(a+)+` are detected alongside `(a+)+b`.
 *
 * @param pattern The regular expression pattern string to validate.
 * @param options Optional configuration for pattern length bounds.
 * @returns `true` if the pattern is safe to execute; `false` if unsafe or invalid.
 */
export function isSafeRegex(pattern: string, options: SafeRegexOptions = {}): boolean {
  if (pattern === null || pattern === undefined || typeof pattern !== 'string') {
    return true;
  }
  if (pattern.length === 0) {
    return true;
  }

  const maxPatternLength = options.maxPatternLength ?? 256;
  if (pattern.length > maxPatternLength) {
    return false;
  }

  try {
    // Verify that the pattern is syntactically valid in the host JS RegExp engine.
    new RegExp(pattern);
    return isSafePattern(pattern).safe && isSafePattern(`^(?:${pattern})$`).safe;
  } catch {
    return false;
  }
}
