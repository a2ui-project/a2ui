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

/**
 * Function API definition for `jmespath`, published in `mcp_catalog.json`.
 *
 * The dialect is the original JMESPath grammar and nothing more, so an
 * expression runs unchanged on a client built against a stock JMESPath library.
 * See `catalogs/mcp/README.md` for the idioms that stand in for the syntax the
 * grammar leaves out.
 */
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

/**
 * Evaluates a JMESPath expression against `data`, giving what it selects.
 *
 * Both arguments are resolved deeply first, so a literal document can mix tool
 * output with values already held in the data model. A field the expression
 * does not find reads as null rather than failing the call.
 *
 * @throws A2uiExpressionError when the expression is not a string or does not
 *     parse.
 */
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
