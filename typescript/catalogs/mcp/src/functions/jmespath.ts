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
} from '@a2ui/web_core/v1_0';
import {search} from 'jmespath';
import {z} from 'zod';

import {withSettledArgs} from './settle_args.js';

/**
 * Function API definition for `jmespath`, using standard JMESPath syntax
 * (https://jmespath.org).
 *
 * Both arguments are `z.unknown()` because either may arrive as the pending Promise of a nested
 * asynchronous call; the expression type is checked once it has settled.
 */
export const JmespathApi = {
  name: 'jmespath' as const,
  returnType: 'any' as const,
  schema: z.object({
    // Quoted to prevent Google Closure Compiler property renaming.
    'expression': z.unknown().describe('A standard JMESPath expression evaluated against `data`.'),
    'data': z.unknown().describe('The input data to evaluate the expression against.'),
  }),
  description: 'Evaluates a JMESPath expression against input data.',
};

/**
 * Evaluates a JMESPath expression against `data` and returns the result, or `null` when the
 * expression selects nothing.
 *
 * @throws A2uiExpressionError if `expression` is not a string or does not parse.
 */
export const JmespathImplementation: FunctionImplementation = createFunctionImplementation(
  JmespathApi,
  args =>
    withSettledArgs(args, settled => {
      const expression = settled['expression'];
      if (typeof expression !== 'string') {
        const kind =
          expression === null ? 'null' : Array.isArray(expression) ? 'array' : typeof expression;
        throw new A2uiExpressionError(
          `jmespath expects a string expression, got ${kind}.`,
          'jmespath',
        );
      }
      try {
        return search(settled['data'] ?? null, expression);
      } catch (error) {
        throw new A2uiExpressionError(
          `${error instanceof Error ? error.message : String(error)} in JMESPath expression: ${expression}`,
          'jmespath',
          error,
        );
      }
    }),
);
