/**
 * @license
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

import {ParseError} from '../errors.js';

/**
 * Validates and applies autofixes to a raw JSON string and returns the parsed payload.
 *
 * @param payload The raw JSON string from the LLM.
 * @returns A parsed and potentially fixed payload (array of objects).
 */
export function parseAndFix(payload: string): Record<string, unknown>[] {
  const normalizedPayload = normalizeSmartQuotes(payload);
  try {
    return parse(normalizedPayload);
  } catch {
    const updatedPayload = removeTrailingCommas(normalizedPayload);
    return parse(updatedPayload);
  }
}

/**
 * Parses the payload and returns an array of A2UI JSON objects.
 */
function parse(payload: string): Record<string, unknown>[] {
  try {
    let a2uiJson = JSON.parse(payload) as unknown;
    if (!Array.isArray(a2uiJson)) {
      a2uiJson = [a2uiJson];
    }
    return a2uiJson as Record<string, unknown>[];
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    let hint = '';

    if (msg.includes('Bad escaped character')) {
      const match = msg.match(/\(line (\d+) column (\d+)\)/);
      if (match) {
        hint = ` - Help: Unescaped backslash found at line ${match[1]}, col ${match[2]}. In JSON strings, all backslashes must be escaped as '\\\\' (e.g. '\\\\approx', '\\\\alpha').`;
      } else {
        hint = ` - Help: Unescaped backslash found. In JSON strings, all backslashes must be escaped as '\\\\' (e.g. '\\\\approx', '\\\\alpha').`;
      }
    }

    throw new ParseError(`Failed to parse JSON: ${msg}${hint}`);
  }
}

/**
 * Replaces smart (curly) quotes with standard straight quotes.
 */
function normalizeSmartQuotes(jsonStr: string): string {
  return jsonStr
    .replace(/\u201C/g, '"')
    .replace(/\u201D/g, '"')
    .replace(/\u2018/g, "'")
    .replace(/\u2019/g, "'");
}

/**
 * Attempts to remove trailing commas from a JSON string.
 */
export function removeTrailingCommas(jsonStr: string): string {
  return jsonStr.replace(/,(?=\s*[\]}])/g, '');
}
