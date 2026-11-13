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

import * as z from 'zod/v4';

/**
 * Formats a single Zod issue into a human-readable diagnostic message.
 *
 * Direct attribute extraction is used so that issue details (such as unrecognized
 * property keys or invalid enum options) are preserved even when running in
 * optimized/minified production builds where Zod's internal error map messages
 * may be obfuscated or stripped.
 *
 * @param err Zod validation issue to format.
 * @return Human-readable formatted error message.
 */
export function formatZodIssue(err: z.core.$ZodIssue): string {
  const path = err.path.join('.') || 'root';

  switch (err.code) {
    case 'invalid_union': {
      // A branch's issue paths are relative to the union.
      const unionIssues = err.errors
        .flat()
        .map(issue => ({...issue, path: [...err.path, ...issue.path]}));
      if (unionIssues.length > 0) {
        return unionIssues.map(formatZodIssue).join('; ');
      }
      return `${path}: Invalid union`;
    }

    case 'unrecognized_keys': {
      const keysStr = err.keys.map(k => `'${k}'`).join(', ');
      return `${path}: Unrecognized key(s) in object: ${keysStr}`;
    }

    case 'invalid_value': {
      if (err.values.length === 1) {
        return `${path}: Invalid literal value, expected ${JSON.stringify(err.values[0])}`;
      }
      const optionsStr = err.values.map(o => String(o)).join(' | ');
      return `${path}: Invalid enum value. Expected ${optionsStr}, received '${String(err.input)}'`;
    }

    case 'invalid_type': {
      // `input` is on the issue only when parsed with `reportInput`.
      if (!('input' in err)) return `${path}: ${err.message}`;
      const input = err.input;
      const received = input === null ? 'null' : Array.isArray(input) ? 'array' : typeof input;
      return `${path}: Expected ${err.expected}, received ${received}`;
    }

    case 'custom':
      return `${path}: ${err.message}`;

    default:
      return err.message ? `${path}: ${err.message}` : `${path}: Validation error (${err.code})`;
  }
}
