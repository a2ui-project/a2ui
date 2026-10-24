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
  DynamicStringSchema,
  DynamicValueSchema,
  createFunctionImplementation,
  type FunctionImplementation,
} from '@a2ui/web_core/v1_0';
import {search} from 'jmespath';
import {z} from 'zod';

/**
 * Function API definition for `jmespath`, using standard JMESPath syntax
 * (https://jmespath.org).
 */
export const JmespathApi = {
  name: 'jmespath' as const,
  returnType: 'any' as const,
  schema: z.object({
    // Quoted to prevent Google Closure Compiler property renaming.
    'expression': DynamicStringSchema.describe(
      'A standard JMESPath expression evaluated against `data`.',
    ),
    'data': DynamicValueSchema.describe('The input data to evaluate the expression against.'),
  }),
  description: 'Evaluates a JMESPath expression against input data.',
};

/**
 * Evaluates a JMESPath expression against `data` and returns the result, or `null` when the
 * expression selects nothing.
 *
 * @throws A2uiExpressionError if `expression` does not parse.
 */
export const JmespathImplementation: FunctionImplementation = createFunctionImplementation(
  JmespathApi,
  args => {
    const expression = String(args['expression']);
    try {
      return search(args['data'], expression);
    } catch (error) {
      throw new A2uiExpressionError(
        `${error instanceof Error ? error.message : String(error)} in JMESPath expression: ${expression}`,
        'jmespath',
        error,
      );
    }
  },
);
