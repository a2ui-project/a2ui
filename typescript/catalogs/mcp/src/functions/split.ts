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

import {mapTextValue} from './regex_support.js';
import {withSettledArgs} from './settle_args.js';

/**
 * Function API definition for `split`.
 *
 * Both arguments are `z.unknown()` because either may arrive as the pending Promise of a nested
 * asynchronous call.
 */
export const SplitApi = {
  name: 'split' as const,
  returnType: 'any' as const,
  schema: z.object({
    // Quoted to prevent Google Closure Compiler property renaming.
    'value': z.unknown().describe('The string or array of strings to split.'),
    'separator': z
      .unknown()
      .describe(
        'The delimiter string to split on. An empty string splits into individual characters (Unicode code points).',
      ),
  }),
  description: 'Splits a string into an array of substrings using a literal separator.',
};

/**
 * Splits a string on a literal separator, or each element of an array of strings, giving an
 * array of arrays. An empty separator splits into Unicode code points, so an emoji or other
 * character outside the Basic Multilingual Plane stays whole instead of becoming two surrogate
 * halves.
 */
export const SplitImplementation: FunctionImplementation = createFunctionImplementation(
  SplitApi,
  args =>
    withSettledArgs(args, settled => {
      const separator = String(settled['separator'] ?? '');
      return mapTextValue(settled['value'], item =>
        separator === '' ? Array.from(item) : item.split(separator),
      );
    }),
);
