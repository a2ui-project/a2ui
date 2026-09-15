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
  A2uiExpressionError,
  createFunctionImplementation,
  type FunctionImplementation,
} from '@a2ui/web_core/v0_9';
import {search as searchJmespath} from 'jmespath';
import {z} from 'zod';

import {resolveDynamicValueDeep} from '../dynamic-values.js';
import {asyncable, describe, withSettledArgs} from './common.js';

/** Language description published in `mcp_catalog.json` for `jmespath.expression`. */
export const JMESPATH_LANGUAGE_DESCRIPTION = [
  'A JMESPath expression, as specified at jmespath.org, evaluated against `data`.',
  '',
  'The dialect is the original grammar and nothing more, so an expression runs',
  'unchanged on any client with a stock JMESPath library. Extensions some',
  'libraries add are not available: there are no `let` bindings, no ternary',
  '`? :`, no arithmetic operators, and no `$` root reference.',
  '',
  'There are no regular expressions and no `split` inside an expression. Call',
  'the `split`, `regexCapture`, and `regexReplace` functions first and pass',
  'their output in as `data`. To test whether a string matches a pattern, use',
  'the basic catalog `regex` function.',
  '',
  'Two idioms cover what the missing syntax would do:',
  '  Conditionals. Write `(cond && valueIfTrue) || valueIfFalse`. Both branches',
  '  must be truthy values; an empty string, empty array, empty object, null,',
  '  and false are all falsy.',
  '  Intermediate values. Pipe into a multi-select hash to name subresults,',
  '  then read them by name: `{n: length(rows)} | {"/count": n}`.',
  '',
  'Use `rows[*]` to map over a list. `rows[]` flattens one level instead, which',
  'is rarely what a list of rows wants. Filter with `rows[?@ != null]`.',
  '',
  'A projection rebinds the current node, and there is no root reference, so a',
  'value at the top of `data` is not visible inside `rows[*].{...}`. Build such',
  'a value in the component instead: a template row can read an absolute path,',
  'so `formatString` with `${/dir}/${name}` joins a value held once to a field',
  'held per row.',
].join('\n');

export const JmespathApi = {
  name: 'jmespath',
  returnType: 'any',
  schema: z.object({
    expression: asyncable(z.any()).describe(JMESPATH_LANGUAGE_DESCRIPTION),
    data: asyncable(z.any()).describe('The document the expression reads.'),
  }),
} as const;

/** Evaluates a standard JMESPath expression against `data`. */
export const JmespathImplementation: FunctionImplementation = createFunctionImplementation(
  JmespathApi,
  (args, context) => {
    const document = resolveDynamicValueDeep<unknown>(args['data'], context);
    return withSettledArgs({expression: args['expression'], data: document}, settled => {
      const expression = resolveDynamicValueDeep<unknown>(settled['expression'], context);
      if (typeof expression !== 'string') {
        throw new A2uiExpressionError(
          `jmespath expects a string expression, got ${describe(expression)}.`,
          'jmespath',
        );
      }
      try {
        return searchJmespath(settled['data'] ?? null, expression);
      } catch (error) {
        throw new A2uiExpressionError(
          `${error instanceof Error ? error.message : String(error)} in JMESPath expression: ${expression}`,
          'jmespath',
          error,
        );
      }
    });
  },
);
