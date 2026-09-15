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
import {asyncable, withSettledArgs} from './common.js';

export const JmespathApi = {
  name: 'jmespath',
  returnType: 'any',
  schema: z.object({
    expression: asyncable(z.any()).describe(
      'A JMESPath expression, as specified at jmespath.org, evaluated against `data`.',
    ),
    data: asyncable(z.any()).describe('The document the expression reads.'),
  }),
} as const;

/** Evaluates a standard JMESPath expression against `data`. */
export const JmespathImplementation: FunctionImplementation = createFunctionImplementation(
  JmespathApi,
  (args, context) => {
    const document = resolveDynamicValueDeep<unknown>(args['data'], context);
    const expression = resolveDynamicValueDeep<unknown>(args['expression'], context);
    return withSettledArgs({expression, data: document}, settled => {
      const expr = settled['expression'];
      if (typeof expr !== 'string') {
        const kind = expr === null ? 'null' : Array.isArray(expr) ? 'an array' : `a ${typeof expr}`;
        throw new A2uiExpressionError(
          `jmespath expects a string expression, got ${kind}.`,
          'jmespath',
        );
      }
      try {
        return searchJmespath(settled['data'] ?? null, expr);
      } catch (error) {
        throw new A2uiExpressionError(
          `${error instanceof Error ? error.message : String(error)} in JMESPath expression: ${expr}`,
          'jmespath',
          error,
        );
      }
    });
  },
);
