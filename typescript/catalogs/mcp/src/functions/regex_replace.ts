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

import {createFunctionImplementation, type FunctionImplementation} from '@a2ui/web_core/v1_0';
import {z} from 'zod';

import {compileSafeRegex, mapTextValue} from './regex_support.js';
import {withSettledArgs} from './settle_args.js';

/**
 * Function API definition for `regexReplace`.
 *
 * The arguments are `z.unknown()` because any of them may arrive as the pending Promise of a
 * nested asynchronous call.
 */
export const RegexReplaceApi = {
  name: 'regexReplace' as const,
  returnType: 'any' as const,
  schema: z.object({
    // Quoted to prevent Google Closure Compiler property renaming.
    'value': z.unknown().describe('The string or array of strings to perform replacements on.'),
    'pattern': z
      .unknown()
      .describe('A JavaScript regular expression matching substrings to replace.'),
    'replacement': z
      .unknown()
      .describe(
        'Literal replacement string. Capture group references like $1 are treated as literal text.',
      ),
  }),
  description: 'Replaces all regular expression matches with literal replacement text.',
};

/**
 * Replaces every match of a pattern in a string, or in each element of an array of strings, with
 * literal replacement text: `$1`, `$&` and `$$` are inserted as written.
 *
 * @throws A2uiExpressionError if `pattern` is not a valid or safe regular expression.
 */
export const RegexReplaceImplementation: FunctionImplementation = createFunctionImplementation(
  RegexReplaceApi,
  args =>
    withSettledArgs(args, settled => {
      const compiled = compileSafeRegex(String(settled['pattern'] ?? ''), 'regexReplace', 'g');
      const replacement = String(settled['replacement'] ?? '');
      return mapTextValue(settled['value'], item => {
        // The instance is cached and global, so a previous call may have left `lastIndex` set.
        compiled.lastIndex = 0;
        // A replacer function inserts the replacement as is, without `$` substitutions.
        return item.replace(compiled, () => replacement);
      });
    }),
);
