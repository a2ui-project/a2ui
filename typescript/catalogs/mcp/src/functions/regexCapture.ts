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

import {createFunctionImplementation, type FunctionImplementation} from '@a2ui/web_core/v0_9';
import {z} from 'zod';

import {asyncable, overValue, pattern, withSettledArgs} from './common.js';

/** Function API definition for `regexCapture`. */
export const RegexCaptureApi = {
  name: 'regexCapture',
  returnType: 'any',
  schema: z.object({
    value: asyncable(z.any()).describe('The string or array of strings to match against.'),
    pattern: asyncable(z.any()).describe(
      'An RE2 regular expression. Returns an array of capture groups from the first match, or null if there is no match. Unmatched optional groups return empty strings.',
    ),
  }),
} as const;

/**
 * Matches a string (or each element of an array of strings) against an RE2 pattern
 * and returns the capture groups from the first match, or `null` if no match is found.
 *
 * @throws A2uiExpressionError if `pattern` is not a valid RE2 regular expression.
 */
export const RegexCaptureImplementation: FunctionImplementation = createFunctionImplementation(
  RegexCaptureApi,
  args =>
    withSettledArgs(args, settled => {
      const compiled = pattern(String(settled['pattern'] ?? ''), 'regexCapture');
      return overValue(settled['value'], item => {
        const matcher = compiled.matcher(item);
        if (!matcher.find()) {
          return null;
        }
        const groups: string[] = [];
        for (let i = 1; i <= matcher.groupCount(); i++) {
          groups.push(matcher.group(i) ?? '');
        }
        return groups;
      });
    }),
);
