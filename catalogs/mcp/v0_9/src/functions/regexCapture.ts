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

export const RegexCaptureApi = {
  name: 'regexCapture',
  returnType: 'any',
  schema: z.object({
    value: asyncable(z.any()).describe(
      'The string to match. An array is matched element by element, giving an array of results.',
    ),
    pattern: asyncable(z.any()).describe(
      'An RE2 pattern. The result is the capture groups of the first match, or null when the pattern does not match. A group that did not participate reads as an empty string.',
    ),
  }),
} as const;

/** Returns capture groups of the first RE2 match, or null if no match is found. */
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
