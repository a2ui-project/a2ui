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
import {RE2JS} from 're2js';
import {z} from 'zod';

import {asyncable, overValue, pattern, withSettledArgs} from './common.js';

export const RegexReplaceApi = {
  name: 'regexReplace',
  returnType: 'any',
  schema: z.object({
    value: asyncable(z.any()).describe(
      'The string to rewrite. An array is rewritten element by element.',
    ),
    pattern: asyncable(z.any()).describe('An RE2 pattern. Every match is replaced.'),
    replacement: asyncable(z.any()).describe(
      'Literal replacement text. A group reference such as $1 is not expanded.',
    ),
  }),
} as const;

/** Replaces all RE2 pattern matches in a string or array of strings with literal text. */
export const RegexReplaceImplementation: FunctionImplementation = createFunctionImplementation(
  RegexReplaceApi,
  args =>
    withSettledArgs(args, settled => {
      const compiled = pattern(String(settled['pattern'] ?? ''), 'regexReplace');
      const replacement = RE2JS.quoteReplacement(String(settled['replacement'] ?? ''));
      return overValue(settled['value'], item => compiled.matcher(item).replaceAll(replacement));
    }),
);
