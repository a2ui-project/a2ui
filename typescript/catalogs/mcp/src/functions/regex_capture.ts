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

import {
  DynamicStringSchema,
  DynamicValueSchema,
  createFunctionImplementation,
  type FunctionImplementation,
} from '@a2ui/web_core/v1_0';
import {z} from 'zod';

import {compileSafeRegex, mapTextValue} from './regex_support.js';

/** Function API definition for `regexCapture`. */
export const RegexCaptureApi = {
  name: 'regexCapture' as const,
  returnType: 'any' as const,
  schema: z.object({
    // Quoted to prevent Google Closure Compiler property renaming.
    'value': DynamicValueSchema.describe('The string or array of strings to match against.'),
    'pattern': DynamicStringSchema.describe(
      'A regular expression in the portable subset: JavaScript syntax without lookahead, lookbehind or backreferences. Returns an array of capture groups from the first match, or null if there is no match. Unmatched optional groups return empty strings.',
    ),
  }),
  description: 'Extracts capture groups from the first regular expression match.',
};

/**
 * Matches a string, or each element of an array of strings, against a pattern and returns the
 * capture groups of the first match, or `null` when there is none.
 *
 * @throws A2uiExpressionError if `pattern` is not a valid, safe and portable regular expression.
 */
export const RegexCaptureImplementation: FunctionImplementation = createFunctionImplementation(
  RegexCaptureApi,
  args => {
    const compiled = compileSafeRegex(String(args['pattern']), 'regexCapture');
    return mapTextValue(args['value'], item => {
      const match = compiled.exec(item);
      return match ? match.slice(1).map(group => group ?? '') : null;
    });
  },
);
