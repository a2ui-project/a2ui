/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** The length a follow-up value is truncated to, unless the follow-up configures another one. */
export const DEFAULT_MAX_VALUE_LENGTH = 80;

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Control characters, line and paragraph separators, and bidirectional formatting characters,
 * which could make a value spill out of its quotes or display differently than it reads.
 */
// eslint-disable-next-line no-control-regex -- Matching control characters is the point.
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g;

/** Returns the names of the `{name}` placeholders in `template`, in order of appearance. */
export function templatePlaceholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map(match => match[1]);
}

/**
 * Makes `value` safe to embed in a follow-up message: stringifies it, replaces unsafe characters
 * with spaces, truncates it to `maxValueLength` characters with an ellipsis, and JSON-quotes it, so
 * that a value can never read as part of the template's own text.
 */
export function quoteFollowUpValue(value: unknown, maxValueLength: number): string {
  const text = (typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value)))
    .replace(UNSAFE_CHARACTERS, ' ')
    .trim();
  const characters = [...text];
  const truncated =
    characters.length > maxValueLength
      ? `${characters.slice(0, maxValueLength - 1).join('')}…`
      : text;
  return JSON.stringify(truncated);
}

/** The outcome of {@link interpolateFollowUp}. */
export type InterpolateFollowUpResult = {ok: true; text: string} | {ok: false; message: string};

/**
 * Replaces each `{name}` placeholder in `template` with `values[name]`, quoted with
 * {@link quoteFollowUpValue}. A placeholder whose value is missing, `null` or `undefined`, makes
 * the interpolation fail instead of producing a message with a gap.
 */
export function interpolateFollowUp(
  template: string,
  values: Readonly<Record<string, unknown>>,
  maxValueLength: number,
): InterpolateFollowUpResult {
  const missing = templatePlaceholders(template).filter(
    name => !Object.hasOwn(values, name) || values[name] === undefined || values[name] === null,
  );
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Missing value for ${[...new Set(missing)].map(name => `"${name}"`).join(', ')}.`,
    };
  }
  return {
    ok: true,
    text: template.replace(PLACEHOLDER, (_match, name: string) =>
      quoteFollowUpValue(values[name], maxValueLength),
    ),
  };
}
