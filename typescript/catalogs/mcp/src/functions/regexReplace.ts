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

/** Function API definition for `regexReplace`. */
export const RegexReplaceApi = {
  name: 'regexReplace',
  returnType: 'any',
  schema: z.object({
    value: asyncable(z.any()).describe(
      'The string or array of strings to perform replacements on.',
    ),
    pattern: asyncable(z.any()).describe(
      'An RE2 regular expression matching substrings to replace.',
    ),
    replacement: asyncable(z.any()).describe(
      'Literal replacement string. Capture group references like $1 are treated as literal text.',
    ),
  }),
} as const;

/**
 * Replaces all matches of an RE2 pattern with literal replacement text.
 *
 * Replacement text is escaped so `$1` and similar sequences are inserted literally
 * rather than interpreted as capture group references.
 *
 * @throws A2uiExpressionError if `pattern` is not a valid RE2 regular expression.
 */
export const RegexReplaceImplementation: FunctionImplementation = createFunctionImplementation(
  RegexReplaceApi,
  args =>
    withSettledArgs(args, settled => {
      const compiled = pattern(String(settled['pattern'] ?? ''), 'regexReplace');
      const replacement = RE2JS.quoteReplacement(String(settled['replacement'] ?? ''));
      return overValue(settled['value'], item => compiled.matcher(item).replaceAll(replacement));
    }),
);
